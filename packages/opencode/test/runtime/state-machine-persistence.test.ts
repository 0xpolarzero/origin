import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { RuntimeAudit } from "../../src/runtime/audit"
import { DraftTable, OperationTable, RunTable, AuditEventTable } from "../../src/runtime/runtime.sql"
import { RuntimeDraft } from "../../src/runtime/draft"
import { RuntimeIllegalTransitionError, RuntimePolicyLineageError } from "../../src/runtime/error"
import { RuntimeOperation } from "../../src/runtime/operation"
import { RuntimeRun } from "../../src/runtime/run"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

const workspace_id = "wrk_runtime"
const session_id = "ses_runtime"
const project_id = "proj_runtime"

function draft_input(input?: { workspace_id?: string; run_id?: string | null }) {
  return {
    workspace_id: input?.workspace_id ?? workspace_id,
    run_id: input?.run_id,
    source_kind: "user" as const,
    adapter_id: "test",
    integration_id: "test/default",
    action_id: "message.send",
    target: "channel://general",
    payload_json: {
      text: "hello",
    },
    payload_schema_version: 1,
    preview_text: "Message channel://general: hello",
    material_hash: "hash-runtime",
  }
}

function seed() {
  const now = Date.now()
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: project_id,
        worktree: "/tmp/runtime",
        vcs: "git",
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .run()

    db.insert(SessionTable)
      .values({
        id: session_id,
        project_id,
        workspace_id,
        parent_id: null,
        slug: "runtime",
        directory: "/tmp/runtime",
        title: "runtime",
        version: "1",
        share_url: null,
        summary_additions: null,
        summary_deletions: null,
        summary_files: null,
        summary_diffs: null,
        revert: null,
        permission: null,
        time_created: now,
        time_updated: now,
        time_compacting: null,
        time_archived: null,
      })
      .run()

    db.insert(WorkspaceTable)
      .values({
        id: workspace_id,
        project_id,
        branch: "main",
        config: {
          type: "worktree",
          directory: "/tmp/runtime",
        },
      })
      .run()
  })
}

function code(error: unknown) {
  if (!(error instanceof Error)) throw error
  const item = error as Error & { data?: { code?: string } }
  return item.data?.code
}

function event_count(where: ReturnType<typeof and>) {
  return Database.use((db) => db.select().from(AuditEventTable).where(where).all().length)
}

beforeEach(async () => {
  await resetDatabase()
  seed()
})

afterEach(async () => {
  await resetDatabase()
})

describe("runtime persistence transitions", () => {
  test("run transition writes state and audit event", () => {
    const row = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })

    const next = RuntimeRun.transition({
      id: row.id,
      to: "running",
    })

    expect(next.status).toBe("running")
    expect(typeof next.started_at).toBe("number")

    const events = Database.use((db) =>
      db
        .select()
        .from(AuditEventTable)
        .where(and(eq(AuditEventTable.run_id, row.id), eq(AuditEventTable.event_type, "run.transitioned")))
        .all(),
    )
    expect(events.length).toBe(2)
  })

  test("run create and transition persist workflow linkage and run workspace metadata", () => {
    const row = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
      workflow_id: "workflow/manual",
    })
    expect(row.workflow_id).toBe("workflow/manual")
    expect(row.run_workspace_directory).toBeNull()

    const next = RuntimeRun.transition({
      id: row.id,
      to: "running",
      run_workspace_root: "/tmp/runtime/.origin/runs",
      run_workspace_directory: "/tmp/runtime/.origin/runs/run_runtime",
    })
    expect(next.workflow_id).toBe("workflow/manual")
    expect(next.run_workspace_root).toBe("/tmp/runtime/.origin/runs")
    expect(next.run_workspace_directory).toBe("/tmp/runtime/.origin/runs/run_runtime")

    const run = RuntimeRun.get({
      id: row.id,
    })
    expect(run.workflow_id).toBe("workflow/manual")
    expect(run.run_workspace_root).toBe("/tmp/runtime/.origin/runs")
    expect(run.run_workspace_directory).toBe("/tmp/runtime/.origin/runs/run_runtime")
  })

  test("run candidate and cleanup helpers update markers deterministically", () => {
    const run = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
      workflow_id: "workflow/manual",
    })

    const candidate = RuntimeRun.candidate({
      id: run.id,
      integration_candidate_base_change_id: "base@abc123",
      integration_candidate_change_ids: ["change@1", "change@2"],
      integration_candidate_changed_paths: ["src/file.ts", "README.md"],
    })
    expect(candidate.integration_candidate_base_change_id).toBe("base@abc123")
    expect(candidate.integration_candidate_change_ids).toEqual(["change@1", "change@2"])
    expect(candidate.integration_candidate_changed_paths).toEqual(["src/file.ts", "README.md"])
    expect(candidate.cleanup_failed).toBe(false)

    const cleanup = RuntimeRun.cleanup({
      id: run.id,
      cleanup_failed: true,
    })
    expect(cleanup.cleanup_failed).toBe(true)

    const row = RuntimeRun.get({
      id: run.id,
    })
    expect(row.cleanup_failed).toBe(true)
  })

  test("illegal run transition rejects with machine-readable error and no mutation", () => {
    const row = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })

    try {
      RuntimeRun.transition({
        id: row.id,
        to: "skipped",
        reason_code: "cron_missed_slot",
      })
      throw new Error("expected transition to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeIllegalTransitionError)
      expect(code(error)).toBe("illegal_transition")
    }

    const run = Database.use((db) => db.select().from(RunTable).where(eq(RunTable.id, row.id)).get())
    expect(run?.status).toBe("queued")

    const events = Database.use((db) =>
      db
        .select()
        .from(AuditEventTable)
        .where(and(eq(AuditEventTable.run_id, row.id), eq(AuditEventTable.event_type, "run.transitioned")))
        .all(),
    )
    expect(events.length).toBe(1)
  })

  test("illegal operation transition rejects with machine-readable error and no mutation", () => {
    const run = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })
    const operation = RuntimeOperation.create({
      run_id: run.id,
      workspace_id,
      session_id,
      trigger_type: "manual",
    })

    const before = event_count(and(eq(AuditEventTable.operation_id, operation.id), eq(AuditEventTable.event_type, "operation.transitioned")))

    try {
      RuntimeOperation.transition({
        id: operation.id,
        to: "completed",
      })
      throw new Error("expected operation transition to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeIllegalTransitionError)
      expect(code(error)).toBe("illegal_transition")
    }

    const row = Database.use((db) => db.select().from(OperationTable).where(eq(OperationTable.id, operation.id)).get())
    expect(row?.status).toBe("completed")
    const after = event_count(and(eq(AuditEventTable.operation_id, operation.id), eq(AuditEventTable.event_type, "operation.transitioned")))
    expect(after).toBe(before)
  })

  test("illegal draft transition rejects with machine-readable error and no mutation", () => {
    const draft = RuntimeDraft.create(draft_input())

    const before = event_count(and(eq(AuditEventTable.draft_id, draft.id), eq(AuditEventTable.event_type, "draft.transitioned")))

    try {
      RuntimeDraft.transition({
        id: draft.id,
        to: "sent",
      })
      throw new Error("expected draft transition to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeIllegalTransitionError)
      expect(code(error)).toBe("illegal_transition")
    }

    const row = Database.use((db) => db.select().from(DraftTable).where(eq(DraftTable.id, draft.id)).get())
    expect(row?.status).toBe("pending")
    const after = event_count(and(eq(AuditEventTable.draft_id, draft.id), eq(AuditEventTable.event_type, "draft.transitioned")))
    expect(after).toBe(before)
  })

  test("event validation failure rolls back state change in one transaction", () => {
    const run = RuntimeRun.create({
      workspace_id,
      session_id,
      trigger_type: "manual",
    })

    try {
      Database.transaction((db) => {
        db.update(RunTable).set({ status: "running" }).where(eq(RunTable.id, run.id)).run()
        RuntimeAudit.write(
          {
            event_type: "policy.decision",
            actor_type: "system",
            workspace_id,
            run_id: run.id,
            event_payload: {
              outcome: "allow",
              action: "dispatch",
            },
          },
          db,
        )
      })
      throw new Error("expected audit write to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimePolicyLineageError)
      expect(code(error)).toBe("policy_lineage_required")
    }

    const row = Database.use((db) => db.select().from(RunTable).where(eq(RunTable.id, run.id)).get())
    expect(row?.status).toBe("queued")
  })
})
