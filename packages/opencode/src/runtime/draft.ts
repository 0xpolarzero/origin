import { NotFoundError } from "@/storage/db"
import { Database, eq } from "@/storage/db"
import z from "zod"
import { RuntimeAudit } from "./audit"
import { draft_status } from "./contract"
import { RuntimeWorkspaceMismatchError } from "./error"
import { validate_draft_create, validate_draft_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { DraftTable, RunTable } from "./runtime.sql"

const create_input = z.object({
  id: uuid_v7.optional(),
  run_id: uuid_v7.nullable().optional(),
  workspace_id: z.string(),
  status: draft_status.default("pending"),
  integration_id: z.string(),
  policy_id: z.string().nullable().optional(),
  policy_version: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  decision_reason_code: z.string().nullable().optional(),
  actor_type: z.enum(["system", "user"]).default("system"),
})

const transition_input = z.object({
  id: uuid_v7,
  to: draft_status,
  policy_id: z.string().nullable().optional(),
  policy_version: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  decision_reason_code: z.string().nullable().optional(),
  actor_type: z.enum(["system", "user"]).default("system"),
})

function create_row(input: z.infer<typeof create_input>) {
  validate_draft_create(input.status)
  const now = Date.now()
  return {
    id: create_uuid_v7(input.id),
    run_id: input.run_id ?? null,
    workspace_id: input.workspace_id,
    status: input.status,
    integration_id: input.integration_id,
    policy_id: input.policy_id ?? null,
    policy_version: input.policy_version ?? null,
    decision_id: input.decision_id ?? null,
    decision_reason_code: input.decision_reason_code ?? null,
    created_at: now,
    updated_at: now,
  }
}

export namespace RuntimeDraft {
  export const CreateInput = create_input
  export const TransitionInput = transition_input

  export function create(input: z.input<typeof CreateInput>) {
    const parsed = CreateInput.parse(input)
    return Database.transaction((db) => {
      if (parsed.run_id) {
        const run = db.select().from(RunTable).where(eq(RunTable.id, parsed.run_id)).get()
        if (!run) throw new NotFoundError({ message: `Run not found: ${parsed.run_id}` })
        if (run.workspace_id !== parsed.workspace_id) {
          throw new RuntimeWorkspaceMismatchError({
            entity: "draft",
            run_id: parsed.run_id,
            run_workspace_id: run.workspace_id,
            workspace_id: parsed.workspace_id,
            code: "workspace_mismatch",
          })
        }
      }
      const row = create_row(parsed)
      db.insert(DraftTable).values(row).run()
      RuntimeAudit.write(
        {
          event_type: "draft.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: row.workspace_id,
          run_id: row.run_id,
          draft_id: row.id,
          integration_id: row.integration_id,
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
      const row = db.select().from(DraftTable).where(eq(DraftTable.id, parsed.id)).get()
      if (!row) throw new NotFoundError({ message: `Draft not found: ${parsed.id}` })
      validate_draft_transition({
        from: row.status,
        to: parsed.to,
      })
      const updated = db
        .update(DraftTable)
        .set({
          status: parsed.to,
          updated_at: Date.now(),
          policy_id: parsed.policy_id ?? row.policy_id,
          policy_version: parsed.policy_version ?? row.policy_version,
          decision_id: parsed.decision_id ?? row.decision_id,
          decision_reason_code: parsed.decision_reason_code ?? row.decision_reason_code,
        })
        .where(eq(DraftTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new NotFoundError({ message: `Draft not found: ${parsed.id}` })
      RuntimeAudit.write(
        {
          event_type: "draft.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: updated.workspace_id,
          run_id: updated.run_id,
          draft_id: updated.id,
          integration_id: updated.integration_id,
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
