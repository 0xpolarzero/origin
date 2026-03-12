import { cp, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Bus } from "@/bus"
import { JJ } from "@/project/jj"
import { Instance } from "@/project/instance"
import { RuntimeAudit } from "@/runtime/audit"
import { RuntimeRun } from "@/runtime/run"
import { RuntimeRunNode } from "@/runtime/run-node"
import { RuntimeRunSnapshot } from "@/runtime/run-snapshot"
import { RuntimeSessionLink } from "@/runtime/session-link"
import { create_uuid_v7, uuid_v7 } from "@/runtime/uuid"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { terminal_run_statuses } from "@/runtime/contract"
import {
  RuntimeIllegalTransitionError,
  RuntimeManualRunDuplicateError,
  RuntimeManualRunWorkspaceRequiredError,
  RuntimeTriggerFailureError,
  RuntimeWorkflowValidationError,
} from "@/runtime/error"
import { NotFoundError } from "@/storage/db"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Workspace } from "@/control-plane/workspace"
import { WorkflowTriggerFailure, type TriggerFailureCode } from "./trigger-failure"
import { WorkflowGraphRun } from "./graph-run"
import { WorkflowIntegrationQueue } from "./integration-queue"
import { WorkflowRunEvent } from "./run-event"
import { WorkflowRunGate } from "./run-gate"
import { workflow_schema } from "./contract"
import z from "zod"

const REPAIR_MAX = 3
const REPAIR_WINDOW_MS = 10 * 60 * 1000
const WAIT_STEP_MS = 50
const AUTOMATED_RETRY_MAX = 2
const checkpoint_skip = new Set([".git", ".jj"])

const start_input = z
  .object({
    workflow_id: z.string().min(1),
    trigger_id: z.string().min(1).optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const control_input = z
  .object({
    run_id: uuid_v7,
  })
  .strict()

const wait_input = z
  .object({
    run_id: uuid_v7,
    timeout_ms: z.number().int().positive().optional(),
  })
  .strict()

const validation_result = z
  .object({
    ok: z.boolean(),
    message: z.string().optional(),
    repair_prompt: z.string().optional(),
  })
  .strict()

const classification_result = z
  .object({
    changed_paths: z.array(z.string()).default([]),
    base_change_id: z.string().nullable().optional(),
    change_ids: z.array(z.string()).optional(),
  })
  .strict()

const integration_candidate = z
  .object({
    base_change_id: z.string().nullable(),
    change_ids: z.array(z.string()),
    changed_paths: z.array(z.string()),
  })
  .strict()

const info = z
  .object({
    id: uuid_v7,
    status: z.string(),
    trigger_type: z.string(),
    workflow_id: z.string().nullable(),
    workspace_id: z.string(),
    session_id: z.string().nullable(),
    run_workspace_root: z.string().nullable(),
    run_workspace_directory: z.string().nullable(),
    ready_for_integration_at: z.number().nullable(),
    reason_code: z.string().nullable(),
    failure_code: z.string().nullable(),
    trigger_metadata: z.record(z.string(), z.unknown()).nullable(),
    cleanup_failed: z.boolean(),
    created_at: z.number(),
    updated_at: z.number(),
    started_at: z.number().nullable(),
    finished_at: z.number().nullable(),
    integration_candidate: integration_candidate.nullable(),
  })
  .strict()

type Row = ReturnType<typeof RuntimeRun.get>
type Fingerprint = Map<string, string>
type Mode = "manual" | "automated"
type RunFailureCode =
  | "manual_start_failed"
  | "repair_exhausted"
  | "workspace_policy_blocked"
  | "workflow_failed"
  | "node_execution_failed"
  | TriggerFailureCode

type ExecuteInput = {
  run: Row
  workflow_id: string
  session_id: string
  workspace_id: string
  directory: string
  phase: "initial" | "repair"
  attempt: number
  prompt: string
  abort: AbortSignal
}

type ValidateInput = {
  run: Row
  workflow_id: string
  session_id: string
  workspace_id: string
  directory: string
  attempt: number
}

type ClassifyInput = {
  run: Row
  workflow_id: string
  session_id: string
  workspace_id: string
  directory: string
  before: Fingerprint
}

type Seams = {
  now?: () => number
  adapter?: (input: { directory: string }) => JJ.Adapter
  execute?: (input: ExecuteInput) => Promise<void>
  prepare?: (input: {
    directory: string
    workflow_id: string
    inputs?: Record<string, unknown>
    material_root: string
  }) => Promise<Awaited<ReturnType<typeof WorkflowGraphRun.prepare>>>
  agent?: WorkflowGraphRun.AgentSeam
  script?: WorkflowGraphRun.ScriptSeam
  validate?: (input: ValidateInput) => Promise<z.output<typeof validation_result>>
  classify?: (input: ClassifyInput) => Promise<z.output<typeof classification_result>>
}

type GraphAgentInput = Parameters<NonNullable<WorkflowGraphRun.AgentSeam>>[0]

const automated_input = z
  .object({
    workflow: z.union([
      workflow_schema,
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          instructions: z.string().min(1),
        })
        .strict(),
    ]),
    trigger_type: z.enum(["cron", "signal"]),
    trigger_id: z.string().min(1),
    trigger_metadata_json: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()

type Task = {
  key: string
  abort: AbortController
  session_id: string | null
  done: Promise<void>
}

let override: Seams | undefined

const state = Instance.state(() => ({
  keys: new Map<string, { run_id: string | null }>(),
  tasks: new Map<string, Task>(),
}))

function current(input?: Seams) {
  if (input) return input
  if (override) return override
  return {}
}

function key(workspace_id: string, workflow_id: string, trigger_id?: string) {
  return [workspace_id, workflow_id, trigger_id ?? "manual"].join("\u0000")
}

function queue_start() {
  void WorkflowIntegrationQueue.start().catch(() => undefined)
}

function queue_touch() {
  void WorkflowIntegrationQueue.touch().catch(() => undefined)
}

function is_terminal(status: string) {
  return terminal_run_statuses.has(status as any)
}

function is_done(status: string) {
  if (status === "ready_for_integration") return true
  return is_terminal(status)
}

function candidate(row: Row) {
  if (!row.integration_candidate_base_change_id && !row.integration_candidate_change_ids && !row.integration_candidate_changed_paths) {
    return null
  }
  return {
    base_change_id: row.integration_candidate_base_change_id,
    change_ids: row.integration_candidate_change_ids ?? [],
    changed_paths: row.integration_candidate_changed_paths ?? [],
  }
}

function present(row: Row) {
  return info.parse({
    id: row.id,
    status: row.status,
    trigger_type: row.trigger_type,
    workflow_id: row.workflow_id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    run_workspace_root: row.run_workspace_root,
    run_workspace_directory: row.run_workspace_directory,
    ready_for_integration_at: row.ready_for_integration_at,
    reason_code: row.reason_code,
    failure_code: row.failure_code,
    trigger_metadata: row.trigger_metadata_json ?? null,
    cleanup_failed: row.cleanup_failed,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    integration_candidate: candidate(row),
  })
}

function read(run_id: string) {
  return RuntimeRun.get({ id: run_id })
}

function workspace_required() {
  const workspace_id = WorkspaceContext.workspaceID
  if (workspace_id) return workspace_id
  throw new RuntimeManualRunWorkspaceRequiredError({
    code: "manual_run_workspace_required",
    message: "manual runs require a workspace id",
  })
}

function read_scoped(run_id: string) {
  const workspace_id = workspace_required()
  const row = read(run_id)
  if (row.workspace_id === workspace_id) return row
  throw new NotFoundError({ message: `Run not found: ${run_id}` })
}

function transition(input: z.input<typeof RuntimeRun.TransitionInput>) {
  return RuntimeRun.transition(input)
}

function graph_outcome(row: Row) {
  if (row.status === "completed_no_change" || row.status === "ready_for_integration") return "completed" as const
  if (row.status === "failed") return "failed" as const
  if (row.status === "canceled") return "canceled" as const
}

function snapshot_exists(run_id: string) {
  try {
    RuntimeRunSnapshot.byRun({ run_id })
    return true
  } catch (error) {
    if (error instanceof NotFoundError) return false
    throw error
  }
}

function publish_outcome(run_id: string) {
  const row = read(run_id)
  const outcome = graph_outcome(row)
  if (!outcome) return row
  if (!row.workflow_id) return row
  if (!snapshot_exists(run_id)) return row

  RuntimeAudit.write({
    event_type: "workflow.run.outcome",
    actor_type: "system",
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    run_id: row.id,
    event_payload: {
      workspace_id: row.workspace_id,
      workflow_id: row.workflow_id,
      run_id: row.id,
      outcome,
      status: row.status,
      reason_code: row.reason_code ?? null,
      failure_code: row.failure_code ?? null,
    },
  })
  Bus.publish(WorkflowRunEvent.Outcome, {
    workspace_id: row.workspace_id,
    workflow_id: row.workflow_id,
    run_id: row.id,
    outcome,
    status: row.status,
    reason_code: row.reason_code ?? null,
    failure_code: row.failure_code ?? null,
  })
  return row
}

function fail(run_id: string, failure_code: RunFailureCode, reason_code?: "retry_exhausted" | "non_retryable") {
  const row = read(run_id)
  if (is_terminal(row.status)) return row
  if (row.status === "queued") {
    try {
      transition({
        id: run_id,
        to: "running",
      })
    } catch (error) {
      if (!(error instanceof RuntimeIllegalTransitionError)) throw error
    }
  }
  try {
    const failed = transition({
      id: run_id,
      to: "failed",
      failure_code,
      reason_code,
    })
    publish_outcome(failed.id)
    return failed
  } catch (error) {
    if (error instanceof RuntimeIllegalTransitionError) return read(run_id)
    throw error
  }
}

function automated_delay(_attempt: number) {
  return 0
}

function cancel_status(run_id: string, actor_type: "system" | "user") {
  while (true) {
    const row = read(run_id)
    if (row.status === "cancel_requested" || is_terminal(row.status)) return row

    const to = row.status === "integrating" || row.status === "reconciling" ? "cancel_requested" : "canceled"
    const reason_code = to === "cancel_requested" ? "cancel_requested_after_integration_started" : undefined

    try {
      const next = transition({
        id: run_id,
        to,
        reason_code,
        actor_type,
      })
      publish_outcome(next.id)
      return next
    } catch (error) {
      if (!(error instanceof RuntimeIllegalTransitionError)) throw error
      const next = read(run_id)
      if (next.status === row.status) return next
    }
  }
}

function normalize(file: string) {
  return file.split(path.sep).join(path.posix.sep)
}

function checkpoint(root: string, node_id: string) {
  return path.join(root, "checkpoints", node_id)
}

async function clone_materials(source: string, target: string) {
  await rm(target, { recursive: true, force: true })
  const value = await stat(source).catch(() => undefined)
  if (!value?.isDirectory()) return
  await cp(source, target, {
    recursive: true,
    force: true,
  })
}

async function save_checkpoint(input: { source: string; target: string }) {
  await rm(input.target, { recursive: true, force: true })
  await cp(input.source, input.target, {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = path.relative(input.source, source)
      if (!rel) return true
      return !checkpoint_skip.has(rel.split(path.sep)[0]!)
    },
  })
}

async function restore_checkpoint(input: { source: string; target: string }) {
  const value = await stat(input.source).catch(() => undefined)
  if (!value?.isDirectory()) {
    throw new NotFoundError({ message: `Checkpoint not found: ${input.source}` })
  }
  const names = await readdir(input.target).catch(() => [])
  await Promise.all(
    names.map(async (name) => {
      if (checkpoint_skip.has(name)) return
      await rm(path.join(input.target, name), {
        recursive: true,
        force: true,
      })
    }),
  )
  await cp(input.source, input.target, {
    recursive: true,
    force: true,
  })
}

async function files(input: { directory: string; exclude?: string[] }) {
  const directory = input.directory
  const exclude = new Set(
    (input.exclude ?? [])
      .map((item) => normalize(item))
      .map((item) => item.replace(/^\.\/+/, ""))
      .filter((item) => item && item !== "." && item !== ".." && !item.startsWith("../")),
  )
  const ignored = [...exclude]
  const out = new Map<string, string>()
  const glob = new Bun.Glob("**/*")

  for await (const item of glob.scan({ cwd: directory, dot: true, absolute: false })) {
    const file = normalize(item)
    if (file === ".jj") continue
    if (file.startsWith(".jj/")) continue
    if (file === ".git") continue
    if (file.startsWith(".git/")) continue
    if (ignored.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))) continue

    const target = path.join(directory, item)
    const value = await stat(target).catch(() => undefined)
    if (!value?.isFile()) continue

    out.set(file, `${value.size}:${Math.trunc(value.mtimeMs)}`)
  }

  return out
}

function changed(before: Fingerprint, after: Fingerprint) {
  const names = new Set<string>()
  for (const name of before.keys()) names.add(name)
  for (const name of after.keys()) names.add(name)

  const out: string[] = []
  for (const name of names) {
    if (before.get(name) === after.get(name)) continue
    out.push(name)
  }

  return out.toSorted((a, b) => a.localeCompare(b))
}

function prompt(workflow: z.output<typeof automated_input>["workflow"]) {
  if ("instructions" in workflow) return workflow.instructions
  throw new RuntimeTriggerFailureError({
    code: "validation_error",
    message: `graph workflow execution is not wired to the legacy session runner: ${workflow.id}`,
  })
}

async function execute_default(input: ExecuteInput) {
  await Instance.provide({
    directory: input.directory,
    fn: async () => {
      await WorkspaceContext.provide({
        workspaceID: input.workspace_id,
        fn: async () => {
          if (input.abort.aborted) {
            SessionPrompt.cancel(input.session_id)
            throw new Error("manual run aborted")
          }

          const stop = () => SessionPrompt.cancel(input.session_id)
          input.abort.addEventListener("abort", stop, { once: true })
          try {
            await SessionPrompt.prompt({
              sessionID: input.session_id,
              parts: [
                {
                  type: "text",
                  text: input.prompt,
                },
              ],
            })
          } finally {
            input.abort.removeEventListener("abort", stop)
          }

          if (input.abort.aborted) {
            SessionPrompt.cancel(input.session_id)
            throw new Error("manual run aborted")
          }
        },
      })
    },
  })
}

async function validate_default() {
  return {
    ok: true,
  }
}

async function classify_default(input: ClassifyInput) {
  const after = await files({
    directory: input.directory,
  })
  return {
    changed_paths: changed(input.before, after),
    base_change_id: null,
    change_ids: [],
  }
}

function cleanup_failed(run_id: string, row: Row) {
  const failure_code = row.status === "failed" && row.failure_code ? row.failure_code : "cleanup_failed"
  RuntimeRun.cleanup({
    id: run_id,
    cleanup_failed: true,
    failure_code,
  })
}

async function finalize_cleanup(input: {
  run_id: string
  adapter: JJ.Adapter
  workspace: Pick<JJ.CreateWorkspaceResult, "name" | "root" | "directory">
}) {
  const cleanup = await input.adapter.workspace.cleanup(input.run_id, {
    name: input.workspace.name,
    root: input.workspace.root,
    directory: input.workspace.directory,
  })

  if (!cleanup.retry && cleanup.status !== "error") return
  const row = read(input.run_id)
  cleanup_failed(input.run_id, row)
}

async function drive(input: {
  run_id: string
  session_id: string
  instructions: string
  workflow_id: string
  workspace_id: string
  project_directory: string
  directory: string
  before: Fingerprint
  root_before: Fingerprint
  root_exclude: string[]
  abort: AbortSignal
  mode: Mode
  seams: Seams
}) {
  const execute = input.seams.execute ?? execute_default
  const validate = input.seams.validate ?? validate_default
  const classify = input.seams.classify ?? classify_default
  const now = input.seams.now ?? Date.now

  try {
    if (read(input.run_id).status === "queued") {
      transition({
        id: input.run_id,
        to: "running",
      })
    }

    await execute({
      run: read(input.run_id),
      workflow_id: input.workflow_id,
      session_id: input.session_id,
      workspace_id: input.workspace_id,
      directory: input.directory,
      phase: "initial",
      attempt: 0,
      prompt: input.instructions,
      abort: input.abort,
    })

    if (input.abort.aborted) {
      cancel_status(input.run_id, "system")
      return
    }

    if (read(input.run_id).status === "running") {
      transition({
        id: input.run_id,
        to: "validating",
      })
    }

    let attempt = 0
    let first = 0

    while (true) {
      if (input.abort.aborted) {
        cancel_status(input.run_id, "system")
        return
      }

      const row = read(input.run_id)
      if (is_terminal(row.status)) return

      const verdict = validation_result.parse(
        await validate({
          run: row,
          workflow_id: input.workflow_id,
          session_id: input.session_id,
          workspace_id: input.workspace_id,
          directory: input.directory,
          attempt,
        }),
      )

      if (verdict.ok) break

      const mark = first || now()
      if (!first) first = mark

      if (attempt >= REPAIR_MAX || now() - mark >= REPAIR_WINDOW_MS) {
        if (input.mode === "manual") {
          fail(input.run_id, "repair_exhausted")
          return
        }
        throw new RuntimeTriggerFailureError({
          code: "validation_error",
          message: verdict.message ?? "workflow validation failed",
        })
        return
      }

      attempt += 1
      const repair = verdict.repair_prompt ?? `Validation failed: ${verdict.message ?? "invalid output"}. Repair and try again.`

      await execute({
        run: row,
        workflow_id: input.workflow_id,
        session_id: input.session_id,
        workspace_id: input.workspace_id,
        directory: input.directory,
        phase: "repair",
        attempt,
        prompt: repair,
        abort: input.abort,
      })
    }

    const row = read(input.run_id)
    if (is_terminal(row.status)) return

    const result = classification_result.parse(
      await classify({
        run: row,
        workflow_id: input.workflow_id,
        session_id: input.session_id,
        workspace_id: input.workspace_id,
        directory: input.directory,
        before: input.before,
      }),
    )

    const root_after = await files({
      directory: input.project_directory,
      exclude: input.root_exclude,
    })
    const escaped = changed(input.root_before, root_after)
    if (escaped.length > 0) {
      if (input.mode === "manual") {
        fail(input.run_id, "workspace_policy_blocked")
        return
      }
      throw new RuntimeTriggerFailureError({
        code: "workspace_policy_blocked",
        message: "workflow wrote outside the run workspace",
      })
      return
    }

    if (!result.changed_paths.length) {
      const done = transition({
        id: input.run_id,
        to: "completed_no_change",
      })
      publish_outcome(done.id)
      return
    }

    const queued = transition({
      id: input.run_id,
      to: "ready_for_integration",
    })
    publish_outcome(queued.id)

    RuntimeRun.candidate({
      id: input.run_id,
      integration_candidate_base_change_id: result.base_change_id ?? null,
      integration_candidate_change_ids: result.change_ids ?? [],
      integration_candidate_changed_paths: result.changed_paths,
    })

    queue_touch()
  } catch (error) {
    if (error instanceof NotFoundError) return
    if (error instanceof RuntimeTriggerFailureError) throw error
    const row = (() => {
      try {
        return read(input.run_id)
      } catch (next) {
        if (next instanceof NotFoundError) return
        throw next
      }
    })()
    if (!row) return
    if (row.status === "canceled") return
    if (input.mode === "manual") {
      fail(input.run_id, "manual_start_failed")
      return
    }
    throw new RuntimeTriggerFailureError({
      code: WorkflowTriggerFailure.classify(error),
      message: error instanceof Error ? error.message : "automated workflow failed",
    })
  }
}

async function launch_manual(input: {
  prepared: Awaited<ReturnType<typeof WorkflowGraphRun.prepare>>
  seams?: Seams
  cleanup_materials_on_fail: boolean
  seeds?: WorkflowGraphRun.ReplaySeed[]
  checkpoint_id?: string | null
  run_id?: string
}) {
  const workspace_id = workspace_required()
  const workspace = await Workspace.get(workspace_id)
  if (!workspace) throw new NotFoundError({ message: `Workspace not found: ${workspace_id}` })
  queue_start()

  const key_id = key(workspace_id, input.prepared.workflow.id)
  const lock = state().keys.get(key_id)
  if (lock) {
    throw new RuntimeManualRunDuplicateError({
      code: "manual_run_duplicate",
      workspace_id,
      workflow_id: input.prepared.workflow.id,
      trigger_id: null,
      run_id: lock.run_id,
    })
  }

  state().keys.set(key_id, { run_id: null })

  const all = current(input.seams)
  const adapter = (all.adapter ?? ((item: { directory: string }) => JJ.create({ cwd: item.directory })))({
    directory: Instance.directory,
  })

  const run_id = input.run_id ?? create_uuid_v7()
  const run_workspace_directory = adapter.workspace.path(run_id)

  let run: Row | undefined
  let session_id: string | undefined
  let task = false

  try {
    const session = await Session.createNext({
      directory: Instance.directory,
      title: `Workflow: ${input.prepared.workflow.name}`,
      workspaceID: workspace_id,
    })
    session_id = session.id

    run = RuntimeRun.create({
      id: run_id,
      status: "queued",
      trigger_type: "manual",
      workflow_id: input.prepared.workflow.id,
      workspace_id,
      session_id: session.id,
      run_workspace_root: path.dirname(run_workspace_directory),
      run_workspace_directory,
      trigger_metadata_json: null,
    })
    RuntimeSessionLink.upsert({
      session_id: session.id,
      role: "run_followup",
      run_id: run.id,
    })
    const snapshot = RuntimeRunSnapshot.create({
      run_id: run.id,
      workflow_id: input.prepared.workflow.id,
      workflow_revision_id: input.prepared.workflow_revision_id,
      workflow_hash: input.prepared.workflow_hash,
      workflow_text: input.prepared.workflow_text,
      graph_json: input.prepared.workflow,
      input_json: input.prepared.input_json,
      input_store_json: input.prepared.input_store_json,
      trigger_metadata_json: {},
      resource_materials_json: input.prepared.resource_materials_json,
      material_root: input.prepared.material_root,
    })
    const nodes = WorkflowGraphRun.create_nodes({
      run_id: run.id,
      snapshot_id: snapshot.id,
      workflow: input.prepared.workflow,
    })

    if (input.seeds?.length) {
      WorkflowGraphRun.seed_nodes({
        run_id: run.id,
        workflow: input.prepared.workflow,
        nodes,
        seeds: input.seeds,
      })
    }

    state().keys.set(key_id, { run_id: run.id })

    const created = await adapter.workspace.create(run.id)
    if (created.status !== "success") {
      nodes.forEach((node) => {
        if (node.status !== "pending" && node.status !== "ready") return
        RuntimeRunNode.transition({
          id: node.id,
          to: "canceled",
        })
      })
      fail(run.id, "manual_start_failed")
      await finalize_cleanup({
        run_id: run.id,
        adapter,
        workspace: created,
      })
      return present(read(run.id))
    }

    if (input.checkpoint_id) {
      await restore_checkpoint({
        source: checkpoint(input.prepared.material_root, input.checkpoint_id),
        target: created.directory,
      })
    }

    const relative = path.relative(Instance.directory, created.directory)
    const material_relative = path.relative(Instance.directory, input.prepared.material_root)
    const root_exclude = [relative, material_relative].filter((item) => item && item !== "." && !item.startsWith(".."))
    const root_before = await files({
      directory: Instance.directory,
      exclude: root_exclude,
    })
    const before = await files({
      directory: created.directory,
    })
    const abort = new AbortController()
    const run_ref = run.id
    const entry: Task = {
      key: key_id,
      abort,
      session_id: null,
      done: Promise.resolve(),
    }
    const graph_seams: {
      agent?: WorkflowGraphRun.AgentSeam
      script?: WorkflowGraphRun.ScriptSeam
    } = {
      agent:
        all.agent ??
        (all.execute
          ? async (value: GraphAgentInput) => {
              await all.execute?.({
                run: read(run_ref),
                workflow_id: value.workflow_id,
                session_id: value.session_id,
                workspace_id: value.workspace_id,
                directory: value.directory,
                phase: "initial",
                attempt: 0,
                prompt: value.prompt,
                abort: value.abort,
              })
              return {
                structured: null,
              }
            }
          : undefined),
      script: all.script,
    }
    state().tasks.set(run_ref, entry)
    const done = (async () => {
      try {
        if (read(run_ref).status === "queued") {
          transition({
            id: run_ref,
            to: "running",
          })
        }

        const result = await WorkflowGraphRun.execute({
          run_id: run_ref,
          workflow: input.prepared.workflow,
          directory: created.directory,
          workspace_id,
          nodes,
          prepared: input.prepared,
          abort: abort.signal,
          seams: graph_seams,
          on_session: (value) => {
            entry.session_id = value
          },
          on_checkpoint: (node_id) =>
            save_checkpoint({
              source: created.directory,
              target: checkpoint(input.prepared.material_root, node_id),
            }),
        })

        if (abort.signal.aborted || read(run_ref).status === "canceled") return

        if (read(run_ref).status === "running") {
          transition({
            id: run_ref,
            to: "validating",
          })
        }

        if (result.outcome === "failure") {
          fail(run_ref, "workflow_failed")
          return
        }

        if (result.outcome === "node_failed") {
          fail(run_ref, "node_execution_failed")
          return
        }

        const classify = all.classify ?? classify_default
        const result_value = classification_result.parse(
          await classify({
            run: read(run_ref),
            workflow_id: input.prepared.workflow.id,
            session_id: session.id,
            workspace_id,
            directory: created.directory,
            before,
          }),
        )

        const root_after = await files({
          directory: Instance.directory,
          exclude: root_exclude,
        })
        const escaped = changed(root_before, root_after)
        if (escaped.length > 0) {
          fail(run_ref, "workspace_policy_blocked")
          return
        }

        if (!result_value.changed_paths.length) {
          const done = transition({
            id: run_ref,
            to: "completed_no_change",
          })
          publish_outcome(done.id)
          return
        }

        const done = transition({
          id: run_ref,
          to: "ready_for_integration",
        })

        RuntimeRun.candidate({
          id: run_ref,
          integration_candidate_base_change_id: result_value.base_change_id ?? null,
          integration_candidate_change_ids: result_value.change_ids ?? [],
          integration_candidate_changed_paths: result_value.changed_paths,
        })

        queue_touch()
        publish_outcome(done.id)
      } catch (error) {
        if (error instanceof NotFoundError) return
        if (abort.signal.aborted || read(run_ref).status === "canceled") return
        if (error instanceof RuntimeWorkflowValidationError) {
          fail(run_ref, "validation_error")
          return
        }
        fail(run_ref, "manual_start_failed")
      }
    })().finally(async () => {
      await finalize_cleanup({
        run_id: run_ref,
        adapter,
        workspace: created,
      }).catch(() => undefined)
      state().tasks.delete(run_ref)
      state().keys.delete(key_id)
    })
    entry.done = done
    task = true

    return present(read(run_ref))
  } catch (error) {
    if (run) {
      fail(run.id, "manual_start_failed")
      await finalize_cleanup({
        run_id: run.id,
        adapter,
        workspace: {
          name: adapter.workspace.name(run.id),
          root: path.dirname(adapter.workspace.path(run.id)),
          directory: adapter.workspace.path(run.id),
        },
      }).catch(() => undefined)
    }
    throw error
  } finally {
    if (!run && session_id) {
      await Session.remove(session_id).catch(() => undefined)
    }
    if (!run && input.cleanup_materials_on_fail) {
      await WorkflowGraphRun.cleanup_materials(input.prepared.material_root).catch(() => undefined)
    }
    if (!task) state().keys.delete(key_id)
  }
}

export namespace WorkflowManualRun {
  export const StartInput = start_input
  export const ControlInput = control_input
  export const WaitInput = wait_input
  export const Info = info

  export const Testing = {
    set(input?: Seams) {
      override = input
    },
    reset() {
      override = undefined
    },
  }

  export async function start(value: z.input<typeof StartInput>, seams?: Seams) {
    const input = StartInput.parse(value)
    const gate = await WorkflowRunGate.validate({
      directory: Instance.directory,
      workflow_id: input.workflow_id,
    })
    const all = current(seams)
    const run_id = create_uuid_v7()
    const material_root = path.join(path.dirname(JJ.create({ cwd: Instance.directory }).workspace.path(run_id)), "materials", run_id)
    const prepared = await (all.prepare ?? WorkflowGraphRun.prepare)({
      directory: Instance.directory,
      workflow_id: gate.workflow.id,
      inputs: input.inputs,
      material_root,
    })
    return launch_manual({
      prepared,
      seams,
      cleanup_materials_on_fail: true,
      run_id,
    })
  }

  export async function replay(input: {
    prepared: WorkflowGraphRun.PrepareResult
    seeds: WorkflowGraphRun.ReplaySeed[]
    checkpoint_id?: string | null
  }, seams?: Seams) {
    const run_id = create_uuid_v7()
    const material_root = path.join(path.dirname(JJ.create({ cwd: Instance.directory }).workspace.path(run_id)), "materials", run_id)
    await clone_materials(input.prepared.material_root, material_root)
    return launch_manual({
      prepared: {
        ...input.prepared,
        material_root,
      },
      seeds: input.seeds,
      seams,
      cleanup_materials_on_fail: true,
      checkpoint_id: input.checkpoint_id ?? null,
      run_id,
    })
  }

  export function get(value: z.input<typeof ControlInput>) {
    const input = ControlInput.parse(value)
    return present(read_scoped(input.run_id))
  }

  export function cancel(value: z.input<typeof ControlInput>) {
    const input = ControlInput.parse(value)
    const row = read_scoped(input.run_id)
    if (row.status === "cancel_requested" || is_terminal(row.status)) return present(row)

    if (row.status === "queued" || row.status === "running" || row.status === "validating" || row.status === "ready_for_integration") {
      const task = state().tasks.get(input.run_id)
      task?.abort.abort()
      const session_id = task?.session_id ?? row.session_id
      if (session_id) {
        void Instance.provide({
          directory: row.run_workspace_directory ?? Instance.directory,
          fn: async () => {
            SessionPrompt.cancel(session_id)
          },
        }).catch(() => undefined)
      }
    }

    const next = cancel_status(input.run_id, "user")
    if (row.status === "ready_for_integration" || row.status === "integrating" || row.status === "reconciling") {
      queue_touch()
    }
    return present(next)
  }

  export async function wait(value: z.input<typeof WaitInput>) {
    const input = WaitInput.parse(value)
    const started = Date.now()

    while (true) {
      const row = read(input.run_id)
      const task = state().tasks.get(input.run_id)
      if (is_done(row.status) && !task) return present(row)

      if (input.timeout_ms && Date.now() - started >= input.timeout_ms) {
        return present(row)
      }

      if (task) {
        if (!input.timeout_ms) {
          await task.done
          continue
        }

        const remaining = input.timeout_ms - (Date.now() - started)
        if (remaining <= 0) return present(row)

        const settled = await Promise.race([
          task.done.then(
            () => true,
            () => true,
          ),
          Bun.sleep(Math.min(WAIT_STEP_MS, remaining)).then(() => false),
        ])
        if (settled) continue
      }

      await Bun.sleep(WAIT_STEP_MS)
    }
  }
}

export namespace WorkflowAutoRun {
  export const StartInput = automated_input
  export const Info = info

  export async function start(value: z.input<typeof StartInput>, seams?: Seams) {
    const input = StartInput.parse(value)
    const workspace_id = workspace_required()
    const workspace = await Workspace.get(workspace_id)
    if (!workspace) throw new NotFoundError({ message: `Workspace not found: ${workspace_id}` })
    queue_start()

    const key_id = key(workspace_id, input.workflow.id, input.trigger_id)
    const lock = state().keys.get(key_id)
    if (lock?.run_id) return present(read(lock.run_id))
    if (lock) {
      throw new RuntimeTriggerFailureError({
        code: "transient_runtime_error",
        message: `workflow already running: ${input.workflow.id}`,
      })
    }

    state().keys.set(key_id, { run_id: null })

    const all = current(seams)
    const adapter = (all.adapter ?? ((item: { directory: string }) => JJ.create({ cwd: item.directory })))({
      directory: Instance.directory,
    })

    let run: Row | undefined
    let session_id: string | undefined
    let task = false
    const run_id = create_uuid_v7()
    const run_workspace_directory = adapter.workspace.path(run_id)

    try {
      const session = await Session.createNext({
        directory: run_workspace_directory,
        title: `Workflow: ${input.workflow.name}`,
        workspaceID: workspace_id,
      })
      session_id = session.id

      run = RuntimeRun.create({
        id: run_id,
        status: "queued",
        trigger_type: input.trigger_type,
        workflow_id: input.workflow.id,
        workspace_id,
        session_id: session.id,
        run_workspace_root: path.dirname(run_workspace_directory),
        run_workspace_directory,
        trigger_metadata_json: input.trigger_metadata_json ?? null,
      })

      state().keys.set(key_id, { run_id: run.id })

      const run_ref = run.id
      const abort = new AbortController()
      const done = (async () => {
        for (let attempt = 0; ; attempt++) {
          const created = await adapter.workspace.create(run_ref)
          if (created.status !== "success") {
            if (attempt >= AUTOMATED_RETRY_MAX) {
              fail(run_ref, "transient_runtime_error", "retry_exhausted")
              await finalize_cleanup({
                run_id: run_ref,
                adapter,
                workspace: created,
              }).catch(() => undefined)
              return
            }

            await finalize_cleanup({
              run_id: run_ref,
              adapter,
              workspace: created,
            }).catch(() => undefined)
            await Bun.sleep(automated_delay(attempt))
            continue
          }

          const relative = path.relative(Instance.directory, created.directory)
          const root_exclude = [relative]
          const root_before = await files({
            directory: Instance.directory,
            exclude: root_exclude,
          })
          const before = await files({
            directory: created.directory,
          })

          try {
            await drive({
              run_id: run_ref,
              session_id: session.id,
              instructions: prompt(input.workflow),
              workflow_id: input.workflow.id,
              workspace_id,
              project_directory: Instance.directory,
              directory: created.directory,
              before,
              root_before,
              root_exclude,
              abort: abort.signal,
              mode: "automated",
              seams: all,
            })
            await finalize_cleanup({
              run_id: run_ref,
              adapter,
              workspace: created,
            }).catch(() => undefined)
            return
          } catch (error) {
            if (!(error instanceof RuntimeTriggerFailureError)) throw error

            await finalize_cleanup({
              run_id: run_ref,
              adapter,
              workspace: created,
            }).catch(() => undefined)

            if (!WorkflowTriggerFailure.retryable(error.data.code)) {
              fail(run_ref, error.data.code, "non_retryable")
              return
            }

            if (attempt >= AUTOMATED_RETRY_MAX) {
              fail(run_ref, error.data.code, "retry_exhausted")
              return
            }

            await Bun.sleep(automated_delay(attempt))
          }
        }
      })().finally(async () => {
        state().tasks.delete(run_ref)
        state().keys.delete(key_id)
      })

      state().tasks.set(run_ref, {
        key: key_id,
        abort,
        session_id: session.id,
        done,
      })
      task = true

      return present(read(run_ref))
    } catch (error) {
      if (run) {
        fail(run.id, "transient_runtime_error", "retry_exhausted")
        await finalize_cleanup({
          run_id: run.id,
          adapter,
          workspace: {
            name: adapter.workspace.name(run.id),
            root: path.dirname(adapter.workspace.path(run.id)),
            directory: adapter.workspace.path(run.id),
          },
        }).catch(() => undefined)
      }
      throw error
    } finally {
      if (!run && session_id) {
        await Session.remove(session_id).catch(() => undefined)
      }
      if (!task) state().keys.delete(key_id)
    }
  }
}
