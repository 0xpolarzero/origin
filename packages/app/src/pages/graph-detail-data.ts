export type GraphValidationIssue = {
  code: string
  path: string
  message: string
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
  when?: {
    ref: string
    op: string
    value: string | number | boolean | null
  }
  then?: GraphStep[]
  else?: GraphStep[]
  result?: "success" | "failure" | "noop"
}

export type GraphWorkflowItem = {
  id: string
  file: string
  runnable: boolean
  errors: GraphValidationIssue[]
  workflow?: {
    id: string
    name: string
    description?: string
    steps: GraphStep[]
    resources: Array<Record<string, unknown>>
  }
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

export type GraphSessionLink = {
  session_id: string
  role: "execution_node" | "run_followup"
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
const asBool = (value: unknown) => (typeof value === "boolean" ? value : undefined)
const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const asArray = (value: unknown) => (Array.isArray(value) ? value : [])

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

const issuesFrom = (value: unknown) => asArray(value).map(issueFrom).filter((item): item is GraphValidationIssue => !!item)

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

  return {
    id,
    kind,
    title,
    prompt:
      prompt && (asText(prompt.source) === "inline" || asText(prompt.source) === "resource")
        ? {
            source: asText(prompt.source) as "inline" | "resource",
            text: asText(prompt.text) || undefined,
            resource_id: asText(prompt.resource_id) || undefined,
          }
        : undefined,
    script:
      script && (asText(script.source) === "inline" || asText(script.source) === "resource")
        ? {
            source: asText(script.source) as "inline" | "resource",
            text: asText(script.text) || undefined,
            resource_id: asText(script.resource_id) || undefined,
          }
        : undefined,
    output: asRecord(row?.output),
    when:
      when && asText(when.ref)
        ? {
            ref: asText(when.ref),
            op: asText(when.op),
            value:
              typeof when.value === "string" || typeof when.value === "number" || typeof when.value === "boolean"
                ? when.value
                : when.value === null
                  ? null
                  : null,
          }
        : undefined,
    then: asArray(row?.then).map(stepFrom).filter((item): item is GraphStep => !!item),
    else: asArray(row?.else).map(stepFrom).filter((item): item is GraphStep => !!item),
    result: (() => {
      const result = asText(row?.result)
      if (result !== "success" && result !== "failure" && result !== "noop") return undefined
      return result
    })(),
  }
}

const workflowItemFrom = (value: unknown) => {
  const row = asRecord(value)
  const id = asText(row?.id)
  const file = asText(row?.file)
  if (!id || !file) return
  const workflow = asRecord(row?.workflow)
  return {
    id,
    file,
    runnable: asBool(row?.runnable) ?? false,
    errors: issuesFrom(row?.errors),
    workflow:
      workflow && asText(workflow.id) && asText(workflow.name)
        ? {
            id: asText(workflow.id),
            name: asText(workflow.name),
            description: asText(workflow.description) || undefined,
            steps: asArray(workflow.steps).map(stepFrom).filter((item): item is GraphStep => !!item),
            resources: asArray(workflow.resources).map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item),
          }
        : undefined,
  } satisfies GraphWorkflowItem
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
  if (role !== "execution_node" && role !== "run_followup") return
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
      .filter((item): item is GraphRunNode["attempts"][number] => !!item),
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

  const text = await response.text()
  if (!response.ok) throw new Error(messageFrom(response.status, text))
  if (!text.trim()) throw new Error("Graph detail endpoint returned an empty response.")

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("Graph detail endpoint returned invalid JSON.")
  }
}

export const loadWorkflowDetail = async (input: {
  baseUrl: string
  directory: string
  workflow_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/workflows/${encodeURIComponent(input.workflow_id)}/detail`
  const body = await read({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
  })
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
    resources: asArray(row?.resources).map(resourceFrom).filter((item): item is GraphWorkflowResource => !!item),
    runs: asArray(row?.runs).map(workflowRunFrom).filter((item): item is GraphWorkflowRun => !!item),
  } satisfies GraphWorkflowDetail
}

export const loadRunDetail = async (input: {
  baseUrl: string
  directory: string
  run_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/runs/${encodeURIComponent(input.run_id)}/detail`
  const body = await read({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
  })
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
      workflow_text: typeof snapshot.workflow_text === "string" ? snapshot.workflow_text : "",
      graph_json: {
        id: asText(graph.id),
        name: asText(graph.name),
        description: asText(graph.description) || undefined,
        steps: asArray(graph.steps).map(stepFrom).filter((item): item is GraphStep => !!item),
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
    nodes: asArray(row?.nodes).map(nodeFrom).filter((item): item is GraphRunNode => !!item),
    events: asArray(row?.events).map(eventFrom).filter((item): item is GraphRunEvent => !!item),
    followup: linkedSessionFrom(row?.followup) ?? null,
  } satisfies GraphRunDetail
}

export const loadWorkflowSessionLink = async (input: {
  baseUrl: string
  directory: string
  session_id: string
  auth?: string
  fetch?: Fetcher
}) => {
  const endpoint = `/workflow/session-link/${encodeURIComponent(input.session_id)}`
  const body = await read({
    baseUrl: input.baseUrl,
    endpoint,
    directory: input.directory,
    auth: input.auth,
    fetch: input.fetch ?? fetch,
  })
  return sessionLinkFrom(body) ?? null
}
