import { Database, and, desc, eq, inArray, lt, ne, or } from "@/storage/db"
import z from "zod"
import { DispatchAttemptTable, DraftTable, OperationTable, RunTable } from "./runtime.sql"

const cursor_pattern = /^\d+:[0-9a-f-]+$/i

const page_input = z
  .object({
    workspace_id: z.string().optional(),
    cursor: z.string().regex(cursor_pattern).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    include_debug: z.boolean().default(false),
  })
  .strict()

const run_list_input = page_input

const operation_list_input = page_input
  .extend({
    include_user: z.boolean().default(false),
  })
  .strict()

const draft_list_input = page_input
  .extend({
    scope: z.enum(["pending", "processed"]).default("pending"),
  })
  .strict()

const run_item = z
  .object({
    id: z.string(),
    status: z.string(),
    trigger_type: z.string(),
    workflow_id: z.string().nullable(),
    workspace_id: z.string(),
    session_id: z.string().nullable(),
    reason_code: z.string().nullable(),
    failure_code: z.string().nullable(),
    ready_for_integration_at: z.number().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
    started_at: z.number().nullable(),
    finished_at: z.number().nullable(),
    operation_id: z.string().nullable(),
    operation_exists: z.boolean(),
    duplicate_event: z
      .object({
        reason: z.boolean(),
        failure: z.boolean(),
      })
      .strict(),
  })
  .strict()

const operation_item = z
  .object({
    id: z.string(),
    run_id: z.string(),
    run_exists: z.boolean(),
    status: z.string(),
    trigger_type: z.string(),
    workflow_id: z.string().nullable(),
    workspace_id: z.string(),
    session_id: z.string().nullable(),
    ready_for_integration_at: z.number().nullable(),
    changed_paths: z.array(z.string()),
    created_at: z.number(),
    updated_at: z.number(),
    provenance: z.enum(["app", "user"]),
  })
  .strict()

const draft_item = z
  .object({
    id: z.string(),
    run_id: z.string().nullable(),
    workspace_id: z.string(),
    status: z.string(),
    source_kind: z.string(),
    adapter_id: z.string(),
    integration_id: z.string(),
    action_id: z.string(),
    target: z.string(),
    payload_json: z.record(z.string(), z.unknown()),
    payload_schema_version: z.number().int().positive(),
    preview_text: z.string(),
    material_hash: z.string(),
    block_reason_code: z.string().nullable(),
    policy_id: z.string().nullable(),
    policy_version: z.string().nullable(),
    decision_id: z.string().nullable(),
    decision_reason_code: z.string().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
    dispatch: z
      .object({
        id: z.string(),
        state: z.string(),
        idempotency_key: z.string(),
        remote_reference: z.string().nullable(),
        block_reason_code: z.string().nullable(),
      })
      .nullable(),
  })
  .strict()

const run_page = z
  .object({
    items: z.array(run_item),
    next_cursor: z.string().nullable(),
  })
  .strict()

const operation_page = z
  .object({
    items: z.array(operation_item),
    next_cursor: z.string().nullable(),
  })
  .strict()

const draft_page = z
  .object({
    items: z.array(draft_item),
    next_cursor: z.string().nullable(),
  })
  .strict()

type Mark = {
  created_at: number
  id: string
}

function mark(value?: string): Mark | undefined {
  if (!value) return
  const split = value.indexOf(":")
  const created_at = Number(value.slice(0, split))
  const id = value.slice(split + 1)
  return {
    created_at,
    id,
  }
}

function cursor(input: Mark) {
  return `${input.created_at}:${input.id}`
}

export namespace RuntimeHistory {
  export const RunListInput = run_list_input
  export const OperationListInput = operation_list_input
  export const DraftListInput = draft_list_input
  export const RunItem = run_item
  export const OperationItem = operation_item
  export const DraftItem = draft_item
  export const RunPage = run_page
  export const OperationPage = operation_page
  export const DraftPage = draft_page

  export function runs(input: z.input<typeof RunListInput>) {
    const value = RunListInput.parse(input)
    if (!value.workspace_id) {
      return RunPage.parse({
        items: [],
        next_cursor: null,
      })
    }

    return Database.use((db) => {
      const next = mark(value.cursor)
      const parts = [eq(RunTable.workspace_id, value.workspace_id!)]
      if (!value.include_debug) parts.push(ne(RunTable.trigger_type, "debug"))
      if (next) {
        parts.push(
          or(
            lt(RunTable.created_at, next.created_at),
            and(eq(RunTable.created_at, next.created_at), lt(RunTable.id, next.id)),
          )!,
        )
      }

      const rows = db
        .select()
        .from(RunTable)
        .where(and(...parts))
        .orderBy(desc(RunTable.created_at), desc(RunTable.id))
        .limit(value.limit + 1)
        .all()

      const more = rows.length > value.limit
      const page = more ? rows.slice(0, value.limit) : rows
      const run_ids = page.map((item) => item.id)
      const links = run_ids.length
        ? db
            .select({
              id: OperationTable.id,
              run_id: OperationTable.run_id,
              created_at: OperationTable.created_at,
            })
            .from(OperationTable)
            .where(inArray(OperationTable.run_id, run_ids))
            .orderBy(desc(OperationTable.created_at), desc(OperationTable.id))
            .all()
        : []
      const ops = new Map<string, string>()
      for (const item of links) {
        if (ops.has(item.run_id)) continue
        ops.set(item.run_id, item.id)
      }

      return RunPage.parse({
        items: page.map((item) => {
          const operation_id = ops.get(item.id) ?? null
          return {
            id: item.id,
            status: item.status,
            trigger_type: item.trigger_type,
            workflow_id: item.workflow_id,
            workspace_id: item.workspace_id,
            session_id: item.session_id,
            reason_code: item.reason_code,
            failure_code: item.failure_code,
            ready_for_integration_at: item.ready_for_integration_at,
            created_at: item.created_at,
            updated_at: item.updated_at,
            started_at: item.started_at,
            finished_at: item.finished_at,
            operation_id,
            operation_exists: operation_id !== null,
            duplicate_event: {
              reason: item.reason_code === "duplicate_event",
              failure: item.failure_code === "duplicate_event",
            },
          }
        }),
        next_cursor: more ? cursor(page[page.length - 1]!) : null,
      })
    })
  }

  export function operations(input: z.input<typeof OperationListInput>) {
    const value = OperationListInput.parse(input)
    if (!value.workspace_id) {
      return OperationPage.parse({
        items: [],
        next_cursor: null,
      })
    }

    return Database.use((db) => {
      const next = mark(value.cursor)
      const parts = [eq(OperationTable.workspace_id, value.workspace_id!)]
      if (!value.include_debug) parts.push(ne(OperationTable.trigger_type, "debug"))
      if (!value.include_user) parts.push(eq(OperationTable.actor_type, "system"))
      if (next) {
        parts.push(
          or(
            lt(OperationTable.created_at, next.created_at),
            and(eq(OperationTable.created_at, next.created_at), lt(OperationTable.id, next.id)),
          )!,
        )
      }

      const rows = db
        .select()
        .from(OperationTable)
        .where(and(...parts))
        .orderBy(desc(OperationTable.created_at), desc(OperationTable.id))
        .limit(value.limit + 1)
        .all()

      const more = rows.length > value.limit
      const page = more ? rows.slice(0, value.limit) : rows
      const run_ids = [...new Set(page.map((item) => item.run_id))]
      const links = run_ids.length
        ? db
            .select({ id: RunTable.id })
            .from(RunTable)
            .where(inArray(RunTable.id, run_ids))
            .all()
        : []
      const runs = new Set(links.map((item) => item.id))

      return OperationPage.parse({
        items: page.map((item) => ({
          id: item.id,
          run_id: item.run_id,
          run_exists: runs.has(item.run_id),
          status: item.status,
          trigger_type: item.trigger_type,
          workflow_id: item.workflow_id,
          workspace_id: item.workspace_id,
          session_id: item.session_id,
          ready_for_integration_at: item.ready_for_integration_at,
          changed_paths: item.changed_paths ?? [],
          created_at: item.created_at,
          updated_at: item.updated_at,
          provenance: item.actor_type === "user" ? "user" : "app",
        })),
        next_cursor: more ? cursor(page[page.length - 1]!) : null,
      })
    })
  }

  export function drafts(input: z.input<typeof DraftListInput>) {
    const value = DraftListInput.parse(input)
    if (!value.workspace_id) {
      return DraftPage.parse({
        items: [],
        next_cursor: null,
      })
    }

    return Database.use((db) => {
      const next = mark(value.cursor)
      const statuses =
        value.scope === "pending"
          ? (["pending", "blocked", "approved", "auto_approved"] as const)
          : (["sent", "rejected", "failed"] as const)
      const parts = [eq(DraftTable.workspace_id, value.workspace_id!), inArray(DraftTable.status, statuses)]
      if (next) {
        parts.push(
          or(
            lt(DraftTable.updated_at, next.created_at),
            and(eq(DraftTable.updated_at, next.created_at), lt(DraftTable.id, next.id)),
          )!,
        )
      }

      const rows = db
        .select()
        .from(DraftTable)
        .where(and(...parts))
        .orderBy(desc(DraftTable.updated_at), desc(DraftTable.id))
        .limit(value.limit + 1)
        .all()

      const more = rows.length > value.limit
      const page = more ? rows.slice(0, value.limit) : rows
      const draft_ids = page.map((item) => item.id)
      const dispatches = draft_ids.length
        ? db
            .select()
            .from(DispatchAttemptTable)
            .where(inArray(DispatchAttemptTable.draft_id, draft_ids))
            .all()
        : []
      const attempts = new Map(dispatches.map((item) => [item.draft_id, item] as const))

      return DraftPage.parse({
        items: page.map((item) => {
          const dispatch = attempts.get(item.id)
          return {
            ...item,
            dispatch: dispatch
              ? {
                  id: dispatch.id,
                  state: dispatch.state,
                  idempotency_key: dispatch.idempotency_key,
                  remote_reference: dispatch.remote_reference,
                  block_reason_code: dispatch.block_reason_code,
                }
              : null,
          }
        }),
        next_cursor: more
          ? cursor({
              created_at: page[page.length - 1]!.updated_at,
              id: page[page.length - 1]!.id,
            })
          : null,
      })
    })
  }
}
