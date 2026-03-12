import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("workspace routes", () => {
  test("legacy attach route registers the current directory without deleting it", async () => {
    await using dir = await tmpdir({ git: true })

    const app = Server.App()
    const query = `?directory=${encodeURIComponent(dir.path)}`

    const created = await app.request(`/experimental/workspace/wrk_local${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch: null,
        config: {
          type: "worktree",
          directory: dir.path,
        },
      }),
    })
    expect(created.status).toBe(200)

    const body = (await created.json()) as {
      id: string
      type: string
      branch: string | null
      name: string | null
      directory: string | null
      extra: unknown
    }
    expect(body.id).toBe("wrk_local")
    expect(body.type).toBe("worktree")
    expect(body.directory).toBe(dir.path)
    expect(typeof body.name).toBe("string")
    expect(typeof body.branch === "string" || body.branch === null).toBe(true)
    expect(body.extra).toEqual({
      local: true,
      directory: dir.path,
    })

    const listed = await app.request(`/experimental/workspace${query}`)
    expect(listed.status).toBe(200)
    const rows = (await listed.json()) as Array<{
      id: string
      type: string
      branch: string | null
      name: string | null
      directory: string | null
      extra: unknown
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("wrk_local")
    expect(rows[0]?.type).toBe("worktree")
    expect(rows[0]?.directory).toBe(dir.path)
    expect(typeof rows[0]?.name).toBe("string")
    expect(typeof rows[0]?.branch === "string" || rows[0]?.branch === null).toBe(true)
    expect(rows[0]?.extra).toEqual({
      local: true,
      directory: dir.path,
    })

    const removed = await app.request(`/experimental/workspace/wrk_local${query}`, {
      method: "DELETE",
    })
    expect(removed.status).toBe(200)
    expect(await stat(dir.path).then(() => true)).toBe(true)
  })
})
