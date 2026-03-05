import { NotFoundError } from "@/storage/db"
import { Database, eq } from "@/storage/db"
import z from "zod"
import { RuntimeAudit } from "./audit"
import { operation_status, run_trigger_type } from "./contract"
import { RuntimeWorkspaceMismatchError } from "./error"
import { validate_operation_create, validate_operation_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { OperationTable, RunTable } from "./runtime.sql"

const create_input = z.object({
  id: uuid_v7.optional(),
  run_id: uuid_v7,
  workspace_id: z.string(),
  status: operation_status.default("completed"),
  source_operation_id: uuid_v7.nullable().optional(),
  session_id: z.string().nullable().optional(),
  trigger_type: run_trigger_type,
  workflow_id: z.string().nullable().optional(),
  integration_attempt_id: uuid_v7.nullable().optional(),
  ready_for_integration_at: z.number().int().nonnegative().nullable().optional(),
  jj_base_change_id: z.string().nullable().optional(),
  jj_result_change_ids: z.array(z.string()).default([]),
  jj_operation_ids: z.array(z.string()).default([]),
  jj_operation_phases: z.array(z.string()).default([]),
  jj_commit_ids: z.array(z.string()).default([]),
  changed_paths: z.array(z.string()).default([]),
  integration_head_change_id_before_apply: z.string().nullable().optional(),
  integration_head_change_id_after_apply: z.string().nullable().optional(),
  actor_type: z.enum(["system", "user"]).default("system"),
})

const transition_input = z.object({
  id: uuid_v7,
  to: operation_status,
  actor_type: z.enum(["system", "user"]).default("system"),
})

function create_row(input: z.infer<typeof create_input>) {
  validate_operation_create(input.status)
  const now = Date.now()
  return {
    id: create_uuid_v7(input.id),
    run_id: input.run_id,
    workspace_id: input.workspace_id,
    status: input.status,
    source_operation_id: input.source_operation_id ?? null,
    session_id: input.session_id ?? null,
    trigger_type: input.trigger_type,
    workflow_id: input.workflow_id ?? null,
    integration_attempt_id: input.integration_attempt_id ?? null,
    ready_for_integration_at: input.ready_for_integration_at ?? null,
    jj_base_change_id: input.jj_base_change_id ?? null,
    jj_result_change_ids: input.jj_result_change_ids,
    jj_operation_ids: input.jj_operation_ids,
    jj_operation_phases: input.jj_operation_phases,
    jj_commit_ids: input.jj_commit_ids,
    changed_paths: input.changed_paths,
    integration_head_change_id_before_apply: input.integration_head_change_id_before_apply ?? null,
    integration_head_change_id_after_apply: input.integration_head_change_id_after_apply ?? null,
    created_at: now,
    updated_at: now,
  }
}

export namespace RuntimeOperation {
  export const CreateInput = create_input
  export const TransitionInput = transition_input

  export function create(input: z.input<typeof CreateInput>) {
    const parsed = CreateInput.parse(input)
    return Database.transaction((db) => {
      const run = db.select().from(RunTable).where(eq(RunTable.id, parsed.run_id)).get()
      if (!run) throw new NotFoundError({ message: `Run not found: ${parsed.run_id}` })
      if (run.workspace_id !== parsed.workspace_id) {
        throw new RuntimeWorkspaceMismatchError({
          entity: "operation",
          run_id: parsed.run_id,
          run_workspace_id: run.workspace_id,
          workspace_id: parsed.workspace_id,
          code: "workspace_mismatch",
        })
      }
      const row = create_row(parsed)
      db.insert(OperationTable).values(row).run()
      RuntimeAudit.write(
        {
          event_type: "operation.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: row.workspace_id,
          session_id: row.session_id,
          run_id: row.run_id,
          operation_id: row.id,
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
      const row = db.select().from(OperationTable).where(eq(OperationTable.id, parsed.id)).get()
      if (!row) throw new NotFoundError({ message: `Operation not found: ${parsed.id}` })
      validate_operation_transition({
        from: row.status,
        to: parsed.to,
      })
      const updated = db
        .update(OperationTable)
        .set({
          status: parsed.to,
          updated_at: Date.now(),
        })
        .where(eq(OperationTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new NotFoundError({ message: `Operation not found: ${parsed.id}` })
      RuntimeAudit.write(
        {
          event_type: "operation.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: updated.workspace_id,
          session_id: updated.session_id,
          run_id: updated.run_id,
          operation_id: updated.id,
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
