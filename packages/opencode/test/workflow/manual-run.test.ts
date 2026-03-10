import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, stat, symlink } from "node:fs/promises"
import path from "node:path"
import { WorkspaceContext } from "../../src/control-plane/workspace-context"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { JJ } from "../../src/project/jj"
import { Instance } from "../../src/project/instance"
import { RuntimeRunAttempt } from "../../src/runtime/run-attempt"
import { RuntimeRunNode } from "../../src/runtime/run-node"
import { RuntimeRunSnapshot } from "../../src/runtime/run-snapshot"
import { RuntimeSessionLink } from "../../src/runtime/session-link"
import { RuntimeWorkflowRevision } from "../../src/runtime/workflow-revision"
import {
  RuntimeManualRunDuplicateError,
  RuntimeTriggerFailureError,
  RuntimeWorkflowValidationError,
} from "../../src/runtime/error"
import { AuditEventTable, OperationTable, RunTable } from "../../src/runtime/runtime.sql"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { WorkflowGraphRun } from "../../src/workflow/graph-run"
import { WorkflowIntegrationQueue } from "../../src/workflow/integration-queue"
import { WorkflowAutoRun, WorkflowManualRun } from "../../src/workflow/manual-run"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

type ExecuteItem = Parameters<
  NonNullable<NonNullable<Parameters<(typeof WorkflowManualRun.Testing)["set"]>[0]>["execute"]>
>[0]

function result(input?: { exitCode?: number; stdout?: string; stderr?: string }) {
  const stdout = Buffer.from(input?.stdout ?? "")
  const stderr = Buffer.from(input?.stderr ?? "")
  return {
    exitCode: input?.exitCode ?? 0,
    stdout,
    stderr,
    text: () => stdout.toString(),
  }
}

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

async function exists(target: string) {
  return stat(target)
    .then(() => true)
    .catch(() => false)
}

function transitions(run_id: string) {
  return Database.use((db) =>
    db
      .select()
      .from(AuditEventTable)
      .where(eq(AuditEventTable.run_id, run_id))
      .all()
      .filter((item) => item.event_type === "run.transitioned")
      .map((item) => item.event_payload as { from: string; to: string }),
  )
}

function audit(run_id: string, event_type: string) {
  return Database.use((db) =>
    db
      .select()
      .from(AuditEventTable)
      .where(eq(AuditEventTable.run_id, run_id))
      .all()
      .filter((item) => item.event_type === event_type)
      .map((item) => item.event_payload as Record<string, unknown>),
  )
}

async function wait_status(run_id: string, status: string) {
  const start = Date.now()
  while (true) {
    const row = WorkflowManualRun.get({ run_id })
    if (row.status === status) return row
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for status ${status}`)
    await Bun.sleep(20)
  }
}

function seed(workspace_id: string, directory: string) {
  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: workspace_id,
        project_id: Instance.project.id,
        branch: "main",
        config: {
          type: "worktree",
          directory,
        },
      })
      .onConflictDoNothing()
      .run()
  })
}

function seams(input?: {
  create_fail?: boolean
  forget_fail?: boolean
  execute?: (item: ExecuteItem) => Promise<void>
  agent?: Parameters<NonNullable<typeof WorkflowManualRun.Testing.set>>[0] extends infer T
    ? T extends { agent?: infer A }
      ? A
      : never
    : never
  script?: Parameters<NonNullable<typeof WorkflowManualRun.Testing.set>>[0] extends infer T
    ? T extends { script?: infer S }
      ? S
      : never
    : never
}) {
  return {
    adapter: ({ directory }: { directory: string }) =>
      JJ.create({
        cwd: directory,
        run_root: path.join(directory, ".origin", "runs"),
        runner: async (args) => {
          if (args[0] === "workspace" && args[1] === "add") {
            if (input?.create_fail) return result({ exitCode: 1, stderr: "fatal: failed to add workspace" })
            await mkdir(args[2], { recursive: true })
            return result()
          }
          if (args[0] === "workspace" && args[1] === "forget" && input?.forget_fail) {
            return result({ exitCode: 1, stderr: "fatal: failed to forget workspace metadata" })
          }
          return result()
        },
      }),
    execute: async (item: ExecuteItem) => {
      if (input?.execute) {
        await input.execute(item)
      }
    },
    agent: input?.agent,
    script: input?.script,
  }
}

function simple_graph(file = "basic.yaml") {
  return {
    file: `.origin/workflows/${file}`,
    text: [
      "schema_version: 2",
      "id: basic",
      "name: Basic",
      "trigger:",
      "  type: manual",
      "steps:",
      "  - id: done",
      "    kind: end",
      "    title: Done",
      "    result: success",
    ].join("\n"),
  }
}

beforeEach(async () => {
  await resetDatabase()
  WorkflowIntegrationQueue.Testing.reset()
  WorkflowManualRun.Testing.reset()
})

afterEach(async () => {
  WorkflowIntegrationQueue.Testing.reset()
  await resetDatabase()
  WorkflowManualRun.Testing.reset()
})

describe("workflow manual run orchestration", () => {
  test("graph runs create followup sessions, snapshots, and persisted nodes", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = simple_graph()
    await write(dir.path, graph.file, graph.text)

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(done.cleanup_failed).toBe(false)
            expect(done.integration_candidate).toBeNull()
            expect(transitions(done.id)).toEqual([
              { from: "create", to: "queued" },
              { from: "queued", to: "running" },
              { from: "running", to: "validating" },
              { from: "validating", to: "completed_no_change" },
            ])
            expect(audit(done.id, "workflow.run.outcome")).toEqual([
              {
                workspace_id: "wrk_manual",
                workflow_id: "basic",
                run_id: done.id,
                outcome: "completed",
                status: "completed_no_change",
                reason_code: null,
                failure_code: null,
              },
            ])

            const snapshot = RuntimeRunSnapshot.byRun({ run_id: done.id })
            expect(snapshot.graph_json.id).toBe("basic")
            expect(snapshot.workflow_text).toContain("schema_version: 2")
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status])).toEqual([["done", "succeeded"]])
            const followup = RuntimeSessionLink.get({ session_id: done.session_id! })
            expect(followup.role).toBe("run_followup")
            expect(followup.visibility).toBe("hidden")
            expect(followup.readonly).toBe(false)

            const run_workspace_directory = done.run_workspace_directory
            if (!run_workspace_directory) throw new Error("missing run workspace directory")
            expect(await exists(run_workspace_directory)).toBe(false)
          },
        })
      },
    })
  })

  test("duplicate manual triggers reject while a graph run is active", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 2",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async () => {
                  await hold
                },
              }),
            )

            const first = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "same" })

            await expect(WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "same" })).rejects.toBeInstanceOf(
              RuntimeManualRunDuplicateError,
            )

            release()
            const done = await WorkflowManualRun.wait({ run_id: first.id, timeout_ms: 5000 })
            expect(done.status).toBe("completed_no_change")
          },
        })
      },
    })
  })

  test("wait timeout returns running while an agent_request node is active", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 2",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async () => {
                  await hold
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "wait-timeout" })
            await wait_status(run.id, "running")

            const snapshot = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 80 })

            expect(snapshot.status).toBe("running")

            WorkflowManualRun.cancel({ run_id: run.id })
            release()
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            expect(done.status).toBe("canceled")
          },
        })
      },
    })
  })

  test("agent_request attempts create hidden execution sessions instead of using the run session as the container", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 2",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            const inspect = RuntimeRunNode.byNode({ run_id: done.id, node_id: "inspect" })
            const attempts = RuntimeRunAttempt.byNode({ run_node_id: inspect.id })
            expect(attempts).toHaveLength(1)
            expect(attempts[0]?.session_id).toBeTruthy()
            expect(done.session_id).toBeTruthy()
            expect(attempts[0]?.session_id).not.toBe(done.session_id)

            const execution = RuntimeSessionLink.byAttempt({ run_attempt_id: attempts[0]!.id })
            expect(execution).toHaveLength(1)
            expect(execution[0]?.role).toBe("execution_node")
            expect(execution[0]?.visibility).toBe("hidden")
            expect(execution[0]?.readonly).toBe(true)
          },
        })
      },
    })
  })

  test("forking an execution transcript reuses the linked run followup session", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 2",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            const inspect = RuntimeRunNode.byNode({ run_id: done.id, node_id: "inspect" })
            const execution = RuntimeRunAttempt.byNode({ run_node_id: inspect.id })[0]?.session_id
            const followup_id = done.session_id

            expect(execution).toBeTruthy()
            expect(followup_id).toBeTruthy()
            if (!followup_id) throw new Error("Expected follow-up session")

            const followup = await Session.fork({
              sessionID: execution!,
            })
            const followupAgain = await Session.fork({
              sessionID: execution!,
            })
            const messages = await Session.messages({
              sessionID: followup.id,
            })
            const text = messages[0]?.parts[0]?.type === "text" ? messages[0].parts[0].text : ""

            expect(followup.id).toBe(followup_id)
            expect(followupAgain.id).toBe(followup_id)
            expect(RuntimeSessionLink.get({ session_id: followup.id }).role).toBe("run_followup")
            expect(Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, execution!)).all())).toHaveLength(1)
            expect(messages).toHaveLength(1)
            expect(messages[0]?.parts[0]).toMatchObject({
              type: "text",
              synthetic: true,
              metadata: {
                workflow_continue: true,
                execution_session_id: execution,
                run_id: done.id,
                workflow_id: "basic",
              },
            })
            expect(text).toContain("Node: inspect (Inspect).")
          },
        })
      },
    })
  })

  test("manual inputs interpolate prompts, bind script environments, and freeze path snapshots", async () => {
    await using dir = await tmpdir({ git: true })
    const source = path.join(dir.path, "..", "graph-input-source.txt")
    await Bun.write(source, "before-run")
    await write(
      dir.path,
      ".origin/workflows/input_flow/prompts/review.txt",
      "Resource {{inputs.release_tag}} / {{inputs.notes}} / {{inputs.asset}}",
    )
    await write(
      dir.path,
      ".origin/workflows/input-flow.yaml",
      [
        "schema_version: 2",
        "id: input_flow",
        "name: Input flow",
        "trigger:",
        "  type: manual",
        "inputs:",
        "  - key: release_tag",
        "    type: text",
        "    label: Release tag",
        "    required: true",
        "  - key: notes",
        "    type: long_text",
        "    label: Notes",
        "    required: true",
        "  - key: count",
        "    type: number",
        "    label: Count",
        "    required: true",
        "  - key: flag",
        "    type: boolean",
        "    label: Flag",
        "    required: true",
        "  - key: choice",
        "    type: select",
        "    label: Choice",
        "    required: true",
        "    options:",
        "      - label: Alpha",
        "        value: alpha",
        "  - key: asset",
        "    type: path",
        "    label: Asset",
        "    required: true",
        "    mode: either",
        "resources:",
        "  - id: review_prompt",
        "    source: local",
        "    kind: prompt_template",
        "    path: prompts/review.txt",
        "steps:",
        "  - id: inspect_inline",
        "    kind: agent_request",
        "    title: Inline inspect",
        "    prompt:",
        "      source: inline",
        "      text: Inline {{inputs.release_tag}} / {{inputs.notes}} / {{inputs.asset}}",
        "  - id: inspect_resource",
        "    kind: agent_request",
        "    title: Resource inspect",
        "    prompt:",
        "      source: resource",
        "      resource_id: review_prompt",
        "  - id: envcheck",
        "    kind: script",
        "    title: Env check",
        "    script:",
        "      source: inline",
        "      text: printf '%s' '{{inputs.release_tag}}'",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    const prompts: string[] = []
    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    let script_input:
      | {
          command: string
          env: Record<string, string>
        }
      | undefined

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                agent: async (input) => {
                  prompts.push(input.prompt)
                  if (prompts.length === 1) await hold
                  return { structured: null }
                },
                script: async (input) => {
                  script_input = {
                    command: input.command,
                    env: input.env,
                  }
                  return {
                    exit_code: 0,
                    stdout: "",
                    stderr: "",
                  }
                },
              }),
            )

            const run = await WorkflowManualRun.start({
              workflow_id: "input_flow",
              inputs: {
                release_tag: "v1.2.3",
                notes: "hello world",
                count: 42,
                flag: true,
                choice: "alpha",
                asset: source,
              },
            })

            await wait_status(run.id, "running")
            await Bun.write(source, "after-start")
            release()
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(prompts).toHaveLength(2)

            const snapshot = RuntimeRunSnapshot.byRun({ run_id: done.id })
            const input_json = snapshot.input_json as Record<string, string>
            const input_store = snapshot.input_store_json as Record<string, Record<string, string>>

            expect(prompts[0]).toContain("Inline v1.2.3 / hello world /")
            expect(prompts[1]).toContain("Resource v1.2.3 / hello world /")
            expect(prompts[0]).toContain(input_json.asset)
            expect(prompts[1]).toContain(input_json.asset)

            expect(script_input?.command).toContain("{{inputs.release_tag}}")
            expect(script_input?.env.ORIGIN_INPUT_RELEASE_TAG).toBe("v1.2.3")
            expect(script_input?.env.ORIGIN_INPUT_NOTES).toBe("hello world")
            expect(script_input?.env.ORIGIN_INPUT_COUNT).toBe("42")
            expect(script_input?.env.ORIGIN_INPUT_FLAG).toBe("true")
            expect(script_input?.env.ORIGIN_INPUT_CHOICE).toBe("alpha")
            expect(script_input?.env.ORIGIN_INPUT_ASSET).toBe(input_json.asset)
            expect(await Bun.file(input_json.asset).text()).toBe("before-run")
            expect(input_store.asset?.original_path).toBe(source)
          },
        })
      },
    })
  })

  test("missing captured prompt inputs reject start before any run row is created", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/missing.yaml",
      [
        "schema_version: 2",
        "id: missing_input",
        "name: Missing input",
        "trigger:",
        "  type: manual",
        "inputs:",
        "  - key: optional_text",
        "    type: text",
        "    label: Optional text",
        "    required: false",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Missing {{inputs.optional_text}}",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            await expect(WorkflowManualRun.start({ workflow_id: "missing_input" })).rejects.toBeInstanceOf(
              RuntimeWorkflowValidationError,
            )
            expect(Database.use((db) => db.select().from(RunTable).all())).toHaveLength(0)
          },
        })
      },
    })
  })

  test("symlinked file path inputs reject escaped targets before creating a run row", async () => {
    await using dir = await tmpdir({ git: true })
    const source = path.join(dir.path, "real.txt")
    const link = path.join(dir.path, "link.txt")
    await Bun.write(source, "real")
    await symlink(source, link)
    await write(
      dir.path,
      ".origin/workflows/link.yaml",
      [
        "schema_version: 2",
        "id: link_flow",
        "name: Link flow",
        "trigger:",
        "  type: manual",
        "inputs:",
        "  - key: asset",
        "    type: path",
        "    label: Asset",
        "    required: true",
        "    mode: file",
        "steps:",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            try {
              await WorkflowManualRun.start({
                workflow_id: "link_flow",
                inputs: {
                  asset: link,
                },
              })
              throw new Error("expected path input validation to fail")
            } catch (error) {
              expect(error).toBeInstanceOf(RuntimeWorkflowValidationError)
            }
            expect(Database.use((db) => db.select().from(RunTable).all())).toHaveLength(0)
          },
        })
      },
    })
  })

  test("condition branches skip non-selected nodes with branch_not_taken", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/branch.yaml",
      [
        "schema_version: 2",
        "id: branch_flow",
        "name: Branch flow",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "    output:",
        "      type: object",
        "      required:",
        "        - requires_fix",
        "      properties:",
        "        requires_fix:",
        "          type: boolean",
        "  - id: gate",
        "    kind: condition",
        "    title: Gate",
        "    when:",
        "      ref: steps.inspect.output.requires_fix",
        "      op: equals",
        "      value: true",
        "    then:",
        "      - id: repair",
        "        kind: script",
        "        title: Repair",
        "        script:",
        "          source: inline",
        "          text: exit 0",
        "    else:",
        "      - id: done",
        "        kind: end",
        "        title: Done",
        "        result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                agent: async () => ({
                  structured: { requires_fix: false },
                }),
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "branch_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
              ["inspect", "succeeded", null],
              ["gate", "succeeded", null],
              ["repair", "skipped", "branch_not_taken"],
              ["done", "succeeded", null],
            ])
          },
        })
      },
    })
  })

  test("node failures skip downstream nodes with upstream_failed and fail the top-level run", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/failing.yaml",
      [
        "schema_version: 2",
        "id: failing_flow",
        "name: Failing flow",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: repair",
        "    kind: script",
        "    title: Repair",
        "    script:",
        "      source: inline",
        "      text: exit 1",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                script: async () => ({
                  exit_code: 1,
                  stdout: "",
                  stderr: "boom",
                }),
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "failing_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("node_execution_failed")
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
              ["repair", "failed", null],
              ["inspect", "skipped", "upstream_failed"],
              ["done", "skipped", "upstream_failed"],
            ])
          },
        })
      },
    })
  })

  test("authored failure ends skip downstream nodes with upstream_failed", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/failure-end.yaml",
      [
        "schema_version: 2",
        "id: failure_end_flow",
        "name: Failure end flow",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: stop",
        "    kind: end",
        "    title: Stop",
        "    result: failure",
        "  - id: after",
        "    kind: script",
        "    title: After",
        "    script:",
        "      source: inline",
        "      text: exit 0",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const run = await WorkflowManualRun.start({ workflow_id: "failure_end_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("workflow_failed")
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
              ["stop", "succeeded", null],
              ["after", "skipped", "upstream_failed"],
            ])
          },
        })
      },
    })
  })

  test("authored success ends skip downstream nodes with upstream_failed", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/success-end.yaml",
      [
        "schema_version: 2",
        "id: success_end_flow",
        "name: Success end flow",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: stop",
        "    kind: end",
        "    title: Stop",
        "    result: success",
        "  - id: after",
        "    kind: script",
        "    title: After",
        "    script:",
        "      source: inline",
        "      text: exit 0",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const run = await WorkflowManualRun.start({ workflow_id: "success_end_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(done.failure_code).toBeNull()
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
              ["stop", "succeeded", null],
              ["after", "skipped", "upstream_failed"],
            ])
          },
        })
      },
    })
  })

  test("authored noop ends skip downstream nodes with upstream_failed", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/noop-end.yaml",
      [
        "schema_version: 2",
        "id: noop_end_flow",
        "name: Noop end flow",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: stop",
        "    kind: end",
        "    title: Stop",
        "    result: noop",
        "  - id: after",
        "    kind: script",
        "    title: After",
        "    script:",
        "      source: inline",
        "      text: exit 0",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const run = await WorkflowManualRun.start({ workflow_id: "noop_end_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(done.failure_code).toBeNull()
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
              ["stop", "succeeded", null],
              ["after", "skipped", "upstream_failed"],
            ])
          },
        })
      },
    })
  })

  test("workflow revisions and frozen resource materials remain immutable across runs", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/library/review-template.yaml",
      [
        "schema_version: 1",
        "id: review_template",
        "kind: prompt_template",
        "template: first version",
      ].join("\n"),
    )
    await write(
      dir.path,
      ".origin/workflows/revision.yaml",
      [
        "schema_version: 2",
        "id: revision_flow",
        "name: Revision flow",
        "trigger:",
        "  type: manual",
        "resources:",
        "  - id: review_prompt",
        "    source: library",
        "    kind: prompt_template",
        "    item_id: review_template",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: resource",
        "      resource_id: review_prompt",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const first = await WorkflowManualRun.start({ workflow_id: "revision_flow" })
            const first_done = await WorkflowManualRun.wait({ run_id: first.id, timeout_ms: 5000 })
            const first_snapshot = RuntimeRunSnapshot.byRun({ run_id: first_done.id })

            await write(
              dir.path,
              ".origin/library/review-template.yaml",
              [
                "schema_version: 1",
                "id: review_template",
                "kind: prompt_template",
                "template: second version",
              ].join("\n"),
            )
            await write(
              dir.path,
              ".origin/workflows/revision.yaml",
              [
                "schema_version: 2",
                "id: revision_flow",
                "name: Revision flow updated",
                "trigger:",
                "  type: manual",
                "resources:",
                "  - id: review_prompt",
                "    source: library",
                "    kind: prompt_template",
                "    item_id: review_template",
                "steps:",
                "  - id: inspect",
                "    kind: agent_request",
                "    title: Inspect updated",
                "    prompt:",
                "      source: resource",
                "      resource_id: review_prompt",
                "  - id: done",
                "    kind: end",
                "    title: Done",
                "    result: success",
              ].join("\n"),
            )

            const second = await WorkflowManualRun.start({ workflow_id: "revision_flow" })
            const second_done = await WorkflowManualRun.wait({ run_id: second.id, timeout_ms: 5000 })
            const second_snapshot = RuntimeRunSnapshot.byRun({ run_id: second_done.id })

            expect(first_snapshot.workflow_revision_id).not.toBe(second_snapshot.workflow_revision_id)
            expect(first_snapshot.workflow_text).toContain("Inspect")
            expect(second_snapshot.workflow_text).toContain("Inspect updated")
            const first_material = first_snapshot.resource_materials_json.review_prompt as { snapshot_file: string }
            const second_material = second_snapshot.resource_materials_json.review_prompt as { snapshot_file: string }
            expect(await Bun.file(first_material.snapshot_file).text()).toBe("first version")
            expect(await Bun.file(second_material.snapshot_file).text()).toBe("second version")
            expect(RuntimeWorkflowRevision.head({ project_id: Instance.project.id, workflow_id: "revision_flow" })?.id).toBe(
              second_snapshot.workflow_revision_id,
            )
          },
        })
      },
    })
  })

  test("prepare refreshes workflow and resources when files change before snapshot capture", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/library/review-template.yaml",
      [
        "schema_version: 1",
        "id: review_template",
        "kind: prompt_template",
        "template: first version",
      ].join("\n"),
    )
    await write(
      dir.path,
      ".origin/workflows/revision.yaml",
      [
        "schema_version: 2",
        "id: revision_flow",
        "name: Revision flow",
        "trigger:",
        "  type: manual",
        "resources:",
        "  - id: review_prompt",
        "    source: library",
        "    kind: prompt_template",
        "    item_id: review_template",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: resource",
        "      resource_id: review_prompt",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    let changed = false

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set({
              ...seams({
                agent: async () => ({ structured: null }),
              }),
              prepare: async (input) => {
                if (!changed) {
                  changed = true
                  await write(
                    dir.path,
                    ".origin/library/review-template.yaml",
                    [
                      "schema_version: 1",
                      "id: review_template",
                      "kind: prompt_template",
                      "template: second version",
                    ].join("\n"),
                  )
                  await write(
                    dir.path,
                    ".origin/workflows/revision.yaml",
                    [
                      "schema_version: 2",
                      "id: revision_flow",
                      "name: Revision flow updated",
                      "trigger:",
                      "  type: manual",
                      "resources:",
                      "  - id: review_prompt",
                      "    source: library",
                      "    kind: prompt_template",
                      "    item_id: review_template",
                      "steps:",
                      "  - id: inspect",
                      "    kind: agent_request",
                      "    title: Inspect updated",
                      "    prompt:",
                      "      source: resource",
                      "      resource_id: review_prompt",
                      "  - id: done",
                      "    kind: end",
                      "    title: Done",
                      "    result: success",
                    ].join("\n"),
                  )
                }
                return WorkflowGraphRun.prepare(input)
              },
            })

            const run = await WorkflowManualRun.start({ workflow_id: "revision_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            const snapshot = RuntimeRunSnapshot.byRun({ run_id: done.id })
            const graph = snapshot.graph_json as {
              name: string
              steps: Array<{ title: string }>
            }
            const material = snapshot.resource_materials_json.review_prompt as { snapshot_file: string }

            expect(snapshot.workflow_text).toContain("Inspect updated")
            expect(graph.name).toBe("Revision flow updated")
            expect(graph.steps.map((item) => item.title)).toEqual(["Inspect updated", "Done"])
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => item.title)).toEqual(["Inspect updated", "Done"])
            expect(await Bun.file(material.snapshot_file).text()).toBe("second version")
          },
        })
      },
    })
  })

  test("change classification persists integration candidate and completes integration", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 2",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: repair",
        "    kind: script",
        "    title: Repair",
        "    script:",
        "      source: inline",
        "      text: mkdir -p notes && printf 'changed' > notes/result.md",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowIntegrationQueue.Testing.set({
              head: async ({ run }) => run.integration_candidate_base_change_id,
              apply: async ({ run }) => ({
                head_after: run.integration_candidate_base_change_id,
              }),
            })
            WorkflowManualRun.Testing.set(seams())

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            expect(audit(run.id, "workflow.run.outcome")).toEqual([
              {
                workspace_id: "wrk_manual",
                workflow_id: "basic",
                run_id: run.id,
                outcome: "completed",
                status: "ready_for_integration",
                reason_code: null,
                failure_code: null,
              },
            ])
            await WorkflowIntegrationQueue.Testing.drain({ timeout_ms: 5000 })
            const done = WorkflowManualRun.get({ run_id: run.id })

            expect(done.status).toBe("completed")
            expect(done.integration_candidate?.changed_paths).toContain("notes/result.md")
            const operations = Database.use((db) => db.select().from(OperationTable).all())
            expect(operations).toHaveLength(1)
          },
        })
      },
    })
  })

  test("partial start failure keeps the followup session and marks the run failed", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = simple_graph()
    await write(dir.path, graph.file, graph.text)

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams({ create_fail: true }))

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })

            expect(run.status).toBe("failed")
            expect(run.failure_code).toBe("manual_start_failed")
            expect(run.session_id).toBeTruthy()
            expect(RuntimeSessionLink.get({ session_id: run.session_id! }).role).toBe("run_followup")
          },
        })
      },
    })
  })

  test("cleanup failure is recorded without changing the terminal status", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = simple_graph()
    await write(dir.path, graph.file, graph.text)

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams({ forget_fail: true }))

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(done.cleanup_failed).toBe(true)
            expect(done.failure_code).toBe("cleanup_failed")
          },
        })
      },
    })
  })

  test("run fails if execution mutates outside run workspace boundaries", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 2",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async () => {
                  await write(dir.path, "outside.txt", "forbidden")
                },
              }),
            )

            const run = await WorkflowManualRun.start({
              workflow_id: "basic",
              trigger_id: "escape",
            })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("workspace_policy_blocked")
            expect(done.integration_candidate).toBeNull()
          },
        })
      },
    })
  })

  test("cancel transitions running graph runs to canceled", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 2",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async (item) => {
                  while (!item.abort.aborted) {
                    await Bun.sleep(20)
                  }
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "cancel" })
            await wait_status(run.id, "running")
            const canceled = WorkflowManualRun.cancel({ run_id: run.id })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            const inspect = RuntimeRunNode.byNode({ run_id: done.id, node_id: "inspect" })
            const attempts = RuntimeRunAttempt.byNode({ run_node_id: inspect.id })

            expect(canceled.status).toBe("canceled")
            expect(done.status).toBe("canceled")
            expect(inspect.status).toBe("canceled")
            expect(RuntimeRunNode.byNode({ run_id: done.id, node_id: "done" }).status).toBe("canceled")
            expect(attempts).toHaveLength(1)
            expect(attempts[0]?.status).toBe("canceled")
          },
        })
      },
    })
  })

  test("thrown script failures persist failed attempts and skip downstream nodes", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/script-throw.yaml",
      [
        "schema_version: 2",
        "id: script_throw_flow",
        "name: Script throw flow",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: repair",
        "    kind: script",
        "    title: Repair",
        "    script:",
        "      source: inline",
        "      text: exit 0",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                script: async () => {
                  throw new Error("boom")
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "script_throw_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            const repair = RuntimeRunNode.byNode({ run_id: done.id, node_id: "repair" })
            const attempts = RuntimeRunAttempt.byNode({ run_node_id: repair.id })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("node_execution_failed")
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
              ["repair", "failed", null],
              ["done", "skipped", "upstream_failed"],
            ])
            expect(attempts).toHaveLength(1)
            expect(attempts[0]?.status).toBe("failed")
          },
        })
      },
    })
  })

  test("thrown agent_request failures persist failed attempts and skip downstream nodes", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/agent-throw.yaml",
      [
        "schema_version: 2",
        "id: agent_throw_flow",
        "name: Agent throw flow",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Review",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                agent: async () => {
                  throw new Error("boom")
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "agent_throw_flow" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            const inspect = RuntimeRunNode.byNode({ run_id: done.id, node_id: "inspect" })
            const attempts = RuntimeRunAttempt.byNode({ run_node_id: inspect.id })
            const links = RuntimeSessionLink.byAttempt({ run_attempt_id: attempts[0]!.id })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("node_execution_failed")
            expect(RuntimeRunNode.byRun({ run_id: done.id }).map((item) => [item.node_id, item.status, item.skip_reason_code])).toEqual([
              ["inspect", "failed", null],
              ["done", "skipped", "upstream_failed"],
            ])
            expect(attempts).toHaveLength(1)
            expect(attempts[0]?.status).toBe("failed")
            expect(attempts[0]?.session_id).toBeTruthy()
            expect(links).toHaveLength(1)
            expect(links[0]?.role).toBe("execution_node")
            expect(links[0]?.visibility).toBe("hidden")
          },
        })
      },
    })
  })
})

describe("workflow automated run orchestration", () => {
  test("retryable automated failures exhaust after three attempts with canonical persistence", async () => {
    await using dir = await tmpdir({ git: true })

    let attempts = 0

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_auto", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_auto",
          fn: async () => {
            WorkflowManualRun.Testing.set({
              ...seams(),
              execute: async () => {
                attempts += 1
                throw new Error("boom")
              },
            })

            const run = await WorkflowAutoRun.start({
              workflow: {
                id: "auto_retryable",
                name: "Auto Retryable",
                instructions: "run",
              },
              trigger_type: "signal",
              trigger_id: "signal:retryable",
              trigger_metadata_json: {
                source: "signal",
                signal: "incoming",
              },
            })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("transient_runtime_error")
            expect(done.reason_code).toBe("retry_exhausted")
            expect(done.trigger_metadata).toEqual({
              source: "signal",
              signal: "incoming",
            })
            expect(attempts).toBe(3)

            const sessions = Database.use((db) => db.select().from(SessionTable).all())
            expect(sessions).toHaveLength(1)
            expect(done.session_id).toBe(sessions[0]?.id ?? null)
          },
        })
      },
    })
  })

  test("retryable cron failures exhaust after three attempts and preserve cron metadata", async () => {
    await using dir = await tmpdir({ git: true })

    let attempts = 0

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_auto", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_auto",
          fn: async () => {
            WorkflowManualRun.Testing.set({
              ...seams(),
              execute: async () => {
                attempts += 1
                throw new Error("boom")
              },
            })

            const run = await WorkflowAutoRun.start({
              workflow: {
                id: "auto_retryable_cron",
                name: "Auto Retryable Cron",
                instructions: "run",
              },
              trigger_type: "cron",
              trigger_id: "cron:retryable",
              trigger_metadata_json: {
                source: "cron",
                slot_utc: 1,
              },
            })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("transient_runtime_error")
            expect(done.reason_code).toBe("retry_exhausted")
            expect(done.trigger_metadata).toEqual({
              source: "cron",
              slot_utc: 1,
            })
            expect(attempts).toBe(3)

            const sessions = Database.use((db) => db.select().from(SessionTable).all())
            expect(sessions).toHaveLength(1)
            expect(done.session_id).toBe(sessions[0]?.id ?? null)
          },
        })
      },
    })
  })

  test("non-retryable automated failures do not retry and persist non_retryable reason", async () => {
    await using dir = await tmpdir({ git: true })

    let attempts = 0

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_auto", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_auto",
          fn: async () => {
            WorkflowManualRun.Testing.set({
              ...seams(),
              execute: async () => {
                attempts += 1
              },
              validate: async () => {
                throw new RuntimeTriggerFailureError({
                  code: "validation_error",
                  message: "bad output",
                })
              },
            })

            const run = await WorkflowAutoRun.start({
              workflow: {
                id: "auto_non_retryable",
                name: "Auto Non Retryable",
                instructions: "run",
              },
              trigger_type: "cron",
              trigger_id: "cron:1",
              trigger_metadata_json: {
                source: "cron",
                slot_utc: 1,
              },
            })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("validation_error")
            expect(done.reason_code).toBe("non_retryable")
            expect(done.trigger_metadata).toEqual({
              source: "cron",
              slot_utc: 1,
            })
            expect(attempts).toBe(1)
          },
        })
      },
    })
  })
})
