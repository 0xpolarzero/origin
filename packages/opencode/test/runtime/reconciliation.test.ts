import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { RuntimeReconciliation } from "../../src/runtime/reconciliation"
import { RuntimeRun } from "../../src/runtime/run"
import { AuditEventTable } from "../../src/runtime/runtime.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function active(workspace_id: string) {
  const run = RuntimeRun.create({
    workspace_id,
    trigger_type: "manual",
  })
  RuntimeRun.transition({ id: run.id, to: "running" })
  RuntimeRun.transition({ id: run.id, to: "validating" })
  RuntimeRun.transition({ id: run.id, to: "ready_for_integration" })
  return RuntimeRun.transition({ id: run.id, to: "integrating" })
}

function set_started(run_id: string, occurred_at: number) {
  Database.use((db) => {
    const event = db
      .select()
      .from(AuditEventTable)
      .where(eq(AuditEventTable.run_id, run_id))
      .all()
      .find((item) => {
        if (item.event_type !== "run.transitioned") return false
        const payload = item.event_payload as { to?: unknown } | null
        return payload?.to === "integrating"
      })

    if (!event) throw new Error(`missing integrating event for ${run_id}`)

    db.update(AuditEventTable).set({ occurred_at }).where(eq(AuditEventTable.id, event.id)).run()
  })
}

function watchdog(run_id: string, kind: "notification" | "keep_running" | "hard_stop") {
  return Database.use((db) =>
    db
      .select()
      .from(AuditEventTable)
      .where(eq(AuditEventTable.run_id, run_id))
      .all()
      .filter((item) => item.event_type === "reconciliation.watchdog")
      .filter((item) => {
        const payload = item.event_payload as { event?: unknown } | null
        return payload?.event === kind
      }),
  )
}

function seed(workspace_id: string, directory: string) {
  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: workspace_id,
        project_id: Instance.project.id,
        branch: "main",
        type: "worktree",
        directory,
      })
      .onConflictDoNothing()
      .run()
  })
}

async function with_instance(workspace_id: string, fn: () => Promise<void> | void) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      seed(workspace_id, dir.path)
      await fn()
    },
  })
}

beforeEach(async () => {
  await resetDatabase()
  RuntimeReconciliation.Testing.reset()
})

afterEach(async () => {
  RuntimeReconciliation.Testing.reset()
  await resetDatabase()
})

describe("runtime reconciliation reminders", () => {
  test("poll emits reminders at threshold and cadence", async () => {
    await with_instance("wrk_reconciliation", async () => {
      const run = active("wrk_reconciliation")
      const started_at = 1_000
      let now = started_at + RuntimeReconciliation.threshold_ms - 1
      set_started(run.id, started_at)
      RuntimeReconciliation.Testing.set({
        now: () => now,
      })

      const before = await RuntimeReconciliation.poll()
      expect(before.items).toHaveLength(1)
      expect(before.items[0]?.notify).toBe(false)
      expect(watchdog(run.id, "notification")).toHaveLength(0)

      now = started_at + RuntimeReconciliation.threshold_ms
      const first = await RuntimeReconciliation.poll()
      expect(first.items[0]?.notify).toBe(true)
      expect(first.items[0]?.remaining_ms).toBe(
        RuntimeReconciliation.hard_stop_ms - RuntimeReconciliation.threshold_ms,
      )
      expect(watchdog(run.id, "notification")).toHaveLength(1)

      now = started_at + RuntimeReconciliation.threshold_ms + RuntimeReconciliation.cadence_ms - 1
      const quiet = await RuntimeReconciliation.poll()
      expect(quiet.items[0]?.notify).toBe(false)

      now = started_at + RuntimeReconciliation.threshold_ms + RuntimeReconciliation.cadence_ms
      const second = await RuntimeReconciliation.poll()
      expect(second.items[0]?.notify).toBe(true)
      expect(watchdog(run.id, "notification")).toHaveLength(2)
    })
  })

  test("keep running preserves the hard-stop deadline", () => {
    return with_instance("wrk_keep_running", () => {
      const run = active("wrk_keep_running")
      const started_at = 5_000
      set_started(run.id, started_at)

      const before = RuntimeReconciliation.progress(run.id, undefined, {
        at: started_at + RuntimeReconciliation.threshold_ms,
      })
      const current = RuntimeReconciliation.keepRunning(run.id)
      const after = RuntimeReconciliation.progress(run.id, undefined, {
        at: started_at + RuntimeReconciliation.threshold_ms + RuntimeReconciliation.cadence_ms,
      })

      expect(before?.hard_stop_at).toBe(started_at + RuntimeReconciliation.hard_stop_ms)
      expect(current?.hard_stop_at).toBe(before?.hard_stop_at)
      expect(after?.hard_stop_at).toBe(before?.hard_stop_at)
      expect(after?.last_keep_running_at).toBeTruthy()
      expect(after?.next_notification_at).toBe((after?.last_keep_running_at ?? 0) + RuntimeReconciliation.cadence_ms)

      const events = watchdog(run.id, "keep_running")
      expect(events).toHaveLength(1)
      expect(events[0]?.actor_type).toBe("user")
    })
  })

  test("terminal runs suppress stale reminders", async () => {
    await with_instance("wrk_terminal", async () => {
      const run = active("wrk_terminal")
      const started_at = 10_000
      set_started(run.id, started_at)
      RuntimeRun.transition({
        id: run.id,
        to: "failed",
        failure_code: "reconciliation_failed",
      })
      RuntimeReconciliation.Testing.set({
        now: () => started_at + RuntimeReconciliation.threshold_ms,
      })

      const page = await RuntimeReconciliation.poll()
      expect(page.items).toEqual([])
      expect(watchdog(run.id, "notification")).toHaveLength(0)
    })
  })
})
