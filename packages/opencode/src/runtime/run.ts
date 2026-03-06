import { Database, NotFoundError, eq } from "@/storage/db"
import z from "zod"
import { RuntimeAudit } from "./audit"
import { failure_code, reason_code, run_status, run_trigger_type, type RunStatus, terminal_run_statuses } from "./contract"
import { validate_run_create, validate_run_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { RunTable } from "./runtime.sql"

const actor_type = z.enum(["system", "user"])

const create_input = z.object({
  id: uuid_v7.optional(),
  status: run_status.default("queued"),
  trigger_type: run_trigger_type,
  workflow_id: z.string().nullable().optional(),
  workspace_id: z.string(),
  session_id: z.string().nullable().optional(),
  run_workspace_root: z.string().nullable().optional(),
  run_workspace_directory: z.string().nullable().optional(),
  reason_code: reason_code.nullable().optional(),
  failure_code: failure_code.nullable().optional(),
  trigger_metadata_json: z.record(z.string(), z.unknown()).nullable().optional(),
  integration_candidate_base_change_id: z.string().nullable().optional(),
  integration_candidate_change_ids: z.array(z.string()).nullable().optional(),
  integration_candidate_changed_paths: z.array(z.string()).nullable().optional(),
  actor_type: actor_type.default("system"),
})

const transition_input = z.object({
  id: uuid_v7,
  to: run_status,
  workflow_id: z.string().nullable().optional(),
  run_workspace_root: z.string().nullable().optional(),
  run_workspace_directory: z.string().nullable().optional(),
  reason_code: reason_code.nullable().optional(),
  failure_code: failure_code.nullable().optional(),
  actor_type: actor_type.default("system"),
})

const get_input = z.object({
  id: uuid_v7,
})

const candidate_input = z.object({
  id: uuid_v7,
  integration_candidate_base_change_id: z.string().nullable().optional(),
  integration_candidate_change_ids: z.array(z.string()).nullable().optional(),
  integration_candidate_changed_paths: z.array(z.string()).nullable().optional(),
})

const cleanup_input = z.object({
  id: uuid_v7,
  cleanup_failed: z.boolean(),
  failure_code: failure_code.nullable().optional(),
})

function terminal(status: RunStatus) {
  return terminal_run_statuses.has(status)
}

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(RunTable).where(eq(RunTable.id, id)).get()
  if (value) return value
  throw new NotFoundError({ message: `Run not found: ${id}` })
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
    workflow_id: input.workflow_id ?? null,
    workspace_id: input.workspace_id,
    session_id: input.session_id ?? null,
    run_workspace_root: input.run_workspace_root ?? null,
    run_workspace_directory: input.run_workspace_directory ?? null,
    ready_for_integration_at: null,
    reason_code: input.reason_code ?? null,
    failure_code: input.failure_code ?? null,
    trigger_metadata_json: input.trigger_metadata_json ?? null,
    integration_candidate_base_change_id: input.integration_candidate_base_change_id ?? null,
    integration_candidate_change_ids: input.integration_candidate_change_ids ?? null,
    integration_candidate_changed_paths: input.integration_candidate_changed_paths ?? null,
    cleanup_failed: false,
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
  const workflow = input.workflow_id === undefined ? row.workflow_id : input.workflow_id
  const root = input.run_workspace_root === undefined ? row.run_workspace_root : input.run_workspace_root
  const directory =
    input.run_workspace_directory === undefined
      ? row.run_workspace_directory
      : input.run_workspace_directory

  return {
    status: input.to,
    workflow_id: workflow,
    reason_code: input.reason_code ?? row.reason_code,
    failure_code: input.failure_code ?? row.failure_code,
    run_workspace_root: root,
    run_workspace_directory: directory,
    updated_at: now,
    started_at: started,
    ready_for_integration_at: ready,
    finished_at: finished,
  }
}

function candidate_row(row: typeof RunTable.$inferSelect, input: z.infer<typeof candidate_input>) {
  return {
    integration_candidate_base_change_id:
      input.integration_candidate_base_change_id === undefined
        ? row.integration_candidate_base_change_id
        : input.integration_candidate_base_change_id,
    integration_candidate_change_ids:
      input.integration_candidate_change_ids === undefined
        ? row.integration_candidate_change_ids
        : input.integration_candidate_change_ids,
    integration_candidate_changed_paths:
      input.integration_candidate_changed_paths === undefined
        ? row.integration_candidate_changed_paths
        : input.integration_candidate_changed_paths,
    updated_at: Date.now(),
  }
}

export namespace RuntimeRun {
  export const CreateInput = create_input
  export const TransitionInput = transition_input
  export const GetInput = get_input
  export const CandidateInput = candidate_input
  export const CleanupInput = cleanup_input

  export function create(input: z.input<typeof CreateInput>, tx?: Database.TxOrDb) {
    const parsed = CreateInput.parse(input)
    const write = (db: Database.TxOrDb) => {
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
    }
    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function transition(input: z.input<typeof TransitionInput>) {
    const parsed = TransitionInput.parse(input)
    return Database.transaction((db) => {
      const before = row(db, parsed.id)
      const next = transitions(before, parsed)
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
            from: before.status,
            to: updated.status,
          },
        },
        db,
      )
      return updated
    })
  }

  export function get(input: z.input<typeof GetInput>, tx?: Database.TxOrDb) {
    const parsed = GetInput.parse(input)
    if (tx) return row(tx, parsed.id)
    return Database.use((db) => row(db, parsed.id))
  }

  export function candidate(input: z.input<typeof CandidateInput>) {
    const parsed = CandidateInput.parse(input)
    return Database.transaction((db) => {
      const before = row(db, parsed.id)
      const updated = db
        .update(RunTable)
        .set(candidate_row(before, parsed))
        .where(eq(RunTable.id, parsed.id))
        .returning()
        .get()
      if (updated) return updated
      throw new NotFoundError({ message: `Run not found: ${parsed.id}` })
    })
  }

  export function cleanup(input: z.input<typeof CleanupInput>) {
    const parsed = CleanupInput.parse(input)
    return Database.transaction((db) => {
      const before = row(db, parsed.id)
      const updated = db
        .update(RunTable)
        .set({
          cleanup_failed: parsed.cleanup_failed,
          failure_code: parsed.failure_code === undefined ? before.failure_code : parsed.failure_code,
          updated_at: Date.now(),
        })
        .where(eq(RunTable.id, parsed.id))
        .returning()
        .get()
      if (updated) return updated
      throw new NotFoundError({ message: `Run not found: ${parsed.id}` })
    })
  }
}
