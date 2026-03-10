import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { GlobalBus } from "../../src/bus/global"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { JJ } from "../../src/project/jj"
import { Instance } from "../../src/project/instance"
import { RuntimeDispatchAttempt } from "../../src/runtime/dispatch-attempt"
import { RuntimeOutbound } from "../../src/runtime/outbound"
import { RuntimeRun } from "../../src/runtime/run"
import { DraftTable, IntegrationAttemptTable, RunTable } from "../../src/runtime/runtime.sql"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { WorkflowIntegrationQueue } from "../../src/workflow/integration-queue"
import { WorkflowManualRun } from "../../src/workflow/manual-run"
import { WorkflowTriggerEngine } from "../../src/workflow/trigger-engine"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

type ExecuteItem = Parameters<
  NonNullable<NonNullable<Parameters<(typeof WorkflowManualRun.Testing)["set"]>[0]>["execute"]>
>[0]

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
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

function manual_workflow(id = "basic", name = "Basic") {
  return [
    "schema_version: 2",
    `id: ${id}`,
    `name: ${name}`,
    "trigger:",
    "  type: manual",
    "steps:",
    "  - id: done",
    "    kind: end",
    "    title: Done",
    "    result: success",
  ].join("\n")
}

function waiting_workflow(id = "basic", name = "Basic") {
  return [
    "schema_version: 2",
    `id: ${id}`,
    `name: ${name}`,
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
  ].join("\n")
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
    execute: async (item: ExecuteItem) => {
      if (input?.execute) {
        await input.execute(item)
        return
      }
    },
    ...input,
  }
}

function integrating(workspace_id: string, directory: string) {
  const run_workspace_directory = path.join(directory, ".origin", "runs", workspace_id)
  const run = RuntimeRun.create({
    workspace_id,
    trigger_type: "manual",
    run_workspace_root: path.dirname(run_workspace_directory),
    run_workspace_directory,
    integration_candidate_changed_paths: ["src/debug.txt"],
  })
  RuntimeRun.transition({ id: run.id, to: "running" })
  RuntimeRun.transition({ id: run.id, to: "validating" })
  RuntimeRun.transition({ id: run.id, to: "ready_for_integration" })
  return RuntimeRun.transition({ id: run.id, to: "integrating" })
}

beforeEach(async () => {
  await resetDatabase()
  WorkflowIntegrationQueue.Testing.reset()
  WorkflowManualRun.Testing.reset()
  WorkflowTriggerEngine.Testing.reset()
  RuntimeOutbound.Testing.reset()
})

afterEach(async () => {
  await resetDatabase()
  WorkflowIntegrationQueue.Testing.reset()
  WorkflowManualRun.Testing.reset()
  WorkflowTriggerEngine.Testing.reset()
  RuntimeOutbound.Testing.reset()
})

describe("workflow/library routes", () => {
  test("run entrypoint route rejects invalid workflow with deterministic runtime error payload", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/invalid.yaml",
      [
        "schema_version: 1",
        "id: bad_route",
        "name: bad route",
        "trigger:",
        "  type: manual",
        "instructions: broken",
        "resources:",
        "  - id: missing_script",
        "    kind: script",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const response = await app.request(`/workflow/run/validate${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "bad_route",
          }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as {
          name: string
          data: { code: string; path: string; message: string }
        }
        expect(body.name).toBe("RuntimeWorkflowValidationError")
        expect(body.data.code).toBe("schema_version_unsupported")
        expect(body.data.path).toBe("$.schema_version")
      },
    })
  })

  test("workflow get route returns 409 for ambiguous workflow ids", async () => {
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
        const response = await app.request(`/workflow/duplicate${query}`, {
          method: "GET",
        })

        expect(response.status).toBe(409)
        expect(await response.text()).toContain("Workflow id is ambiguous: duplicate")
      },
    })
  })

  test("run validate route rejects omitted JSON body", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/workflows/basic.yaml", manual_workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const response = await app.request(`/workflow/run/validate${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{}",
        })

        expect(response.status).toBe(400)
        expect(await response.text()).toContain("workflow_id")
      },
    })
  })

  test("manual run start route rejects omitted workflow_id", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/workflows/basic.yaml", manual_workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_missing", dir.path)
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_missing`
        const response = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{}",
        })

        expect(response.status).toBe(400)
        expect(await response.text()).toContain("workflow_id")
      },
    })
  })

  test("manual run start route rejects omitted JSON body", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/workflows/basic.yaml", manual_workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_missing", dir.path)
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_missing`
        const response = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
        })

        expect(response.status).toBe(400)
      },
    })
  })

  test("library knowledge import route applies forced copy for cron collisions", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/knowledge-base/doc.md", "old")

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const events: { type?: string; properties?: unknown }[] = []
        const handler = (event: { payload: { type?: string; properties?: unknown } }) => {
          events.push(event.payload)
        }
        GlobalBus.on("event", handler)
        const response = await app.request(`/library/knowledge/import${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: "doc.md",
            content: "cron",
            mode: "cron",
            action: "replace",
          }),
        })
        GlobalBus.off("event", handler)

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          status: string
          resolved_path: string
          notification?: { forced?: boolean; action?: string }
        }
        expect(body.status).toBe("created_copy")
        expect(body.resolved_path).toBe("doc (copy).md")
        expect(body.notification?.forced).toBe(true)
        expect(body.notification?.action).toBe("create_copy")

        const notification = events.find((item) => item.type === "library.knowledge.imported")
        expect(notification).toBeDefined()
        const payload = notification?.properties as { notification?: { forced?: boolean; action?: string } } | undefined
        expect(payload?.notification?.forced).toBe(true)
        expect(payload?.notification?.action).toBe("create_copy")
      },
    })
  })

  test("workflow route ignores caller workspace_type override and enforces standard constraints", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/library/query.yaml",
      [
        "schema_version: 1",
        "id: users_lookup",
        "kind: query",
        "query: select 1",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace_type=origin`
        const response = await app.request(`/workflow${query}`, {
          method: "GET",
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          workspace_type: string
          library: Array<{ errors: Array<{ code: string }> }>
        }
        expect(body.workspace_type).toBe("standard")
        expect(body.library[0]?.errors.some((item) => item.code === "workspace_capability_blocked")).toBe(true)
      },
    })
  })

  test("run validate route rejects unknown input fields", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      [
        "schema_version: 1",
        "id: basic",
        "name: Basic",
        "trigger:",
        "  type: manual",
        "instructions: ok",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const response = await app.request(`/workflow/run/validate${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
            workspace_type: "origin",
          }),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  test("manual run start/get/cancel routes are wired and deterministic", async () => {
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
        "      text: Hold",
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
        WorkflowManualRun.Testing.set(
          seams({
            execute: async (item) => {
              while (!item.abort.aborted) {
                await Bun.sleep(20)
              }
            },
          }),
        )

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_manual`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
            trigger_id: "route-run",
          }),
        })
        expect(start.status).toBe(200)
        const started = (await start.json()) as { id: string; status: string }

        const get = await app.request(`/workflow/run/${started.id}${query}`, {
          method: "GET",
        })
        expect(get.status).toBe(200)
        const current = (await get.json()) as { id: string }
        expect(current.id).toBe(started.id)

        const cancel = await app.request(`/workflow/run/${started.id}/cancel${query}`, {
          method: "POST",
        })
        expect(cancel.status).toBe(200)
        const canceled = (await cancel.json()) as { status: string }
        expect(canceled.status).toBe("canceled")
        const done = await WorkflowManualRun.wait({ run_id: started.id, timeout_ms: 5000 })
        expect(done.status).toBe("canceled")
      },
    })
  })

  test("manual run start flows through integration and history routes with linked records", async () => {
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
        "  - id: build",
        "    kind: script",
        "    title: Build",
        "    script:",
        "      source: inline",
        "      text: echo build",
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
        WorkflowIntegrationQueue.Testing.set({
          head: async ({ run }) => run.integration_candidate_base_change_id,
          apply: async ({ run }) => ({
            head_after: run.integration_candidate_base_change_id,
          }),
        })
        WorkflowManualRun.Testing.set(
          seams({
            script: async ({ directory }) => {
              await write(directory, "notes/result.md", "changed")
              return {
                exit_code: 0,
                stdout: "changed",
                stderr: "",
              }
            },
            classify: async () => ({
              changed_paths: ["notes/result.md"],
              base_change_id: null,
              change_ids: [],
            }),
          }),
        )

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_manual`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
            trigger_id: "route-history",
          }),
        })
        expect(start.status).toBe(200)
        const started = (await start.json()) as { id: string }

        await WorkflowManualRun.wait({ run_id: started.id, timeout_ms: 5000 })
        await WorkflowIntegrationQueue.Testing.drain({ timeout_ms: 5000 })
        const current = await app.request(`/workflow/run/${started.id}${query}`, {
          method: "GET",
        })
        expect(current.status).toBe(200)
        const done = (await current.json()) as { status: string }
        expect(done.status).toBe("completed")

        const runs = await app.request(`/workflow/history/runs${query}`, {
          method: "GET",
        })
        expect(runs.status).toBe(200)
        const runs_body = (await runs.json()) as { items: Array<Record<string, unknown>> }
        const run = runs_body.items.find((item) => item.id === started.id)
        expect(run?.operation_exists).toBe(true)
        expect(typeof run?.operation_id).toBe("string")

        const operations = await app.request(`/workflow/history/operations${query}`, {
          method: "GET",
        })
        expect(operations.status).toBe(200)
        const operations_body = (await operations.json()) as { items: Array<Record<string, unknown>> }
        const operation = operations_body.items.find((item) => item.run_id === started.id)
        expect(operation?.run_exists).toBe(true)
        expect(operation?.status).toBe("completed")
        expect(operation?.id).toBe(run?.operation_id)
      },
    })
  })

  test("manual run start route requires workspace context", async () => {
    await using dir = await tmpdir({ git: true })

    await write(dir.path, ".origin/workflows/basic.yaml", manual_workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
          }),
        })

        expect(start.status).toBe(400)
        const body = (await start.json()) as { name: string; data: { code: string } }
        expect(body.name).toBe("RuntimeManualRunWorkspaceRequiredError")
        expect(body.data.code).toBe("manual_run_workspace_required")
      },
    })
  })

  test("manual run start rejects unknown workspace without creating session rows", async () => {
    await using dir = await tmpdir({ git: true })

    await write(dir.path, ".origin/workflows/basic.yaml", manual_workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_missing`
        const start = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
          }),
        })

        expect(start.status).toBe(404)
        const sessions = Database.use((db) => db.select().from(SessionTable).all())
        expect(sessions).toHaveLength(0)
      },
    })
  })

  test("manual run get/cancel routes are scoped to workspace id", async () => {
    await using dir = await tmpdir({ git: true })

    await write(dir.path, ".origin/workflows/basic.yaml", waiting_workflow())

    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_a", dir.path)
        seed("wrk_b", dir.path)

        WorkflowManualRun.Testing.set(
          seams({
            agent: async () => {
              await hold
              return {
                structured: null,
              }
            },
          }),
        )

        const app = Server.App()
        const query_a = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_a`
        const query_b = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_b`

        const start = await app.request(`/workflow/run/start${query_a}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
            trigger_id: "workspace-scope",
          }),
        })
        expect(start.status).toBe(200)
        const started = (await start.json()) as { id: string }

        const wrong_get = await app.request(`/workflow/run/${started.id}${query_b}`, {
          method: "GET",
        })
        expect(wrong_get.status).toBe(404)

        const wrong_cancel = await app.request(`/workflow/run/${started.id}/cancel${query_b}`, {
          method: "POST",
        })
        expect(wrong_cancel.status).toBe(404)

        const current = Database.use((db) => db.select().from(RunTable).where(eq(RunTable.id, started.id)).get())
        expect(current?.status).not.toBe("canceled")

        const cancel = await app.request(`/workflow/run/${started.id}/cancel${query_a}`, {
          method: "POST",
        })
        expect(cancel.status).toBe(200)
        const canceled = (await cancel.json()) as { status: string }
        expect(canceled.status).toBe("canceled")

        release()
        const done = await WorkflowManualRun.wait({ run_id: started.id, timeout_ms: 5000 })
        expect(done.status).toBe("canceled")
      },
    })
  })

  test("manual run duplicate rejection maps to 409", async () => {
    await using dir = await tmpdir({ git: true })

    await write(dir.path, ".origin/workflows/basic.yaml", waiting_workflow())

    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)
        WorkflowManualRun.Testing.set(
          seams({
            agent: async () => {
              await hold
              return {
                structured: null,
              }
            },
          }),
        )

        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_manual`
        const first = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
            trigger_id: "same-trigger",
          }),
        })
        expect(first.status).toBe(200)
        const started = (await first.json()) as { id: string }

        const second = await app.request(`/workflow/run/start${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
            trigger_id: "same-trigger",
          }),
        })
        expect(second.status).toBe(409)
        const body = (await second.json()) as { name: string }
        expect(body.name).toBe("RuntimeManualRunDuplicateError")

        release()
        await WorkflowManualRun.wait({ run_id: started.id, timeout_ms: 5000 })
      },
    })
  })

  test("draft routes create, mutate, approve, send, reject, and enforce workspace scoping", async () => {
    await using home = await tmpdir({
      init: async (root) => {
        const directory = path.join(root, "Documents", "origin")
        await mkdir(directory, { recursive: true })
        await $`git init`.cwd(directory).quiet()
        await $`git commit --allow-empty -m "root commit ${directory}"`.cwd(directory).quiet()
        return {
          directory,
        }
      },
    })

    const prior = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home.path
    try {
      await Instance.provide({
        directory: home.extra.directory,
        fn: async () => {
          seed("wrk_drafts", home.extra.directory)
          seed("wrk_other", home.extra.directory)

          const app = Server.App()
          const query = `?directory=${encodeURIComponent(home.extra.directory)}&workspace=wrk_drafts`

          const created = await app.request(`/workflow/drafts${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              source_kind: "user",
              integration_id: "test/default",
              adapter_id: "test",
              action_id: "message.send",
              target: "channel://general",
              payload_json: {
                text: "hello",
              },
              payload_schema_version: 1,
              actor_type: "user",
            }),
          })
          expect(created.status).toBe(200)
          const draft = (await created.json()) as { id: string; status: string }
          expect(draft.status).toBe("pending")

          const current = await app.request(`/workflow/drafts/${draft.id}${query}`, {
            method: "GET",
          })
          expect(current.status).toBe(200)

          const updated = await app.request(`/workflow/drafts/${draft.id}${query}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payload_json: {
                text: "edited",
              },
              actor_type: "user",
            }),
          })
          expect(updated.status).toBe(200)
          const patched = (await updated.json()) as { preview_text: string; status: string }
          expect(patched.status).toBe("pending")
          expect(patched.preview_text).toBe("Message channel://general: edited")

          const approved = await app.request(`/workflow/drafts/${draft.id}/approve${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              actor_type: "user",
            }),
          })
          expect(approved.status).toBe(200)
          const approved_body = (await approved.json()) as { status: string }
          expect(approved_body.status).toBe("approved")

          const sent = await app.request(`/workflow/drafts/${draft.id}/send${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              actor_type: "user",
            }),
          })
          expect(sent.status).toBe(200)
          const sent_body = (await sent.json()) as {
            status: string
            dispatch: { state: string; remote_reference: string | null } | null
          }
          expect(sent_body.status).toBe("sent")
          expect(sent_body.dispatch?.state).toBe("finalized")
          expect(RuntimeOutbound.Testing.writes().length).toBe(1)

          const rejected = await app.request(`/workflow/drafts${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              source_kind: "user",
              integration_id: "test/default",
              adapter_id: "test",
              action_id: "message.send",
              target: "channel://general",
              payload_json: {
                text: "reject me",
              },
              payload_schema_version: 1,
              actor_type: "user",
            }),
          })
          const rejected_draft = (await rejected.json()) as { id: string }
          const reject = await app.request(`/workflow/drafts/${rejected_draft.id}/reject${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              actor_type: "user",
            }),
          })
          expect(reject.status).toBe(200)
          const rejected_body = (await reject.json()) as { status: string }
          expect(rejected_body.status).toBe("rejected")

          const wrong = await app.request(
            `/workflow/drafts/${draft.id}?directory=${encodeURIComponent(home.extra.directory)}&workspace=wrk_other`,
            {
              method: "GET",
            },
          )
          expect(wrong.status).toBe(404)
        },
      })
    } finally {
      if (prior === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = prior
    }
  })

  test("draft send route dedupes retries and recovers remote-accepted attempts without duplicate writes", async () => {
    await using home = await tmpdir({
      init: async (root) => {
        const directory = path.join(root, "Documents", "origin")
        await mkdir(directory, { recursive: true })
        await $`git init`.cwd(directory).quiet()
        await $`git commit --allow-empty -m "root commit ${directory}"`.cwd(directory).quiet()
        return {
          directory,
        }
      },
    })

    const prior = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home.path
    try {
      await Instance.provide({
        directory: home.extra.directory,
        fn: async () => {
          seed("wrk_drafts", home.extra.directory)

          const app = Server.App()
          const query = `?directory=${encodeURIComponent(home.extra.directory)}&workspace=wrk_drafts`
          const control = {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              actor_type: "user",
            }),
          } as const

          const created = await app.request(`/workflow/drafts${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              source_kind: "user",
              integration_id: "test/default",
              adapter_id: "test",
              action_id: "message.send",
              target: "channel://general",
              payload_json: {
                text: "hello",
              },
              payload_schema_version: 1,
              actor_type: "user",
            }),
          })
          const draft = (await created.json()) as { id: string }

          const approved = await app.request(`/workflow/drafts/${draft.id}/approve${query}`, control)
          expect(approved.status).toBe(200)

          const send = () => app.request(`/workflow/drafts/${draft.id}/send${query}`, control)
          const [first, second] = await Promise.all([send(), send()])
          expect(first.status).toBe(200)
          expect(second.status).toBe(200)

          const first_body = (await first.json()) as {
            status: string
            dispatch: { id: string; idempotency_key: string } | null
          }
          const second_body = (await second.json()) as {
            status: string
            dispatch: { id: string; idempotency_key: string } | null
          }

          expect(first_body.status).toBe("sent")
          expect(second_body.status).toBe("sent")
          expect(second_body.dispatch?.id).toBe(first_body.dispatch?.id)
          expect(second_body.dispatch?.idempotency_key).toBe(first_body.dispatch?.idempotency_key)
          expect(RuntimeOutbound.Testing.writes().length).toBe(1)

          const replay = await send()
          expect(replay.status).toBe(200)
          const replay_body = (await replay.json()) as {
            status: string
            dispatch: { id: string } | null
          }
          expect(replay_body.status).toBe("sent")
          expect(replay_body.dispatch?.id).toBe(first_body.dispatch?.id)
          expect(RuntimeOutbound.Testing.writes().length).toBe(1)

          const recoverable = await app.request(`/workflow/drafts${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              source_kind: "user",
              integration_id: "test/default",
              adapter_id: "test",
              action_id: "message.send",
              target: "channel://general",
              payload_json: {
                text: "recover",
              },
              payload_schema_version: 1,
              actor_type: "user",
            }),
          })
          const recoverable_draft = (await recoverable.json()) as { id: string }

          const recoverable_approved = await app.request(`/workflow/drafts/${recoverable_draft.id}/approve${query}`, control)
          expect(recoverable_approved.status).toBe(200)

          RuntimeOutbound.Testing.set({
            crash_after_remote_accepted: true,
          })

          const failed = await app.request(`/workflow/drafts/${recoverable_draft.id}/send${query}`, control)
          expect(failed.status).toBe(500)

          const before = RuntimeDispatchAttempt.byDraft({
            draft_id: recoverable_draft.id,
          })
          expect(before?.state).toBe("remote_accepted")
          expect(RuntimeOutbound.Testing.writes().length).toBe(2)

          RuntimeOutbound.Testing.set({})

          const recovered = await app.request(`/workflow/drafts/${recoverable_draft.id}/send${query}`, control)
          expect(recovered.status).toBe(200)
          const recovered_body = (await recovered.json()) as {
            status: string
            dispatch: { id: string; idempotency_key: string } | null
          }
          expect(recovered_body.status).toBe("sent")
          expect(recovered_body.dispatch?.id).toBe(before?.id)
          expect(recovered_body.dispatch?.idempotency_key).toBe(before?.idempotency_key)
          expect(RuntimeOutbound.Testing.writes().length).toBe(2)
        },
      })
    } finally {
      if (prior === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = prior
    }
  })

  test("draft create rejects system_report and debug routes enforce workspace scoping", async () => {
    await using home = await tmpdir({
      init: async (root) => {
        const directory = path.join(root, "Documents", "origin")
        await mkdir(directory, { recursive: true })
        await $`git init`.cwd(directory).quiet()
        await $`git commit --allow-empty -m "root commit ${directory}"`.cwd(directory).quiet()
        return {
          directory,
        }
      },
    })

    const prior = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home.path
    try {
      await Instance.provide({
        directory: home.extra.directory,
        fn: async () => {
          seed("wrk_debug", home.extra.directory)
          seed("wrk_other", home.extra.directory)
          const run = integrating("wrk_debug", home.extra.directory)
          const app = Server.App()

          const draft = await app.request(
            `/workflow/drafts?directory=${encodeURIComponent(home.extra.directory)}&workspace=wrk_debug`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                source_kind: "system_report",
                integration_id: "system/default",
                adapter_id: "system",
                action_id: "report.dispatch",
                target: "system://developers",
                payload_json: {
                  report_type: "debug_reconciliation",
                  metadata: {
                    generated_at: 1,
                    reminder: {
                      threshold_ms: 1,
                      cadence_ms: 1,
                      hard_stop_ms: 2,
                    },
                    run: {
                      id: run.id,
                      workspace_id: "wrk_debug",
                      session_id: null,
                      workflow_id: null,
                      status: "integrating",
                      trigger_type: "manual",
                      created_at: 1,
                      updated_at: 1,
                      started_at: 1,
                      ready_for_integration_at: 1,
                      reason_code: null,
                      failure_code: null,
                      cleanup_failed: false,
                      changed_paths: [],
                    },
                  },
                },
                payload_schema_version: 1,
                actor_type: "user",
              }),
            },
          )

          expect(draft.status).toBe(400)
          expect(Database.use((db) => db.select().from(DraftTable).all())).toHaveLength(0)

          const preview = await app.request(
            `/workflow/debug/run/${run.id}/report-preview?directory=${encodeURIComponent(home.extra.directory)}&workspace=wrk_other`,
            {
              method: "GET",
            },
          )
          expect(preview.status).toBe(404)

          const keep = await app.request(
            `/workflow/debug/run/${run.id}/keep-running?directory=${encodeURIComponent(home.extra.directory)}&workspace=wrk_other`,
            {
              method: "POST",
            },
          )
          expect(keep.status).toBe(404)
        },
      })
    } finally {
      if (prior === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = prior
    }
  })

  test("debug report route requires consent and creates system report drafts for active runs", async () => {
    await using home = await tmpdir({
      init: async (root) => {
        const directory = path.join(root, "Documents", "origin")
        await mkdir(directory, { recursive: true })
        await $`git init`.cwd(directory).quiet()
        await $`git commit --allow-empty -m "root commit ${directory}"`.cwd(directory).quiet()
        return {
          directory,
        }
      },
    })

    const prior = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home.path
    try {
      await Instance.provide({
        directory: home.extra.directory,
        fn: async () => {
          seed("wrk_debug", home.extra.directory)
          const run = integrating("wrk_debug", home.extra.directory)
          const app = Server.App()
          const query = `?directory=${encodeURIComponent(home.extra.directory)}&workspace=wrk_debug`

          const rejected = await app.request(`/workflow/debug/run/${run.id}/report${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              consent: false,
            }),
          })
          expect(rejected.status).toBe(400)
          expect(Database.use((db) => db.select().from(DraftTable).all())).toHaveLength(0)
          expect(RuntimeOutbound.Testing.writes()).toEqual([])

          const rejectedField = await app.request(`/workflow/debug/run/${run.id}/report${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              consent: true,
              leak: true,
            }),
          })
          expect(rejectedField.status).toBe(400)
          expect(Database.use((db) => db.select().from(DraftTable).all())).toHaveLength(0)
          expect(RuntimeOutbound.Testing.writes()).toEqual([])

          const rejectedTarget = await app.request(`/workflow/debug/run/${run.id}/report${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              consent: true,
              target: "system://elsewhere",
            }),
          })
          expect(rejectedTarget.status).toBe(400)
          expect(Database.use((db) => db.select().from(DraftTable).all())).toHaveLength(0)
          expect(RuntimeOutbound.Testing.writes()).toEqual([])

          const preview = await app.request(`/workflow/debug/run/${run.id}/report-preview${query}`, {
            method: "GET",
          })
          expect(preview.status).toBe(200)
          const view = (await preview.json()) as {
            fields: Array<{ id: string; selected: boolean; required: boolean }>
          }
          expect(view.fields.map((item) => ({
            id: item.id,
            selected: item.selected,
            required: item.required,
          }))).toEqual([
            { id: "metadata", selected: true, required: true },
            { id: "prompt", selected: false, required: false },
            { id: "files", selected: false, required: false },
          ])

          const created = await app.request(`/workflow/debug/run/${run.id}/report${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              consent: true,
            }),
          })
          expect(created.status).toBe(200)
          const body = (await created.json()) as {
            run_status: string
            draft: {
              source_kind: string
              adapter_id: string
              action_id: string
              payload_json: Record<string, unknown>
            }
          }
          expect(body.run_status).toBe("cancel_requested")
          expect(body.draft.source_kind).toBe("system_report")
          expect(body.draft.adapter_id).toBe("system")
          expect(body.draft.action_id).toBe("report.dispatch")
          expect(body.draft.payload_json.prompt).toBeUndefined()
          expect(body.draft.payload_json.files).toBeUndefined()
          expect(Database.use((db) => db.select().from(IntegrationAttemptTable).all())).toHaveLength(0)
        },
      })
    } finally {
      if (prior === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = prior
    }
  })

  test("history routes reject malformed cursor input", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request(
          `/workflow/history/runs?directory=${encodeURIComponent(dir.path)}&cursor=bad_cursor`,
          {
            method: "GET",
          },
        )
        expect(response.status).toBe(400)
      },
    })
  })

  test("signal ingress rejects malformed bodies and missing workspace context", async () => {
    await using home = await tmpdir()
    const previous = process.env.OPENCODE_TEST_HOME
    const origin = path.join(home.path, "Documents", "origin")
    process.env.OPENCODE_TEST_HOME = home.path

    try {
      await write(
        origin,
        ".origin/workflows/incoming.yaml",
        [
          "schema_version: 1",
          "id: incoming",
          "name: Incoming",
          "trigger:",
          "  type: signal",
          "  signal: incoming",
          "instructions: run",
        ].join("\n"),
      )

      await Instance.provide({
        directory: origin,
        fn: async () => {
          seed("wrk_signal", origin)
          WorkflowManualRun.Testing.set(seams())
          WorkflowTriggerEngine.Testing.set({
            now: () => 1_000,
          })

          const app = Server.App()
          const base = `?directory=${encodeURIComponent(origin)}`

          const missing = await app.request(`/workflow/signals/incoming${base}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 2_000,
              payload_json: {
                ok: true,
              },
            }),
          })

          expect(missing.status).toBe(400)
          const missing_body = (await missing.json()) as {
            name: string
            data: { code: string }
          }
          expect(missing_body.name).toBe("RuntimeSignalIngressError")
          expect(missing_body.data.code).toBe("signal_workspace_required")

          const malformed = await app.request(`/workflow/signals/incoming${base}&workspace=wrk_signal`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: "bad",
              payload_json: [],
            }),
          })

          expect(malformed.status).toBe(400)
          const rows = Database.use((db) => db.select().from(RunTable).all())
          expect(rows).toHaveLength(0)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previous
    }
  })

  test("signal ingress remains non-runnable for deferred signal workflows", async () => {
    await using home = await tmpdir()
    const previous = process.env.OPENCODE_TEST_HOME
    const origin = path.join(home.path, "Documents", "origin")
    process.env.OPENCODE_TEST_HOME = home.path

    try {
      await write(
        origin,
        ".origin/workflows/a.yaml",
        [
          "schema_version: 1",
          "id: incoming_a",
          "name: Incoming A",
          "trigger:",
          "  type: signal",
          "  signal: incoming",
          "instructions: run",
        ].join("\n"),
      )
      await write(
        origin,
        ".origin/workflows/b.yaml",
        [
          "schema_version: 1",
          "id: incoming_b",
          "name: Incoming B",
          "trigger:",
          "  type: signal",
          "  signal: incoming",
          "instructions: run",
        ].join("\n"),
      )

      await Instance.provide({
        directory: origin,
        fn: async () => {
          seed("wrk_signal", origin)
          WorkflowManualRun.Testing.set(seams())
          WorkflowTriggerEngine.Testing.set({
            now: () => 1_000,
          })

          const app = Server.App()
          const query = `?directory=${encodeURIComponent(origin)}&workspace=wrk_signal`
          const first = await app.request(`/workflow/signals/incoming${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 2_000,
              provider_event_id: "evt_1",
              payload_json: {
                alpha: 1,
              },
            }),
          })

          expect(first.status).toBe(200)
          const first_body = (await first.json()) as {
            accepted: boolean
            duplicate: boolean
            reason: string | null
            run_ids: string[]
          }
          expect(first_body.accepted).toBe(false)
          expect(first_body.duplicate).toBe(false)
          expect(first_body.reason).toBe("signal_unregistered")
          expect(first_body.run_ids).toHaveLength(0)

          const duplicate = await app.request(`/workflow/signals/incoming${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 2_000,
              provider_event_id: "evt_1",
              payload_json: {
                alpha: 2,
              },
            }),
          })

          expect(duplicate.status).toBe(200)
          const duplicate_body = (await duplicate.json()) as {
            accepted: boolean
            duplicate: boolean
            reason: string | null
            run_ids: string[]
          }
          expect(duplicate_body.accepted).toBe(false)
          expect(duplicate_body.duplicate).toBe(false)
          expect(duplicate_body.reason).toBe("signal_unregistered")
          expect(duplicate_body.run_ids).toHaveLength(0)

          const rows = Database.use((db) => db.select().from(RunTable).all())
          expect(rows).toHaveLength(0)

          const sessions_after = Database.use((db) => db.select().from(SessionTable).all())
          expect(sessions_after).toHaveLength(0)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previous
    }
  })

  test("signal ingress returns deferred-signal outcomes deterministically", async () => {
    await using home = await tmpdir()
    const previous = process.env.OPENCODE_TEST_HOME
    const origin = path.join(home.path, "Documents", "origin")
    process.env.OPENCODE_TEST_HOME = home.path

    try {
      await write(
        origin,
        ".origin/workflows/incoming.yaml",
        [
          "schema_version: 1",
          "id: incoming",
          "name: Incoming",
          "trigger:",
          "  type: signal",
          "  signal: incoming",
          "instructions: run",
        ].join("\n"),
      )

      await Instance.provide({
        directory: origin,
        fn: async () => {
          seed("wrk_signal", origin)
          WorkflowManualRun.Testing.set(seams())
          WorkflowTriggerEngine.Testing.set({
            now: () => 5_000,
          })

          const app = Server.App()
          const query = `?directory=${encodeURIComponent(origin)}&workspace=wrk_signal`

          const first = await app.request(`/workflow/signals/incoming${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 6_000,
              payload_json: {
                b: 2,
                a: 1,
              },
            }),
          })

          expect(first.status).toBe(200)
          const first_body = (await first.json()) as {
            accepted: boolean
            duplicate: boolean
            reason: string | null
            run_ids: string[]
          }
          expect(first_body.accepted).toBe(false)
          expect(first_body.duplicate).toBe(false)
          expect(first_body.reason).toBe("signal_unregistered")
          expect(first_body.run_ids).toHaveLength(0)

          const duplicate = await app.request(`/workflow/signals/incoming${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 6_000,
              payload_json: {
                a: 1,
                b: 2,
              },
            }),
          })

          expect(duplicate.status).toBe(200)
          const duplicate_body = (await duplicate.json()) as {
            accepted: boolean
            duplicate: boolean
            reason: string | null
            run_ids: string[]
          }
          expect(duplicate_body.accepted).toBe(false)
          expect(duplicate_body.duplicate).toBe(false)
          expect(duplicate_body.reason).toBe("signal_unregistered")
          expect(duplicate_body.run_ids).toHaveLength(0)

          const boundary = await app.request(`/workflow/signals/incoming${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 5_000,
              payload_json: {
                a: 1,
              },
            }),
          })

          expect(boundary.status).toBe(200)
          expect(await boundary.json()).toEqual({
            accepted: false,
            duplicate: false,
            reason: "signal_unregistered",
            run_ids: [],
          })

          const unknown = await app.request(`/workflow/signals/other${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 6_000,
              payload_json: {
                ok: true,
              },
            }),
          })

          expect(unknown.status).toBe(200)
          expect(await unknown.json()).toEqual({
            accepted: false,
            duplicate: false,
            reason: "signal_unregistered",
            run_ids: [],
          })
        },
      })

      await using dir = await tmpdir()
      await write(
        dir.path,
        ".origin/workflows/incoming.yaml",
        [
          "schema_version: 1",
          "id: incoming",
          "name: Incoming",
          "trigger:",
          "  type: signal",
          "  signal: incoming",
          "instructions: run",
        ].join("\n"),
      )

      await Instance.provide({
        directory: dir.path,
        fn: async () => {
          seed("wrk_standard", dir.path)
          WorkflowManualRun.Testing.set(seams())
          WorkflowTriggerEngine.Testing.set({
            now: () => 5_000,
          })

          const app = Server.App()
          const query = `?directory=${encodeURIComponent(dir.path)}&workspace=wrk_standard`
          const blocked = await app.request(`/workflow/signals/incoming${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_time: 6_000,
              payload_json: {
                ok: true,
              },
            }),
          })

          expect(blocked.status).toBe(200)
          expect(await blocked.json()).toEqual({
            accepted: false,
            duplicate: false,
            reason: "workspace_policy_blocked",
            run_ids: [],
          })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previous
    }
  })
})
