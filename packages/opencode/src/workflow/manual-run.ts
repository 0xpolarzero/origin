import { stat } from "node:fs/promises"
import path from "node:path"
import { JJ } from "@/project/jj"
import { Instance } from "@/project/instance"
import { RuntimeRun } from "@/runtime/run"
import { create_uuid_v7, uuid_v7 } from "@/runtime/uuid"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { terminal_run_statuses } from "@/runtime/contract"
import { RuntimeIllegalTransitionError, RuntimeManualRunDuplicateError, RuntimeManualRunWorkspaceRequiredError } from "@/runtime/error"
import { NotFoundError } from "@/storage/db"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Workspace } from "@/control-plane/workspace"
import { WorkflowIntegrationQueue } from "./integration-queue"
import { WorkflowRunGate } from "./run-gate"
import z from "zod"

const REPAIR_MAX = 3
const REPAIR_WINDOW_MS = 10 * 60 * 1000
const WAIT_STEP_MS = 50

const start_input = z
  .object({
    workflow_id: z.string().min(1),
    trigger_id: z.string().min(1).optional(),
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
  validate?: (input: ValidateInput) => Promise<z.output<typeof validation_result>>
  classify?: (input: ClassifyInput) => Promise<z.output<typeof classification_result>>
}

type Task = {
  key: string
  abort: AbortController
  session_id: string
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

function fail(run_id: string, failure_code: "manual_start_failed" | "repair_exhausted" | "workspace_policy_blocked") {
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
    return transition({
      id: run_id,
      to: "failed",
      failure_code,
    })
  } catch (error) {
    if (error instanceof RuntimeIllegalTransitionError) return read(run_id)
    throw error
  }
}

function cancel_status(run_id: string, actor_type: "system" | "user") {
  while (true) {
    const row = read(run_id)
    if (row.status === "cancel_requested" || is_terminal(row.status)) return row

    const to = row.status === "integrating" || row.status === "reconciling" ? "cancel_requested" : "canceled"
    const reason_code = to === "cancel_requested" ? "cancel_requested_after_integration_started" : undefined

    try {
      return transition({
        id: run_id,
        to,
        reason_code,
        actor_type,
      })
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
  seams: Seams
}) {
  const execute = input.seams.execute ?? execute_default
  const validate = input.seams.validate ?? validate_default
  const classify = input.seams.classify ?? classify_default
  const now = input.seams.now ?? Date.now

  try {
    transition({
      id: input.run_id,
      to: "running",
    })

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

    transition({
      id: input.run_id,
      to: "validating",
    })

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
        fail(input.run_id, "repair_exhausted")
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
      fail(input.run_id, "workspace_policy_blocked")
      return
    }

    if (!result.changed_paths.length) {
      transition({
        id: input.run_id,
        to: "completed_no_change",
      })
      return
    }

    transition({
      id: input.run_id,
      to: "ready_for_integration",
    })

    RuntimeRun.candidate({
      id: input.run_id,
      integration_candidate_base_change_id: result.base_change_id ?? null,
      integration_candidate_change_ids: result.change_ids ?? [],
      integration_candidate_changed_paths: result.changed_paths,
    })

    queue_touch()
  } catch (error) {
    if (error instanceof NotFoundError) return
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
    fail(input.run_id, "manual_start_failed")
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
    const workspace_id = workspace_required()
    const workspace = await Workspace.get(workspace_id)
    if (!workspace) throw new NotFoundError({ message: `Workspace not found: ${workspace_id}` })
    queue_start()

    const gate = await WorkflowRunGate.validate({
      directory: Instance.directory,
      workflow_id: input.workflow_id,
    })

    const run_id = create_uuid_v7()
    const key_id = key(workspace_id, input.workflow_id, input.trigger_id)
    const lock = state().keys.get(key_id)
    if (lock) {
      throw new RuntimeManualRunDuplicateError({
        code: "manual_run_duplicate",
        workspace_id,
        workflow_id: input.workflow_id,
        trigger_id: input.trigger_id ?? null,
        run_id: lock.run_id,
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
    const run_workspace_directory = adapter.workspace.path(run_id)

    try {
      const session = await Session.createNext({
        directory: run_workspace_directory,
        title: `Workflow: ${gate.workflow.name}`,
      })
      session_id = session.id

      run = RuntimeRun.create({
        id: run_id,
        status: "queued",
        trigger_type: "manual",
        workflow_id: gate.workflow.id,
        workspace_id,
        session_id: session.id,
        run_workspace_root: path.dirname(run_workspace_directory),
        run_workspace_directory,
      })

      state().keys.set(key_id, { run_id: run.id })

      const workspace = await adapter.workspace.create(run.id)
      if (workspace.status !== "success") {
        fail(run.id, "manual_start_failed")
        await finalize_cleanup({
          run_id: run.id,
          adapter,
          workspace,
        })
        return present(read(run.id))
      }

      const relative = path.relative(Instance.directory, workspace.directory)
      const root_exclude = [relative]
      const root_before = await files({
        directory: Instance.directory,
        exclude: root_exclude,
      })
      const before = await files({
        directory: workspace.directory,
      })
      const abort = new AbortController()
      const run_ref = run.id
      const done = drive({
        run_id: run_ref,
        session_id: session.id,
        instructions: gate.workflow.instructions,
        workflow_id: gate.workflow.id,
        workspace_id,
        project_directory: Instance.directory,
        directory: workspace.directory,
        before,
        root_before,
        root_exclude,
        abort: abort.signal,
        seams: all,
      }).finally(async () => {
        await finalize_cleanup({
          run_id: run_ref,
          adapter,
          workspace,
        }).catch(() => undefined)
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
      if (!task) state().keys.delete(key_id)
    }
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
      if (row.session_id) {
        void Instance.provide({
          directory: row.run_workspace_directory ?? Instance.directory,
          fn: async () => {
            SessionPrompt.cancel(row.session_id!)
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
