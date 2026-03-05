import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Lock } from "@/util/lock"

const mode = z.enum(["interactive", "cron", "signal"])
const action = z.enum(["replace", "create_copy", "cancel"])

const input = z
  .object({
    directory: z.string(),
    path: z.string().min(1),
    content: z.string(),
    mode: mode.default("interactive"),
    action: action.optional(),
  })
  .strict()

export const notification = z
  .object({
    code: z.literal("knowledge_base_collision"),
    mode,
    action,
    forced: z.boolean(),
    requested_path: z.string(),
    resolved_path: z.string().nullable(),
  })
  .strict()

export const result = z
  .object({
    status: z.enum(["created", "replaced", "created_copy", "canceled"]),
    requested_path: z.string(),
    resolved_path: z.string().nullable(),
    collision: z.boolean(),
    notification: notification.optional(),
  })
  .strict()

export type ImportResult = z.infer<typeof result>

function normalize(value: string) {
  const normalized = path.posix
    .normalize(value.replaceAll("\\", "/"))
    .replace(/^\/+/, "")

  if (!normalized || normalized === ".") return
  if (normalized.startsWith("../") || normalized === "..") return
  return normalized
}

function map_key(value: string) {
  return normalize(value)?.toLocaleLowerCase("en-US")
}

async function files(root: string) {
  const out = new Map<string, string>()

  async function walk(prefix: string) {
    const base = prefix ? path.join(root, prefix) : root
    const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        const relative = prefix
          ? path.posix.join(prefix.split(path.sep).join(path.posix.sep), entry.name)
          : entry.name

        if (entry.isDirectory()) {
          await walk(relative)
          return
        }

        if (!entry.isFile()) return
        const key = map_key(relative)
        if (!key) return
        out.set(key, relative)
      }),
    )
  }

  await walk("")
  return out
}

function copy_name(value: string, index: number) {
  const ext = path.posix.extname(value)
  const dir = path.posix.dirname(value)
  const base = path.posix.basename(value, ext)
  const label = index === 1 ? `${base} (copy)` : `${base} (copy ${index})`
  const file = `${label}${ext}`
  if (!dir || dir === ".") return file
  return path.posix.join(dir, file)
}

function copy_target(value: string, index: Map<string, string>) {
  let i = 1
  while (true) {
    const candidate = copy_name(value, i)
    const key = map_key(candidate)
    if (!key || index.has(key)) {
      i += 1
      continue
    }
    return candidate
  }
}

async function write(root: string, relative: string, content: string) {
  const absolute = path.join(root, ...relative.split(path.posix.sep))
  await mkdir(path.dirname(absolute), { recursive: true })
  await Bun.write(absolute, content)
}

function notify(input: {
  mode: z.infer<typeof mode>
  action: z.infer<typeof action>
  forced: boolean
  requested_path: string
  resolved_path: string | null
}) {
  return notification.parse({
    code: "knowledge_base_collision",
    mode: input.mode,
    action: input.action,
    forced: input.forced,
    requested_path: input.requested_path,
    resolved_path: input.resolved_path,
  })
}

export namespace WorkflowKnowledge {
  export const Input = input
  export const Result = result

  export async function import_file(value: z.input<typeof Input>): Promise<ImportResult> {
    const parsed = Input.parse(value)
    const relative = normalize(parsed.path)
    if (!relative) {
      return Result.parse({
        status: "canceled",
        requested_path: parsed.path,
        resolved_path: null,
        collision: false,
      })
    }

    const root = path.join(parsed.directory, ".origin", "knowledge-base")
    await using _lock = await Lock.write(root)
    const index = await files(root)
    const requested = map_key(relative)
    if (!requested) {
      return Result.parse({
        status: "canceled",
        requested_path: parsed.path,
        resolved_path: null,
        collision: false,
      })
    }

    const existing = index.get(requested)
    if (!existing) {
      await write(root, relative, parsed.content)
      return Result.parse({
        status: "created",
        requested_path: relative,
        resolved_path: relative,
        collision: false,
      })
    }

    if (parsed.mode !== "interactive") {
      const next = copy_target(existing, index)
      await write(root, next, parsed.content)
      return Result.parse({
        status: "created_copy",
        requested_path: relative,
        resolved_path: next,
        collision: true,
        notification: notify({
          mode: parsed.mode,
          action: "create_copy",
          forced: true,
          requested_path: relative,
          resolved_path: next,
        }),
      })
    }

    const resolution = parsed.action ?? "cancel"
    if (resolution === "cancel") {
      return Result.parse({
        status: "canceled",
        requested_path: relative,
        resolved_path: null,
        collision: true,
        notification: notify({
          mode: parsed.mode,
          action: resolution,
          forced: false,
          requested_path: relative,
          resolved_path: null,
        }),
      })
    }

    if (resolution === "replace") {
      await write(root, existing, parsed.content)
      return Result.parse({
        status: "replaced",
        requested_path: relative,
        resolved_path: existing,
        collision: true,
        notification: notify({
          mode: parsed.mode,
          action: resolution,
          forced: false,
          requested_path: relative,
          resolved_path: existing,
        }),
      })
    }

    const next = copy_target(existing, index)
    await write(root, next, parsed.content)
    return Result.parse({
      status: "created_copy",
      requested_path: relative,
      resolved_path: next,
      collision: true,
      notification: notify({
        mode: parsed.mode,
        action: resolution,
        forced: false,
        requested_path: relative,
        resolved_path: next,
      }),
    })
  }
}
