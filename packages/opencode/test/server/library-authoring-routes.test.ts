import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

function prompt(id = "lib.review", text = "Review release notes.") {
  return [
    "schema_version: 1",
    `id: ${id}`,
    "name: Review Prompt",
    "kind: prompt_template",
    "template: |",
    `  ${text}`,
  ].join("\n")
}

function workflow(item_id = "lib.review") {
  return [
    "schema_version: 2",
    "id: basic",
    "name: Basic",
    "trigger:",
    "  type: manual",
    "resources:",
    "  - id: review_prompt",
    "    source: library",
    "    kind: prompt_template",
    `    item_id: ${item_id}`,
    "steps:",
    "  - id: ask",
    "    kind: agent_request",
    "    title: Ask",
    "    prompt:",
    "      source: resource",
    "      resource_id: review_prompt",
    "  - id: done",
    "    kind: end",
    "    title: Done",
    "    result: success",
  ].join("\n")
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("library authoring routes", () => {
  test("detail/save/history expose canonical content and used-by links", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/library/review.yaml", prompt())
    await write(dir.path, ".origin/workflows/basic.yaml", workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`

        const list = await app.request(`/library${query}`, {
          method: "GET",
        })
        expect(list.status).toBe(200)
        const rows = (await list.json()) as Array<{
          id: string
          used_by: string[]
        }>
        expect(rows.find((item) => item.id === "lib.review")?.used_by).toEqual(["basic"])

        const detail = await app.request(`/library/items/lib.review${query}`, {
          method: "GET",
        })
        expect(detail.status).toBe(200)
        const body = (await detail.json()) as {
          canonical_text: string
          item: { used_by: string[] }
          used_by: Array<{ workflow_id: string }>
        }
        expect(body.canonical_text).toContain("Review release notes.")
        expect(body.item.used_by).toEqual(["basic"])
        expect(body.used_by.map((item) => item.workflow_id)).toEqual(["basic"])

        const save = await app.request(`/library/items/lib.review${query}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: prompt("lib.review", "Updated release notes."),
          }),
        })
        expect(save.status).toBe(200)
        expect(await Bun.file(path.join(dir.path, ".origin/library/review.yaml")).text()).toContain("Updated release notes.")

        const history = await app.request(`/library/items/lib.review/history${query}`, {
          method: "GET",
        })
        expect(history.status).toBe(200)
        const page = (await history.json()) as {
          items: Array<{
            revision: { canonical_text: string }
            previous_revision: { canonical_text: string } | null
            diff: string
          }>
        }
        expect(page.items).toHaveLength(2)
        expect(page.items[0]?.revision.canonical_text).toContain("Updated release notes.")
        expect(page.items[0]?.previous_revision?.canonical_text).toContain("Review release notes.")
        expect(page.items[0]?.diff).toContain("Updated release notes.")
      },
    })
  })

  test("copy route creates workflow-local copies and rewrites workflow resources", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/library/review.yaml", prompt())
    await write(dir.path, ".origin/workflows/basic.yaml", workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`

        const copy = await app.request(`/library/items/lib.review/copy${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: "basic",
          }),
        })
        expect(copy.status).toBe(200)
        const body = (await copy.json()) as {
          workflow_id: string
          resources: Array<{ id: string; path: string }>
        }
        expect(body.workflow_id).toBe("basic")
        expect(body.resources).toEqual([
          {
            id: "review_prompt",
            path: "resources/review-prompt.txt",
          },
        ])

        expect(await Bun.file(path.join(dir.path, ".origin/workflows/basic.yaml")).text()).toContain("source: local")
        expect(await Bun.file(path.join(dir.path, ".origin/workflows/basic.yaml")).text()).toContain("path: resources/review-prompt.txt")
        expect(await Bun.file(path.join(dir.path, ".origin/workflows/basic/resources/review-prompt.txt")).text()).toContain(
          "Review release notes.",
        )
      },
    })
  })

  test("delete route blocks in-use items and removes unused ones", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/library/review.yaml", prompt())
    await write(dir.path, ".origin/library/unused.yaml", prompt("lib.unused", "Unused"))
    await write(dir.path, ".origin/workflows/basic.yaml", workflow())

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const app = Server.App()
        const query = `?directory=${encodeURIComponent(dir.path)}`

        const blocked = await app.request(`/library/items/lib.review${query}`, {
          method: "DELETE",
        })
        expect(blocked.status).toBe(409)
        expect(await blocked.text()).toContain("Library item is still used by: basic")

        const removed = await app.request(`/library/items/lib.unused${query}`, {
          method: "DELETE",
        })
        expect(removed.status).toBe(200)
        expect(await Bun.file(path.join(dir.path, ".origin/library/unused.yaml")).exists()).toBe(false)
      },
    })
  })
})
