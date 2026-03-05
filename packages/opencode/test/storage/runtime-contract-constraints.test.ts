import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { RuntimeAudit } from "../../src/runtime/audit"
import { RuntimeDraft } from "../../src/runtime/draft"
import { RuntimeIntegrationAttempt } from "../../src/runtime/integration-attempt"
import { RuntimeAuditPayloadError, RuntimeIllegalTransitionError, RuntimePolicyLineageError, RuntimeWorkspaceMismatchError } from "../../src/runtime/error"
import { RunTable, AuditEventTable } from "../../src/runtime/runtime.sql"
import { RuntimeOperation } from "../../src/runtime/operation"
import { RuntimeRun } from "../../src/runtime/run"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

const workspace_id = "wrk_storage"
const workspace_other_id = "wrk_storage_other"
const session_id = "ses_storage"
const project_id = "proj_storage"

function seed() {
  const now = Date.now()
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: project_id,
        worktree: "/tmp/storage",
        vcs: "git",
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .run()

    db.insert(SessionTable)
      .values({
        id: session_id,
        project_id,
        workspace_id,
        parent_id: null,
        slug: "storage",
        directory: "/tmp/storage",
        title: "storage",
        version: "1",
        share_url: null,
        summary_additions: null,
        summary_deletions: null,
        summary_files: null,
        summary_diffs: null,
        revert: null,
        permission: null,
        time_created: now,
        time_updated: now,
        time_compacting: null,
        time_archived: null,
      })
      .run()

    db.insert(WorkspaceTable)
      .values({
        id: workspace_id,
        project_id,
        branch: "main",
        config: {
          type: "worktree",
          directory: "/tmp/storage",
        },
      })
      .run()
  })
}

function count() {
  return Database.use((db) => db.select().from(AuditEventTable).all().length)
}

beforeEach(async () => {
  await resetDatabase()
  seed()
})

afterEach(async () => {
  await resetDatabase()
})

describe("runtime contract constraints", () => {
  test("duplicate (run_id, integration_attempt_id) insert fails", () => {
    const run = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })

    RuntimeIntegrationAttempt.create({
      id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e6",
      run_id: run.id,
      workspace_id,
    })

    expect(() =>
      RuntimeIntegrationAttempt.create({
        id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e6",
        run_id: run.id,
        workspace_id,
      }),
    ).toThrow()
  })

  test("run.ready_for_integration_at is immutable once set", () => {
    const run = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })
    RuntimeRun.transition({ id: run.id, to: "running" })
    RuntimeRun.transition({ id: run.id, to: "validating" })
    const queued = RuntimeRun.transition({ id: run.id, to: "ready_for_integration" })
    const first = queued.ready_for_integration_at

    if (typeof first !== "number") throw new Error("expected ready_for_integration_at to be set")
    expect(() =>
      Database.use((db) =>
        db
          .update(RunTable)
          .set({
            ready_for_integration_at: first + 1000,
          })
          .where(eq(RunTable.id, run.id))
          .run(),
      ),
    ).toThrow("run.ready_for_integration_at is immutable once set")

    const row = Database.use((db) => db.select().from(RunTable).where(eq(RunTable.id, run.id)).get())
    expect(row?.ready_for_integration_at).toBe(first)
  })

  test("policy/dispatch events require policy lineage fields", () => {
    const before = count()
    expect(() =>
      RuntimeAudit.write({
        event_type: "policy.decision",
        actor_type: "system",
        workspace_id,
        event_payload: {
          outcome: "allow",
          action: "dispatch",
        },
      }),
    ).toThrow(RuntimePolicyLineageError)
    expect(count()).toBe(before)
  })

  test("dispatch events require policy lineage fields", () => {
    const before = count()
    expect(() =>
      RuntimeAudit.write({
        event_type: "dispatch.attempt",
        actor_type: "system",
        workspace_id,
        event_payload: {
          action: "dispatch",
          destination: "email/default",
          idempotency_key: "key-1",
        },
      }),
    ).toThrow(RuntimePolicyLineageError)

    expect(() =>
      RuntimeAudit.write({
        event_type: "dispatch.result",
        actor_type: "system",
        workspace_id,
        event_payload: {
          outcome: "sent",
        },
      }),
    ).toThrow(RuntimePolicyLineageError)
    expect(count()).toBe(before)
  })

  test("policy/dispatch events with lineage fields are accepted", () => {
    const before = count()
    RuntimeAudit.write({
      event_type: "policy.decision",
      actor_type: "system",
      workspace_id,
      policy_id: "policy/default",
      policy_version: "1",
      decision_id: "decision/1",
      decision_reason_code: "policy_blocked",
      event_payload: {
        outcome: "allow",
        action: "dispatch",
      },
    })
    expect(count()).toBe(before + 1)
  })

  test("secret-like payload fields are rejected", () => {
    const before = count()
    expect(() =>
      RuntimeAudit.write({
        event_type: "run.transitioned",
        actor_type: "system",
        workspace_id,
        event_payload: {
          from: "queued",
          to: "running",
          api_key: "secret",
        },
      }),
    ).toThrow(RuntimeAuditPayloadError)
    expect(count()).toBe(before)
  })

  test("run workspace mismatch is rejected for operation/draft/integration attempt", () => {
    Database.use((db) =>
      db.insert(WorkspaceTable)
        .values({
          id: workspace_other_id,
          project_id,
          branch: "other",
          config: {
            type: "worktree",
            directory: "/tmp/storage-other",
          },
        })
        .run(),
    )

    const run = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })

    expect(() =>
      RuntimeOperation.create({
        run_id: run.id,
        workspace_id: workspace_other_id,
        trigger_type: "manual",
      }),
    ).toThrow(RuntimeWorkspaceMismatchError)

    expect(() =>
      RuntimeDraft.create({
        run_id: run.id,
        workspace_id: workspace_other_id,
        integration_id: "email/default",
      }),
    ).toThrow(RuntimeWorkspaceMismatchError)

    expect(() =>
      RuntimeIntegrationAttempt.create({
        run_id: run.id,
        workspace_id: workspace_other_id,
      }),
    ).toThrow(RuntimeWorkspaceMismatchError)
  })

  test("integration attempt create enforces create -> attempt_created only", () => {
    const run = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })

    expect(() =>
      RuntimeIntegrationAttempt.create({
        run_id: run.id,
        workspace_id,
        state: "finalized",
      }),
    ).toThrow(RuntimeIllegalTransitionError)
  })
})
