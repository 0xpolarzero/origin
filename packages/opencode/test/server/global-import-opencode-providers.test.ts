import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { ConfigPaths } from "../../src/config/paths"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

type OpenCodeImportSummary = {
  status: "ok" | "noop"
  message: string
  config: {
    source: string | null
    imported: number
    skipped: number
    invalid: number
  }
  auth: {
    source: string | null
    imported: number
    skipped: number
    invalid: number
  }
}

type OriginSnapshot = {
  config: Record<string, string | null>
  auth: string | null
}

const opencodeRoot = Global.namespacePath("opencode")
const opencodeConfigFiles = ConfigPaths.fileInDirectory(opencodeRoot.config, "opencode")
const opencodeAuthFile = path.join(opencodeRoot.data, "auth.json")
const originConfigFiles = ConfigPaths.fileInDirectory(Global.Path.config, "opencode")
const originAuthFile = path.join(Global.Path.data, "auth.json")

const requestImport = async () => {
  const app = Server.App()
  const response = await app.request("/global/import/opencode/providers", {
    method: "POST",
  })
  expect(response.status).toBe(200)
  return (await response.json()) as OpenCodeImportSummary
}

const clearOpenCodeSources = async () => {
  await Promise.all([
    ...opencodeConfigFiles.map((file) => rm(file, { force: true }).catch(() => undefined)),
    rm(opencodeAuthFile, { force: true }).catch(() => undefined),
  ])
}

const clearOriginSources = async () => {
  await Promise.all([
    ...originConfigFiles.map((file) => rm(file, { force: true }).catch(() => undefined)),
    rm(originAuthFile, { force: true }).catch(() => undefined),
  ])
  Config.global.reset()
}

const captureOriginSources = async (): Promise<OriginSnapshot> => {
  const config = await Promise.all(
    originConfigFiles.map(async (file) => [file, await Filesystem.readText(file).catch(() => null)] as const),
  )
  const auth = await Filesystem.readText(originAuthFile).catch(() => null)
  return {
    config: Object.fromEntries(config),
    auth,
  }
}

const restoreOriginSources = async (snapshot: OriginSnapshot) => {
  await Promise.all(
    originConfigFiles.map(async (file) => {
      const content = snapshot.config[file] ?? null
      if (content === null) {
        await rm(file, { force: true }).catch(() => undefined)
        return
      }
      await mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, content)
    }),
  )

  if (snapshot.auth === null) {
    await rm(originAuthFile, { force: true }).catch(() => undefined)
    Config.global.reset()
    return
  }

  await mkdir(path.dirname(originAuthFile), { recursive: true })
  await Bun.write(originAuthFile, snapshot.auth)
  Config.global.reset()
}

const writeOpenCodeConfig = async (value: unknown) => {
  const file = opencodeConfigFiles[1]
  if (!file) throw new Error("OpenCode config path not found")
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(value))
  return file
}

const writeOpenCodeAuth = async (text: string) => {
  await mkdir(path.dirname(opencodeAuthFile), { recursive: true })
  await Bun.write(opencodeAuthFile, text)
}

describe("global.import.opencode.providers", () => {
  let snapshot: OriginSnapshot

  beforeEach(async () => {
    snapshot = await captureOriginSources()
    await Promise.all([clearOpenCodeSources(), clearOriginSources()])
  })

  afterEach(async () => {
    await Promise.all([clearOpenCodeSources(), restoreOriginSources(snapshot)])
  })

  test("imports OpenCode providers/auth without overwriting existing Origin auth", async () => {
    await using tmp = await tmpdir({ git: true })
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const existing = `w2-existing-${stamp}`
    const incoming = `w2-incoming-${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.updateGlobal({
          provider: {
            [existing]: { name: "origin-existing-provider" },
          },
        })
        await Auth.set(existing, { type: "api", key: "origin-auth-value" })

        const configPath = await writeOpenCodeConfig({
          provider: {
            [existing]: { name: "opencode-existing-provider" },
            [incoming]: { name: "opencode-incoming-provider" },
          },
          disabled_providers: [incoming],
          enabled_providers: [existing],
        })
        await writeOpenCodeAuth(
          JSON.stringify({
            [existing]: { type: "api", key: "opencode-auth-value" },
            [incoming]: { type: "api", key: "opencode-new-auth" },
          }),
        )

        const result = await requestImport()
        expect(result.status).toBe("ok")
        expect(result.message).toBe("OpenCode provider settings imported.")
        expect(result.config.source).toBe(configPath)
        expect(result.config.imported).toBe(1)
        expect(result.config.skipped).toBe(1)
        expect(result.config.invalid).toBe(0)
        expect(result.auth.source).toBe(opencodeAuthFile)
        expect(result.auth.imported).toBe(1)
        expect(result.auth.skipped).toBe(1)
        expect(result.auth.invalid).toBe(0)

        const auth = await Auth.all()
        expect(auth[existing]).toEqual({ type: "api", key: "origin-auth-value" })
        expect(auth[incoming]).toEqual({ type: "api", key: "opencode-new-auth" })

        const global = await Config.getGlobal()
        expect(global.provider?.[existing]).toBeDefined()
        expect(global.provider?.[incoming]).toBeDefined()
        expect(global.disabled_providers).toContain(incoming)
        expect(global.enabled_providers).toContain(existing)
      },
    })
  }, 30000)

  test("returns noop with explicit feedback when OpenCode sources are missing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await requestImport()
        expect(result.status).toBe("noop")
        expect(result.message).toBe("OpenCode import source was not found.")
        expect(result.config.source).toBeNull()
        expect(result.auth.source).toBeNull()
        expect(result.config.imported).toBe(0)
        expect(result.auth.imported).toBe(0)
      },
    })
  }, 30000)

  test("returns noop with explicit feedback when OpenCode sources are invalid", async () => {
    await using tmp = await tmpdir({ git: true })
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const target = `w2-invalid-${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.updateGlobal({
          provider: {
            [target]: { name: "origin-preserved-provider" },
          },
        })
        await Auth.set(target, { type: "api", key: "origin-preserved-auth" })

        const configPath = opencodeConfigFiles[1]
        if (!configPath) throw new Error("OpenCode config path not found")
        await mkdir(path.dirname(configPath), { recursive: true })
        await Bun.write(configPath, "{")
        await writeOpenCodeAuth("{bad")

        const result = await requestImport()
        expect(result.status).toBe("noop")
        expect(result.message).toBe("OpenCode import source is invalid.")
        expect(result.config.source).toBe(configPath)
        expect(result.auth.source).toBe(opencodeAuthFile)
        expect(result.config.invalid).toBe(1)
        expect(result.auth.invalid).toBe(1)
        expect(result.config.imported).toBe(0)
        expect(result.auth.imported).toBe(0)

        const auth = await Auth.all()
        expect(auth[target]).toEqual({ type: "api", key: "origin-preserved-auth" })
        const global = await Config.getGlobal()
        expect(global.provider?.[target]).toEqual(
          expect.objectContaining({
            name: "origin-preserved-provider",
          }),
        )
      },
    })
  }, 30000)

  test("does not overwrite existing auth when OpenCode key normalizes to the same provider", async () => {
    await using tmp = await tmpdir({ git: true })
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const provider = `w2-slash-${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(provider, { type: "api", key: "origin-auth-value" })
        await writeOpenCodeAuth(
          JSON.stringify({
            [`${provider}/`]: { type: "api", key: "opencode-auth-value" },
          }),
        )

        const result = await requestImport()
        expect(result.status).toBe("noop")
        expect(result.message).toBe("No OpenCode provider settings were imported.")
        expect(result.auth.imported).toBe(0)
        expect(result.auth.skipped).toBe(1)

        const auth = await Auth.all()
        expect(auth[provider]).toEqual({ type: "api", key: "origin-auth-value" })
      },
    })
  }, 30000)

  test("skips invalid provider entries and imports valid ones", async () => {
    await using tmp = await tmpdir({ git: true })
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const valid = `w2-valid-${stamp}`
    const invalid = `w2-invalid-provider-${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await writeOpenCodeConfig({
          provider: {
            [valid]: { name: "valid-provider" },
            [invalid]: "bad-provider-entry",
          },
        })

        const result = await requestImport()
        expect(result.status).toBe("ok")
        expect(result.message).toBe("OpenCode provider settings imported with invalid entries skipped.")
        expect(result.config.imported).toBe(1)
        expect(result.config.invalid).toBe(1)

        const global = await Config.getGlobal()
        expect(global.provider?.[valid]).toBeDefined()
        expect(global.provider?.[invalid]).toBeUndefined()
      },
    })
  }, 30000)
})
