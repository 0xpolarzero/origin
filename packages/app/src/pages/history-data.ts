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

const encodeDirectory = (directory: string) => (/[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory)

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type ReadResult =
  | { type: "ok"; body: unknown }
  | { type: "error"; message: string }

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
    const text = await response.text().then((value) => value.trim())
    return {
      type: "error",
      message: text || `Request failed with status ${response.status}`,
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
  include_debug?: boolean
  include_user?: boolean
}) => {
  const query = new URLSearchParams()
  if (input.workspace) query.set("workspace", input.workspace)
  if (input.cursor) query.set("cursor", input.cursor)
  if (input.limit !== undefined) query.set("limit", `${input.limit}`)
  if (input.include_debug) query.set("include_debug", "true")
  if (input.include_user) query.set("include_user", "true")
  const encoded = query.toString()
  if (!encoded) return ""
  return `?${encoded}`
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
