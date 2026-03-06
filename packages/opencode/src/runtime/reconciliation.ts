import { Lock } from "@/util/lock"
import { RuntimeAudit } from "./audit"
import { AuditEventTable, RunTable } from "./runtime.sql"
import { Database, and, desc, eq, inArray } from "@/storage/db"
import { uuid_v7 } from "./uuid"
import z from "zod"

const threshold_ms_default = 15 * 60 * 1000
const cadence_ms_default = 10 * 60 * 1000
const hard_stop_ms_default = 45 * 60 * 1000

const active_statuses = ["integrating", "reconciling", "cancel_requested"] as const
const terminal_failure_codes = new Set(["reconciliation_failed", "reconciliation_timeout", "stale_base_replay_exhausted"])

const settings = z
  .object({
    threshold_ms: z.number().int().positive(),
    cadence_ms: z.number().int().positive(),
    hard_stop_ms: z.number().int().positive(),
  })
  .refine((value) => value.hard_stop_ms > value.threshold_ms, {
    message: "hard_stop_ms must be greater than threshold_ms",
    path: ["hard_stop_ms"],
  })
  .strict()

const reminder_item = z
  .object({
    run_id: uuid_v7,
    session_id: z.string().nullable(),
    workspace_id: z.string(),
    workflow_id: z.string().nullable(),
    status: z.enum(active_statuses),
    trigger_type: z.string(),
    started_at: z.number().int().nonnegative(),
    threshold_ms: z.number().int().positive(),
    cadence_ms: z.number().int().positive(),
    hard_stop_ms: z.number().int().positive(),
    threshold_at: z.number().int().nonnegative(),
    hard_stop_at: z.number().int().nonnegative(),
    next_notification_at: z.number().int().nonnegative(),
    last_notification_at: z.number().int().nonnegative().nullable(),
    last_keep_running_at: z.number().int().nonnegative().nullable(),
    elapsed_ms: z.number().int().nonnegative(),
    remaining_ms: z.number().int().nonnegative(),
    notify: z.boolean(),
  })
  .strict()

const reminder_page = z
  .object({
    generated_at: z.number().int().nonnegative(),
    items: z.array(reminder_item),
  })
  .strict()

type RunRow = typeof RunTable.$inferSelect
type Tx = Database.TxOrDb

let now = () => Date.now()

function current_settings(input?: Partial<z.output<typeof settings>>) {
  return settings.parse({
    threshold_ms: input?.threshold_ms ?? threshold_ms_default,
    cadence_ms: input?.cadence_ms ?? cadence_ms_default,
    hard_stop_ms: input?.hard_stop_ms ?? hard_stop_ms_default,
  })
}

function active(row: Pick<RunRow, "status">) {
  return row.status === "integrating" || row.status === "reconciling" || row.status === "cancel_requested"
}

function debug(row: Pick<RunRow, "trigger_type" | "status" | "failure_code">) {
  if (row.trigger_type === "debug") return true
  if (active(row)) return true
  if (!row.failure_code) return false
  return terminal_failure_codes.has(row.failure_code)
}

function transition_events(db: Tx, run_id: string) {
  return db
    .select()
    .from(AuditEventTable)
    .where(and(eq(AuditEventTable.run_id, run_id), eq(AuditEventTable.event_type, "run.transitioned")))
    .orderBy(AuditEventTable.occurred_at, AuditEventTable.id)
    .all()
}

function watchdog_events(db: Tx, run_id: string) {
  return db
    .select()
    .from(AuditEventTable)
    .where(and(eq(AuditEventTable.run_id, run_id), eq(AuditEventTable.event_type, "reconciliation.watchdog")))
    .orderBy(desc(AuditEventTable.occurred_at), desc(AuditEventTable.id))
    .all()
}

function integrating_at(db: Tx, row: RunRow) {
  const match = transition_events(db, row.id).find((event) => {
    const payload = event.event_payload as { to?: unknown } | null
    const to = typeof payload?.to === "string" ? payload.to : undefined
    return to === "integrating" || to === "reconciling"
  })
  if (match) return match.occurred_at
  return row.ready_for_integration_at ?? row.updated_at
}

function reminder_times(db: Tx, row: RunRow) {
  const events = watchdog_events(db, row.id)
  let last_notification_at: number | null = null
  let last_keep_running_at: number | null = null

  for (const event of events) {
    const payload = event.event_payload as { event?: unknown } | null
    const kind = typeof payload?.event === "string" ? payload.event : undefined
    if (kind === "notification" && last_notification_at === null) last_notification_at = event.occurred_at
    if (kind === "keep_running" && last_keep_running_at === null) last_keep_running_at = event.occurred_at
    if (last_notification_at !== null && last_keep_running_at !== null) break
  }

  return {
    last_notification_at,
    last_keep_running_at,
  }
}

function item(db: Tx, row: RunRow, input?: { notify?: boolean; at?: number; settings?: Partial<z.output<typeof settings>> }) {
  if (!active(row)) return

  const cfg = current_settings(input?.settings)
  const started_at = integrating_at(db, row)
  const threshold_at = started_at + cfg.threshold_ms
  const hard_stop_at = started_at + cfg.hard_stop_ms
  const elapsed_ms = Math.max(0, (input?.at ?? now()) - started_at)
  const remaining_ms = Math.max(0, hard_stop_at - (input?.at ?? now()))
  const times = reminder_times(db, row)
  const anchor = Math.max(times.last_notification_at ?? 0, times.last_keep_running_at ?? 0)
  const next_notification_at = anchor > 0 ? anchor + cfg.cadence_ms : threshold_at
  const notify = input?.notify ?? ((input?.at ?? now()) >= next_notification_at && (input?.at ?? now()) < hard_stop_at)

  return reminder_item.parse({
    run_id: row.id,
    session_id: row.session_id,
    workspace_id: row.workspace_id,
    workflow_id: row.workflow_id,
    status: row.status,
    trigger_type: row.trigger_type,
    started_at,
    threshold_ms: cfg.threshold_ms,
    cadence_ms: cfg.cadence_ms,
    hard_stop_ms: cfg.hard_stop_ms,
    threshold_at,
    hard_stop_at,
    next_notification_at,
    last_notification_at: times.last_notification_at,
    last_keep_running_at: times.last_keep_running_at,
    elapsed_ms,
    remaining_ms,
    notify,
  })
}

function write_watchdog(
  db: Tx,
  row: RunRow,
  event: "notification" | "keep_running" | "hard_stop",
  at?: number,
  input?: { settings?: Partial<z.output<typeof settings>>; actor_type?: "system" | "user" },
) {
  const current = item(db, row, { at, notify: false, settings: input?.settings })
  if (!current) return

  RuntimeAudit.write(
    {
      event_type: "reconciliation.watchdog",
      actor_type: input?.actor_type ?? "system",
      occurred_at: at ?? now(),
      workspace_id: row.workspace_id,
      session_id: row.session_id,
      run_id: row.id,
      event_payload: {
        event,
        elapsed_ms: current.elapsed_ms,
        threshold_ms: current.threshold_ms,
        hard_stop_ms: current.hard_stop_ms,
      },
    },
    db,
  )
}

export namespace RuntimeReconciliation {
  export const Settings = settings
  export const ReminderItem = reminder_item
  export const ReminderPage = reminder_page
  export const threshold_ms = threshold_ms_default
  export const cadence_ms = cadence_ms_default
  export const hard_stop_ms = hard_stop_ms_default

  export function isActive(row: Pick<RunRow, "status">) {
    return active(row)
  }

  export function isDebug(row: Pick<RunRow, "trigger_type" | "status" | "failure_code">) {
    return debug(row)
  }

  export function hiddenRunCount(workspace_id: string, tx?: Tx) {
    const read = (db: Tx) =>
      db
        .select({
          trigger_type: RunTable.trigger_type,
          status: RunTable.status,
          failure_code: RunTable.failure_code,
        })
        .from(RunTable)
        .where(eq(RunTable.workspace_id, workspace_id))
        .all()
        .filter((row) => debug(row))
        .length

    if (tx) return read(tx)
    return Database.use(read)
  }

  export function progress(run_id: string, tx?: Tx, input?: { at?: number; settings?: Partial<z.output<typeof settings>> }) {
    const read = (db: Tx) => {
      const row = db.select().from(RunTable).where(eq(RunTable.id, run_id)).get()
      if (!row) return
      return item(db, row, { at: input?.at, notify: false, settings: input?.settings })
    }

    if (tx) return read(tx)
    return Database.use(read)
  }

  export async function poll() {
    await using _ = await Lock.write("reconciliation:reminders")
    return Database.transaction((db) => {
      const at = now()
      const rows = db
        .select()
        .from(RunTable)
        .where(inArray(RunTable.status, [...active_statuses]))
        .orderBy(desc(RunTable.updated_at), desc(RunTable.id))
        .all()

      const items = rows.flatMap((row) => {
        const current = item(db, row, { at })
        if (!current) return []
        if (!current.notify) return [current]
        write_watchdog(db, row, "notification", at)
        return [item(db, row, { at, notify: true })!]
      })

      return reminder_page.parse({
        generated_at: at,
        items,
      })
    })
  }

  export function keepRunning(run_id: string, input?: { actor_type?: "system" | "user" }) {
    return Database.transaction((db) => {
      const row = db.select().from(RunTable).where(eq(RunTable.id, run_id)).get()
      if (!row) return
      if (!active(row)) return
      write_watchdog(db, row, "keep_running", undefined, {
        actor_type: input?.actor_type ?? "user",
      })
      return item(db, row, { notify: false })
    })
  }

  export function hardStop(run_id: string, tx?: Tx, input?: { at?: number; settings?: Partial<z.output<typeof settings>> }) {
    const write = (db: Tx) => {
      const row = db.select().from(RunTable).where(eq(RunTable.id, run_id)).get()
      if (!row) return
      write_watchdog(db, row, "hard_stop", input?.at, { settings: input?.settings })
      return item(db, row, { at: input?.at, notify: false, settings: input?.settings })
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export namespace Testing {
    export function set(input: { now?: () => number }) {
      now = input.now ?? (() => Date.now())
    }

    export function reset() {
      now = () => Date.now()
    }
  }
}
