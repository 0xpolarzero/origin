import { copyFile, lstat, mkdir, readdir, readlink, realpath, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Decimal } from "decimal.js"
import { Process } from "@/util/process"
import { Shell } from "@/shell/shell"
import { Instance } from "@/project/instance"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { RuntimeRunAttempt } from "@/runtime/run-attempt"
import { RuntimeRunEvent } from "@/runtime/run-event"
import { RuntimeRunNode } from "@/runtime/run-node"
import { RuntimeSessionLink } from "@/runtime/session-link"
import { RuntimeWorkflowRevision } from "@/runtime/workflow-revision"
import { RuntimeWorkflowValidationError } from "@/runtime/error"
import type { ValidationCode } from "@/runtime/contract"
import type { ValidationReport } from "./contract"
import type { ManualInput, OutputContract, Workflow, WorkflowResource, WorkflowStep } from "./contract"
import { WorkflowValidation } from "./validate"

const skip = new Set([".git", ".jj", ".origin", "node_modules"])

type AgentResult = {
  structured: Record<string, unknown> | null
}

type ScriptResult = {
  exit_code: number
  stdout: string
  stderr: string
}

type Prepared = {
  workflow: Workflow
  workflow_text: string
  workflow_revision_id: string
  workflow_hash: string
  input_json: Record<string, unknown>
  input_store_json: Record<string, unknown>
  resource_materials_json: Record<string, unknown>
  material_root: string
}

type Runtime = {
  outcome: "success" | "failure" | "noop" | "node_failed" | "canceled"
}

type Seams = {
  agent?: (input: {
    run_id: string
    run_node_id: string
    session_id: string
    workflow_id: string
    node_id: string
    title: string
    directory: string
    workspace_id: string
    prompt: string
    output?: OutputContract
    abort: AbortSignal
  }) => Promise<AgentResult>
  script?: (input: {
    run_id: string
    run_node_id: string
    workflow_id: string
    node_id: string
    title: string
    directory: string
    cwd: string
    command: string
    env: Record<string, string>
    abort: AbortSignal
  }) => Promise<ScriptResult>
}

function fail(workflow_id: string, code: ValidationCode, path_value: string, message: string): never {
  throw new RuntimeWorkflowValidationError({
    workflow_id,
    code,
    path: path_value,
    message,
    errors: [
      {
        code,
        path: path_value,
        message,
      },
    ],
  })
}

function resource_root(directory: string, workflow_id: string) {
  return path.join(directory, ".origin", "workflows", workflow_id)
}

function input_refs(value: string) {
  return [...value.matchAll(/{{\s*inputs\.([^}]+)\s*}}/g)].map((item) => item[1]?.trim()).filter(Boolean) as string[]
}

function visit(steps: WorkflowStep[], fn: (step: WorkflowStep) => void) {
  steps.forEach((step) => {
    fn(step)
    if (step.kind !== "condition") return
    visit(step.then ?? [], fn)
    visit(step.else ?? [], fn)
  })
}

function flatten(steps: WorkflowStep[]) {
  const out: WorkflowStep[] = []
  visit(steps, (step) => out.push(step))
  return out
}

function display(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number") return new Decimal(value).toFixed()
  if (typeof value === "boolean") return value ? "true" : "false"
  if (value === null) return "null"
  return String(value)
}

function record(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function same_workflow(left: Workflow, right: Workflow) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function inside(root: string, target: string) {
  if (target === root) return true
  return target.startsWith(`${root}${path.sep}`)
}

async function path_kind(target: string) {
  const link = await lstat(target)
  if (link.isSymbolicLink()) {
    const resolved = await realpath(target)
    const actual = await stat(resolved)
    if (actual.isDirectory()) return { kind: "directory" as const, resolved }
    if (actual.isFile()) return { kind: "file" as const, resolved }
    return { kind: "other" as const, resolved }
  }
  if (link.isDirectory()) return { kind: "directory" as const, resolved: target }
  if (link.isFile()) return { kind: "file" as const, resolved: target }
  return { kind: "other" as const, resolved: target }
}

async function copy_tree(input: {
  workflow_id: string
  key: string
  source: string
  target: string
  root: string
  seen: Set<string>
}) {
  const info = await lstat(input.source)

  if (info.isSymbolicLink()) {
    const resolved = await realpath(input.source)
    if (!inside(input.root, resolved)) {
      const link = await readlink(input.source).catch(() => "")
      fail(
        input.workflow_id,
        "input_shape_invalid",
        `$.inputs.${input.key}`,
        `path input symlink escapes selected root: ${link || input.source}`,
      )
    }
    if (input.seen.has(resolved)) {
      fail(input.workflow_id, "input_shape_invalid", `$.inputs.${input.key}`, "path input contains a symlink cycle")
    }
    input.seen.add(resolved)
    const actual = await stat(resolved)
    if (actual.isDirectory()) {
      await mkdir(input.target, { recursive: true })
      const names = (await readdir(resolved)).filter((item) => !skip.has(item))
      await Promise.all(
        names.map((name) =>
          copy_tree({
            ...input,
            source: path.join(resolved, name),
            target: path.join(input.target, name),
          }),
        ),
      )
      input.seen.delete(resolved)
      return
    }
    if (actual.isFile()) {
      await mkdir(path.dirname(input.target), { recursive: true })
      await copyFile(resolved, input.target)
      input.seen.delete(resolved)
      return
    }
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${input.key}`, "path input must resolve to a file or directory")
  }

  if (info.isDirectory()) {
    await mkdir(input.target, { recursive: true })
    const names = (await readdir(input.source)).filter((item) => !skip.has(item))
    await Promise.all(
      names.map((name) =>
        copy_tree({
          ...input,
          source: path.join(input.source, name),
          target: path.join(input.target, name),
        }),
      ),
    )
    return
  }

  if (info.isFile()) {
    await mkdir(path.dirname(input.target), { recursive: true })
    await copyFile(input.source, input.target)
    return
  }

  fail(input.workflow_id, "input_shape_invalid", `$.inputs.${input.key}`, "path input must reference a file or directory")
}

async function capture_input(input: {
  workflow_id: string
  definition: ManualInput
  value: unknown
  material_root: string
}) {
  if (input.definition.type === "text" || input.definition.type === "long_text") {
    if (typeof input.value === "string") {
      return {
        value: input.value,
        store: { type: input.definition.type },
      }
    }
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${input.definition.key}`, "input must be a string")
  }

  if (input.definition.type === "number") {
    if (typeof input.value === "number" && Number.isFinite(input.value)) {
      return {
        value: input.value,
        store: { type: "number" },
      }
    }
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${input.definition.key}`, "input must be a finite number")
  }

  if (input.definition.type === "boolean") {
    if (typeof input.value === "boolean") {
      return {
        value: input.value,
        store: { type: "boolean" },
      }
    }
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${input.definition.key}`, "input must be a boolean")
  }

  if (input.definition.type === "select") {
    const ok = input.definition.options.some((option) => Object.is(option.value, input.value))
    if (ok) {
      return {
        value: input.value,
        store: { type: "select" },
      }
    }
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${input.definition.key}`, "input must match a declared option")
  }

  const definition = input.definition

  const original =
    typeof input.value === "string" && path.isAbsolute(input.value)
      ? input.value
      : fail(input.workflow_id, "input_shape_invalid", `$.inputs.${definition.key}`, "path input must be an absolute path")

  const kind = await path_kind(original)
  if (kind.kind === "other") {
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${definition.key}`, "path input must be a file or directory")
  }

  if (definition.mode === "file" && kind.kind !== "file") {
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${definition.key}`, "path input must be a file")
  }
  if (definition.mode === "directory" && kind.kind !== "directory") {
    fail(input.workflow_id, "input_shape_invalid", `$.inputs.${definition.key}`, "path input must be a directory")
  }

  const base = path.join(input.material_root, "inputs", definition.key)
  const target = kind.kind === "file" ? path.join(base, path.basename(original)) : base
  const root = original
  await copy_tree({
    workflow_id: input.workflow_id,
    key: definition.key,
    source: original,
    target,
    root,
    seen: new Set<string>(),
  })

  const stats = await stat(kind.resolved)
  return {
    value: target,
    store: {
      type: "path",
      mode: definition.mode,
      original_path: original,
      snapshot_path: target,
      kind: kind.kind,
      size: stats.size,
      mtime_ms: Math.trunc(stats.mtimeMs),
    },
  }
}

async function capture_inputs(input: {
  workflow: Workflow
  values: Record<string, unknown>
  material_root: string
}) {
  const input_json: Record<string, unknown> = {}
  const input_store_json: Record<string, unknown> = {}

  for (const definition of input.workflow.inputs) {
    const raw = input.values[definition.key] === undefined ? definition.default : input.values[definition.key]
    if (raw === undefined) {
      if (!definition.required) continue
      fail(input.workflow.id, "input_shape_invalid", `$.inputs.${definition.key}`, "required input is missing")
    }

    const captured = await capture_input({
      workflow_id: input.workflow.id,
      definition,
      value: raw,
      material_root: input.material_root,
    })
    input_json[definition.key] = captured.value
    input_store_json[definition.key] = captured.store
  }

  const declared = new Set(input.workflow.inputs.map((item) => item.key))
  Object.keys(input.values).forEach((key) => {
    if (declared.has(key)) return
    fail(input.workflow.id, "input_shape_invalid", `$.inputs.${key}`, `undeclared input: ${key}`)
  })

  return {
    input_json,
    input_store_json,
  }
}

function resource_index(report: ValidationReport) {
  return new Map(report.library.map((item) => [item.id, item]))
}

async function freeze_resources(input: {
  directory: string
  workflow: Workflow
  report: ValidationReport
  material_root: string
}) {
  const library = resource_index(input.report)
  const resource_materials_json: Record<string, unknown> = {}

  for (const item of input.workflow.resources) {
    const target =
      item.source === "local"
        ? path.join(input.material_root, "resources", item.id, path.basename(item.path))
        : path.join(input.material_root, "resources", `${item.id}${item.kind === "script" ? ".sh" : ".txt"}`)

    await mkdir(path.dirname(target), { recursive: true })

    if (item.source === "local") {
      const source = path.join(resource_root(input.directory, input.workflow.id), item.path)
      const exists = await Bun.file(source).exists()
      if (!exists) fail(input.workflow.id, "local_resource_missing", `$.resources.${item.id}`, `resource missing: ${item.path}`)
      await copyFile(source, target)
      resource_materials_json[item.id] = {
        source: "local",
        kind: item.kind,
        path: item.path,
        snapshot_file: target,
      }
      continue
    }

    const match = library.get(item.item_id)
    if (!match || !match.resource || !match.runnable) {
      fail(input.workflow.id, "resource_missing", `$.resources.${item.id}`, `library resource missing: ${item.item_id}`)
    }
    const resource = match.resource
    const content =
      resource.kind === "prompt_template"
        ? resource.template
        : resource.kind === "script"
          ? resource.script
          : fail(input.workflow.id, "resource_kind_unsupported", `$.resources.${item.id}`, `resource kind not supported: ${resource.kind}`)
    await Bun.write(target, content)
    resource_materials_json[item.id] = {
      source: "library",
      kind: item.kind,
      item_id: item.item_id,
      file: match.file,
      snapshot_file: target,
    }
  }

  return resource_materials_json
}

function interpolate(input: {
  workflow_id: string
  path: string
  template: string
  values: Record<string, unknown>
}) {
  return input.template.replace(/{{\s*inputs\.([^}]+)\s*}}/g, (_all, raw) => {
    const key = String(raw).trim()
    if (!(key in input.values) || input.values[key] === undefined) {
      fail(input.workflow_id, "input_ref_invalid", input.path, `captured input missing for prompt reference: ${key}`)
    }
    return display(input.values[key])
  })
}

function read_resource_text(materials: Record<string, unknown>, id: string, workflow_id: string): Promise<string> {
  const entry = record(materials[id])
  const file = entry?.snapshot_file
  if (typeof file === "string") return Bun.file(file).text()
  fail(workflow_id, "resource_missing", `$.resources.${id}`, `snapshot resource missing: ${id}`)
}

async function preflight_prompts(input: {
  workflow: Workflow
  input_json: Record<string, unknown>
  resource_materials_json: Record<string, unknown>
}) {
  const checks: Promise<void>[] = []

  visit(input.workflow.steps, (step) => {
    if (step.kind !== "agent_request" || !step.prompt) return
    if (step.prompt.source === "inline") {
      interpolate({
        workflow_id: input.workflow.id,
        path: `$.steps.${step.id}.prompt`,
        template: step.prompt.text,
        values: input.input_json,
      })
      return
    }
    checks.push(
      read_resource_text(input.resource_materials_json, step.prompt.resource_id, input.workflow.id).then((template) => {
        interpolate({
          workflow_id: input.workflow.id,
          path: `$.steps.${step.id}.prompt`,
          template,
          values: input.input_json,
        })
      }),
    )
  })

  await Promise.all(checks)
}

function output_schema(value: OutputContract | OutputContract["properties"][string]): Record<string, unknown> {
  if (value.type === "object") {
    return {
      type: "object",
      additionalProperties: false,
      required: value.required,
      properties: Object.fromEntries(Object.entries(value.properties).map(([key, item]) => [key, output_schema(item)])),
    }
  }
  return { type: value.type }
}

function validate_output(contract: OutputContract, value: unknown, prefix = "$"): string | undefined {
  const current = record(value)
  if (!current) return `${prefix} must be an object`
  for (const key of contract.required) {
    if (current[key] !== undefined) continue
    return `${prefix}.${key} is required`
  }
  for (const key of Object.keys(current)) {
    if (key in contract.properties) continue
    return `${prefix}.${key} is not declared`
  }
  for (const [key, field] of Object.entries(contract.properties)) {
    if (current[key] === undefined) continue
    if (field.type === "object") {
      const error = validate_output(field, current[key], `${prefix}.${key}`)
      if (error) return error
      continue
    }
    if (field.type === "null") {
      if (current[key] === null) continue
      return `${prefix}.${key} must be null`
    }
    if (typeof current[key] === field.type) continue
    return `${prefix}.${key} must be ${field.type}`
  }
}

function ref_value(input: {
  workflow: Workflow
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  ref: string
}) {
  const parts = input.ref.split(".")
  if (parts[0] !== "steps" || parts.length < 3) return
  const node = input.nodes.get(parts[1])
  if (!node) return
  if (parts[2] === "status" && parts.length === 3) return node.status
  if (parts[2] !== "output" || parts.length < 4) return
  return parts.slice(3).reduce<unknown>((acc, key) => {
    const row = record(acc)
    if (!row) return undefined
    return row[key]
  }, node.output_json)
}

function shell_command(command: string) {
  const shell = Shell.preferred()
  const shell_name = (process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)).toLowerCase()
  const invocations: Record<string, string[]> = {
    nu: ["-c", command],
    fish: ["-c", command],
    zsh: ["-l", "-c", `eval ${JSON.stringify(command)}`],
    bash: ["-l", "-c", `eval ${JSON.stringify(command)}`],
    cmd: ["/c", command],
    powershell: ["-NoProfile", "-Command", command],
    pwsh: ["-NoProfile", "-Command", command],
    "": ["-c", command],
  }
  return [shell, ...(invocations[shell_name] ?? invocations[""]!)]
}

async function agent_default(input: Parameters<NonNullable<Seams["agent"]>>[0]) {
  const result = await Instance.provide({
    directory: input.directory,
    fn: () =>
      WorkspaceContext.provide({
        workspaceID: input.workspace_id,
        fn: () =>
          SessionPrompt.prompt({
            sessionID: input.session_id,
            parts: [
              {
                type: "text",
                text: input.prompt,
              },
            ],
            ...(input.output
              ? {
                  format: {
                    type: "json_schema" as const,
                    schema: output_schema(input.output) as Record<string, any>,
                    retryCount: 0,
                  },
                }
              : {}),
          }),
      }),
  })

  if (result.info.role !== "assistant") {
    throw new Error("agent request did not return an assistant response")
  }

  if (result.info.error) {
    const message =
      "message" in result.info.error.data && typeof result.info.error.data.message === "string"
        ? result.info.error.data.message
        : result.info.error.name
    throw new Error(message)
  }

  return {
    structured: record(result.info.structured) ?? null,
  }
}

async function script_default(input: Parameters<NonNullable<Seams["script"]>>[0]) {
  const result = await Process.run(shell_command(input.command), {
    cwd: input.cwd,
    env: input.env,
    abort: input.abort,
    nothrow: true,
  })

  return {
    exit_code: result.code,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

async function fingerprint(directory: string) {
  const out = new Map<string, string>()
  const glob = new Bun.Glob("**/*")
  for await (const item of glob.scan({ cwd: directory, absolute: false, dot: true })) {
    const target = path.join(directory, item)
    const value = await stat(target).catch(() => undefined)
    if (!value?.isFile()) continue
    out.set(item.split(path.sep).join(path.posix.sep), `${value.size}:${Math.trunc(value.mtimeMs)}`)
  }
  return out
}

function changed(before: Map<string, string>, after: Map<string, string>) {
  const names = new Set<string>([...before.keys(), ...after.keys()])
  return [...names]
    .filter((name) => before.get(name) !== after.get(name))
    .toSorted((a, b) => a.localeCompare(b))
}

function event(input: {
  run_id: string
  run_node_id?: string | null
  run_attempt_id?: string | null
  event_type: string
  payload_json: Record<string, unknown>
}) {
  RuntimeRunEvent.append({
    run_id: input.run_id,
    run_node_id: input.run_node_id ?? null,
    run_attempt_id: input.run_attempt_id ?? null,
    event_type: input.event_type,
    payload_json: input.payload_json,
  })
}

function node_state(nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>, id: string) {
  const node = nodes.get(id)
  if (node) return node
  throw new Error(`run node missing: ${id}`)
}

function update_node(
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>,
  input: Parameters<typeof RuntimeRunNode.transition>[0],
) {
  const next = RuntimeRunNode.transition(input)
  nodes.set(next.node_id, next)
  return next
}

function mark_ready(input: { run_id: string; step: WorkflowStep; nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>> }) {
  const node = node_state(input.nodes, input.step.id)
  if (node.status !== "pending") return node
  const next = update_node(input.nodes, {
    id: node.id,
    to: "ready",
  })
  event({
    run_id: input.run_id,
    run_node_id: next.id,
    event_type: "node.ready",
    payload_json: { node_id: input.step.id },
  })
  return next
}

function mark_skipped(input: {
  run_id: string
  step: WorkflowStep
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  reason: "branch_not_taken" | "upstream_failed"
}) {
  const node = node_state(input.nodes, input.step.id)
  if (node.status !== "pending" && node.status !== "ready") return
  const next = update_node(input.nodes, {
    id: node.id,
    to: "skipped",
    skip_reason_code: input.reason,
  })
  event({
    run_id: input.run_id,
    run_node_id: next.id,
    event_type: "node.skipped",
    payload_json: { node_id: input.step.id, reason: input.reason },
  })
}

function mark_canceled(input: {
  run_id: string
  step: WorkflowStep
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
}) {
  const node = node_state(input.nodes, input.step.id)
  if (node.status === "pending" || node.status === "ready" || node.status === "running") {
    const next = update_node(input.nodes, {
      id: node.id,
      to: "canceled",
    })
    event({
      run_id: input.run_id,
      run_node_id: next.id,
      event_type: "node.canceled",
      payload_json: { node_id: input.step.id },
    })
  }
}

function skip_tree(input: {
  run_id: string
  steps: WorkflowStep[]
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  reason: "branch_not_taken" | "upstream_failed"
}) {
  visit(input.steps, (step) => {
    mark_skipped({
      run_id: input.run_id,
      step,
      nodes: input.nodes,
      reason: input.reason,
    })
  })
}

function cancel_tree(input: { run_id: string; steps: WorkflowStep[]; nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>> }) {
  visit(input.steps, (step) => {
    mark_canceled({
      run_id: input.run_id,
      step,
      nodes: input.nodes,
    })
  })
}

function cancel_attempt(input: {
  run_id: string
  step: WorkflowStep
  running: ReturnType<typeof RuntimeRunNode.get>
  attempt: ReturnType<typeof RuntimeRunAttempt.create>
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
}) {
  RuntimeRunAttempt.transition({
    id: input.attempt.id,
    to: "canceled",
  })
  event({
    run_id: input.run_id,
    run_node_id: input.running.id,
    run_attempt_id: input.attempt.id,
    event_type: "attempt.canceled",
    payload_json: { node_id: input.step.id, attempt_index: input.attempt.attempt_index },
  })
  const next = update_node(input.nodes, {
    id: input.running.id,
    to: "canceled",
  })
  event({
    run_id: input.run_id,
    run_node_id: next.id,
    run_attempt_id: input.attempt.id,
    event_type: "node.canceled",
    payload_json: { node_id: input.step.id },
  })
  return { outcome: "canceled" as const }
}

function fail_attempt(input: {
  run_id: string
  step: WorkflowStep
  running: ReturnType<typeof RuntimeRunNode.get>
  attempt: ReturnType<typeof RuntimeRunAttempt.create>
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  message: string
  output_json?: Record<string, unknown>
}) {
  RuntimeRunAttempt.transition({
    id: input.attempt.id,
    to: "failed",
    ...(input.output_json ? { output_json: input.output_json } : {}),
    error_json: { code: "node_execution_failed", message: input.message },
  })
  event({
    run_id: input.run_id,
    run_node_id: input.running.id,
    run_attempt_id: input.attempt.id,
    event_type: "attempt.failed",
    payload_json: { node_id: input.step.id, attempt_index: input.attempt.attempt_index, message: input.message },
  })
  const next = update_node(input.nodes, {
    id: input.running.id,
    to: "failed",
    ...(input.output_json ? { output_json: input.output_json } : {}),
    error_json: { code: "node_execution_failed", message: input.message },
  })
  event({
    run_id: input.run_id,
    run_node_id: next.id,
    run_attempt_id: input.attempt.id,
    event_type: "node.failed",
    payload_json: { node_id: input.step.id, message: input.message },
  })
  return { outcome: "node_failed" as const }
}

async function execute_agent(input: {
  run_id: string
  workflow: Workflow
  step: WorkflowStep
  directory: string
  workspace_id: string
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  prepared: Prepared
  abort: AbortSignal
  seams?: Seams
  on_session?: (session_id: string | null) => void
}) {
  if (input.step.kind !== "agent_request" || !input.step.prompt) return { outcome: "node_failed" as const }
  const ready = mark_ready({
    run_id: input.run_id,
    step: input.step,
    nodes: input.nodes,
  })
  const running = update_node(input.nodes, {
    id: ready.id,
    to: "running",
  })
  event({
    run_id: input.run_id,
    run_node_id: running.id,
    event_type: "node.running",
    payload_json: { node_id: input.step.id },
  })

  const session = await Session.createNext({
    directory: input.directory,
    title: input.step.title,
  })
  const attempt = RuntimeRunAttempt.create({
    run_node_id: running.id,
    session_id: session.id,
    input_json: {
      source: input.step.prompt.source,
    },
  })
  RuntimeSessionLink.upsert({
    session_id: session.id,
    role: "execution_node",
    run_id: input.run_id,
    run_node_id: running.id,
    run_attempt_id: attempt.id,
  })
  input.on_session?.(session.id)

  event({
    run_id: input.run_id,
    run_node_id: running.id,
    run_attempt_id: attempt.id,
    event_type: "attempt.created",
    payload_json: { node_id: input.step.id, attempt_index: attempt.attempt_index },
  })

  RuntimeRunAttempt.transition({
    id: attempt.id,
    to: "running",
    session_id: session.id,
  })
  event({
    run_id: input.run_id,
    run_node_id: running.id,
    run_attempt_id: attempt.id,
    event_type: "attempt.running",
    payload_json: { node_id: input.step.id, attempt_index: attempt.attempt_index },
  })

  const template =
    input.step.prompt.source === "inline"
      ? input.step.prompt.text
      : await read_resource_text(input.prepared.resource_materials_json, input.step.prompt.resource_id, input.workflow.id)
  const prompt = interpolate({
    workflow_id: input.workflow.id,
    path: `$.steps.${input.step.id}.prompt`,
    template,
    values: input.prepared.input_json,
  })

  try {
    if (input.abort.aborted) return cancel_attempt({ ...input, running, attempt })
    const result = await (input.seams?.agent ?? agent_default)({
      run_id: input.run_id,
      run_node_id: running.id,
      session_id: session.id,
      workflow_id: input.workflow.id,
      node_id: input.step.id,
      title: input.step.title,
      directory: input.directory,
      workspace_id: input.workspace_id,
      prompt,
      output: input.step.output,
      abort: input.abort,
    })

    if (input.abort.aborted) return cancel_attempt({ ...input, running, attempt })

    if (input.step.output) {
      const error = validate_output(input.step.output, result.structured)
      if (error) throw new Error(error)
    }

    const payload = input.step.output ? result.structured : null
    RuntimeRunAttempt.transition({
      id: attempt.id,
      to: "succeeded",
      output_json: payload,
    })
    event({
      run_id: input.run_id,
      run_node_id: running.id,
      run_attempt_id: attempt.id,
      event_type: "attempt.succeeded",
      payload_json: { node_id: input.step.id, attempt_index: attempt.attempt_index },
    })
    const next = update_node(input.nodes, {
      id: running.id,
      to: "succeeded",
      output_json: payload,
    })
    event({
      run_id: input.run_id,
      run_node_id: next.id,
      run_attempt_id: attempt.id,
      event_type: "node.succeeded",
      payload_json: { node_id: input.step.id },
    })
    return { outcome: "continue" as const }
  } catch (error) {
    if (input.abort.aborted) return cancel_attempt({ ...input, running, attempt })
    const message = error instanceof Error ? error.message : String(error)
    return fail_attempt({
      ...input,
      running,
      attempt,
      message,
    })
  } finally {
    input.on_session?.(null)
  }
}

async function execute_script(input: {
  run_id: string
  workflow: Workflow
  step: WorkflowStep
  directory: string
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  prepared: Prepared
  abort: AbortSignal
  seams?: Seams
}) {
  if (input.step.kind !== "script" || !input.step.script) return { outcome: "node_failed" as const }
  const ready = mark_ready({
    run_id: input.run_id,
    step: input.step,
    nodes: input.nodes,
  })
  const running = update_node(input.nodes, {
    id: ready.id,
    to: "running",
  })
  event({
    run_id: input.run_id,
    run_node_id: running.id,
    event_type: "node.running",
    payload_json: { node_id: input.step.id },
  })

  const attempt = RuntimeRunAttempt.create({
    run_node_id: running.id,
  })
  event({
    run_id: input.run_id,
    run_node_id: running.id,
    run_attempt_id: attempt.id,
    event_type: "attempt.created",
    payload_json: { node_id: input.step.id, attempt_index: attempt.attempt_index },
  })
  RuntimeRunAttempt.transition({
    id: attempt.id,
    to: "running",
  })
  event({
    run_id: input.run_id,
    run_node_id: running.id,
    run_attempt_id: attempt.id,
    event_type: "attempt.running",
    payload_json: { node_id: input.step.id, attempt_index: attempt.attempt_index },
  })

  const entry =
    input.step.script.source === "inline"
      ? input.step.script.text
      : await read_resource_text(input.prepared.resource_materials_json, input.step.script.resource_id, input.workflow.id)
  const cwd = input.step.cwd ? path.join(input.directory, input.step.cwd) : input.directory
  const env = Object.fromEntries(
    input.workflow.inputs.flatMap((definition) => {
      const value = input.prepared.input_json[definition.key]
      if (value === undefined) return []
      return [[`ORIGIN_INPUT_${definition.key.toUpperCase()}`, display(value)]]
    }),
  )
  const before = await fingerprint(input.directory)

  try {
    if (input.abort.aborted) return cancel_attempt({ ...input, running, attempt })

    const result = await (input.seams?.script ?? script_default)({
      run_id: input.run_id,
      run_node_id: running.id,
      workflow_id: input.workflow.id,
      node_id: input.step.id,
      title: input.step.title,
      directory: input.directory,
      cwd,
      command: entry,
      env,
      abort: input.abort,
    })

    if (input.abort.aborted) return cancel_attempt({ ...input, running, attempt })

    const output_json = {
      exit_code: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr,
      changed_paths: changed(before, await fingerprint(input.directory)),
    }

    if (result.exit_code === 0) {
      RuntimeRunAttempt.transition({
        id: attempt.id,
        to: "succeeded",
        output_json,
      })
      event({
        run_id: input.run_id,
        run_node_id: running.id,
        run_attempt_id: attempt.id,
        event_type: "attempt.succeeded",
        payload_json: { node_id: input.step.id, attempt_index: attempt.attempt_index },
      })
      const next = update_node(input.nodes, {
        id: running.id,
        to: "succeeded",
        output_json,
      })
      event({
        run_id: input.run_id,
        run_node_id: next.id,
        run_attempt_id: attempt.id,
        event_type: "node.succeeded",
        payload_json: { node_id: input.step.id },
      })
      return { outcome: "continue" as const }
    }

    return fail_attempt({
      ...input,
      running,
      attempt,
      output_json,
      message: `script exited with ${result.exit_code}`,
    })
  } catch (error) {
    if (input.abort.aborted) return cancel_attempt({ ...input, running, attempt })
    const message = error instanceof Error ? error.message : String(error)
    return fail_attempt({
      ...input,
      running,
      attempt,
      message,
    })
  }
}

async function run_step(input: {
  run_id: string
  workflow: Workflow
  step: WorkflowStep
  steps: WorkflowStep[]
  index: number
  directory: string
  workspace_id: string
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  prepared: Prepared
  abort: AbortSignal
  seams?: Seams
  on_session?: (session_id: string | null) => void
}): Promise<{ outcome: "continue" | Runtime["outcome"] }> {
  if (input.abort.aborted) {
    cancel_tree({
      run_id: input.run_id,
      steps: input.steps.slice(input.index),
      nodes: input.nodes,
    })
    return { outcome: "canceled" }
  }

  if (input.step.kind === "agent_request") {
    return execute_agent(input)
  }

  if (input.step.kind === "script") {
    return execute_script(input)
  }

  if (input.step.kind === "condition" && input.step.when) {
    const ready = mark_ready({
      run_id: input.run_id,
      step: input.step,
      nodes: input.nodes,
    })
    const running = update_node(input.nodes, {
      id: ready.id,
      to: "running",
    })
    event({
      run_id: input.run_id,
      run_node_id: running.id,
      event_type: "node.running",
      payload_json: { node_id: input.step.id },
    })
    const actual = ref_value({
      workflow: input.workflow,
      nodes: input.nodes,
      ref: input.step.when.ref,
    })
    const matched =
      input.step.when.op === "equals" ? Object.is(actual, input.step.when.value) : !Object.is(actual, input.step.when.value)
    const next = update_node(input.nodes, {
      id: running.id,
      to: "succeeded",
      output_json: {
        branch: matched ? "then" : "else",
        actual: actual ?? null,
        expected: input.step.when.value,
      },
    })
    event({
      run_id: input.run_id,
      run_node_id: next.id,
      event_type: "node.succeeded",
      payload_json: { node_id: input.step.id, branch: matched ? "then" : "else" },
    })

    skip_tree({
      run_id: input.run_id,
      steps: matched ? input.step.else ?? [] : input.step.then ?? [],
      nodes: input.nodes,
      reason: "branch_not_taken",
    })

    const branch = matched ? input.step.then ?? [] : input.step.else ?? []
    const result = await run_steps({
      ...input,
      steps: branch,
      index: 0,
    })
    return result
  }

  if (input.step.kind === "end" && input.step.result) {
    const ready = mark_ready({
      run_id: input.run_id,
      step: input.step,
      nodes: input.nodes,
    })
    const running = update_node(input.nodes, {
      id: ready.id,
      to: "running",
    })
    event({
      run_id: input.run_id,
      run_node_id: running.id,
      event_type: "node.running",
      payload_json: { node_id: input.step.id },
    })
    const next = update_node(input.nodes, {
      id: running.id,
      to: "succeeded",
      output_json: { result: input.step.result },
    })
    event({
      run_id: input.run_id,
      run_node_id: next.id,
      event_type: "node.succeeded",
      payload_json: { node_id: input.step.id, result: input.step.result },
    })
    return { outcome: input.step.result }
  }

  return { outcome: "node_failed" }
}

async function run_steps(input: {
  run_id: string
  workflow: Workflow
  steps: WorkflowStep[]
  index: number
  directory: string
  workspace_id: string
  nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
  prepared: Prepared
  abort: AbortSignal
  seams?: Seams
  on_session?: (session_id: string | null) => void
}): Promise<{ outcome: "continue" | Runtime["outcome"] }> {
  for (const [index, step] of input.steps.entries()) {
    const result = await run_step({
      ...input,
      step,
      steps: input.steps,
      index,
    })

    if (result.outcome === "continue") continue
    if (result.outcome === "canceled") {
      cancel_tree({
        run_id: input.run_id,
        steps: input.steps.slice(index + 1),
        nodes: input.nodes,
      })
      return result
    }
    skip_tree({
      run_id: input.run_id,
      steps: input.steps.slice(index + 1),
      nodes: input.nodes,
      reason: "upstream_failed",
    })
    return result
  }
  return { outcome: "continue" }
}

export namespace WorkflowGraphRun {
  export type AgentSeam = Seams["agent"]
  export type ScriptSeam = Seams["script"]
  export type PrepareResult = Prepared
  export type ExecuteResult = Runtime
  export type Testing = Seams

  export async function prepare(input: {
    directory: string
    workflow_id: string
    inputs?: Record<string, unknown>
    material_root: string
  }) {
    await rm(input.material_root, { recursive: true, force: true })
    await mkdir(input.material_root, { recursive: true })

    const stable = await (async () => {
      let previous:
        | {
            workflow: Workflow
            report: ValidationReport
            file: string
            workflow_text: string
          }
        | undefined
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const report = await WorkflowValidation.validate({
          directory: input.directory,
        })
        const matches = report.workflows.filter((item) => item.id === input.workflow_id)
        if (matches.length === 0) {
          fail(input.workflow_id, "workflow_missing", "$.id", `workflow not found: ${input.workflow_id}`)
        }
        if (matches.length > 1) {
          fail(input.workflow_id, "workflow_id_duplicate", "$.id", `workflow id is ambiguous: ${input.workflow_id}`)
        }
        const item = matches[0]!
        if (!item.workflow || !item.runnable) {
          const issue = item.errors[0]
          if (issue) fail(input.workflow_id, issue.code, issue.path, issue.message)
          fail(input.workflow_id, "workflow_not_runnable", "$", `workflow is not runnable: ${input.workflow_id}`)
        }
        const current = {
          workflow: item.workflow,
          report,
          file: item.file,
          workflow_text: await Bun.file(path.join(input.directory, item.file)).text(),
        }
        if (
          previous &&
          previous.file === current.file &&
          previous.workflow_text === current.workflow_text &&
          same_workflow(previous.workflow, current.workflow)
        ) {
          return current
        }
        previous = current
      }
      fail(input.workflow_id, "workflow_not_runnable", "$", `workflow changed during start: ${input.workflow_id}`)
    })()
    const revision = RuntimeWorkflowRevision.observe({
      project_id: Instance.project.id,
      workflow_id: stable.workflow.id,
      file: stable.file,
      canonical_text: stable.workflow_text,
    })
    const inputs = await capture_inputs({
      workflow: stable.workflow,
      values: input.inputs ?? {},
      material_root: input.material_root,
    })
    const resource_materials_json = await freeze_resources({
      directory: input.directory,
      workflow: stable.workflow,
      report: stable.report,
      material_root: input.material_root,
    })
    await preflight_prompts({
      workflow: stable.workflow,
      input_json: inputs.input_json,
      resource_materials_json,
    })

    return {
      workflow: stable.workflow,
      workflow_text: stable.workflow_text,
      workflow_revision_id: revision.id,
      workflow_hash: revision.content_hash,
      input_json: inputs.input_json,
      input_store_json: inputs.input_store_json,
      resource_materials_json,
      material_root: input.material_root,
    } satisfies Prepared
  }

  export function cleanup_materials(material_root: string) {
    return rm(material_root, { recursive: true, force: true })
  }

  export function create_nodes(input: { run_id: string; snapshot_id: string; workflow: Workflow }) {
    return new Map(
      flatten(input.workflow.steps).map((step, index) => {
        const node = RuntimeRunNode.create({
          run_id: input.run_id,
          snapshot_id: input.snapshot_id,
          node_id: step.id,
          kind: step.kind,
          title: step.title,
          position: index,
        })
        return [step.id, node] as const
      }),
    )
  }

  export async function execute(input: {
    run_id: string
    workflow: Workflow
    directory: string
    workspace_id: string
    nodes: Map<string, ReturnType<typeof RuntimeRunNode.get>>
    prepared: Prepared
    abort: AbortSignal
    seams?: Seams
    on_session?: (session_id: string | null) => void
  }) {
    const result = await run_steps({
      run_id: input.run_id,
      workflow: input.workflow,
      steps: input.workflow.steps,
      index: 0,
      directory: input.directory,
      workspace_id: input.workspace_id,
      nodes: input.nodes,
      prepared: input.prepared,
      abort: input.abort,
      seams: input.seams,
      on_session: input.on_session,
    })

    if (result.outcome === "continue") {
      return {
        outcome: "success",
      } satisfies Runtime
    }

    return {
      outcome: result.outcome,
    } satisfies Runtime
  }
}
