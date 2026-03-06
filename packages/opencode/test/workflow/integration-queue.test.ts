import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { RuntimeIntegrationAttempt } from "../../src/runtime/integration-attempt"
import { RuntimeOperation } from "../../src/runtime/operation"
import { RuntimeRun } from "../../src/runtime/run"
import { AuditEventTable, IntegrationAttemptTable, OperationTable, RunTable } from "../../src/runtime/runtime.sql"
import { Database, and, eq } from "../../src/storage/db"
import { WorkflowIntegrationQueue } from "../../src/workflow/integration-queue"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const cancel_reason = "cancel_requested_after_integration_started"

function defer<T>() {
  let resolve = (_value: T | PromiseLike<T>) => {}
  let reject = (_reason?: unknown) => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve,
    reject,
  }
}

async function seed(workspace_ids: string[]) {
  await Promise.all(
    workspace_ids.map(async (id) => {
      const directory = path.join(Instance.directory, ".origin", "integration", id)
      await mkdir(directory, { recursive: true })
      Database.use((db) => {
        db.insert(WorkspaceTable)
          .values({
            id,
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
    }),
  )
}

function ready(
  workspace_id: string,
  input?: {
    id?: string
    mark?: number
    base?: string
    changes?: string[]
    paths?: string[]
  },
) {
  const run = RuntimeRun.create({
    id: input?.id,
    workspace_id,
    trigger_type: "manual",
    integration_candidate_base_change_id: input?.base ?? `base_${workspace_id}`,
    integration_candidate_change_ids: input?.changes ?? ["change_a"],
    integration_candidate_changed_paths: input?.paths ?? ["src/main.ts"],
  })

  RuntimeRun.transition({ id: run.id, to: "running" })
  RuntimeRun.transition({ id: run.id, to: "validating" })

  if (typeof input?.mark === "number") {
    Database.use((db) => {
      db.update(RunTable)
        .set({ ready_for_integration_at: input.mark })
        .where(eq(RunTable.id, run.id))
        .run()
    })
  }

  return RuntimeRun.transition({ id: run.id, to: "ready_for_integration" })
}

function integrating(
  workspace_id: string,
  input?: {
    id?: string
    mark?: number
    base?: string
    changes?: string[]
    paths?: string[]
  },
) {
  const run = ready(workspace_id, input)
  return RuntimeRun.transition({ id: run.id, to: "integrating" })
}

function operation(run: ReturnType<typeof RuntimeRun.get>, integration_attempt_id: string) {
  return RuntimeOperation.create({
    run_id: run.id,
    workspace_id: run.workspace_id,
    trigger_type: run.trigger_type,
    workflow_id: run.workflow_id,
    session_id: run.session_id,
    integration_attempt_id,
    ready_for_integration_at: run.ready_for_integration_at,
    jj_base_change_id: run.integration_candidate_base_change_id,
    jj_result_change_ids: run.integration_candidate_change_ids ?? [],
    changed_paths: run.integration_candidate_changed_paths ?? [],
    integration_head_change_id_before_apply: run.integration_candidate_base_change_id,
    integration_head_change_id_after_apply: "head_after",
  })
}

function transitions(run_id: string) {
  return Database.use((db) =>
    db
      .select()
      .from(AuditEventTable)
      .where(eq(AuditEventTable.run_id, run_id))
      .all()
      .filter((item) => item.event_type === "run.transitioned")
      .map((item) => item.event_payload as { from: string; to: string }),
  )
}

async function wait_status(run_id: string, status: string, input?: { timeout_ms?: number }) {
  const timeout_ms = input?.timeout_ms ?? 5_000
  const started = Date.now()

  while (true) {
    const row = RuntimeRun.get({ id: run_id })
    if (row.status === status) return row
    if (Date.now() - started > timeout_ms) throw new Error(`timed out waiting for ${run_id} status=${status}`)
    await Bun.sleep(20)
  }
}

async function with_instance(workspace_ids: string[], fn: () => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      await seed(workspace_ids)
      WorkflowIntegrationQueue.Testing.reset()
      try {
        await fn()
      } finally {
        WorkflowIntegrationQueue.Testing.reset()
      }
    },
  })
}

beforeEach(async () => {
  await resetDatabase()
  WorkflowIntegrationQueue.Testing.reset()
})

afterEach(async () => {
  WorkflowIntegrationQueue.Testing.reset()
  await resetDatabase()
})

describe("workflow integration queue and recovery semantics", () => {
  test("AC-01: queue ordering remains immutable across retries/restarts", async () => {
    await with_instance(["wrk_queue_order"], async () => {
      const first = ready("wrk_queue_order", {
        id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e1",
        mark: 1_000,
      })
      const second = ready("wrk_queue_order", {
        id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e2",
        mark: 1_000,
      })
      const third = ready("wrk_queue_order", {
        id: "018f3c19-89f7-7b87-b72f-0ef4f34a53e3",
        mark: 2_000,
      })

      const seen: string[] = []
      const seams = {
        head: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => run.integration_candidate_base_change_id,
        apply: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => {
          seen.push(run.id)
          return { head_after: `head_${run.id}` }
        },
      }

      WorkflowIntegrationQueue.Testing.set(seams)
      await WorkflowIntegrationQueue.touch()
      expect(seen).toEqual([first.id])

      Database.close()
      WorkflowIntegrationQueue.Testing.reset()
      WorkflowIntegrationQueue.Testing.set(seams)

      await WorkflowIntegrationQueue.touch()
      await WorkflowIntegrationQueue.touch()

      expect(seen).toEqual([first.id, second.id, third.id])

      expect(() =>
        Database.use((db) =>
          db
            .update(RunTable)
            .set({ ready_for_integration_at: 5_000 })
            .where(eq(RunTable.id, second.id))
            .run(),
        ),
      ).toThrow("run.ready_for_integration_at is immutable once set")
    })
  })

  test("AC-02: only one integrating run per workspace is active at a time", async () => {
    await with_instance(["wrk_serial"], async () => {
      const first = ready("wrk_serial", { mark: 1_000 })
      const second = ready("wrk_serial", { mark: 2_000 })
      const entered = defer<void>()
      const release = defer<void>()
      let second_apply = 0

      WorkflowIntegrationQueue.Testing.set({
        head: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => run.integration_candidate_base_change_id,
        apply: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => {
          if (run.id === first.id) {
            entered.resolve()
            await release.promise
            return { head_after: "head_first" }
          }
          if (run.id === second.id) second_apply += 1
          return { head_after: "head_second" }
        },
      })

      const processing = WorkflowIntegrationQueue.touch()
      await entered.promise

      const active = Database.use((db) =>
        db
          .select()
          .from(RunTable)
          .where(and(eq(RunTable.workspace_id, "wrk_serial"), eq(RunTable.status, "integrating")))
          .all(),
      )
      expect(active).toHaveLength(1)
      expect(active[0]?.id).toBe(first.id)
      expect(RuntimeRun.get({ id: second.id }).status).toBe("ready_for_integration")

      release.resolve()
      await processing
      expect(second_apply).toBe(0)

      await WorkflowIntegrationQueue.touch()
      expect(second_apply).toBe(1)
      expect(RuntimeRun.get({ id: first.id }).status).toBe("completed")
      expect(RuntimeRun.get({ id: second.id }).status).toBe("completed")
    })
  })

  test("AC-03: crash after JJ mutation before DB finalize does not double-apply", async () => {
    await with_instance(["wrk_crash"], async () => {
      const run = ready("wrk_crash", { mark: 1_000 })
      let apply_count = 0
      let should_crash = true

      WorkflowIntegrationQueue.Testing.set({
        head: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => run.integration_candidate_base_change_id,
        apply: async () => {
          apply_count += 1
          return { head_after: "head_after" }
        },
        crash: async () => {
          if (!should_crash) return false
          should_crash = false
          return true
        },
      })

      await WorkflowIntegrationQueue.touch()

      const after_crash = RuntimeRun.get({ id: run.id })
      expect(after_crash.status).toBe("integrating")
      const attempt = Database.use((db) =>
        db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.run_id, run.id)).get(),
      )
      expect(attempt?.state).toBe("jj_applied")
      const before_recovery_ops = Database.use((db) => db.select().from(OperationTable).where(eq(OperationTable.run_id, run.id)).all())
      expect(before_recovery_ops).toHaveLength(0)

      WorkflowIntegrationQueue.Testing.reset()
      WorkflowIntegrationQueue.Testing.set({
        head: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => run.integration_candidate_base_change_id,
        apply: async () => {
          apply_count += 1
          return { head_after: "head_after" }
        },
        crash: async () => false,
      })
      await WorkflowIntegrationQueue.start()
      await WorkflowIntegrationQueue.Testing.drain({ timeout_ms: 5_000 })

      const done = RuntimeRun.get({ id: run.id })
      expect(done.status).toBe("completed")
      expect(apply_count).toBe(1)
      const finalized = Database.use((db) =>
        db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.run_id, run.id)).get(),
      )
      expect(finalized?.state).toBe("finalized")
      const rows = Database.use((db) => db.select().from(OperationTable).where(eq(OperationTable.run_id, run.id)).all())
      expect(rows).toHaveLength(1)
      if (!finalized) throw new Error("missing finalized integration attempt")
      expect(rows[0]?.integration_attempt_id).toBe(finalized.id)
    })
  })

  test("AC-04: stale-base replay occurs at most once", async () => {
    await with_instance(["wrk_stale"], async () => {
      const run = ready("wrk_stale", {
        mark: 1_000,
        base: "base_expected",
      })
      let stale_updates = 0

      WorkflowIntegrationQueue.Testing.set({
        head: async () => "base_drifted",
        update_stale: async () => {
          stale_updates += 1
        },
        apply: async () => {
          throw new Error("apply must not execute after replay exhaustion")
        },
      })

      await WorkflowIntegrationQueue.touch()

      const failed = RuntimeRun.get({ id: run.id })
      expect(failed.status).toBe("failed")
      expect(failed.failure_code).toBe("stale_base_replay_exhausted")
      expect(stale_updates).toBe(1)

      const attempt = Database.use((db) =>
        db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.run_id, run.id)).get(),
      )
      expect(attempt?.replay_index).toBe(1)
      const rows = Database.use((db) => db.select().from(OperationTable).where(eq(OperationTable.run_id, run.id)).all())
      expect(rows).toHaveLength(0)

      const edges = transitions(run.id).map((item) => `${item.from}->${item.to}`)
      expect(edges).toContain("integrating->reconciling")
      expect(edges).toContain("reconciling->integrating")
      expect(edges).toContain("integrating->failed")
    })
  })

  test("AC-05: cancel during integration resolves deterministically for committed vs uncommitted runs", async () => {
    await with_instance(["wrk_cancel"], async () => {
      const committed = integrating("wrk_cancel", { mark: 1_000 })
      const committed_attempt = RuntimeIntegrationAttempt.create({
        run_id: committed.id,
        workspace_id: committed.workspace_id,
      })
      RuntimeIntegrationAttempt.transition({ id: committed_attempt.id, to: "jj_applied" })
      operation(committed, committed_attempt.id)
      RuntimeRun.transition({
        id: committed.id,
        to: "cancel_requested",
        reason_code: cancel_reason,
      })

      const uncommitted = integrating("wrk_cancel", { mark: 2_000 })
      RuntimeRun.transition({
        id: uncommitted.id,
        to: "cancel_requested",
        reason_code: cancel_reason,
      })

      WorkflowIntegrationQueue.Testing.set({
        head: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => run.integration_candidate_base_change_id,
        apply: async () => {
          throw new Error("apply should not run for cancel_requested runs")
        },
      })

      await WorkflowIntegrationQueue.touch()
      await WorkflowIntegrationQueue.touch()

      const committed_done = RuntimeRun.get({ id: committed.id })
      const uncommitted_done = RuntimeRun.get({ id: uncommitted.id })
      expect(committed_done.status).toBe("completed")
      expect(committed_done.reason_code).toBe(cancel_reason)
      expect(uncommitted_done.status).toBe("canceled")
      expect(uncommitted_done.reason_code).toBe(cancel_reason)
    })
  })

  test("AC-06: same-workspace runs stay serialized while cross-workspace runs progress in parallel", async () => {
    await with_instance(["wrk_parallel_a", "wrk_parallel_b"], async () => {
      const a1 = ready("wrk_parallel_a", { mark: 1_000 })
      const a2 = ready("wrk_parallel_a", { mark: 2_000 })
      const b1 = ready("wrk_parallel_b", { mark: 1_000 })
      const entered_a1 = defer<void>()
      const entered_b1 = defer<void>()
      const release = defer<void>()
      const events: string[] = []

      WorkflowIntegrationQueue.Testing.set({
        head: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => run.integration_candidate_base_change_id,
        apply: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => {
          if (run.id === a1.id) {
            events.push("a1:start")
            entered_a1.resolve()
            await release.promise
            events.push("a1:end")
            return { head_after: "head_a1" }
          }

          if (run.id === b1.id) {
            events.push("b1:start")
            entered_b1.resolve()
            await release.promise
            events.push("b1:end")
            return { head_after: "head_b1" }
          }

          events.push("a2:start")
          return { head_after: "head_a2" }
        },
      })

      const running = WorkflowIntegrationQueue.touch()
      await Promise.all([entered_a1.promise, entered_b1.promise])

      const a_active = Database.use((db) =>
        db
          .select()
          .from(RunTable)
          .where(and(eq(RunTable.workspace_id, "wrk_parallel_a"), eq(RunTable.status, "integrating")))
          .all(),
      )
      const b_active = Database.use((db) =>
        db
          .select()
          .from(RunTable)
          .where(and(eq(RunTable.workspace_id, "wrk_parallel_b"), eq(RunTable.status, "integrating")))
          .all(),
      )
      expect(a_active).toHaveLength(1)
      expect(a_active[0]?.id).toBe(a1.id)
      expect(b_active).toHaveLength(1)
      expect(b_active[0]?.id).toBe(b1.id)
      expect(RuntimeRun.get({ id: a2.id }).status).toBe("ready_for_integration")

      release.resolve()
      await running
      await WorkflowIntegrationQueue.touch()

      expect(RuntimeRun.get({ id: a1.id }).status).toBe("completed")
      expect(RuntimeRun.get({ id: b1.id }).status).toBe("completed")
      expect(RuntimeRun.get({ id: a2.id }).status).toBe("completed")
      expect(events.indexOf("a2:start")).toBeGreaterThan(events.indexOf("a1:end"))
    })
  })

  test("AC-07: startup recovers stale/incomplete integration state deterministically", async () => {
    await with_instance(["wrk_recovery"], async () => {
      const stale = integrating("wrk_recovery", { mark: 1_000 })
      const recovery_attempt = RuntimeIntegrationAttempt.create({
        run_id: stale.id,
        workspace_id: stale.workspace_id,
      })
      RuntimeIntegrationAttempt.transition({ id: recovery_attempt.id, to: "jj_applied" })
      RuntimeIntegrationAttempt.transition({ id: recovery_attempt.id, to: "db_linked" })
      operation(stale, recovery_attempt.id)

      const queued = ready("wrk_recovery", { mark: 2_000 })
      let checked = false

      WorkflowIntegrationQueue.Testing.set({
        poll_ms: 20,
        head: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => run.integration_candidate_base_change_id,
        apply: async ({ run }: { run: ReturnType<typeof RuntimeRun.get> }) => {
          if (run.id === queued.id) checked = RuntimeRun.get({ id: stale.id }).status === "completed"
          return { head_after: `head_${run.id}` }
        },
      })

      await WorkflowIntegrationQueue.start()
      await wait_status(stale.id, "completed")
      await wait_status(queued.id, "completed")

      expect(checked).toBe(true)
      const attempt = Database.use((db) =>
        db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.id, recovery_attempt.id)).get(),
      )
      expect(attempt?.state).toBe("finalized")
    })
  })

  test("AC-08: cancel-timeout race resolves to one terminal state and records losing event as no-op", async () => {
    await with_instance(["wrk_race"], async () => {
      const run = integrating("wrk_race", { mark: 1_000 })
      const reached = defer<void>()
      const release = defer<void>()

      WorkflowIntegrationQueue.Testing.set({
        timeout: async ({ run: row }: { run: ReturnType<typeof RuntimeRun.get> }) => {
          if (row.id !== run.id) return false
          reached.resolve()
          await release.promise
          return true
        },
      })

      const race = WorkflowIntegrationQueue.touch()
      await reached.promise

      RuntimeRun.transition({
        id: run.id,
        to: "cancel_requested",
        reason_code: cancel_reason,
      })
      RuntimeRun.transition({
        id: run.id,
        to: "canceled",
      })

      release.resolve()
      await race

      const final = RuntimeRun.get({ id: run.id })
      expect(final.status).toBe("canceled")

      const terminal = new Set(["completed", "completed_no_change", "failed", "canceled", "skipped"])
      const events = transitions(run.id)
      const winning = events.filter((item) => item.from !== item.to && terminal.has(item.to))
      expect(winning).toHaveLength(1)
      expect(winning[0]?.to).toBe("canceled")
      expect(events.some((item) => item.from === "canceled" && item.to === "canceled")).toBe(true)
    })
  })
})
