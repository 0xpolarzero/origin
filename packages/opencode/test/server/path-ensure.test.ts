import { describe, expect, test } from "bun:test"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("path.ensure endpoint", () => {
  test("creates missing directories recursively and returns an absolute path", async () => {
    await using tmp = await tmpdir({ git: true })
    const input = path.join(tmp.path, "nested", "workspace")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/path/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: input }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { ok: true; path: string }
        expect(body.ok).toBe(true)
        expect(path.isAbsolute(body.path)).toBe(true)

        const info = await stat(body.path)
        expect(info.isDirectory()).toBe(true)
      },
    })
  })

  test("returns a structured error when ensure fails", async () => {
    await using tmp = await tmpdir({ git: true })
    const blocked = path.join(tmp.path, "file-blocker")
    await Bun.write(blocked, "no-directory")
    await mkdir(path.join(tmp.path, "nested"), { recursive: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/path/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: blocked }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { ok: false; path: string; code: string; message: string }
        expect(body.ok).toBe(false)
        expect(body.path).toBe(path.resolve(blocked))
        expect(body.code.length).toBeGreaterThan(0)
        expect(body.message.length).toBeGreaterThan(0)
      },
    })
  })
})
