export type ValidationView = "workflow" | "library"

export type ValidationIssue = {
  code: string
  path: string
  message: string
}

export type ValidationItem = {
  id: string
  kind: string
  name: string
  path: string
  runnable: boolean
  errors: ValidationIssue[]
}

export type ValidationList = {
  endpoint: string
  items: ValidationItem[]
}

const endpoints: Record<ValidationView, string[]> = {
  workflow: [
    "/workflow",
    "/workflow/validation",
    "/workflows",
    "/workflows/validation",
    "/experimental/workflows",
    "/experimental/workflow",
  ],
  library: [
    "/library",
    "/library/validation",
    "/libraries",
    "/libraries/validation",
    "/experimental/libraries",
    "/experimental/library",
  ],
}

const asRecord = (input: unknown): Record<string, unknown> | undefined => {
  if (!input || typeof input !== "object") return
  return input as Record<string, unknown>
}

const asText = (input: unknown) => (typeof input === "string" ? input.trim() : "")

const asBool = (input: unknown) => (typeof input === "boolean" ? input : undefined)

const asArray = (input: unknown) => (Array.isArray(input) ? input : undefined)

const tail = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

const issueFrom = (input: unknown): ValidationIssue | undefined => {
  const row = asRecord(input)
  if (!row) return

  const code = asText(row.code ?? row.error_code ?? row.reason_code)
  const path = asText(row.path ?? row.pointer ?? row.field ?? row.location)
  const message = asText(row.message ?? row.detail ?? row.description ?? row.reason)
  if (!code || !message) return
  return {
    code,
    path,
    message,
  }
}

const issuesFrom = (row: Record<string, unknown>, validation?: Record<string, unknown>) =>
  (
    asArray(row.errors) ??
    asArray(row.validation_errors) ??
    asArray(row.issues) ??
    (validation ? asArray(validation.errors) : undefined) ??
    (validation ? asArray(validation.validation_errors) : undefined) ??
    (validation ? asArray(validation.issues) : undefined) ??
    []
  )
    .map(issueFrom)
    .filter((item): item is ValidationIssue => !!item)

const itemFrom = (input: unknown, view: ValidationView, index: number): ValidationItem | undefined => {
  const row = asRecord(input)
  if (!row) return

  const validation = asRecord(row.validation) ?? asRecord(row.result)
  const errors = issuesFrom(row, validation)
  const id = asText(row.id ?? row.key ?? row.path ?? row.file) || `${view}-${index + 1}`
  const path = asText(row.path ?? row.file ?? row.absolute ?? row.location) || id
  const name = asText(row.name ?? row.title ?? row.label) || tail(path) || id
  const kind = asText(row.kind ?? row.type ?? row.resource_kind) || view
  const runnable = asBool(row.runnable) ?? asBool(validation?.runnable) ?? errors.length === 0

  return {
    id,
    kind,
    name,
    path,
    runnable,
    errors,
  }
}

const rowsFrom = (view: ValidationView, payload: unknown) => {
  const root = asRecord(payload)
  const list =
    asArray(payload) ??
    asArray(root?.data) ??
    asArray(root?.items) ??
    asArray(root?.results) ??
    asArray(root?.resources) ??
    asArray(root?.workflows) ??
    asArray(root?.library) ??
    []

  return list
    .map((item, index) => itemFrom(item, view, index))
    .filter((item): item is ValidationItem => !!item)
    .sort((a, b) => {
      const path = a.path.localeCompare(b.path)
      if (path !== 0) return path
      return a.id.localeCompare(b.id)
    })
}

export const normalizeValidationList = (view: ValidationView, payload: unknown) => rowsFrom(view, payload)

const encodeDirectory = (directory: string) => (/[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory)

type ReadResult =
  | { type: "ok"; body: unknown }
  | { type: "missing" }
  | { type: "error"; message: string }

const readEndpoint = async (input: {
  baseUrl: string
  endpoint: string
  directory: string
  auth?: string
  fetch: typeof fetch
}): Promise<ReadResult> => {
  const url = `${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`
  const headers = new Headers({
    Accept: "application/json",
    "x-opencode-directory": encodeDirectory(input.directory),
  })
  if (input.auth) headers.set("Authorization", input.auth)

  const res = await input.fetch.call(globalThis, url, {
    method: "GET",
    headers,
  })

  if (res.status === 404) return { type: "missing" }
  if (!res.ok) {
    const detail = await res.text().then((body) => body.trim())
    const message = detail || `Request failed with status ${res.status}`
    return { type: "error", message }
  }

  const body = await res.json().catch(() => undefined)
  if (body === undefined) return { type: "error", message: "Validation endpoint returned invalid JSON." }
  return { type: "ok", body }
}

const resolveEndpoint = async (
  input: {
    baseUrl: string
    paths: string[]
    directory: string
    auth?: string
    fetch: typeof fetch
    view: ValidationView
  },
  index = 0,
): Promise<{ endpoint: string; body: unknown }> => {
  const endpoint = input.paths[index]
  if (!endpoint) throw new Error(`${input.view} validation list endpoint is unavailable`)

  const result = await readEndpoint({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch,
  })

  if (result.type === "missing") return resolveEndpoint(input, index + 1)
  if (result.type === "error") throw new Error(result.message)
  return {
    endpoint,
    body: result.body,
  }
}

export const loadValidationList = async (input: {
  view: ValidationView
  baseUrl: string
  directory: string
  auth?: string
  fetch?: typeof fetch
}): Promise<ValidationList> => {
  const result = await resolveEndpoint({
    baseUrl: input.baseUrl,
    paths: endpoints[input.view],
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
    view: input.view,
  })

  return {
    endpoint: result.endpoint,
    items: normalizeValidationList(input.view, result.body),
  }
}
