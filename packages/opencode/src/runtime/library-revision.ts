import { Database, and, desc, eq, lt, or } from "@/storage/db"
import z from "zod"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { LibraryRevisionTable } from "./runtime.sql"

const view = z
  .object({
    id: uuid_v7,
    project_id: z.string(),
    item_id: z.string(),
    file: z.string(),
    content_hash: z.string(),
    canonical_text: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .strict()

const observe_input = z
  .object({
    id: uuid_v7.optional(),
    project_id: z.string().min(1),
    item_id: z.string().min(1),
    file: z.string().min(1),
    canonical_text: z.string(),
  })
  .strict()

const get_input = z
  .object({
    id: uuid_v7,
  })
  .strict()

const head_input = z
  .object({
    project_id: z.string().min(1),
    item_id: z.string().min(1),
  })
  .strict()

const cursor = z.string().regex(/^\d+:[0-9a-f-]+$/i)

const list_input = z
  .object({
    project_id: z.string().min(1),
    item_id: z.string().min(1),
    cursor: cursor.optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict()

const page = z
  .object({
    items: z.array(view),
    next_cursor: cursor.nullable(),
  })
  .strict()

function hash(value: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(value)
  return hasher.digest("hex")
}

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(LibraryRevisionTable).where(eq(LibraryRevisionTable.id, id)).get()
  if (!value) throw new Error(`library revision not found: ${id}`)
  return view.parse(value)
}

function head_row(db: Database.TxOrDb, project_id: string, item_id: string) {
  const value = db
    .select()
    .from(LibraryRevisionTable)
    .where(and(eq(LibraryRevisionTable.project_id, project_id), eq(LibraryRevisionTable.item_id, item_id)))
    .orderBy(desc(LibraryRevisionTable.created_at), desc(LibraryRevisionTable.id))
    .get()
  if (!value) return
  return view.parse(value)
}

function mark(raw?: string) {
  if (!raw) return
  const split = raw.indexOf(":")
  const created_at = Number(raw.slice(0, split))
  const id = raw.slice(split + 1)
  return { created_at, id }
}

export namespace RuntimeLibraryRevision {
  export const View = view
  export const ObserveInput = observe_input
  export const GetInput = get_input
  export const HeadInput = head_input
  export const ListInput = list_input
  export const Page = page

  export function observe(input: z.input<typeof ObserveInput>, tx?: Database.TxOrDb) {
    const parsed = ObserveInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const current = head_row(db, parsed.project_id, parsed.item_id)
      const content_hash = hash(parsed.canonical_text)
      if (current && current.content_hash === content_hash && current.canonical_text === parsed.canonical_text) {
        return current
      }

      const now = current ? Math.max(Date.now(), current.created_at + 1) : Date.now()
      const next = {
        id: create_uuid_v7(parsed.id),
        project_id: parsed.project_id,
        item_id: parsed.item_id,
        file: parsed.file,
        content_hash,
        canonical_text: parsed.canonical_text,
        created_at: now,
        updated_at: now,
      }
      db.insert(LibraryRevisionTable).values(next).run()
      return view.parse(next)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function get(input: z.input<typeof GetInput>, tx?: Database.TxOrDb) {
    const parsed = GetInput.parse(input)
    if (tx) return row(tx, parsed.id)
    return Database.use((db) => row(db, parsed.id))
  }

  export function head(input: z.input<typeof HeadInput>, tx?: Database.TxOrDb) {
    const parsed = HeadInput.parse(input)
    if (tx) return head_row(tx, parsed.project_id, parsed.item_id) ?? null
    return Database.use((db) => head_row(db, parsed.project_id, parsed.item_id) ?? null)
  }

  export function list(input: z.input<typeof ListInput>, tx?: Database.TxOrDb) {
    const parsed = ListInput.parse(input)
    const read = (db: Database.TxOrDb) => {
      const next = mark(parsed.cursor)
      const where = [eq(LibraryRevisionTable.project_id, parsed.project_id), eq(LibraryRevisionTable.item_id, parsed.item_id)]
      if (next) {
        where.push(
          or(
            lt(LibraryRevisionTable.created_at, next.created_at),
            and(eq(LibraryRevisionTable.created_at, next.created_at), lt(LibraryRevisionTable.id, next.id)),
          )!,
        )
      }

      const rows = db
        .select()
        .from(LibraryRevisionTable)
        .where(and(...where))
        .orderBy(desc(LibraryRevisionTable.created_at), desc(LibraryRevisionTable.id))
        .limit(parsed.limit + 1)
        .all()
        .map((item) => view.parse(item))

      const more = rows.length > parsed.limit
      const items = more ? rows.slice(0, parsed.limit) : rows
      const tail = items.at(-1)
      return page.parse({
        items,
        next_cursor: more && tail ? `${tail.created_at}:${tail.id}` : null,
      })
    }

    if (tx) return read(tx)
    return Database.use(read)
  }
}
