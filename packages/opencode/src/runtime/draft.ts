import { NotFoundError } from "@/storage/db"
import { Database, eq } from "@/storage/db"
import z from "zod"
import { RuntimeAudit } from "./audit"
import { actor_type, block_reason_code, draft_source_kind, draft_status } from "./contract"
import { RuntimeImmutableFieldError, RuntimeWorkspaceMismatchError } from "./error"
import { validate_draft_create, validate_draft_transition } from "./state"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import { DraftTable, RunTable } from "./runtime.sql"

const lineage = z.object({
  policy_id: z.string().nullable().optional(),
  policy_version: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  decision_reason_code: z.string().nullable().optional(),
})

const create_input = z.object({
  id: uuid_v7.optional(),
  run_id: uuid_v7.nullable().optional(),
  workspace_id: z.string(),
  status: draft_status.default("pending"),
  source_kind: draft_source_kind,
  adapter_id: z.string().min(1),
  integration_id: z.string().min(1),
  action_id: z.string().min(1),
  target: z.string().min(1),
  payload_json: z.record(z.string(), z.unknown()),
  payload_schema_version: z.number().int().positive(),
  preview_text: z.string(),
  material_hash: z.string().min(1),
  block_reason_code: block_reason_code.nullable().optional(),
  actor_type: actor_type.default("system"),
  policy_id: z.string().nullable().optional(),
  policy_version: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  decision_reason_code: z.string().nullable().optional(),
})

const update_input = z.object({
  id: uuid_v7,
  source_kind: draft_source_kind.optional(),
  adapter_id: z.string().min(1).optional(),
  integration_id: z.string().min(1).optional(),
  action_id: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  payload_json: z.record(z.string(), z.unknown()).optional(),
  payload_schema_version: z.number().int().positive().optional(),
  preview_text: z.string().optional(),
  material_hash: z.string().min(1).optional(),
  block_reason_code: block_reason_code.nullable().optional(),
  policy_id: z.string().nullable().optional(),
  policy_version: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  decision_reason_code: z.string().nullable().optional(),
})

const transition_input = z.object({
  id: uuid_v7,
  to: draft_status,
  block_reason_code: block_reason_code.nullable().optional(),
  actor_type: actor_type.default("system"),
  policy_id: z.string().nullable().optional(),
  policy_version: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  decision_reason_code: z.string().nullable().optional(),
})

const get_input = z.object({
  id: uuid_v7,
})

function row(db: Database.TxOrDb, id: string) {
  const value = db.select().from(DraftTable).where(eq(DraftTable.id, id)).get()
  if (value) return value
  throw new NotFoundError({ message: `Draft not found: ${id}` })
}

function create_row(input: z.infer<typeof create_input>) {
  validate_draft_create(input.status)
  const now = Date.now()
  return {
    id: create_uuid_v7(input.id),
    run_id: input.run_id ?? null,
    workspace_id: input.workspace_id,
    status: input.status,
    source_kind: input.source_kind,
    adapter_id: input.adapter_id,
    integration_id: input.integration_id,
    action_id: input.action_id,
    target: input.target,
    payload_json: input.payload_json,
    payload_schema_version: input.payload_schema_version,
    preview_text: input.preview_text,
    material_hash: input.material_hash,
    block_reason_code: input.block_reason_code ?? null,
    policy_id: input.policy_id ?? null,
    policy_version: input.policy_version ?? null,
    decision_id: input.decision_id ?? null,
    decision_reason_code: input.decision_reason_code ?? null,
    created_at: now,
    updated_at: now,
  }
}

function audit_lineage(input: z.infer<typeof lineage>, current: typeof DraftTable.$inferSelect) {
  return {
    policy_id: input.policy_id ?? current.policy_id,
    policy_version: input.policy_version ?? current.policy_version,
    decision_id: input.decision_id ?? current.decision_id,
    decision_reason_code: input.decision_reason_code ?? current.decision_reason_code,
  }
}

export namespace RuntimeDraft {
  export const CreateInput = create_input
  export const UpdateInput = update_input
  export const TransitionInput = transition_input
  export const GetInput = get_input

  export function create(input: z.input<typeof CreateInput>) {
    const parsed = CreateInput.parse(input)
    return Database.transaction((db) => {
      if (parsed.run_id) {
        const run = db.select().from(RunTable).where(eq(RunTable.id, parsed.run_id)).get()
        if (!run) throw new NotFoundError({ message: `Run not found: ${parsed.run_id}` })
        if (run.workspace_id !== parsed.workspace_id) {
          throw new RuntimeWorkspaceMismatchError({
            entity: "draft",
            run_id: parsed.run_id,
            run_workspace_id: run.workspace_id,
            workspace_id: parsed.workspace_id,
            code: "workspace_mismatch",
          })
        }
      }

      const row = create_row(parsed)
      db.insert(DraftTable).values(row).run()
      RuntimeAudit.write(
        {
          event_type: "draft.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: row.workspace_id,
          run_id: row.run_id,
          draft_id: row.id,
          integration_id: row.integration_id,
          event_payload: {
            from: "create",
            to: row.status,
            reason_code: row.block_reason_code ?? undefined,
          },
        },
        db,
      )
      return row
    })
  }

  export function update(input: z.input<typeof UpdateInput>) {
    const parsed = UpdateInput.parse(input)
    return Database.transaction((db) => {
      const current = row(db, parsed.id)
      const next = db
        .update(DraftTable)
        .set({
          source_kind: parsed.source_kind ?? current.source_kind,
          adapter_id: parsed.adapter_id ?? current.adapter_id,
          integration_id: parsed.integration_id ?? current.integration_id,
          action_id: parsed.action_id ?? current.action_id,
          target: parsed.target ?? current.target,
          payload_json: parsed.payload_json ?? current.payload_json,
          payload_schema_version: parsed.payload_schema_version ?? current.payload_schema_version,
          preview_text: parsed.preview_text ?? current.preview_text,
          material_hash: parsed.material_hash ?? current.material_hash,
          block_reason_code: parsed.block_reason_code === undefined ? current.block_reason_code : parsed.block_reason_code,
          ...audit_lineage(parsed, current),
          updated_at: Date.now(),
        })
        .where(eq(DraftTable.id, parsed.id))
        .returning()
        .get()
      if (next) return next
      throw new NotFoundError({ message: `Draft not found: ${parsed.id}` })
    })
  }

  export function transition(input: z.input<typeof TransitionInput>) {
    const parsed = TransitionInput.parse(input)
    return Database.transaction((db) => {
      const current = row(db, parsed.id)
      validate_draft_transition({
        from: current.status,
        to: parsed.to,
      })
      const updated = db
        .update(DraftTable)
        .set({
          status: parsed.to,
          block_reason_code: parsed.block_reason_code === undefined ? current.block_reason_code : parsed.block_reason_code,
          ...audit_lineage(parsed, current),
          updated_at: Date.now(),
        })
        .where(eq(DraftTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new NotFoundError({ message: `Draft not found: ${parsed.id}` })
      RuntimeAudit.write(
        {
          event_type: "draft.transitioned",
          actor_type: parsed.actor_type,
          workspace_id: updated.workspace_id,
          run_id: updated.run_id,
          draft_id: updated.id,
          integration_id: updated.integration_id,
          event_payload: {
            from: current.status,
            to: updated.status,
            reason_code: updated.block_reason_code ?? undefined,
          },
        },
        db,
      )
      return updated
    })
  }

  export function get(input: z.input<typeof GetInput>, tx?: Database.TxOrDb) {
    const parsed = GetInput.parse(input)
    if (tx) return row(tx, parsed.id)
    return Database.use((db) => row(db, parsed.id))
  }

  export function ensureImmutable(input: { before: typeof DraftTable.$inferSelect; after: typeof DraftTable.$inferSelect }) {
    if (input.before.workspace_id !== input.after.workspace_id) {
      throw new RuntimeImmutableFieldError({
        field: "workspace_id",
        code: "immutable_field",
      })
    }
    if (input.before.run_id !== input.after.run_id) {
      throw new RuntimeImmutableFieldError({
        field: "run_id",
        code: "immutable_field",
      })
    }
  }
}
