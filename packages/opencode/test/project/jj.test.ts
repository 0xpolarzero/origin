import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { JJ } from "../../src/project/jj"
import type { JJResult } from "../../src/util/jj"
import { tmpdir } from "../fixture/fixture"

type Runner = (args: string[], opts: { cwd: string; env?: Record<string, string>; binary?: string }) => Promise<JJResult>

function result(input?: { exitCode?: number; stdout?: string; stderr?: string }): JJResult {
  const stdout = Buffer.from(input?.stdout ?? "")
  const stderr = Buffer.from(input?.stderr ?? "")
  return {
    exitCode: input?.exitCode ?? 0,
    stdout,
    stderr,
    text: () => stdout.toString(),
  }
}

async function exists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

function count(args: string[], token: string) {
  return args.filter((item) => item === token).length
}

describe("JJ bootstrap matrix", () => {
  test("no-ops when .jj already exists", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".jj"), { recursive: true })

    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      runner: async (args) => {
        calls.push(args)
        return result()
      },
    })

    const boot = await adapter.bootstrap()
    expect(boot.mode).toBe("existing")
    expect(boot.ok).toBe(true)
    expect(boot.command).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  test("prefers existing .jj even when .git is present", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, ".jj"), { recursive: true })

    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      runner: async (args) => {
        calls.push(args)
        return result()
      },
    })

    const boot = await adapter.bootstrap()
    expect(boot.mode).toBe("existing")
    expect(boot.ok).toBe(true)
    expect(calls).toHaveLength(0)
  })

  test("uses colocated init when only .git exists and preserves refs/HEAD", async () => {
    await using tmp = await tmpdir({ git: true })
    const head_before = await $`git symbolic-ref HEAD`.cwd(tmp.path).quiet().text()
    const refs_before = await $`git show-ref`.cwd(tmp.path).quiet().text()

    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      runner: async (args, opts) => {
        calls.push(args)
        await fs.mkdir(path.join(opts.cwd, ".jj"), { recursive: true })
        return result()
      },
    })

    const boot = await adapter.bootstrap()
    const head_after = await $`git symbolic-ref HEAD`.cwd(tmp.path).quiet().text()
    const refs_after = await $`git show-ref`.cwd(tmp.path).quiet().text()

    expect(boot.mode).toBe("colocated-init")
    expect(boot.ok).toBe(true)
    expect(boot.command).toEqual(["git", "init", "--colocate"])
    expect(head_after).toBe(head_before)
    expect(refs_after).toBe(refs_before)
    expect(await exists(path.join(tmp.path, ".jj"))).toBe(true)
    expect(calls).toEqual([["git", "init", "--colocate"]])
  })

  test("is deterministic across repeated empty-directory bootstraps", async () => {
    await using tmp = await tmpdir()
    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      runner: async (args, opts) => {
        calls.push(args)
        await fs.mkdir(path.join(opts.cwd, ".jj"), { recursive: true })
        return result()
      },
    })

    const first = await adapter.bootstrap()
    const second = await adapter.bootstrap()

    expect(first.mode).toBe("fresh-init")
    expect(first.ok).toBe(true)
    expect(second.mode).toBe("existing")
    expect(second.ok).toBe(true)
    expect(calls).toEqual([["git", "init", "."]])
  })
})

describe("JJ read policy", () => {
  test("enforces canonical no-snapshot flags for repeated polling reads", async () => {
    await using tmp = await tmpdir()
    const calls: string[][] = []
    const telemetry: JJ.TelemetryEvent[] = []

    const adapter = JJ.create({
      cwd: tmp.path,
      onTelemetry: (item) => telemetry.push(item),
      runner: async (args) => {
        calls.push(args)
        return result({ stdout: "ok" })
      },
    })

    await adapter.read(["log", "-r", "@"])
    await adapter.read(["log", "-r", "@"])
    await adapter.read(["log", "-r", "@"])

    expect(calls).toHaveLength(3)
    calls.forEach((args) => {
      expect(args[0]).toBe("--at-op=@")
      expect(args[1]).toBe("--ignore-working-copy")
      expect(count(args, "--at-op=@")).toBe(1)
      expect(count(args, "--ignore-working-copy")).toBe(1)
      expect(args).toContain("log")
    })

    const reads = telemetry.filter((item) => item.name === "jj.read")
    expect(reads).toHaveLength(3)
    expect(reads.every((item) => item.level === "info")).toBe(true)
  })

  test("rewrites caller-provided no-snapshot flags to canonical values", async () => {
    await using tmp = await tmpdir()
    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      runner: async (args) => {
        calls.push(args)
        return result({ stdout: "ok" })
      },
    })

    await adapter.read(["log", "--at-op=abc123", "--ignore-working-copy"])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(["--at-op=@", "--ignore-working-copy", "log"])
  })

  test("accepts global options before command and still enforces policy", async () => {
    await using tmp = await tmpdir()
    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      runner: async (args) => {
        calls.push(args)
        return result({ stdout: "ok" })
      },
    })

    await adapter.read(["--repository", tmp.path, "log", "-r", "@"])
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe("--at-op=@")
    expect(calls[0][1]).toBe("--ignore-working-copy")
    expect(calls[0]).toContain("--repository")
    expect(calls[0]).toContain(tmp.path)
    expect(calls[0]).toContain("log")
  })

  test("supports --config-file and rewrites --at-operation to canonical --at-op=@", async () => {
    await using tmp = await tmpdir()
    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      runner: async (args) => {
        calls.push(args)
        return result({ stdout: "ok" })
      },
    })

    await adapter.read(["--config-file", "jj.toml", "--at-operation", "x", "log"])
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe("--at-op=@")
    expect(calls[0][1]).toBe("--ignore-working-copy")
    expect(calls[0]).toContain("--config-file")
    expect(calls[0]).toContain("jj.toml")
    expect(calls[0]).toContain("log")
    expect(calls[0]).not.toContain("--at-operation")
  })

  test("rejects unsupported commands with typed policy error and no telemetry", async () => {
    await using tmp = await tmpdir()
    const telemetry: JJ.TelemetryEvent[] = []
    const calls: string[][] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      onTelemetry: (item) => telemetry.push(item),
      runner: async (args) => {
        calls.push(args)
        return result()
      },
    })

    const inputs = [
      ["workspace", "list"],
      ["bookmark", "move"],
      [] as string[],
    ]

    for (const item of inputs) {
      const error = await adapter.read(item).catch((value) => value)
      expect(error).toBeInstanceOf(JJ.ReadPolicyError)
      if (error instanceof JJ.ReadPolicyError) {
        expect(error.name).toBe("JJReadPolicyError")
        expect(error.data.code).toBe("read_policy_unsupported")
        expect(error.data.command).toBe(item.join(" "))
      }
    }

    expect(calls).toHaveLength(0)
    expect(telemetry).toHaveLength(0)
  })
})

describe("JJ workspace lifecycle", () => {
  test("run workspace naming is deterministic and sanitized", async () => {
    await using tmp = await tmpdir()
    const adapter = JJ.create({
      cwd: tmp.path,
      run_root: path.join(tmp.path, "runs"),
      runner: async () => result(),
    })

    expect(adapter.workspace.name("run-42")).toBe("run_run-42")
    expect(adapter.workspace.name("run id")).toBe("run_run_id")
    expect(adapter.workspace.name("")).toBe("run_unknown")
    expect(adapter.workspace.path("run id")).toBe(path.join(tmp.path, "runs", "run_run_id"))
  })

  test("create and cleanup return deterministic structured payloads", async () => {
    await using tmp = await tmpdir()
    const calls: string[][] = []
    const telemetry: JJ.TelemetryEvent[] = []
    const adapter = JJ.create({
      cwd: tmp.path,
      run_root: path.join(tmp.path, "runs"),
      onTelemetry: (item) => telemetry.push(item),
      runner: async (args) => {
        calls.push(args)
        return result()
      },
    })

    const created = await adapter.workspace.create("run-42")
    expect(created.name).toBe("run_run-42")
    expect(created.directory).toBe(path.join(tmp.path, "runs", "run_run-42"))
    expect(created.status).toBe("success")
    expect(created.command).toEqual(["workspace", "add", path.join(tmp.path, "runs", "run_run-42")])
    expect(created.telemetry.tags.workspace).toBe("run_run-42")
    expect(calls).toEqual([["workspace", "add", path.join(tmp.path, "runs", "run_run-42")]])

    await fs.mkdir(created.directory, { recursive: true })
    const cleaned = await adapter.workspace.cleanup("run-42")
    expect(cleaned.status).toBe("success")
    expect(cleaned.retry).toBe(false)
    expect(cleaned.forget.status).toBe("success")
    expect(cleaned.remove.status).toBe("success")
    expect(cleaned.telemetry.tags.workspace).toBe("run_run-42")
    expect(cleaned.telemetry.tags.forget_status).toBe("success")
    expect(cleaned.telemetry.tags.remove_status).toBe("success")
    expect(telemetry.some((item) => item.name === "jj.workspace.cleanup")).toBe(true)
  })

  test("create failure returns structured command result", async () => {
    await using tmp = await tmpdir()
    const adapter = JJ.create({
      cwd: tmp.path,
      run_root: path.join(tmp.path, "runs"),
      runner: async () => result({ exitCode: 1, stderr: "fatal: failed to add workspace" }),
    })

    const out = await adapter.workspace.create("run-fail")
    expect(out.status).toBe("error")
    expect(out.result?.ok).toBe(false)
    expect(out.result?.exit_code).toBe(1)
    expect(out.result?.stderr_class).toBe("other")
    expect(out.telemetry.retry).toBe(true)
  })

  test("create mkdir failure returns structured error without executing runner", async () => {
    await using tmp = await tmpdir()
    let called = false
    const adapter = JJ.create({
      cwd: tmp.path,
      run_root: `${tmp.path}${String.fromCharCode(0)}invalid-root`,
      runner: async () => {
        called = true
        return result()
      },
    })

    const out = await adapter.workspace.create("run-mkdir")
    expect(out.status).toBe("error")
    expect(out.result).toBeUndefined()
    expect(out.telemetry.tags.reason).toBe("mkdir_failed")
    expect(called).toBe(false)
  })

  test("create blocks workspace paths outside the configured run root", async () => {
    await using tmp = await tmpdir()
    const run_root = path.join(tmp.path, "runs")
    const outside = path.join(tmp.path, "outside", "run_x")
    let called = false

    const adapter = JJ.create({
      cwd: tmp.path,
      run_root,
      runner: async () => {
        called = true
        return result()
      },
    })

    const out = await adapter.workspace.create("run-x", {
      root: run_root,
      directory: outside,
    })

    expect(out.status).toBe("error")
    expect(out.telemetry.tags.reason).toBe("outside_root")
    expect(called).toBe(false)
  })

  test("cleanup is idempotent even when artifacts are already missing", async () => {
    await using tmp = await tmpdir()
    const runner: Runner = async () => result({ exitCode: 1, stderr: "No such workspace: run_run-idem" })
    const adapter = JJ.create({
      cwd: tmp.path,
      run_root: path.join(tmp.path, "runs"),
      runner,
    })

    const first = await adapter.workspace.cleanup("run-idem")
    const second = await adapter.workspace.cleanup("run-idem")

    expect(first.status).toBe("warning")
    expect(first.retry).toBe(false)
    expect(first.forget.missing).toBe(true)
    expect(first.remove.missing).toBe(true)

    expect(second.status).toBe("warning")
    expect(second.retry).toBe(false)
    expect(second.forget.missing).toBe(true)
    expect(second.remove.missing).toBe(true)
  })

  test("cleanup always forgets metadata before removing directory", async () => {
    await using tmp = await tmpdir()
    const run_root = path.join(tmp.path, "runs")
    const run_id = "run-order"
    const directory = path.join(run_root, "run_run-order")
    await fs.mkdir(directory, { recursive: true })
    await Bun.write(path.join(directory, "sample.txt"), "ok")

    let seen = false
    const runner: Runner = async (args) => {
      if (args[0] === "workspace" && args[1] === "forget") {
        seen = await exists(directory)
      }
      return result()
    }

    const adapter = JJ.create({
      cwd: tmp.path,
      run_root,
      runner,
    })

    const out = await adapter.workspace.cleanup(run_id)
    expect(out.status).toBe("success")
    expect(seen).toBe(true)
    expect(await exists(directory)).toBe(false)
  })

  test("classifies forget-success/remove-failure as retryable error", async () => {
    await using tmp = await tmpdir()
    const run_root = path.join(tmp.path, "runs")
    const broken = path.join(run_root, `bad${String.fromCharCode(0)}path`)

    const adapter = JJ.create({
      cwd: tmp.path,
      run_root,
      runner: async () => result(),
    })

    const out = await adapter.workspace.cleanup("run-a", {
      name: "run_run-a",
      directory: broken,
    })

    expect(out.forget.status).toBe("success")
    expect(out.forget.retry).toBe(false)
    expect(out.remove.status).toBe("error")
    expect(out.remove.retry).toBe(true)
    expect(out.status).toBe("error")
    expect(out.retry).toBe(true)
    expect(out.telemetry.level).toBe("error")
    expect(out.telemetry.tags.forget_status).toBe("success")
    expect(out.telemetry.tags.remove_status).toBe("error")
  })

  test("classifies forget-failure/remove-success as retryable warning", async () => {
    await using tmp = await tmpdir()
    const runner: Runner = async (args) => {
      if (args[0] === "workspace" && args[1] === "forget") {
        return result({ exitCode: 1, stderr: "fatal: failed to forget workspace metadata" })
      }
      return result()
    }
    const adapter = JJ.create({
      cwd: tmp.path,
      run_root: path.join(tmp.path, "runs"),
      runner,
    })

    const directory = adapter.workspace.path("run-b")
    await fs.mkdir(directory, { recursive: true })

    const out = await adapter.workspace.cleanup("run-b")
    expect(out.forget.status).toBe("error")
    expect(out.forget.retry).toBe(true)
    expect(out.remove.status).toBe("success")
    expect(out.remove.retry).toBe(false)
    expect(out.status).toBe("warning")
    expect(out.retry).toBe(true)
    expect(out.telemetry.level).toBe("warning")
    expect(out.telemetry.tags.forget_status).toBe("error")
    expect(out.telemetry.tags.remove_status).toBe("success")
    expect(await exists(directory)).toBe(false)
  })

  test("classifies forget-failure/remove-failure as retryable error", async () => {
    await using tmp = await tmpdir()
    const run_root = path.join(tmp.path, "runs")
    const broken = path.join(run_root, `bad${String.fromCharCode(0)}path`)

    const runner: Runner = async (args) => {
      if (args[0] === "workspace" && args[1] === "forget") {
        return result({ exitCode: 1, stderr: "fatal: failed to forget workspace metadata" })
      }
      return result()
    }
    const adapter = JJ.create({
      cwd: tmp.path,
      run_root,
      runner,
    })

    const out = await adapter.workspace.cleanup("run-c", {
      name: "run_run-c",
      directory: broken,
    })
    expect(out.forget.status).toBe("error")
    expect(out.remove.status).toBe("error")
    expect(out.status).toBe("error")
    expect(out.retry).toBe(true)
    expect(out.telemetry.level).toBe("error")
  })

  test("blocks remove operations outside configured run root", async () => {
    await using tmp = await tmpdir()
    const run_root = path.join(tmp.path, "runs")
    const outside = path.join(tmp.path, "outside")
    await fs.mkdir(outside, { recursive: true })
    await Bun.write(path.join(outside, "keep.txt"), "data")

    const adapter = JJ.create({
      cwd: tmp.path,
      run_root,
      runner: async () => result(),
    })

    const out = await adapter.workspace.remove("run-z", {
      root: run_root,
      directory: outside,
    })

    expect(out.status).toBe("error")
    expect(out.retry).toBe(false)
    expect(out.message).toBe("workspace path is outside run root")
    expect(await exists(path.join(outside, "keep.txt"))).toBe(true)
  })

  test("cleanup preserves non-retryable remove errors", async () => {
    await using tmp = await tmpdir()
    const run_root = path.join(tmp.path, "runs")
    const outside = path.join(tmp.path, "outside", "run_y")
    await fs.mkdir(path.dirname(outside), { recursive: true })

    const adapter = JJ.create({
      cwd: tmp.path,
      run_root,
      runner: async () => result(),
    })

    const out = await adapter.workspace.cleanup("run-y", {
      name: "run_run-y",
      directory: outside,
    })

    expect(out.forget.status).toBe("success")
    expect(out.remove.status).toBe("error")
    expect(out.remove.retry).toBe(false)
    expect(out.retry).toBe(false)
  })
})
