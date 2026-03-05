import { NamedError } from "@opencode-ai/util/error"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { jj, type JJResult } from "@/util/jj"

export namespace JJ {
  const read_safe = new Set(["log", "status", "diff", "show"])

  export const ReadPolicyError = NamedError.create(
    "JJReadPolicyError",
    z.object({
      code: z.literal("read_policy_unsupported"),
      command: z.string(),
      message: z.string(),
    }),
  )

  export type TelemetryLevel = "info" | "warning" | "error"

  export interface TelemetryEvent {
    name: string
    level: TelemetryLevel
    retry: boolean
    tags: Record<string, string>
  }

  export interface CommandResult {
    ok: boolean
    phase: "bootstrap" | "read" | "mutate"
    command: string[]
    exit_code: number
    stdout: string
    stderr: string
    stderr_class: "none" | "missing" | "other"
    telemetry: TelemetryEvent
  }

  export interface BootstrapResult {
    mode: "existing" | "colocated-init" | "fresh-init"
    ok: boolean
    command?: string[]
    result?: CommandResult
    telemetry: TelemetryEvent
  }

  export type LifecycleStatus = "success" | "warning" | "error"

  export interface StepResult {
    status: LifecycleStatus
    missing: boolean
    retry: boolean
    message?: string
    command?: string[]
    exit_code?: number
    stderr?: string
    stderr_class: "none" | "missing" | "other"
    telemetry: TelemetryEvent
  }

  export interface CreateWorkspaceResult {
    run_id: string
    name: string
    root: string
    directory: string
    status: LifecycleStatus
    command: string[]
    result?: CommandResult
    telemetry: TelemetryEvent
  }

  export interface CleanupResult {
    run_id: string
    name: string
    directory: string
    status: LifecycleStatus
    retry: boolean
    forget: StepResult
    remove: StepResult
    telemetry: TelemetryEvent
  }

  export interface Adapter {
    bootstrap(): Promise<BootstrapResult>
    read(args: string[], cwd?: string): Promise<CommandResult>
    mutate(args: string[], cwd?: string): Promise<CommandResult>
    workspace: {
      name(run_id: string): string
      path(run_id: string, root?: string): string
      create(run_id: string, input?: { root?: string; directory?: string }): Promise<CreateWorkspaceResult>
      forget(run_id: string, input?: { name?: string; cwd?: string }): Promise<StepResult>
      remove(run_id: string, input?: { root?: string; directory?: string }): Promise<StepResult>
      cleanup(run_id: string, input?: { name?: string; root?: string; directory?: string; cwd?: string }): Promise<CleanupResult>
    }
  }

  export interface CreateInput {
    cwd: string
    env?: Record<string, string>
    binary?: string
    runner?: (args: string[], opts: { cwd: string; env?: Record<string, string>; binary?: string }) => Promise<JJResult>
    run_root?: string
    onTelemetry?: (event: TelemetryEvent) => void
  }

  function op(args: string[]) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === "--") return args[i + 1] ?? ""
      if (arg === "--at-op") {
        i += 1
        continue
      }
      if (arg.startsWith("--at-op=")) continue
      if (arg === "--at-operation") {
        i += 1
        continue
      }
      if (arg.startsWith("--at-operation=")) continue
      if (arg === "--ignore-working-copy") continue
      if (
        arg === "-R" ||
        arg === "--repository" ||
        arg === "--config" ||
        arg === "--config-file" ||
        arg === "--config-toml" ||
        arg === "--color"
      ) {
        i += 1
        continue
      }
      if (
        arg.startsWith("--repository=") ||
        arg.startsWith("--config=") ||
        arg.startsWith("--config-file=") ||
        arg.startsWith("--color=")
      ) {
        continue
      }
      if (arg.startsWith("-")) continue
      return arg
    }
    return ""
  }

  function safe(args: string[]) {
    const out = args.reduce<string[]>((acc, arg, i) => {
      if (arg === "--ignore-working-copy") return acc
      if (arg === "--at-op") {
        if (i < args.length - 1) return acc
        return acc
      }
      if (i > 0 && args[i - 1] === "--at-op") return acc
      if (arg.startsWith("--at-op=")) return acc
      if (arg === "--at-operation") {
        if (i < args.length - 1) return acc
        return acc
      }
      if (i > 0 && args[i - 1] === "--at-operation") return acc
      if (arg.startsWith("--at-operation=")) return acc
      return [...acc, arg]
    }, [])
    return ["--at-op=@", "--ignore-working-copy", ...out]
  }

  function classify(stderr: string): "none" | "missing" | "other" {
    if (!stderr.trim()) return "none"
    if (/(no such workspace|unknown workspace|workspace.+(not found|does not exist))/i.test(stderr)) return "missing"
    return "other"
  }

  function telemetry(input: {
    name: string
    level: TelemetryLevel
    retry: boolean
    tags?: Record<string, string>
  }): TelemetryEvent {
    return {
      name: input.name,
      level: input.level,
      retry: input.retry,
      tags: input.tags ?? {},
    }
  }

  function emit(cb: ((event: TelemetryEvent) => void) | undefined, event: TelemetryEvent) {
    cb?.(event)
    return event
  }

  function run_name(run_id: string) {
    const slug = run_id.trim().replace(/[^a-zA-Z0-9_-]+/g, "_")
    return `run_${slug || "unknown"}`
  }

  function normalize(input: string) {
    const value = path.normalize(path.resolve(input))
    return process.platform === "win32" ? value.toLowerCase() : value
  }

  function inside(root: string, target: string) {
    const base = normalize(root)
    const item = normalize(target)
    if (item === base) return false
    return item.startsWith(`${base}${path.sep}`)
  }

  async function exists_path(input: string) {
    return fs
      .stat(input)
      .then(() => true)
      .catch(() => false)
  }

  function remove_step(input: {
    event: string
    level: TelemetryLevel
    retry: boolean
    missing: boolean
    message?: string
    command?: string[]
    exit_code?: number
    stderr?: string
    stderr_class: "none" | "missing" | "other"
    tags?: Record<string, string>
  }): StepResult {
    return {
      status: input.level === "error" ? "error" : input.level === "warning" ? "warning" : "success",
      missing: input.missing,
      retry: input.retry,
      message: input.message,
      command: input.command,
      exit_code: input.exit_code,
      stderr: input.stderr,
      stderr_class: input.stderr_class,
      telemetry: telemetry({
        name: input.event,
        level: input.level,
        retry: input.retry,
        tags: input.tags,
      }),
    }
  }

  export function create(input: CreateInput): Adapter {
    const run = input.runner ?? ((args: string[], opts: { cwd: string; env?: Record<string, string>; binary?: string }) => jj(args, opts))
    const root = input.run_root ?? path.join(input.cwd, ".origin", "runs")

    async function command(phase: CommandResult["phase"], args: string[], cwd = input.cwd): Promise<CommandResult> {
      const out = await run(args, {
        cwd,
        env: input.env,
        binary: input.binary,
      })
      const stdout = out.stdout.toString()
      const stderr = out.stderr.toString().trim()
      const stderr_class = classify(stderr)
      const ok = out.exitCode === 0
      const level = ok ? "info" : stderr_class === "missing" ? "warning" : "error"
      const retry = !ok && level === "error"
      const event = emit(
        input.onTelemetry,
        telemetry({
          name: `jj.${phase}`,
          level,
          retry,
          tags: {
            phase,
            command: op(args),
            exit_code: String(out.exitCode),
            stderr_class,
          },
        }),
      )
      return {
        ok,
        phase,
        command: args,
        exit_code: out.exitCode,
        stdout,
        stderr,
        stderr_class,
        telemetry: event,
      }
    }

    const workspace = {
      name(run_id: string) {
        return run_name(run_id)
      },
      path(run_id: string, custom?: string) {
        return path.join(custom ?? root, run_name(run_id))
      },
      async create(run_id: string, item?: { root?: string; directory?: string }): Promise<CreateWorkspaceResult> {
        const name = run_name(run_id)
        const target_root = item?.root ?? root
        const directory = item?.directory ?? path.join(target_root, name)
        if (!inside(target_root, directory)) {
          const event = emit(
            input.onTelemetry,
            telemetry({
              name: "jj.workspace.create",
              level: "error",
              retry: false,
              tags: {
                run_id,
                workspace: name,
                reason: "outside_root",
              },
            }),
          )
          return {
            run_id,
            name,
            root: target_root,
            directory,
            status: "error",
            command: ["workspace", "add", directory],
            telemetry: event,
          }
        }

        const setup = await fs.mkdir(target_root, { recursive: true }).then(() => true).catch(() => false)
        if (!setup) {
          const event = emit(
            input.onTelemetry,
            telemetry({
              name: "jj.workspace.create",
              level: "error",
              retry: true,
              tags: {
                run_id,
                workspace: name,
                reason: "mkdir_failed",
              },
            }),
          )
          return {
            run_id,
            name,
            root: target_root,
            directory,
            status: "error",
            command: ["workspace", "add", directory],
            telemetry: event,
          }
        }

        const result = await command("mutate", ["workspace", "add", directory], input.cwd)
        const level = result.ok ? "info" : "error"
        const event = emit(
          input.onTelemetry,
          telemetry({
            name: "jj.workspace.create",
            level,
            retry: !result.ok,
            tags: {
              run_id,
              workspace: name,
              exit_code: String(result.exit_code),
            },
          }),
        )
        return {
          run_id,
          name,
          root: target_root,
          directory,
          status: result.ok ? "success" : "error",
          command: ["workspace", "add", directory],
          result,
          telemetry: event,
        }
      },
      async forget(run_id: string, item?: { name?: string; cwd?: string }): Promise<StepResult> {
        const name = item?.name ?? run_name(run_id)
        const result = await command("mutate", ["workspace", "forget", name], item?.cwd ?? input.cwd)
        if (result.ok) {
          return remove_step({
            event: "jj.workspace.forget",
            level: "info",
            retry: false,
            missing: false,
            command: result.command,
            stderr_class: result.stderr_class,
            tags: {
              run_id,
              workspace: name,
              exit_code: String(result.exit_code),
            },
          })
        }
        if (result.stderr_class === "missing") {
          return remove_step({
            event: "jj.workspace.forget",
            level: "warning",
            retry: false,
            missing: true,
            command: result.command,
            exit_code: result.exit_code,
            stderr: result.stderr,
            stderr_class: result.stderr_class,
            message: result.stderr || "workspace already forgotten",
            tags: {
              run_id,
              workspace: name,
              exit_code: String(result.exit_code),
              reason: "missing",
            },
          })
        }
        return remove_step({
          event: "jj.workspace.forget",
          level: "error",
          retry: true,
          missing: false,
          command: result.command,
          exit_code: result.exit_code,
          stderr: result.stderr,
          stderr_class: result.stderr_class,
          message: result.stderr || "failed to forget workspace metadata",
          tags: {
            run_id,
            workspace: name,
            exit_code: String(result.exit_code),
          },
        })
      },
      async remove(run_id: string, item?: { root?: string; directory?: string }): Promise<StepResult> {
        const target_root = item?.root ?? root
        const target = item?.directory ?? path.join(target_root, run_name(run_id))
        if (!inside(target_root, target)) {
          return remove_step({
            event: "jj.workspace.remove",
            level: "error",
            retry: false,
            missing: false,
            message: "workspace path is outside run root",
            stderr: "workspace path is outside run root",
            stderr_class: "other",
            tags: {
              run_id,
              directory: target,
              root: target_root,
              reason: "outside_root",
            },
          })
        }

        const result = await fs
          .rm(target, {
            recursive: true,
            force: false,
            maxRetries: 5,
            retryDelay: 50,
          })
          .then(() => ({ status: "success" as const }))
          .catch((error) => ({ status: "error" as const, error }))

        if (result.status === "success") {
          return remove_step({
            event: "jj.workspace.remove",
            level: "info",
            retry: false,
            missing: false,
            stderr_class: "none",
            tags: {
              run_id,
              directory: target,
            },
          })
        }

        const message = result.error instanceof Error ? result.error.message : String(result.error)
        const code = typeof result.error === "object" && result.error && "code" in result.error ? String(result.error.code) : ""
        if (code === "ENOENT") {
          return remove_step({
            event: "jj.workspace.remove",
            level: "warning",
            retry: false,
            missing: true,
            message,
            stderr: message,
            stderr_class: "missing",
            tags: {
              run_id,
              directory: target,
              reason: "missing",
            },
          })
        }

        return remove_step({
          event: "jj.workspace.remove",
          level: "error",
          retry: true,
          missing: false,
          message,
          stderr: message,
          stderr_class: "other",
          tags: {
            run_id,
            directory: target,
            reason: code || "rm_failed",
          },
        })
      },
      async cleanup(run_id: string, item?: { name?: string; root?: string; directory?: string; cwd?: string }): Promise<CleanupResult> {
        const name = item?.name ?? run_name(run_id)
        const directory = item?.directory ?? path.join(item?.root ?? root, name)
        const forget = await workspace.forget(run_id, {
          name,
          cwd: item?.cwd,
        })
        const remove = await workspace.remove(run_id, {
          root: item?.root,
          directory,
        })

        const only_forget_failed = forget.status === "error" && remove.status !== "error"
        const failed = forget.status === "error" || remove.status === "error"
        const warned = forget.status === "warning" || remove.status === "warning"
        const status = failed ? (only_forget_failed ? "warning" : "error") : warned ? "warning" : "success"
        const retry = forget.retry || remove.retry
        const event = emit(
          input.onTelemetry,
          telemetry({
            name: "jj.workspace.cleanup",
            level: status === "error" ? "error" : status === "warning" ? "warning" : "info",
            retry,
            tags: {
              run_id,
              workspace: name,
              forget_status: forget.status,
              remove_status: remove.status,
            },
          }),
        )
        return {
          run_id,
          name,
          directory,
          status,
          retry,
          forget,
          remove,
          telemetry: event,
        }
      },
    }

    return {
      async bootstrap() {
        const jjdir = path.join(input.cwd, ".jj")
        if (await exists_path(jjdir)) {
          const event = emit(
            input.onTelemetry,
            telemetry({
              name: "jj.bootstrap",
              level: "info",
              retry: false,
              tags: { mode: "existing" },
            }),
          )
          return {
            mode: "existing",
            ok: true,
            telemetry: event,
          }
        }

        const gitdir = path.join(input.cwd, ".git")
        const colocate = await exists_path(gitdir)
        const cmd = colocate ? ["git", "init", "--colocate"] : ["git", "init", "."]
        const result = await command("bootstrap", cmd, input.cwd)
        const mode = colocate ? "colocated-init" : "fresh-init"
        const event = emit(
          input.onTelemetry,
          telemetry({
            name: "jj.bootstrap",
            level: result.ok ? "info" : "error",
            retry: !result.ok,
            tags: {
              mode,
              exit_code: String(result.exit_code),
            },
          }),
        )
        return {
          mode,
          ok: result.ok,
          command: cmd,
          result,
          telemetry: event,
        }
      },
      async read(args: string[], cwd?: string) {
        const key = op(args)
        if (!read_safe.has(key)) {
          throw new ReadPolicyError({
            code: "read_policy_unsupported",
            command: args.join(" "),
            message: `read policy rejected command "${key || args.join(" ")}"`,
          })
        }
        return command("read", safe(args), cwd ?? input.cwd)
      },
      async mutate(args: string[], cwd?: string) {
        return command("mutate", args, cwd ?? input.cwd)
      },
      workspace,
    }
  }
}
