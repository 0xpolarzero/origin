import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { WorkspaceContext } from "../../src/control-plane/workspace-context"
import { Instance } from "../../src/project/instance"
import { RunTable, WorkflowTriggerTable } from "../../src/runtime/runtime.sql"
import { Database, eq } from "../../src/storage/db"
import { WorkflowTriggerEngine } from "../../src/workflow/trigger-engine"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
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

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected record")
  }
  return value as Record<string, unknown>
}

beforeEach(async () => {
  await resetDatabase()
  WorkflowTriggerEngine.Testing.reset()
})

afterEach(async () => {
  await resetDatabase()
  WorkflowTriggerEngine.Testing.reset()
})

describe("workflow trigger engine", () => {
  test("tick leaves deferred cron workflows untouched in phase 15", async () => {
    await using dir = await tmpdir()

    await write(
      dir.path,
      ".origin/workflows/hourly.yaml",
      [
        "schema_version: 1",
        "id: hourly",
        "name: Hourly",
        "trigger:",
        "  type: cron",
        "  cron: 0 * * * *",
        "instructions: run",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_cron", dir.path)

        let now = Date.parse("2026-01-01T00:30:00.000Z")
        const events: Array<{ outcome: string; count: number; message: string }> = []
        let started = false

        WorkflowTriggerEngine.Testing.set({
          now: () => now,
          timezone: () => "UTC",
          notify: (item) => {
            events.push({
              outcome: item.outcome,
              count: item.count,
              message: item.message,
            })
          },
          run: async () => {
            started = true
            throw new Error("unexpected cron execution")
          },
        })

        await WorkflowTriggerEngine.tick()

        now = Date.parse("2026-01-06T06:30:00.000Z")
        await WorkflowTriggerEngine.tick()

        const rows = Database.use((db) =>
          db
            .select()
            .from(RunTable)
            .where(eq(RunTable.workspace_id, "wrk_cron"))
            .all(),
        )
        expect(rows).toHaveLength(0)

        const trigger = Database.use((db) =>
          db
            .select()
            .from(WorkflowTriggerTable)
            .where(eq(WorkflowTriggerTable.workspace_id, "wrk_cron"))
            .get(),
        )
        expect(trigger).toBeUndefined()
        expect(events).toHaveLength(0)
        expect(started).toBe(false)
      },
    })
  })

  test("signal ingress returns workspace_policy_blocked for standard workspaces", async () => {
    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        let started = false
        WorkflowTriggerEngine.Testing.set({
          run: async () => {
            started = true
            return {}
          },
        })

        const result = await WorkspaceContext.provide({
          workspaceID: "wrk_standard",
          fn: async () =>
            WorkflowTriggerEngine.signal({
              signal: "incoming",
              body: {
                event_time: Date.parse("2026-03-08T07:05:00.000Z"),
                payload_json: {
                  ok: true,
                },
              },
            }),
        })

        expect(result).toEqual({
          accepted: false,
          duplicate: false,
          reason: "workspace_policy_blocked",
          run_ids: [],
        })
        expect(started).toBe(false)
      },
    })
  })
})
