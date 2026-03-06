import z from "zod"

export const run_status_values = [
  "queued",
  "running",
  "validating",
  "ready_for_integration",
  "integrating",
  "reconciling",
  "cancel_requested",
  "completed",
  "completed_no_change",
  "failed",
  "canceled",
  "skipped",
] as const

export const operation_status_values = ["completed", "reverted"] as const

export const draft_status_values = ["pending", "blocked", "approved", "auto_approved", "sent", "rejected", "failed"] as const

export const integration_attempt_state_values = ["attempt_created", "jj_applied", "db_linked", "finalized"] as const

export const dispatch_attempt_state_values = [
  "created",
  "dispatching",
  "remote_accepted",
  "finalized",
  "failed",
  "blocked",
] as const

export const run_trigger_type_values = ["manual", "cron", "signal", "debug", "system"] as const

export const draft_source_kind_values = ["user", "system", "system_report"] as const

export const outbound_auth_state_values = ["healthy", "missing", "expired"] as const

export const failure_code_values = [
  "manual_start_failed",
  "repair_exhausted",
  "integration_transport_error",
  "transient_runtime_error",
  "integration_timeout",
  "validation_error",
  "schema_error",
  "policy_blocked",
  "reconciliation_failed",
  "reconciliation_timeout",
  "stale_base_replay_exhausted",
  "cleanup_failed",
  "dispatch_revalidation_failed",
  "duplicate_event",
  "workspace_policy_blocked",
  "illegal_transition",
  "audit_payload_rejected",
] as const

export const reason_code_values = [
  "cron_missed_slot",
  "dst_gap_skipped",
  "duplicate_event",
  "policy_blocked",
  "workspace_policy_blocked",
  "material_edit_invalidation",
  "cancel_requested_after_integration_started",
  "retry_exhausted",
  "non_retryable",
  "transition_forbidden",
] as const

export const block_reason_code_values = [
  "material_edit_invalidation",
  "workspace_policy_blocked",
  "policy_blocked",
  "policy_evaluation_failed",
  "schema_invalid",
  "schema_version_unsupported",
  "adapter_action_unregistered",
  "integration_missing",
  "integration_disabled",
  "auth_unhealthy",
  "target_not_allowed",
  "managed_endpoint_rejected",
  "dispatch_context_mismatch",
] as const

export const actor_type_values = ["system", "user"] as const

export const event_type_values = [
  "run.transitioned",
  "operation.transitioned",
  "integration_attempt.transitioned",
  "reconciliation.watchdog",
  "workflow.trigger.outcome",
  "draft.transitioned",
  "policy.decision",
  "dispatch.attempt",
  "dispatch.result",
  "security.setting_changed",
] as const

export const validation_code_values = [
  "yaml_parse_error",
  "schema_invalid",
  "schema_version_unsupported",
  "workspace_capability_blocked",
  "resource_missing",
  "resource_kind_mismatch",
  "reference_broken_link",
  "resource_not_runnable",
  "resource_id_duplicate",
  "workflow_id_duplicate",
  "workflow_missing",
  "workflow_not_runnable",
] as const

export const run_status = z.enum(run_status_values)
export const operation_status = z.enum(operation_status_values)
export const draft_status = z.enum(draft_status_values)
export const integration_attempt_state = z.enum(integration_attempt_state_values)
export const dispatch_attempt_state = z.enum(dispatch_attempt_state_values)
export const run_trigger_type = z.enum(run_trigger_type_values)
export const draft_source_kind = z.enum(draft_source_kind_values)
export const outbound_auth_state = z.enum(outbound_auth_state_values)
export const failure_code = z.enum(failure_code_values)
export const reason_code = z.enum(reason_code_values)
export const block_reason_code = z.enum(block_reason_code_values)
export const actor_type = z.enum(actor_type_values)
export const event_type = z.enum(event_type_values)
export const validation_code = z.enum(validation_code_values)

export const policy_event_types = ["policy.decision", "dispatch.attempt", "dispatch.result"] as const

export const terminal_run_statuses = new Set<RunStatus>(["completed", "completed_no_change", "failed", "canceled", "skipped"])
export const terminal_operation_statuses = new Set<OperationStatus>(["reverted"])
export const terminal_draft_statuses = new Set<DraftStatus>(["sent", "rejected", "failed"])
export const terminal_dispatch_attempt_states = new Set<DispatchAttemptState>(["finalized", "failed", "blocked"])

export type RunStatus = z.infer<typeof run_status>
export type OperationStatus = z.infer<typeof operation_status>
export type DraftStatus = z.infer<typeof draft_status>
export type IntegrationAttemptState = z.infer<typeof integration_attempt_state>
export type DispatchAttemptState = z.infer<typeof dispatch_attempt_state>
export type RunTriggerType = z.infer<typeof run_trigger_type>
export type DraftSourceKind = z.infer<typeof draft_source_kind>
export type OutboundAuthState = z.infer<typeof outbound_auth_state>
export type FailureCode = z.infer<typeof failure_code>
export type ReasonCode = z.infer<typeof reason_code>
export type BlockReasonCode = z.infer<typeof block_reason_code>
export type ActorType = z.infer<typeof actor_type>
export type EventType = z.infer<typeof event_type>
export type ValidationCode = z.infer<typeof validation_code>
