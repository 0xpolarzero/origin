import { cp, mkdir, rename } from "node:fs/promises"
import path from "node:path"
import { createPatch } from "diff"
import { RuntimeWorkflowEdit } from "@/runtime/workflow-edit"
import { RuntimeWorkflowRevision } from "@/runtime/workflow-revision"
import { RuntimeWorkflowTrigger } from "@/runtime/workflow-trigger"
import { WorkflowValidation } from "./validate"
import { WorkflowManualRun } from "./manual-run"
import { WorkflowDetail } from "./detail"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { RuntimeSessionLink } from "@/runtime/session-link"
import { Database, NotFoundError, desc, eq, inArray } from "@/storage/db"
import { RunTable } from "@/runtime/runtime.sql"
import { SessionTable } from "@/session/session.sql"
import { workflow_schema, workflow_item, type Workflow, type WorkflowItem } from "./contract"
import z from "zod"

const action = z.enum(["builder", "node_edit", "graph_edit", "duplicate", "hide"])

const session_role = z.enum(["builder", "node_edit"])

const run = z
  .object({
    id: z.string(),
    status: z.string(),
    created_at: z.number(),
    started_at: z.number().nullable(),
    finished_at: z.number().nullable(),
  })
  .strict()

const summary = z
  .object({
    id: z.string(),
    file: z.string(),
    name: z.string(),
    description: z.string().optional(),
    runnable: z.boolean(),
    errors: z.array(workflow_item.shape.errors.element),
    trigger_summary: z.string(),
    last_run: run.nullable(),
    last_edit: z
      .object({
        created_at: z.number(),
        action,
        note: z.string().nullable(),
      })
      .nullable(),
  })
  .strict()

const page = z
  .object({
    items: z.array(summary),
  })
  .strict()

const save_input = z
  .object({
    workflow: workflow_schema,
    file: z.string().min(1).optional(),
    resources: z.record(z.string(), z.string()).default({}),
    action: action.default("graph_edit"),
    session_id: z.string().nullable().optional(),
    node_id: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .strict()

const build_input = z
  .object({
    prompt: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict()

const session_input = z
  .object({
    workflow_id: z.string().min(1),
    role: session_role,
    node_id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  })
  .strict()

const copy_input = z
  .object({
    name: z.string().min(1).optional(),
  })
  .strict()

const rerun_input = z
  .object({
    node_id: z.string().min(1).optional(),
  })
  .strict()

const build_result = z
  .object({
    workflow_id: z.string(),
    file: z.string(),
    session_id: z.string(),
  })
  .strict()

const copy_result = z
  .object({
    workflow_id: z.string(),
    file: z.string(),
  })
  .strict()

const session_result = z
  .object({
    session_id: z.string(),
  })
  .strict()

const hide_result = z
  .object({
    workflow_id: z.string(),
    hidden: z.literal(true),
    file: z.string(),
    target: z.string(),
  })
  .strict()

const history_item = z
  .object({
    edit: RuntimeWorkflowEdit.View,
    revision: RuntimeWorkflowRevision.View,
    previous_revision: RuntimeWorkflowRevision.View.nullable(),
    diff: z.string(),
    session: z
      .object({
        id: z.string(),
        title: z.string(),
        directory: z.string(),
      })
      .nullable(),
  })
  .strict()

const history_page = z
  .object({
    items: z.array(history_item),
    next_cursor: z.string().nullable(),
  })
  .strict()

export class WorkflowRerunTargetError extends Error {}

type Seed = Parameters<typeof WorkflowManualRun.replay>[0]["seeds"][number]
type RunView = Awaited<ReturnType<typeof WorkflowDetail.run>>

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function title(input: string) {
  const raw = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
  if (raw.length === 0) return "New workflow"
  return raw.map((item) => item[0]?.toUpperCase() + item.slice(1)).join(" ")
}

function trig(item: WorkflowItem) {
  const value = item.workflow?.trigger.type ?? "manual"
  const list = RuntimeWorkflowTrigger.list()
    .filter((row) => row.workflow_id === item.id)
    .map((row) => `${row.trigger_type}:${row.trigger_value}`)
  if (list.length === 0) return value
  return [value, ...list].join(" | ")
}

function root(dir: string, id: string) {
  return path.join(dir, ".origin", "workflows", id)
}

function unique(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, raw: string) {
  const base = slug(raw) || "workflow"
  const ids = new Set(report.workflows.map((item) => item.id))
  if (!ids.has(base)) return base
  let idx = 2
  while (ids.has(`${base}-${idx}`)) idx += 1
  return `${base}-${idx}`
}

function file(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, raw: string) {
  const base = slug(raw) || "workflow"
  const files = new Set(report.workflows.map((item) => item.file))
  const first = `.origin/workflows/${base}.yaml`
  if (!files.has(first)) return first
  let idx = 2
  while (files.has(`.origin/workflows/${base}-${idx}.yaml`)) idx += 1
  return `.origin/workflows/${base}-${idx}.yaml`
}

async function session(input: z.output<typeof session_input>) {
  const next = await Session.create({
    title: input.title,
  })
  RuntimeSessionLink.upsert({
    session_id: next.id,
    role: input.role,
    visibility: "hidden",
  })
  if (input.text) {
    await SessionPrompt.prompt({
      sessionID: next.id,
      noReply: true,
      parts: [
        {
          type: "text",
          text: input.text,
          synthetic: true,
        },
      ],
    })
  }
  return session_result.parse({
    session_id: next.id,
  })
}

function patch(
  current: z.output<typeof RuntimeWorkflowRevision.View>,
  prev: z.output<typeof RuntimeWorkflowRevision.View> | null,
) {
  return createPatch(current.file, prev?.canonical_text ?? "", current.canonical_text, "previous", "current")
}

function record(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function visit(steps: Workflow["steps"], fn: (step: Workflow["steps"][number]) => void) {
  steps.forEach((step) => {
    fn(step)
    if (step.kind !== "condition") return
    visit(step.then ?? [], fn)
    visit(step.else ?? [], fn)
  })
}

function branch(item: RunView["nodes"][number]) {
  const value = record(item.node.output_json)?.branch
  if (value === "then" || value === "else") return value
}

function seed(item: RunView["nodes"][number]): Seed {
  const attempt = item.attempts.at(-1)?.attempt
  return {
    node_id: item.node.node_id,
    status: "succeeded",
    output_json: item.node.output_json ?? null,
    ...(attempt
      ? {
          attempt: {
            input_json: attempt.input_json ?? null,
            output_json: attempt.output_json ?? null,
            error_json: attempt.error_json ?? null,
          },
        }
      : {}),
  }
}

function plan(run: RunView, node_id: string) {
  const picked = run.nodes.find((item) => item.node.node_id === node_id)
  if (!picked) throw new NotFoundError({ message: `Run node not found: ${run.run.id}/${node_id}` })
  if (picked.node.status === "skipped") {
    throw new WorkflowRerunTargetError(`Cannot rerun from skipped node: ${node_id}`)
  }

  const nodes = new Map(run.nodes.map((item) => [item.node.node_id, item] as const))
  const seeds = new Map<string, Seed>()
  let checkpoint_id: string | null = null

  const put = (item: Seed) => {
    seeds.set(item.node_id, item)
    const node = nodes.get(item.node_id)
    if (item.status !== "succeeded" || !node) return
    if (node.node.kind !== "agent_request" && node.node.kind !== "script") return
    checkpoint_id = item.node_id
  }

  const skip = (steps: Workflow["steps"]) => {
    visit(steps, (step) => {
      put({
        node_id: step.id,
        status: "skipped",
        skip_reason_code: "branch_not_taken",
      })
    })
  }

  const walk = (steps: Workflow["steps"]): boolean => {
    for (const step of steps) {
      if (step.id === node_id) return true
      const item = nodes.get(step.id)
      if (!item) throw new NotFoundError({ message: `Run node not found: ${run.run.id}/${step.id}` })

      if (step.kind === "condition") {
        if (item.node.status !== "succeeded") {
          throw new WorkflowRerunTargetError(
            `Cannot rerun from ${node_id} because upstream condition ${step.id} ended with ${item.node.status}.`,
          )
        }
        const next = branch(item)
        if (!next) throw new WorkflowRerunTargetError(`Cannot reuse condition branch for ${step.id}.`)
        put(seed(item))
        if (next === "then") skip(step.else ?? [])
        if (next === "else") skip(step.then ?? [])
        const found = walk(next === "then" ? step.then ?? [] : step.else ?? [])
        if (found) return true
        continue
      }

      if (item.node.status !== "succeeded") {
        throw new WorkflowRerunTargetError(
          `Cannot rerun from ${node_id} because upstream node ${step.id} ended with ${item.node.status}.`,
        )
      }
      put(seed(item))
    }
    return false
  }

  if (!walk(run.snapshot.graph_json.steps)) {
    throw new WorkflowRerunTargetError(`Cannot rerun from node: ${node_id}`)
  }

  return {
    seeds: [...seeds.values()],
    checkpoint_id,
  }
}

async function edit(input: {
  workflow_id: string
  file: string
  text: string
  action: z.infer<typeof action>
  session_id?: string | null
  node_id?: string | null
  note?: string | null
}) {
  const prev = RuntimeWorkflowRevision.head({
    project_id: Instance.project.id,
    workflow_id: input.workflow_id,
  })
  const next = RuntimeWorkflowRevision.observe({
    project_id: Instance.project.id,
    workflow_id: input.workflow_id,
    file: input.file,
    canonical_text: input.text,
  })
  if (prev?.id === next.id) return next
  RuntimeWorkflowEdit.record({
    project_id: Instance.project.id,
    workflow_id: input.workflow_id,
    workflow_revision_id: next.id,
    previous_workflow_revision_id: prev?.id ?? null,
    session_id: input.session_id ?? null,
    action: input.action,
    node_id: input.node_id ?? null,
    note: input.note ?? null,
  })
  return next
}

async function row(item: WorkflowItem) {
  const runs = Database.use((db) =>
    db
      .select({
        id: RunTable.id,
        status: RunTable.status,
        created_at: RunTable.created_at,
        started_at: RunTable.started_at,
        finished_at: RunTable.finished_at,
      })
      .from(RunTable)
      .where(eq(RunTable.workflow_id, item.id))
      .orderBy(desc(RunTable.created_at), desc(RunTable.id))
      .limit(1)
      .all(),
  )
  const edits = RuntimeWorkflowEdit.list({
    project_id: Instance.project.id,
    workflow_id: item.id,
    limit: 1,
  })
  return summary.parse({
    id: item.id,
    file: item.file,
    name: item.workflow?.name ?? item.id,
    description: item.workflow?.description,
    runnable: item.runnable,
    errors: item.errors,
    trigger_summary: trig(item),
    last_run: runs[0] ?? null,
    last_edit: edits.items[0]
      ? {
          created_at: edits.items[0].created_at,
          action: edits.items[0].action,
          note: edits.items[0].note,
        }
      : null,
  })
}

function pick(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, workflow_id: string) {
  const matches = report.workflows.filter((item) => item.id === workflow_id)
  if (matches.length === 0) throw new Error(`workflow not found: ${workflow_id}`)
  if (matches.length > 1) throw new Error(`workflow id is ambiguous: ${workflow_id}`)
  const item = matches[0]
  if (!item.workflow) throw new Error(`workflow is not editable: ${workflow_id}`)
  return item as WorkflowItem & { workflow: NonNullable<WorkflowItem["workflow"]> }
}

export namespace WorkflowAuthoring {
  export const Summary = summary
  export const Page = page
  export const SaveInput = save_input
  export const BuildInput = build_input
  export const CopyInput = copy_input
  export const RerunInput = rerun_input
  export const BuildResult = build_result
  export const CopyResult = copy_result
  export const SessionInput = session_input
  export const SessionResult = session_result
  export const HideResult = hide_result
  export const HistoryItem = history_item
  export const HistoryPage = history_page

  export async function list() {
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    return page.parse({
      items: await Promise.all(report.workflows.map(row)),
    })
  }

  export async function build(input: z.input<typeof BuildInput>) {
    const value = BuildInput.parse(input)
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    const name = value.name?.trim() || title(value.prompt)
    const id = unique(report, name)
    const rel = file(report, name)
    const file_path = path.join(Instance.directory, rel)
    const prompt_id = "builder_prompt"
    const prompt_path = "prompts/builder.txt"
    const prompt_abs = path.join(root(Instance.directory, id), prompt_path)
    const body = workflow_schema.parse({
      schema_version: 2,
      id,
      name,
      description: `Built from: ${value.prompt}`,
      trigger: {
        type: "manual",
      },
      inputs: [],
      resources: [
        {
          id: prompt_id,
          source: "local",
          kind: "prompt_template",
          path: prompt_path,
        },
      ],
      steps: [
        {
          id: "draft",
          kind: "agent_request",
          title: "Draft",
          prompt: {
            source: "resource",
            resource_id: prompt_id,
          },
        },
        {
          id: "done",
          kind: "end",
          title: "Done",
          result: "success",
        },
      ],
    } satisfies Workflow)
    const text = Bun.YAML.stringify(body).trim() + "\n"
    await mkdir(path.dirname(file_path), { recursive: true })
    await mkdir(path.dirname(prompt_abs), { recursive: true })
    await Bun.write(file_path, text)
    await Bun.write(prompt_abs, value.prompt.trim() + "\n")
    const link = await session({
      workflow_id: id,
      role: "builder",
      title: `Builder: ${name}`,
      text: `Workflow ${id} was created at ${rel}. Continue refining the workflow and its local resources in this hidden builder session.`,
    })
    await edit({
      workflow_id: id,
      file: rel,
      text,
      action: "builder",
      session_id: link.session_id,
      note: "Initial builder draft",
    })
    return build_result.parse({
      workflow_id: id,
      file: rel,
      session_id: link.session_id,
    })
  }

  export async function copy(workflow_id: string, input?: z.input<typeof CopyInput>) {
    const value = CopyInput.parse(input ?? {})
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    const item = pick(report, workflow_id)
    const name = value.name?.trim() || `${item.workflow.name} Copy`
    const id = unique(report, name)
    const rel = file(report, name)
    const next = workflow_schema.parse({
      ...item.workflow,
      id,
      name,
    } satisfies Workflow)
    const text = Bun.YAML.stringify(next).trim() + "\n"
    const target = path.join(Instance.directory, rel)
    await mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, text)
    await cp(root(Instance.directory, item.id), root(Instance.directory, id), {
      recursive: true,
      force: true,
    }).catch(() => undefined)
    await edit({
      workflow_id: id,
      file: rel,
      text,
      action: "duplicate",
      note: `Duplicated from ${item.id}`,
    })
    return copy_result.parse({
      workflow_id: id,
      file: rel,
    })
  }

  export async function hide(workflow_id: string) {
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    const item = pick(report, workflow_id)
    const text = await Bun.file(path.join(Instance.directory, item.file)).text()
    await edit({
      workflow_id: item.id,
      file: item.file,
      text,
      action: "hide",
      note: "Hidden from workflow index",
    })
    const target = path.join(".origin", "workflows", ".hidden", path.basename(item.file))
    await mkdir(path.join(Instance.directory, ".origin", "workflows", ".hidden"), { recursive: true })
    await rename(path.join(Instance.directory, item.file), path.join(Instance.directory, target))
    return hide_result.parse({
      workflow_id: item.id,
      hidden: true,
      file: item.file,
      target,
    })
  }

  export async function save(input: z.input<typeof SaveInput>) {
    const value = SaveInput.parse(input)
    const rel = value.file ?? `.origin/workflows/${slug(value.workflow.id) || value.workflow.id}.yaml`
    const target = path.join(Instance.directory, rel)
    const text = Bun.YAML.stringify(value.workflow).trim() + "\n"
    await mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, text)
    await Promise.all(
      value.workflow.resources
        .filter((item) => item.source === "local")
        .map(async (item) => {
          const content = value.resources[item.path]
          if (content === undefined) return
          const file = path.join(root(Instance.directory, value.workflow.id), item.path)
          await mkdir(path.dirname(file), { recursive: true })
          await Bun.write(file, content.endsWith("\n") ? content : `${content}\n`)
        }),
    )
    await edit({
      workflow_id: value.workflow.id,
      file: rel,
      text,
      action: value.action,
      session_id: value.session_id ?? null,
      node_id: value.node_id ?? null,
      note: value.note ?? null,
    })
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    const item = report.workflows.find((item) => item.id === value.workflow.id)
    if (!item) throw new Error(`workflow not found after save: ${value.workflow.id}`)
    return WorkflowDetail.workflow({
      directory: Instance.directory,
      item,
    })
  }

  export async function open(input: z.input<typeof SessionInput>) {
    const value = SessionInput.parse(input)
    return session({
      ...value,
      text:
        value.text ??
        (value.role === "builder"
          ? `Continue building workflow ${value.workflow_id}.`
          : `Continue editing node ${value.node_id ?? "selected"} in workflow ${value.workflow_id}.`),
    })
  }

  export async function history(input: {
    workflow_id?: string
    cursor?: string
    limit?: number
  }) {
    const edits = RuntimeWorkflowEdit.list({
      project_id: Instance.project.id,
      workflow_id: input.workflow_id,
      cursor: input.cursor,
      limit: input.limit,
    })
    const rev_ids = [
      ...new Set(
        edits.items
          .flatMap((item) => [item.workflow_revision_id, item.previous_workflow_revision_id])
          .filter((item): item is string => !!item),
      ),
    ]
    const ses_ids = [...new Set(edits.items.map((item) => item.session_id).filter((item): item is string => !!item))]
    const revs = new Map(rev_ids.map((id) => [id, RuntimeWorkflowRevision.get({ id: id! })]))
    const sessions =
      ses_ids.length === 0
        ? new Map<string, { id: string; title: string; directory: string }>()
        : new Map(
            Database.use((db) =>
              db
                .select({
                  id: SessionTable.id,
                  title: SessionTable.title,
                  directory: SessionTable.directory,
                })
                .from(SessionTable)
                .where(inArray(SessionTable.id, ses_ids))
                .all(),
            ).map((item) => [item.id, item]),
          )

    return history_page.parse({
      items: edits.items.map((item) => {
        const revision = revs.get(item.workflow_revision_id)
        if (!revision) throw new Error(`workflow revision missing: ${item.workflow_revision_id}`)
        const previous_revision = item.previous_workflow_revision_id ? revs.get(item.previous_workflow_revision_id) ?? null : null
        return {
          edit: item,
          revision,
          previous_revision,
          diff: patch(revision, previous_revision),
          session: item.session_id ? sessions.get(item.session_id) ?? null : null,
        }
      }),
      next_cursor: edits.next_cursor,
    })
  }

  export async function rerun(run_id: string, input?: z.input<typeof RerunInput>) {
    const run = await WorkflowDetail.run({
      run_id,
    })
    const body = RerunInput.parse(input ?? {})
    if (body.node_id) {
      const replay = plan(run, body.node_id)
      return WorkflowManualRun.replay({
        prepared: {
          workflow: workflow_schema.parse(run.snapshot.graph_json),
          workflow_text: run.snapshot.workflow_text,
          workflow_revision_id: run.snapshot.workflow_revision_id,
          workflow_hash: run.snapshot.workflow_hash,
          input_json: run.snapshot.input_json,
          input_store_json: run.snapshot.input_store_json,
          resource_materials_json: run.snapshot.resource_materials_json,
          material_root: run.snapshot.material_root,
        },
        seeds: replay.seeds,
        checkpoint_id: replay.checkpoint_id,
      })
    }
    return WorkflowManualRun.start({
      workflow_id: run.snapshot.workflow_id,
      inputs: run.snapshot.input_json,
    })
  }
}
