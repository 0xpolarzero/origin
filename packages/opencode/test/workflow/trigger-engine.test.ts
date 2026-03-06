import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
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
  test("cron catch-up writes at most 100 skipped rows with one overflow summary", async () => {
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
        expect(rows).toHaveLength(100)

        const summary = rows.filter((row) => record(row.trigger_metadata_json).summary === true)
        const detailed = rows.filter((row) => record(row.trigger_metadata_json).summary !== true)
        expect(summary).toHaveLength(1)
        expect(detailed).toHaveLength(99)

        const skipped = events.find((item) => item.outcome === "skipped")
        if (!skipped) throw new Error("missing skipped notification")
        expect(skipped.count).toBe(126)
        expect(skipped.message).toBe("Skipped 126 missed cron slots")

        const meta = record(summary[0]!.trigger_metadata_json)
        expect(summary[0]!.reason_code).toBe("cron_missed_slot")
        expect(meta.source).toBe("cron")
        expect(meta.summary).toBe(true)
        expect(meta.skipped_count).toBe(27)
        expect(meta.first_slot_local).toBe("2026-01-05T04:00+00:00[UTC]")
        expect(meta.last_slot_local).toBe("2026-01-06T06:00+00:00[UTC]")

        const counts = record(meta.reason_counts)
        expect(counts.cron_missed_slot).toBe(27)
        expect(counts.dst_gap_skipped).toBe(0)

        const trigger = Database.use((db) =>
          db
            .select()
            .from(WorkflowTriggerTable)
            .where(eq(WorkflowTriggerTable.workspace_id, "wrk_cron"))
            .get(),
        )
        expect(trigger?.cursor_at).toBe(now)
      },
    })
  })

  test("cron tick persists dst_gap_skipped rows across spring-forward boundaries", async () => {
    await using dir = await tmpdir()

    await write(
      dir.path,
      ".origin/workflows/spring.yaml",
      [
        "schema_version: 1",
        "id: spring",
        "name: Spring",
        "trigger:",
        "  type: cron",
        "  cron: 30 2 * * *",
        "instructions: run",
      ].join("\n"),
    )

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        seed("wrk_dst", dir.path)

        let now = Date.parse("2026-03-08T06:00:00.000Z")
        WorkflowTriggerEngine.Testing.set({
          now: () => now,
          timezone: () => "America/New_York",
          run: async () => {
            throw new Error("unexpected cron execution")
          },
        })

        await WorkflowTriggerEngine.tick()

        now = Date.parse("2026-03-08T07:05:00.000Z")
        await WorkflowTriggerEngine.tick()

        const rows = Database.use((db) =>
          db
            .select()
            .from(RunTable)
            .where(eq(RunTable.workspace_id, "wrk_dst"))
            .all(),
        )

        expect(rows).toHaveLength(1)
        expect(rows[0]!.reason_code).toBe("dst_gap_skipped")
        const meta = record(rows[0]!.trigger_metadata_json)
        expect(meta.source).toBe("cron")
        expect(meta.summary).toBe(false)
        expect(meta.slot_local).toBe("2026-03-08T02:30[America/New_York]")
        expect(meta.slot_utc).toBeNull()
      },
    })
  })
})
