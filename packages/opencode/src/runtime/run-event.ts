import { Database, asc, eq } from "@/storage/db"
import z from "zod"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { RunEventTable } from "./runtime.sql"

const json_record = z.record(z.string(), z.unknown())

const view = z
  .object({
    id: uuid_v7,
    run_id: uuid_v7,
    run_node_id: uuid_v7.nullable(),
    run_attempt_id: uuid_v7.nullable(),
    sequence: z.number().int().nonnegative(),
    event_type: z.string(),
    payload_json: json_record,
    created_at: z.number(),
  })
  .strict()

const append_input = z
  .object({
    id: uuid_v7.optional(),
    run_id: uuid_v7,
    run_node_id: uuid_v7.nullable().optional(),
    run_attempt_id: uuid_v7.nullable().optional(),
    event_type: z.string().min(1),
    payload_json: json_record,
  })
  .strict()

const list_input = z
  .object({
    run_id: uuid_v7,
  })
  .strict()

function sequence(db: Database.TxOrDb, run_id: string) {
  const last = db
    .select()
    .from(RunEventTable)
    .where(eq(RunEventTable.run_id, run_id))
    .orderBy(asc(RunEventTable.sequence))
    .all()
    .at(-1)
  if (!last) return 0
  return last.sequence + 1
}

export namespace RuntimeRunEvent {
  export const View = view
  export const AppendInput = append_input
  export const ListInput = list_input

  export function append(input: z.input<typeof AppendInput>, tx?: Database.TxOrDb) {
    const parsed = AppendInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const created = {
        id: create_uuid_v7(parsed.id),
        run_id: parsed.run_id,
        run_node_id: parsed.run_node_id ?? null,
        run_attempt_id: parsed.run_attempt_id ?? null,
        sequence: sequence(db, parsed.run_id),
        event_type: parsed.event_type,
        payload_json: parsed.payload_json,
        created_at: Date.now(),
      }
      db.insert(RunEventTable).values(created).run()
      return view.parse(created)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function list(input: z.input<typeof ListInput>, tx?: Database.TxOrDb) {
    const parsed = ListInput.parse(input)
    const read = (db: Database.TxOrDb) =>
      db
        .select()
        .from(RunEventTable)
        .where(eq(RunEventTable.run_id, parsed.run_id))
        .orderBy(asc(RunEventTable.sequence))
        .all()
        .map((item) => view.parse(item))

    if (tx) return read(tx)
    return Database.use(read)
  }
}
