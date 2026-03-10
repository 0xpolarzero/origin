import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkspaceContext } from "../../src/control-plane/workspace-context"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { JJ } from "../../src/project/jj"
import { RuntimeRun } from "../../src/runtime/run"
import { RuntimeSessionLink } from "../../src/runtime/session-link"
import { Server } from "../../src/server/server"
import { Database } from "../../src/storage/db"
import { Session } from "../../src/session"
import { WorkflowManualRun } from "../../src/workflow/manual-run"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

function seed(workspace_id: string, directory: string) {
  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: workspace_id,
        project_id: Instance.project.id,
        branch: "main",
        type: "worktree",
        directory,
      })
      .onConflictDoNothing()
      .run()
  })
}

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

type Step = {
  id: string
  kind: string
  title: string
  when?: {
    ref: string
    op: string
    value: string | number | boolean | null
  }
  then?: Step[]
  else?: Step[]
  result?: string
}

function seams(input?: Parameters<typeof WorkflowManualRun.Testing.set>[0]) {
  return {
    adapter: ({ directory }: { directory: string }) =>
      JJ.create({
        cwd: directory,
        run_root: path.join(directory, ".origin", "runs"),
        runner: async (args) => {
          if (args[0] === "workspace" && args[1] === "add") {
            await mkdir(args[2], { recursive: true })
            return result()
          }
          return result()
        },
      }),
    ...input,
  }
}

beforeEach(async () => {
  await resetDatabase()
  WorkflowManualRun.Testing.reset()
})

afterEach(async () => {
  await resetDatabase()
  WorkflowManualRun.Testing.reset()
})

describe("workflow detail routes", () => {
  test("workflow detail returns 404 for unknown workflow ids", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const detail = await app.request(`/workflow/workflows/missing/detail${query}`, {
          method: "GET",
        })

        expect(detail.status).toBe(404)
        expect(await detail.text()).toContain("Workflow not found: missing")
      },
    })
  })

  test("workflow detail returns 409 for ambiguous workflow ids", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/one.yaml",
      [
        "schema_version: 2",
        "id: duplicate",
        "name: One",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: done_one",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )
    await write(
      dir.path,
      ".origin/workflows/two.yaml",
      [
        "schema_version: 2",
        "id: duplicate",
        "name: Two",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: done_two",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const detail = await app.request(`/workflow/workflows/duplicate/detail${query}`, {
          method: "GET",
        })

        expect(detail.status).toBe(409)
        expect(await detail.text()).toContain("Workflow id is ambiguous: duplicate")
      },
    })
  })

  test("workflow detail returns revision, resources, and recent runs", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/library/build_script.yaml",
      [
        "schema_version: 1",
        "id: build_script",
        "kind: script",
        "script: echo build",
      ].join("\n"),
    )
    await write(dir.path, ".origin/workflows/review/prompts/inspect.txt", "Inspect release.")
    await write(
      dir.path,
      ".origin/workflows/review.yaml",
      [
        "schema_version: 2",
        "id: review",
        "name: Review",
        "trigger:",
        "  type: manual",
        "resources:",
        "  - id: inspect_prompt",
        "    source: local",
        "    kind: prompt_template",
        "    path: prompts/inspect.txt",
        "  - id: build_script_ref",
        "    source: library",
        "    kind: script",
        "    item_id: build_script",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: resource",
        "      resource_id: inspect_prompt",
        "  - id: build",
        "    kind: script",
        "    title: Build",
        "    script:",
        "      source: resource",
        "      resource_id: build_script_ref",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_review", dir.path)
        WorkflowManualRun.Testing.set(
          seams({
          agent: async () => ({ structured: null }),
          script: async () => ({
            exit_code: 0,
            stdout: "build",
            stderr: "",
          }),
          }),
        )

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_review`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "review",
          }),
        })
        expect(start.status).toBe(200)
        const started = (await start.json()) as { id: string }
        await WorkflowManualRun.wait({ run_id: started.id, timeout_ms: 5000 })

        const detail = await app.request(`/workflow/workflows/review/detail${query}`, {
          method: "GET",
        })
        expect(detail.status).toBe(200)
        const body = (await detail.json()) as {
          item: { id: string }
          revision_head: { workflow_id: string } | null
          resources: Array<{ id: string; source: string; used_by: string[] }>
          runs: Array<{ id: string }>
        }

        expect(body.item.id).toBe("review")
        expect(body.revision_head?.workflow_id).toBe("review")
        expect(body.resources.map((item) => ({ id: item.id, source: item.source, used_by: item.used_by }))).toEqual([
          {
            id: "inspect_prompt",
            source: "local",
            used_by: ["inspect"],
          },
          {
            id: "build_script_ref",
            source: "library",
            used_by: ["build"],
          },
        ])
        expect(body.runs.some((item) => item.id === started.id)).toBe(true)
      },
    })
  })

  test("workflow detail preserves nested condition branches recursively", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/review.yaml",
      [
        "schema_version: 2",
        "id: review",
        "name: Review",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Inspect release.",
        "    output:",
        "      type: object",
        "      required: [route, approved]",
        "      properties:",
        "        route:",
        "          type: string",
        "        approved:",
        "          type: boolean",
        "  - id: route",
        "    kind: condition",
        "    title: Route",
        "    when:",
        "      ref: steps.inspect.output.route",
        "      op: equals",
        "      value: manual",
        "    then:",
        "      - id: gate",
        "        kind: condition",
        "        title: Approved?",
        "        when:",
        "          ref: steps.inspect.output.approved",
        "          op: equals",
        "          value: true",
        "        then:",
        "          - id: finish",
        "            kind: end",
        "            title: Finish",
        "            result: success",
        "        else:",
        "          - id: stop",
        "            kind: end",
        "            title: Stop",
        "            result: failure",
        "    else:",
        "      - id: skip",
        "        kind: end",
        "        title: Skip",
        "        result: noop",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const detail = await app.request(`/workflow/workflows/review/detail${query}`, {
          method: "GET",
        })

        expect(detail.status).toBe(200)
        const body = (await detail.json()) as {
          item: {
            workflow?: {
              steps: Step[]
            }
          }
        }

        expect(body.item.workflow?.steps.map((item) => item.id)).toEqual(["inspect", "route"])
        expect(body.item.workflow?.steps[1]).toEqual({
          id: "route",
          kind: "condition",
          title: "Route",
          when: {
            ref: "steps.inspect.output.route",
            op: "equals",
            value: "manual",
          },
          then: [
            {
              id: "gate",
              kind: "condition",
              title: "Approved?",
              when: {
                ref: "steps.inspect.output.approved",
                op: "equals",
                value: true,
              },
              then: [
                {
                  id: "finish",
                  kind: "end",
                  title: "Finish",
                  result: "success",
                },
              ],
              else: [
                {
                  id: "stop",
                  kind: "end",
                  title: "Stop",
                  result: "failure",
                },
              ],
            },
          ],
          else: [
            {
              id: "skip",
              kind: "end",
              title: "Skip",
              result: "noop",
            },
          ],
        })
      },
    })
  })

  test("run detail returns snapshot graph, attempts, and linked sessions", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/review.yaml",
      [
        "schema_version: 2",
        "id: review",
        "name: Review",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Inspect release.",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_review", dir.path)
        WorkflowManualRun.Testing.set(
          seams({
            agent: async () => ({ structured: null }),
          }),
        )

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_review`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "review",
          }),
        })
        expect(start.status).toBe(200)
        const started = (await start.json()) as { id: string }
        await WorkflowManualRun.wait({ run_id: started.id, timeout_ms: 5000 })

        const detail = await app.request(`/workflow/runs/${started.id}/detail${query}`, {
          method: "GET",
        })
        expect(detail.status).toBe(200)
        const body = (await detail.json()) as {
          run: { id: string; status: string }
          snapshot: { workflow_id: string; graph_json: { steps: Array<{ id: string }> } }
          nodes: Array<{
            node: { node_id: string }
            attempts: Array<{
              attempt: { session_id: string | null }
              session: { link: { role: string; visibility: string } } | null
            }>
          }>
          followup: { link: { role: string; visibility: string }; session: { id: string } | null } | null
        }

        expect(body.run.id).toBe(started.id)
        expect(body.run.status).toBe("completed_no_change")
        expect(body.snapshot.workflow_id).toBe("review")
        expect(body.snapshot.graph_json.steps.map((item) => item.id)).toEqual(["inspect", "done"])
        expect(body.nodes.map((item) => item.node.node_id)).toEqual(["inspect", "done"])
        expect(body.nodes[0]?.attempts).toHaveLength(1)
        expect(body.nodes[0]?.attempts[0]?.session?.link.role).toBe("execution_node")
        expect(body.nodes[0]?.attempts[0]?.session?.link.visibility).toBe("hidden")
        expect(body.followup?.link.role).toBe("run_followup")
        expect(body.followup?.session?.id).toBeTruthy()

        const execution_session_id = body.nodes[0]?.attempts[0]?.attempt.session_id
        expect(execution_session_id).toBeTruthy()

        const link = await app.request(`/workflow/session-link/${execution_session_id}${query}`, {
          method: "GET",
        })
        expect(link.status).toBe(200)
        const link_body = (await link.json()) as { role: string; visibility: string } | null
        expect(link_body?.role).toBe("execution_node")
        expect(link_body?.visibility).toBe("hidden")
      },
    })
  })

  test("run detail preserves nested condition steps in snapshot and node payloads", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/review.yaml",
      [
        "schema_version: 2",
        "id: review",
        "name: Review",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: inline",
        "      text: Inspect release.",
        "    output:",
        "      type: object",
        "      required: [route, approved]",
        "      properties:",
        "        route:",
        "          type: string",
        "        approved:",
        "          type: boolean",
        "  - id: route",
        "    kind: condition",
        "    title: Route",
        "    when:",
        "      ref: steps.inspect.output.route",
        "      op: equals",
        "      value: manual",
        "    then:",
        "      - id: gate",
        "        kind: condition",
        "        title: Approved?",
        "        when:",
        "          ref: steps.inspect.output.approved",
        "          op: equals",
        "          value: true",
        "        then:",
        "          - id: finish",
        "            kind: end",
        "            title: Finish",
        "            result: success",
        "        else:",
        "          - id: stop",
        "            kind: end",
        "            title: Stop",
        "            result: failure",
        "    else:",
        "      - id: skip",
        "        kind: end",
        "        title: Skip",
        "        result: noop",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_review", dir.path)
        WorkflowManualRun.Testing.set(
          seams({
            agent: async () => ({
              structured: {
                route: "manual",
                approved: false,
              },
            }),
          }),
        )

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_review`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "review",
          }),
        })
        expect(start.status).toBe(200)
        const started = (await start.json()) as { id: string }
        await WorkflowManualRun.wait({ run_id: started.id, timeout_ms: 5000 })

        const detail = await app.request(`/workflow/runs/${started.id}/detail${query}`, {
          method: "GET",
        })

        expect(detail.status).toBe(200)
        const body = (await detail.json()) as {
          run: { status: string }
          snapshot: {
            graph_json: {
              steps: Step[]
            }
          }
          nodes: Array<{
            node: { node_id: string; status: string; skip_reason_code: string | null }
            step: Step
          }>
        }

        expect(body.run.status).toBe("failed")
        expect(body.snapshot.graph_json.steps[1]).toEqual({
          id: "route",
          kind: "condition",
          title: "Route",
          when: {
            ref: "steps.inspect.output.route",
            op: "equals",
            value: "manual",
          },
          then: [
            {
              id: "gate",
              kind: "condition",
              title: "Approved?",
              when: {
                ref: "steps.inspect.output.approved",
                op: "equals",
                value: true,
              },
              then: [
                {
                  id: "finish",
                  kind: "end",
                  title: "Finish",
                  result: "success",
                },
              ],
              else: [
                {
                  id: "stop",
                  kind: "end",
                  title: "Stop",
                  result: "failure",
                },
              ],
            },
          ],
          else: [
            {
              id: "skip",
              kind: "end",
              title: "Skip",
              result: "noop",
            },
          ],
        })
        expect(body.nodes.map((item) => item.node.node_id)).toEqual(["inspect", "route", "gate", "finish", "stop", "skip"])
        expect(body.nodes.find((item) => item.node.node_id === "route")?.step).toEqual(body.snapshot.graph_json.steps[1])
        expect(body.nodes.find((item) => item.node.node_id === "gate")?.step).toEqual({
          id: "gate",
          kind: "condition",
          title: "Approved?",
          when: {
            ref: "steps.inspect.output.approved",
            op: "equals",
            value: true,
          },
          then: [
            {
              id: "finish",
              kind: "end",
              title: "Finish",
              result: "success",
            },
          ],
          else: [
            {
              id: "stop",
              kind: "end",
              title: "Stop",
              result: "failure",
            },
          ],
        })
        expect(body.nodes.find((item) => item.node.node_id === "finish")?.node.skip_reason_code).toBe("branch_not_taken")
        expect(body.nodes.find((item) => item.node.node_id === "stop")?.node.skip_reason_code).toBeNull()
        expect(body.nodes.find((item) => item.node.node_id === "skip")?.node.skip_reason_code).toBe("branch_not_taken")
      },
    })
  })

  test("session link route returns null when no workflow link exists", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const link = await app.request(`/workflow/session-link/missing${query}`, {
          method: "GET",
        })

        expect(link.status).toBe(200)
        expect(await link.json()).toBeNull()
      },
    })
  })

  test("session link route returns null for sessions outside the active project", async () => {
    await using left = await tmpdir({ git: true })
    await using right = await tmpdir({ git: true })

    const session_id = await Instance.provide({
      directory: left.path,
      fn: async () => {
        seed("wrk_external", left.path)
        const run = RuntimeRun.create({
          workspace_id: "wrk_external",
          trigger_type: "manual",
          workflow_id: "external",
        })
        const session = await Session.createNext({
          directory: left.path,
          title: "External execution",
        })
        RuntimeSessionLink.upsert({
          session_id: session.id,
          role: "run_followup",
          run_id: run.id,
        })
        return session.id
      },
    })

    await Instance.provide({
      directory: right.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(right.path)}`
        const link = await app.request(`/workflow/session-link/${session_id}${query}`, {
          method: "GET",
        })

        expect(link.status).toBe(200)
        expect(await link.json()).toBeNull()
      },
    })
  })

  test("session link route returns null for sessions in another workspace within the same project", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_left", dir.path)
        seed("wrk_right", dir.path)
        const session_id = await WorkspaceManualLink({
          directory: dir.path,
          workspace_id: "wrk_left",
          workflow_id: "review",
        })

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_right`
        const link = await app.request(`/workflow/session-link/${session_id}${query}`, {
          method: "GET",
        })

        expect(link.status).toBe(200)
        expect(await link.json()).toBeNull()
      },
    })
  })
})

async function WorkspaceManualLink(input: { directory: string; workspace_id: string; workflow_id: string }) {
  return WorkspaceContext.provide({
    workspaceID: input.workspace_id,
    fn: async () => {
      const run = RuntimeRun.create({
        workspace_id: input.workspace_id,
        trigger_type: "manual",
        workflow_id: input.workflow_id,
      })
      const session = await Session.createNext({
        directory: input.directory,
        title: `Workspace ${input.workspace_id}`,
      })
      RuntimeSessionLink.upsert({
        session_id: session.id,
        role: "run_followup",
        run_id: run.id,
      })
      return session.id
    },
  })
}
