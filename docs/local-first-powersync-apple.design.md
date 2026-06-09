# Local-First PowerSync Apple Architecture Design

## Summary

We are building a personal everything app for iOS 18+ and macOS. It should feel instant, work offline, sync across Apple devices, and let a remote AI assistant use fixed tools to read allowed personal data and create drafts or proposals without receiving private provider tokens or performing external side effects directly.

The architecture uses:

- **Postgres** as the authoritative server database.
- **Self-hosted PowerSync** as the native sync service.
- **PowerSync Swift SDK** for local SQLite materialization, reactive reads, queued uploads, retry, and reconnect behavior.
- **SwiftUI + Observation** for the native UI.
- **Hono + Effect** for typed command handling, validation, user-ownership checks, and effect boundaries.
- **Automerge** selectively for rich document bodies.
- **A proposal and draft layer** for AI-originated changes.

PowerSync is the only client sync layer in this plan. The app should not build a custom sync protocol, a custom SQLite materializer, or a separate native retry queue unless a concrete PowerSync limitation requires it.

## Goals

- Native iOS and macOS apps written in Swift.
- Offline-first reads and writes for core personal data.
- Fast local UI backed by SQLite.
- Server-enforced user ownership and business rules.
- Remote AI access through fixed, auditable tools.
- Provider-token isolation from the AI runtime.
- Reusable command semantics across user actions, sync uploads, and AI proposals.

## Non-Goals

- No non-Apple client in this architecture pass.
- No sharing, teams, invitations, or multi-user workspaces.
- No CloudKit as the source of truth.
- No direct client writes to Postgres.
- No local TypeScript server inside the iOS or macOS app.
- No hidden JavaScript runtime as the primary native data engine.
- No AI access to provider tokens.
- No AI tools for irreversible provider actions such as sending email, deleting email, or sending calendar invitations.
- No CRDTs for ordinary structured records.

## Architecture

```text
SwiftUI iOS/macOS
  -> PowerSync Swift SDK
  -> local SQLite
  -> reactive queries and screen models

Local writes
  -> PowerSync local SQLite transaction
  -> PowerSync persistent upload queue
  -> PowerSyncBackendConnector.uploadData()
  -> Hono + Effect command API
  -> Postgres transaction
  -> op_log / conflict / domain rows
  -> PowerSync service
  -> accepted state synced back to local SQLite

Remote AI
  -> fixed read tools
  -> proposal API
  -> draft/proposal records
  -> command API
  -> Postgres
```

PowerSync owns the local sync substrate. The application owns command semantics, user ownership checks, conflict UX, AI tool boundaries, files, provider workflows, and rich document merge rules.

## Backend

### Postgres

Postgres is the canonical database for account data, domain records, operation history, provider metadata, approval state, and audit records.

Core server tables should include:

- `users`
- `devices`
- `sessions`
- `notes`
- `tasks`
- `projects`
- `events`
- `files`
- `op_log`
- `sync_conflicts`
- `ai_runs`
- `ai_proposals`
- `approval_requests`
- `provider_accounts`
- `provider_tokens`
- `audit_log`

Postgres constraints should enforce invariants that must never depend only on client behavior:

- User ownership.
- Stable identifiers.
- Required parent records.
- Unique provider references.
- Idempotency keys.
- Command replay protection.
- Approval state transitions.

### PowerSync

Self-hosted PowerSync streams each user's Postgres data into their native client SQLite databases and receives local queued uploads through the Swift SDK connector.

PowerSync service responsibilities:

- Maintain Postgres replication access.
- Serve per-user sync definitions.
- Track client progress and resume state.
- Stream accepted server state.
- Sync only rows and columns that belong in the personal app database.

PowerSync Swift SDK responsibilities:

- Maintain the local SQLite database.
- Materialize synced tables.
- Provide reactive query/watch APIs.
- Persist local writes while offline.
- Retry uploads when connectivity returns.
- Call the app's backend connector for upload processing.

The application should treat PowerSync-managed SQLite as the native local database for synced data. Additional SQLite frameworks are out of scope unless a specific PowerSync limitation is proven.

### Command API

Writes are expressed as typed application commands. A command represents user intent, not just a row mutation.

Examples:

- `createNote`
- `updateNoteTitle`
- `archiveNote`
- `completeTask`
- `rescheduleTask`
- `createCalendarProposal`
- `approveProviderAction`
- `mergeDocumentHeads`

The command API is responsible for:

- Authentication.
- User ownership checks.
- Validation.
- Idempotency.
- Conflict checks.
- Domain transactions.
- Operation logging.
- Audit logging.

Every accepted command writes domain changes and an `op_log` entry in the same Postgres transaction. Native clients confirm accepted writes by observing synced domain state, synced `op_log` rows, or synced `sync_conflicts` rows.

### PowerSync Uploads

PowerSync upload handling should call the same command service used by server-side user actions and AI-approved proposals. Local user actions should create command-intent rows, and the connector should upload those command intents to the backend.

This gives every local write the same shape:

- The user's intended action.
- The local optimistic state needed by the UI.
- The idempotency key.
- The base version or merge context.
- The approval or provider context when relevant.
- The status needed to show queued, accepted, rejected, or conflicted work.

When the backend permanently rejects an uploaded mutation, the connector must not leave the same upload blocking the queue forever. It should record a synced rejection or conflict row, mark the upload as processed, and let the UI guide the user through resolution. Retryable infrastructure failures should still fail the upload so PowerSync retries later.

## Sync Model

PowerSync sync definitions should be explicit and registry-backed.

Each synced record type needs:

- Table or query definition.
- Per-user row filter.
- Synced columns.
- Local table schema.
- Redaction rules.
- Tombstone behavior.
- Ordering and pagination expectations.
- Whether AI can read the record type.
- Whether the record is eligible for offline writes.

The registry should be generated or checked against server command schemas so the native local schema, backend authorization, and sync definitions do not drift.

## iOS and macOS Clients

Native clients use:

- Swift 6.
- SwiftUI.
- Observation.
- PowerSync Swift SDK.
- PowerSync-managed SQLite.
- Local file cache.
- Keychain for device credentials.
- CryptoKit or platform primitives where local encryption is required.

Read flow:

```text
PowerSync stream
  -> local SQLite
  -> PowerSync watch query
  -> @Observable screen model
  -> SwiftUI view
```

Write flow:

```text
SwiftUI action
  -> local transaction
  -> local optimistic state
  -> PowerSync upload queue
  -> backend command API
  -> accepted state or conflict synced back
  -> screen model reconciles status
```

The UI should not depend directly on network streams. Screens observe local read models and command status from SQLite.

iOS sync is foreground-first. Background execution is opportunistic: use background tasks only for short catch-up work and background URLSession for file transfers. The app must persist pending writes, drafts, and conflict state so it can resume cleanly after suspension or termination.

## Offline Behavior

Offline support is required for core records:

- Notes.
- Tasks.
- Checklists.
- Projects.
- Local drafts.
- File metadata.

Offline support is limited for provider-backed actions:

- Calendar changes may be drafted offline, but provider execution waits for server connectivity and approval.
- Email actions may be drafted offline, but sending or modifying provider state waits for server connectivity and approval.
- AI proposals can be viewed offline only if already synced locally. New remote AI work requires connectivity.

The local UI must distinguish:

- Saved locally.
- Queued for upload.
- Accepted by server.
- Rejected with conflict.
- Waiting for approval.
- Waiting for provider execution.

## Conflict Strategy

Structured records should use deterministic command-based merge rules.

Examples:

- Last writer wins only where data loss is acceptable.
- Field-level merge for independent fields.
- Server-side uniqueness checks for identifiers and provider references.
- Explicit conflict rows for destructive or ambiguous edits.
- User-visible resolution for rejected local changes.

Rich document bodies use Automerge where multi-device editing requires CRDT semantics. Automerge is scoped to the document body only.

Clean default:

- Use Automerge's rich-text model for the body document.
- Use native Apple text views for editing: `UITextView`/TextKit on iOS and `NSTextView`/TextKit on macOS, wrapped for SwiftUI.
- Store body snapshots and incremental Automerge changes in relational tables.
- Sync body snapshots and changes through PowerSync like other user-owned rows.
- Extract plain text from the Automerge document for local FTS and server search.
- Keep attachments as file records referenced from the body, not embedded binary data.
- Keep title, folder, tags, task links, and other metadata outside the Automerge document.

Default body tables:

```text
note_bodies
  note_id
  current_snapshot
  snapshot_format_version
  heads
  extracted_text
  compacted_at
  updated_at

note_body_changes
  id
  note_id
  command_id
  device_id
  change_bytes
  created_at
```

Default commands:

```text
update_note_body
compact_note_body
rebuild_note_body_search_text
```

CRDTs should not become the default for all app data. They are appropriate where concurrent text or structured document edits are expected.

## AI Safety Model

Use **Better Agent** as the product AI harness inside the backend. The harness owns model calls, typed tools, run state, streaming events, transcript capture, and structured output validation.

The remote AI can use fixed tools to:

- Read allowed personal data through server APIs.
- Search allowed indexes.
- Produce proposed commands.
- Create local drafts, such as email drafts.
- Explain why a proposal was generated.

The remote AI cannot:

- Read provider tokens.
- Call provider APIs directly.
- Modify authoritative data without the command API.
- Execute irreversible external side effects.

AI-originated changes should enter the same command model as user-originated changes. The difference is provenance and tool origin, not a separate write path.

Transcript rule:

- Store user-visible messages.
- Store assistant-visible messages.
- Store tool call names, normalized inputs, and normalized result summaries.
- Do not store hidden system/developer instructions as user transcript.
- Do not store chain-of-thought. If the model exposes reasoning summaries, store them only as collapsed/debug metadata.
- Provider tokens and raw secrets should never enter the harness, so they cannot appear in transcripts.
- Provider tools should return normalized app data, not raw provider API responses.

## Provider Tokens

Provider tokens live in a first-party server-side token store, not in AI runtime context. The token store can be a `provider_tokens` table with encrypted token material and strict backend-only access.

The provider service is responsible for:

- Token lookup.
- Token refresh.
- Enforcing the app's fixed provider operations.
- Provider API calls for those operations.
- Rate limiting.
- Audit logging.

Provider reads may be summarized for AI through fixed read tools. Provider tools should return normalized app-level data such as draft IDs, subject lines, sender names, timestamps, and short snippets. They should not return raw provider API payloads. Provider write tools should be limited to safe drafts. Do not expose tools for sending, deleting, sharing, or inviting.

## Files

File metadata is synced through PowerSync. File bytes transfer separately through signed upload/download URLs and native local caching.

The file model should separate:

- Metadata row.
- Blob storage key.
- Local cache path.
- Hash and size.
- Upload status.
- Download status.
- Thumbnail status.
- Provider attachment references.

Large files should not be placed inside PowerSync tables or Automerge documents.

## Search

Search should have separate local and server responsibilities.

Local:

- SQLite FTS for synced text.
- Local recency and status filters.
- Cached snippets for offline use.

Server:

- Cross-device search.
- AI retrieval.
- Provider-enriched metadata.
- Embeddings where appropriate.

The AI retrieval layer must apply the same user-ownership checks and fixed tool allowlist as normal server reads.

## Main Risks

1. PowerSync sync definitions and command authorization drift.
2. Command-intent payloads are underspecified and fail to preserve enough user intent for conflict resolution.
3. Permanent upload rejection blocks the PowerSync queue if not handled explicitly.
4. AI proposal approval rules are underspecified.
5. Provider-token isolation is weakened by convenience integrations.
6. Prompt injection causes the AI to propose unsafe actions.
7. Automerge storage, compaction, and search extraction are underestimated.
8. iOS background execution limits delay sync.
9. Local file protection classes are not defined early enough.
10. Extra local database layers overlap with PowerSync's managed database responsibilities.

## Recommended Direction

Use PowerSync as the only native sync substrate. Keep writes semantic and server-validated. Keep AI and provider behavior behind fixed tools. Use Automerge only for rich document bodies that need concurrent editing. Avoid adding another local data engine until a specific PowerSync limitation is proven.
