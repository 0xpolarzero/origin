import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { WorkflowSignalDedupeTable } from "../../src/runtime/runtime.sql"
import { RuntimeRun } from "../../src/runtime/run"
import { RuntimeWorkflowSignalDedupe } from "../../src/runtime/workflow-signal-dedupe"
import { RuntimeWorkflowTrigger } from "../../src/runtime/workflow-trigger"
import { create_uuid_v7 } from "../../src/runtime/uuid"
import { Database, and, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("trigger runtime primitives", () => {
  test("workflow trigger preserves enabled_at until prune and re-add", async () => {
    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_runtime", dir.path)

        const first = RuntimeWorkflowTrigger.upsert({
          workspace_id: "wrk_runtime",
          workflow_id: "sig",
          trigger_type: "signal",
          trigger_value: "incoming",
          enabled_at: 1_000,
        })
        const updated = RuntimeWorkflowTrigger.upsert({
          workspace_id: "wrk_runtime",
          workflow_id: "sig",
          trigger_type: "signal",
          trigger_value: "incoming-v2",
          enabled_at: 2_000,
        })

        expect(updated.id).toBe(first.id)
        expect(updated.enabled_at).toBe(1_000)
        expect(updated.trigger_value).toBe("incoming-v2")

        RuntimeWorkflowTrigger.prune({
          workspace_id: "wrk_runtime",
          keep: [],
        })

        const recreated = RuntimeWorkflowTrigger.upsert({
          workspace_id: "wrk_runtime",
          workflow_id: "sig",
          trigger_type: "signal",
          trigger_value: "incoming",
          enabled_at: 3_000,
        })

        expect(recreated.id).not.toBe(first.id)
        expect(recreated.enabled_at).toBe(3_000)
      },
    })
  })

  test("signal dedupe claim, link, and release are deterministic", async () => {
    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_runtime", dir.path)

        const trigger = RuntimeWorkflowTrigger.upsert({
          workspace_id: "wrk_runtime",
          workflow_id: "sig",
          trigger_type: "signal",
          trigger_value: "incoming",
          enabled_at: 1_000,
        })

        const first = RuntimeWorkflowSignalDedupe.claim({
          trigger_id: trigger.id,
          workspace_id: "wrk_runtime",
          workflow_id: "sig",
          dedupe_key: "evt_1",
          event_time: 2_000,
          payload_json: {
            ok: true,
          },
        })
        expect(first.duplicate).toBe(false)
        expect(first.row.first_run_id).toBeNull()

        const duplicate = RuntimeWorkflowSignalDedupe.claim({
          trigger_id: trigger.id,
          workspace_id: "wrk_runtime",
          workflow_id: "sig",
          dedupe_key: "evt_1",
          event_time: 2_000,
          payload_json: {
            ok: true,
          },
        })
        expect(duplicate.duplicate).toBe(true)
        expect(duplicate.row.id).toBe(first.row.id)

        const run_id = create_uuid_v7()
        RuntimeRun.create({
          id: run_id,
          status: "queued",
          trigger_type: "signal",
          workflow_id: "sig",
          workspace_id: "wrk_runtime",
        })
        const linked = RuntimeWorkflowSignalDedupe.link({
          id: first.row.id,
          first_run_id: run_id,
        })
        expect(linked.first_run_id).toBe(run_id)

        RuntimeWorkflowSignalDedupe.release({
          id: first.row.id,
        })

        const rows = Database.use((db) =>
          db
            .select()
            .from(WorkflowSignalDedupeTable)
            .where(
              and(
                eq(WorkflowSignalDedupeTable.trigger_id, trigger.id),
                eq(WorkflowSignalDedupeTable.dedupe_key, "evt_1"),
              ),
            )
            .all(),
        )
        expect(rows).toHaveLength(0)
      },
    })
  })
})
