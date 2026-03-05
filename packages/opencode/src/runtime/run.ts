import { Database, eq } from "@/storage/db"
import z from "zod"
import { RuntimeAudit } from "./audit"
import { failure_code, reason_code, run_status, run_trigger_type, type RunStatus, terminal_run_statuses } from "./contract"
import { validate_run_create, validate_run_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { RunTable } from "./runtime.sql"
import { NotFoundError } from "@/storage/db"

const create_input = z.object({
  id: uuid_v7.optional(),
  status: run_status.default("queued"),
  trigger_type: run_trigger_type,
  workspace_id: z.string(),
  session_id: z.string().nullable().optional(),
  reason_code: reason_code.nullable().optional(),
  failure_code: failure_code.nullable().optional(),
  actor_type: z.enum(["system", "user"]).default("system"),
})

const transition_input = z.object({
  id: uuid_v7,
  to: run_status,
  reason_code: reason_code.nullable().optional(),
  failure_code: failure_code.nullable().optional(),
  actor_type: z.enum(["system", "user"]).default("system"),
})

function terminal(status: RunStatus) {
  return terminal_run_statuses.has(status)
}

function create_row(input: z.infer<typeof create_input>) {
  validate_run_create({
    status: input.status,
    trigger_type: input.trigger_type,
    reason_code: input.reason_code,
  })

  const now = Date.now()
  return {
    id: create_uuid_v7(input.id),
    status: input.status,
    trigger_type: input.trigger_type,
    workspace_id: input.workspace_id,
    session_id: input.session_id ?? null,
    ready_for_integration_at: null,
    reason_code: input.reason_code ?? null,
    failure_code: input.failure_code ?? null,
    created_at: now,
    updated_at: now,
    started_at: null as number | null,
    finished_at: terminal(input.status) ? now : null,
  }
}

function transitions(row: typeof RunTable.$inferSelect, input: z.infer<typeof transition_input>) {
  validate_run_transition({
    from: row.status,
    to: input.to,
    reason_code: input.reason_code,
    failure_code: input.failure_code,
  })

  const now = Date.now()
  const started = row.started_at ?? (input.to === "running" ? now : null)
  const ready =
    input.to === "ready_for_integration"
      ? row.ready_for_integration_at ?? now
      : row.ready_for_integration_at
  const finished = terminal(input.to) ? now : row.finished_at

  return {
    status: input.to,
    reason_code: input.reason_code ?? row.reason_code,
    failure_code: input.failure_code ?? row.failure_code,
    updated_at: now,
    started_at: started,
    ready_for_integration_at: ready,
    finished_at: finished,
  }
}

export namespace RuntimeRun {
  export const CreateInput = create_input
  export const TransitionInput = transition_input

  export function create(input: z.input<typeof CreateInput>) {
    const parsed = CreateInput.parse(input)
    return Database.transaction((db) => {
      const row = create_row(parsed)
      db.insert(RunTable).values(row).run()
      RuntimeAudit.write(
        {
          event_type: "run.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: row.workspace_id,
          session_id: row.session_id,
          run_id: row.id,
          event_payload: {
            from: "create",
            to: row.status,
          },
        },
        db,
      )
      return row
    })
  }

  export function transition(input: z.input<typeof TransitionInput>) {
    const parsed = TransitionInput.parse(input)
    return Database.transaction((db) => {
      const row = db.select().from(RunTable).where(eq(RunTable.id, parsed.id)).get()
      if (!row) throw new NotFoundError({ message: `Run not found: ${parsed.id}` })
      const next = transitions(row, parsed)
      const updated = db.update(RunTable).set(next).where(eq(RunTable.id, parsed.id)).returning().get()
      if (!updated) throw new NotFoundError({ message: `Run not found: ${parsed.id}` })
      RuntimeAudit.write(
        {
          event_type: "run.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: updated.workspace_id,
          session_id: updated.session_id,
          run_id: updated.id,
          event_payload: {
            from: row.status,
            to: updated.status,
          },
        },
        db,
      )
      return updated
    })
  }
}
