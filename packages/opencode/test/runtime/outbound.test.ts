import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { desc, eq } from "drizzle-orm"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { RuntimeDispatchAttempt } from "../../src/runtime/dispatch-attempt"
import { RuntimeManagedEndpointError, RuntimeOutboundValidationError } from "../../src/runtime/error"
import { RuntimeOutbound } from "../../src/runtime/outbound"
import { RuntimeOutboundIntegration } from "../../src/runtime/outbound-integration"
import { RuntimeRun } from "../../src/runtime/run"
import { AuditEventTable, DispatchAttemptTable, DraftTable, IntegrationAttemptTable } from "../../src/runtime/runtime.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const workspace_id = "wrk_outbound"
const workspace_other_id = "wrk_outbound_other"

function home(value?: string) {
  if (value === undefined) {
    delete process.env.OPENCODE_TEST_HOME
    return
  }
  process.env.OPENCODE_TEST_HOME = value
}

function seed(workspace: string, directory: string) {
  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: workspace,
        project_id: Instance.project.id,
        branch: workspace === workspace_id ? "main" : "other",
        type: "worktree",
        directory,
      })
      .onConflictDoNothing()
      .run()
  })
}

function draft(input: {
  run_id?: string | null
  workspace_id: string
  source_kind?: "user" | "system"
  action_id?: "message.send" | "issue.create"
  target?: string
  payload_json?: Record<string, unknown>
  auto_approve?: boolean
  actor_type?: "user" | "system"
}) {
  return {
    run_id: input.run_id,
    workspace_id: input.workspace_id,
    source_kind: input.source_kind ?? "user",
    integration_id: "test/default",
    adapter_id: "test",
    action_id: input.action_id ?? "message.send",
    target: input.target ?? "channel://general",
    payload_json: input.payload_json ?? {
      text: "hello",
    },
    payload_schema_version: 1,
    auto_approve: input.auto_approve ?? false,
    actor_type: input.actor_type ?? "user",
  } as const
}

function result(draft_id: string) {
  return Database.use((db) =>
    db
      .select()
      .from(AuditEventTable)
      .where(eq(AuditEventTable.draft_id, draft_id))
      .orderBy(desc(AuditEventTable.occurred_at), desc(AuditEventTable.id))
      .all(),
  )
}

async function origin(fn: (input: { directory: string }) => Promise<void>) {
  await using dir = await tmpdir({
    init: async (root) => {
      const directory = path.join(root, "Documents", "origin")
      await mkdir(directory, { recursive: true })
      await $`git init`.cwd(directory).quiet()
      await $`git commit --allow-empty -m "root commit ${directory}"`.cwd(directory).quiet()
      return {
        directory,
      }
    },
  })

  const prior = process.env.OPENCODE_TEST_HOME
  home(dir.path)
  try {
    await Instance.provide({
      directory: dir.extra.directory,
      fn: async () => {
        seed(workspace_id, dir.extra.directory)
        seed(workspace_other_id, dir.extra.directory)
        await fn({
          directory: dir.extra.directory,
        })
      },
    })
  } finally {
    home(prior)
  }
}

async function standard(fn: (input: { directory: string }) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  const prior = process.env.OPENCODE_TEST_HOME
  home(path.join(dir.path, "home"))
  try {
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed(workspace_id, dir.path)
        await fn({
          directory: dir.path,
        })
      },
    })
  } finally {
    home(prior)
  }
}

function code(error: unknown) {
  if (!(error instanceof Error)) throw error
  return (error as Error & { data?: { code?: string } }).data?.code
}

beforeEach(async () => {
  await resetDatabase()
  RuntimeOutbound.Testing.reset()
})

afterEach(async () => {
  await resetDatabase()
  RuntimeOutbound.Testing.reset()
  home()
})

describe("runtime outbound", () => {
  test("persists adapter-owned envelopes for incompatible actions and rejects cross-action payloads", async () => {
    await origin(async () => {
      const message = await RuntimeOutbound.create(draft({ workspace_id }))
      const issue = await RuntimeOutbound.create(
        draft({
          workspace_id,
          action_id: "issue.create",
          target: "repo://origin/issues",
          payload_json: {
            title: "Bug",
          },
        }),
      )

      expect(message.status).toBe("pending")
      expect(issue.status).toBe("pending")
      expect(message.preview_text).toBe("Message channel://general: hello")
      expect(issue.preview_text).toBe("Issue repo://origin/issues: Bug")
      expect(message.material_hash).not.toBe(issue.material_hash)

      const rows = Database.use((db) => db.select().from(DraftTable).orderBy(desc(DraftTable.created_at)).all())
      expect(rows.length).toBe(2)
      expect(rows.map((item) => item.action_id).sort()).toEqual(["issue.create", "message.send"])

      try {
        await RuntimeOutbound.create(
          draft({
            workspace_id,
            action_id: "issue.create",
            target: "repo://origin/issues",
          }),
        )
        throw new Error("expected create to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeOutboundValidationError)
        expect(code(error)).toBe("schema_invalid")
      }
    })
  })

  test("system auto-approve persists and policy evaluation failure defaults to blocked", async () => {
    await origin(async () => {
      const auto = await RuntimeOutbound.create(
        draft({
          workspace_id,
          source_kind: "system",
          auto_approve: true,
          actor_type: "system",
        }),
      )
      expect(auto.status).toBe("auto_approved")
      expect(auto.block_reason_code).toBeNull()

      RuntimeOutbound.Testing.set({
        fail_policy_action: "draft.auto_approve",
      })

      const blocked = await RuntimeOutbound.create(
        draft({
          workspace_id,
          source_kind: "system",
          auto_approve: true,
          actor_type: "system",
          payload_json: {
            text: "blocked",
          },
        }),
      )
      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("policy_evaluation_failed")
    })
  })

  test("one run can emit multiple drafts with independent lifecycle outcomes", async () => {
    await origin(async ({ directory }) => {
      const run_workspace_directory = path.join(directory, ".origin", "runs", "outbound-release-gate")
      const run = RuntimeRun.create({
        workspace_id,
        trigger_type: "manual",
        run_workspace_root: path.dirname(run_workspace_directory),
        run_workspace_directory,
      })

      const pending = await RuntimeOutbound.create(
        draft({
          run_id: run.id,
          workspace_id,
          payload_json: {
            text: "pending",
          },
        }),
      )
      const auto = await RuntimeOutbound.create(
        draft({
          run_id: run.id,
          workspace_id,
          source_kind: "system",
          auto_approve: true,
          actor_type: "system",
          payload_json: {
            text: "auto",
          },
        }),
      )
      const rejected = await RuntimeOutbound.create(
        draft({
          run_id: run.id,
          workspace_id,
          payload_json: {
            text: "reject",
          },
        }),
      )

      await RuntimeOutbound.send({
        id: auto.id,
        actor_type: "user",
      })
      await RuntimeOutbound.reject({
        id: rejected.id,
        actor_type: "user",
      })

      expect(RuntimeOutbound.get({ id: pending.id })).toMatchObject({
        run_id: run.id,
        status: "pending",
      })
      expect(RuntimeOutbound.get({ id: auto.id })).toMatchObject({
        run_id: run.id,
        status: "sent",
      })
      expect(RuntimeOutbound.get({ id: rejected.id })).toMatchObject({
        run_id: run.id,
        status: "rejected",
      })
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)
    })
  })

  test("non-origin outbound attempts are blocked with visible remediation state", async () => {
    await standard(async () => {
      const blocked = await RuntimeOutbound.create(draft({ workspace_id }))
      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("workspace_policy_blocked")
    })
  })

  test("auto-approved drafts send without an explicit approval step", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(
        draft({
          workspace_id,
          source_kind: "system",
          auto_approve: true,
          actor_type: "system",
        }),
      )

      expect(created.status).toBe("auto_approved")

      const sent = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(sent.status).toBe("sent")
      expect(sent.dispatch?.state).toBe("finalized")
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)
    })
  })

  test("approve and send remain separate and persist dispatch attempts distinct from integration attempts", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      expect(RuntimeOutbound.Testing.writes()).toEqual([])

      const approved = await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })
      expect(approved.status).toBe("approved")
      expect(approved.dispatch).toBeNull()
      expect(Database.use((db) => db.select().from(DispatchAttemptTable).all().length)).toBe(0)

      const sent = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })
      expect(sent.status).toBe("sent")
      expect(sent.dispatch?.state).toBe("finalized")
      expect(sent.dispatch?.idempotency_key).toBe(`dispatch:${created.id}`)
      expect(Database.use((db) => db.select().from(IntegrationAttemptTable).all().length)).toBe(0)
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)
    })
  })

  test("sent drafts ignore resend attempts without duplicate outbound writes", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      const first = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })
      const second = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(first.status).toBe("sent")
      expect(second.status).toBe("sent")
      expect(second.dispatch?.id).toBe(first.dispatch?.id)
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)
    })
  })

  test("successful dispatch audit rows persist complete provenance", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      const sent = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })
      const events = result(created.id).filter(
        (item) => item.event_type === "dispatch.attempt" || item.event_type === "dispatch.result",
      )

      expect(events).toHaveLength(2)
      expect(events.every((item) => item.draft_id === created.id)).toBe(true)
      expect(events.every((item) => item.dispatch_attempt_id === sent.dispatch?.id)).toBe(true)
      expect(events.every((item) => item.adapter_id === "test")).toBe(true)
      expect(events.every((item) => item.integration_id === "test/default")).toBe(true)
      expect(events.every((item) => item.action_id === "message.send")).toBe(true)
    })
  })

  test("material edits invalidate approval with a deterministic reason", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      const updated = await RuntimeOutbound.update({
        id: created.id,
        action_id: "issue.create",
        target: "repo://origin/issues",
        payload_json: {
          title: "Bug",
        },
        actor_type: "user",
      })

      expect(updated.status).toBe("pending")
      expect(updated.block_reason_code).toBe("material_edit_invalidation")
      expect(updated.action_id).toBe("issue.create")

      const event = result(created.id).find((item) => item.event_type === "draft.transitioned")
      expect((event?.event_payload as { reason_code?: string } | undefined)?.reason_code).toBe("material_edit_invalidation")
    })
  })

  test("blocked drafts can be repaired, re-approved, and sent with a fresh dispatch attempt", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      RuntimeOutbound.Testing.set({
        fail_policy_action: "draft.dispatch",
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("policy_evaluation_failed")
      const first = blocked.dispatch?.id
      if (!first) throw new Error("missing blocked dispatch attempt")

      RuntimeOutbound.Testing.set({})

      const updated = await RuntimeOutbound.update({
        id: created.id,
        payload_json: {
          text: "fixed",
        },
        actor_type: "user",
      })

      expect(updated.status).toBe("pending")
      expect(updated.dispatch).toBeNull()

      const approved = await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      expect(approved.status).toBe("approved")

      const sent = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(sent.status).toBe("sent")
      expect(sent.dispatch?.id).not.toBe(first)
      expect(sent.dispatch?.state).toBe("finalized")
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)
    })
  })

  test("send-time schema drift blocks deterministically with zero external writes", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      Database.use((db) => {
        db.update(DraftTable).set({ payload_schema_version: 2 }).where(eq(DraftTable.id, created.id)).run()
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("schema_version_unsupported")
      expect(blocked.dispatch?.state).toBe("blocked")
      expect(RuntimeOutbound.Testing.writes()).toEqual([])

      const event = result(created.id).find((item) => item.event_type === "dispatch.result")
      expect((event?.event_payload as { failure_code?: string } | undefined)?.failure_code).toBe("schema_version_unsupported")
    })
  })

  test("send-time auth revocation blocks the attempt and leaves other workspaces isolated", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      RuntimeOutboundIntegration.put({
        workspace_id,
        id: "test/default",
        adapter_id: "test",
        enabled: true,
        auth_state: "expired",
        allowed_targets: ["channel://general"],
      })
      RuntimeOutboundIntegration.put({
        workspace_id: workspace_other_id,
        id: "test/default",
        adapter_id: "test",
        enabled: true,
        auth_state: "healthy",
        allowed_targets: ["channel://alerts"],
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("auth_unhealthy")
      expect(blocked.dispatch?.state).toBe("blocked")
      expect(RuntimeOutbound.Testing.writes()).toEqual([])
      expect(RuntimeOutboundIntegration.get({ workspace_id, id: "test/default" })?.auth_state).toBe("expired")
      expect(RuntimeOutboundIntegration.get({ workspace_id: workspace_other_id, id: "test/default" })?.auth_state).toBe("healthy")
    })
  })

  test("send-time integration disable blocks with zero external writes", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      RuntimeOutboundIntegration.put({
        workspace_id,
        id: "test/default",
        adapter_id: "test",
        enabled: false,
        auth_state: "healthy",
        allowed_targets: ["channel://general"],
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("integration_disabled")
      expect(blocked.dispatch?.state).toBe("blocked")
      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })

  test("send-time target allowlist drift blocks with zero external writes", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      RuntimeOutboundIntegration.put({
        workspace_id,
        id: "test/default",
        adapter_id: "test",
        enabled: true,
        auth_state: "healthy",
        allowed_targets: ["channel://alerts"],
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("target_not_allowed")
      expect(blocked.dispatch?.state).toBe("blocked")
      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })

  test("send-time integration adapter inventory drift blocks out-of-inventory dispatches", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      RuntimeOutboundIntegration.put({
        workspace_id,
        id: "test/default",
        adapter_id: "system",
        enabled: true,
        auth_state: "healthy",
        allowed_targets: ["system://developers"],
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("integration_missing")
      expect(blocked.dispatch?.state).toBe("blocked")
      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })

  test("managed endpoints reject direct calls without draft context and audit the rejection", async () => {
    await origin(async () => {
      try {
        await RuntimeOutbound.Testing.send({
          workspace_id,
          integration_id: "test/default",
          action_id: "message.send",
          target: "channel://general",
          payload_json: {
            text: "hello",
          },
          idempotency_key: "manual",
        })
        throw new Error("expected send to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeManagedEndpointError)
        expect(code(error)).toBe("managed_endpoint_rejected")
      }

      expect(RuntimeOutbound.Testing.writes()).toEqual([])
      const event = Database.use((db) =>
        db.select().from(AuditEventTable).orderBy(desc(AuditEventTable.occurred_at), desc(AuditEventTable.id)).get(),
      )
      expect(event?.event_type).toBe("policy.decision")
      expect(event?.dispatch_attempt_id).toBeNull()
      expect(event?.decision_reason_code).toBe("managed_endpoint_rejected")
    })
  })

  test("managed endpoints reject forged adapter, action, or payload mismatches", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      const attempt = RuntimeDispatchAttempt.transition({
        id: RuntimeDispatchAttempt.create({
          draft_id: created.id,
          workspace_id,
          integration_id: "test/default",
          idempotency_key: "dispatch:forged",
        }).id,
        to: "dispatching",
      })

      try {
        await RuntimeOutbound.Testing.send({
          workspace_id,
          integration_id: "test/default",
          adapter_id: "system",
          draft_id: created.id,
          dispatch_attempt_id: attempt.id,
          action_id: "message.send",
          target: "channel://general",
          payload_json: {
            text: "hello",
          },
          idempotency_key: attempt.idempotency_key,
        })
        throw new Error("expected send to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeManagedEndpointError)
        expect(code(error)).toBe("dispatch_context_mismatch")
      }

      try {
        await RuntimeOutbound.Testing.send({
          workspace_id,
          integration_id: "test/default",
          draft_id: created.id,
          dispatch_attempt_id: attempt.id,
          action_id: "issue.create",
          target: "repo://origin/issues",
          payload_json: {
            title: "wrong",
          },
          idempotency_key: attempt.idempotency_key,
        })
        throw new Error("expected send to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeManagedEndpointError)
        expect(code(error)).toBe("dispatch_context_mismatch")
      }

      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })

  test("managed endpoints reject forged workspace and integration mismatches", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      const mismatched_workspace = RuntimeDispatchAttempt.transition({
        id: RuntimeDispatchAttempt.create({
          draft_id: created.id,
          workspace_id: workspace_other_id,
          integration_id: "test/default",
          idempotency_key: "dispatch:workspace-mismatch",
        }).id,
        to: "dispatching",
      })

      try {
        await RuntimeOutbound.Testing.send({
          workspace_id,
          integration_id: "test/default",
          draft_id: created.id,
          dispatch_attempt_id: mismatched_workspace.id,
          action_id: "message.send",
          target: "channel://general",
          payload_json: {
            text: "hello",
          },
          idempotency_key: mismatched_workspace.idempotency_key,
        })
        throw new Error("expected workspace mismatch")
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeManagedEndpointError)
        expect(code(error)).toBe("dispatch_context_mismatch")
      }

      RuntimeDispatchAttempt.remove({
        id: mismatched_workspace.id,
      })

      const mismatched_integration = RuntimeDispatchAttempt.transition({
        id: RuntimeDispatchAttempt.create({
          draft_id: created.id,
          workspace_id,
          integration_id: "test/other",
          idempotency_key: "dispatch:integration-mismatch",
        }).id,
        to: "dispatching",
      })

      try {
        await RuntimeOutbound.Testing.send({
          workspace_id,
          integration_id: "test/default",
          draft_id: created.id,
          dispatch_attempt_id: mismatched_integration.id,
          action_id: "message.send",
          target: "channel://general",
          payload_json: {
            text: "hello",
          },
          idempotency_key: mismatched_integration.idempotency_key,
        })
        throw new Error("expected integration mismatch")
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeManagedEndpointError)
        expect(code(error)).toBe("dispatch_context_mismatch")
      }

      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })

  test("send-time adapter registry tampering blocks with zero external writes", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      Database.use((db) => {
        db.update(DraftTable).set({ adapter_id: "system" }).where(eq(DraftTable.id, created.id)).run()
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("adapter_action_unregistered")
      expect(blocked.dispatch?.state).toBe("blocked")
      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })

  test("send ignores tampered derived draft fields and still dispatches authoritative material", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      Database.use((db) => {
        db
          .update(DraftTable)
          .set({
            preview_text: "forged preview",
            material_hash: "forged-hash",
            block_reason_code: "policy_blocked",
          })
          .where(eq(DraftTable.id, created.id))
          .run()
      })

      const sent = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(sent.status).toBe("sent")
      expect(RuntimeOutbound.Testing.writes()).toHaveLength(1)
      expect(RuntimeOutbound.Testing.writes()[0]?.payload_json).toEqual({
        text: "hello",
      })
      expect(RuntimeOutbound.Testing.writes()[0]?.target).toBe("channel://general")
    })
  })

  test("missing audit provenance fails closed before any outbound side effect", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      RuntimeOutbound.Testing.set({
        drop_dispatch_provenance_for: ["dispatch.attempt"],
      })

      const blocked = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(blocked.status).toBe("blocked")
      expect(blocked.block_reason_code).toBe("dispatch_provenance_required")
      expect(blocked.dispatch?.state).toBe("blocked")
      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })

  test("concurrent send requests produce exactly one outbound side effect", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      const [first, second] = await Promise.all([
        RuntimeOutbound.send({
          id: created.id,
          actor_type: "user",
        }),
        RuntimeOutbound.send({
          id: created.id,
          actor_type: "user",
        }),
      ])

      expect(first.status).toBe("sent")
      expect(second.status).toBe("sent")
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)
    })
  })

  test("remote accepted crash recovery finalizes the same attempt without duplicate writes", async () => {
    await origin(async () => {
      const created = await RuntimeOutbound.create(draft({ workspace_id }))
      await RuntimeOutbound.approve({
        id: created.id,
        actor_type: "user",
      })

      RuntimeOutbound.Testing.set({
        crash_after_remote_accepted: true,
      })

      try {
        await RuntimeOutbound.send({
          id: created.id,
          actor_type: "user",
        })
        throw new Error("expected send to crash")
      } catch (error) {
        expect((error as Error).message).toBe("crash_after_remote_accepted")
      }

      const before = RuntimeDispatchAttempt.byDraft({
        draft_id: created.id,
      })
      expect(before?.state).toBe("remote_accepted")
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)

      RuntimeOutbound.Testing.set({})

      const recovered = await RuntimeOutbound.send({
        id: created.id,
        actor_type: "user",
      })

      expect(recovered.status).toBe("sent")
      expect(recovered.dispatch?.id).toBe(before?.id)
      expect(recovered.dispatch?.idempotency_key).toBe(before?.idempotency_key)
      expect(recovered.dispatch?.state).toBe("finalized")
      expect(RuntimeOutbound.Testing.writes().length).toBe(1)
    })
  })
})
