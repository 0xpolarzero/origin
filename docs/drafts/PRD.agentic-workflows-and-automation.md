# PRD: Origin Agentic Workflows and Automation

## Document Status

- Status: Draft for product alignment
- Date: 2026-03-05
- Product: `origin` native desktop app
- Audience: Product, design, engineering
- Execution note: This PRD is design input. Implementation must still be planned and executed via numbered phase specs/logs in `docs/specs/` per `docs/specs/GUIDE.md`.
- Critical scope rule: any `jj`/changeset/checkpoint language in this PRD describes app runtime behavior in user workspaces. It does not instruct implementation agents to run VCS commands in this repository unless explicitly requested for a code contribution task.

## Summary

Origin should evolve from a chat-first coding surface into a local-first personal operations app where users can define workflows, run them manually or automatically, and review all effects safely. The system must stay understandable for non-developers while preserving strong auditability and control.

This PRD defines a workflow-first model with:

- Local desktop execution only (no cloud runtime in this phase)
- Single-user operation
- JJ-tracked workspace state (changesets + operation log) for restorable user-facing changes
- Database-backed runtime/control-plane state
- Origin-only integrations/signals
- Outbound draft review before external writes

The product objective is to make automation powerful and reliable without exposing users to VCS complexity, conflict resolution mechanics, or unsafe external side effects.

## Problem Statement

Today, users can prompt agents in chat, but recurring and structured work lacks first-class primitives. There is no coherent model for:

- Scheduled recurring execution
- External-event-triggered execution
- Reusable resources for workflows
- Human review gates for outbound actions
- Clear separation between "what changed on disk" and "what happened at runtime"

This leads to fragmented behavior, weak auditability, and unclear UX when automation grows beyond ad hoc chats. Users need predictable automation with understandable history and strong control over external effects.

## Why This Matters

Users want to:

- Capture intent once and rerun safely
- See what changed and revert it easily
- Trust that external integrations do not act without explicit control
- Keep all behavior local, private, and inspectable

If Origin provides this in a consumer-friendly way, it can become a dependable daily operations layer, not just a chat surface.

## Product Principles

1. Local-first and explicit: no hidden cloud behavior.
2. Workflow-first: triggerable structured units of automation.
3. Safe outbound model: agent proposes drafts, user controls sending.
4. Human-readable state: YAML and Markdown where appropriate.
5. Auditability without overload: clean operation history plus run telemetry.
6. Hidden complexity: advanced reconciliation/debug sessions run automatically.
7. Strong boundaries: no cross-workspace access; integrations only in Origin workspace.
8. Baseline preservation: existing accepted direction from phase `02` and phase `03` remains in effect unless a future phase spec explicitly supersedes it.

## Goals

1. Enable users to create and run workflows via manual, cron, and signal triggers.
2. Provide reusable Library resources (`query`, `script`, `prompt_template`) with clear "used by" relationships.
3. Ensure file mutations are JJ-tracked, operation-linked, and restorable.
4. Track all runtime activity in DB (`Runs`, `Drafts`, status/notifications).
5. Prevent direct outbound side effects by default through a Drafts inbox.
6. Keep non-origin workspaces useful but intentionally constrained.
7. Keep UX simple for average users while retaining full traceability.

## Non-Goals

1. Cloud-hosted execution or remote control endpoints.
2. Multi-user collaboration and shared ownership semantics.
3. Cross-workspace read/write automation.
4. Full sandboxing in this phase (noted as future requirement).
5. Manual terminal-based VCS workflow support for end users.
6. Best-effort fallback operation when DB is unavailable.

## Target Users

### Primary

- Individuals using Origin as a local personal operations app.
- Users who want automation power without needing deep VCS knowledge.

### Secondary

- Power users who inspect history, customize workflows/resources, and debug behavior.

## Scope by Workspace Type

### Origin Workspace

The Origin workspace is the only workspace with integrations and signals.

Views:

- History
- Drafts
- Workflows
- Library
- Integrations
- Calendar
- Notes
- Knowledge Base

### Non-Origin Workspaces

Constrained local automation, no integrations/signals/outbound drafts.

Views:

- History
- Workflows
- Library
- Knowledge Base

Workspace type is selected at creation (`origin` or `standard`) and is immutable in this phase.
Workspace type must be visible in workspace settings.

## Information Architecture

## History

Tabs:

- Operations: app-level mutation history linked to JJ operation IDs and resulting changesets
- Runs: all execution attempts and outcomes

Operations and Runs must cross-link where relevant.
Default `Operations` filter shows app-authored entries. A source toggle allows including user-authored entries.
Minimum cross-link contract:
- Operation rows linked to a run expose `Open run`.
- Runs with file changes expose `Open operation`.
- Runs that produced drafts expose `Open draft(s)`.

## Drafts

Tabs:

- Pending
- Processed

Drafts represent outbound external actions proposed by agents and controlled by the user.

## Core Concepts

### Workflow

A declarative automation definition with:

- Trigger (`manual`, `cron`, `signal`)
- Steps / instructions
- References to Library resources

Workflows are the top-level automation object.

### Run

A single execution instance of a workflow or trigger context. Runs are DB records and always link to a chat session.

### Operation

A run may produce file mutations. If file changes exist, integration records one app operation for the full top-level run and links it to the corresponding JJ operation entry and resulting changeset IDs.

### Library Resource

Unified reusable resource registry with kinds:

- `query`
- `script`
- `prompt_template`

Availability:

- Origin workspace: all kinds
- Non-origin workspace: `script`, `prompt_template` only

### Draft

A DB record representing a proposed outbound integration action. User can edit, approve, send, reject, or open linked session.

## Data and Storage Model

## Source of Truth Split

- JJ repository state: versioned changesets and operation log
- JJ workspace state: working-copy content and workspace metadata
- DB: runtime/control-plane state (runs, drafts, statuses, notifications, links)

DB availability is mandatory. If DB is unavailable or corrupt, app enters blocking error state and cannot proceed.
Blocking screen must provide these actions:
- `Retry`
- `Open diagnostics`
- `Recovery steps`

## Data Retention

Retention is split to keep user history durable while bounding telemetry growth.

- Core product data is retained without automatic expiry in this phase:
  - workspaces, sessions, runs, operations, drafts, workflows, library resources, settings, linkage records
- Audit/event logs are pruned with default retention of 30 days:
  - lifecycle transitions, policy decisions, notification events, watchdog/debug events
- Integration idempotency keys (`integration_attempt_id`) are retained for at least 90 days to avoid duplicate side effects after crashes/retries.

## File Layout

- `.origin/workflows/*.yaml`
- `.origin/library/*.yaml`
- `.origin/knowledge-base/**`
- `calendar/YYYY-MM.yaml` (Origin workspace only)
- `notes/**/*.md` (Origin workspace only)

All YAML definitions include `schema_version`.

## JJ Runtime Behavior (App-Managed)

- The app bundles and uses a pinned `jj` runtime for all product operations. Runtime behavior must not depend on users having `jj` installed globally.
- Auto-bootstrap JJ metadata in workspaces:
  - If workspace already has JJ metadata, do nothing.
  - If workspace has `.git` but no JJ metadata, initialize JJ in colocated mode without modifying existing git history.
  - If workspace has no VCS metadata, initialize JJ metadata in place without requiring terminal setup.
- Identity write rules (JJ config, repo/workspace-local scope only):
  - If both are missing, set `user.name=origin` and `user.email=origin@local`.
  - If only one field is missing, set only the missing field.
  - Never overwrite existing local identity values.
  - Never write user/global config.
- Create Operations entries only when file content changed.
- No-change runs do not create Operations entries.
- User-authored and app-authored history entries appear in Operations with filtering.

## Operation Metadata

Canonical operation linkage fields are stored in DB and linked to JJ identifiers:

- `operation_id`
- `session_id`
- `run_id`
- `trigger_type`
- `workspace_id`
- `workflow_id` (when applicable)
- `integration_attempt_id`
- `ready_for_integration_at` (immutable after first enqueue)
- `jj_base_change_id`
- `jj_result_change_ids`
- `jj_operation_ids` (ordered append-only list in execution order)
- `jj_operation_phases` (same-length ordered phase labels for `jj_operation_ids`)
- `jj_commit_ids`
- `changed_paths`
- `source_operation_id` (when operation reverts a prior operation)
- `integration_head_change_id_before_apply`
- `integration_head_change_id_after_apply`

ID format: UUIDv7.

## State Models

Canonical status values are explicit and shared across UI and runtime.

- `run.status`: `queued`, `running`, `validating`, `ready_for_integration`, `integrating`, `reconciling`, `cancel_requested`, `completed`, `completed_no_change`, `failed`, `canceled`, `skipped`
- `operation.status`: `completed`, `reverted`
- `draft.status`: `pending`, `blocked`, `approved`, `auto_approved`, `sent`, `rejected`, `failed`

Tab mapping:

- Drafts > Pending includes `pending`, `blocked`, `approved`, and `auto_approved`.
- Drafts > Processed includes `sent`, `rejected`, and `failed`.

## Audit Event Baseline

Audit events are DB records distinct from core product entities.

Required categories in this phase:

- run lifecycle transitions
- integration attempt lifecycle
- reconciliation/debug watchdog notifications and terminal outcomes
- draft lifecycle transitions
- policy decisions for auto-approve and destination/action constraints
- outbound dispatch attempt/result
- security-impacting setting changes (for example auto-approve toggles)

Required fields per event:

- `event_id`
- `occurred_at`
- `workspace_id`
- `session_id`
- `run_id` (when applicable)
- `operation_id` (when applicable)
- `draft_id` (when applicable)
- `integration_id` (when applicable)
- `integration_attempt_id` (when applicable)
- `actor_type` (`system` or `user`)
- `event_type`
- `event_payload`
- `policy_id` (required for policy/dispatch events)
- `policy_version` (required for policy/dispatch events)
- `decision_id` (required for policy/dispatch events)
- `decision_reason_code` (required for policy/dispatch events)

`event_payload` must follow a typed per-event schema and must not include raw secrets/tokens.

## Revert and Restore Semantics

- User-facing `Revert changes` in Operations creates a new app operation by applying the inverse delta of the selected operation in the active workspace (default primitive is JJ revision-level revert semantics).
- User-facing label and helper copy remain non-technical: `Revert changes` means "Creates a new operation that reverses these file changes."
- Revert target set is deterministic: the runtime derives the revision list from `source_operation_id` and applies inverse changes in original integration apply order.
- Default user revert path must not use JJ operation-level commands (`jj op restore`, `jj op revert`, `jj undo`).
- JJ operation-level commands are internal recovery tools and are not the default user-facing revert mechanism.
- A separate optional action `Restore files` may use file/path-scoped restore semantics for explicit file restoration flows.
- If target state is dirty or revert cannot apply cleanly, route to debug flow and expose explicit actions: `Open debug session` and `Stop and report`.

## Execution Model

## Orchestration

- Entry begins with base orchestration agent.
- Trigger-specific runs inject additional system context.
- Subagent delegation is encouraged.
- Every workflow run opens a new chat session thread.

## Mutable Run Lifecycle

1. Run starts and executes in isolated JJ workspace.
2. Agent performs work.
3. End-of-run validation runs.
4. If validation fails, same session receives fix prompt and retries.
5. If final output has file changes, create integration-ready JJ changeset state for that run.
6. Integration gate applies one operation at a time per workspace.
7. If success, operation is recorded in History > Operations.
8. Run finalization always performs run-workspace cleanup.

Run-workspace cleanup rules:

- Cleanup runs in session finalization for all terminal outcomes (`completed`, `completed_no_change`, `failed`, `canceled`, `skipped`).
- Successful integration triggers immediate cleanup for that run workspace.
- App startup runs a janitor pass that removes orphaned temporary run workspaces not linked to active DB runs.
- Cleanup must remove JJ workspace metadata first (equivalent to `jj workspace forget`) before deleting run workspace paths.
- Cleanup is idempotent: missing workspace metadata/path is treated as success and logged as warning telemetry.
- If cleanup still fails, record `cleanup_failed` and retry in startup janitor.

## Concurrency and Reconciliation

- Workflow runs execute in parallel by default in isolated JJ workspaces.
- Integration is serialized per workspace.
- Integration queue order is FIFO by immutable `ready_for_integration_at`.
- If two runs share the same timestamp, tie-break order is lexical `run_id`.
- Retries and reconciliation must not rewrite `ready_for_integration_at`.
- On app restart, queued `ready_for_integration` runs resume in preserved FIFO order.
- If a run is canceled before integration starts, it is removed from integration queue.
- Atomic integration boundary is: JJ integration mutation + DB operation linkage commit.
- Integration attempt identity is created before integration mutation starts (`integration_attempt_id`) and reused for retries/recovery of the same logical attempt.
- (`run_id`, `integration_attempt_id`) must be unique.
- If app restarts during an in-flight integration, startup reconciliation resumes that same integration attempt atomically before processing next queued entries.
- If crash happens after JJ mutation but before DB finalize, startup recovery must finalize linkage for the same `integration_attempt_id` and must not apply a second integration mutation.
- Stale-base is detected when integration head differs from `integration_head_change_id_before_apply` at apply time.
- One mechanical stale-base replay retry is allowed and remains inside the same logical integration attempt (`replay_index` increments on replay) via `workspace update-stale` then re-apply.
- If stale-base replay is exhausted, run fails with `failure_code=stale_base_replay_exhausted`.
- Draft dispatch for the same logical integration attempt must be idempotent (no duplicate external side effects for one successful logical attempt).
- If cancel is requested after integration starts, current integration completes atomically; cancellation applies to subsequent run phases only.
- If file-level conflicts remain, automatic hidden reconciliation session attempts to resolve and complete integration.
- If reconciliation cannot safely merge changes, run terminates with `failed` and failure code `reconciliation_failed`.
- Reconciliation failure must not silently continue; it must expose explicit user actions: `Open debug session` and `Stop and report`.
- Reconciliation monitoring in this phase is time-based only. No heuristic "progress scoring" is required.
- Reconciliation complexity remains abstracted from standard users.
- Reconciliation runs are categorized as debug runs.
- By default, debug runs are excluded from the primary `Runs` list and represented as a compact hidden-count indicator.
- Enabling `Show Debug Sessions` reveals full debug/reconciliation run entries, including status, touched files, and outcomes.

Cancellation outcomes by phase:

- `queued`, `running`, `validating`, `ready_for_integration`: immediate transition to `canceled`.
- `integrating`, `reconciling`: transition to `cancel_requested`, allow current atomic step to finish. If operation linkage was committed, final status is `completed` with `cancel_requested_after_integration_started=true`; otherwise final status is `canceled`.
- If timeout and cancel race, first persisted terminal transition wins; the later event is logged as no-op.

## Long-Running Debug Sessions

Hidden dev/debug sessions (including reconciliation) are monitored by elapsed time only.

- Default threshold: 15 minutes (user-configurable)
- Reminder cadence after keep-running: every 10 minutes
- Default hard stop: 45 minutes elapsed (user-configurable)
- Notification actions:
  - Open debug session
  - Keep running
  - Stop and report

`Keep running` acknowledges the current reminder and keeps the same run active. It does not bypass hard-stop policy.
Reminder text must include remaining time until hard stop.

Hard-stop behavior:

- When hard stop is reached, run transitions to `failed` with `failure_code=reconciliation_timeout`.
- Hard stop is elapsed-time based in this phase and does not depend on heuristic progress signals.

Stop and report supports optional send-to-developers flow.

Default report payload is metadata-only; prompt/file content requires explicit user consent.
Send-to-developers flow must show field-level preview before final consent.
Report payload uses an explicit allowlist and excludes non-allowlisted fields by default.
Report destinations are allowlisted by integration configuration and cannot be overridden by consent UI.

Suggested report artifact path:

- `.origin/reports/<timestamp>-<operation-id>.zip`

Debug/reconciliation runs are hidden by default in `Runs` and can be included via filtering.
`Show Debug Sessions` setting defines default filter state; users can still toggle the filter in-view for the current session.
`Open debug session` actions from notifications must auto-enable debug visibility for that view and focus the target run/session.

## Trigger Semantics

## Manual Trigger

User-invoked workflow execution.

## Cron Trigger

- Uses user timezone
- Missed runs default to skip + notify
- Missed cron slots create a skipped run record in `Runs` with explicit reason metadata.
- Retry default: max 3 with exponential backoff (base 5s, jitter 20%)
- Retry classification:
  - retryable: transient runtime and integration transport failures
  - non-retryable: validation/schema/configuration/policy failures

## Signal Trigger

- Origin workspace only
- No backfill on enable (new events only)
- Requires event dedupe keys (provider event ID/hash) in DB
- Dedupe uniqueness key: `(workspace_id, integration_id, provider_event_id_or_hash)`
- Dedupe retention minimum: 30 days.
- If provider event ID is missing, fallback key is SHA-256 over adapter-defined canonical JSON fields.
- Duplicate signals do not create a new run; they log deterministic `duplicate_event` outcome.
- Duplicate outcomes must be visible in `Runs` as non-error event rows (`Ignored duplicate signal`) with drill-down details.
- Duplicate-event rows are excluded from run-execution counters.

## Drafts and Outbound Safety Model

Outbound writes to integrations do not execute directly from agent reasoning.

Instead:

1. Agent creates draft with integration metadata.
2. Draft appears in Drafts > Pending.
3. User may edit, approve (ready-to-send), send now, reject, or open linked session.
4. After handling with terminal outcome (`sent`, `rejected`, `failed`), draft appears in Drafts > Processed (no expiry).

Per-integration auto-approve exists as a user setting, default OFF.
Auto-approve is constrained by integration policy rules (allowed action classes and destination constraints) defined per integration adapter.
Auto-approved items enter `auto_approved` state in Pending, then move to Processed only after dispatch reaches a terminal outcome.
If auto-approve is enabled but policy rules reject the action/destination, draft remains in `Pending` with machine-readable block reason `policy_blocked`, and no external write occurs.
If policy evaluation cannot complete, decision is default-deny (`blocked`) and no external write occurs.

`blocked` status means the draft cannot be sent yet due to a resolvable gate, such as:

- integration auth disconnected/expired
- destination disallowed by adapter policy
- payload/schema validation failure
- integration temporarily disabled

Blocked drafts remain user-visible with reason and recovery action.

Draft lifecycle and edits are logged as DB events.

Approval invalidation:

- Material edits to destination, action class, or payload after `approved`/`auto_approved` reset draft state to `pending` and require policy re-evaluation.

Outbound dispatch invariants:

- External writes must originate from Draft records only.
- Sender dispatch is allowed only from `approved` or `auto_approved`.
- Dispatch from `pending`, `blocked`, `rejected`, or `failed` is rejected.
- Policy decision metadata is persisted with the draft event trail (`policy_id`, `policy_version`, `decision_id`, `decision_reason_code`).
- Dispatch performs revalidation at send time (policy, destination/action constraints, integration enabled-state, and auth health). Revalidation failures fail closed to `blocked`.
- Draft create/approve/dispatch in non-Origin workspaces is rejected with deterministic reason code `workspace_policy_blocked`.
- Runtime egress policy is strict: managed integration endpoints accept writes only from dispatcher calls that include valid `draft_id` and `integration_attempt_id`; direct agent/tool outbound writes are rejected.
- Non-Origin outbound rejections must surface as visible `Runs` outcomes with remediation hint.

## Validation and Repair

## Agent-Originated Changes

- Validation always runs at end of run.
- If invalid, same session is prompted to repair automatically before completion.

## User-Originated Manual Edits

- Validation is debounced.
- Invalid state is surfaced clearly.

## Runtime Behavior on Invalid Definitions

- Invalid workflow/resource at trigger time: skip run, notify user, log reason in Runs.
- Non-origin workspaces enforce strict capability boundaries. Unsupported config is invalid and non-runnable.
- Unsupported options are hidden in non-origin authoring UI, and manually edited invalid configs are surfaced as explicit validation errors.

## Validation Surface

Fast checks only in this phase:

- YAML parsing
- Schema shape checks
- Reference integrity checks
- Required file existence checks

## Knowledge Base Behavior

- Imported resources are copied inside workspace under `.origin/knowledge-base/**`.
- On path/name collision: prompt with `Replace`, `Create copy`, or `Cancel`.
- For non-interactive automated runs (`cron`, `signal`), collision handling must not block for user input. Default policy is deterministic `Create copy` plus notification.

## Library and Reference Rules

- Workflows may reference Library resources.
- Deleting a referenced resource is blocked until usage is removed.
- Broken references should surface deterministic validation errors and a clear action to open a repair session.

## Settings

Required settings introduced or clarified by this PRD:

1. Debug session visibility:
   - `Show Debug Sessions`
2. Long-running debug threshold:
   - Default 15 minutes, configurable
3. Long-running debug hard stop:
   - Default 45 minutes, configurable
4. Integration auto-approve:
   - Per integration, default OFF

Settings constraints in this phase:

- Debug threshold allowed range: 1..120 minutes.
- Debug hard-stop allowed range: 5..240 minutes.
- Invariant: `hard_stop >= threshold + 1 minute`.

## UX Requirements

1. Keep standard user surfaces non-technical.
2. Hide debug/reconciliation sessions by default.
3. Provide linked navigation between History, Runs, Drafts, Sessions, and JJ-linked operation/change records.
4. Preserve clear distinction:
   - Operations: "what changed on disk"
   - Runs: "what executed"
   - Drafts: "what can be sent externally"

## Security and Trust Guardrails

1. Integrations/signals only in Origin workspace.
2. No cross-workspace access.
3. Agents never read raw integration API keys. Integration calls are brokered by backend adapters that hold credentials and expose only operation APIs to agents.
4. Outbound integration writes are controlled through drafts.
5. Sandboxing is acknowledged as important and explicitly planned later.
6. Monitoring/polling reads over JJ for runtime telemetry must use read-only invocation patterns to avoid unintended working-copy snapshots.
7. Integration credentials are stored only in OS secure secret storage and are never persisted in workspace files, JJ history, core DB rows, draft payloads, or report artifacts.
8. Secrets must be redacted from diagnostics, crash dumps, agent-visible tool output, and exported report payloads.
9. Runtime polling/telemetry commands must use canonical read-only JJ flags (`--ignore-working-copy --at-op=@`) where supported.

## Standard Failure Codes

This phase standardizes these machine-readable outcome codes:

- `reconciliation_failed`
- `reconciliation_timeout`
- `stale_base_replay_exhausted`
- `cleanup_failed`
- `dispatch_revalidation_failed`
- `duplicate_event`
- `workspace_policy_blocked`

## Success Metrics

## Product Health

1. Share of runs that complete without manual intervention.
2. Share of outbound actions routed through Drafts before send.
3. Time-to-resolution for invalid configuration states.
4. Rate of successful restore flows from Operations.
Metric targets, windows, and pass/fail thresholds are defined in numbered phase specs, not in this PRD.

## UX Quality

1. Reduction in user confusion between run state vs file state.
2. Percentage of users who can locate and act on pending drafts without guidance.
3. Drop in visible conflict complexity exposed to non-debug users.
Quantitative UX targets are defined in numbered phase specs.

## Risks and Mitigations

1. Complexity creep from automation features.
Mitigation: strict workspace boundaries, workflow-first model, hidden debug complexity.

2. JJ operation-log/DB divergence concerns.
Mitigation: explicit split of responsibilities, startup reconciliation checks, and strong metadata linking.

3. Integration duplicate events.
Mitigation: required event dedupe keys in DB.

4. Invalid hand-edited YAML.
Mitigation: debounced validation, visible errors, and strict non-runnable handling for invalid definitions.

5. Outbound safety regressions.
Mitigation: Drafts model, default auto-approve OFF, explicit user control.

## Rollout Guidance

Implement in incremental phases mapped to specs, with each phase maintaining:

- Clear acceptance criteria
- Validation commands for touched packages
- Direction updates when scope boundaries change
- Extremely thorough e2e coverage for all new/changed user-facing behavior

Acceptance criteria and validation are the highest-priority correctness gate in phase specs. New features are not complete without objective, reproducible validation, including e2e tests for happy path, regression path, and negative/error path behavior.

This PRD should act as the functional and UX baseline for those specs.

When phase specs discuss JJ operations, changesets, snapshots, or checkpoints, wording must describe app runtime behavior only. Specs must not instruct implementation agents to run VCS history-editing commands or create contribution commits as part of development workflow unless explicitly requested for a code contribution task.

## Final Scope Boundary Recap

Included now:

- Workflow-first automation
- Origin-only integrations/signals
- Unified Library
- Drafts outbound flow
- History split into Operations and Runs
- Hidden automatic reconciliation/debug handling

Explicitly later:

- Cloud endpoint operation
- Full sandboxing model
- Multi-user collaboration
