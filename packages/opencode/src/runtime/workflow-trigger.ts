import { Database, and, eq } from "@/storage/db"
import z from "zod"
import { WorkflowTriggerTable } from "./runtime.sql"
import { create_uuid_v7, uuid_v7 } from "./uuid"

const trigger_type = z.enum(["cron", "signal"])

const row = z
  .object({
    id: uuid_v7,
    workspace_id: z.string(),
    workflow_id: z.string(),
    trigger_type,
    trigger_value: z.string(),
    timezone: z.string().nullable(),
    enabled_at: z.number().int().positive(),
    cursor_at: z.number().int().nonnegative().nullable(),
    created_at: z.number().int().positive(),
    updated_at: z.number().int().positive(),
  })
  .strict()

const upsert_input = z
  .object({
    workspace_id: z.string(),
    workflow_id: z.string().min(1),
    trigger_type,
    trigger_value: z.string().min(1),
    timezone: z.string().nullable().optional(),
    enabled_at: z.number().int().positive(),
    cursor_at: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()

const signal_input = z
  .object({
    workspace_id: z.string(),
    signal: z.string().min(1),
  })
  .strict()

const prune_input = z
  .object({
    workspace_id: z.string(),
    keep: z.array(
      z
        .object({
          workflow_id: z.string().min(1),
          trigger_type,
        })
        .strict(),
    ),
  })
  .strict()

const cursor_input = z
  .object({
    id: uuid_v7,
    cursor_at: z.number().int().nonnegative(),
  })
  .strict()

function match(input: { workspace_id: string; workflow_id: string; trigger_type: "cron" | "signal" }, tx: Database.TxOrDb) {
  return tx
    .select()
    .from(WorkflowTriggerTable)
    .where(
      and(
        eq(WorkflowTriggerTable.workspace_id, input.workspace_id),
        eq(WorkflowTriggerTable.workflow_id, input.workflow_id),
        eq(WorkflowTriggerTable.trigger_type, input.trigger_type),
      ),
    )
    .get()
}

export namespace RuntimeWorkflowTrigger {
  export const Row = row
  export const UpsertInput = upsert_input

  export function upsert(value: z.input<typeof UpsertInput>, tx?: Database.TxOrDb) {
    const input = UpsertInput.parse(value)
    const write = (db: Database.TxOrDb) => {
      const current = match(input, db)
      if (!current) {
        const next = {
          id: create_uuid_v7(),
          workspace_id: input.workspace_id,
          workflow_id: input.workflow_id,
          trigger_type: input.trigger_type,
          trigger_value: input.trigger_value,
          timezone: input.timezone ?? null,
          enabled_at: input.enabled_at,
          cursor_at: input.cursor_at ?? null,
          created_at: Date.now(),
          updated_at: Date.now(),
        }
        db.insert(WorkflowTriggerTable).values(next).run()
        return row.parse(next)
      }

      const next = db
        .update(WorkflowTriggerTable)
        .set({
          trigger_value: input.trigger_value,
          timezone: input.timezone === undefined ? current.timezone : input.timezone,
          enabled_at: current.enabled_at,
          cursor_at: current.cursor_at,
          updated_at: Date.now(),
        })
        .where(eq(WorkflowTriggerTable.id, current.id))
        .returning()
        .get()
      if (!next) throw new Error(`workflow trigger not found: ${current.id}`)
      return row.parse(next)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function list(workspace_id?: string) {
    return Database.use((db) => {
      const rows = workspace_id
        ? db.select().from(WorkflowTriggerTable).where(eq(WorkflowTriggerTable.workspace_id, workspace_id)).all()
        : db.select().from(WorkflowTriggerTable).all()
      return rows.map((item) => row.parse(item))
    })
  }

  export function signals(value: z.input<typeof signal_input>) {
    const input = signal_input.parse(value)
    return Database.use((db) =>
      db
        .select()
        .from(WorkflowTriggerTable)
        .where(
          and(
            eq(WorkflowTriggerTable.workspace_id, input.workspace_id),
            eq(WorkflowTriggerTable.trigger_type, "signal"),
            eq(WorkflowTriggerTable.trigger_value, input.signal),
          ),
        )
        .all()
        .map((item) => row.parse(item)),
    )
  }

  export function prune(value: z.input<typeof prune_input>) {
    const input = prune_input.parse(value)
    return Database.transaction((db) => {
      const keep = new Set(input.keep.map((item) => `${item.workflow_id}\u0000${item.trigger_type}`))
      const rows = db.select().from(WorkflowTriggerTable).where(eq(WorkflowTriggerTable.workspace_id, input.workspace_id)).all()
      const remove = rows
        .filter((item) => !keep.has(`${item.workflow_id}\u0000${item.trigger_type}`))
        .map((item) => item.id)
      remove.forEach((id) => {
        db.delete(WorkflowTriggerTable).where(eq(WorkflowTriggerTable.id, id)).run()
      })
      return remove
    })
  }

  export function advance(value: z.input<typeof cursor_input>) {
    const input = cursor_input.parse(value)
    return Database.transaction((db) => {
      const current = db.select().from(WorkflowTriggerTable).where(eq(WorkflowTriggerTable.id, input.id)).get()
      if (!current) throw new Error(`workflow trigger not found: ${input.id}`)
      if (current.cursor_at !== null && current.cursor_at >= input.cursor_at) {
        return row.parse(current)
      }
      const next = db
        .update(WorkflowTriggerTable)
        .set({
          cursor_at: input.cursor_at,
          updated_at: Date.now(),
        })
        .where(eq(WorkflowTriggerTable.id, input.id))
        .returning()
        .get()
      if (!next) throw new Error(`workflow trigger not found: ${input.id}`)
      return row.parse(next)
    })
  }
}
