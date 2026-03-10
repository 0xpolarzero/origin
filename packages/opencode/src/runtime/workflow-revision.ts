import { Database, and, desc, eq } from "@/storage/db"
import z from "zod"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { WorkflowRevisionTable } from "./runtime.sql"

const view = z
  .object({
    id: uuid_v7,
    project_id: z.string(),
    workflow_id: z.string(),
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
    workflow_id: z.string().min(1),
    file: z.string().min(1),
    canonical_text: z.string().min(1),
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
    workflow_id: z.string().min(1),
  })
  .strict()

function hash(value: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(value)
  return hasher.digest("hex")
}

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(WorkflowRevisionTable).where(eq(WorkflowRevisionTable.id, id)).get()
  if (!value) throw new Error(`workflow revision not found: ${id}`)
  return view.parse(value)
}

function head_row(db: Database.TxOrDb, project_id: string, workflow_id: string) {
  const value = db
    .select()
    .from(WorkflowRevisionTable)
    .where(and(eq(WorkflowRevisionTable.project_id, project_id), eq(WorkflowRevisionTable.workflow_id, workflow_id)))
    .orderBy(desc(WorkflowRevisionTable.created_at), desc(WorkflowRevisionTable.id))
    .get()
  if (!value) return
  return view.parse(value)
}

export namespace RuntimeWorkflowRevision {
  export const View = view
  export const ObserveInput = observe_input
  export const GetInput = get_input
  export const HeadInput = head_input

  export function observe(input: z.input<typeof ObserveInput>, tx?: Database.TxOrDb) {
    const parsed = ObserveInput.parse(input)
    const write = (db: Database.TxOrDb) => {
      const current = head_row(db, parsed.project_id, parsed.workflow_id)
      const content_hash = hash(parsed.canonical_text)
      if (current && current.content_hash === content_hash && current.canonical_text === parsed.canonical_text) {
        return current
      }

      const now = current ? Math.max(Date.now(), current.created_at + 1) : Date.now()
      const created = {
        id: create_uuid_v7(parsed.id),
        project_id: parsed.project_id,
        workflow_id: parsed.workflow_id,
        file: parsed.file,
        content_hash,
        canonical_text: parsed.canonical_text,
        created_at: now,
        updated_at: now,
      }
      db.insert(WorkflowRevisionTable).values(created).run()
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

  export function head(input: z.input<typeof HeadInput>, tx?: Database.TxOrDb) {
    const parsed = HeadInput.parse(input)
    if (tx) return head_row(tx, parsed.project_id, parsed.workflow_id) ?? null
    return Database.use((db) => head_row(db, parsed.project_id, parsed.workflow_id) ?? null)
  }
}
