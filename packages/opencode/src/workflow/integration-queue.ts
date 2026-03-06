import { Workspace } from "@/control-plane/workspace"
import { Instance } from "@/project/instance"
import { JJ } from "@/project/jj"
import { RuntimeAudit } from "@/runtime/audit"
import { terminal_run_statuses } from "@/runtime/contract"
import { RuntimeIllegalTransitionError } from "@/runtime/error"
import { RuntimeIntegrationAttempt } from "@/runtime/integration-attempt"
import { RuntimeOperation } from "@/runtime/operation"
import { RuntimeRun } from "@/runtime/run"
import { IntegrationAttemptTable, OperationTable, RunTable } from "@/runtime/runtime.sql"
import { Database, and, asc, eq, inArray, ne } from "@/storage/db"
import { Lock } from "@/util/lock"

const recovery_statuses = ["integrating", "reconciling", "cancel_requested"] as const
const lock_prefix = "integration:"
const poll_ms_default = 1_000
const timeout_ms_default = 60_000

type RunRow = ReturnType<typeof RuntimeRun.get>
type AttemptRow = typeof IntegrationAttemptTable.$inferSelect

type ProcessContext = {
  adapter: JJ.Adapter
  attempt: AttemptRow
  directory: string
  run: RunRow
  workspace_id: string
}

type ApplyInput = ProcessContext & {
  head_before: string | null
}

type ApplyResult = {
  head_after: string | null
}

type CrashInput = ProcessContext & {
  head_before: string | null
  head_after: string | null
}

type TimeoutInput = ProcessContext & {
  elapsed_ms: number
  timeout_ms: number
}

type Seams = {
  now?: () => number
  poll_ms?: number
  timeout_ms?: number
  head?: (input: ProcessContext) => Promise<string | null>
  apply?: (input: ApplyInput) => Promise<ApplyResult>
  update_stale?: (input: ProcessContext) => Promise<void>
  crash?: (input: CrashInput) => Promise<boolean> | boolean
  timeout?: (input: TimeoutInput) => Promise<boolean> | boolean
}

let override: Seams | undefined

const state = Instance.state(
  () => ({
    busy: false,
    draining: Promise.resolve() as Promise<void>,
    ensured: false,
    pending: false,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
  }),
  async (value) => {
    if (!value.timer) return
    clearInterval(value.timer)
  },
)

function seams() {
  if (override) return override
  return {}
}

function now() {
  return (seams().now ?? Date.now)()
}

function timeout_ms() {
  return seams().timeout_ms ?? timeout_ms_default
}

function poll_ms() {
  return seams().poll_ms ?? poll_ms_default
}

function key(workspace_id: string) {
  return `${lock_prefix}${workspace_id}`
}

function is_recovery(status: string) {
  return status === "integrating" || status === "reconciling" || status === "cancel_requested"
}

function is_candidate(status: string) {
  if (status === "ready_for_integration") return true
  return is_recovery(status)
}

function no_op(row: RunRow, actor_type: "system" | "user") {
  RuntimeAudit.write({
    event_type: "run.transitioned",
    actor_type,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    run_id: row.id,
    event_payload: {
      from: row.status,
      to: row.status,
    },
  })
}

function settle(input: {
  id: string
  to: "completed" | "canceled" | "failed"
  failure_code?: "reconciliation_failed" | "reconciliation_timeout" | "stale_base_replay_exhausted"
  actor_type?: "system" | "user"
  race?: boolean
}) {
  const actor_type = input.actor_type ?? "system"
  const row = RuntimeRun.get({ id: input.id })
  if (terminal_run_statuses.has(row.status)) {
    if (input.race) no_op(row, actor_type)
    return row
  }

  try {
    return RuntimeRun.transition({
      id: input.id,
      to: input.to,
      failure_code: input.failure_code,
      actor_type,
    })
  } catch (error) {
    if (!(error instanceof RuntimeIllegalTransitionError)) throw error
    const current = RuntimeRun.get({ id: input.id })
    if (!terminal_run_statuses.has(current.status)) throw error
    if (input.race) no_op(current, actor_type)
    return current
  }
}

function timeout_watchdog(row: RunRow, elapsed: number, hard_stop_ms: number) {
  RuntimeAudit.write({
    event_type: "reconciliation.watchdog",
    actor_type: "system",
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    run_id: row.id,
    event_payload: {
      event: "hard_stop",
      elapsed_ms: elapsed,
      threshold_ms: hard_stop_ms,
      hard_stop_ms,
    },
  })
}

function queue_heads() {
  return Database.use((db) => {
    const recovering = db
      .select()
      .from(RunTable)
      .where(inArray(RunTable.status, [...recovery_statuses]))
      .orderBy(asc(RunTable.ready_for_integration_at), asc(RunTable.id))
      .all()

    const ready = db
      .select()
      .from(RunTable)
      .where(eq(RunTable.status, "ready_for_integration"))
      .orderBy(asc(RunTable.ready_for_integration_at), asc(RunTable.id))
      .all()

    const out = [] as typeof RunTable.$inferSelect[]
    const taken = new Set<string>()

    for (const row of recovering) {
      if (taken.has(row.workspace_id)) continue
      out.push(row)
      taken.add(row.workspace_id)
    }

    for (const row of ready) {
      if (taken.has(row.workspace_id)) continue
      out.push(row)
      taken.add(row.workspace_id)
    }

    return out
  })
}

function attempt_for_run(run_id: string) {
  return Database.use((db) => {
    const rows = db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.run_id, run_id)).all()
    return rows.toSorted((a, b) => {
      if (a.created_at !== b.created_at) return b.created_at - a.created_at
      return b.id.localeCompare(a.id)
    })[0]
  })
}

function operation_for_attempt(integration_attempt_id: string) {
  return Database.use((db) =>
    db.select().from(OperationTable).where(eq(OperationTable.integration_attempt_id, integration_attempt_id)).get(),
  )
}

function claim_ready(run_id: string) {
  return Database.transaction((db) => {
    const row = db.select().from(RunTable).where(eq(RunTable.id, run_id)).get()
    if (!row) return
    if (row.status !== "ready_for_integration") return

    const active = db
      .select({ id: RunTable.id })
      .from(RunTable)
      .where(
        and(
          eq(RunTable.workspace_id, row.workspace_id),
          inArray(RunTable.status, [...recovery_statuses]),
          ne(RunTable.id, row.id),
        ),
      )
      .get()

    if (active) return

    return RuntimeRun.transition({
      id: row.id,
      to: "integrating",
    })
  })
}

async function head_default(input: ProcessContext) {
  const result = await input.adapter.read(["show", "-r", "@", "-T", "change_id"], input.directory)
  if (!result.ok) throw new Error(`integration head read failed: ${result.stderr || result.exit_code}`)

  const value = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (value) return value
  return null
}

async function apply_default(input: ApplyInput): Promise<ApplyResult> {
  const ids = input.run.integration_candidate_change_ids ?? []
  for (const id of ids) {
    const result = await input.adapter.mutate(["cherry-pick", id], input.directory)
    if (result.ok) continue
    throw new Error(`integration apply failed: ${result.stderr || result.exit_code}`)
  }

  const head_after = await head_default(input)
  return {
    head_after,
  }
}

async function update_stale_default(input: ProcessContext) {
  const result = await input.adapter.mutate(["workspace", "update-stale"], input.directory)
  if (result.ok) return
  throw new Error(`integration stale update failed: ${result.stderr || result.exit_code}`)
}

function finish(run_id: string, committed: boolean) {
  const row = RuntimeRun.get({ id: run_id })
  if (terminal_run_statuses.has(row.status)) return row

  if (row.status === "cancel_requested") {
    if (committed) {
      return settle({
        id: row.id,
        to: "completed",
      })
    }

    return settle({
      id: row.id,
      to: "canceled",
    })
  }

  if (committed) {
    return settle({
      id: row.id,
      to: "completed",
    })
  }

  return row
}

function link(input: {
  attempt: AttemptRow
  head_after: string | null
  head_before: string | null
  run: RunRow
}) {
  const existing = operation_for_attempt(input.attempt.id)
  if (existing) return existing

  return RuntimeOperation.create({
    run_id: input.run.id,
    workspace_id: input.run.workspace_id,
    status: "completed",
    trigger_type: input.run.trigger_type,
    workflow_id: input.run.workflow_id,
    session_id: input.run.session_id,
    integration_attempt_id: input.attempt.id,
    ready_for_integration_at: input.run.ready_for_integration_at,
    jj_base_change_id: input.run.integration_candidate_base_change_id,
    jj_result_change_ids: input.run.integration_candidate_change_ids ?? [],
    changed_paths: input.run.integration_candidate_changed_paths ?? [],
    integration_head_change_id_before_apply: input.head_before,
    integration_head_change_id_after_apply: input.head_after,
  })
}

function finalize_attempt(input: {
  attempt: AttemptRow
  head_after: string | null
  head_before: string | null
  run: RunRow
}) {
  Database.transaction((db) => {
    const op = db.select().from(OperationTable).where(eq(OperationTable.integration_attempt_id, input.attempt.id)).get()
    if (!op) {
      RuntimeOperation.create({
        run_id: input.run.id,
        workspace_id: input.run.workspace_id,
        status: "completed",
        trigger_type: input.run.trigger_type,
        workflow_id: input.run.workflow_id,
        session_id: input.run.session_id,
        integration_attempt_id: input.attempt.id,
        ready_for_integration_at: input.run.ready_for_integration_at,
        jj_base_change_id: input.run.integration_candidate_base_change_id,
        jj_result_change_ids: input.run.integration_candidate_change_ids ?? [],
        changed_paths: input.run.integration_candidate_changed_paths ?? [],
        integration_head_change_id_before_apply: input.head_before,
        integration_head_change_id_after_apply: input.head_after,
      })
    }

    const current = db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.id, input.attempt.id)).get()
    if (!current) return

    if (current.state === "jj_applied") {
      RuntimeIntegrationAttempt.transition({
        id: current.id,
        to: "db_linked",
      })
    }

    const linked = db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.id, input.attempt.id)).get()
    if (!linked) return

    if (linked.state === "db_linked") {
      RuntimeIntegrationAttempt.transition({
        id: linked.id,
        to: "finalized",
      })
    }
  })
}

async function replay(input: ProcessContext) {
  const current = RuntimeRun.get({ id: input.run.id })
  if (current.status === "cancel_requested") {
    finish(current.id, false)
    return false
  }

  if (input.attempt.replay_index > 0) {
    settle({
      id: input.run.id,
      to: "failed",
      failure_code: "stale_base_replay_exhausted",
      race: true,
    })
    return false
  }

  if (current.status === "integrating") {
    RuntimeRun.transition({
      id: current.id,
      to: "reconciling",
    })
  }

  const update_stale = seams().update_stale ?? update_stale_default
  await update_stale({
    adapter: input.adapter,
    attempt: input.attempt,
    directory: input.directory,
    run: RuntimeRun.get({ id: input.run.id }),
    workspace_id: input.workspace_id,
  })

  RuntimeIntegrationAttempt.replay({
    id: input.attempt.id,
    from: input.attempt.replay_index,
    to: input.attempt.replay_index + 1,
  })

  const row = RuntimeRun.get({ id: input.run.id })
  if (row.status === "cancel_requested") {
    finish(row.id, false)
    return false
  }

  if (row.status === "reconciling") {
    RuntimeRun.transition({
      id: row.id,
      to: "integrating",
    })
    return true
  }

  if (row.status === "integrating") return true
  if (terminal_run_statuses.has(row.status)) return false

  throw new RuntimeIllegalTransitionError({
    entity: "run",
    from: row.status,
    to: "integrating",
    code: "illegal_transition",
  })
}

async function process_run(run_id: string, workspace_id: string) {
  const workspace = await Workspace.get(workspace_id)
  if (!workspace) {
    settle({
      id: run_id,
      to: "failed",
      failure_code: "reconciliation_failed",
      race: true,
    })
    return
  }
  if (workspace.config.type !== "worktree") {
    settle({
      id: run_id,
      to: "failed",
      failure_code: "reconciliation_failed",
      race: true,
    })
    return
  }

  const started = now()
  const directory = workspace.config.directory
  const adapter = JJ.create({ cwd: directory })

  while (true) {
    const run = RuntimeRun.get({ id: run_id })
    if (terminal_run_statuses.has(run.status)) return

    let attempt = attempt_for_run(run.id)
    if (!attempt) {
      attempt = RuntimeIntegrationAttempt.create({
        run_id: run.id,
        workspace_id: run.workspace_id,
      })
    }

    const elapsed = now() - started
    const hard_stop_ms = timeout_ms()
    const timeout = seams().timeout
    const timed_out = timeout
      ? await timeout({
          adapter,
          attempt,
          directory,
          run,
          workspace_id,
          elapsed_ms: elapsed,
          timeout_ms: hard_stop_ms,
        })
      : elapsed >= hard_stop_ms

    if (timed_out) {
      timeout_watchdog(run, elapsed, hard_stop_ms)
      settle({
        id: run.id,
        to: "failed",
        failure_code: "reconciliation_timeout",
        race: true,
      })
      return
    }

    if (attempt.state === "db_linked") {
      RuntimeIntegrationAttempt.transition({
        id: attempt.id,
        to: "finalized",
      })
      finish(run.id, true)
      return
    }

    if (attempt.state === "finalized") {
      finish(run.id, true)
      return
    }

    if (attempt.state === "jj_applied") {
      const head = seams().head ?? head_default
      const head_after = await head({
        adapter,
        attempt,
        directory,
        run,
        workspace_id,
      })

      finalize_attempt({
        attempt,
        head_before: run.integration_candidate_base_change_id,
        head_after,
        run,
      })

      finish(run.id, true)
      return
    }

    if (run.status === "cancel_requested") {
      finish(run.id, false)
      return
    }

    const head = seams().head ?? head_default
    const head_before = await head({
      adapter,
      attempt,
      directory,
      run,
      workspace_id,
    })

    const stale_base = run.integration_candidate_base_change_id
      ? run.integration_candidate_base_change_id !== head_before
      : false

    if (stale_base) {
      const replayed = await replay({
        adapter,
        attempt,
        directory,
        run,
        workspace_id,
      })
      if (replayed) continue
      return
    }

    const apply = seams().apply ?? apply_default
    const applied = await apply({
      adapter,
      attempt,
      directory,
      run,
      workspace_id,
      head_before,
    })

    const next = RuntimeIntegrationAttempt.transition({
      id: attempt.id,
      to: "jj_applied",
    })

    const crash = seams().crash
    if (crash) {
      const crashed = await crash({
        adapter,
        attempt: next,
        directory,
        run,
        workspace_id,
        head_before,
        head_after: applied.head_after,
      })
      if (crashed) return
    }

    link({
      attempt: next,
      head_before,
      head_after: applied.head_after,
      run,
    })

    RuntimeIntegrationAttempt.transition({
      id: next.id,
      to: "db_linked",
    })

    RuntimeIntegrationAttempt.transition({
      id: next.id,
      to: "finalized",
    })

    finish(run.id, true)
    return
  }
}

async function process_item(input: {
  id: string
  workspace_id: string
}) {
  await using _ = await Lock.write(key(input.workspace_id))

  const row = RuntimeRun.get({ id: input.id })
  if (!is_candidate(row.status)) return

  if (row.status === "ready_for_integration") {
    try {
      const claimed = claim_ready(row.id)
      if (!claimed) return
    } catch (error) {
      if (!(error instanceof RuntimeIllegalTransitionError)) throw error
      return
    }
  }

  try {
    await process_run(row.id, row.workspace_id)
  } catch {
    settle({
      id: row.id,
      to: "failed",
      failure_code: "reconciliation_failed",
      race: true,
    })
  }
}

async function cycle() {
  const rows = queue_heads()
  if (rows.length === 0) return

  await Promise.all(
    rows.map((row) =>
      process_item({
        id: row.id,
        workspace_id: row.workspace_id,
      }),
    ),
  )
}

export namespace WorkflowIntegrationQueue {
  export const Testing = {
    set(input?: Seams) {
      override = input
    },
    reset() {
      override = undefined
      try {
        const entry = state()
        if (entry.timer) clearInterval(entry.timer)
        entry.timer = undefined
        entry.ensured = false
        entry.pending = false
      } catch {}
    },
    async drain(input?: { timeout_ms?: number }) {
      await touch()
      const wait = input?.timeout_ms ?? 3_000
      const start = Date.now()

      while (state().busy) {
        if (Date.now() - start > wait) throw new Error("integration queue drain timeout")
        await state().draining
      }
    },
  }

  export async function start() {
    const entry = state()
    if (!entry.timer) {
      const timer = setInterval(() => {
        void touch()
      }, poll_ms())
      timer.unref()
      entry.timer = timer
    }

    entry.ensured = true
    await touch()
  }

  export async function ensure() {
    return start()
  }

  export async function touch() {
    const entry = state()
    entry.pending = true
    if (entry.busy) return entry.draining

    entry.busy = true
    entry.draining = (async () => {
      while (entry.pending) {
        entry.pending = false
        await cycle()
      }
    })().finally(() => {
      entry.busy = false
    })

    return entry.draining
  }
}
