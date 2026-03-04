import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Auth } from "@/auth"
import { Filesystem } from "@/util/filesystem"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { ConfigPaths } from "../../config/paths"
import { Global } from "../../global"
import { mergeDeep } from "remeda"
import path from "path"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

const OpenCodeImportSummary = z.object({
  status: z.enum(["ok", "noop"]),
  message: z.string(),
  config: z.object({
    source: z.string().nullable(),
    imported: z.number().int(),
    skipped: z.number().int(),
    invalid: z.number().int(),
  }),
  auth: z.object({
    source: z.string().nullable(),
    imported: z.number().int(),
    skipped: z.number().int(),
    invalid: z.number().int(),
  }),
})

const toRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const toList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined

const normalizeProviderID = (value: string) => value.replace(/\/+$/, "")

async function readOpenCodeConfig() {
  const root = Global.namespacePath("opencode")
  const files = ConfigPaths.fileInDirectory(root.config, "opencode")
  let source: string | null = null
  let invalid = 0
  let merged: Record<string, unknown> = {}

  for (const file of files) {
    const text = await ConfigPaths.readFile(file)
    if (!text) continue

    source = file
    const parsed = await ConfigPaths.parseText(text, file, "empty").catch(() => undefined)
    if (!parsed) {
      invalid += 1
      continue
    }

    const object = toRecord(parsed)
    if (!object) {
      invalid += 1
      continue
    }

    merged = mergeDeep(merged, object)
  }

  return {
    source,
    invalid,
    provider: toRecord(merged.provider) ?? {},
    disabled: toList(merged.disabled_providers) ?? [],
    enabled: toList(merged.enabled_providers) ?? [],
  }
}

async function readOpenCodeAuth() {
  const root = Global.namespacePath("opencode")
  const source = path.join(root.data, "auth.json")
  const text = await Filesystem.readText(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return
    throw error
  })
  if (!text) {
    return {
      source: null as string | null,
      invalid: 0,
      auth: {} as Record<string, Auth.Info>,
    }
  }

  const raw = toRecord(
    (() => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        return
      }
    })(),
  )
  if (!raw) {
    return {
      source,
      invalid: 1,
      auth: {} as Record<string, Auth.Info>,
    }
  }

  const auth: Record<string, Auth.Info> = {}
  let invalid = 0
  for (const [providerID, value] of Object.entries(raw)) {
    const key = normalizeProviderID(providerID)
    if (!key) {
      invalid += 1
      continue
    }
    const parsed = Auth.Info.safeParse(value)
    if (!parsed.success) {
      invalid += 1
      continue
    }
    auth[key] = parsed.data
  }

  return { source, invalid, auth }
}

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the OpenCode server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: Installation.VERSION })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the OpenCode system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({
            data: JSON.stringify({
              payload: {
                type: "server.connected",
                properties: {},
              },
            }),
          })
          async function handler(event: any) {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 10s to prevent stalled proxy streams.
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                payload: {
                  type: "server.heartbeat",
                  properties: {},
                },
              }),
            })
          }, 10_000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global OpenCode configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.getGlobal())
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global OpenCode configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        const next = await Config.updateGlobal(config)
        return c.json(next)
      },
    )
    .post(
      "/import/opencode/providers",
      describeRoute({
        summary: "Import OpenCode providers and auth",
        description: "Load provider config and auth from OpenCode namespace into Origin without overwriting existing auth.",
        operationId: "global.import.opencode.providers",
        responses: {
          200: {
            description: "Import summary",
            content: {
              "application/json": {
                schema: resolver(OpenCodeImportSummary),
              },
            },
          },
        },
      }),
      async (c) => {
        const [configSource, authSource] = await Promise.all([readOpenCodeConfig(), readOpenCodeAuth()])
        const currentConfig = await Config.getGlobal()
        const currentAuth = await Auth.all()

        const importedProvider: Record<string, Config.Provider> = {}
        let configInvalid = configSource.invalid
        let configSkipped = 0
        for (const [providerID, value] of Object.entries(configSource.provider)) {
          if (!providerID) {
            configInvalid += 1
            continue
          }
          if (currentConfig.provider?.[providerID]) {
            configSkipped += 1
            continue
          }
          const parsed = Config.Provider.safeParse(value)
          if (!parsed.success) {
            configInvalid += 1
            continue
          }
          importedProvider[providerID] = parsed.data
        }

        const importedProviders = Object.keys(importedProvider).length
        let disabledAdded = 0
        let enabledAdded = 0
        if (importedProviders > 0 || configSource.disabled.length > 0 || configSource.enabled.length > 0) {
          const patch: Config.Info = {}
          if (importedProviders > 0) patch.provider = importedProvider as Config.Info["provider"]
          if (configSource.disabled.length > 0) {
            const values = [...new Set([...(currentConfig.disabled_providers ?? []), ...configSource.disabled])]
            disabledAdded = values.length - (currentConfig.disabled_providers?.length ?? 0)
            patch.disabled_providers = values
          }
          if (configSource.enabled.length > 0) {
            const values = [...new Set([...(currentConfig.enabled_providers ?? []), ...configSource.enabled])]
            enabledAdded = values.length - (currentConfig.enabled_providers?.length ?? 0)
            patch.enabled_providers = values
          }
          await Config.updateGlobal(patch)
        }

        let authImported = 0
        let authSkipped = 0
        for (const [providerID, info] of Object.entries(authSource.auth)) {
          if (currentAuth[providerID] || currentAuth[providerID + "/"]) {
            authSkipped += 1
            continue
          }
          await Auth.set(providerID, info)
          authImported += 1
        }

        const imported = importedProviders + authImported + disabledAdded + enabledAdded
        const missingSource = !configSource.source && !authSource.source
        const invalidSource = configInvalid + authSource.invalid > 0
        const summary = {
          config: {
            source: configSource.source,
            imported: importedProviders,
            skipped: configSkipped,
            invalid: configInvalid,
          },
          auth: {
            source: authSource.source,
            imported: authImported,
            skipped: authSkipped,
            invalid: authSource.invalid,
          },
        }

        if (missingSource) {
          return c.json({
            status: "noop",
            message: "OpenCode import source was not found.",
            ...summary,
          })
        }

        if (imported === 0 && invalidSource) {
          return c.json({
            status: "noop",
            message: "OpenCode import source is invalid.",
            ...summary,
          })
        }

        if (imported === 0) {
          return c.json({
            status: "noop",
            message: "No OpenCode provider settings were imported.",
            ...summary,
          })
        }

        return c.json({
          status: "ok",
          message: invalidSource
            ? "OpenCode provider settings imported with invalid entries skipped."
            : "OpenCode provider settings imported.",
          ...summary,
        })
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    ),
)
