import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { WorkspaceContext } from "../../src/control-plane/workspace-context"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { JJ } from "../../src/project/jj"
import { Instance } from "../../src/project/instance"
import { RuntimeManualRunDuplicateError } from "../../src/runtime/error"
import { AuditEventTable, OperationTable, RunTable } from "../../src/runtime/runtime.sql"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { WorkflowManualRun } from "../../src/workflow/manual-run"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

type ExecuteItem = {
  phase: string
  directory: string
  abort: AbortSignal
  session_id?: string | null
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

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

async function exists(target: string) {
  return stat(target)
    .then(() => true)
    .catch(() => false)
}

function transitions(run_id: string) {
  return Database.use((db) =>
    db
      .select()
      .from(AuditEventTable)
      .where(eq(AuditEventTable.run_id, run_id))
      .all()
      .filter((item) => item.event_type === "run.transitioned")
      .map((item) => item.event_payload as { from: string; to: string }),
  )
}

async function wait_status(run_id: string, status: string) {
  const start = Date.now()
  while (true) {
    const row = WorkflowManualRun.get({ run_id })
    if (row.status === status) return row
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for status ${status}`)
    await Bun.sleep(20)
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

function seams(input?: {
  create_fail?: boolean
  forget_fail?: boolean
  execute?: (item: ExecuteItem) => Promise<void>
}) {
  return {
    adapter: ({ directory }: { directory: string }) =>
      JJ.create({
        cwd: directory,
        run_root: path.join(directory, ".origin", "runs"),
        runner: async (args) => {
          if (args[0] === "workspace" && args[1] === "add") {
            if (input?.create_fail) return result({ exitCode: 1, stderr: "fatal: failed to add workspace" })
            await mkdir(args[2], { recursive: true })
            return result()
          }
          if (args[0] === "workspace" && args[1] === "forget" && input?.forget_fail) {
            return result({ exitCode: 1, stderr: "fatal: failed to forget workspace metadata" })
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

describe("workflow manual run orchestration", () => {
  test("start/wait links run to new session and classifies no-change with cleanup", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams())

            const first = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "one" })
            const done = await WorkflowManualRun.wait({ run_id: first.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(done.session_id).toBeTruthy()
            expect(done.cleanup_failed).toBe(false)
            expect(done.integration_candidate).toBeNull()
            expect(transitions(done.id)).toEqual([
              { from: "create", to: "queued" },
              { from: "queued", to: "running" },
              { from: "running", to: "validating" },
              { from: "validating", to: "completed_no_change" },
            ])

            const done_session_id = done.session_id
            if (!done_session_id) throw new Error("missing session id")
            const session = await Session.get(done_session_id)
            expect(session.id).toBe(done_session_id)

            const run_workspace_directory = done.run_workspace_directory
            if (!run_workspace_directory) throw new Error("missing run workspace directory")
            expect(await exists(run_workspace_directory)).toBe(false)

            const operations = Database.use((db) => db.select().from(OperationTable).all())
            expect(operations).toHaveLength(0)

            const second = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "two" })
            const complete = await WorkflowManualRun.wait({ run_id: second.id, timeout_ms: 5000 })
            expect(complete.session_id).not.toBe(done.session_id)
          },
        })
      },
    })
  })

  test("duplicate manual trigger is rejected deterministically", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async () => {
                  await hold
                },
              }),
            )

            const first = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "same" })

            await expect(WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "same" })).rejects.toBeInstanceOf(
              RuntimeManualRunDuplicateError,
            )

            release()
            await WorkflowManualRun.wait({ run_id: first.id, timeout_ms: 5000 })

            const runs = Database.use((db) => db.select().from(RunTable).all())
            expect(runs).toHaveLength(1)
          },
        })
      },
    })
  })

  test("wait timeout returns in-progress status while run task is active", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async () => {
                  await hold
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "wait-timeout" })
            await wait_status(run.id, "running")

            const start = Date.now()
            const snapshot = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 80 })
            const elapsed = Date.now() - start

            expect(snapshot.status).toBe("running")
            expect(elapsed).toBeLessThan(250)

            WorkflowManualRun.cancel({ run_id: run.id })
            release()
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })
            expect(done.status).toBe("canceled")
          },
        })
      },
    })
  })

  test("repair loop exhaustion fails with deterministic code", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    let attempts = 0
    const sessions = new Set<string>()

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set({
              ...seams(),
              validate: async () => ({
                ok: false,
                message: "still invalid",
              }),
              execute: async (item) => {
                attempts += 1
                sessions.add(item.session_id ?? "")
              },
            })

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("repair_exhausted")
            expect(attempts).toBe(4)
            expect(sessions.size).toBe(1)
          },
        })
      },
    })
  })

  test("repair loop time cap fails deterministically and preserves cleanup guarantees", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    let attempts = 0
    const sessions = new Set<string>()
    const ticks = [1_000, 1_000, 1_000 + 10 * 60 * 1000 + 1]
    let index = 0

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set({
              ...seams(),
              now: () => {
                const value = ticks[index]
                index += 1
                return value ?? ticks[ticks.length - 1]!
              },
              validate: async () => ({
                ok: false,
                message: "still invalid",
              }),
              execute: async (item) => {
                attempts += 1
                sessions.add(item.session_id ?? "")
              },
            })

            const run = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "repair-time-cap" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("repair_exhausted")
            expect(attempts).toBe(2)
            expect(sessions.size).toBe(1)
            const run_workspace_directory = done.run_workspace_directory
            if (!run_workspace_directory) throw new Error("missing run workspace directory")
            expect(await exists(run_workspace_directory)).toBe(false)
          },
        })
      },
    })
  })

  test("change classification persists integration candidate and reaches ready_for_integration", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async (item) => {
                  if (item.phase !== "initial") return
                  await write(item.directory, "notes/result.md", "changed")
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("ready_for_integration")
            expect(done.integration_candidate?.changed_paths).toContain("notes/result.md")
            const operations = Database.use((db) => db.select().from(OperationTable).all())
            expect(operations).toHaveLength(0)
            expect(transitions(done.id)).toEqual([
              { from: "create", to: "queued" },
              { from: "queued", to: "running" },
              { from: "running", to: "validating" },
              { from: "validating", to: "ready_for_integration" },
            ])
          },
        })
      },
    })
  })

  test("partial start failure keeps session, marks run failed, and leaves no run workspace artifact", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams({ create_fail: true }))

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })

            expect(run.status).toBe("failed")
            expect(run.failure_code).toBe("manual_start_failed")
            expect(run.session_id).toBeTruthy()

            const run_session_id = run.session_id
            if (!run_session_id) throw new Error("missing session id")
            const session = await Session.get(run_session_id)
            expect(session.id).toBe(run_session_id)

            const run_workspace_directory = run.run_workspace_directory
            if (!run_workspace_directory) throw new Error("missing run workspace directory")
            expect(await exists(run_workspace_directory)).toBe(false)
          },
        })
      },
    })
  })

  test("cleanup failure is recorded without changing terminal status", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(seams({ forget_fail: true }))

            const run = await WorkflowManualRun.start({ workflow_id: "basic" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("completed_no_change")
            expect(done.cleanup_failed).toBe(true)
            expect(done.failure_code).toBe("cleanup_failed")
          },
        })
      },
    })
  })

  test("run fails if execution mutates outside run workspace boundaries", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async () => {
                  await write(dir.path, "outside.txt", "forbidden")
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "escape" })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(done.status).toBe("failed")
            expect(done.failure_code).toBe("workspace_policy_blocked")
            expect(done.integration_candidate).toBeNull()
          },
        })
      },
    })
  })

  test("cancel transitions running manual runs to canceled", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set(
              seams({
                execute: async (item) => {
                  while (!item.abort.aborted) {
                    await Bun.sleep(20)
                  }
                },
              }),
            )

            const run = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "cancel" })
            await wait_status(run.id, "running")
            const canceled = WorkflowManualRun.cancel({ run_id: run.id })
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(canceled.status).toBe("canceled")
            expect(done.status).toBe("canceled")
            const run_workspace_directory = done.run_workspace_directory
            if (!run_workspace_directory) throw new Error("missing run workspace directory")
            expect(await exists(run_workspace_directory)).toBe(false)
          },
        })
      },
    })
  })

  test("cancel transitions validating manual runs to canceled", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/basic.yaml",
      ["schema_version: 1", "id: basic", "name: Basic", "trigger:", "  type: manual", "instructions: run"].join("\n"),
    )

    let release = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_manual", dir.path)

        await WorkspaceContext.provide({
          workspaceID: "wrk_manual",
          fn: async () => {
            WorkflowManualRun.Testing.set({
              ...seams(),
              validate: async () => {
                await hold
                return {
                  ok: false,
                  message: "stalled",
                }
              },
            })

            const run = await WorkflowManualRun.start({ workflow_id: "basic", trigger_id: "cancel-validating" })
            await wait_status(run.id, "validating")
            const canceled = WorkflowManualRun.cancel({ run_id: run.id })
            release()
            const done = await WorkflowManualRun.wait({ run_id: run.id, timeout_ms: 5000 })

            expect(canceled.status).toBe("canceled")
            expect(done.status).toBe("canceled")
            const run_workspace_directory = done.run_workspace_directory
            if (!run_workspace_directory) throw new Error("missing run workspace directory")
            expect(await exists(run_workspace_directory)).toBe(false)
          },
        })
      },
    })
  })
})
