export type GraphScalar = string | number | boolean | null

export type GraphWorkflowAction = "builder" | "node_edit" | "graph_edit" | "duplicate" | "hide"
export type GraphSessionRole = "builder" | "node_edit" | "execution_node" | "run_followup"

export type GraphValidationIssue = {
  code: string
  path: string
  message: string
}

export type GraphWorkflowTrigger = {
  type: string
}

export type GraphInputOption = {
  label: string
  value: GraphScalar
}

export type GraphManualInput = {
  key: string
  type: string
  label: string
  required: boolean
  default?: GraphScalar
  options?: GraphInputOption[]
  mode?: string
}

export type GraphWorkflowRef =
  | {
      id: string
      source: "local"
      kind: string
      path: string
    }
  | {
      id: string
      source: "library"
      kind: string
      item_id: string
    }

export type GraphStep = {
  id: string
  kind: "agent_request" | "script" | "condition" | "end"
  title: string
  prompt?: {
    source: "inline" | "resource"
    text?: string
    resource_id?: string
  }
  script?: {
    source: "inline" | "resource"
    text?: string
    resource_id?: string
  }
  output?: Record<string, unknown>
  cwd?: string
  when?: {
    ref: string
    op: string
    value: GraphScalar
  }
  then?: GraphStep[]
  else?: GraphStep[]
  result?: "success" | "failure" | "noop"
}

export type GraphWorkflowSchema = {
  schema_version: 2
  id: string
  name: string
  description?: string
  trigger: GraphWorkflowTrigger
  inputs: GraphManualInput[]
  resources: GraphWorkflowRef[]
  steps: GraphStep[]
}

export type GraphWorkflowItem = {
  id: string
  file: string
  runnable: boolean
  errors: GraphValidationIssue[]
  workflow?: GraphWorkflowSchema
}

export type GraphWorkflowSummary = {
  id: string
  file: string
  name: string
  description?: string
  runnable: boolean
  errors: GraphValidationIssue[]
  trigger_summary: string
  last_run: {
    id: string
    status: string
    created_at: number
    started_at: number | null
    finished_at: number | null
  } | null
  last_edit: {
    created_at: number
    action: GraphWorkflowAction
    note: string | null
  } | null
}

export type GraphWorkflowPage = {
  endpoint: string
  items: GraphWorkflowSummary[]
}

export type GraphWorkflowValidateResult = {
  endpoint: string
  ok: true
  workflow_id: string
  workspace_id: string
}

export type GraphWorkflowResource =
  | {
      id: string
      source: "local"
      kind: string
      path: string
      used_by: string[]
      errors: GraphValidationIssue[]
    }
  | {
      id: string
      source: "library"
      kind: string
      item_id: string
      used_by: string[]
      errors: GraphValidationIssue[]
    }

export type GraphWorkflowRun = {
  id: string
  status: string
  workflow_id: string | null
  workspace_id: string
  created_at: number
  started_at: number | null
  finished_at: number | null
  reason_code: string | null
  failure_code: string | null
}

export type GraphWorkflowDetail = {
  endpoint: string
  item: GraphWorkflowItem
  revision_head: {
    id: string
    workflow_id: string
    content_hash: string
    created_at: number
  } | null
  resources: GraphWorkflowResource[]
  runs: GraphWorkflowRun[]
}

export type GraphWorkflowBuildResult = {
  endpoint: string
  workflow_id: string
  file: string
  session_id: string
}

export type GraphWorkflowCopyResult = {
  endpoint: string
  workflow_id: string
  file: string
}

export type GraphWorkflowHideResult = {
  endpoint: string
  workflow_id: string
  hidden: true
  file: string
  target: string
}

export type GraphWorkflowHistoryItem = {
  edit: {
    id: string
    workflow_id: string
    workflow_revision_id: string
    previous_workflow_revision_id: string | null
    session_id: string | null
    action: GraphWorkflowAction
    node_id: string | null
    note: string | null
    created_at: number
  }
  revision: {
    id: string
    workflow_id: string
    file: string
    content_hash: string
    canonical_text: string
    created_at: number
  }
  previous_revision: {
    id: string
    workflow_id: string
    file: string
    content_hash: string
    canonical_text: string
    created_at: number
  } | null
  diff: string
  session: {
    id: string
    title: string
    directory: string
  } | null
}

export type GraphWorkflowHistoryPage = {
  endpoint: string
  items: GraphWorkflowHistoryItem[]
  next_cursor: string | null
}

export type GraphSessionLink = {
  session_id: string
  role: GraphSessionRole
  visibility: "hidden" | "visible"
  run_id: string | null
  run_node_id: string | null
  run_attempt_id: string | null
  readonly: boolean
}

export type GraphRunAttempt = {
  id: string
  attempt_index: number
  status: string
  session_id: string | null
  output_json: Record<string, unknown> | null
  error_json: Record<string, unknown> | null
  started_at: number | null
  finished_at: number | null
}

export type GraphLinkedSession = {
  link: GraphSessionLink
  session: {
    id: string
    title: string
    directory: string
  } | null
}

export type GraphRunInfo = {
  endpoint: string
  id: string
  status: string
  trigger_type: string
  workflow_id: string | null
  workspace_id: string
  session_id: string | null
  reason_code: string | null
  failure_code: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

export type GraphRunNode = {
  node: {
    id: string
    node_id: string
    kind: string
    title: string
    status: string
    skip_reason_code: string | null
    output_json: Record<string, unknown> | null
    error_json: Record<string, unknown> | null
    attempt_count: number
  }
  step: GraphStep
  attempts: Array<{
    attempt: GraphRunAttempt
    session: GraphLinkedSession | null
  }>
}

export type GraphRunEvent = {
  sequence: number
  event_type: string
  payload_json: Record<string, unknown>
  run_node_id: string | null
  run_attempt_id: string | null
}

export type GraphRunDetail = {
  endpoint: string
  run: {
    id: string
    status: string
    workflow_id: string | null
    workspace_id: string
    session_id: string | null
    reason_code: string | null
    failure_code: string | null
    created_at: number
    started_at: number | null
    finished_at: number | null
    integration_candidate: {
      changed_paths: string[]
    } | null
  }
  snapshot: {
    id: string
    workflow_id: string
    workflow_revision_id: string
    workflow_hash: string
    workflow_text: string
    graph_json: {
      id: string
      name: string
      description?: string
      steps: GraphStep[]
    }
    input_json: Record<string, unknown>
    input_store_json: Record<string, unknown>
    resource_materials_json: Record<string, unknown>
  }
  revision: {
    id: string
    workflow_id: string
    content_hash: string
    created_at: number
  }
  live: {
    current_revision_id: string | null
    has_newer_revision: boolean
  }
  nodes: GraphRunNode[]
  events: GraphRunEvent[]
  followup: GraphLinkedSession | null
}


const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "")
const asString = (value: unknown) => (typeof value === "string" ? value : "")
const asBool = (value: unknown) => (typeof value === "boolean" ? value : undefined)
const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const asArray = (value: unknown) => (Array.isArray(value) ? value : [])
const asScalar = (value: unknown): GraphScalar | undefined =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined
const has = <T,>(value: T | null | undefined): value is T => value !== undefined && value !== null

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

const asJson = (value: unknown) => asRecord(value) ?? null

const actionFrom = (value: unknown) => {
  const action = asText(value)
  if (action === "builder" || action === "node_edit" || action === "graph_edit" || action === "duplicate" || action === "hide") {
    return action
  }
}

const issueFrom = (value: unknown) => {
  const row = asRecord(value)
  const code = asText(row?.code)
  const path = asText(row?.path)
  const message = asText(row?.message)
  if (!code || !message) return
  return {
    code,
    path,
    message,
  } satisfies GraphValidationIssue
}

const issuesFrom = (value: unknown) => asArray(value).map(issueFrom).filter(has)

const optionFrom = (value: unknown) => {
  const row = asRecord(value)
  const label = asText(row?.label)
  const item = asScalar(row?.value)
  if (!label || item === undefined) return
  return {
    label,
    value: item,
  } satisfies GraphInputOption
}

const inputFrom = (value: unknown) => {
  const row = asRecord(value)
  const key = asText(row?.key)
  const type = asText(row?.type)
  const label = asText(row?.label)
  const required = asBool(row?.required)
  if (!key || !type || !label || required === undefined) return
  const item = asScalar(row?.default)
  return {
    key,
    type,
    label,
    required,
    default: item,
    options: asArray(row?.options).map(optionFrom).filter(has),
    mode: asText(row?.mode) || undefined,
  } satisfies GraphManualInput
}

const workflowRefFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const source = asText(row?.source)
  const kind = asText(row?.kind)
  if (!id || !kind) return
  if (source === "local") {
    return {
      id,
      source,
      kind,
      path: asText(row?.path),
    } satisfies GraphWorkflowRef
  }
  if (source === "library") {
    return {
      id,
      source,
      kind,
      item_id: asText(row?.item_id),
    } satisfies GraphWorkflowRef
  }
}

const stepFrom = (value: unknown): GraphStep | undefined => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const kind = asText(row?.kind)
  const title = asText(row?.title)
  if (!id || !title) return
  if (kind !== "agent_request" && kind !== "script" && kind !== "condition" && kind !== "end") return

  const prompt = asRecord(row?.prompt)
  const script = asRecord(row?.script)
  const when = asRecord(row?.when)
  const then = asArray(row?.then).map(stepFrom).filter(has)
  const alt = asArray(row?.else).map(stepFrom).filter(has)

  return {
    id,
    kind,
    title,
    prompt:
      prompt && (asText(prompt.source) === "inline" || asText(prompt.source) === "resource")
        ? {
            source: asText(prompt.source) as "inline" | "resource",
            text: asString(prompt.text) || undefined,
            resource_id: asText(prompt.resource_id) || undefined,
          }
        : undefined,
    script:
      script && (asText(script.source) === "inline" || asText(script.source) === "resource")
        ? {
            source: asText(script.source) as "inline" | "resource",
            text: asString(script.text) || undefined,
            resource_id: asText(script.resource_id) || undefined,
          }
        : undefined,
    output: asRecord(row?.output),
    cwd: asText(row?.cwd) || undefined,
    when:
      when && asText(when.ref)
        ? {
            ref: asText(when.ref),
            op: asText(when.op),
            value: asScalar(when.value) ?? null,
          }
        : undefined,
    then: kind === "condition" ? then : undefined,
    else: kind === "condition" ? alt : undefined,
    result: (() => {
      const result = asText(row?.result)
      if (result !== "success" && result !== "failure" && result !== "noop") return undefined
      return result
    })(),
  }
}

const workflowSchemaFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const name = asText(row?.name)
  if (!id || !name) return
  return {
    schema_version: 2,
    id,
    name,
    description: asText(row?.description) || undefined,
    trigger: {
      type: asText(asRecord(row?.trigger)?.type) || "manual",
    },
    inputs: asArray(row?.inputs).map(inputFrom).filter(has),
    resources: asArray(row?.resources).map(workflowRefFrom).filter(has),
    steps: asArray(row?.steps).map(stepFrom).filter(has),
  } satisfies GraphWorkflowSchema
}

const workflowItemFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const file = asText(row?.file)
  if (!id || !file) return
  return {
    id,
    file,
    runnable: asBool(row?.runnable) ?? false,
    errors: issuesFrom(row?.errors),
    workflow: workflowSchemaFrom(row?.workflow),
  } satisfies GraphWorkflowItem
}

const summaryRunFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const status = asText(row?.status)
  const created_at = asNumber(row?.created_at)
  if (!id || !status || created_at === undefined) return
  return {
    id,
    status,
    created_at,
    started_at: asNullableNumber(row?.started_at),
    finished_at: asNullableNumber(row?.finished_at),
  } satisfies NonNullable<GraphWorkflowSummary["last_run"]>
}

const workflowSummaryFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const file = asText(row?.file ?? row?.path)
  const name = asText(row?.name)
  if (!id || !file || !name) return
  return {
    id,
    file,
    name,
    description: asText(row?.description) || undefined,
    runnable: asBool(row?.runnable) ?? false,
    errors: issuesFrom(row?.errors),
    trigger_summary: asText(row?.trigger_summary) || "manual",
    last_run: summaryRunFrom(row?.last_run) ?? null,
    last_edit: (() => {
      const edit = asRecord(row?.last_edit)
      const action = actionFrom(edit?.action)
      const created_at = asNumber(edit?.created_at)
      if (!edit || !action || created_at === undefined) return null
      return {
        created_at,
        action,
        note: asNullableText(edit?.note),
      }
    })(),
  } satisfies GraphWorkflowSummary
}

const resourceFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const source = asText(row?.source)
  const kind = asText(row?.kind)
  if (!id || !kind) return
  if (source === "local") {
    return {
      id,
      source,
      kind,
      path: asText(row?.path),
      used_by: asArray(row?.used_by).map(asText).filter(Boolean),
      errors: issuesFrom(row?.errors),
    } satisfies GraphWorkflowResource
  }
  if (source === "library") {
    return {
      id,
      source,
      kind,
      item_id: asText(row?.item_id),
      used_by: asArray(row?.used_by).map(asText).filter(Boolean),
      errors: issuesFrom(row?.errors),
    } satisfies GraphWorkflowResource
  }
}

const workflowRunFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const status = asText(row?.status)
  const workspace_id = asText(row?.workspace_id)
  const created_at = asNumber(row?.created_at)
  if (!id || !status || !workspace_id || created_at === undefined) return
  return {
    id,
    status,
    workflow_id: asNullableText(row?.workflow_id),
    workspace_id,
    created_at,
    started_at: asNullableNumber(row?.started_at),
    finished_at: asNullableNumber(row?.finished_at),
    reason_code: asNullableText(row?.reason_code),
    failure_code: asNullableText(row?.failure_code),
  } satisfies GraphWorkflowRun
}

const sessionLinkFrom = (value: unknown) => {
  const row = asRecord(value)
  const session_id = asText(row?.session_id)
  const role = asText(row?.role)
  const visibility = asText(row?.visibility)
  if (!session_id) return
  if (role !== "builder" && role !== "node_edit" && role !== "execution_node" && role !== "run_followup") return
  if (visibility !== "hidden" && visibility !== "visible") return
  return {
    session_id,
    role,
    visibility,
    run_id: asNullableText(row?.run_id),
    run_node_id: asNullableText(row?.run_node_id),
    run_attempt_id: asNullableText(row?.run_attempt_id),
    readonly: asBool(row?.readonly) ?? false,
  } satisfies GraphSessionLink
}

const linkedSessionFrom = (value: unknown) => {
  if (value === null) return null
  const row = asRecord(value)
  const link = sessionLinkFrom(row?.link)
  if (!link) return
  const session = asRecord(row?.session)
  return {
    link,
    session:
      session && asText(session.id)
        ? {
            id: asText(session.id),
            title: asText(session.title),
            directory: asText(session.directory),
          }
        : null,
  } satisfies GraphLinkedSession
}

const runInfoFrom = (endpoint: string, body: unknown) => {
  const row = asRecord(body)
  const id = asText(row?.id)
  const status = asText(row?.status)
  const trigger_type = asText(row?.trigger_type)
  const workspace_id = asText(row?.workspace_id)
  const created_at = asNumber(row?.created_at)
  const updated_at = asNumber(row?.updated_at)
  if (!id || !status || !trigger_type || !workspace_id) throw new Error("Workflow run payload is invalid.")
  if (created_at === undefined || updated_at === undefined) throw new Error("Workflow run payload is invalid.")
  return {
    endpoint,
    id,
    status,
    trigger_type,
    workflow_id: asNullableText(row?.workflow_id),
    workspace_id,
    session_id: asNullableText(row?.session_id),
    reason_code: asNullableText(row?.reason_code),
    failure_code: asNullableText(row?.failure_code),
    created_at,
    updated_at,
    started_at: asNullableNumber(row?.started_at),
    finished_at: asNullableNumber(row?.finished_at),
  } satisfies GraphRunInfo
}

const revisionFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const workflow_id = asText(row?.workflow_id)
  const file = asText(row?.file)
  const content_hash = asText(row?.content_hash)
  const canonical_text = asString(row?.canonical_text)
  const created_at = asNumber(row?.created_at)
  if (!id || !workflow_id || !file || !content_hash || !canonical_text || created_at === undefined) return
  return {
    id,
    workflow_id,
    file,
    content_hash,
    canonical_text,
    created_at,
  } satisfies GraphWorkflowHistoryItem["revision"]
}

const historyItemFrom = (value: unknown) => {
  const row = asRecord(value)
  const edit = asRecord(row?.edit)
  const action = actionFrom(edit?.action)
  const created_at = asNumber(edit?.created_at)
  const revision = revisionFrom(row?.revision)
  if (!edit || !action || created_at === undefined || !revision) return
  return {
    edit: {
      id: asText(edit.id),
      workflow_id: asText(edit.workflow_id),
      workflow_revision_id: asText(edit.workflow_revision_id),
      previous_workflow_revision_id: asNullableText(edit.previous_workflow_revision_id),
      session_id: asNullableText(edit.session_id),
      action,
      node_id: asNullableText(edit.node_id),
      note: asNullableText(edit.note),
      created_at,
    },
    revision,
    previous_revision: revisionFrom(row?.previous_revision) ?? null,
    diff: asString(row?.diff),
    session: (() => {
      const session = asRecord(row?.session)
      if (!session || !asText(session.id)) return null
      return {
        id: asText(session.id),
        title: asText(session.title),
        directory: asText(session.directory),
      }
    })(),
  } satisfies GraphWorkflowHistoryItem
}

const attemptFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const status = asText(row?.status)
  const attempt_index = asNumber(row?.attempt_index)
  if (!id || !status || attempt_index === undefined) return
  return {
    id,
    attempt_index,
    status,
    session_id: asNullableText(row?.session_id),
    output_json: asJson(row?.output_json),
    error_json: asJson(row?.error_json),
    started_at: asNullableNumber(row?.started_at),
    finished_at: asNullableNumber(row?.finished_at),
  } satisfies GraphRunAttempt
}

const nodeFrom = (value: unknown) => {
  const row = asRecord(value)
  const node = asRecord(row?.node)
  const step = stepFrom(row?.step)
  const id = asText(node?.id)
  const node_id = asText(node?.node_id)
  const status = asText(node?.status)
  const kind = asText(node?.kind)
  const title = asText(node?.title)
  const attempt_count = asNumber(node?.attempt_count)
  if (!id || !node_id || !status || !kind || !title || attempt_count === undefined || !step) return
  return {
    node: {
      id,
      node_id,
      kind,
      title,
      status,
      skip_reason_code: asNullableText(node?.skip_reason_code),
      output_json: asJson(node?.output_json),
      error_json: asJson(node?.error_json),
      attempt_count,
    },
    step,
    attempts: asArray(row?.attempts)
      .map((item) => {
        const next = asRecord(item)
        const attempt = attemptFrom(next?.attempt)
        const session = linkedSessionFrom(next?.session)
        if (!attempt) return
        return {
          attempt,
          session: session ?? null,
        }
      })
      .filter(has),
  } satisfies GraphRunNode
}

const eventFrom = (value: unknown) => {
  const row = asRecord(value)
  const sequence = asNumber(row?.sequence)
  const event_type = asText(row?.event_type)
  if (sequence === undefined || !event_type) return
  return {
    sequence,
    event_type,
    payload_json: asRecord(row?.payload_json) ?? {},
    run_node_id: asNullableText(row?.run_node_id),
    run_attempt_id: asNullableText(row?.run_attempt_id),
  } satisfies GraphRunEvent
}

const encodeDirectory = (directory: string) => (/[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory)

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

const workspace = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  fetch: Fetcher
}) => {
  const base = input.baseUrl.replace(/\/$/, "")
  const headers = new Headers({
    Accept: "application/json",
  })
  if (input.auth) headers.set("Authorization", input.auth)
  const endpoint = `/experimental/workspace?directory=${encodeURIComponent(input.directory)}`
  const listed = await input.fetch.call(globalThis, `${base}${endpoint}`, {
    method: "GET",
    headers,
  })
  const text = await listed.text()
  if (!listed.ok) throw new Error(messageFrom(listed.status, text))
  const body = text.trim() ? (JSON.parse(text) as unknown) : []
  const rows = Array.isArray(body) ? body : []
  const found = rows.find(
    (item): item is { id: string; directory?: string; config?: { directory?: string } } =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      ((item as { directory?: string }).directory === input.directory ||
        (item as { config?: { directory?: string } }).config?.directory === input.directory),
  )
  if (found) return found.id

  const id = `wrk_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
  const created = await input.fetch.call(globalThis, `${base}/experimental/workspace/${id}?directory=${encodeURIComponent(input.directory)}`, {
    method: "POST",
    headers: new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(input.auth ? { Authorization: input.auth } : {}),
    }),
    body: JSON.stringify({
      branch: null,
      config: {
        type: "worktree",
        directory: input.directory,
      },
    }),
  })
  const payload = await created.text()
  if (!created.ok) throw new Error(messageFrom(created.status, payload))
  const row = payload.trim() ? (JSON.parse(payload) as unknown) : null
  const next = asRecord(row)
  const created_id = asText(next?.id)
  if (!created_id) throw new Error("Workspace response is invalid.")
  return created_id
}

const request = async (input: {
  baseUrl: string
  endpoint: string
  directory: string
  method: "GET" | "POST" | "PUT" | "DELETE"
  auth?: string
  body?: unknown
  fetch: Fetcher
}) => {
  const url = `${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`
  const headers = new Headers({
    Accept: "application/json",
    "x-opencode-directory": encodeDirectory(input.directory),
  })
  if (input.auth) headers.set("Authorization", input.auth)
  if (input.body !== undefined) headers.set("Content-Type", "application/json")

  const response = await input.fetch.call(globalThis, url, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })

  const text = await response.text()
  if (!response.ok) throw new Error(messageFrom(response.status, text))
  if (!text.trim()) throw new Error("Graph detail endpoint returned an empty response.")

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("Graph detail endpoint returned invalid JSON.")
  }
}

const workflowDetailFrom = (endpoint: string, body: unknown) => {
  const row = asRecord(body)
  const item = workflowItemFrom(row?.item)
  if (!item) throw new Error("Workflow detail payload is invalid.")
  const revision = asRecord(row?.revision_head)
  return {
    endpoint,
    item,
    revision_head:
      revision && asText(revision.id)
        ? {
            id: asText(revision.id),
            workflow_id: asText(revision.workflow_id),
            content_hash: asText(revision.content_hash),
            created_at: asNumber(revision.created_at) ?? 0,
          }
        : null,
    resources: asArray(row?.resources).map(resourceFrom).filter(has),
    runs: asArray(row?.runs).map(workflowRunFrom).filter(has),
  } satisfies GraphWorkflowDetail
}

const runDetailFrom = (endpoint: string, body: unknown) => {
  const row = asRecord(body)
  const run = asRecord(row?.run)
  const snapshot = asRecord(row?.snapshot)
  const revision = asRecord(row?.revision)
  const live = asRecord(row?.live)
  if (!run || !snapshot || !revision || !live) throw new Error("Run detail payload is invalid.")
  const graph = asRecord(snapshot.graph_json)
  if (!asText(run.id) || !graph) throw new Error("Run detail payload is invalid.")
  return {
    endpoint,
    run: {
      id: asText(run.id),
      status: asText(run.status),
      workflow_id: asNullableText(run.workflow_id),
      workspace_id: asText(run.workspace_id),
      session_id: asNullableText(run.session_id),
      reason_code: asNullableText(run.reason_code),
      failure_code: asNullableText(run.failure_code),
      created_at: asNumber(run.created_at) ?? 0,
      started_at: asNullableNumber(run.started_at),
      finished_at: asNullableNumber(run.finished_at),
      integration_candidate: (() => {
        const item = asRecord(run.integration_candidate)
        if (!item) return null
        return {
          changed_paths: asArray(item.changed_paths).map(asText).filter(Boolean),
        }
      })(),
    },
    snapshot: {
      id: asText(snapshot.id),
      workflow_id: asText(snapshot.workflow_id),
      workflow_revision_id: asText(snapshot.workflow_revision_id),
      workflow_hash: asText(snapshot.workflow_hash),
      workflow_text: asString(snapshot.workflow_text),
      graph_json: {
        id: asText(graph.id),
        name: asText(graph.name),
        description: asText(graph.description) || undefined,
        steps: asArray(graph.steps).map(stepFrom).filter(has),
      },
      input_json: asRecord(snapshot.input_json) ?? {},
      input_store_json: asRecord(snapshot.input_store_json) ?? {},
      resource_materials_json: asRecord(snapshot.resource_materials_json) ?? {},
    },
    revision: {
      id: asText(revision.id),
      workflow_id: asText(revision.workflow_id),
      content_hash: asText(revision.content_hash),
      created_at: asNumber(revision.created_at) ?? 0,
    },
    live: {
      current_revision_id: asNullableText(live.current_revision_id),
      has_newer_revision: asBool(live.has_newer_revision) ?? false,
    },
    nodes: asArray(row?.nodes).map(nodeFrom).filter(has),
    events: asArray(row?.events).map(eventFrom).filter(has),
    followup: linkedSessionFrom(row?.followup) ?? null,
  } satisfies GraphRunDetail
}

export const loadWorkflowPage = async (input: {
  baseUrl: string
  directory: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = "/workflow/workflows"
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "GET",
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  const items = asArray(row?.items ?? row?.data)
    .map(workflowSummaryFrom)
    .filter(has)
  return {
    endpoint,
    items,
  } satisfies GraphWorkflowPage
}

export const buildWorkflow = async (input: {
  baseUrl: string
  directory: string
  prompt: string
  name?: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = "/workflow/workflows/build"
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: {
      prompt: input.prompt,
      name: input.name,
    },
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  const workflow_id = asText(row?.workflow_id)
  const file = asText(row?.file)
  const session_id = asText(row?.session_id)
  if (!workflow_id || !file || !session_id) throw new Error("Workflow build payload is invalid.")
  return {
    endpoint,
    workflow_id,
    file,
    session_id,
  } satisfies GraphWorkflowBuildResult
}

export const openWorkflowSession = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  role: "builder" | "node_edit"
  node_id?: string
  title?: string
  text?: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/workflows/${encodeURIComponent(input.workflow_id)}/session`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: {
      role: input.role,
      node_id: input.node_id,
      title: input.title,
      text: input.text,
    },
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  const session_id = asText(row?.session_id)
  if (!session_id) throw new Error("Workflow session payload is invalid.")
  return {
    endpoint,
    session_id,
  }
}

export const loadWorkflowHistory = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  cursor?: string
  auth?: string
  fetch?: Fetcher
}) => {
  const query = input.cursor ? `?cursor=${encodeURIComponent(input.cursor)}` : ""
  const endpoint = `/workflow/workflows/${encodeURIComponent(input.workflow_id)}/history${query}`
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
    items: asArray(row?.items).map(historyItemFrom).filter(has),
    next_cursor: asNullableText(row?.next_cursor),
  } satisfies GraphWorkflowHistoryPage
}

export const loadWorkflowDetail = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/workflows/${encodeURIComponent(input.workflow_id)}/detail`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "GET",
    fetch: input.fetch ?? fetch,
  })
  return workflowDetailFrom(endpoint, body)
}

export const copyWorkflow = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  name?: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/workflows/${encodeURIComponent(input.workflow_id)}/copy`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: {
      name: input.name,
    },
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  const workflow_id = asText(row?.workflow_id)
  const file = asText(row?.file)
  if (!workflow_id || !file) throw new Error("Workflow copy payload is invalid.")
  return {
    endpoint,
    workflow_id,
    file,
  } satisfies GraphWorkflowCopyResult
}

export const hideWorkflow = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/workflows/${encodeURIComponent(input.workflow_id)}/hide`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: {},
    fetch: input.fetch ?? fetch,
  })
  const row = asRecord(body)
  const workflow_id = asText(row?.workflow_id)
  const file = asText(row?.file)
  const target = asText(row?.target)
  if (!workflow_id || !file || !target || row?.hidden !== true) throw new Error("Workflow hide payload is invalid.")
  return {
    endpoint,
    workflow_id,
    hidden: true,
    file,
    target,
  } satisfies GraphWorkflowHideResult
}

export const saveWorkflow = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  workflow: GraphWorkflowSchema
  file?: string
  resources?: Record<string, string>
  action?: GraphWorkflowAction
  session_id?: string | null
  node_id?: string | null
  note?: string | null
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/workflows/${encodeURIComponent(input.workflow_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "PUT",
    body: {
      workflow: input.workflow,
      file: input.file,
      resources: input.resources ?? {},
      action: input.action ?? "graph_edit",
      session_id: input.session_id ?? null,
      node_id: input.node_id ?? null,
      note: input.note ?? null,
    },
    fetch: input.fetch ?? fetch,
  })
  return workflowDetailFrom(endpoint, body)
}

export const validateWorkflowRun = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const fetcher = input.fetch ?? fetch
  const workspace_id = await workspace({
    baseUrl: input.baseUrl,
    directory: input.directory,
    auth: input.auth,
    fetch: fetcher,
  })
  const endpoint = `/workflow/run/validate?workspace=${encodeURIComponent(workspace_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: {
      workflow_id: input.workflow_id,
    },
    fetch: fetcher,
  })
  const row = asRecord(body)
  const workflow_id = asText(row?.workflow_id)
  if (row?.ok !== true || !workflow_id) throw new Error("Workflow validation payload is invalid.")
  return {
    endpoint,
    ok: true,
    workflow_id,
    workspace_id,
  } satisfies GraphWorkflowValidateResult
}

export const startWorkflowRun = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  inputs?: Record<string, unknown>
  auth?: string
  fetch?: Fetcher
}) => {
  const fetcher = input.fetch ?? fetch
  const workspace_id = await workspace({
    baseUrl: input.baseUrl,
    directory: input.directory,
    auth: input.auth,
    fetch: fetcher,
  })
  const endpoint = `/workflow/run/start?workspace=${encodeURIComponent(workspace_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: {
      workflow_id: input.workflow_id,
      inputs: input.inputs ?? {},
    },
    fetch: fetcher,
  })
  return runInfoFrom(endpoint, body)
}

export const rerunWorkflowRun = async (input: {
  baseUrl: string
  directory: string
  run_id: string
  node_id?: string
  auth?: string
  fetch?: Fetcher
}) => {
  const fetcher = input.fetch ?? fetch
  const workspace_id = await workspace({
    baseUrl: input.baseUrl,
    directory: input.directory,
    auth: input.auth,
    fetch: fetcher,
  })
  const endpoint = `/workflow/runs/${encodeURIComponent(input.run_id)}/rerun?workspace=${encodeURIComponent(workspace_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "POST",
    body: input.node_id
      ? {
          node_id: input.node_id,
        }
      : {},
    fetch: fetcher,
  })
  return runInfoFrom(endpoint, body)
}

export const loadRunDetail = async (input: {
  baseUrl: string
  directory: string
  run_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/runs/${encodeURIComponent(input.run_id)}/detail`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "GET",
    fetch: input.fetch ?? fetch,
  })
  return runDetailFrom(endpoint, body)
}

export const loadWorkflowSessionLink = async (input: {
  baseUrl: string
  directory: string
  session_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/session-link/${encodeURIComponent(input.session_id)}`
  const body = await request({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    method: "GET",
    fetch: input.fetch ?? fetch,
  })
  return sessionLinkFrom(body) ?? null
}
