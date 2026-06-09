# Local-First App Architecture Design

## Summary

We are building a personal everything app for iOS, macOS, and web. It should feel instant, work offline, sync across devices, and let a remote AI assistant read and propose changes to the same data without receiving private provider tokens or performing risky actions directly.

The proposed architecture uses:

- **Postgres** as the source of truth.
- **Electric** to stream confirmed Postgres state to clients.
- **TanStack DB** for the web client.
- **SwiftUI + GRDB/SQLite** for iOS and macOS.
- **A Hono + Effect TypeScript command API** for every write.
- **A proposal/approval system** for AI-originated changes.

Electric is used for read sync. Writes are handled by our backend, validated, committed to Postgres, and then streamed back through Electric.

## Goals

- Native iOS and macOS apps written in Swift.
- A first-class web app using the same backend model.
- Local-first UX: fast reads, optimistic edits, and offline-capable native clients.
- Server-side AI that can safely work with user data.
- Clear security boundaries around tokens, external actions, and AI writes.
- A simple, inspectable data model based on Postgres.
- A sync design that can be debugged and reasoned about.

## Non-Goals

- We are not using CloudKit as the primary source of truth.
- We are not running a local TypeScript server inside the iOS app.
- We are not letting clients write directly to Postgres.
- We are not letting the AI send email, delete data, or use provider tokens directly.
- We are not making every object a CRDT by default. CRDTs are for rich document content, not ordinary structured records.

## Architecture

```text
                 +----------------+
                 |    Postgres    |
                 +--------+-------+
                          |
                          v
                 +----------------+
                 |    Electric    |
                 +--------+-------+
                          |
              +-----------+-----------+
              |                       |
              v                       v
   +--------------------+   +----------------------+
   | Web: TanStack DB   |   | iOS/macOS: Swift UI  |
   | Electric collections|  | GRDB + SQLite        |
   +--------------------+   +----------------------+

All writes:

Client or AI
  -> Command API
  -> Postgres transaction
  -> Electric stream
  -> Clients reconcile local state
```

The important idea is that the UI does not wait on the server for every interaction. Clients update local optimistic state first, send a command to the backend, then reconcile when Electric streams the accepted Postgres transaction.

## Backend

The backend is TypeScript built with Hono and Effect. Hono owns HTTP routing and deployment ergonomics. Effect owns typed services, dependency injection, validation boundaries, retries, error modeling, and operational workflows.

### Postgres

Postgres stores canonical data:

- Notes, tasks, checklists, tags, projects.
- Calendar and email metadata.
- File metadata.
- AI runs and proposals.
- Audit events.
- Operation history.

Every user-created object should use a client-generated **UUIDv7**, stored as a native Postgres `uuid`. This avoids a class of offline problems where the client creates temporary IDs and later has to remap them to server IDs, while preserving useful time ordering for debugging and sync diagnostics.

Mutable rows should include versioning and soft-delete fields:

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

### Electric

Electric streams authorized Postgres changes to clients as Shapes.

Electric does not decide who can see data and does not handle writes. We put a proxy in front of it so clients can only subscribe to approved shapes.

### Shape/Auth Proxy

Clients call our proxy, not Electric directly.

The proxy is responsible for:

- Authentication.
- Authorization.
- Applying server-controlled filters.
- Passing Electric cursor parameters through safely.
- Auditing shape access.
- Hiding Electric internals.

Example routes:

```text
GET /sync/shapes/notes
GET /sync/shapes/tasks
GET /sync/shapes/checklist-items
GET /sync/shapes/files
GET /sync/shapes/proposals
```

### Command API

All writes go through typed commands.

Example commands:

```text
create_note
update_note_title
update_note_blocks
create_task
complete_task
reorder_checklist
create_email_draft
propose_agent_change
approve_proposal
reject_proposal
```

Each command is idempotent and includes:

```text
op_id
device_id
workspace_id
base_versions
payload
```

The backend validates the command, writes domain rows and an operation log entry in one Postgres transaction, then returns the transaction ID. Clients use that transaction ID to know when Electric has streamed the confirmed change back.

## Web Client

The web app uses TanStack Start, TanStack Router, TanStack DB, Electric collections, and Zod for API/schema validation.

Flow:

```text
User edits
  -> TanStack optimistic mutation
  -> Command API
  -> API returns Postgres transaction ID
  -> TanStack waits for Electric confirmation
  -> optimistic state is confirmed or rolled back
```

This is the simplest client because TanStack DB already understands Electric collections and optimistic reconciliation.

## iOS and macOS Clients

The Apple apps use:

- SwiftUI for UI.
- Observation for UI state.
- GRDB and SQLite for local storage.
- A custom Swift Electric client.
- A local outbox for offline writes.

We should not run TanStack DB inside iOS. That would require a hidden JavaScript runtime or embedded local server, which fights the platform and makes persistence, lifecycle, backgrounding, and debugging worse.

Native flow:

```text
Electric stream
  -> Swift Electric client
  -> SQLite materializer
  -> GRDB observations
  -> SwiftUI updates

User edits
  -> local optimistic state
  -> local outbox row
  -> Command API when online
  -> wait for Electric confirmation
  -> mark mutation confirmed
```

The native client must implement:

- Shape cursor storage.
- Initial sync.
- Live sync.
- Shape reset handling.
- SQLite materialization.
- Outbox upload.
- Retry and backoff.
- Conflict/rejection UI.

This is the main cost of choosing Electric over a packaged native sync product.

## Offline Writes

Native clients store writes in a local outbox.

Outbox states:

```text
pending
uploading
accepted
confirmed
rejected
needs_user_resolution
```

If a write is rejected by the server, the app must not silently discard user work. The user should see the failed change and have a way to resolve it.

## Conflict Strategy

Use simple deterministic rules for most data.

- Tasks: field-level merge with version checks.
- Checklist item completion: latest accepted command wins.
- Reordering: LexoRank-style string position keys.
- Tags: set-like behavior with tombstones.
- Note metadata: version checks and simple field merge.
- Rich note bodies: Automerge CRDT documents.
- Email and calendar: external side effects require approval.

CRDTs should be used selectively. Automerge is the chosen CRDT layer for rich note/document bodies because native iOS and macOS editing are first-class requirements. Ordinary structured records still use deterministic command-based merge rules.

## AI Safety Model

The AI is not the user. It is a constrained actor.

The AI can:

- Read scoped data.
- Summarize scoped data.
- Draft notes.
- Draft emails.
- Propose task, calendar, or file changes.

The AI cannot:

- Read OAuth tokens.
- Send email directly.
- Delete data directly.
- Call provider APIs directly.
- Commit writes without approval.
- Access arbitrary filesystem paths.

All AI writes become proposals. A user can approve, reject, or edit the proposal. Approval is bound to the exact proposed patch, so a changed proposal needs a new approval.

## Provider Tokens

Email, calendar, and other provider tokens live in a token vault, not in the main app database and not in the AI runtime.

The AI and app call a provider proxy with narrow operations:

```text
list_email_headers
get_email_thread
create_email_draft
propose_calendar_event
refresh_calendar_shadow
```

There should be no `send_email` tool exposed to the AI. If a provider OAuth scope technically allows sending, our proxy still enforces draft-only behavior.

## Files

File bytes live in object storage. Postgres stores metadata.

```text
Object storage:
  file bytes

Postgres:
  file metadata
  file versions
  content hashes
  encryption metadata

Clients:
  local file cache
```

Electric syncs file metadata. File contents transfer separately through signed URLs.

## Search

Use two search layers:

- Local SQLite FTS for native offline search.
- Server-side Postgres search and pgvector for AI retrieval.

AI retrieval must enforce the same permissions as normal data access.

## Main Risks

The biggest risk is the native sync layer. Electric gives us a strong Postgres read-sync primitive, but we still own the Swift client, SQLite materializer, offline outbox, and conflict UX.

Other risks:

- Web and native semantics may drift.
- Shape authorization can become hard to reason about.
- Offline rollback and rebase may be more complex than expected.
- Automerge integration may force editor and document-schema decisions earlier than the rest of the data model.
- AI approval prompts may become noisy.
- Provider OAuth scopes may be broader than our product policy.
- iOS background limits may delay sync.
