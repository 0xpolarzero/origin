import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { RuntimeRun } from "../../src/runtime/run"
import { RuntimeRunAttempt } from "../../src/runtime/run-attempt"
import { RuntimeRunEvent } from "../../src/runtime/run-event"
import { RuntimeRunNode } from "../../src/runtime/run-node"
import { RuntimeRunSnapshot } from "../../src/runtime/run-snapshot"
import { RuntimeSessionLink } from "../../src/runtime/session-link"
import { RuntimeWorkflowRevision } from "../../src/runtime/workflow-revision"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { resetDatabase } from "../fixture/db"

const project_id = "proj_graph"
const workspace_id = "wrk_graph"
const root_session_id = "ses_000000000001rootSession01"
const exec_session_id = "ses_000000000001execSession02"
const follow_session_id = "ses_000000000001followSess03"
const other_session_id = "ses_000000000001otherSess004"

function graph() {
  return {
    schema_version: 2 as const,
    id: "review_release",
    name: "Review release",
    trigger: {
      type: "manual" as const,
    },
    inputs: [
      {
        key: "release_tag",
        type: "text" as const,
        label: "Release tag",
        required: true,
      },
    ],
    resources: [
      {
        id: "review_prompt",
        source: "library" as const,
        kind: "prompt_template" as const,
        item_id: "review_template",
      },
    ],
    steps: [
      {
        id: "inspect",
        kind: "agent_request" as const,
        title: "Inspect",
        prompt: {
          source: "resource" as const,
          resource_id: "review_prompt",
        },
        output: {
          type: "object" as const,
          required: ["requires_fix"],
          properties: {
            requires_fix: {
              type: "boolean" as const,
            },
          },
        },
      },
      {
        id: "done",
        kind: "end" as const,
        title: "Done",
        result: "success" as const,
      },
    ],
  }
}

function seed() {
  const now = Date.now()
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: project_id,
        worktree: "/tmp/graph-runtime",
        vcs: "git",
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .run()

    db.insert(WorkspaceTable)
      .values({
        id: workspace_id,
        project_id,
        branch: "main",
        config: {
          type: "worktree",
          directory: "/tmp/graph-runtime",
        },
      })
      .run()

    db.insert(SessionTable)
      .values(
        [root_session_id, exec_session_id, follow_session_id, other_session_id].map((id, index) => ({
          id,
          project_id,
          workspace_id,
          parent_id: null,
          slug: `graph-${index}`,
          directory: "/tmp/graph-runtime",
          title: `graph-${index}`,
          version: "1",
          share_url: null,
          summary_additions: null,
          summary_deletions: null,
          summary_files: null,
          summary_diffs: null,
          revert: null,
          permission: null,
          time_created: now + index,
          time_updated: now + index,
          time_compacting: null,
          time_archived: null,
        })),
      )
      .run()
  })
}

function revision_text(version: string) {
  return [
    "schema_version: 2",
    "id: review_release",
    "name: Review release",
    "trigger:",
    "  type: manual",
    "steps:",
    "  - id: done",
    "    kind: end",
    "    title: Done",
    `    result: ${version}`,
  ].join("\n")
}

beforeEach(async () => {
  await resetDatabase()
  seed()
})

afterEach(async () => {
  await resetDatabase()
})

describe("phase 15 graph runtime foundation", () => {
  test("workflow revisions create new immutable heads only when the live content changes", () => {
    const first = RuntimeWorkflowRevision.observe({
      project_id,
      workflow_id: "review_release",
      file: ".origin/workflows/review.yaml",
      canonical_text: revision_text("success"),
    })

    const same = RuntimeWorkflowRevision.observe({
      project_id,
      workflow_id: "review_release",
      file: ".origin/workflows/review.yaml",
      canonical_text: revision_text("success"),
    })

    const second = RuntimeWorkflowRevision.observe({
      project_id,
      workflow_id: "review_release",
      file: ".origin/workflows/review.yaml",
      canonical_text: revision_text("failure"),
    })

    const third = RuntimeWorkflowRevision.observe({
      project_id,
      workflow_id: "review_release",
      file: ".origin/workflows/review.yaml",
      canonical_text: revision_text("success"),
    })

    expect(same.id).toBe(first.id)
    expect(second.id).not.toBe(first.id)
    expect(third.id).not.toBe(first.id)
    expect(third.id).not.toBe(second.id)
    expect(third.content_hash).toBe(first.content_hash)
    expect(RuntimeWorkflowRevision.head({ project_id, workflow_id: "review_release" })?.id).toBe(third.id)
  })

  test("run snapshots freeze workflow revision, graph payload, and inputs per run", () => {
    const revision = RuntimeWorkflowRevision.observe({
      project_id,
      workflow_id: "review_release",
      file: ".origin/workflows/review.yaml",
      canonical_text: revision_text("success"),
    })
    const run = RuntimeRun.create({
      workspace_id,
      session_id: root_session_id,
      trigger_type: "manual",
      workflow_id: "review_release",
    })

    const snapshot = RuntimeRunSnapshot.create({
      run_id: run.id,
      workflow_id: "review_release",
      workflow_revision_id: revision.id,
      workflow_hash: revision.content_hash,
      workflow_text: revision.canonical_text,
      graph_json: graph(),
      input_json: {
        release_tag: "v1.2.3",
      },
      input_store_json: {
        release_tag: {
          type: "text",
        },
      },
      trigger_metadata_json: {
        type: "manual",
      },
      resource_materials_json: {
        review_prompt: {
          source: "library",
          path: ".origin/library/review-template.yaml",
        },
      },
      material_root: "/tmp/graph-runtime/.origin/runs/materials/run-1",
    })

    expect(RuntimeRunSnapshot.byRun({ run_id: run.id })).toEqual(snapshot)
    expect(RuntimeRunSnapshot.get({ id: snapshot.id }).graph_json.id).toBe("review_release")
    expect(() =>
      RuntimeRunSnapshot.create({
        run_id: run.id,
        workflow_id: "review_release",
        workflow_revision_id: revision.id,
        workflow_hash: revision.content_hash,
        workflow_text: revision.canonical_text,
        graph_json: graph(),
        input_json: {},
        input_store_json: {},
        trigger_metadata_json: {},
        resource_materials_json: {},
        material_root: "/tmp/graph-runtime/.origin/runs/materials/run-1b",
      }),
    ).toThrow()
  })

  test("run nodes, attempts, and events persist deterministic retry and skip state", () => {
    const revision = RuntimeWorkflowRevision.observe({
      project_id,
      workflow_id: "review_release",
      file: ".origin/workflows/review.yaml",
      canonical_text: revision_text("success"),
    })
    const run = RuntimeRun.create({
      workspace_id,
      session_id: root_session_id,
      trigger_type: "manual",
      workflow_id: "review_release",
    })
    const snapshot = RuntimeRunSnapshot.create({
      run_id: run.id,
      workflow_id: "review_release",
      workflow_revision_id: revision.id,
      workflow_hash: revision.content_hash,
      workflow_text: revision.canonical_text,
      graph_json: graph(),
      input_json: {
        release_tag: "v1.2.3",
      },
      input_store_json: {},
      trigger_metadata_json: {
        type: "manual",
      },
      resource_materials_json: {},
      material_root: "/tmp/graph-runtime/.origin/runs/materials/run-2",
    })

    const inspect = RuntimeRunNode.create({
      run_id: run.id,
      snapshot_id: snapshot.id,
      node_id: "inspect",
      kind: "agent_request",
      title: "Inspect",
      position: 0,
    })
    RuntimeRunNode.transition({ id: inspect.id, to: "ready" })
    RuntimeRunNode.transition({ id: inspect.id, to: "running" })

    const first = RuntimeRunAttempt.create({
      run_node_id: inspect.id,
      session_id: exec_session_id,
      input_json: {
        release_tag: "v1.2.3",
      },
    })
    RuntimeRunAttempt.transition({
      id: first.id,
      to: "running",
      session_id: exec_session_id,
    })
    RuntimeRunAttempt.transition({
      id: first.id,
      to: "failed",
      error_json: {
        code: "transient_runtime_error",
      },
    })

    RuntimeRunNode.transition({
      id: inspect.id,
      to: "ready",
      error_json: {
        code: "transient_runtime_error",
      },
    })
    RuntimeRunNode.transition({ id: inspect.id, to: "running" })

    const second = RuntimeRunAttempt.create({
      run_node_id: inspect.id,
      session_id: exec_session_id,
      input_json: {
        release_tag: "v1.2.3",
      },
    })
    RuntimeRunAttempt.transition({
      id: second.id,
      to: "running",
      session_id: exec_session_id,
    })
    RuntimeRunAttempt.transition({
      id: second.id,
      to: "succeeded",
      output_json: {
        requires_fix: false,
      },
    })

    const complete = RuntimeRunNode.transition({
      id: inspect.id,
      to: "succeeded",
      output_json: {
        requires_fix: false,
      },
    })

    const branch = RuntimeRunNode.create({
      run_id: run.id,
      snapshot_id: snapshot.id,
      node_id: "repair",
      kind: "script",
      title: "Repair",
      position: 1,
    })
    const upstream = RuntimeRunNode.create({
      run_id: run.id,
      snapshot_id: snapshot.id,
      node_id: "notify",
      kind: "script",
      title: "Notify",
      position: 2,
    })

    RuntimeRunNode.transition({
      id: branch.id,
      to: "skipped",
      skip_reason_code: "branch_not_taken",
    })
    RuntimeRunNode.transition({
      id: upstream.id,
      to: "skipped",
      skip_reason_code: "upstream_failed",
    })

    const event_a = RuntimeRunEvent.append({
      run_id: run.id,
      run_node_id: inspect.id,
      event_type: "node.ready",
      payload_json: {
        node_id: "inspect",
      },
    })
    const event_b = RuntimeRunEvent.append({
      run_id: run.id,
      run_node_id: inspect.id,
      run_attempt_id: first.id,
      event_type: "attempt.failed",
      payload_json: {
        attempt_index: 0,
      },
    })
    const event_c = RuntimeRunEvent.append({
      run_id: run.id,
      run_node_id: inspect.id,
      run_attempt_id: second.id,
      event_type: "attempt.succeeded",
      payload_json: {
        attempt_index: 1,
      },
    })

    expect(RuntimeRunNode.byRun({ run_id: run.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
      ["inspect", "succeeded", null],
      ["repair", "skipped", "branch_not_taken"],
      ["notify", "skipped", "upstream_failed"],
    ])
    expect(RuntimeRunAttempt.byNode({ run_node_id: inspect.id }).map((item) => [item.attempt_index, item.status])).toEqual([
      [0, "failed"],
      [1, "succeeded"],
    ])
    expect(RuntimeRunAttempt.byRun({ run_node_ids: [inspect.id] }).map((item) => item.id)).toEqual([first.id, second.id])
    expect(RuntimeRunEvent.list({ run_id: run.id }).map((item) => [item.sequence, item.id])).toEqual([
      [0, event_a.id],
      [1, event_b.id],
      [2, event_c.id],
    ])
    expect(complete.attempt_count).toBe(2)
  })

  test("session links default to hidden workflow semantics and support run, node, and attempt lookups", () => {
    const revision = RuntimeWorkflowRevision.observe({
      project_id,
      workflow_id: "review_release",
      file: ".origin/workflows/review.yaml",
      canonical_text: revision_text("success"),
    })
    const run = RuntimeRun.create({
      workspace_id,
      session_id: root_session_id,
      trigger_type: "manual",
      workflow_id: "review_release",
    })
    const snapshot = RuntimeRunSnapshot.create({
      run_id: run.id,
      workflow_id: "review_release",
      workflow_revision_id: revision.id,
      workflow_hash: revision.content_hash,
      workflow_text: revision.canonical_text,
      graph_json: graph(),
      input_json: {},
      input_store_json: {},
      trigger_metadata_json: {},
      resource_materials_json: {},
      material_root: "/tmp/graph-runtime/.origin/runs/materials/run-3",
    })
    const node = RuntimeRunNode.create({
      run_id: run.id,
      snapshot_id: snapshot.id,
      node_id: "inspect",
      kind: "agent_request",
      title: "Inspect",
      position: 0,
    })
    const attempt = RuntimeRunAttempt.create({
      run_node_id: node.id,
      session_id: exec_session_id,
    })

    expect(() =>
      RuntimeSessionLink.CreateInput.parse({
        session_id: exec_session_id,
        role: "execution_node",
        run_node_id: node.id,
      }),
    ).toThrow()

    const execution = RuntimeSessionLink.upsert({
      session_id: exec_session_id,
      role: "execution_node",
      run_id: run.id,
      run_node_id: node.id,
      run_attempt_id: attempt.id,
    })
    const followup = RuntimeSessionLink.upsert({
      session_id: follow_session_id,
      role: "run_followup",
      run_id: run.id,
    })

    expect(execution.visibility).toBe("hidden")
    expect(execution.readonly).toBe(true)
    expect(followup.visibility).toBe("hidden")
    expect(followup.readonly).toBe(false)
    expect(RuntimeSessionLink.byRun({ run_id: run.id }).map((item) => item.session_id).sort()).toEqual(
      [exec_session_id, follow_session_id].sort(),
    )
    expect(RuntimeSessionLink.byNode({ run_node_id: node.id }).map((item) => item.session_id)).toEqual([exec_session_id])
    expect(RuntimeSessionLink.byAttempt({ run_attempt_id: attempt.id }).map((item) => item.session_id)).toEqual([exec_session_id])
    expect(RuntimeSessionLink.hidden({ session_ids: [exec_session_id, follow_session_id, other_session_id] })).toEqual(
      new Set([exec_session_id, follow_session_id]),
    )
  })
})
