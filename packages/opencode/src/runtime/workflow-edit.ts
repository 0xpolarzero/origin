import { Database, and, desc, eq, lt, or } from "@/storage/db"
import { WorkflowEditTable } from "./runtime.sql"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { workflow_edit_action } from "./contract"
import z from "zod"

const view = z
  .object({
    id: uuid_v7,
    project_id: z.string(),
    workflow_id: z.string(),
    workflow_revision_id: uuid_v7,
    previous_workflow_revision_id: uuid_v7.nullable(),
    session_id: z.string().nullable(),
    action: workflow_edit_action,
    node_id: z.string().nullable(),
    note: z.string().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .strict()

const record_input = z
  .object({
    id: uuid_v7.optional(),
    project_id: z.string().min(1),
    workflow_id: z.string().min(1),
    workflow_revision_id: uuid_v7,
    previous_workflow_revision_id: uuid_v7.nullable().optional(),
    session_id: z.string().nullable().optional(),
    action: workflow_edit_action,
    node_id: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .strict()

const cursor = z.string().regex(/^\d+:[0-9a-f-]+$/i)

const list_input = z
  .object({
    project_id: z.string().min(1),
    workflow_id: z.string().min(1).optional(),
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

function row(id: string, db: Database.TxOrDb) {
  const item = db.select().from(WorkflowEditTable).where(eq(WorkflowEditTable.id, id)).get()
  if (!item) throw new Error(`workflow edit not found: ${id}`)
  return view.parse(item)
}

function mark(raw?: string) {
  if (!raw) return
  const split = raw.indexOf(":")
  const created_at = Number(raw.slice(0, split))
  const id = raw.slice(split + 1)
  return { created_at, id }
}

export namespace RuntimeWorkflowEdit {
  export const View = view
  export const RecordInput = record_input
  export const ListInput = list_input
  export const Page = page

  export function record(input: z.input<typeof RecordInput>, tx?: Database.TxOrDb) {
    const value = RecordInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const now = Date.now()
      const next = {
        id: create_uuid_v7(value.id),
        project_id: value.project_id,
        workflow_id: value.workflow_id,
        workflow_revision_id: value.workflow_revision_id,
        previous_workflow_revision_id: value.previous_workflow_revision_id ?? null,
        session_id: value.session_id ?? null,
        action: value.action,
        node_id: value.node_id ?? null,
        note: value.note ?? null,
        created_at: now,
        updated_at: now,
      }
      db.insert(WorkflowEditTable).values(next).run()
      return view.parse(next)
    }

    if (tx) return write(tx)
    return Database.transaction(write)
  }

  export function get(id: string, tx?: Database.TxOrDb) {
    if (tx) return row(id, tx)
    return Database.use((db) => row(id, db))
  }

  export function list(input: z.input<typeof ListInput>, tx?: Database.TxOrDb) {
    const value = ListInput.parse(input)
    const read = (db: Database.TxOrDb) => {
      const next = mark(value.cursor)
      const where = [eq(WorkflowEditTable.project_id, value.project_id)]
      if (value.workflow_id) where.push(eq(WorkflowEditTable.workflow_id, value.workflow_id))
      if (next) {
        where.push(
          or(
            lt(WorkflowEditTable.created_at, next.created_at),
            and(eq(WorkflowEditTable.created_at, next.created_at), lt(WorkflowEditTable.id, next.id)),
          )!,
        )
      }

      const rows = db
        .select()
        .from(WorkflowEditTable)
        .where(and(...where))
        .orderBy(desc(WorkflowEditTable.created_at), desc(WorkflowEditTable.id))
        .limit(value.limit + 1)
        .all()
        .map((item) => view.parse(item))

      const more = rows.length > value.limit
      const items = more ? rows.slice(0, value.limit) : rows
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
