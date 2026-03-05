import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { GlobalBus } from "../../src/bus/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

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
})
