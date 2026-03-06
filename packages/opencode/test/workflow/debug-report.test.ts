import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { RuntimeOutboundValidationError } from "../../src/runtime/error"
import { RuntimeOutbound } from "../../src/runtime/outbound"
import { RuntimeRun } from "../../src/runtime/run"
import { DraftTable, IntegrationAttemptTable } from "../../src/runtime/runtime.sql"
import { Database } from "../../src/storage/db"
import { WorkflowDebugReport } from "../../src/workflow/debug-report"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const workspace_id = "wrk_debug_report"

function home(value?: string) {
  if (value === undefined) {
    delete process.env.OPENCODE_TEST_HOME
    return
  }
  process.env.OPENCODE_TEST_HOME = value
}

function seed(workspace: string, directory: string) {
  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: workspace,
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

async function origin(fn: (input: { directory: string }) => Promise<void>) {
  await using dir = await tmpdir({
    init: async (root) => {
      const directory = path.join(root, "Documents", "origin")
      await mkdir(directory, { recursive: true })
      await $`git init`.cwd(directory).quiet()
      await $`git commit --allow-empty -m "root"`.cwd(directory).quiet()
      return { directory }
    },
  })

  const prior = process.env.OPENCODE_TEST_HOME
  home(dir.path)
  try {
    await Instance.provide({
      directory: dir.extra.directory,
      fn: async () => {
        seed(workspace_id, dir.extra.directory)
        await fn({
          directory: dir.extra.directory,
        })
      },
    })
  } finally {
    home(prior)
  }
}

function integrating(directory: string) {
  const run_workspace_directory = path.join(directory, ".origin", "runs", "run-debug")
  const run = RuntimeRun.create({
    workspace_id,
    trigger_type: "manual",
    run_workspace_root: path.dirname(run_workspace_directory),
    run_workspace_directory,
    integration_candidate_changed_paths: ["src/debug.txt"],
  })
  RuntimeRun.transition({ id: run.id, to: "running" })
  RuntimeRun.transition({ id: run.id, to: "validating" })
  RuntimeRun.transition({ id: run.id, to: "ready_for_integration" })
  return RuntimeRun.transition({ id: run.id, to: "integrating" })
}

function code(error: unknown) {
  if (!(error instanceof Error)) throw error
  return (error as Error & { data?: { code?: string } }).data?.code
}

beforeEach(async () => {
  await resetDatabase()
  RuntimeOutbound.Testing.reset()
})

afterEach(async () => {
  RuntimeOutbound.Testing.reset()
  await resetDatabase()
  home()
})

describe("workflow debug report", () => {
  test("preview exposes required metadata and optional prompt/files fields", async () => {
    await origin(async ({ directory }) => {
      const run = integrating(directory)
      const view = await WorkflowDebugReport.preview(run.id)

      expect(view.target).toBe("system://developers")
      expect(view.fields.map((item) => item.id)).toEqual(["metadata", "prompt", "files"])
      expect(view.fields.find((item) => item.id === "metadata")?.selected).toBe(true)
      expect(view.fields.find((item) => item.id === "metadata")?.required).toBe(true)
      expect(view.fields.find((item) => item.id === "prompt")?.selected).toBe(false)
      expect(view.fields.find((item) => item.id === "files")?.selected).toBe(false)
    })
  })

  test("create defaults to metadata-only system report drafts and dispatches without JJ attempt coupling", async () => {
    await origin(async ({ directory }) => {
      const run = integrating(directory)

      const created = await WorkflowDebugReport.create(run.id, {
        consent: true,
      })
      expect(created.run_status).toBe("cancel_requested")
      expect(created.draft.source_kind).toBe("system_report")
      expect(created.draft.adapter_id).toBe("system")
      expect(created.draft.action_id).toBe("report.dispatch")
      expect(created.draft.target).toBe("system://developers")
      expect(created.draft.payload_json.metadata).toBeDefined()
      expect(created.draft.payload_json.prompt).toBeUndefined()
      expect(created.draft.payload_json.files).toBeUndefined()

      const stored = Database.use((db) => db.select().from(DraftTable).get())
      expect(stored?.source_kind).toBe("system_report")

      await RuntimeOutbound.approve({
        id: created.draft.id,
        actor_type: "user",
      })
      const sent = await RuntimeOutbound.send({
        id: created.draft.id,
        actor_type: "user",
      })

      expect(sent.status).toBe("sent")
      expect(RuntimeOutbound.Testing.writes()).toHaveLength(1)
      expect(RuntimeOutbound.Testing.writes()[0]?.endpoint).toBe("system.report")
      expect(Database.use((db) => db.select().from(IntegrationAttemptTable).all())).toHaveLength(0)
    })
  })

  test("rejects non-allowlisted report targets without creating outbound state", async () => {
    await origin(async ({ directory }) => {
      const run = integrating(directory)

      try {
        await WorkflowDebugReport.create(run.id, {
          consent: true,
          target: "system://elsewhere",
        })
        throw new Error("expected report create to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeOutboundValidationError)
        expect(code(error)).toBe("target_not_allowed")
      }

      expect(Database.use((db) => db.select().from(DraftTable).all())).toHaveLength(0)
      expect(RuntimeOutbound.Testing.writes()).toEqual([])
    })
  })
})
