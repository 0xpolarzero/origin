# Local-First Electric/TanStack Architecture Specs

## Context

The product is a native iOS 18+, macOS, and web personal everything app. The app includes notes, tasks, checklists, recurring jobs, calendar/email metadata, files, and remote AI workflows. The AI runs on server infrastructure and can read/edit the same user data through controlled interfaces, but it must not receive provider tokens or perform irreversible external actions without user approval.

The preferred stack uses Electric/TanStack as the sync foundation:

- Native Apple clients are Swift-only at the UI/app layer.
- Web uses TypeScript and TanStack DB directly.
- Backend is TypeScript with Hono + Effect, Postgres, and Electric.
- Local-first behavior is required for Apple clients and web where feasible.
- Writes go through an application command API, not direct client database writes.

## Top-Level Architecture

```text
Postgres
  -> Electric Postgres Sync
  -> Shape/Auth Proxy
  -> Web: TanStack DB Electric collections
  -> iOS/macOS: Swift Electric client -> GRDB/SQLite

All writes:
  Web/native/AI
  -> Hono + Effect command API
  -> Postgres transaction
  -> op_log + domain tables
  -> return txid
  -> Electric streams accepted state back
```

Electric is the read-sync layer. The command API is the write path. The app should treat Electric as the source of confirmed server state, not as a complete bidirectional local-first framework.

## Core Principles

1. Postgres is the source of truth.
2. Electric streams authorized slices of Postgres state to clients.
3. Every write is a typed command handled by the backend.
4. Clients use optimistic local state, then reconcile when Electric streams the accepted transaction.
5. Apple clients use native SQLite/GRDB, not a hidden local TypeScript runtime.
6. Web uses TanStack DB and Electric collections directly.
7. AI is a constrained actor that reads scoped data and proposes writes.
8. External side effects, such as sending email, require explicit user approval.
9. Provider tokens live only in a token vault/provider proxy.
10. The system keeps an append-only audit trail for user, AI, and sync actions.

## Backend Components

The backend is TypeScript built with Hono and Effect:

```text
Hono:
  HTTP routing
  middleware
  deployment adapter
  request/response boundary

Effect:
  typed services
  dependency injection
  validation boundaries
  retries/timeouts
  structured errors
  operational workflows
```

### Postgres

Postgres stores canonical application state, operation history, approval state, and AI audit metadata.

Initial table groups:

```text
identity:
  users
  devices
  sessions
  workspaces

core data:
  notes
  note_blocks
  tasks
  checklist_items
  projects
  tags
  calendar_items_shadow
  email_threads_shadow
  email_messages_shadow

files:
  files
  file_versions
  file_access_grants

sync:
  op_log
  sync_conflicts
  shape_access_log

AI and approval:
  agent_runs
  agent_context_grants
  proposals
  proposal_patches
  approvals
  audit_log
```

All mutable domain rows should include:

```text
id
workspace_id
created_at
created_by
updated_at
updated_by
version
deleted_at
```

Use client-generated UUIDv7 values for all user-created entities, stored as native Postgres `uuid` values. Do not rely on server-generated IDs for offline-capable records.

### Electric

Electric streams Postgres changes as Shapes.

Responsibilities:

- Connect to Postgres logical replication.
- Serve table/filter-based Shapes.
- Stream initial state and live changes.
- Allow clients to resume from Shape offsets.
- Let clients observe accepted Postgres transactions after writes.

Electric does not own application authorization or write semantics. Those live in the Shape/Auth Proxy and Command API.

### Shape/Auth Proxy

Clients must never call Electric directly.

The proxy exposes application-specific Shape endpoints:

```text
GET /sync/shapes/tasks
GET /sync/shapes/notes
GET /sync/shapes/note-blocks
GET /sync/shapes/checklist-items
GET /sync/shapes/proposals
GET /sync/shapes/files
```

Responsibilities:

- Authenticate user and device.
- Authorize workspace/table/filter access.
- Add server-controlled Shape filters.
- Pass Electric protocol parameters through safely.
- Hide direct Electric URLs from clients.
- Rate limit and audit Shape access.
- Support shape invalidation when permissions change.

The proxy should only expose pre-approved Shape types. Avoid arbitrary client-specified SQL or filters.

### Command API

All mutations go through typed backend commands.

Example endpoints:

```text
POST /commands/create-note
POST /commands/update-note-title
POST /commands/update-note-blocks
POST /commands/create-task
POST /commands/complete-task
POST /commands/reorder-checklist
POST /commands/create-email-draft
POST /commands/propose-agent-change
POST /commands/approve-proposal
POST /commands/reject-proposal
```

Each command request includes:

```json
{
  "op_id": "01J...",
  "device_id": "01J...",
  "workspace_id": "01J...",
  "base_versions": {
    "task:01J...": 12
  },
  "payload": {},
  "idempotency_key": "01J..."
}
```

Each accepted command returns:

```json
{
  "op_id": "01J...",
  "status": "accepted",
  "txid": 123456
}
```

The `txid` is used by clients to wait for the corresponding Postgres transaction to appear in the Electric stream. The command API must write domain rows and `op_log` in the same Postgres transaction.

Command rules:

- Commands are idempotent by `op_id`.
- Commands validate authorization and resource versions.
- Commands return structured conflict/rejection errors.
- Commands never expose raw provider tokens.
- AI-originated writes create proposals unless explicitly approved.

### Operation Log

`op_log` is not the primary UI store, but it is essential for auditability, undo, debugging, AI traceability, and sync diagnostics.

Recommended fields:

```text
op_id
workspace_id
actor_type
actor_id
device_id
command_type
resource_type
resource_id
base_versions_json
payload_json
result_json
txid
created_at
```

## Web Client

Use:

- TanStack Start
- TanStack Router
- TanStack DB
- `@tanstack/electric-db-collection`
- Zod for API and collection schema validation

For each synced domain table, define an Electric collection:

```text
tasksCollection
notesCollection
noteBlocksCollection
proposalsCollection
filesCollection
```

For writes:

```text
TanStack mutation
  -> optimistic update
  -> command API call
  -> command API returns txid
  -> collection waits for txid in Electric stream
  -> optimistic state reconciles or rolls back
```

Web offline support should start with optimistic online writes and durable draft state. Full offline web mutation persistence can be added later if needed.

## iOS/macOS Client

Use:

- Swift 6
- SwiftUI
- Observation
- GRDB
- SQLite WAL mode
- SQLite FTS5
- Custom native Electric Shape client
- Local outbox/reconciler

Do not embed a local Node/Bun/Deno server on iOS. Do not use a hidden WKWebView as the primary data engine. The Apple app should use native SQLite storage and native lifecycle handling.

### Local SQLite Tables

Recommended client table groups:

```text
synced state:
  synced_notes
  synced_note_blocks
  synced_tasks
  synced_checklist_items
  synced_projects
  synced_tags
  synced_proposals
  synced_files

local state:
  local_outbox
  pending_mutations
  local_drafts
  sync_status
  shape_cursors

derived indexes:
  notes_fts
  tasks_fts
  file_chunks
  local_embeddings_metadata
```

SwiftUI should observe local read models through GRDB observations and `@Observable` screen models. Views should never depend directly on HTTP streams.

### Native Electric Client

Build these modules:

```text
ElectricShapeClient
ShapeCursorStore
ShapeMaterializer
SyncCoordinator
OutboxUploader
MutationReconciler
ConflictResolver
```

Required behavior:

- Start initial sync from offset zero.
- Persist Shape handles, offsets, and sync status.
- Resume live sync from stored Shape cursors.
- Apply Shape messages atomically inside GRDB transactions.
- Handle inserts, updates, deletes, and shape resets.
- Deduplicate repeated messages.
- Retry with backoff.
- Refresh auth without corrupting cursors.
- Pause/resume cleanly on app foreground/background.
- Surface degraded/offline/conflict states to UI.

### Local Write Flow

```text
User action
  -> validate locally
  -> insert local_outbox row
  -> update optimistic local state
  -> OutboxUploader calls Command API
  -> Command API returns txid
  -> MutationReconciler waits for Electric stream confirmation
  -> mark mutation confirmed
```

`local_outbox` fields:

```text
op_id
device_id
client_seq
workspace_id
command_type
payload_json
base_versions_json
status
txid
attempts
last_error
created_at
updated_at
```

Statuses:

```text
pending
uploading
accepted
confirmed
rejected
needs_user_resolution
```

Rejected writes must remain visible to the user until resolved. Do not silently discard user work.

## Conflict Strategy

Use simple deterministic merge rules for structured data. Use Automerge CRDT documents for rich note/document bodies.

Recommended defaults:

```text
tasks:
  field-level merge with version checks

checklist completion:
  latest accepted command wins per item status

reordering:
  LexoRank-style string position keys

tags:
  set union for adds, tombstone-aware removes

note metadata:
  version checks with simple field merge

rich note bodies:
  Automerge CRDT documents

email/calendar:
  external side effects go through proposals and approval
```

Keep Automerge CRDT payloads separate from relational metadata. Postgres stores document metadata, permissions, search/indexing state, and sync-visible references to document versions.

## AI and Approval Architecture

The AI service is a constrained actor, not the user.

```text
Agent service
  -> Data Gateway
  -> scoped reads
  -> command/proposal API
  -> user approval
  -> exact approved command executes
```

AI can:

```text
read scoped data
summarize scoped data
draft notes
draft emails
propose task changes
propose calendar changes
propose file edits
```

AI cannot:

```text
read OAuth refresh tokens
send email directly
delete user data directly
call provider APIs directly
commit writes without approval
access arbitrary filesystem paths
```

### Proposals

All AI mutating actions create proposals.

Recommended proposal fields:

```text
proposal_id
workspace_id
agent_run_id
resource_type
resource_id
action_type
before_hash
patch_json
reason
risk_level
status
created_at
expires_at
```

Approval executes a command bound to the exact proposal payload hash. If the proposal changes, approval must be requested again.

### Token Vault and Provider Proxy

Provider credentials live outside the main application database.

Components:

```text
Token Vault
Provider Proxy
Gmail/Microsoft/Calendar connectors
```

Provider Proxy exposes narrow operations:

```text
list_email_headers
get_email_thread
create_email_draft
propose_calendar_event
refresh_calendar_shadow
```

It must not expose:

```text
send_email
raw_oauth_token
unrestricted_provider_api
```

If a provider OAuth scope technically allows sending email, enforce draft-only behavior in the Provider Proxy and approval system.

## Files and Attachments

Use object storage for file bytes and Postgres/Electric for metadata.

Components:

```text
S3/R2-compatible object storage
files table
file_versions table
local Apple file cache
signed upload/download URLs
content hashes
encryption metadata
```

Electric syncs file metadata. File bytes sync separately through signed URLs and local caching.

## Search and AI Retrieval

Use two search layers:

```text
local:
  SQLite FTS5 through GRDB

server:
  Postgres full-text search
  pgvector for embeddings
```

AI retrieval must enforce the same authorization rules as normal data access. Embeddings and chunks must be scoped by user/workspace and data classification.

## Security Requirements

Minimum requirements:

- Device-bound sessions.
- Short-lived access tokens.
- Refresh tokens stored only in secure storage.
- Provider tokens stored only in Token Vault.
- Per-device revocation.
- Server-side authorization for every command and Shape.
- AI capability grants with TTLs and resource scopes.
- Append-only audit log.
- Encrypted local storage where practical.
- Sandboxed agent execution with no inherited secrets.
- Egress allowlists for agent jobs.

Audit log fields:

```text
timestamp
actor_type
actor_id
device_id
agent_run_id
action
resource_type
resource_id
capability_id
policy_decision
approval_id
input_hash
output_hash
txid
```

## Explicit Non-Goals

- Do not use CloudKit as the core source of truth.
- Do not run a local TypeScript server as the primary iOS data layer.
- Do not give AI provider tokens.
- Do not allow AI to send email directly.
- Do not make SwiftUI consume backend events directly.
- Do not make every domain object a CRDT by default. CRDTs are for rich document bodies, not ordinary structured records.

## Main Engineering Risks

1. Native Electric client grows into a full sync framework.
2. Offline write rollback/rebase is more complex than expected.
3. TanStack DB web semantics and native GRDB semantics diverge.
4. Shape permissions become hard to reason about.
5. Automerge integration forces editor and document-schema decisions earlier than the rest of the data model.
6. AI approval UX creates approval fatigue.
7. Provider OAuth scopes are broader than product policy.
8. iOS background execution limits delay sync.
