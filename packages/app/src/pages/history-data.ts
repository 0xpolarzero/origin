import type { DraftScope } from "./history-state"

export type HistoryRun = {
  id: string
  status: string
  trigger_type: string
  workflow_id: string | null
  workspace_id: string
  session_id: string | null
  reason_code: string | null
  failure_code: string | null
  ready_for_integration_at: number | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
  operation_id: string | null
  operation_exists: boolean
  trigger_metadata: Record<string, unknown> | null
  duplicate_event: {
    reason: boolean
    failure: boolean
  }
}

export type HistoryOperation = {
  id: string
  run_id: string
  run_exists: boolean
  status: string
  trigger_type: string
  workflow_id: string | null
  workspace_id: string
  session_id: string | null
  ready_for_integration_at: number | null
  changed_paths: string[]
  created_at: number
  updated_at: number
  provenance: "app" | "user"
}

export type HistoryDraftDispatch = {
  id: string
  state: string
  idempotency_key: string
  remote_reference: string | null
  block_reason_code: string | null
}

export type HistoryDraft = {
  id: string
  run_id: string | null
  workspace_id: string
  status: string
  source_kind: "user" | "system"
  adapter_id: string
  integration_id: string
  action_id: string
  target: string
  payload_json: Record<string, unknown>
  payload_schema_version: number
  preview_text: string
  material_hash: string
  block_reason_code: string | null
  policy_id: string | null
  policy_version: string | null
  decision_id: string | null
  decision_reason_code: string | null
  created_at: number
  updated_at: number
  dispatch: HistoryDraftDispatch | null
}

export type HistoryRunPage = {
  endpoint: string
  items: HistoryRun[]
  next_cursor: string | null
}

export type HistoryOperationPage = {
  endpoint: string
  items: HistoryOperation[]
  next_cursor: string | null
}

export type HistoryDraftPage = {
  endpoint: string
  items: HistoryDraft[]
  next_cursor: string | null
}

export type HistoryDraftSourceKind = HistoryDraft["source_kind"]
export type HistoryDraftActorType = "system" | "user"

export type HistoryDraftCreateInput = {
  run_id?: string | null
  source_kind: HistoryDraftSourceKind
  adapter_id: string
  integration_id: string
  action_id: string
  target: string
  payload_json: Record<string, unknown>
  payload_schema_version: number
  auto_approve?: boolean
  actor_type?: HistoryDraftActorType
}

export type HistoryDraftUpdateInput = {
  source_kind?: HistoryDraftSourceKind
  adapter_id?: string
  integration_id?: string
  action_id?: string
  target?: string
  payload_json?: Record<string, unknown>
  payload_schema_version?: number
  actor_type?: HistoryDraftActorType
}

export type HistoryDraftControlInput = {
  actor_type?: HistoryDraftActorType
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "")

const asBool = (value: unknown) => (typeof value === "boolean" ? value : undefined)

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const asNullableText = (value: unknown) => {
  if (value === null) return null
  const parsed = asText(value)
  if (!parsed) return null
  return parsed
}

const asNullableNumber = (value: unknown) => {
  if (value === null) return null
  const parsed = asNumber(value)
  if (parsed === undefined) return null
  return parsed
}

const asTextArray = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asText(item))
    .filter((item): item is string => !!item)
}

const asJsonRecord = (value: unknown) => {
  const row = asRecord(value)
  if (!row) return
  return row
}

const duplicate = (value: unknown) => {
  const row = asRecord(value)
  if (!row) {
    return {
      reason: false,
      failure: false,
    }
  }

  return {
    reason: asBool(row.reason) ?? false,
    failure: asBool(row.failure) ?? false,
  }
}

const runFrom = (value: unknown) => {
  const row = asRecord(value)
  if (!row) return

  const id = asText(row.id)
  const status = asText(row.status)
  const trigger_type = asText(row.trigger_type)
  const workspace_id = asText(row.workspace_id)
  const created_at = asNumber(row.created_at)
  const updated_at = asNumber(row.updated_at)

  if (!id || !status || !trigger_type || !workspace_id) return
  if (created_at === undefined || updated_at === undefined) return

  return {
    id,
    status,
    trigger_type,
    workflow_id: asNullableText(row.workflow_id),
    workspace_id,
    session_id: asNullableText(row.session_id),
    reason_code: asNullableText(row.reason_code),
    failure_code: asNullableText(row.failure_code),
    ready_for_integration_at: asNullableNumber(row.ready_for_integration_at),
    created_at,
    updated_at,
    started_at: asNullableNumber(row.started_at),
    finished_at: asNullableNumber(row.finished_at),
    operation_id: asNullableText(row.operation_id),
    operation_exists: asBool(row.operation_exists) ?? false,
    trigger_metadata: asJsonRecord(row.trigger_metadata) ?? null,
    duplicate_event: duplicate(row.duplicate_event),
  } satisfies HistoryRun
}

const operationFrom = (value: unknown) => {
  const row = asRecord(value)
  if (!row) return

  const id = asText(row.id)
  const run_id = asText(row.run_id)
  const status = asText(row.status)
  const trigger_type = asText(row.trigger_type)
  const workspace_id = asText(row.workspace_id)
  const created_at = asNumber(row.created_at)
  const updated_at = asNumber(row.updated_at)
  const provenance = asText(row.provenance)

  if (!id || !run_id || !status || !trigger_type || !workspace_id) return
  if (created_at === undefined || updated_at === undefined) return
  if (provenance !== "app" && provenance !== "user") return

  return {
    id,
    run_id,
    run_exists: asBool(row.run_exists) ?? false,
    status,
    trigger_type,
    workflow_id: asNullableText(row.workflow_id),
    workspace_id,
    session_id: asNullableText(row.session_id),
    ready_for_integration_at: asNullableNumber(row.ready_for_integration_at),
    changed_paths: asTextArray(row.changed_paths),
    created_at,
    updated_at,
    provenance,
  } satisfies HistoryOperation
}

const dispatchFrom = (value: unknown) => {
  if (value === null) return null
  const row = asRecord(value)
  if (!row) return

  const id = asText(row.id)
  const state = asText(row.state)
  const idempotency_key = asText(row.idempotency_key)
  if (!id || !state || !idempotency_key) return

  return {
    id,
    state,
    idempotency_key,
    remote_reference: asNullableText(row.remote_reference),
    block_reason_code: asNullableText(row.block_reason_code),
  } satisfies HistoryDraftDispatch
}

const draftFrom = (value: unknown) => {
  const row = asRecord(value)
  if (!row) return

  const id = asText(row.id)
  const workspace_id = asText(row.workspace_id)
  const status = asText(row.status)
  const source_kind = asText(row.source_kind)
  const adapter_id = asText(row.adapter_id)
  const integration_id = asText(row.integration_id)
  const action_id = asText(row.action_id)
  const target = asText(row.target)
  const payload_json = asJsonRecord(row.payload_json)
  const payload_schema_version = asNumber(row.payload_schema_version)
  const preview_text = typeof row.preview_text === "string" ? row.preview_text : undefined
  const material_hash = asText(row.material_hash)
  const created_at = asNumber(row.created_at)
  const updated_at = asNumber(row.updated_at)
  const dispatch = dispatchFrom(row.dispatch)

  if (!id || !workspace_id || !status || !adapter_id || !integration_id || !action_id || !target) return
  if (source_kind !== "user" && source_kind !== "system") return
  if (!payload_json || payload_schema_version === undefined) return
  if (preview_text === undefined || !material_hash) return
  if (created_at === undefined || updated_at === undefined) return
  if (dispatch === undefined) return

  return {
    id,
    run_id: asNullableText(row.run_id),
    workspace_id,
    status,
    source_kind,
    adapter_id,
    integration_id,
    action_id,
    target,
    payload_json,
    payload_schema_version,
    preview_text,
    material_hash,
    block_reason_code: asNullableText(row.block_reason_code),
    policy_id: asNullableText(row.policy_id),
    policy_version: asNullableText(row.policy_version),
    decision_id: asNullableText(row.decision_id),
    decision_reason_code: asNullableText(row.decision_reason_code),
    created_at,
    updated_at,
    dispatch,
  } satisfies HistoryDraft
}

export const normalizeRunPage = (payload: unknown) => {
  const row = asRecord(payload)
  const items = Array.isArray(row?.items)
    ? row.items
        .map((item) => runFrom(item))
        .filter((item): item is HistoryRun => !!item)
    : []

  return {
    items,
    next_cursor: asNullableText(row?.next_cursor),
  }
}

export const normalizeOperationPage = (payload: unknown) => {
  const row = asRecord(payload)
  const items = Array.isArray(row?.items)
    ? row.items
        .map((item) => operationFrom(item))
        .filter((item): item is HistoryOperation => !!item)
    : []

  return {
    items,
    next_cursor: asNullableText(row?.next_cursor),
  }
}

export const normalizeDraftPage = (payload: unknown) => {
  const row = asRecord(payload)
  const items = Array.isArray(row?.items)
    ? row.items
        .map((item) => draftFrom(item))
        .filter((item): item is HistoryDraft => !!item)
    : []

  return {
    items,
    next_cursor: asNullableText(row?.next_cursor),
  }
}

export const normalizeDraftDetail = (payload: unknown) => {
  const row = asRecord(payload)
  return (
    draftFrom(row?.item) ??
    draftFrom(row?.draft) ??
    draftFrom(row?.data) ??
    draftFrom(payload)
  )
}

const encodeDirectory = (directory: string) => (/[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory)

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type ReadResult =
  | { type: "ok"; body: unknown }
  | { type: "error"; message: string }

const messageFrom = (status: number, value: string) => {
  const text = value.trim()
  if (!text) return `Request failed with status ${status}`

  try {
    const row = asRecord(JSON.parse(text))
    const error = asRecord(row?.error)
    const data = asRecord(row?.data)
    return (
      asText(row?.message) ||
      asText(error?.message) ||
      asText(data?.message) ||
      text
    )
  } catch {
    return text
  }
}

const read = async (input: {
  baseUrl: string
  endpoint: string
  directory: string
  auth?: string
  fetch: Fetcher
}) => {
  const url = `${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`
  const headers = new Headers({
    Accept: "application/json",
    "x-opencode-directory": encodeDirectory(input.directory),
  })
  if (input.auth) headers.set("Authorization", input.auth)

  const response = await input.fetch.call(globalThis, url, {
    method: "GET",
    headers,
  })

  if (!response.ok) {
    const text = await response.text()
    return {
      type: "error",
      message: messageFrom(response.status, text),
    } satisfies ReadResult
  }

  const body = await response.json().catch(() => undefined)
  if (body === undefined) {
    return {
      type: "error",
      message: "History endpoint returned invalid JSON.",
    } satisfies ReadResult
  }

  return {
    type: "ok",
    body,
  } satisfies ReadResult
}

const append = (input: {
  workspace?: string
  cursor?: string
  limit?: number
  scope?: DraftScope
  include_debug?: boolean
  include_user?: boolean
}) => {
  const query = new URLSearchParams()
  if (input.workspace) query.set("workspace", input.workspace)
  if (input.cursor) query.set("cursor", input.cursor)
  if (input.limit !== undefined) query.set("limit", `${input.limit}`)
  if (input.scope) query.set("scope", input.scope)
  if (input.include_debug) query.set("include_debug", "true")
  if (input.include_user) query.set("include_user", "true")
  const encoded = query.toString()
  if (!encoded) return ""
  return `?${encoded}`
}

const write = async (input: {
  baseUrl: string
  endpoint: string
  directory: string
  auth?: string
  method: "POST" | "PATCH"
  body?: unknown
  fetch: Fetcher
}) => {
  const url = `${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`
  const headers = new Headers({
    Accept: "application/json",
    "x-opencode-directory": encodeDirectory(input.directory),
  })
  if (input.body !== undefined) headers.set("Content-Type", "application/json")
  if (input.auth) headers.set("Authorization", input.auth)

  const response = await input.fetch.call(globalThis, url, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })

  const text = await response.text()
  if (!response.ok) {
    return {
      type: "error",
      message: messageFrom(response.status, text),
    } satisfies ReadResult
  }

  if (!text.trim()) {
    return {
      type: "ok",
      body: undefined,
    } satisfies ReadResult
  }

  const body = (() => {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  })()
  if (body === undefined) {
    return {
      type: "error",
      message: "Draft endpoint returned invalid JSON.",
    } satisfies ReadResult
  }

  return {
    type: "ok",
    body,
  } satisfies ReadResult
}

export const loadHistoryRuns = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  cursor?: string
  limit?: number
  include_debug?: boolean
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/history/runs${append({
    workspace: input.workspace,
    cursor: input.cursor,
    limit: input.limit,
    include_debug: input.include_debug,
  })}`

  const result = await read({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
  })

  if (result.type === "error") throw new Error(result.message)

  return {
    endpoint,
    ...normalizeRunPage(result.body),
  } satisfies HistoryRunPage
}

export const loadHistoryOperations = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  cursor?: string
  limit?: number
  include_debug?: boolean
  include_user?: boolean
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/history/operations${append({
    workspace: input.workspace,
    cursor: input.cursor,
    limit: input.limit,
    include_debug: input.include_debug,
    include_user: input.include_user,
  })}`

  const result = await read({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
  })

  if (result.type === "error") throw new Error(result.message)

  return {
    endpoint,
    ...normalizeOperationPage(result.body),
  } satisfies HistoryOperationPage
}

export const loadHistoryDrafts = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  cursor?: string
  limit?: number
  scope?: DraftScope
  include_debug?: boolean
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/history/drafts${append({
    workspace: input.workspace,
    cursor: input.cursor,
    limit: input.limit,
    scope: input.scope,
    include_debug: input.include_debug,
  })}`

  const result = await read({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
  })

  if (result.type === "error") throw new Error(result.message)

  return {
    endpoint,
    ...normalizeDraftPage(result.body),
  } satisfies HistoryDraftPage
}

export const loadHistoryDraft = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  draft_id: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/drafts/${encodeURIComponent(input.draft_id)}${append({
    workspace: input.workspace,
  })}`
  const result = await read({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
  })

  if (result.type === "error") throw new Error(result.message)

  const item = normalizeDraftDetail(result.body)
  if (!item) throw new Error("Draft endpoint returned invalid JSON.")
  return item
}

const mutateDraft = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  endpoint: string
  method: "POST" | "PATCH"
  body?: unknown
  draft_id?: string
  fetch?: Fetcher
}) => {
  const result = await write({
    baseUrl: input.baseUrl,
    endpoint: input.endpoint,
    directory: input.directory,
    auth: input.auth,
    method: input.method,
    body: input.body,
    fetch: input.fetch ?? fetch,
  }).catch((error) => error)

  if (result instanceof Error) throw result
  if (result.type === "error") throw new Error(result.message)

  const item = result.body === undefined ? undefined : normalizeDraftDetail(result.body)
  if (item) return item
  if (input.draft_id) {
    return loadHistoryDraft({
      baseUrl: input.baseUrl,
      directory: input.directory,
      auth: input.auth,
      workspace: input.workspace,
      draft_id: input.draft_id,
      fetch: input.fetch,
    })
  }
  throw new Error("Draft endpoint returned invalid JSON.")
}

export const createHistoryDraft = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  body: HistoryDraftCreateInput
  fetch?: Fetcher
}) =>
  mutateDraft({
    baseUrl: input.baseUrl,
    directory: input.directory,
    auth: input.auth,
    workspace: input.workspace,
    endpoint: `/workflow/drafts${append({
      workspace: input.workspace,
    })}`,
    method: "POST",
    body: input.body,
    fetch: input.fetch,
  })

export const updateHistoryDraft = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  draft_id: string
  body: HistoryDraftUpdateInput
  fetch?: Fetcher
}) =>
  mutateDraft({
    baseUrl: input.baseUrl,
    directory: input.directory,
    auth: input.auth,
    workspace: input.workspace,
    endpoint: `/workflow/drafts/${encodeURIComponent(input.draft_id)}${append({
      workspace: input.workspace,
    })}`,
    method: "PATCH",
    body: input.body,
    draft_id: input.draft_id,
    fetch: input.fetch,
  })

const controlDraft = (path: string) => async (input: {
  baseUrl: string
  directory: string
  auth?: string
  workspace?: string
  draft_id: string
  body?: HistoryDraftControlInput
  fetch?: Fetcher
}) =>
  mutateDraft({
    baseUrl: input.baseUrl,
    directory: input.directory,
    auth: input.auth,
    workspace: input.workspace,
    endpoint: `/workflow/drafts/${encodeURIComponent(input.draft_id)}/${path}${append({
      workspace: input.workspace,
    })}`,
    method: "POST",
    body: input.body,
    draft_id: input.draft_id,
    fetch: input.fetch,
  })

export const approveHistoryDraft = controlDraft("approve")
export const rejectHistoryDraft = controlDraft("reject")
export const sendHistoryDraft = controlDraft("send")
