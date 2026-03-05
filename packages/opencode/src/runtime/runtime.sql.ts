import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { SessionTable } from "@/session/session.sql"
import {
  actor_type_values,
  draft_status_values,
  event_type_values,
  failure_code_values,
  integration_attempt_state_values,
  operation_status_values,
  reason_code_values,
  run_status_values,
  run_trigger_type_values,
} from "./contract"

const Timestamps = {
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now())
    .$onUpdate(() => Date.now()),
}

export const RunTable = sqliteTable(
  "run",
  {
    id: text().primaryKey(),
    status: text({ enum: run_status_values }).notNull(),
    trigger_type: text({ enum: run_trigger_type_values }).notNull(),
    workflow_id: text(),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    run_workspace_root: text(),
    run_workspace_directory: text(),
    ready_for_integration_at: integer(),
    failure_code: text({ enum: failure_code_values }),
    reason_code: text({ enum: reason_code_values }),
    integration_candidate_base_change_id: text(),
    integration_candidate_change_ids: text({ mode: "json" }).$type<string[]>(),
    integration_candidate_changed_paths: text({ mode: "json" }).$type<string[]>(),
    cleanup_failed: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    ...Timestamps,
    started_at: integer(),
    finished_at: integer(),
  },
  (table) => [
    index("run_status_idx").on(table.status),
    index("run_session_idx").on(table.session_id),
    index("run_workflow_idx").on(table.workflow_id),
    index("run_cleanup_failed_idx").on(table.cleanup_failed),
    index("run_workspace_status_idx").on(table.workspace_id, table.status),
    index("run_queue_idx").on(table.workspace_id, table.status, table.ready_for_integration_at, table.id),
  ],
)

export const OperationTable = sqliteTable(
  "operation",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    status: text({ enum: operation_status_values }).notNull(),
    trigger_type: text({ enum: run_trigger_type_values }).notNull(),
    workflow_id: text(),
    integration_attempt_id: text(),
    ready_for_integration_at: integer(),
    jj_base_change_id: text(),
    jj_result_change_ids: text({ mode: "json" }).$type<string[]>(),
    jj_operation_ids: text({ mode: "json" }).$type<string[]>(),
    jj_operation_phases: text({ mode: "json" }).$type<string[]>(),
    jj_commit_ids: text({ mode: "json" }).$type<string[]>(),
    changed_paths: text({ mode: "json" }).$type<string[]>(),
    source_operation_id: text().references((): AnySQLiteColumn => OperationTable.id, { onDelete: "set null" }),
    integration_head_change_id_before_apply: text(),
    integration_head_change_id_after_apply: text(),
    ...Timestamps,
  },
  (table) => [
    index("operation_run_idx").on(table.run_id),
    index("operation_workspace_idx").on(table.workspace_id),
    index("operation_status_idx").on(table.status),
    index("operation_source_idx").on(table.source_operation_id),
    index("operation_attempt_idx").on(table.integration_attempt_id),
    uniqueIndex("operation_attempt_uq").on(table.integration_attempt_id),
  ],
)

export const DraftTable = sqliteTable(
  "draft",
  {
    id: text().primaryKey(),
    run_id: text().references(() => RunTable.id, { onDelete: "set null" }),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    status: text({ enum: draft_status_values }).notNull(),
    integration_id: text().notNull(),
    policy_id: text(),
    policy_version: text(),
    decision_id: text(),
    decision_reason_code: text(),
    ...Timestamps,
  },
  (table) => [
    index("draft_workspace_status_idx").on(table.workspace_id, table.status),
    index("draft_run_idx").on(table.run_id),
    index("draft_integration_status_idx").on(table.integration_id, table.status),
    index("draft_policy_lineage_idx").on(table.policy_id, table.policy_version, table.decision_id),
  ],
)

export const IntegrationAttemptTable = sqliteTable(
  "integration_attempt",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    state: text({ enum: integration_attempt_state_values }).notNull(),
    replay_index: integer()
      .notNull()
      .$default(() => 0),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("integration_attempt_run_id_id_uq").on(table.run_id, table.id),
    index("integration_attempt_workspace_state_idx").on(table.workspace_id, table.state),
    index("integration_attempt_run_state_idx").on(table.run_id, table.state),
  ],
)

export const AuditEventTable = sqliteTable(
  "audit_event",
  {
    id: text().primaryKey(),
    event_type: text({ enum: event_type_values }).notNull(),
    actor_type: text({ enum: actor_type_values }).notNull(),
    occurred_at: integer()
      .notNull()
      .$default(() => Date.now()),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    run_id: text().references(() => RunTable.id, { onDelete: "set null" }),
    operation_id: text().references(() => OperationTable.id, { onDelete: "set null" }),
    draft_id: text().references(() => DraftTable.id, { onDelete: "set null" }),
    integration_id: text(),
    integration_attempt_id: text().references(() => IntegrationAttemptTable.id, { onDelete: "set null" }),
    policy_id: text(),
    policy_version: text(),
    decision_id: text(),
    decision_reason_code: text(),
    event_payload: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
  },
  (table) => [
    index("audit_event_workspace_occurred_idx").on(table.workspace_id, table.occurred_at),
    index("audit_event_session_occurred_idx").on(table.session_id, table.occurred_at),
    index("audit_event_run_occurred_idx").on(table.run_id, table.occurred_at),
    index("audit_event_operation_occurred_idx").on(table.operation_id, table.occurred_at),
    index("audit_event_draft_occurred_idx").on(table.draft_id, table.occurred_at),
    index("audit_event_integration_occurred_idx").on(table.integration_id, table.occurred_at),
    index("audit_event_attempt_occurred_idx").on(table.integration_attempt_id, table.occurred_at),
    index("audit_event_type_occurred_idx").on(table.event_type, table.occurred_at),
    index("audit_event_policy_lineage_idx").on(
      table.policy_id,
      table.policy_version,
      table.decision_id,
      table.decision_reason_code,
    ),
  ],
)
