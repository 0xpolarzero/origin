import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { JJ } from "../../src/project/jj"
import { RuntimeRunSnapshot } from "../../src/runtime/run-snapshot"
import { RuntimeSessionLink } from "../../src/runtime/session-link"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { WorkflowDetail } from "../../src/workflow/detail"
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

function result() {
  const out = Buffer.from("")
  return {
    exitCode: 0,
    stdout: out,
    stderr: out,
    text: () => "",
  }
}

function seams() {
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
    agent: async () => ({ structured: null }),
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

describe("workflow authoring routes", () => {
  test("build route creates canonical files, hidden builder session, and workflow history", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const build = await app.request(`/workflow/workflows/build${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: "Review release notes and summarize the diff.",
          }),
        })
        expect(build.status).toBe(200)
        const body = (await build.json()) as {
          workflow_id: string
          file: string
          session_id: string
        }

        expect(await Bun.file(path.join(dir.path, body.file)).text()).toContain(`id: ${body.workflow_id}`)
        expect(await Bun.file(path.join(dir.path, ".origin/workflows", body.workflow_id, "prompts/builder.txt")).text()).toContain(
          "Review release notes",
        )

        const session = await Session.get(body.session_id)
        expect(session.title).toContain("Builder:")
        const link = RuntimeSessionLink.get({ session_id: body.session_id })
        expect(link.role).toBe("builder")
        expect(link.visibility).toBe("hidden")

        const listed = Array.from(Session.list({ directory: dir.path }))
        expect(listed.some((item) => item.id === body.session_id)).toBe(false)

        const history = await app.request(`/workflow/workflows/${body.workflow_id}/history${query}`, {
          method: "GET",
        })
        expect(history.status).toBe(200)
        const page = (await history.json()) as {
          items: Array<{
            edit: { action: string }
            revision: { workflow_id: string }
            diff: string
          }>
        }
        expect(page.items).toHaveLength(1)
        expect(page.items[0]?.edit.action).toBe("builder")
        expect(page.items[0]?.revision.workflow_id).toBe(body.workflow_id)
        expect(page.items[0]?.diff).toContain(body.workflow_id)
      },
    })
  })

  test("save route updates canonical workflow files and appends workflow edit history", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const build = await app.request(`/workflow/workflows/build${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: "Create a starter review flow.",
            name: "Review Flow",
          }),
        })
        const built = (await build.json()) as { workflow_id: string; session_id: string }

        const save = await app.request(`/workflow/workflows/${built.workflow_id}${query}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow: {
              schema_version: 2,
              id: built.workflow_id,
              name: "Edited Review Flow",
              description: "Edited by graph authoring",
              trigger: {
                type: "manual",
              },
              inputs: [],
              resources: [
                {
                  id: "builder_prompt",
                  source: "local",
                  kind: "prompt_template",
                  path: "prompts/builder.txt",
                },
              ],
              steps: [
                {
                  id: "draft",
                  kind: "agent_request",
                  title: "Draft",
                  prompt: {
                    source: "resource",
                    resource_id: "builder_prompt",
                  },
                },
                {
                  id: "done",
                  kind: "end",
                  title: "Done",
                  result: "success",
                },
              ],
            },
            resources: {
              "prompts/builder.txt": "Updated builder prompt",
            },
            action: "graph_edit",
            session_id: built.session_id,
            note: "Rename workflow",
          }),
        })
        expect(save.status).toBe(200)
        expect(await Bun.file(path.join(dir.path, ".origin/workflows/review-flow.yaml")).text()).toContain("Edited Review Flow")
        expect(await Bun.file(path.join(dir.path, ".origin/workflows", built.workflow_id, "prompts/builder.txt")).text()).toContain(
          "Updated builder prompt",
        )

        const history = await app.request(`/workflow/workflows/${built.workflow_id}/history${query}`, {
          method: "GET",
        })
        const page = (await history.json()) as {
          items: Array<{
            edit: { action: string; note: string | null }
            diff: string
          }>
        }
        expect(page.items).toHaveLength(2)
        expect(page.items[0]?.edit.action).toBe("graph_edit")
        expect(page.items[0]?.edit.note).toBe("Rename workflow")
        expect(page.items[0]?.diff).toContain("Edited Review Flow")
      },
    })
  })

  test("copy and hide routes duplicate canonical resources and remove hidden workflows from the active index", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const build = await app.request(`/workflow/workflows/build${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: "Review release notes and summarize the diff.",
            name: "Ship Flow",
          }),
        })
        const built = (await build.json()) as { workflow_id: string }

        const copy = await app.request(`/workflow/workflows/${built.workflow_id}/copy${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
        expect(copy.status).toBe(200)
        const duplicated = (await copy.json()) as { workflow_id: string; file: string }
        expect(duplicated.workflow_id).not.toBe(built.workflow_id)
        expect(await Bun.file(path.join(dir.path, duplicated.file)).text()).toContain(`id: ${duplicated.workflow_id}`)
        expect(await Bun.file(path.join(dir.path, ".origin/workflows", duplicated.workflow_id, "prompts/builder.txt")).text()).toContain(
          "Review release notes",
        )

        const hidden = await app.request(`/workflow/workflows/${built.workflow_id}/hide${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
        expect(hidden.status).toBe(200)
        const body = (await hidden.json()) as { target: string }
        expect(await Bun.file(path.join(dir.path, body.target)).text()).toContain(`id: ${built.workflow_id}`)

        const list = await app.request(`/workflow/workflows${query}`, {
          method: "GET",
        })
        expect(list.status).toBe(200)
        const page = (await list.json()) as { items: Array<{ id: string }> }
        expect(page.items.map((item) => item.id)).toEqual([duplicated.workflow_id])
      },
    })
  })

  test("rerun route starts a new run from frozen inputs", async () => {
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
        "inputs:",
        "  - key: topic",
        "    type: text",
        "    label: Topic",
        "    required: true",
        "steps:",
        "  - id: draft",
        "    kind: agent_request",
        "    title: Draft",
        "    prompt:",
        "      source: inline",
        "      text: Write about {{inputs.topic}}.",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_basic", dir.path)
        WorkflowManualRun.Testing.set(seams())

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_basic`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
            inputs: {
              topic: "release",
            },
          }),
        })
        expect(start.status).toBe(200)
        const first = (await start.json()) as { id: string }
        await WorkflowManualRun.wait({ run_id: first.id, timeout_ms: 5000 })

        const rerun = await app.request(`/workflow/runs/${first.id}/rerun${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
        expect(rerun.status).toBe(200)
        const second = (await rerun.json()) as { id: string }
        expect(second.id).not.toBe(first.id)
        await WorkflowManualRun.wait({ run_id: second.id, timeout_ms: 5000 })

        const snapshot = RuntimeRunSnapshot.byRun({ run_id: second.id })
        expect(snapshot.workflow_id).toBe("basic")
        expect(snapshot.input_json).toEqual({
          topic: "release",
        })
      },
    })
  })

  test("rerun route reuses upstream node state when rerunning from a selected node", async () => {
    await using dir = await tmpdir({ git: true })
    await write(
      dir.path,
      ".origin/workflows/replay.yaml",
      [
        "schema_version: 2",
        "id: replay",
        "name: Replay",
        "trigger:",
        "  type: manual",
        "inputs: []",
        "resources: []",
        "steps:",
        "  - id: route",
        "    kind: agent_request",
        "    title: Route",
        "    prompt:",
        "      source: inline",
        "      text: Decide which branch to run.",
        "    output:",
        "      type: object",
        "      required: [branch]",
        "      properties:",
        "        branch:",
        "          type: string",
        "  - id: pick",
        "    kind: condition",
        "    title: Pick",
        "    when:",
        "      ref: steps.route.output.branch",
        "      op: equals",
        "      value: then",
        "    then:",
        "      - id: seed",
        "        kind: script",
        "        title: Seed",
        "        script:",
        "          source: inline",
        "          text: printf then > branch.txt",
        "    else:",
        "      - id: else_work",
        "        kind: script",
        "        title: Else work",
        "        script:",
        "          source: inline",
        "          text: printf else > branch.txt",
        "  - id: consume",
        "    kind: script",
        "    title: Consume",
        "    script:",
        "      source: inline",
        "      text: test \"$(cat branch.txt)\" = then && printf ok > done.txt",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_replay", dir.path)
        const hits: string[] = []
        let turn = 1

        WorkflowManualRun.Testing.set({
          ...seams(),
          agent: async (input) => {
            hits.push(input.node_id)
            return {
              structured: {
                branch: turn === 1 ? "then" : "else",
              },
            }
          },
          script: async (input) => {
            hits.push(input.node_id)
            if (input.node_id === "seed") {
              await Bun.write(path.join(input.cwd, "branch.txt"), "then")
            }
            if (input.node_id === "consume") {
              const value = await Bun.file(path.join(input.cwd, "branch.txt")).text()
              if (value.trim() !== "then") {
                return {
                  exit_code: 1,
                  stdout: "",
                  stderr: `bad-state:${value}`,
                }
              }
              await Bun.write(path.join(input.cwd, "done.txt"), `consume:${turn}`)
            }
            return {
              exit_code: 0,
              stdout: "ok",
              stderr: "",
            }
          },
        })

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_replay`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "replay",
            inputs: {},
          }),
        })
        expect(start.status).toBe(200)
        const first = (await start.json()) as { id: string }
        await WorkflowManualRun.wait({ run_id: first.id, timeout_ms: 5000 })

        turn = 2
        const rerun = await app.request(`/workflow/runs/${first.id}/rerun${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            node_id: "consume",
          }),
        })
        expect(rerun.status).toBe(200)
        const second = (await rerun.json()) as { id: string }
        expect(second.id).not.toBe(first.id)
        await WorkflowManualRun.wait({ run_id: second.id, timeout_ms: 5000 })

        expect(hits).toEqual(["route", "seed", "consume", "consume"])

        const detail = await WorkflowDetail.run({ run_id: second.id })
        expect(detail.snapshot.workflow_revision_id).toBe(RuntimeRunSnapshot.byRun({ run_id: first.id }).workflow_revision_id)
        expect(detail.snapshot.input_json).toEqual(RuntimeRunSnapshot.byRun({ run_id: first.id }).input_json)
        expect(detail.nodes.find((item) => item.node.node_id === "route")?.node.output_json).toEqual({
          branch: "then",
        })
        expect(detail.nodes.find((item) => item.node.node_id === "route")?.attempts).toHaveLength(1)
        expect(detail.nodes.find((item) => item.node.node_id === "pick")?.node.output_json).toEqual({
          branch: "then",
          actual: "then",
          expected: "then",
        })
        expect(detail.nodes.find((item) => item.node.node_id === "else_work")?.node.skip_reason_code).toBe("branch_not_taken")
        expect(detail.nodes.find((item) => item.node.node_id === "seed")?.node.output_json).toEqual({
          exit_code: 0,
          stdout: "ok",
          stderr: "",
          changed_paths: ["branch.txt"],
        })
        expect(detail.nodes.find((item) => item.node.node_id === "seed")?.attempts).toHaveLength(1)
        expect(detail.nodes.find((item) => item.node.node_id === "consume")?.attempts).toHaveLength(1)
      },
    })
  })
})
