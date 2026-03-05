import { describe, expect, test } from "bun:test"
import { create_migrated_db } from "../fixture/migration"

function names(sqlite: ReturnType<typeof create_migrated_db>["sqlite"], table: string) {
  return sqlite
    .query(`PRAGMA table_info(${table})`)
    .all()
    .map((item) => (item as { name: string }).name)
}

function indexes(sqlite: ReturnType<typeof create_migrated_db>["sqlite"], table: string) {
  return sqlite
    .query(`PRAGMA index_list(${table})`)
    .all()
    .map((item) => (item as { name: string }).name)
}

function with_db(cb: (db: ReturnType<typeof create_migrated_db>) => void) {
  const db = create_migrated_db()
  try {
    cb(db)
  } finally {
    db.sqlite.close()
  }
}

describe("runtime contract migration shape", () => {
  test("creates runtime contract tables", () => {
    with_db((state) => {
      const tables = state.sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((item) => (item as { name: string }).name)

      expect(tables).toContain("run")
      expect(tables).toContain("operation")
      expect(tables).toContain("draft")
      expect(tables).toContain("integration_attempt")
      expect(tables).toContain("audit_event")
    })
  })

  test("run table includes required columns and indexes", () => {
    with_db((state) => {
      const cols = names(state.sqlite, "run")
      expect(cols).toEqual([
        "id",
        "status",
        "trigger_type",
        "workspace_id",
        "session_id",
        "ready_for_integration_at",
        "failure_code",
        "reason_code",
        "created_at",
        "updated_at",
        "started_at",
        "finished_at",
      ])

      const idx = indexes(state.sqlite, "run")
      expect(idx).toContain("run_status_idx")
      expect(idx).toContain("run_workspace_status_idx")
      expect(idx).toContain("run_queue_idx")
    })
  })

  test("operation table includes required PRD linkage columns", () => {
    with_db((state) => {
      const cols = names(state.sqlite, "operation")
      expect(cols).toContain("source_operation_id")
      expect(cols).toContain("session_id")
      expect(cols).toContain("trigger_type")
      expect(cols).toContain("workflow_id")
      expect(cols).toContain("integration_attempt_id")
      expect(cols).toContain("ready_for_integration_at")
      expect(cols).toContain("jj_base_change_id")
      expect(cols).toContain("jj_result_change_ids")
      expect(cols).toContain("jj_operation_ids")
      expect(cols).toContain("jj_operation_phases")
      expect(cols).toContain("jj_commit_ids")
      expect(cols).toContain("changed_paths")
      expect(cols).toContain("integration_head_change_id_before_apply")
      expect(cols).toContain("integration_head_change_id_after_apply")
    })
  })

  test("draft table includes lifecycle and policy lineage columns", () => {
    with_db((state) => {
      const cols = names(state.sqlite, "draft")
      expect(cols).toContain("run_id")
      expect(cols).toContain("workspace_id")
      expect(cols).toContain("status")
      expect(cols).toContain("integration_id")
      expect(cols).toContain("policy_id")
      expect(cols).toContain("policy_version")
      expect(cols).toContain("decision_id")
      expect(cols).toContain("decision_reason_code")
    })
  })

  test("integration_attempt table has required state and uniqueness indexes", () => {
    with_db((state) => {
      const cols = names(state.sqlite, "integration_attempt")
      expect(cols).toContain("id")
      expect(cols).toContain("run_id")
      expect(cols).toContain("workspace_id")
      expect(cols).toContain("state")
      expect(cols).toContain("replay_index")

      const idx = indexes(state.sqlite, "integration_attempt")
      expect(idx).toContain("integration_attempt_run_id_id_uq")
      const unique = state.sqlite
        .query("PRAGMA index_info(integration_attempt_run_id_id_uq)")
        .all()
        .map((item) => (item as { name: string }).name)
      expect(unique).toEqual(["run_id", "id"])
    })
  })

  test("audit_event table includes required baseline fields and lineage lookup indexes", () => {
    with_db((state) => {
      const cols = names(state.sqlite, "audit_event")
      expect(cols).toContain("event_type")
      expect(cols).toContain("actor_type")
      expect(cols).toContain("occurred_at")
      expect(cols).toContain("workspace_id")
      expect(cols).toContain("run_id")
      expect(cols).toContain("operation_id")
      expect(cols).toContain("draft_id")
      expect(cols).toContain("integration_attempt_id")
      expect(cols).toContain("policy_id")
      expect(cols).toContain("policy_version")
      expect(cols).toContain("decision_id")
      expect(cols).toContain("decision_reason_code")
      expect(cols).toContain("event_payload")

      const idx = indexes(state.sqlite, "audit_event")
      expect(idx).toContain("audit_event_policy_lineage_idx")
      expect(idx).toContain("audit_event_type_occurred_idx")
      expect(idx).toContain("audit_event_workspace_occurred_idx")
    })
  })

  test("run queue ordering key immutability trigger exists", () => {
    with_db((state) => {
      const triggers = state.sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all()
        .map((item) => (item as { name: string }).name)

      expect(triggers).toContain("run_ready_for_integration_at_immutable")
    })
  })
})
