import { Database, and, eq } from "@/storage/db"
import z from "zod"
import { WorkflowSignalDedupeTable } from "./runtime.sql"
import { create_uuid_v7, uuid_v7 } from "./uuid"

const row = z
  .object({
    id: uuid_v7,
    trigger_id: uuid_v7,
    workspace_id: z.string(),
    workflow_id: z.string(),
    dedupe_key: z.string(),
    provider_event_id: z.string().nullable(),
    fallback_hash: z.string().nullable(),
    event_time: z.number().int().positive(),
    payload_json: z.record(z.string(), z.unknown()),
    source_json: z.record(z.string(), z.unknown()).nullable(),
    first_run_id: uuid_v7.nullable(),
    created_at: z.number().int().positive(),
    updated_at: z.number().int().positive(),
  })
  .strict()

const claim_input = z
  .object({
    trigger_id: uuid_v7,
    workspace_id: z.string(),
    workflow_id: z.string().min(1),
    dedupe_key: z.string().min(1),
    provider_event_id: z.string().min(1).nullable().optional(),
    fallback_hash: z.string().min(1).nullable().optional(),
    event_time: z.number().int().positive(),
    payload_json: z.record(z.string(), z.unknown()),
    source_json: z.record(z.string(), z.unknown()).nullable().optional(),
    first_run_id: uuid_v7.nullable().optional(),
  })
  .strict()

const link_input = z
  .object({
    id: uuid_v7,
    first_run_id: uuid_v7,
  })
  .strict()

const release_input = z
  .object({
    id: uuid_v7,
  })
  .strict()

export namespace RuntimeWorkflowSignalDedupe {
  export const Row = row
  export const ClaimInput = claim_input

  export function claim(value: z.input<typeof ClaimInput>, tx?: Database.TxOrDb) {
    const input = ClaimInput.parse(value)
    const write = (db: Database.TxOrDb) => {
      const created_at = Date.now()
      const next = {
        id: create_uuid_v7(),
        trigger_id: input.trigger_id,
        workspace_id: input.workspace_id,
        workflow_id: input.workflow_id,
        dedupe_key: input.dedupe_key,
        provider_event_id: input.provider_event_id ?? null,
        fallback_hash: input.fallback_hash ?? null,
        event_time: input.event_time,
        payload_json: input.payload_json,
        source_json: input.source_json ?? null,
        first_run_id: input.first_run_id ?? null,
        created_at,
        updated_at: created_at,
      }

      const inserted = db.insert(WorkflowSignalDedupeTable).values(next).onConflictDoNothing().returning().get()
      if (inserted) {
        return {
          duplicate: false as const,
          row: row.parse(inserted),
        }
      }

      const existing = db
        .select()
        .from(WorkflowSignalDedupeTable)
        .where(
          and(
            eq(WorkflowSignalDedupeTable.trigger_id, input.trigger_id),
            eq(WorkflowSignalDedupeTable.dedupe_key, input.dedupe_key),
          ),
        )
        .get()
      if (!existing) throw new Error(`workflow signal dedupe missing: ${input.trigger_id}`)
      return {
        duplicate: true as const,
        row: row.parse(existing),
      }
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function link(value: z.input<typeof link_input>) {
    const input = link_input.parse(value)
    return Database.transaction((db) => {
      const next = db
        .update(WorkflowSignalDedupeTable)
        .set({
          first_run_id: input.first_run_id,
          updated_at: Date.now(),
        })
        .where(eq(WorkflowSignalDedupeTable.id, input.id))
        .returning()
        .get()
      if (!next) throw new Error(`workflow signal dedupe missing: ${input.id}`)
      return row.parse(next)
    })
  }

  export function release(value: z.input<typeof release_input>) {
    const input = release_input.parse(value)
    return Database.transaction((db) => {
      db.delete(WorkflowSignalDedupeTable).where(eq(WorkflowSignalDedupeTable.id, input.id)).run()
    })
  }
}
