import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { eq } from "drizzle-orm"
import path from "path"
import { readFileSync, readdirSync } from "fs"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { AuditEventTable } from "../../src/runtime/runtime.sql"

function migrations() {
  const dir = path.join(import.meta.dirname, "../../migration")
  return readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => ({
      timestamp: Number(item.name.split("_")[0]),
      sql: readFileSync(path.join(dir, item.name, "migration.sql"), "utf-8"),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

describe("runtime migration forward-apply and backfill safety", () => {
  test("applies new runtime migration on existing local state without reset", () => {
    const list = migrations()
    const latest = list[list.length - 1]
    const prior = list.slice(0, -1)
    if (!latest) throw new Error("expected at least one migration")

    const sqlite = new Database(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    const db = drizzle({ client: sqlite })

    migrate(db, prior)

    const now = Date.now()
    db.insert(ProjectTable)
      .values({
        id: "proj_forward",
        worktree: "/tmp/forward",
        vcs: "git",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()

    db.insert(WorkspaceTable)
      .values({
        id: "wrk_forward",
        project_id: "proj_forward",
        branch: "main",
        config: {
          type: "worktree",
          directory: "/tmp/forward",
        },
      })
      .run()

    db.insert(SessionTable)
      .values({
        id: "ses_forward",
        project_id: "proj_forward",
        workspace_id: "wrk_forward",
        parent_id: null,
        slug: "forward",
        directory: "/tmp/forward",
        title: "forward",
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

    migrate(db, [latest])

    const project = db.select().from(ProjectTable).where(eq(ProjectTable.id, "proj_forward")).get()
    const session = db.select().from(SessionTable).where(eq(SessionTable.id, "ses_forward")).get()
    const workspace = db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, "wrk_forward")).get()

    expect(project?.id).toBe("proj_forward")
    expect(session?.id).toBe("ses_forward")
    expect(workspace?.id).toBe("wrk_forward")

    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((item) => (item as { name: string }).name)

    expect(tables).toContain("run")
    expect(tables).toContain("operation")
    expect(tables).toContain("draft")
    expect(tables).toContain("integration_attempt")
    expect(tables).toContain("audit_event")

    sqlite.close()
  })

  test("legacy-style audit rows without policy lineage remain insertable for non-policy events", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    const db = drizzle({ client: sqlite })
    migrate(db, migrations())

    const now = Date.now()
    db.insert(ProjectTable)
      .values({
        id: "proj_backfill",
        worktree: "/tmp/backfill",
        vcs: "git",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(WorkspaceTable)
      .values({
        id: "wrk_backfill",
        project_id: "proj_backfill",
        branch: "main",
        config: {
          type: "worktree",
          directory: "/tmp/backfill",
        },
      })
      .run()

    db.insert(AuditEventTable)
      .values({
        id: "018f3c19-89f7-7c8e-b72f-0ef4f34a53e7",
        event_type: "run.transitioned",
        actor_type: "system",
        occurred_at: now,
        workspace_id: "wrk_backfill",
        session_id: null,
        run_id: null,
        operation_id: null,
        draft_id: null,
        integration_id: null,
        integration_attempt_id: null,
        policy_id: null,
        policy_version: null,
        decision_id: null,
        decision_reason_code: null,
        event_payload: {
          from: "queued",
          to: "running",
        },
      })
      .run()

    const rows = db.select().from(AuditEventTable).all()
    expect(rows.length).toBe(1)
    expect(rows[0].policy_id).toBeNull()

    sqlite.close()
  })
})
