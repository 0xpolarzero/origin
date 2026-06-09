# Local-First PowerSync Apple Architecture Specs

## Context

The product is a native iOS 18+ and macOS personal everything app. The app includes notes, tasks, checklists, recurring jobs, calendar/email metadata, files, and remote AI workflows. The AI runs on server infrastructure and can use fixed tools to read allowed personal data and create drafts or proposals, but it must not receive provider tokens or perform irreversible external actions.

Preferred stack:

- Native Apple clients use SwiftUI, Observation, and the PowerSync Swift SDK.
- Synced local data lives in PowerSync-managed SQLite.
- Backend is TypeScript with Hono + Effect, Postgres, and self-hosted PowerSync.
- Local-first behavior is required for Apple clients.
- Writes go through typed application commands. Native clients store local command-intent rows for user actions, and queued uploads are translated into the same command service used by other trusted server callers.
- Rich document bodies use Automerge CRDTs where concurrent editing is required.

## Top-Level Architecture

```text
Postgres
  -> self-hosted PowerSync
  -> iOS/macOS PowerSync Swift SDK
  -> local SQLite
  -> SwiftUI screen models

iOS/macOS local write
  -> PowerSync local transaction
  -> persistent upload queue
  -> PowerSyncBackendConnector.uploadData()
  -> Hono + Effect command service
  -> Postgres transaction
  -> op_log / conflict / domain rows
  -> PowerSync syncs accepted state back to local SQLite

Remote AI
  -> fixed read tools
  -> proposal API
  -> draft/proposal records
  -> command service
  -> Postgres
```

PowerSync is the native sync and local SQLite upload-queue layer. The command service is the authoritative write path for business rules, user-ownership checks, validation, conflict decisions, and AI-created drafts or proposals.

## Core Principles

1. Postgres is the authoritative server store.
2. PowerSync streams each user's Postgres state to their native Apple clients.
3. PowerSync Swift SDK owns local SQLite sync, reactive reads, queued uploads, retry, and reconnect behavior.
4. Native clients are local-first and observe SQLite, not server streams.
5. Application writes are semantic commands represented locally as command-intent rows.
6. The backend validates all writes before they become authoritative.
7. AI can use fixed read and draft/proposal tools, but cannot access provider tokens or external side-effect tools.
8. Provider tokens never enter AI runtime context.
9. External side effects are not exposed as AI tools.
10. Rich document bodies use CRDTs only where concurrent editing justifies the extra operational cost.

## Backend Components

### Hono + Effect Service

The backend exposes typed HTTP APIs and runs command effects with explicit dependencies.

Responsibilities:

- Authenticate users and devices.
- Check user ownership for every command, read, provider operation, and sync credential request.
- Validate request payloads.
- Execute Postgres transactions.
- Issue short-lived PowerSync credentials.
- Accept PowerSync upload callbacks.
- Run AI read/proposal workflows.
- Execute safe provider operations exposed by the app, such as creating drafts.
- Emit audit records.

Effect boundaries should separate:

- Database access.
- Provider token-store access.
- Provider API calls.
- AI model calls.
- AI tool allowlist checks.
- Audit logging.
- Background job scheduling.

### Postgres

Postgres is the source of truth. The schema should be optimized for server correctness first and local sync second.

Required cross-cutting fields on user-owned domain tables:

```text
id
user_id
created_at
updated_at
deleted_at
created_by_device_id
updated_by_device_id
last_op_id
version
```

Use soft deletes for synced records unless there is a clear retention reason to hard-delete immediately.

Core tables:

```text
users
devices
sessions

notes
note_bodies
tasks
task_lists
projects
events
recurrence_rules
files
file_versions

op_log
sync_conflicts
local_intent_mappings

ai_runs
ai_tool_reads
ai_proposals
ai_proposal_items
approval_requests

provider_accounts
provider_tokens
provider_jobs
provider_action_log

audit_log
sync_access_log
```

Important constraints:

- Every user-owned table must include a tenant key.
- Provider references must be unique per provider account.
- Command idempotency keys must be unique per user or device.
- Approval state transitions must be constrained.
- External side-effect execution must be idempotent.
- `op_log` rows must be written in the same transaction as accepted domain changes.

### PowerSync Service

Self-hosted PowerSync syncs Postgres data into native client SQLite databases.

PowerSync service responsibilities:

- Connect to Postgres with the required replication privileges.
- Serve per-user sync definitions.
- Stream accepted server state to clients.
- Track client progress and resumability.
- Sync only rows and columns that belong in the personal app database.

PowerSync Swift SDK responsibilities:

- Maintain the local SQLite database on iOS and macOS.
- Materialize synced tables.
- Provide reactive watch queries.
- Persist local writes.
- Maintain the upload queue.
- Retry uploads when connectivity returns.
- Call `PowerSyncBackendConnector.uploadData()` for queued writes.

PowerSync does not own application write semantics. The backend connector must translate local command-intent rows into the same command service used by trusted server flows.

### Sync Definitions

PowerSync sync definitions must be registry-backed rather than ad hoc.

Each synced dataset needs:

```text
name
server_source
local_table
user_filter
columns
redactions
tombstone_policy
sort_or_pagination_expectations
offline_write_mode
ai_tool_access
```

Rules:

- A sync definition may expose only rows owned by the authenticated user.
- A sync definition may expose only columns the native app needs.
- Sensitive provider-token data must never be synced.
- Approval records may be synced only at the granularity needed for UI state.
- AI-only internal records should not be synced unless the user-facing app needs them.
- Account revocation or device revocation must stop future sync and command access.

The registry should be checked in CI against command schemas and Postgres migrations so local schema, user ownership, and server command semantics remain aligned.

### Command API

Commands are typed, versioned, idempotent requests.

Example request:

```json
{
  "command": "updateTask",
  "commandId": "018f6f2e-7a44-7c1b-9c26-6ef3f2822f21",
  "deviceId": "dev_123",
  "baseVersion": 12,
  "payload": {
    "taskId": "task_123",
    "title": "Book train",
    "dueAt": "2026-06-12T09:00:00Z"
  }
}
```

Example accepted response:

```json
{
  "status": "accepted",
  "opId": "op_123",
  "affected": [
    { "table": "tasks", "id": "task_123" }
  ]
}
```

Example rejected response:

```json
{
  "status": "rejected",
  "opId": "op_124",
  "reason": "conflict",
  "conflictId": "conflict_123"
}
```

The command service must:

- Authenticate the caller.
- Check that the device belongs to the user and the target records belong to that user.
- Validate payload shape and domain invariants.
- Enforce idempotency with `commandId`.
- Apply deterministic conflict rules.
- Write domain rows and `op_log` in one transaction when accepted.
- Write `sync_conflicts` or rejected `op_log` entries when permanently rejected.
- Emit audit events for sensitive commands.

Native clients confirm command completion by observing synced `op_log`, affected domain rows, or `sync_conflicts`. Server transaction identifiers may be stored for diagnostics, but they are not a client confirmation primitive in this architecture.

### Operation Log

`op_log` is the durable bridge between command execution, local status, auditability, and sync confirmation.

Suggested fields:

```text
id
user_id
device_id
command_id
command_name
actor_type
actor_id
status
affected_records
base_versions
result_summary
rejection_reason
conflict_id
created_at
committed_at
server_transaction_id
```

Status values:

```text
accepted
rejected
superseded
requires_approval
executed_external_action
failed_external_action
```

`server_transaction_id` is optional diagnostic metadata. Client UI state should not depend on it.

### PowerSync Upload Handling

The native connector should upload local command-intent rows:

```text
local command-intent row
  -> read complete intent payload
  -> call command service
  -> accepted: mark upload processed
  -> permanent rejection: write synced conflict/rejection and mark upload processed
  -> retryable failure: throw so PowerSync retries
```

Permanent rejection must not poison the upload queue. The user still needs visibility into rejected work, so rejection state must be represented in synced data or durable local-only state.

Use command-intent rows for every user action, including simple edits. This avoids two write architectures and gives the app one consistent place to store user intent, idempotency, base version, optimistic UI state, conflict context, and approval/provider metadata.

Command-intent rows are especially important for:

- Renaming records.
- Editing fields.
- Rescheduling recurring tasks.
- Applying template changes.
- Merging document heads.
- Approving external actions.
- Provider-backed create/update/delete flows.
- AI proposal acceptance.
- Any action that needs a structured conflict explanation.

## iOS/macOS Client

### Native Stack

Use:

- Swift 6.
- SwiftUI.
- Observation.
- PowerSync Swift SDK.
- PowerSync-managed SQLite.
- Keychain for credentials.
- Local file cache.
- SQLite FTS for local search where compatible with the PowerSync database.

Avoid:

- A local Node/Bun/Deno service.
- A hidden cross-platform runtime as the primary data engine.
- A second app-owned sync queue for the same records.
- A custom SQLite materializer for synced server tables.
- Additional SQLite frameworks unless a specific PowerSync limitation is proven.

### Local Tables

PowerSync synced tables:

```text
notes
note_bodies
tasks
task_lists
projects
events
files
file_versions
op_log
sync_conflicts
approval_requests
ai_proposals
provider_accounts
provider_action_log
```

Native local-only tables:

```text
drafts
local_ui_state
local_file_cache
local_search_index
local_embedding_cache_metadata
local_notification_state
local_command_intents
```

Local-only tables should never contain provider refresh tokens or long-lived access tokens.

### Read Model

SwiftUI should observe local read models through PowerSync watch queries and `@Observable` screen models. Views should not depend directly on sync streams or HTTP requests.

Read flow:

```text
PowerSync synced table
  -> watch query
  -> repository/read model
  -> @Observable screen model
  -> SwiftUI view
```

Screen models should expose:

- Data rows.
- Local pending status.
- Last accepted operation status.
- Conflict state.
- Approval state.
- Provider execution state.
- File upload/download state.

### Native PowerSync Modules

Recommended modules:

```text
PowerSyncDatabaseProvider
PowerSyncCredentialProvider
PowerSyncConnector
CommandMapper
CommandClient
SyncStatusStore
ConflictStore
ApprovalStore
FileCache
SearchIndex
```

Responsibilities:

- Open the PowerSync database.
- Connect to the self-hosted PowerSync endpoint with short-lived credentials.
- Map local writes to typed backend commands.
- Use watch queries for reactive reads.
- Let PowerSync maintain SQLite materialization and upload queue state.
- Surface upload status and command status to the UI.
- Reconcile permanent rejections into conflict UI.

### Local Write Flow

```text
User edits task
  -> screen model validates local input
  -> repository writes local command-intent row
  -> PowerSync stores the write and updates local UI immediately
  -> PowerSync upload queue calls uploadData()
  -> connector maps mutation to command
  -> command service validates and commits or rejects
  -> PowerSync syncs accepted state, op_log, or conflict back
  -> UI reconciles pending status
```

Required UI states:

```text
local_only
queued
uploading
accepted
rejected_conflict
requires_approval
provider_pending
provider_executed
provider_failed
```

Rejected writes must remain visible until resolved. Do not silently discard user work.

### Lifecycle and Storage

iOS sync is foreground-first. The app must not rely on continuous background networking.

Required behavior:

- On foreground, connect PowerSync and flush queued writes.
- On background, save drafts and stop long-running work cleanly.
- Use background tasks only for short catch-up windows.
- Use background URLSession for file uploads/downloads where appropriate.
- Persist notification scheduling state locally.
- Persist approval and conflict state locally through synced or local-only tables.
- Define file protection classes for the PowerSync database, WAL/SHM files, drafts, attachment cache, FTS indexes, and metadata caches.

Recommended protection:

- Use complete-until-first-user-authentication for sync data that should be available after reboot unlock.
- Use stronger protection for highly sensitive local-only caches if product requirements allow.
- Do not store provider tokens in local files.

## Conflict Strategy

### Structured Records

Use command-specific rules.

Examples:

```text
task.title
  -> last accepted edit wins if base version matches
  -> conflict if two offline edits both change title from same base and both contain non-empty different values

task.completed_at
  -> completion is monotonic unless user explicitly reopens

recurrence rule
  -> no blind merge; conflicting edits require explicit resolution

provider event
  -> provider version and local base version must both match before execution
```

Every command must declare:

- Required base versions.
- Merge policy.
- Rejection policy.
- Whether a conflict row is created.
- Whether user approval is required.

### Rich Documents

Use Automerge for rich note/document bodies. Do not use Automerge for ordinary rows.

Document model:

- The Automerge document contains the body content only.
- Use Automerge's rich-text model for marks and block markers.
- Metadata stays relational: title, folder, tags, task links, file references, timestamps, and delete state.
- Attachments are file rows referenced by ID from the body. Do not embed binary files in Automerge.

Native editor:

- Use `UITextView`/TextKit on iOS and `NSTextView`/TextKit on macOS, wrapped for SwiftUI.
- Build a small adapter between native attributed text operations and the Automerge rich-text model.
- Do not make a third-party editor library the storage format.

Server tables:

```text
note_bodies
  note_id
  user_id
  current_snapshot
  snapshot_format_version
  heads
  extracted_text
  compacted_at
  updated_at

note_body_changes
  id
  note_id
  user_id
  command_id
  device_id
  change_bytes
  created_at
```

Command flow:

```text
native edit
  -> native editor adapter produces Automerge change bytes
  -> local command-intent row stores update_note_body
  -> PowerSync uploads command intent
  -> backend loads current body heads
  -> backend applies Automerge changes
  -> backend appends note_body_changes
  -> backend updates note_bodies heads and extracted_text
  -> PowerSync syncs accepted body rows back
```

Compaction:

- Compact on the server, not in the editor.
- Run compaction after a threshold such as many changes or large accumulated change bytes.
- Compaction writes a new `current_snapshot`, updates `heads`, and keeps enough recent changes for syncing/debugging.
- Clients rebuild local body state from the latest snapshot plus later changes.

Search extraction:

- Extract plain text from the accepted Automerge document on the backend.
- Store extracted text in `note_bodies.extracted_text`.
- Sync extracted text for local SQLite FTS.

Limits:

- Put large attachments in file storage, not in Automerge.
- Add a per-document size limit before enabling rich documents broadly.
- If native Automerge rich-text support blocks implementation, fall back to plain-text Automerge bodies before adding a custom rich-text editor.

## AI and Approval Architecture

### AI Harness and Tool Model

Use Better Agent as the product AI harness inside the Hono + Effect backend.

The harness owns:

- Model calls.
- Typed tool registry.
- Tool-call loop.
- Streaming events.
- Run status.
- Transcript capture.
- Structured output validation.
- Cancellation and timeout handling.

The AI can only do what the backend exposes as fixed tools. There is no general provider API tool and no policy engine in the first version.

Initial AI tools should be explicit and narrow:

```text
search_personal_data
read_note
read_task
create_note_proposal
create_task_proposal
create_email_draft
explain_proposal
```

Each AI tool call must record:

```text
user_id
tool_name
input_summary
records_read
records_written
run_id
created_at
```

Transcript tables:

```text
ai_runs
  id
  user_id
  status
  model
  harness
  prompt_template_version
  started_at
  finished_at
  error

ai_messages
  id
  run_id
  role
  visible_text
  collapsed_summary
  created_at

ai_tool_calls
  id
  run_id
  tool_name
  input_summary
  result_summary
  records_read
  records_written
  created_at
```

Rules:

- AI tools may read the user's personal app data.
- AI tools may create drafts or proposals.
- AI tools may not read provider tokens.
- AI tools may not send email.
- AI tools may not delete email.
- AI tools may not send calendar invitations.
- AI tools may not call arbitrary provider APIs.
- Tool implementations must redact secrets and limit result size.
- Tool implementations must treat retrieved user/provider content as data, not instructions.
- Provider tokens and raw secrets must never be passed into Better Agent.
- Hidden system/developer instructions are not user-visible transcript records.
- Chain-of-thought is not stored as transcript. If a provider returns reasoning summaries, store them only as collapsed/debug metadata.
- Provider tool results must be normalized app data, not raw provider API payloads.

### AI Proposals

AI proposed writes are stored as proposals, not applied directly.

Tables:

```text
ai_runs
ai_proposals
ai_proposal_items
approval_requests
```

Proposal item fields:

```text
id
proposal_id
command_name
command_payload
target_records
risk_level
requires_approval
explanation
status
created_at
```

Status values:

```text
draft
presented
approved
rejected
expired
applied
failed
```

AI proposals should classify:

- Pure local data changes.
- Reversible local changes.
- Destructive local changes.
- Provider reads.
- Safe provider drafts.

Irreversible provider actions are out of scope because the AI has no tool for them.

### Approval Execution

```text
User approves proposal
  -> approval command
  -> command service applies local data changes
  -> provider service creates safe drafts if needed
  -> provider_action_log records result
  -> op_log records final state
  -> PowerSync syncs state to native clients
```

Approval must be checked at execution time, not only at proposal creation time. The target record or provider account may have changed.

## Provider Tokens and External Actions

Provider tokens live only in a first-party server-side token store. For the first version, this should be a `provider_tokens` table with encrypted token material, backend-only access, and audit logging around refresh and use.

Requirements:

- AI runtime cannot read access tokens or refresh tokens.
- Native clients do not store provider refresh tokens.
- Provider service performs token refresh.
- Provider service exposes only safe app-defined operations.
- Provider service writes provider operation logs.
- Provider actions are idempotent where possible.
- Provider responses are normalized before being sent to AI.

Provider draft flow:

```text
draft command
  -> provider job
  -> provider token lookup
  -> provider API call
  -> provider_action_log
  -> domain metadata update
  -> op_log
```

Operations not exposed to AI:

- Sending email.
- Deleting email.
- Creating, updating, or deleting calendar events with attendees.
- Changing provider account settings.
- Sharing files.

If these actions are added later, they must be designed as separate user-driven flows, not hidden behind the initial AI tool set.

## Files and Attachments

PowerSync syncs file metadata. File bytes sync separately through signed URLs and native local caching.

File metadata fields:

```text
id
user_id
name
mime_type
size
sha256
storage_key
thumbnail_key
upload_status
download_status
created_at
updated_at
deleted_at
```

File upload flow:

```text
native selects file
  -> create local metadata row
  -> upload bytes through signed URL or background URLSession
  -> backend verifies hash and size
  -> command service marks file available
  -> PowerSync syncs metadata
```

Rules:

- Do not store large binary content in PowerSync tables.
- Do not store large binary content in Automerge documents.
- Store local cache paths only in local-only tables.
- Verify hash and size server-side.
- Clean up orphaned uploads.

## Search and AI Retrieval

Local search:

- SQLite FTS over synced text and extracted document text.
- Local filters for status, date, tags, and record type.
- Local snippets cached for offline use.

Server search:

- Cross-device indexed search.
- AI retrieval.
- Provider-enriched metadata.
- Embeddings where appropriate.

AI retrieval must:

- Check user ownership.
- Use only fixed AI read tools.
- Apply redaction.
- Log access.
- Avoid returning provider tokens.

## Security Requirements

### Authentication and Sessions

- Device-bound sessions.
- Short-lived access tokens.
- Refresh rotation.
- Revocation by device.
- Separate credentials for sync, command API, and provider connection flows where useful.
- Keychain storage for native session secrets.

### Ownership and Tool Boundaries

- Server-side user-ownership checks for every command and sync definition.
- No client-selected row filters that can broaden access.
- No synced provider tokens.
- AI access is limited by fixed tool implementations.
- Provider operations are limited by fixed provider tools.

### Audit

Audit log required for:

- AI reads.
- AI proposals.
- Approval decisions.
- Provider token refresh.
- Provider draft operations.
- Sensitive commands.
- Sync credential issuance.

Audit records should include:

```text
actor_type
actor_id
user_id
action
target_type
target_id
risk_level
decision
ip_or_device_context
created_at
```

### Prompt Injection

Any user or provider content read by AI may be hostile.

Controls:

- Treat retrieved content as data, not instructions.
- Keep system instructions outside retrieved content.
- Require structured tool/proposal outputs.
- Do not expose risky external-action tools to the AI.
- Log source records used in proposals.

## Explicit Non-Goals

- No non-Apple client in this architecture pass.
- No CloudKit source of truth.
- No peer-to-peer sync.
- No direct client writes to Postgres.
- No local TypeScript service as the primary iOS data layer.
- No custom sync protocol around PowerSync unless a specific limitation is proven.
- No AI token access.
- No AI tools for irreversible external provider side effects.

## Main Engineering Risks

1. PowerSync sync definitions and command ownership checks drift.
2. Command-intent payloads lose details needed for conflict resolution.
3. Permanent upload rejection blocks the PowerSync upload queue.
4. Extra local database layers overlap with PowerSync-managed database ownership.
5. AI tools become too broad or start exposing unsafe provider actions.
6. Provider-token isolation is weakened by convenience shortcuts.
7. Prompt injection causes unsafe proposals or data leakage.
8. Automerge native editor adapter, compaction, and search extraction are underestimated.
9. iOS background execution limits delay sync and provider work.
10. File protection classes and local cache retention are not specified early.

## Open Decisions

1. How much approval state should sync to the native client.
2. Which records are available to AI by default.
3. Which file protection classes apply to each local store.

## Recommended Defaults

- Use PowerSync as the only native sync substrate.
- Use command-intent rows for every local user action.
- Confirm writes through synced `op_log`, domain rows, or `sync_conflicts`.
- Keep additional SQLite frameworks out of scope until a specific PowerSync limitation is proven.
- Use Automerge only for rich document bodies, stored as snapshots plus change rows.
- Keep provider tokens in a first-party encrypted server-side token store and expose only fixed, safe provider tools to AI.
- Treat iOS background sync as opportunistic, not guaranteed.
