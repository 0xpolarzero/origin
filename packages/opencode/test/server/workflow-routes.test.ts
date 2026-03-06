import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { GlobalBus } from "../../src/bus/global"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { JJ } from "../../src/project/jj"
import { Instance } from "../../src/project/instance"
import { RunTable } from "../../src/runtime/runtime.sql"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { WorkflowManualRun } from "../../src/workflow/manual-run"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

type ExecuteItem = {
  abort: AbortSignal
}

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

function seams(input?: { execute?: (item: ExecuteItem) => Promise<void> }) {
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
        expect(body.data.code).toBe("resource_missing")
        expect(body.data.path).toBe("$.resources[0].id")
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

  test("manual run start route requires workspace context", async () => {
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
            execute: async () => {
              await hold
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
            execute: async () => {
              await hold
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
})
