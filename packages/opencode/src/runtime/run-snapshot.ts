import { Database, NotFoundError, eq } from "@/storage/db"
import z from "zod"
import { workflow_schema } from "@/workflow/contract"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { RunSnapshotTable } from "./runtime.sql"

const json_record = z.record(z.string(), z.unknown())

const view = z
  .object({
    id: uuid_v7,
    run_id: uuid_v7,
    workflow_id: z.string(),
    workflow_revision_id: uuid_v7,
    workflow_hash: z.string(),
    workflow_text: z.string(),
    graph_json: workflow_schema,
    input_json: json_record,
    input_store_json: json_record,
    trigger_metadata_json: json_record,
    resource_materials_json: json_record,
    material_root: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .strict()

const create_input = z
  .object({
    id: uuid_v7.optional(),
    run_id: uuid_v7,
    workflow_id: z.string().min(1),
    workflow_revision_id: uuid_v7,
    workflow_hash: z.string().min(1),
    workflow_text: z.string().min(1),
    graph_json: workflow_schema,
    input_json: json_record,
    input_store_json: json_record,
    trigger_metadata_json: json_record,
    resource_materials_json: json_record,
    material_root: z.string().min(1),
  })
  .strict()

const get_input = z
  .object({
    id: uuid_v7,
  })
  .strict()

const by_run_input = z
  .object({
    run_id: uuid_v7,
  })
  .strict()

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(RunSnapshotTable).where(eq(RunSnapshotTable.id, id)).get()
  if (!value) throw new NotFoundError({ message: `Run snapshot not found: ${id}` })
  return view.parse(value)
}

function by_run_row(db: Database.TxOrDb, run_id: string) {
  const value = db.select().from(RunSnapshotTable).where(eq(RunSnapshotTable.run_id, run_id)).get()
  if (!value) throw new NotFoundError({ message: `Run snapshot not found for run: ${run_id}` })
  return view.parse(value)
}

export namespace RuntimeRunSnapshot {
  export const View = view
  export const CreateInput = create_input
  export const GetInput = get_input
  export const ByRunInput = by_run_input

  export function create(input: z.input<typeof CreateInput>, tx?: Database.TxOrDb) {
    const parsed = CreateInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const now = Date.now()
      const created = {
        id: create_uuid_v7(parsed.id),
        run_id: parsed.run_id,
        workflow_id: parsed.workflow_id,
        workflow_revision_id: parsed.workflow_revision_id,
        workflow_hash: parsed.workflow_hash,
        workflow_text: parsed.workflow_text,
        graph_json: parsed.graph_json,
        input_json: parsed.input_json,
        input_store_json: parsed.input_store_json,
        trigger_metadata_json: parsed.trigger_metadata_json,
        resource_materials_json: parsed.resource_materials_json,
        material_root: parsed.material_root,
        created_at: now,
        updated_at: now,
      }
      db.insert(RunSnapshotTable).values(created).run()
      return view.parse(created)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function get(input: z.input<typeof GetInput>, tx?: Database.TxOrDb) {
    const parsed = GetInput.parse(input)
    if (tx) return row(tx, parsed.id)
    return Database.use((db) => row(db, parsed.id))
  }

  export function byRun(input: z.input<typeof ByRunInput>, tx?: Database.TxOrDb) {
    const parsed = ByRunInput.parse(input)
    if (tx) return by_run_row(tx, parsed.run_id)
    return Database.use((db) => by_run_row(db, parsed.run_id))
  }
}
