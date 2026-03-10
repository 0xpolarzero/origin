import { Database, NotFoundError, and, eq, inArray } from "@/storage/db"
import { Identifier } from "@/id/id"
import z from "zod"
import { session_link_role, session_link_visibility } from "./contract"
import { SessionLinkTable } from "./runtime.sql"
import { uuid_v7 } from "./uuid"

const view = z
  .object({
    session_id: Identifier.schema("session"),
    role: session_link_role,
    visibility: session_link_visibility,
    run_id: uuid_v7.nullable(),
    run_node_id: uuid_v7.nullable(),
    run_attempt_id: uuid_v7.nullable(),
    readonly: z.boolean(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .strict()

const create_input = z
  .object({
    session_id: Identifier.schema("session"),
    role: session_link_role,
    visibility: session_link_visibility.optional(),
    run_id: uuid_v7.nullable().optional(),
    run_node_id: uuid_v7.nullable().optional(),
    run_attempt_id: uuid_v7.nullable().optional(),
    readonly: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role === "execution_node" && !value.run_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run_id"],
        message: "execution_node session links require run_id",
      })
    }

    if (value.role === "execution_node" && !value.run_node_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run_node_id"],
        message: "execution_node session links require run_node_id",
      })
    }

    if (value.role === "run_followup" && !value.run_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run_id"],
        message: "run_followup session links require run_id",
      })
    }
  })

const get_input = z
  .object({
    session_id: Identifier.schema("session"),
  })
  .strict()

const by_run_input = z
  .object({
    run_id: uuid_v7,
    role: session_link_role.optional(),
  })
  .strict()

const by_node_input = z
  .object({
    run_node_id: uuid_v7,
    role: session_link_role.optional(),
  })
  .strict()

const by_attempt_input = z
  .object({
    run_attempt_id: uuid_v7,
    role: session_link_role.optional(),
  })
  .strict()

const hidden_input = z
  .object({
    session_ids: z.array(Identifier.schema("session")).default([]),
  })
  .strict()

function row(db: Database.TxOrDb, session_id: string) {
  const value = db.select().from(SessionLinkTable).where(eq(SessionLinkTable.session_id, session_id)).get()
  if (!value) throw new NotFoundError({ message: `Session link not found: ${session_id}` })
  return view.parse(value)
}

function where(conditions: ReturnType<typeof eq>[]) {
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

function normalized(input: z.output<typeof create_input>) {
  const visibility = input.visibility ?? "hidden"
  const readonly = input.readonly ?? input.role === "execution_node"
  return {
    session_id: input.session_id,
    role: input.role,
    visibility,
    run_id: input.run_id ?? null,
    run_node_id: input.run_node_id ?? null,
    run_attempt_id: input.run_attempt_id ?? null,
    readonly,
  }
}

export namespace RuntimeSessionLink {
  export const View = view
  export const CreateInput = create_input
  export const GetInput = get_input
  export const ByRunInput = by_run_input
  export const ByNodeInput = by_node_input
  export const ByAttemptInput = by_attempt_input
  export const HiddenInput = hidden_input

  export function upsert(input: z.input<typeof CreateInput>, tx?: Database.TxOrDb) {
    const parsed = CreateInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const value = normalized(parsed)
      const now = Date.now()
      db.insert(SessionLinkTable)
        .values({
          session_id: value.session_id,
          role: value.role,
          visibility: value.visibility,
          run_id: value.run_id,
          run_node_id: value.run_node_id,
          run_attempt_id: value.run_attempt_id,
          readonly: value.readonly,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: SessionLinkTable.session_id,
          set: {
            role: value.role,
            visibility: value.visibility,
            run_id: value.run_id,
            run_node_id: value.run_node_id,
            run_attempt_id: value.run_attempt_id,
            readonly: value.readonly,
            updated_at: now,
          },
        })
        .run()
      return row(db, value.session_id)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function get(input: z.input<typeof GetInput>, tx?: Database.TxOrDb) {
    const parsed = GetInput.parse(input)
    if (tx) return row(tx, parsed.session_id)
    return Database.use((db) => row(db, parsed.session_id))
  }

  export function maybe(session_id: string, tx?: Database.TxOrDb) {
    const read = (db: Database.TxOrDb) => {
      const value = db.select().from(SessionLinkTable).where(eq(SessionLinkTable.session_id, session_id)).get()
      if (!value) return null
      return view.parse(value)
    }

    if (tx) return read(tx)
    return Database.use(read)
  }

  export function byRun(input: z.input<typeof ByRunInput>, tx?: Database.TxOrDb) {
    const parsed = ByRunInput.parse(input)
    const read = (db: Database.TxOrDb) => {
      const conditions = [eq(SessionLinkTable.run_id, parsed.run_id)]
      if (parsed.role) conditions.push(eq(SessionLinkTable.role, parsed.role))
      return db
        .select()
        .from(SessionLinkTable)
        .where(where(conditions))
        .all()
        .map((item) => view.parse(item))
    }

    if (tx) return read(tx)
    return Database.use(read)
  }

  export function byNode(input: z.input<typeof ByNodeInput>, tx?: Database.TxOrDb) {
    const parsed = ByNodeInput.parse(input)
    const read = (db: Database.TxOrDb) => {
      const conditions = [eq(SessionLinkTable.run_node_id, parsed.run_node_id)]
      if (parsed.role) conditions.push(eq(SessionLinkTable.role, parsed.role))
      return db
        .select()
        .from(SessionLinkTable)
        .where(where(conditions))
        .all()
        .map((item) => view.parse(item))
    }

    if (tx) return read(tx)
    return Database.use(read)
  }

  export function byAttempt(input: z.input<typeof ByAttemptInput>, tx?: Database.TxOrDb) {
    const parsed = ByAttemptInput.parse(input)
    const read = (db: Database.TxOrDb) => {
      const conditions = [eq(SessionLinkTable.run_attempt_id, parsed.run_attempt_id)]
      if (parsed.role) conditions.push(eq(SessionLinkTable.role, parsed.role))
      return db
        .select()
        .from(SessionLinkTable)
        .where(where(conditions))
        .all()
        .map((item) => view.parse(item))
    }

    if (tx) return read(tx)
    return Database.use(read)
  }

  export function hidden(input: z.input<typeof HiddenInput>, tx?: Database.TxOrDb) {
    const parsed = HiddenInput.parse(input)
    if (parsed.session_ids.length === 0) return new Set<string>()

    const read = (db: Database.TxOrDb) => {
      const rows = db
        .select({ session_id: SessionLinkTable.session_id })
        .from(SessionLinkTable)
        .where(and(inArray(SessionLinkTable.session_id, parsed.session_ids), eq(SessionLinkTable.visibility, "hidden")))
        .all()
      return new Set(rows.map((row) => row.session_id))
    }

    if (tx) return read(tx)
    return Database.use(read)
  }
}
