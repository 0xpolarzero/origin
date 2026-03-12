export type LibraryIssue = {
  code: string
  path: string
  message: string
}

export type LibraryKind = "query" | "script" | "prompt_template"

export type LibraryResource =
  | {
      schema_version: 1
      id: string
      name?: string
      kind: "query"
      query: string
      links: string[]
    }
  | {
      schema_version: 1
      id: string
      name?: string
      kind: "script"
      script: string
      links: string[]
    }
  | {
      schema_version: 1
      id: string
      name?: string
      kind: "prompt_template"
      template: string
      links: string[]
    }

export type LibraryRow = {
  id: string
  file: string
  name: string
  kind: LibraryKind | "unknown"
  source: "shared"
  runnable: boolean
  errors: LibraryIssue[]
  used_by: string[]
  last_edited_at: number | null
  resource: LibraryResource | null
}

export type LibraryRev = {
  id: string
  item_id: string
  file: string
  content_hash: string
  canonical_text: string
  created_at: number
  updated_at: number
}

export type LibraryUse = {
  workflow_id: string
  name: string
  file: string
}

export type LibraryDetail = {
  endpoint: string
  item: LibraryRow
  revision_head: LibraryRev | null
  canonical_text: string
  used_by: LibraryUse[]
}

export type LibraryHistoryItem = {
  revision: LibraryRev
  previous_revision: LibraryRev | null
  diff: string
}

export type LibraryHistoryPage = {
  endpoint: string
  items: LibraryHistoryItem[]
  next_cursor: string | null
}

export type LibraryCopy = {
  endpoint: string
  workflow_id: string
  resources: Array<{
    id: string
    path: string
  }>
}

const asRecord = (input: unknown): Record<string, unknown> | undefined => {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

const asText = (input: unknown) => (typeof input === "string" ? input.trim() : "")
const asString = (input: unknown) => (typeof input === "string" ? input : "")
const asBool = (input: unknown) => (typeof input === "boolean" ? input : undefined)
const asNumber = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : undefined)
const asArray = (input: unknown) => (Array.isArray(input) ? input : [])
const asNullableText = (input: unknown) => (input === null ? null : asText(input) || null)
const asNullableNumber = (input: unknown) => (input === null ? null : asNumber(input) ?? null)

const issueFrom = (input: unknown) => {
  const row = asRecord(input)
  const code = asText(row?.code)
  const path = asText(row?.path)
  const message = asText(row?.message)
  if (!code || !message) return
  return {
    code,
    path,
    message,
  } satisfies LibraryIssue
}

const resourceFrom = (input: unknown): LibraryResource | null => {
  const row = asRecord(input)
  const id = asText(row?.id)
  const kind = asText(row?.kind)
  const schema_version = asNumber(row?.schema_version)
  if (!id || schema_version !== 1) return null
  if (kind === "query") {
    const query = asString(row?.query)
    if (!query) return null
    return {
      schema_version,
      id,
      name: asText(row?.name) || undefined,
      kind,
      query,
      links: asArray(row?.links).map(asText).filter(Boolean),
    } satisfies LibraryResource
  }
  if (kind === "script") {
    const script = asString(row?.script)
    if (!script) return null
    return {
      schema_version,
      id,
      name: asText(row?.name) || undefined,
      kind,
      script,
      links: asArray(row?.links).map(asText).filter(Boolean),
    } satisfies LibraryResource
  }
  if (kind === "prompt_template") {
    const template = asString(row?.template)
    if (!template) return null
    return {
      schema_version,
      id,
      name: asText(row?.name) || undefined,
      kind,
      template,
      links: asArray(row?.links).map(asText).filter(Boolean),
    } satisfies LibraryResource
  }
  return null
}

const rowFrom = (input: unknown): LibraryRow | undefined => {
  const row = asRecord(input)
  const id = asText(row?.id)
  const file = asText(row?.file)
  if (!id || !file) return
  const resource = resourceFrom(row?.resource)
  return {
    id,
    file,
    name: resource?.name ?? id,
    kind: resource?.kind ?? "unknown",
    source: "shared",
    runnable: asBool(row?.runnable) ?? false,
    errors: asArray(row?.errors).map(issueFrom).filter((item): item is LibraryIssue => !!item),
    used_by: asArray(row?.used_by).map(asText).filter(Boolean),
    last_edited_at: asNullableNumber(row?.last_edited_at),
    resource,
  } satisfies LibraryRow
}

const revFrom = (input: unknown): LibraryRev | null | undefined => {
  if (input === null) return null
  const row = asRecord(input)
  const id = asText(row?.id)
  const item_id = asText(row?.item_id)
  const file = asText(row?.file)
  const content_hash = asText(row?.content_hash)
  const canonical_text = asString(row?.canonical_text)
  const created_at = asNumber(row?.created_at)
  const updated_at = asNumber(row?.updated_at)
  if (!id || !item_id || !file || !content_hash) return
  if (created_at === undefined || updated_at === undefined) return
  return {
    id,
    item_id,
    file,
    content_hash,
    canonical_text,
    created_at,
    updated_at,
  } satisfies LibraryRev
}

const useFrom = (input: unknown): LibraryUse | undefined => {
  const row = asRecord(input)
  const workflow_id = asText(row?.workflow_id)
  const name = asText(row?.name)
  const file = asText(row?.file)
  if (!workflow_id || !name || !file) return
  return {
    workflow_id,
    name,
    file,
  } satisfies LibraryUse
}

const historyFrom = (input: unknown): LibraryHistoryItem | undefined => {
  const row = asRecord(input)
  const revision = revFrom(row?.revision)
  const previous_revision = revFrom(row?.previous_revision)
  const diff = asString(row?.diff)
  if (!revision) return
  return {
    revision,
    previous_revision: previous_revision ?? null,
    diff,
  } satisfies LibraryHistoryItem
}

const encodeDirectory = (dir: string) => (/[^\x00-\x7F]/.test(dir) ? encodeURIComponent(dir) : dir)

const messageFrom = (status: number, value: string) => {
  const text = value.trim()
  if (!text) return `Request failed with status ${status}`
  try {
    const row = asRecord(JSON.parse(text))
    return asText(row?.message) || text
  } catch {
    return text
  }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const request = async (input: {
  baseUrl: string
  endpoint: string
  directory: string
  method: "GET" | "PUT" | "POST" | "DELETE"
  body?: unknown
  auth?: string
  fetch: Fetcher
}) => {
  const headers = new Headers({
    Accept: "application/json",
    "x-opencode-directory": encodeDirectory(input.directory),
  })
  if (input.auth) headers.set("Authorization", input.auth)
  if (input.body !== undefined) headers.set("Content-Type", "application/json")
  const res = await input.fetch.call(globalThis, `${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(messageFrom(res.status, text))
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("Library endpoint returned invalid JSON.")
  }
}

export const loadLibraryPage = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = "/library"
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "GET",
    fetch: input.fetch ?? fetch,
  })
  return {
    endpoint,
    items: asArray(body).map(rowFrom).filter((item): item is LibraryRow => !!item),
  }
}

export const loadLibraryDetail = async (input: {
  baseUrl: string
  directory: string
  item_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/library/items/${encodeURIComponent(input.item_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "GET",
    fetch: input.fetch ?? fetch,
  })
  return detailFrom(endpoint, body)
}

const detailFrom = (endpoint: string, body: unknown) => {
  const row = asRecord(body)
  const item = rowFrom(row?.item)
  if (!item) throw new Error("Library detail payload is invalid.")
  return {
    endpoint,
    item,
    revision_head: revFrom(row?.revision_head) ?? null,
    canonical_text: asString(row?.canonical_text),
    used_by: asArray(row?.used_by).map(useFrom).filter((item): item is LibraryUse => !!item),
  } satisfies LibraryDetail
}

export const loadLibraryHistory = async (input: {
  baseUrl: string
  directory: string
  item_id: string
  cursor?: string
  auth?: string
  fetch?: Fetcher
}) => {
  const query = input.cursor ? `?cursor=${encodeURIComponent(input.cursor)}` : ""
  const endpoint = `/library/items/${encodeURIComponent(input.item_id)}/history${query}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "GET",
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  return {
    endpoint,
    items: asArray(row?.items).map(historyFrom).filter((item): item is LibraryHistoryItem => !!item),
    next_cursor: asNullableText(row?.next_cursor),
  } satisfies LibraryHistoryPage
}

export const saveLibrary = async (input: {
  baseUrl: string
  directory: string
  item_id: string
  text: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/library/items/${encodeURIComponent(input.item_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "PUT",
    body: {
      text: input.text,
    },
    fetch: input.fetch ?? fetch,
  })
  return detailFrom(endpoint, body)
}

export const copyLibrary = async (input: {
  baseUrl: string
  directory: string
  item_id: string
  workflow_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/library/items/${encodeURIComponent(input.item_id)}/copy`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: {
      workflow_id: input.workflow_id,
    },
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  return {
    endpoint,
    workflow_id: asText(row?.workflow_id),
    resources: asArray(row?.resources)
      .map((item) => {
        const value = asRecord(item)
        const id = asText(value?.id)
        const path = asText(value?.path)
        if (!id || !path) return
        return { id, path }
      })
      .filter((item): item is { id: string; path: string } => !!item),
  } satisfies LibraryCopy
}

export const deleteLibrary = async (input: {
  baseUrl: string
  directory: string
  item_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/library/items/${encodeURIComponent(input.item_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "DELETE",
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  return {
    endpoint,
    deleted: row?.deleted === true,
  }
}
