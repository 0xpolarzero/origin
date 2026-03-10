import path from "node:path"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { Instance } from "@/project/instance"
import { RuntimeHistory } from "@/runtime/history"
import { RuntimeRun } from "@/runtime/run"
import { RuntimeRunAttempt } from "@/runtime/run-attempt"
import { RuntimeRunEvent } from "@/runtime/run-event"
import { RuntimeRunNode } from "@/runtime/run-node"
import { RuntimeRunSnapshot } from "@/runtime/run-snapshot"
import { RuntimeSessionLink } from "@/runtime/session-link"
import { RuntimeWorkflowRevision } from "@/runtime/workflow-revision"
import { RunSnapshotTable, RunTable } from "@/runtime/runtime.sql"
import { uuid_v7 } from "@/runtime/uuid"
import { Session } from "@/session"
import { Database, NotFoundError, and, desc, eq } from "@/storage/db"
import {
  validation_issue,
  workflow_item,
  workflow_item_view,
  workflow_resource_kind,
  workflow_schema,
  workflow_schema_view,
  workflow_step,
  workflow_step_view,
} from "./contract"
import { WorkflowManualRun } from "./manual-run"
import z from "zod"

const resource_detail = z.discriminatedUnion("source", [
  z
    .object({
      id: z.string(),
      source: z.literal("local"),
      kind: workflow_resource_kind,
      path: z.string(),
      used_by: z.array(z.string()),
      errors: z.array(validation_issue),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      source: z.literal("library"),
      kind: workflow_resource_kind,
      item_id: z.string(),
      used_by: z.array(z.string()),
      errors: z.array(validation_issue),
    })
    .strict(),
])

const workflow_run = RuntimeHistory.RunItem.extend({
  snapshot_id: uuid_v7.nullable(),
  workflow_revision_id: uuid_v7.nullable(),
})

const session_summary = z
  .object({
    id: z.string(),
    title: z.string(),
    directory: z.string(),
  })
  .strict()

const linked_session = z
  .object({
    link: RuntimeSessionLink.View,
    session: session_summary.nullable(),
  })
  .strict()

const attempt_detail = z
  .object({
    attempt: RuntimeRunAttempt.View,
    session: linked_session.nullable(),
  })
  .strict()

const node_detail = z
  .object({
    node: RuntimeRunNode.View,
    step: workflow_step,
    attempts: z.array(attempt_detail),
  })
  .strict()

const node_detail_view = z
  .object({
    node: RuntimeRunNode.View,
    step: workflow_step_view,
    attempts: z.array(attempt_detail),
  })
  .strict()

const snapshot_view = z
  .object({
    id: uuid_v7,
    run_id: uuid_v7,
    workflow_id: z.string(),
    workflow_revision_id: uuid_v7,
    workflow_hash: z.string(),
    workflow_text: z.string(),
    graph_json: workflow_schema_view,
    input_json: z.record(z.string(), z.unknown()),
    input_store_json: z.record(z.string(), z.unknown()),
    trigger_metadata_json: z.record(z.string(), z.unknown()),
    resource_materials_json: z.record(z.string(), z.unknown()),
    material_root: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .strict()

const workflow_detail = z
  .object({
    item: workflow_item,
    revision_head: RuntimeWorkflowRevision.View.nullable(),
    resources: z.array(resource_detail),
    runs: z.array(workflow_run),
  })
  .strict()

const workflow_detail_view = z
  .object({
    item: workflow_item_view,
    revision_head: RuntimeWorkflowRevision.View.nullable(),
    resources: z.array(resource_detail),
    runs: z.array(workflow_run),
  })
  .strict()

const run_detail = z
  .object({
    run: WorkflowManualRun.Info,
    snapshot: RuntimeRunSnapshot.View,
    revision: RuntimeWorkflowRevision.View,
    live: z
      .object({
        current_revision_id: uuid_v7.nullable(),
        has_newer_revision: z.boolean(),
      })
      .strict(),
    nodes: z.array(node_detail),
    events: z.array(RuntimeRunEvent.View),
    followup: linked_session.nullable(),
  })
  .strict()

const run_detail_view = z
  .object({
    run: WorkflowManualRun.Info,
    snapshot: snapshot_view,
    revision: RuntimeWorkflowRevision.View,
    live: z
      .object({
        current_revision_id: uuid_v7.nullable(),
        has_newer_revision: z.boolean(),
      })
      .strict(),
    nodes: z.array(node_detail_view),
    events: z.array(RuntimeRunEvent.View),
    followup: linked_session.nullable(),
  })
  .strict()

function visit(steps: z.infer<typeof workflow_schema>["steps"], fn: (step: z.infer<typeof workflow_step>) => void) {
  steps.forEach((step) => {
    fn(step)
    if (step.kind !== "condition") return
    visit(step.then ?? [], fn)
    visit(step.else ?? [], fn)
  })
}

function used_by(steps: z.infer<typeof workflow_schema>["steps"]) {
  const out = new Map<string, string[]>()
  visit(steps, (step) => {
    const resource_id =
      step.kind === "agent_request" && step.prompt?.source === "resource"
        ? step.prompt.resource_id
        : step.kind === "script" && step.script?.source === "resource"
          ? step.script.resource_id
          : null
    if (!resource_id) return
    const list = out.get(resource_id) ?? []
    if (!list.includes(step.id)) list.push(step.id)
    out.set(resource_id, list)
  })
  return out
}

function indexed(steps: z.infer<typeof workflow_schema>["steps"]) {
  const out = new Map<string, z.infer<typeof workflow_step>>()
  visit(steps, (step) => {
    out.set(step.id, step)
  })
  return out
}

async function maybe_session(session_id: string) {
  return Session.get(session_id).catch(() => null)
}

async function linked(link: z.infer<typeof RuntimeSessionLink.View> | null) {
  if (!link) return null
  const session = await maybe_session(link.session_id)
  return linked_session.parse({
    link,
    session: session
      ? {
          id: session.id,
          title: session.title,
          directory: session.directory,
        }
      : null,
  })
}

function resource_errors(item: z.infer<typeof workflow_item>, index: number) {
  const prefix = `$.resources[${index}]`
  return item.errors.filter((error) => error.path === prefix || error.path.startsWith(`${prefix}.`))
}

function workflow_runs(workflow_id: string) {
  return Database.use((db) => {
    const rows = db
      .select({
        id: RunTable.id,
        status: RunTable.status,
        trigger_type: RunTable.trigger_type,
        workflow_id: RunTable.workflow_id,
        workspace_id: RunTable.workspace_id,
        session_id: RunTable.session_id,
        reason_code: RunTable.reason_code,
        failure_code: RunTable.failure_code,
        trigger_metadata: RunTable.trigger_metadata_json,
        ready_for_integration_at: RunTable.ready_for_integration_at,
        created_at: RunTable.created_at,
        updated_at: RunTable.updated_at,
        started_at: RunTable.started_at,
        finished_at: RunTable.finished_at,
        snapshot_id: RunSnapshotTable.id,
        workflow_revision_id: RunSnapshotTable.workflow_revision_id,
      })
      .from(RunTable)
      .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, RunTable.workspace_id))
      .leftJoin(RunSnapshotTable, eq(RunSnapshotTable.run_id, RunTable.id))
      .where(and(eq(RunTable.workflow_id, workflow_id), eq(WorkspaceTable.project_id, Instance.project.id)))
      .orderBy(desc(RunTable.created_at), desc(RunTable.id))
      .limit(50)
      .all()

    return rows.map((row) =>
      workflow_run.parse({
        id: row.id,
        status: row.status,
        trigger_type: row.trigger_type,
        workflow_id: row.workflow_id,
        workspace_id: row.workspace_id,
        session_id: row.session_id,
        reason_code: row.reason_code,
        failure_code: row.failure_code,
        trigger_metadata: row.trigger_metadata ?? null,
        ready_for_integration_at: row.ready_for_integration_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        started_at: row.started_at,
        finished_at: row.finished_at,
        operation_id: null,
        operation_exists: false,
        duplicate_event: {
          reason: row.reason_code === "duplicate_event",
          failure: row.failure_code === "duplicate_event",
        },
        debug: row.trigger_type === "debug",
        snapshot_id: row.snapshot_id ?? null,
        workflow_revision_id: row.workflow_revision_id ?? null,
      }),
    )
  })
}

function project_run(run_id: string) {
  const run = RuntimeRun.get({ id: run_id })
  const workspace = Database.use((db) =>
    db
      .select({
        project_id: WorkspaceTable.project_id,
      })
      .from(WorkspaceTable)
      .where(eq(WorkspaceTable.id, run.workspace_id))
      .get(),
  )

  if (!workspace || workspace.project_id !== Instance.project.id) {
    throw new NotFoundError({ message: `Run not found: ${run_id}` })
  }

  return WorkflowManualRun.Info.parse({
    id: run.id,
    status: run.status,
    trigger_type: run.trigger_type,
    workflow_id: run.workflow_id,
    workspace_id: run.workspace_id,
    session_id: run.session_id,
    run_workspace_root: run.run_workspace_root,
    run_workspace_directory: run.run_workspace_directory,
    ready_for_integration_at: run.ready_for_integration_at,
    reason_code: run.reason_code,
    failure_code: run.failure_code,
    trigger_metadata: run.trigger_metadata_json ?? null,
    cleanup_failed: run.cleanup_failed,
    created_at: run.created_at,
    updated_at: run.updated_at,
    started_at: run.started_at,
    finished_at: run.finished_at,
    integration_candidate:
      !run.integration_candidate_base_change_id &&
      !run.integration_candidate_change_ids &&
      !run.integration_candidate_changed_paths
        ? null
        : {
            base_change_id: run.integration_candidate_base_change_id,
            change_ids: run.integration_candidate_change_ids ?? [],
            changed_paths: run.integration_candidate_changed_paths ?? [],
          },
  })
}

export namespace WorkflowDetail {
  export const Resource = resource_detail
  export const WorkflowRun = workflow_run
  export const LinkedSession = linked_session
  export const AttemptDetail = attempt_detail
  export const NodeDetail = node_detail
  export const Workflow = workflow_detail
  export const WorkflowView = workflow_detail_view
  export const Run = run_detail
  export const RunView = run_detail_view

  export async function workflow(input: { directory: string; item: z.infer<typeof workflow_item> }) {
    const revision_head =
      input.item.workflow
        ? RuntimeWorkflowRevision.observe({
            project_id: Instance.project.id,
            workflow_id: input.item.id,
            file: input.item.file,
            canonical_text: await Bun.file(path.join(input.directory, input.item.file)).text(),
          })
        : null

    const refs = input.item.workflow ? used_by(input.item.workflow.steps) : new Map<string, string[]>()
    const resources = input.item.workflow
      ? input.item.workflow.resources.map((resource, index) =>
          resource.source === "local"
            ? resource_detail.parse({
                id: resource.id,
                source: resource.source,
                kind: resource.kind,
                path: resource.path,
                used_by: refs.get(resource.id) ?? [],
                errors: resource_errors(input.item, index),
              })
            : resource_detail.parse({
                id: resource.id,
                source: resource.source,
                kind: resource.kind,
                item_id: resource.item_id,
                used_by: refs.get(resource.id) ?? [],
                errors: resource_errors(input.item, index),
              }),
        )
      : []

    return workflow_detail.parse({
      item: input.item,
      revision_head,
      resources,
      runs: workflow_runs(input.item.id),
    })
  }

  export async function run(input: { run_id: string }) {
    const run = project_run(input.run_id)
    const snapshot = RuntimeRunSnapshot.byRun({ run_id: input.run_id })
    const revision = RuntimeWorkflowRevision.get({ id: snapshot.workflow_revision_id })
    const current = RuntimeWorkflowRevision.head({
      project_id: Instance.project.id,
      workflow_id: snapshot.workflow_id,
    })
    const node_rows = RuntimeRunNode.byRun({ run_id: input.run_id })
    const node_ids = node_rows.map((node) => node.id)
    const attempts = RuntimeRunAttempt.byRun({ run_node_ids: node_ids })
    const events = RuntimeRunEvent.list({ run_id: input.run_id })
    const links = RuntimeSessionLink.byRun({ run_id: input.run_id })
    const steps = indexed(snapshot.graph_json.steps)
    const by_node = new Map<string, z.infer<typeof RuntimeRunAttempt.View>[]>()

    attempts.forEach((attempt) => {
      const list = by_node.get(attempt.run_node_id) ?? []
      list.push(attempt)
      by_node.set(attempt.run_node_id, list)
    })

    const link_by_attempt = new Map(
      links.filter((link) => link.run_attempt_id).map((link) => [link.run_attempt_id!, link] as const),
    )
    const followup = await linked(links.find((link) => link.role === "run_followup") ?? null)

    return run_detail.parse({
      run,
      snapshot,
      revision,
      live: {
        current_revision_id: current?.id ?? null,
        has_newer_revision: current ? current.id !== revision.id : false,
      },
      nodes: (
        await Promise.all(
          node_rows.map(async (node) => {
            const step = steps.get(node.node_id)
            if (!step) return
            return node_detail.parse({
              node,
              step,
              attempts: await Promise.all(
                (by_node.get(node.id) ?? []).map(async (attempt) =>
                  attempt_detail.parse({
                    attempt,
                    session: await linked(link_by_attempt.get(attempt.id) ?? null),
                  }),
                ),
              ),
            })
          }),
        )
      ).filter((item): item is z.infer<typeof node_detail> => !!item),
      events,
      followup,
    })
  }
}
