import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { RuntimeDispatchAttempt } from "../../src/runtime/dispatch-attempt"
import { RuntimeDraft } from "../../src/runtime/draft"
import { RuntimeOperation } from "../../src/runtime/operation"
import { RuntimeRun } from "../../src/runtime/run"
import { DraftTable, OperationTable, RunTable } from "../../src/runtime/runtime.sql"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

type RunPage = {
  items: Array<{
    id: string
    operation_id: string | null
    operation_exists: boolean
    duplicate_event: { reason: boolean; failure: boolean }
  }>
  next_cursor: string | null
}

type OperationPage = {
  items: Array<{
    id: string
    run_id: string
    run_exists: boolean
    provenance: "app" | "user"
  }>
  next_cursor: string | null
}

type DraftPage = {
  items: Array<{
    id: string
    status: string
    dispatch: {
      state: string
      remote_reference: string | null
    } | null
  }>
  next_cursor: string | null
}

function result_query(input: { directory: string; workspace?: string; extra?: string }) {
  const parts = [`directory=${encodeURIComponent(input.directory)}`]
  if (input.workspace) parts.push(`workspace=${encodeURIComponent(input.workspace)}`)
  if (input.extra) parts.push(input.extra)
  return `?${parts.join("&")}`
}

function seed(workspace_id: string, directory: string) {
  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: workspace_id,
        project_id: Instance.project.id,
        branch: "main",
        config: {
          type: "worktree",
          directory,
        },
      })
      .onConflictDoNothing()
      .run()
  })
}

function set_run_time(run_id: string, created_at: number) {
  Database.use((db) => {
    db.update(RunTable).set({ created_at, updated_at: created_at }).where(eq(RunTable.id, run_id)).run()
  })
}

function set_operation_time(operation_id: string, created_at: number) {
  Database.use((db) => {
    db
      .update(OperationTable)
      .set({ created_at, updated_at: created_at })
      .where(eq(OperationTable.id, operation_id))
      .run()
  })
}

function set_draft_time(draft_id: string, updated_at: number) {
  Database.use((db) => {
    db.update(DraftTable).set({ created_at: updated_at, updated_at }).where(eq(DraftTable.id, draft_id)).run()
  })
}

function draft_input(id: string, workspace_id: string) {
  return {
    id,
    workspace_id,
    source_kind: "user" as const,
    adapter_id: "test",
    integration_id: "test/default",
    action_id: "message.send",
    target: "channel://general",
    payload_json: {
      text: id,
    },
    payload_schema_version: 1,
    preview_text: `Message channel://general: ${id}`,
    material_hash: `hash-${id}`,
  }
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("workflow history routes", () => {
  test("runs history has deterministic timestamp/id ordering and cursor continuation", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_history", dir.path)

        const first = RuntimeRun.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e1",
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const second = RuntimeRun.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e2",
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const third = RuntimeRun.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e3",
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        set_run_time(first.id, 2_000)
        set_run_time(second.id, 2_000)
        set_run_time(third.id, 1_000)

        const app = Server.App()
        const query = result_query({
          directory: dir.path,
          workspace: "wrk_history",
          extra: "limit=2",
        })
        const page_one = await app.request(`/workflow/history/runs${query}`, {
          method: "GET",
        })
        expect(page_one.status).toBe(200)
        const first_body = (await page_one.json()) as RunPage

        expect(first_body.items.map((item) => item.id)).toEqual([second.id, first.id])
        expect(first_body.next_cursor).toBeTruthy()

        const page_repeat = await app.request(`/workflow/history/runs${query}`, {
          method: "GET",
        })
        expect(page_repeat.status).toBe(200)
        const repeat_body = (await page_repeat.json()) as RunPage
        expect(repeat_body.items.map((item) => item.id)).toEqual([second.id, first.id])

        const page_two = await app.request(
          `/workflow/history/runs${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: `limit=2&cursor=${encodeURIComponent(first_body.next_cursor!)}`,
          })}`,
          {
            method: "GET",
          },
        )
        expect(page_two.status).toBe(200)
        const second_body = (await page_two.json()) as RunPage
        expect(second_body.items.map((item) => item.id)).toEqual([third.id])
        expect(second_body.next_cursor).toBeNull()
      },
    })
  })

  test("runs history excludes debug rows by default and includes them when requested", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_history", dir.path)

        const normal = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const debug = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "debug",
        })
        set_run_time(normal.id, 1_000)
        set_run_time(debug.id, 2_000)

        const app = Server.App()
        const hidden = await app.request(
          `/workflow/history/runs${result_query({
            directory: dir.path,
            workspace: "wrk_history",
          })}`,
          {
            method: "GET",
          },
        )
        expect(hidden.status).toBe(200)
        const hidden_body = (await hidden.json()) as RunPage
        expect(hidden_body.items.map((item) => item.id)).toEqual([normal.id])

        const explicit_hidden = await app.request(
          `/workflow/history/runs${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: "include_debug=false",
          })}`,
          {
            method: "GET",
          },
        )
        expect(explicit_hidden.status).toBe(200)
        const explicit_hidden_body = (await explicit_hidden.json()) as RunPage
        expect(explicit_hidden_body.items.map((item) => item.id)).toEqual([normal.id])

        const shown = await app.request(
          `/workflow/history/runs${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: "include_debug=true",
          })}`,
          {
            method: "GET",
          },
        )
        expect(shown.status).toBe(200)
        const shown_body = (await shown.json()) as RunPage
        expect(shown_body.items.map((item) => item.id)).toEqual([debug.id, normal.id])
      },
    })
  })

  test("operations history defaults to app provenance and can include user provenance", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_history", dir.path)

        const app_run = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const user_run = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const app_operation = RuntimeOperation.create({
          run_id: app_run.id,
          workspace_id: "wrk_history",
          trigger_type: "manual",
          status: "completed",
          actor_type: "system",
        })
        const user_operation = RuntimeOperation.create({
          run_id: user_run.id,
          workspace_id: "wrk_history",
          trigger_type: "manual",
          status: "completed",
          actor_type: "user",
        })
        set_operation_time(app_operation.id, 2_000)
        set_operation_time(user_operation.id, 1_000)

        const app = Server.App()
        const hidden = await app.request(
          `/workflow/history/operations${result_query({
            directory: dir.path,
            workspace: "wrk_history",
          })}`,
          {
            method: "GET",
          },
        )
        expect(hidden.status).toBe(200)
        const hidden_body = (await hidden.json()) as OperationPage
        expect(hidden_body.items.map((item) => item.id)).toEqual([app_operation.id])
        expect(hidden_body.items[0]?.provenance).toBe("app")
        expect(hidden_body.items[0]?.run_exists).toBe(true)

        const explicit_hidden = await app.request(
          `/workflow/history/operations${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: "include_user=false",
          })}`,
          {
            method: "GET",
          },
        )
        expect(explicit_hidden.status).toBe(200)
        const explicit_hidden_body = (await explicit_hidden.json()) as OperationPage
        expect(explicit_hidden_body.items.map((item) => item.id)).toEqual([app_operation.id])

        const shown = await app.request(
          `/workflow/history/operations${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: "include_user=true",
          })}`,
          {
            method: "GET",
          },
        )
        expect(shown.status).toBe(200)
        const shown_body = (await shown.json()) as OperationPage
        expect(shown_body.items.map((item) => item.id)).toEqual([app_operation.id, user_operation.id])
        expect(shown_body.items.map((item) => item.provenance)).toEqual(["app", "user"])
        expect(shown_body.items.every((item) => item.run_exists)).toBe(true)
      },
    })
  })

  test("operations history has deterministic timestamp/id ordering and cursor continuation", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_history", dir.path)

        const first_run = RuntimeRun.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53f1",
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const second_run = RuntimeRun.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53f2",
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const third_run = RuntimeRun.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53f3",
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })

        const first = RuntimeOperation.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53f1",
          run_id: first_run.id,
          workspace_id: "wrk_history",
          trigger_type: "manual",
          status: "completed",
          actor_type: "system",
        })
        const second = RuntimeOperation.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53f2",
          run_id: second_run.id,
          workspace_id: "wrk_history",
          trigger_type: "manual",
          status: "completed",
          actor_type: "system",
        })
        const third = RuntimeOperation.create({
          id: "018f3c19-89f7-7b87-b72f-0ef4f34a53f3",
          run_id: third_run.id,
          workspace_id: "wrk_history",
          trigger_type: "manual",
          status: "completed",
          actor_type: "system",
        })

        set_operation_time(first.id, 2_000)
        set_operation_time(second.id, 2_000)
        set_operation_time(third.id, 1_000)

        const app = Server.App()
        const query = result_query({
          directory: dir.path,
          workspace: "wrk_history",
          extra: "limit=2",
        })
        const page_one = await app.request(`/workflow/history/operations${query}`, {
          method: "GET",
        })
        expect(page_one.status).toBe(200)
        const first_body = (await page_one.json()) as OperationPage

        expect(first_body.items.map((item) => item.id)).toEqual([second.id, first.id])
        expect(first_body.next_cursor).toBeTruthy()

        const page_repeat = await app.request(`/workflow/history/operations${query}`, {
          method: "GET",
        })
        expect(page_repeat.status).toBe(200)
        const repeat_body = (await page_repeat.json()) as OperationPage
        expect(repeat_body.items.map((item) => item.id)).toEqual([second.id, first.id])

        const page_two = await app.request(
          `/workflow/history/operations${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: `limit=2&cursor=${encodeURIComponent(first_body.next_cursor!)}`,
          })}`,
          {
            method: "GET",
          },
        )
        expect(page_two.status).toBe(200)
        const second_body = (await page_two.json()) as OperationPage
        expect(second_body.items.map((item) => item.id)).toEqual([third.id])
        expect(second_body.next_cursor).toBeNull()
      },
    })
  })

  test("runs history exposes duplicate-event markers and missing-link-safe operation metadata", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_history", dir.path)

        const linked = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const unlinked = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        const duplicate_reason = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "cron",
          status: "skipped",
          reason_code: "duplicate_event",
        })
        const duplicate_failure = RuntimeRun.create({
          workspace_id: "wrk_history",
          trigger_type: "manual",
        })
        RuntimeRun.transition({
          id: duplicate_failure.id,
          to: "running",
        })
        RuntimeRun.transition({
          id: duplicate_failure.id,
          to: "failed",
          failure_code: "duplicate_event",
        })

        const operation = RuntimeOperation.create({
          run_id: linked.id,
          workspace_id: "wrk_history",
          trigger_type: "manual",
          status: "completed",
          actor_type: "system",
        })

        set_run_time(linked.id, 4_000)
        set_run_time(unlinked.id, 3_000)
        set_run_time(duplicate_reason.id, 2_000)
        set_run_time(duplicate_failure.id, 1_000)
        set_operation_time(operation.id, 4_500)

        const app = Server.App()
        const response = await app.request(
          `/workflow/history/runs${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: "include_debug=true",
          })}`,
          {
            method: "GET",
          },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as RunPage
        const map = new Map(body.items.map((item) => [item.id, item]))

        expect(map.get(linked.id)?.operation_exists).toBe(true)
        expect(map.get(linked.id)?.operation_id).toBe(operation.id)
        expect(map.get(unlinked.id)?.operation_exists).toBe(false)
        expect(map.get(unlinked.id)?.operation_id).toBeNull()

        expect(map.get(duplicate_reason.id)?.duplicate_event).toEqual({
          reason: true,
          failure: false,
        })
        expect(map.get(duplicate_failure.id)?.duplicate_event).toEqual({
          reason: false,
          failure: true,
        })
      },
    })
  })

  test("draft history splits pending and processed scopes with dispatch metadata", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_history", dir.path)

        const pending = RuntimeDraft.create(draft_input("018f3c19-89f7-7b87-b72f-0ef4f34a53d1", "wrk_history"))
        const approved = RuntimeDraft.transition({
          id: RuntimeDraft.create(draft_input("018f3c19-89f7-7b87-b72f-0ef4f34a53d2", "wrk_history")).id,
          to: "approved",
        })
        const blocked = RuntimeDraft.transition({
          id: RuntimeDraft.create(draft_input("018f3c19-89f7-7b87-b72f-0ef4f34a53d3", "wrk_history")).id,
          to: "blocked",
          block_reason_code: "auth_unhealthy",
        })
        const auto_approved = RuntimeDraft.transition({
          id: RuntimeDraft.create(draft_input("018f3c19-89f7-7b87-b72f-0ef4f34a53d4", "wrk_history")).id,
          to: "auto_approved",
        })
        const sent = RuntimeDraft.transition({
          id: RuntimeDraft.transition({
            id: RuntimeDraft.create(draft_input("018f3c19-89f7-7b87-b72f-0ef4f34a53d5", "wrk_history")).id,
            to: "approved",
          }).id,
          to: "sent",
        })
        const failed = RuntimeDraft.transition({
          id: RuntimeDraft.transition({
            id: RuntimeDraft.create(draft_input("018f3c19-89f7-7b87-b72f-0ef4f34a53d6", "wrk_history")).id,
            to: "approved",
          }).id,
          to: "failed",
        })

        RuntimeDispatchAttempt.transition({
          id: RuntimeDispatchAttempt.create({
            draft_id: blocked.id,
            workspace_id: "wrk_history",
            integration_id: blocked.integration_id,
            idempotency_key: "dispatch:blocked",
          }).id,
          to: "blocked",
          block_reason_code: "auth_unhealthy",
        })
        RuntimeDispatchAttempt.transition({
          id: RuntimeDispatchAttempt.transition({
            id: RuntimeDispatchAttempt.create({
              draft_id: sent.id,
              workspace_id: "wrk_history",
              integration_id: sent.integration_id,
              idempotency_key: "dispatch:sent",
            }).id,
            to: "dispatching",
          }).id,
          to: "remote_accepted",
          remote_reference: "test.message:1",
        })
        RuntimeDispatchAttempt.transition({
          id: RuntimeDispatchAttempt.byDraft({
            draft_id: sent.id,
          })!.id,
          to: "finalized",
          remote_reference: "test.message:1",
        })

        set_draft_time(approved.id, 4_000)
        set_draft_time(blocked.id, 3_000)
        set_draft_time(auto_approved.id, 2_000)
        set_draft_time(pending.id, 1_000)
        set_draft_time(sent.id, 5_000)
        set_draft_time(failed.id, 500)

        const app = Server.App()
        const pending_response = await app.request(
          `/workflow/history/drafts${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: "scope=pending",
          })}`,
          {
            method: "GET",
          },
        )
        const processed_response = await app.request(
          `/workflow/history/drafts${result_query({
            directory: dir.path,
            workspace: "wrk_history",
            extra: "scope=processed",
          })}`,
          {
            method: "GET",
          },
        )

        expect(pending_response.status).toBe(200)
        expect(processed_response.status).toBe(200)

        const pending_body = (await pending_response.json()) as DraftPage
        const processed_body = (await processed_response.json()) as DraftPage

        expect(pending_body.items.map((item) => item.id)).toEqual([approved.id, blocked.id, auto_approved.id, pending.id])
        expect(processed_body.items.map((item) => item.id)).toEqual([sent.id, failed.id])
        expect(pending_body.items.find((item) => item.id === blocked.id)?.dispatch?.state).toBe("blocked")
        expect(processed_body.items.find((item) => item.id === sent.id)?.dispatch?.remote_reference).toBe("test.message:1")
      },
    })
  })

  test("history routes return deterministic empty pages without workspace context", async () => {
    await using dir = await tmpdir({ git: true })

    await mkdir(path.join(dir.path, ".origin"), { recursive: true })
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const runs = await app.request(
          `/workflow/history/runs${result_query({
            directory: dir.path,
          })}`,
          {
            method: "GET",
          },
        )
        const operations = await app.request(
          `/workflow/history/operations${result_query({
            directory: dir.path,
          })}`,
          {
            method: "GET",
          },
        )
        expect(runs.status).toBe(200)
        expect(operations.status).toBe(200)
        const run_body = (await runs.json()) as RunPage
        const operation_body = (await operations.json()) as OperationPage
        expect(run_body.items).toEqual([])
        expect(run_body.next_cursor).toBeNull()
        expect(operation_body.items).toEqual([])
        expect(operation_body.next_cursor).toBeNull()
      },
    })
  })
})
