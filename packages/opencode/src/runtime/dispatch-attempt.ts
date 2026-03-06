import { NotFoundError } from "@/storage/db"
import { Database, eq } from "@/storage/db"
import z from "zod"
import { block_reason_code, dispatch_attempt_state } from "./contract"
import { validate_dispatch_attempt_create, validate_dispatch_attempt_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { DispatchAttemptTable } from "./runtime.sql"

const create_input = z.object({
  id: uuid_v7.optional(),
  draft_id: uuid_v7,
  workspace_id: z.string(),
  integration_id: z.string().min(1),
  state: dispatch_attempt_state.default("created"),
  idempotency_key: z.string().min(1),
  remote_reference: z.string().nullable().optional(),
  block_reason_code: block_reason_code.nullable().optional(),
})

const transition_input = z.object({
  id: uuid_v7,
  to: dispatch_attempt_state,
  remote_reference: z.string().nullable().optional(),
  block_reason_code: block_reason_code.nullable().optional(),
})

const get_input = z.object({
  id: uuid_v7,
})

const by_draft_input = z.object({
  draft_id: uuid_v7,
})

const remove_input = z.object({
  id: uuid_v7,
})

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(DispatchAttemptTable).where(eq(DispatchAttemptTable.id, id)).get()
  if (value) return value
  throw new NotFoundError({ message: `Dispatch attempt not found: ${id}` })
}

export namespace RuntimeDispatchAttempt {
  export const CreateInput = create_input
  export const TransitionInput = transition_input
  export const GetInput = get_input
  export const ByDraftInput = by_draft_input
  export const RemoveInput = remove_input

  export function create(input: z.input<typeof CreateInput>) {
    const parsed = CreateInput.parse(input)
    validate_dispatch_attempt_create(parsed.state)
    return Database.transaction((db) => {
      const now = Date.now()
      const row = {
        id: create_uuid_v7(parsed.id),
        draft_id: parsed.draft_id,
        workspace_id: parsed.workspace_id,
        integration_id: parsed.integration_id,
        state: parsed.state,
        idempotency_key: parsed.idempotency_key,
        remote_reference: parsed.remote_reference ?? null,
        block_reason_code: parsed.block_reason_code ?? null,
        created_at: now,
        updated_at: now,
      }
      db.insert(DispatchAttemptTable).values(row).run()
      return row
    })
  }

  export function transition(input: z.input<typeof TransitionInput>) {
    const parsed = TransitionInput.parse(input)
    return Database.transaction((db) => {
      const current = row(db, parsed.id)
      validate_dispatch_attempt_transition({
        from: current.state,
        to: parsed.to,
      })
      const updated = db
        .update(DispatchAttemptTable)
        .set({
          state: parsed.to,
          remote_reference: parsed.remote_reference === undefined ? current.remote_reference : parsed.remote_reference,
          block_reason_code: parsed.block_reason_code === undefined ? current.block_reason_code : parsed.block_reason_code,
          updated_at: Date.now(),
        })
        .where(eq(DispatchAttemptTable.id, parsed.id))
        .returning()
        .get()
      if (updated) return updated
      throw new NotFoundError({ message: `Dispatch attempt not found: ${parsed.id}` })
    })
  }

  export function get(input: z.input<typeof GetInput>, tx?: Database.TxOrDb) {
    const parsed = GetInput.parse(input)
    if (tx) return row(tx, parsed.id)
    return Database.use((db) => row(db, parsed.id))
  }

  export function byDraft(input: z.input<typeof ByDraftInput>, tx?: Database.TxOrDb) {
    const parsed = ByDraftInput.parse(input)
    if (tx) {
      return tx.select().from(DispatchAttemptTable).where(eq(DispatchAttemptTable.draft_id, parsed.draft_id)).get()
    }
    return Database.use((db) =>
      db.select().from(DispatchAttemptTable).where(eq(DispatchAttemptTable.draft_id, parsed.draft_id)).get(),
    )
  }

  export function remove(input: z.input<typeof RemoveInput>) {
    const parsed = RemoveInput.parse(input)
    return Database.transaction((db) => {
      const current = row(db, parsed.id)
      db.delete(DispatchAttemptTable).where(eq(DispatchAttemptTable.id, parsed.id)).run()
      return current
    })
  }
}
