import { Database, NotFoundError, asc, eq, inArray } from "@/storage/db"
import { Identifier } from "@/id/id"
import z from "zod"
import { run_attempt_status } from "./contract"
import { validate_run_attempt_create, validate_run_attempt_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { RunAttemptTable } from "./runtime.sql"
import { RuntimeRunNode } from "./run-node"

const json_record = z.record(z.string(), z.unknown())

const view = z
  .object({
    id: uuid_v7,
    run_node_id: uuid_v7,
    attempt_index: z.number().int().nonnegative(),
    status: run_attempt_status,
    session_id: Identifier.schema("session").nullable(),
    input_json: json_record.nullable(),
    output_json: json_record.nullable(),
    error_json: json_record.nullable(),
    created_at: z.number(),
    updated_at: z.number(),
    started_at: z.number().nullable(),
    finished_at: z.number().nullable(),
  })
  .strict()

const create_input = z
  .object({
    id: uuid_v7.optional(),
    run_node_id: uuid_v7,
    session_id: Identifier.schema("session").nullable().optional(),
    input_json: json_record.nullable().optional(),
    status: run_attempt_status.default("created"),
  })
  .strict()

const transition_input = z
  .object({
    id: uuid_v7,
    to: run_attempt_status,
    output_json: json_record.nullable().optional(),
    error_json: json_record.nullable().optional(),
    session_id: Identifier.schema("session").nullable().optional(),
  })
  .strict()

const get_input = z
  .object({
    id: uuid_v7,
  })
  .strict()

const by_node_input = z
  .object({
    run_node_id: uuid_v7,
  })
  .strict()

const by_run_input = z
  .object({
    run_node_ids: z.array(uuid_v7).default([]),
  })
  .strict()

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(RunAttemptTable).where(eq(RunAttemptTable.id, id)).get()
  if (!value) throw new NotFoundError({ message: `Run attempt not found: ${id}` })
  return view.parse(value)
}

function next_row(row: typeof RunAttemptTable.$inferSelect, input: z.infer<typeof transition_input>) {
  validate_run_attempt_transition({
    from: row.status,
    to: input.to,
  })

  const now = Date.now()
  return {
    status: input.to,
    session_id: input.session_id === undefined ? row.session_id : input.session_id,
    output_json: input.output_json === undefined ? row.output_json : input.output_json,
    error_json: input.error_json === undefined ? row.error_json : input.error_json,
    updated_at: now,
    started_at: row.started_at ?? (input.to === "running" ? now : null),
    finished_at: input.to === "succeeded" || input.to === "failed" || input.to === "canceled" ? now : null,
  }
}

export namespace RuntimeRunAttempt {
  export const View = view
  export const CreateInput = create_input
  export const TransitionInput = transition_input
  export const GetInput = get_input
  export const ByNodeInput = by_node_input
  export const ByRunInput = by_run_input

  export function create(input: z.input<typeof CreateInput>, tx?: Database.TxOrDb) {
    const parsed = CreateInput.parse(input)
    validate_run_attempt_create(parsed.status)

    const write = (db: Database.TxOrDb) => {
      const node = RuntimeRunNode.incrementAttemptCount({ id: parsed.run_node_id }, db)
      const now = Date.now()
      const created = {
        id: create_uuid_v7(parsed.id),
        run_node_id: parsed.run_node_id,
        attempt_index: node.attempt_count - 1,
        status: parsed.status,
        session_id: parsed.session_id ?? null,
        input_json: parsed.input_json ?? null,
        output_json: null,
        error_json: null,
        created_at: now,
        updated_at: now,
        started_at: null,
        finished_at: null,
      }
      db.insert(RunAttemptTable).values(created).run()
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
        .update(RunAttemptTable)
        .set(next_row(current, parsed))
        .where(eq(RunAttemptTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new NotFoundError({ message: `Run attempt not found: ${parsed.id}` })
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

  export function byNode(input: z.input<typeof ByNodeInput>, tx?: Database.TxOrDb) {
    const parsed = ByNodeInput.parse(input)
    const read = (db: Database.TxOrDb) =>
      db
        .select()
        .from(RunAttemptTable)
        .where(eq(RunAttemptTable.run_node_id, parsed.run_node_id))
        .orderBy(asc(RunAttemptTable.attempt_index))
        .all()
        .map((item) => view.parse(item))

    if (tx) return read(tx)
    return Database.use(read)
  }

  export function byRun(input: z.input<typeof ByRunInput>, tx?: Database.TxOrDb) {
    const parsed = ByRunInput.parse(input)
    if (parsed.run_node_ids.length === 0) return []
    const read = (db: Database.TxOrDb) =>
      db
        .select()
        .from(RunAttemptTable)
        .where(inArray(RunAttemptTable.run_node_id, parsed.run_node_ids))
        .orderBy(asc(RunAttemptTable.run_node_id), asc(RunAttemptTable.attempt_index))
        .all()
        .map((item) => view.parse(item))

    if (tx) return read(tx)
    return Database.use(read)
  }
}
