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

export const run_trigger_type_values = ["manual", "cron", "signal", "debug", "system"] as const

export const failure_code_values = [
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

export const actor_type_values = ["system", "user"] as const

export const event_type_values = [
  "run.transitioned",
  "operation.transitioned",
  "integration_attempt.transitioned",
  "reconciliation.watchdog",
  "draft.transitioned",
  "policy.decision",
  "dispatch.attempt",
  "dispatch.result",
  "security.setting_changed",
] as const

export const run_status = z.enum(run_status_values)
export const operation_status = z.enum(operation_status_values)
export const draft_status = z.enum(draft_status_values)
export const integration_attempt_state = z.enum(integration_attempt_state_values)
export const run_trigger_type = z.enum(run_trigger_type_values)
export const failure_code = z.enum(failure_code_values)
export const reason_code = z.enum(reason_code_values)
export const actor_type = z.enum(actor_type_values)
export const event_type = z.enum(event_type_values)

export const policy_event_types = ["policy.decision", "dispatch.attempt", "dispatch.result"] as const

export const terminal_run_statuses = new Set<RunStatus>(["completed", "completed_no_change", "failed", "canceled", "skipped"])
export const terminal_operation_statuses = new Set<OperationStatus>(["reverted"])
export const terminal_draft_statuses = new Set<DraftStatus>(["sent", "rejected", "failed"])

export type RunStatus = z.infer<typeof run_status>
export type OperationStatus = z.infer<typeof operation_status>
export type DraftStatus = z.infer<typeof draft_status>
export type IntegrationAttemptState = z.infer<typeof integration_attempt_state>
export type RunTriggerType = z.infer<typeof run_trigger_type>
export type FailureCode = z.infer<typeof failure_code>
export type ReasonCode = z.infer<typeof reason_code>
export type ActorType = z.infer<typeof actor_type>
export type EventType = z.infer<typeof event_type>
