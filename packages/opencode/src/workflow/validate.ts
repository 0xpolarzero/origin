import path from "node:path"
import {
  type AuthoredNodeKind,
  type LibraryItem,
  type LibraryResource,
  type OutputContract,
  type ValidationIssue,
  type ValidationReport,
  type Workflow,
  type WorkflowItem,
  type WorkflowResource,
  type WorkflowStep,
  library_resource_schema,
  manual_input,
  output_contract,
  workspace_type,
  workflow_schema,
} from "./contract"
import { RuntimeWorkspaceType } from "@/runtime/workspace-type"
import z from "zod"

type StepMeta = {
  kind: AuthoredNodeKind
  output_paths: Set<string>
  order: number
}

type ConditionRef = {
  path: string
  ref: string
  order: number
}

type ResourceRef = {
  path: string
  resource_id: string
  kind: WorkflowResource["kind"]
}

type ParseState = {
  directory: string
  file: string
  workflow_id: string
  errors: ValidationIssue[]
  node_paths: Map<string, string[]>
  nodes: Map<string, StepMeta>
  conditions: ConditionRef[]
  resource_refs: ResourceRef[]
  order: number
}

function key(value: ValidationIssue) {
  return `${value.path}\u0000${value.code}\u0000${value.message}`
}

function sort_errors(value: ValidationIssue[]) {
  return value.toSorted((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    if (a.code !== b.code) return a.code.localeCompare(b.code)
    return a.message.localeCompare(b.message)
  })
}

function push(list: ValidationIssue[], value: ValidationIssue) {
  const exists = list.some((item) => key(item) === key(value))
  if (exists) return
  list.push(value)
}

function json_path(input: readonly PropertyKey[]) {
  if (!input.length) return "$"
  return input.reduce<string>((acc, item) => {
    if (typeof item === "number") return `${acc}[${item}]`
    if (typeof item === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) return `${acc}.${item}`
    return `${acc}[${JSON.stringify(String(item))}]`
  }, "$")
}

function zod_issue(pathname: readonly PropertyKey[], message: string): ValidationIssue {
  return {
    code: "schema_invalid",
    path: json_path(pathname),
    message,
  }
}

function ref(file: string, directory: string) {
  const relative = path.relative(directory, file)
  return relative.split(path.sep).join(path.posix.sep)
}

async function scan(directory: string, patterns: string[]) {
  const all = await Promise.all(
    patterns.map(async (pattern) => {
      const glob = new Bun.Glob(pattern)
      const values: string[] = []
      for await (const file of glob.scan({ cwd: directory, absolute: true, dot: true })) {
        values.push(file)
      }
      return values
    }),
  )
  return all.flat().toSorted((a, b) => a.localeCompare(b))
}

function parse_yaml(value: string) {
  try {
    return {
      value: Bun.YAML.parse(value),
      error: undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      value: undefined,
      error: {
        code: "yaml_parse_error" as const,
        path: "$",
        message,
      },
    }
  }
}

function id_from(file: string, doc: unknown) {
  if (doc && typeof doc === "object" && "id" in doc && typeof doc.id === "string" && doc.id.length) {
    return doc.id
  }
  return path.basename(file, path.extname(file))
}

function record(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function text(input: unknown) {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined
}

function array<T = unknown>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : undefined
}

function scalar(input: unknown) {
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean" || input === null) {
    return input
  }
}

function normalized_relative(value: string) {
  const raw = value.replaceAll("\\", "/").trim()
  if (!raw) return
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) return

  const normalized = path.posix.normalize(raw)

  if (!normalized || normalized === ".") return
  if (normalized === ".." || normalized.startsWith("../")) return
  return normalized
}

function resource_root(directory: string, workflow_id: string) {
  return path.join(directory, ".origin", "workflows", workflow_id)
}

function input_refs(value: string) {
  return [...value.matchAll(/{{\s*inputs\.([^}]+)\s*}}/g)].map((item) => item[1]?.trim()).filter(Boolean) as string[]
}

function visit_steps(steps: WorkflowStep[], fn: (step: WorkflowStep, path: string) => void, base = "$.steps") {
  steps.forEach((step, index) => {
    const current = `${base}[${index}]`
    fn(step, current)
    if (step.kind !== "condition") return
    visit_steps(step.then ?? [], fn, `${current}.then`)
    visit_steps(step.else ?? [], fn, `${current}.else`)
  })
}

async function prompt_text(
  directory: string,
  workflow: Workflow,
  resource: WorkflowResource,
  index: Map<string, LibraryItem[]>,
) {
  if (resource.kind !== "prompt_template") return
  if (resource.source === "local") {
    const target = path.join(resource_root(directory, workflow.id), resource.path)
    return Bun.file(target).text()
  }

  const match = index.get(resource.item_id)?.[0]
  if (!match?.resource || match.resource.kind !== "prompt_template") return
  return match.resource.template
}

async function validate_input_refs(
  directory: string,
  workflow: Workflow,
  errors: ValidationIssue[],
  index: Map<string, LibraryItem[]>,
) {
  const keys = new Set(workflow.inputs.map((item) => item.key))
  const resources = new Map(workflow.resources.map((item) => [item.id, item]))

  const checks: Promise<void>[] = []

  visit_steps(workflow.steps, (step, step_path) => {
    if (step.kind !== "agent_request" || !step.prompt) return

    if (step.prompt.source === "inline") {
      input_refs(step.prompt.text).forEach((value) => {
        if (keys.has(value)) return
        push(errors, {
          code: "input_ref_invalid",
          path: `${step_path}.prompt.text`,
          message: `prompt references undeclared input: ${value}`,
        })
      })
      return
    }

    const resource = resources.get(step.prompt.resource_id)
    if (!resource) return
    checks.push(
      prompt_text(directory, workflow, resource, index).then((value) => {
        if (!value) return
        input_refs(value).forEach((item) => {
          if (keys.has(item)) return
          push(errors, {
            code: "input_ref_invalid",
            path: `${step_path}.prompt.resource_id`,
            message: `prompt references undeclared input: ${item}`,
          })
        })
      }),
    )
  })

  await Promise.all(checks)
}

function scalar_paths(contract: OutputContract, prefix: string[] = []) {
  const out = new Set<string>()
  for (const [key, value] of Object.entries(contract.properties)) {
    if (value.type === "object") {
      scalar_paths(
        {
          type: "object",
          required: value.required,
          properties: value.properties,
        },
        [...prefix, key],
      ).forEach((item) => out.add(item))
      continue
    }
    out.add([...prefix, key].join("."))
  }
  return out
}

function push_schema(errors: ValidationIssue[], path_value: string, message: string) {
  push(errors, {
    code: "schema_invalid",
    path: path_value,
    message,
  })
}

function push_input(errors: ValidationIssue[], path_value: string, message: string) {
  push(errors, {
    code: "input_shape_invalid",
    path: path_value,
    message,
  })
}

function push_condition(errors: ValidationIssue[], path_value: string, message: string) {
  push(errors, {
    code: "condition_ref_invalid",
    path: path_value,
    message,
  })
}

async function check_link(
  directory: string,
  links: string[],
  pointer: (index: number) => string,
  errors: ValidationIssue[],
) {
  const root = path.join(directory, ".origin", "knowledge-base")

  await Promise.all(
    links.map(async (link, index) => {
      const normalized = normalized_relative(link)
      if (!normalized) {
        push(errors, {
          code: "reference_broken_link",
          path: pointer(index),
          message: "knowledge-base link must stay within .origin/knowledge-base",
        })
        return
      }
      const target = path.join(root, normalized)
      const exists = await Bun.file(target).exists()
      if (exists) return
      push(errors, {
        code: "reference_broken_link",
        path: pointer(index),
        message: `knowledge-base link not found: ${normalized}`,
      })
    }),
  )
}

function parse_inputs(raw: unknown, errors: ValidationIssue[]) {
  const values = array(raw)
  if (!values) {
    push_input(errors, "$.inputs", "inputs must be an array")
    return []
  }

  const parsed = values.flatMap((item, index) => {
    const result = manual_input.safeParse(item)
    if (result.success) return [{ index, item: result.data }]
    result.error.issues.forEach((issue) => {
      push_input(errors, json_path(["inputs", index, ...issue.path]), issue.message)
    })
    return []
  })

  const seen = new Map<string, number[]>()
  parsed.forEach((value) => {
    const list = seen.get(value.item.key) ?? []
    list.push(value.index)
    seen.set(value.item.key, list)
  })
  for (const indexes of seen.values()) {
    if (indexes.length < 2) continue
    indexes.forEach((index) => {
      const value = parsed.find((item) => item.index === index)?.item
      if (!value) return
      push(errors, {
        code: "input_key_duplicate",
        path: `$.inputs[${index}].key`,
        message: `duplicate input key: ${value.key}`,
      })
    })
  }

  return parsed.map((item) => item.item)
}

async function parse_resources(input: {
  directory: string
  workflow_id: string
  raw: unknown
  errors: ValidationIssue[]
}) {
  const values = array(input.raw)
  if (!values) {
    push_schema(input.errors, "$.resources", "resources must be an array")
    return []
  }

  const parsed: WorkflowResource[] = []
  const seen = new Map<string, number[]>()

  for (const [index, item] of values.entries()) {
    const row = record(item)
    if (!row) {
      push_schema(input.errors, `$.resources[${index}]`, "resource must be an object")
      continue
    }

    const id = text(row.id)
    if (!id) {
      push_schema(input.errors, `$.resources[${index}].id`, "resource id is required")
      continue
    }

    const kind = text(row.kind)
    if (kind !== "script" && kind !== "prompt_template") {
      push(input.errors, {
        code: "resource_kind_unsupported",
        path: `$.resources[${index}].kind`,
        message: `unsupported workflow resource kind: ${kind ?? "unknown"}`,
      })
      continue
    }

    const source = text(row.source)
    if (source === "local") {
      const resource_path = text(row.path)
      if (!resource_path) {
        push_schema(input.errors, `$.resources[${index}].path`, "local resource path is required")
        continue
      }
      const normalized = normalized_relative(resource_path)
      if (!normalized) {
        push(input.errors, {
          code: "local_resource_outside_workflow",
          path: `$.resources[${index}].path`,
          message: "workflow-local resources must stay inside the workflow resource root",
        })
        continue
      }

      const target = path.join(resource_root(input.directory, input.workflow_id), normalized)
      const exists = await Bun.file(target).exists()
      if (!exists) {
        push(input.errors, {
          code: "local_resource_missing",
          path: `$.resources[${index}].path`,
          message: `workflow-local resource not found: ${normalized}`,
        })
        continue
      }

      parsed.push({
        id,
        source: "local",
        kind,
        path: normalized,
      })
    } else if (source === "library") {
      const item_id = text(row.item_id)
      if (!item_id) {
        push_schema(input.errors, `$.resources[${index}].item_id`, "library resource item_id is required")
        continue
      }

      parsed.push({
        id,
        source: "library",
        kind,
        item_id,
      })
    } else {
      push_schema(input.errors, `$.resources[${index}].source`, "resource source must be local or library")
      continue
    }

    const list = seen.get(id) ?? []
    list.push(index)
    seen.set(id, list)
  }

  for (const [id, indexes] of seen.entries()) {
    if (indexes.length < 2) continue
    indexes.forEach((index) =>
      push(input.errors, {
        code: "resource_id_duplicate",
        path: `$.resources[${index}].id`,
        message: `duplicate workflow resource id: ${id}`,
      }),
    )
  }

  return parsed
}

function parse_prompt(row: Record<string, unknown>, base: string, state: ParseState) {
  const prompt = record(row.prompt)
  if (!prompt) {
    push_schema(state.errors, `${base}.prompt`, "agent_request prompt is required")
    return
  }
  const source = text(prompt.source)
  if (source === "inline") {
    const value = text(prompt.text)
    if (!value) {
      push_schema(state.errors, `${base}.prompt.text`, "inline prompt text is required")
      return
    }
    return { source: "inline" as const, text: value }
  }
  if (source === "resource") {
    const resource_id = text(prompt.resource_id)
    if (!resource_id) {
      push_schema(state.errors, `${base}.prompt.resource_id`, "prompt resource_id is required")
      return
    }
    state.resource_refs.push({
      path: `${base}.prompt.resource_id`,
      resource_id,
      kind: "prompt_template",
    })
    return { source: "resource" as const, resource_id }
  }
  push_schema(state.errors, `${base}.prompt.source`, "prompt source must be inline or resource")
}

function parse_script_source(row: Record<string, unknown>, base: string, state: ParseState) {
  const script = record(row.script)
  if (!script) {
    push_schema(state.errors, `${base}.script`, "script source is required")
    return
  }
  const source = text(script.source)
  if (source === "inline") {
    const value = text(script.text)
    if (!value) {
      push_schema(state.errors, `${base}.script.text`, "inline script text is required")
      return
    }
    return { source: "inline" as const, text: value }
  }
  if (source === "resource") {
    const resource_id = text(script.resource_id)
    if (!resource_id) {
      push_schema(state.errors, `${base}.script.resource_id`, "script resource_id is required")
      return
    }
    state.resource_refs.push({
      path: `${base}.script.resource_id`,
      resource_id,
      kind: "script",
    })
    return { source: "resource" as const, resource_id }
  }
  push_schema(state.errors, `${base}.script.source`, "script source must be inline or resource")
}

function parse_output(row: Record<string, unknown>, base: string, errors: ValidationIssue[]) {
  if (row.output === undefined) return
  const result = output_contract.safeParse(row.output)
  if (result.success) return result.data
  result.error.issues.forEach((issue) => {
    const suffix = issue.path.reduce<string>((acc, item) => {
      if (typeof item === "number") return `${acc}[${item}]`
      return `${acc}.${String(item)}`
    }, "")
    push_schema(errors, `${base}.output${suffix}`, issue.message)
  })
}

function parse_step_list(values: unknown, path_value: string, state: ParseState): WorkflowStep[] {
  const list = array(values)
  if (!list) {
    push_schema(state.errors, path_value, "steps must be an array")
    return []
  }
  return list.flatMap((item, index) => {
    const value = parse_step(item, `${path_value}[${index}]`, state)
    return value ? [value] : []
  })
}

function parse_step(raw: unknown, path_value: string, state: ParseState): WorkflowStep | undefined {
  const row = record(raw)
  if (!row) {
    push_schema(state.errors, path_value, "step must be an object")
    return
  }

  const id = text(row.id)
  if (!id) {
    push(state.errors, {
      code: "schema_invalid",
      path: `${path_value}.id`,
      message: "step id is required",
    })
  }

  const title = text(row.title)
  if (!title) {
    push_schema(state.errors, `${path_value}.title`, "step title is required")
  }

  const kind = text(row.kind)
  if (kind !== "agent_request" && kind !== "script" && kind !== "condition" && kind !== "end") {
    push(state.errors, {
      code: "node_kind_unsupported",
      path: `${path_value}.kind`,
      message: `unsupported node kind: ${kind ?? "unknown"}`,
    })
    return
  }

  if (!id || !title) return

  const list = state.node_paths.get(id) ?? []
  list.push(`${path_value}.id`)
  state.node_paths.set(id, list)
  const order = state.order++

  if (kind === "agent_request") {
    const prompt = parse_prompt(row, path_value, state)
    const output = parse_output(row, path_value, state.errors)
    const result: WorkflowStep = {
      id,
      kind,
      title,
      prompt: prompt ?? {
        source: "inline",
        text: "",
      },
      ...(output ? { output } : {}),
    }
    state.nodes.set(id, {
      kind,
      output_paths: output ? scalar_paths(output) : new Set<string>(),
      order,
    })
    return result
  }

  if (kind === "script") {
    const script = parse_script_source(row, path_value, state)
    const cwd = row.cwd === undefined ? undefined : text(row.cwd)
    if (row.cwd !== undefined && !cwd) {
      push_schema(state.errors, `${path_value}.cwd`, "cwd must be a non-empty relative path")
    }
    if (cwd) {
      const normalized = normalized_relative(cwd)
      if (!normalized) {
        push_schema(state.errors, `${path_value}.cwd`, "cwd must stay inside the run workspace")
      }
    }
    const result: WorkflowStep = {
      id,
      kind,
      title,
      script: script ?? {
        source: "inline",
        text: "",
      },
      ...(cwd ? { cwd } : {}),
    }
    state.nodes.set(id, {
      kind,
      output_paths: new Set(["exit_code", "stdout", "stderr"]),
      order,
    })
    return result
  }

  if (kind === "condition") {
    const when = record(row.when)
    if (!when) {
      push_condition(state.errors, `${path_value}.when`, "condition.when is required")
      return
    }
    const ref = text(when.ref)
    const op = text(when.op)
    const value = scalar(when.value)
    if (!ref) {
      push_condition(state.errors, `${path_value}.when.ref`, "condition ref is required")
    }
    if (op !== "equals" && op !== "not_equals") {
      push_condition(state.errors, `${path_value}.when.op`, "condition operator must be equals or not_equals")
    }
    if (!("value" in when)) {
      push_condition(state.errors, `${path_value}.when.value`, "condition value is required")
    }
    if ("value" in when && value === undefined) {
      push_condition(state.errors, `${path_value}.when.value`, "condition value must be a scalar")
    }

    const then_steps = parse_step_list(row.then, `${path_value}.then`, state)
    const else_steps = parse_step_list(row.else, `${path_value}.else`, state)

    if (ref) {
      state.conditions.push({
        path: `${path_value}.when.ref`,
        ref,
        order,
      })
    }
    state.nodes.set(id, {
      kind,
      output_paths: new Set<string>(),
      order,
    })
    return {
      id,
      kind,
      title,
      when: {
        ref: ref ?? "",
        op: op === "not_equals" ? "not_equals" : "equals",
        value: value ?? null,
      },
      then: then_steps,
      else: else_steps,
    }
  }

  const result = text(row.result)
  if (result !== "success" && result !== "failure" && result !== "noop") {
    push_schema(state.errors, `${path_value}.result`, "end result must be success, failure, or noop")
    return
  }
  state.nodes.set(id, {
    kind,
    output_paths: new Set<string>(),
    order,
  })
  return {
    id,
    kind,
    title,
    result,
  }
}

function validate_condition_refs(state: ParseState) {
  for (const item of state.conditions) {
    const parts = item.ref.split(".")
    if (parts[0] !== "steps" || parts.length < 3) {
      push_condition(state.errors, item.path, `invalid condition ref: ${item.ref}`)
      continue
    }

    const node_id = parts[1]
    const target = state.nodes.get(node_id)
    if (!target) {
      push_condition(state.errors, item.path, `condition ref targets unknown step: ${node_id}`)
      continue
    }

    if (target.order >= item.order) {
      push_condition(state.errors, item.path, `condition ref must target an earlier step: ${item.ref}`)
      continue
    }

    if (parts[2] === "status" && parts.length === 3) continue

    if (parts[2] !== "output" || parts.length < 4) {
      push_condition(state.errors, item.path, `invalid condition ref: ${item.ref}`)
      continue
    }

    const field = parts.slice(3).join(".")
    if (target.kind !== "agent_request" && target.kind !== "script") {
      push_condition(state.errors, item.path, `step ${node_id} does not expose output fields`)
      continue
    }

    if (!target.output_paths.has(field)) {
      push_condition(state.errors, item.path, `condition ref targets unsupported output field: ${item.ref}`)
    }
  }
}

function validate_resource_refs(state: ParseState, resources: WorkflowResource[]) {
  const index = new Map<string, WorkflowResource[]>()
  resources.forEach((resource) => {
    const list = index.get(resource.id) ?? []
    list.push(resource)
    index.set(resource.id, list)
  })

  state.resource_refs.forEach((item) => {
    const matches = index.get(item.resource_id) ?? []
    if (matches.length === 0) {
      push(state.errors, {
        code: "resource_missing",
        path: item.path,
        message: `workflow resource not found: ${item.resource_id}`,
      })
      return
    }

    if (matches.length > 1) {
      push(state.errors, {
        code: "resource_id_duplicate",
        path: item.path,
        message: `workflow resource id is ambiguous: ${item.resource_id}`,
      })
      return
    }

    const match = matches[0]
    if (match.kind === item.kind) return
    push(state.errors, {
      code: "resource_kind_mismatch",
      path: item.path,
      message: `expected ${item.kind}, found ${match.kind}`,
    })
  })
}

async function read_workflows(directory: string) {
  const files = await scan(directory, [".origin/workflows/*.yaml", ".origin/workflows/*.yml"])
  const result: WorkflowItem[] = []

  for (const file of files) {
    const text_value = await Bun.file(file).text()
    const loaded = parse_yaml(text_value)
    if (loaded.error) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, undefined),
        workflow: undefined,
        errors: [loaded.error],
        runnable: false,
      })
      continue
    }

    const doc = record(loaded.value)
    if (!doc) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, loaded.value),
        workflow: undefined,
        errors: [
          {
            code: "schema_invalid",
            path: "$",
            message: "workflow document must be an object",
          },
        ],
        runnable: false,
      })
      continue
    }

    const id = id_from(file, doc)
    const errors: ValidationIssue[] = []

    if (doc.schema_version !== 2) {
      result.push({
        file: ref(file, directory),
        id,
        workflow: undefined,
        errors: [
          {
            code: "schema_version_unsupported",
            path: "$.schema_version",
            message: "schema_version must be 2",
          },
        ],
        runnable: false,
      })
      continue
    }

    const base = z
      .object({
        schema_version: z.literal(2),
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1).optional(),
        trigger: z.unknown(),
        inputs: z.unknown().optional(),
        resources: z.unknown().optional(),
        steps: z.unknown(),
      })
      .strict()
      .safeParse(doc)

    if (!base.success) {
      result.push({
        file: ref(file, directory),
        id,
        workflow: undefined,
        errors: sort_errors(base.error.issues.map((item) => zod_issue(item.path, item.message))),
        runnable: false,
      })
      continue
    }

    const trigger = workflow_schema.shape.trigger.safeParse(base.data.trigger)
    if (!trigger.success) {
      trigger.error.issues.forEach((issue) => {
        push_schema(errors, json_path(["trigger", ...issue.path]), issue.message)
      })
    }

    const inputs = parse_inputs(base.data.inputs ?? [], errors)
    const resources = await parse_resources({
      directory,
      workflow_id: base.data.id,
      raw: base.data.resources ?? [],
      errors,
    })

    const state: ParseState = {
      directory,
      file,
      workflow_id: base.data.id,
      errors,
      node_paths: new Map(),
      nodes: new Map(),
      conditions: [],
      resource_refs: [],
      order: 0,
    }
    const steps = parse_step_list(base.data.steps, "$.steps", state)

    validate_resource_refs(state, resources)
    validate_condition_refs(state)

    for (const [node_id, paths] of state.node_paths.entries()) {
      if (paths.length < 2) continue
      paths.forEach((path_value) =>
        push(errors, {
          code: "node_id_duplicate",
          path: path_value,
          message: `duplicate node id: ${node_id}`,
        }),
      )
    }

    const workflow_result = workflow_schema.safeParse({
      schema_version: 2,
      id: base.data.id,
      name: base.data.name,
      description: base.data.description,
      trigger: trigger.success ? trigger.data : { type: "manual" },
      inputs,
      resources,
      steps,
    })

    result.push({
      file: ref(file, directory),
      id: base.data.id,
      workflow: workflow_result.success ? workflow_result.data : undefined,
      errors: sort_errors(errors),
      runnable: errors.length === 0 && workflow_result.success,
    })
  }

  return result
}

async function read_library(directory: string) {
  const files = await scan(directory, [".origin/library/*.yaml", ".origin/library/*.yml"])
  const result: LibraryItem[] = []

  for (const file of files) {
    const text_value = await Bun.file(file).text()
    const loaded = parse_yaml(text_value)
    if (loaded.error) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, undefined),
        resource: undefined,
        errors: [loaded.error],
        runnable: false,
      })
      continue
    }

    const parsed = library_resource_schema.safeParse(loaded.value)
    if (!parsed.success) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, loaded.value),
        resource: undefined,
        errors: sort_errors(parsed.error.issues.map((item) => zod_issue(item.path, item.message))),
        runnable: false,
      })
      continue
    }

    result.push({
      file: ref(file, directory),
      id: parsed.data.id,
      resource: parsed.data,
      errors: [],
      runnable: true,
    })
  }

  return result
}

function match_index(values: LibraryItem[]) {
  const out = new Map<string, LibraryItem[]>()
  values.forEach((item) => {
    if (!item.resource) return
    const list = out.get(item.resource.id) ?? []
    list.push(item)
    out.set(item.resource.id, list)
  })
  return out
}

function workflow_index(values: WorkflowItem[]) {
  const out = new Map<string, WorkflowItem[]>()
  values.forEach((item) => {
    if (!item.workflow) return
    const list = out.get(item.workflow.id) ?? []
    list.push(item)
    out.set(item.workflow.id, list)
  })
  return out
}

function enforce_library_capability(item: LibraryItem, type: "origin" | "standard") {
  if (!item.resource) return
  if (type === "origin") return
  if (item.resource.kind !== "query") return
  push(item.errors, {
    code: "workspace_capability_blocked",
    path: "$.kind",
    message: "query resources are not supported in standard workspaces",
  })
}

async function validate_library(directory: string, values: LibraryItem[], type: "origin" | "standard") {
  const index = match_index(values)

  for (const item of values) {
    enforce_library_capability(item, type)
    if (!item.resource) {
      item.errors = sort_errors(item.errors)
      item.runnable = item.errors.length === 0
      continue
    }

    const duplicate = index.get(item.resource.id) ?? []
    if (duplicate.length > 1) {
      push(item.errors, {
        code: "resource_id_duplicate",
        path: "$.id",
        message: `duplicate library resource id: ${item.resource.id}`,
      })
    }

    await check_link(directory, item.resource.links, (index) => `$.links[${index}]`, item.errors)
    item.errors = sort_errors(item.errors)
    item.runnable = item.errors.length === 0
  }

  return index
}

async function validate_workflows(
  directory: string,
  values: WorkflowItem[],
  index: Map<string, LibraryItem[]>,
) {
  const workflows = workflow_index(values)

  for (const item of values) {
    if (!item.workflow) {
      item.errors = sort_errors(item.errors)
      item.runnable = item.errors.length === 0
      continue
    }

    const duplicate = workflows.get(item.workflow.id) ?? []
    if (duplicate.length > 1) {
      push(item.errors, {
        code: "workflow_id_duplicate",
        path: "$.id",
        message: `duplicate workflow id: ${item.workflow.id}`,
      })
    }

    item.workflow.resources.forEach((value, index_value) => {
      if (value.source !== "library") return
      const matches = index.get(value.item_id)
      if (!matches || matches.length === 0) {
        push(item.errors, {
          code: "resource_missing",
          path: `$.resources[${index_value}].item_id`,
          message: `library resource not found: ${value.item_id}`,
        })
        return
      }

      if (matches.length > 1) {
        push(item.errors, {
          code: "resource_id_duplicate",
          path: `$.resources[${index_value}].item_id`,
          message: `library resource id is ambiguous: ${value.item_id}`,
        })
        return
      }

      const match = matches[0]
      const resource = match.resource
      if (!resource) {
        push(item.errors, {
          code: "resource_missing",
          path: `$.resources[${index_value}].item_id`,
          message: `library resource not found: ${value.item_id}`,
        })
        return
      }

      if (resource.kind === "query") {
        push(item.errors, {
          code: "resource_kind_unsupported",
          path: `$.resources[${index_value}].kind`,
          message: `library resource kind is not supported in graph workflows: ${resource.kind}`,
        })
        return
      }

      if (resource.kind !== value.kind) {
        push(item.errors, {
          code: "resource_kind_mismatch",
          path: `$.resources[${index_value}].kind`,
          message: `expected ${value.kind}, found ${resource.kind}`,
        })
        return
      }

      if (!match.runnable) {
        push(item.errors, {
          code: "resource_not_runnable",
          path: `$.resources[${index_value}].item_id`,
          message: `resource is not runnable: ${value.item_id}`,
        })
      }
    })

    await validate_input_refs(directory, item.workflow, item.errors, index)

    item.errors = sort_errors(item.errors)
    item.runnable = item.errors.length === 0
  }
}

export namespace WorkflowValidation {
  export const Input = workspace_type.optional()

  export async function validate(input: { directory: string; workspace_type?: "origin" | "standard" }) {
    const type = Input.parse(input.workspace_type) ?? (await RuntimeWorkspaceType.detect(input.directory))
    const [workflows, library] = await Promise.all([read_workflows(input.directory), read_library(input.directory)])
    const index = await validate_library(input.directory, library, type)
    await validate_workflows(input.directory, workflows, index)

    const report: ValidationReport = {
      workspace_type: type,
      workflows: workflows
        .toSorted((a, b) => {
          if (a.id !== b.id) return a.id.localeCompare(b.id)
          return a.file.localeCompare(b.file)
        })
        .map((item) => ({
          ...item,
          errors: sort_errors(item.errors),
          runnable: item.errors.length === 0,
        })),
      library: library
        .toSorted((a, b) => {
          if (a.id !== b.id) return a.id.localeCompare(b.id)
          return a.file.localeCompare(b.file)
        })
        .map((item) => ({
          ...item,
          errors: sort_errors(item.errors),
          runnable: item.errors.length === 0,
        })),
    }

    return report
  }

  export function workflow(report: ValidationReport, id: string) {
    return report.workflows.find((item) => item.id === id)
  }

  export function library(report: ValidationReport, id: string) {
    return report.library.find((item) => item.id === id)
  }

  export function resources(report: ValidationReport) {
    const out = new Map<string, LibraryResource>()
    report.library.forEach((item) => {
      if (!item.resource || !item.runnable) return
      if (out.has(item.resource.id)) return
      out.set(item.resource.id, item.resource)
    })
    return out
  }

  export function definitions(report: ValidationReport) {
    const out = new Map<string, Workflow>()
    report.workflows.forEach((item) => {
      if (!item.workflow || !item.runnable) return
      if (out.has(item.workflow.id)) return
      out.set(item.workflow.id, item.workflow)
    })
    return out
  }
}
