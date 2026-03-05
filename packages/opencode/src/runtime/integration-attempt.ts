import { NotFoundError } from "@/storage/db"
import { Database, eq } from "@/storage/db"
import z from "zod"
import { RuntimeAudit } from "./audit"
import { integration_attempt_state } from "./contract"
import { RuntimeIllegalTransitionError, RuntimeWorkspaceMismatchError } from "./error"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { IntegrationAttemptTable, RunTable } from "./runtime.sql"

const create_input = z.object({
  id: uuid_v7.optional(),
  run_id: uuid_v7,
  workspace_id: z.string(),
  state: integration_attempt_state.default("attempt_created"),
  replay_index: z.number().int().nonnegative().default(0),
  actor_type: z.enum(["system", "user"]).default("system"),
})

const transition_input = z.object({
  id: uuid_v7,
  to: integration_attempt_state,
  actor_type: z.enum(["system", "user"]).default("system"),
})

const legal = new Set(["attempt_created->jj_applied", "jj_applied->db_linked", "db_linked->finalized"])

function validate(from: z.infer<typeof integration_attempt_state>, to: z.infer<typeof integration_attempt_state>) {
  if (legal.has(`${from}->${to}`)) return
  throw new RuntimeIllegalTransitionError({
    entity: "integration_attempt",
    from,
    to,
    code: "illegal_transition",
  })
}

export namespace RuntimeIntegrationAttempt {
  export const CreateInput = create_input
  export const TransitionInput = transition_input

  export function create(input: z.input<typeof CreateInput>) {
    const parsed = CreateInput.parse(input)
    return Database.transaction((db) => {
      const run = db.select().from(RunTable).where(eq(RunTable.id, parsed.run_id)).get()
      if (!run) throw new NotFoundError({ message: `Run not found: ${parsed.run_id}` })
      if (run.workspace_id !== parsed.workspace_id) {
        throw new RuntimeWorkspaceMismatchError({
          entity: "integration_attempt",
          run_id: parsed.run_id,
          run_workspace_id: run.workspace_id,
          workspace_id: parsed.workspace_id,
          code: "workspace_mismatch",
        })
      }
      if (parsed.state !== "attempt_created") {
        throw new RuntimeIllegalTransitionError({
          entity: "integration_attempt",
          from: "create",
          to: parsed.state,
          code: "illegal_transition",
        })
      }
      const now = Date.now()
      const row = {
        id: create_uuid_v7(parsed.id),
        run_id: parsed.run_id,
        workspace_id: parsed.workspace_id,
        state: parsed.state,
        replay_index: parsed.replay_index,
        created_at: now,
        updated_at: now,
      }
      db.insert(IntegrationAttemptTable).values(row).run()
      RuntimeAudit.write(
        {
          event_type: "integration_attempt.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: row.workspace_id,
          run_id: row.run_id,
          integration_attempt_id: row.id,
          event_payload: {
            from: "create",
            to: row.state,
            replay_index: row.replay_index,
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
      const row = db.select().from(IntegrationAttemptTable).where(eq(IntegrationAttemptTable.id, parsed.id)).get()
      if (!row) throw new NotFoundError({ message: `Integration attempt not found: ${parsed.id}` })
      validate(row.state, parsed.to)
      const updated = db
        .update(IntegrationAttemptTable)
        .set({
          state: parsed.to,
          updated_at: Date.now(),
        })
        .where(eq(IntegrationAttemptTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new NotFoundError({ message: `Integration attempt not found: ${parsed.id}` })
      RuntimeAudit.write(
        {
          event_type: "integration_attempt.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: updated.workspace_id,
          run_id: updated.run_id,
          integration_attempt_id: updated.id,
          event_payload: {
            from: row.state,
            to: updated.state,
            replay_index: updated.replay_index,
          },
        },
        db,
      )
      return updated
    })
  }
}
