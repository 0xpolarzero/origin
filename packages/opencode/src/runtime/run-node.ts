import { Database, NotFoundError, and, asc, eq } from "@/storage/db"
import z from "zod"
import { validate_run_node_create, validate_run_node_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { RunNodeTable } from "./runtime.sql"
import { run_node_skip_reason_code, run_node_status } from "./contract"

const json_record = z.record(z.string(), z.unknown())

const view = z
  .object({
    id: uuid_v7,
    run_id: uuid_v7,
    snapshot_id: uuid_v7,
    node_id: z.string(),
    kind: z.string(),
    title: z.string(),
    status: run_node_status,
    skip_reason_code: run_node_skip_reason_code.nullable(),
    output_json: json_record.nullable(),
    error_json: json_record.nullable(),
    position: z.number().int().nonnegative(),
    attempt_count: z.number().int().nonnegative(),
    created_at: z.number(),
    updated_at: z.number(),
    started_at: z.number().nullable(),
    finished_at: z.number().nullable(),
  })
  .strict()

const create_input = z
  .object({
    id: uuid_v7.optional(),
    run_id: uuid_v7,
    snapshot_id: uuid_v7,
    node_id: z.string().min(1),
    kind: z.string().min(1),
    title: z.string().min(1),
    position: z.number().int().nonnegative(),
    status: run_node_status.default("pending"),
  })
  .strict()

const transition_input = z
  .object({
    id: uuid_v7,
    to: run_node_status,
    skip_reason_code: run_node_skip_reason_code.nullable().optional(),
    output_json: json_record.nullable().optional(),
    error_json: json_record.nullable().optional(),
  })
  .strict()

const attempt_count_input = z
  .object({
    id: uuid_v7,
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

const by_node_input = z
  .object({
    run_id: uuid_v7,
    node_id: z.string().min(1),
  })
  .strict()

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(RunNodeTable).where(eq(RunNodeTable.id, id)).get()
  if (!value) throw new NotFoundError({ message: `Run node not found: ${id}` })
  return view.parse(value)
}

function next_row(row: typeof RunNodeTable.$inferSelect, input: z.infer<typeof transition_input>) {
  validate_run_node_transition({
    from: row.status,
    to: input.to,
  })

  const now = Date.now()
  return {
    status: input.to,
    skip_reason_code: input.skip_reason_code === undefined ? row.skip_reason_code : input.skip_reason_code,
    output_json: input.output_json === undefined ? row.output_json : input.output_json,
    error_json: input.error_json === undefined ? row.error_json : input.error_json,
    updated_at: now,
    started_at: row.started_at ?? (input.to === "running" ? now : null),
    finished_at:
      input.to === "succeeded" || input.to === "failed" || input.to === "skipped" || input.to === "canceled" ? now : null,
  }
}

export namespace RuntimeRunNode {
  export const View = view
  export const CreateInput = create_input
  export const TransitionInput = transition_input
  export const AttemptCountInput = attempt_count_input
  export const GetInput = get_input
  export const ByRunInput = by_run_input
  export const ByNodeInput = by_node_input

  export function create(input: z.input<typeof CreateInput>, tx?: Database.TxOrDb) {
    const parsed = CreateInput.parse(input)
    validate_run_node_create(parsed.status)

    const write = (db: Database.TxOrDb) => {
      const now = Date.now()
      const created = {
        id: create_uuid_v7(parsed.id),
        run_id: parsed.run_id,
        snapshot_id: parsed.snapshot_id,
        node_id: parsed.node_id,
        kind: parsed.kind,
        title: parsed.title,
        status: parsed.status,
        skip_reason_code: null,
        output_json: null,
        error_json: null,
        position: parsed.position,
        attempt_count: 0,
        created_at: now,
        updated_at: now,
        started_at: null,
        finished_at: null,
      }
      db.insert(RunNodeTable).values(created).run()
      return view.parse(created)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function transition(input: z.input<typeof TransitionInput>, tx?: Database.TxOrDb) {
    const parsed = TransitionInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const current = row(db, parsed.id)
      const updated = db
        .update(RunNodeTable)
        .set(next_row(current, parsed))
        .where(eq(RunNodeTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new NotFoundError({ message: `Run node not found: ${parsed.id}` })
      return view.parse(updated)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function incrementAttemptCount(input: z.input<typeof AttemptCountInput>, tx?: Database.TxOrDb) {
    const parsed = AttemptCountInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const current = row(db, parsed.id)
      const updated = db
        .update(RunNodeTable)
        .set({
          attempt_count: current.attempt_count + 1,
          updated_at: Date.now(),
        })
        .where(eq(RunNodeTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new NotFoundError({ message: `Run node not found: ${parsed.id}` })
      return view.parse(updated)
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
    const read = (db: Database.TxOrDb) =>
      db
        .select()
        .from(RunNodeTable)
        .where(eq(RunNodeTable.run_id, parsed.run_id))
        .orderBy(asc(RunNodeTable.position))
        .all()
        .map((item) => view.parse(item))

    if (tx) return read(tx)
    return Database.use(read)
  }

  export function byNode(input: z.input<typeof ByNodeInput>, tx?: Database.TxOrDb) {
    const parsed = ByNodeInput.parse(input)
    const read = (db: Database.TxOrDb) => {
      const value = db
        .select()
        .from(RunNodeTable)
        .where(and(eq(RunNodeTable.run_id, parsed.run_id), eq(RunNodeTable.node_id, parsed.node_id)))
        .get()
      if (!value) throw new NotFoundError({ message: `Run node not found: ${parsed.run_id}/${parsed.node_id}` })
      return view.parse(value)
    }

    if (tx) return read(tx)
    return Database.use(read)
  }
}
