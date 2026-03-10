import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import {
  actor_type_values,
  block_reason_code_values,
  dispatch_attempt_state_values,
  draft_source_kind_values,
  draft_status_values,
  event_type_values,
  failure_code_values,
  integration_attempt_state_values,
  outbound_auth_state_values,
  operation_status_values,
  reason_code_values,
  run_attempt_status_values,
  run_node_skip_reason_code_values,
  run_node_status_values,
  run_status_values,
  run_trigger_type_values,
  session_link_role_values,
  session_link_visibility_values,
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
    trigger_metadata_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
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
    index("run_workspace_created_idx").on(table.workspace_id, table.created_at, table.id),
    index("run_workspace_trigger_created_idx").on(table.workspace_id, table.trigger_type, table.created_at, table.id),
    index("run_workspace_status_idx").on(table.workspace_id, table.status),
    index("run_queue_idx").on(table.workspace_id, table.status, table.ready_for_integration_at, table.id),
  ],
)

export const WorkflowRevisionTable = sqliteTable(
  "workflow_revision",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workflow_id: text().notNull(),
    file: text().notNull(),
    content_hash: text().notNull(),
    canonical_text: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_revision_project_workflow_created_idx").on(table.project_id, table.workflow_id, table.created_at, table.id),
    index("workflow_revision_project_hash_idx").on(table.project_id, table.content_hash),
  ],
)

export const RunSnapshotTable = sqliteTable(
  "run_snapshot",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    workflow_id: text().notNull(),
    workflow_revision_id: text()
      .notNull()
      .references(() => WorkflowRevisionTable.id, { onDelete: "restrict" }),
    workflow_hash: text().notNull(),
    workflow_text: text().notNull(),
    graph_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    input_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    input_store_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    trigger_metadata_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    resource_materials_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    material_root: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("run_snapshot_run_uq").on(table.run_id),
    index("run_snapshot_workflow_idx").on(table.workflow_id, table.created_at, table.id),
    index("run_snapshot_revision_idx").on(table.workflow_revision_id),
  ],
)

export const RunNodeTable = sqliteTable(
  "run_node",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    snapshot_id: text()
      .notNull()
      .references(() => RunSnapshotTable.id, { onDelete: "cascade" }),
    node_id: text().notNull(),
    kind: text().notNull(),
    title: text().notNull(),
    status: text({ enum: run_node_status_values }).notNull(),
    skip_reason_code: text({ enum: run_node_skip_reason_code_values }),
    output_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    error_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    position: integer().notNull(),
    attempt_count: integer()
      .notNull()
      .$default(() => 0),
    ...Timestamps,
    started_at: integer(),
    finished_at: integer(),
  },
  (table) => [
    uniqueIndex("run_node_run_node_id_uq").on(table.run_id, table.node_id),
    index("run_node_run_position_idx").on(table.run_id, table.position),
    index("run_node_run_status_idx").on(table.run_id, table.status),
    index("run_node_snapshot_idx").on(table.snapshot_id),
  ],
)

export const RunAttemptTable = sqliteTable(
  "run_attempt",
  {
    id: text().primaryKey(),
    run_node_id: text()
      .notNull()
      .references(() => RunNodeTable.id, { onDelete: "cascade" }),
    attempt_index: integer().notNull(),
    status: text({ enum: run_attempt_status_values }).notNull(),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    input_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    output_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    error_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
    started_at: integer(),
    finished_at: integer(),
  },
  (table) => [
    uniqueIndex("run_attempt_node_index_uq").on(table.run_node_id, table.attempt_index),
    index("run_attempt_status_idx").on(table.status),
    index("run_attempt_session_idx").on(table.session_id),
  ],
)

export const RunEventTable = sqliteTable(
  "run_event",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => RunTable.id, { onDelete: "cascade" }),
    run_node_id: text().references(() => RunNodeTable.id, { onDelete: "set null" }),
    run_attempt_id: text().references(() => RunAttemptTable.id, { onDelete: "set null" }),
    sequence: integer().notNull(),
    event_type: text().notNull(),
    payload_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    uniqueIndex("run_event_run_sequence_uq").on(table.run_id, table.sequence),
    index("run_event_run_idx").on(table.run_id, table.sequence),
    index("run_event_node_idx").on(table.run_node_id, table.sequence),
    index("run_event_attempt_idx").on(table.run_attempt_id, table.sequence),
  ],
)

export const SessionLinkTable = sqliteTable(
  "session_link",
  {
    session_id: text()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    role: text({ enum: session_link_role_values }).notNull(),
    visibility: text({ enum: session_link_visibility_values }).notNull(),
    run_id: text().references(() => RunTable.id, { onDelete: "set null" }),
    run_node_id: text().references(() => RunNodeTable.id, { onDelete: "set null" }),
    run_attempt_id: text().references(() => RunAttemptTable.id, { onDelete: "set null" }),
    readonly: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [
    index("session_link_run_idx").on(table.run_id, table.role),
    index("session_link_node_idx").on(table.run_node_id, table.role),
    index("session_link_attempt_idx").on(table.run_attempt_id),
    index("session_link_visibility_idx").on(table.visibility, table.role),
  ],
)

export const WorkflowTriggerTable = sqliteTable(
  "workflow_trigger",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    workflow_id: text().notNull(),
    trigger_type: text({ enum: ["cron", "signal"] }).notNull(),
    trigger_value: text().notNull(),
    timezone: text(),
    enabled_at: integer().notNull(),
    cursor_at: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("workflow_trigger_workspace_workflow_type_uq").on(table.workspace_id, table.workflow_id, table.trigger_type),
    index("workflow_trigger_workspace_type_idx").on(table.workspace_id, table.trigger_type),
    index("workflow_trigger_workspace_value_idx").on(table.workspace_id, table.trigger_type, table.trigger_value),
  ],
)

export const WorkflowSignalDedupeTable = sqliteTable(
  "workflow_signal_dedupe",
  {
    id: text().primaryKey(),
    trigger_id: text()
      .notNull()
      .references(() => WorkflowTriggerTable.id, { onDelete: "cascade" }),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    workflow_id: text().notNull(),
    dedupe_key: text().notNull(),
    provider_event_id: text(),
    fallback_hash: text(),
    event_time: integer().notNull(),
    payload_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    source_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    first_run_id: text().references(() => RunTable.id, { onDelete: "set null" }),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("workflow_signal_dedupe_trigger_key_uq").on(table.trigger_id, table.dedupe_key),
    index("workflow_signal_dedupe_workspace_workflow_idx").on(table.workspace_id, table.workflow_id, table.created_at),
    index("workflow_signal_dedupe_run_idx").on(table.first_run_id),
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
    actor_type: text({ enum: actor_type_values })
      .notNull()
      .$default(() => "system"),
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
    index("operation_workspace_created_idx").on(table.workspace_id, table.created_at, table.id),
    index("operation_workspace_actor_created_idx").on(table.workspace_id, table.actor_type, table.created_at, table.id),
    index("operation_workspace_trigger_created_idx").on(table.workspace_id, table.trigger_type, table.created_at, table.id),
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
    source_kind: text({ enum: draft_source_kind_values }).notNull(),
    adapter_id: text().notNull(),
    integration_id: text().notNull(),
    action_id: text().notNull(),
    target: text().notNull(),
    payload_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    payload_schema_version: integer().notNull(),
    preview_text: text().notNull(),
    material_hash: text().notNull(),
    block_reason_code: text({ enum: block_reason_code_values }),
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
    index("draft_workspace_updated_idx").on(table.workspace_id, table.updated_at, table.id),
    index("draft_policy_lineage_idx").on(table.policy_id, table.policy_version, table.decision_id),
  ],
)

export const OutboundIntegrationTable = sqliteTable(
  "outbound_integration",
  {
    id: text().notNull(),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    adapter_id: text().notNull(),
    enabled: integer({ mode: "boolean" })
      .notNull()
      .$default(() => true),
    auth_state: text({ enum: outbound_auth_state_values }).notNull(),
    allowed_targets: text({ mode: "json" }).notNull().$type<string[]>(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspace_id, table.id] }),
    index("outbound_integration_workspace_adapter_idx").on(table.workspace_id, table.adapter_id),
    index("outbound_integration_workspace_enabled_idx").on(table.workspace_id, table.enabled),
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

export const DispatchAttemptTable = sqliteTable(
  "dispatch_attempt",
  {
    id: text().primaryKey(),
    draft_id: text()
      .notNull()
      .references(() => DraftTable.id, { onDelete: "cascade" }),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    integration_id: text().notNull(),
    state: text({ enum: dispatch_attempt_state_values }).notNull(),
    idempotency_key: text().notNull(),
    remote_reference: text(),
    block_reason_code: text({ enum: block_reason_code_values }),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("dispatch_attempt_draft_uq").on(table.draft_id),
    uniqueIndex("dispatch_attempt_idempotency_key_uq").on(table.idempotency_key),
    index("dispatch_attempt_workspace_state_idx").on(table.workspace_id, table.state),
    index("dispatch_attempt_integration_state_idx").on(table.integration_id, table.state),
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
    adapter_id: text(),
    integration_id: text(),
    action_id: text(),
    dispatch_attempt_id: text().references(() => DispatchAttemptTable.id, { onDelete: "set null" }),
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
    index("audit_event_dispatch_attempt_occurred_idx").on(table.dispatch_attempt_id, table.occurred_at),
    index("audit_event_attempt_occurred_idx").on(table.integration_attempt_id, table.occurred_at),
    index("audit_event_type_occurred_idx").on(table.event_type, table.occurred_at),
    index("audit_event_dispatch_provenance_idx").on(
      table.dispatch_attempt_id,
      table.adapter_id,
      table.integration_id,
      table.action_id,
    ),
    index("audit_event_policy_lineage_idx").on(
      table.policy_id,
      table.policy_version,
      table.decision_id,
      table.decision_reason_code,
    ),
  ],
)
