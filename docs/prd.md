# Origin PRD

## Status

- Working draft
- Last updated: 2026-04-06
- Goal of this document: precise minimal PRD for initial build

## Product Summary

Origin is a personal life-management product with:

- A native Apple client surface: macOS app and iPhone app
- A server that can run locally or remotely
- A chat-first interaction model where the primary interface is an AI agent
- A secure-by-default integration model based on agent-owned accounts and shared access instead of direct access to the user's primary accounts

The agent should be able to help the user manage day-to-day life operations across notes, calendars, email intake, files, GitHub, Telegram, reminders, scheduled automations, and future integrations.

V1 is being designed first for a single user: the founder. The design should keep a path open for later multi-user or consumer expansion, but v1 optimization is for one technically capable user.

## Core Product Idea

The user talks to an agent. The agent has strong operational context because:

- The full action surface of the app is exposed as a CLI designed for agent use
- That CLI is implemented with `incur` and should be intuitive, composable, and discoverable
- The server has access to local tools, integration credentials, job runners, storage, and automation capabilities
- The app can fetch and render the relevant context, state, history, and results around the chat
- Origin should guide the user through connecting pre-created agent accounts through provider auth flows, using OAuth where available and explicit token entry where that is the provider surface

Rather than requiring users to give the system direct access to their main personal accounts, Origin should support an "agent account" model:

- Google account created for the agent
- Telegram bot created for the agent
- GitHub account created for the agent

Users can then selectively grant access by:

- Sending and receiving email directly through the agent account
- Forwarding emails to the agent account
- Sharing or co-managing Google Calendars
- Inviting the Telegram bot into groups
- Having Origin track repositories through the agent GitHub account and participate in relevant workflows or activity

## Intended Experience

- The interface is clean and minimal
- Chat is the primary entry point
- The agent can act, not just answer
- The system should feel context-rich and operationally competent
- Capabilities should be transparent enough that the agent can discover and use them reliably
- Users should be able to choose local-first or hosted deployment depending on their comfort and needs

## Product Goals

### Primary goals

- Make a general-purpose personal assistant actually useful in daily life
- Reduce setup friction for integrations through agent-owned accounts and guided sharing
- Reduce connection friction by guiding account linking through provider auth flows where available and explicit token entry where required
- Provide a reliable execution environment for agent actions
- Make the operational API highly usable by the model through a CLI-first design
- Preserve user trust with strong security defaults and explicit sharing boundaries
- Make high-autonomy operation practical by giving the agent its own accounts and execution environment

### Non-goals for v1

- Full autonomous access to a user's personal primary accounts by default
- A broad marketplace of third-party integrations before the core experience is strong
- Replacing general productivity tools with bespoke clones unless necessary
- Multi-user product polish, consumer onboarding breadth, or broad enterprise admin concerns

## V1 User

- Primary user: the founder
- User profile: technical, comfortable with a VPS, comfortable granting broad autonomy to an agent if boundaries are clear
- Important implication: optimize for leverage and speed over general-market onboarding simplicity

## V1 Product Thesis

Origin should feel like a personal chief-of-staff that can actually operate. The core value is not "chat with my life data"; it is "delegate ongoing life admin and operational tasks to an agent that has context, tools, and permission to act."

## Target Platforms

- macOS app
- iPhone app
- Server deployable locally
- Server deployable on a VPS or remote host

## High-Level Architecture

### Client

- Native Apple app surface for chat, state, review, approvals, and configuration
- Assume SwiftUI-native Apple clients for implementation planning
- Likely shared product model across macOS and iPhone, with platform-specific UX where needed
- The app is primarily the control surface and visibility layer, not the main execution environment in VPS mode

### Server

- Written in TypeScript
- Uses `Effect`
- AI interactions, oauth/api handled through `pi` (repository `pi-mono`)
- Provides:
  - chat orchestration
  - agent execution environment
  - integrations setup and management
  - scheduling / cron jobs
  - signal / event handling
  - memory and retrieval
  - SQLite-backed operational database
  - CLI runtime surface for actions

### Deployment Modes

#### Local mode

- Server runs on the user's machine or home environment
- Best for maximal control and lower trust in remote infrastructure
- Limited for always-on automations unless the machine is always available

#### VPS mode

- Server runs remotely and is expected to be the default high-autonomy mode
- Enables always-on scheduled tasks, webhook handling, and background reactions
- Holds the operational environment, agent-linked accounts, credentials, jobs, and mirrored working context needed for unattended execution
- Preferred v1 shape: a single Linux VPS, compatible with Hetzner-style deployment, where Origin runs directly on the host machine
- Preferred v1 service model: bare-metal / systemd-first rather than container-first, because the agent should be able to use the VPS like its own machine
- If the user later moves from local to VPS mode, replicated app state syncs to the VPS first, while secrets and provider operational state are re-established there instead of opaque-migrated.
- Provider authority cutover follows the provider-ingress authority contract, not only process ordering.
- Cutover requires a durable authority transfer record for the provider account set scope, monotonic authority epoch increment, and lease handoff timestamps before the new peer may start pollers or provider outbox dispatch.
- A peer may execute provider ingress or provider outbox work only while it holds the active authority lease for that exact provider account set scope.
- Every provider write path and cursor advance must carry and verify the active authority epoch as a fencing token.
- Bootstrap or restart on any peer must perform authority-lease verification first; if another peer holds authority, the restarting peer stays standby and must not run provider workers for that scope.
- At most one peer is authoritative for a provider account set at a time, enforced by authority epoch + lease fencing rather than stop-before-start ordering alone.

### Action Surface

- Entire app API exposed through a CLI
- CLI implemented with `incur`
- CLI should be ergonomic for both humans and agents, but optimized for agent reliability first
- CLI is the contract between the model and the capabilities of the system
- The detailed agent-facing CLI contract is defined at the stable docs entrypoint [origin_incur_cli.ts](./api/origin_incur_cli.ts), which re-exports the app-owned CLI spec from `apps/server/src/cli/spec.ts`

### Working Data Model

Origin should distinguish between:

- replicated app state: editable first-party objects and Origin-authored external-action intents that must work offline on every device and sync bidirectionally when online
- external mirrors and server outboxes: selective read models of external systems plus server-owned queued mutations waiting to be applied remotely
- materialized projections: derived views such as markdown files, search indexes, reports, or external-service updates
- secrets: credentials and session material stored behind capability boundaries

### Provider-Domain Storage Scope

- First-party Origin objects remain replicated local-first state.
- Provider ingress operational state is server-local operational state: pollers, cursors, backoff/rate-limit state, provider execution queues, and primary provider caches.
- A domain may define explicit Origin-owned overlays or linkage metadata as replicated first-party state, but provider-derived caches are not peer-replicated source-of-truth.
- Examples of replicated provider-domain overlays in v1 are `EmailTriageRecord`, `GitHubFollowTarget`, and `TelegramGroupSubscription`.
- Clients do not write provider outboxes directly. Offline or local user intent syncs as replicated first-party external-action intent state, and the server materializes provider-specific outbox records from that intent when it is online and authorized to act.
- An `ExternalActionIntent` is a replicated first-party record with a stable intent id, target/scope metadata, action kind, payload, actor/timestamp attribution, and lifecycle status.
- V1 intent lifecycle is: `pending -> materialized -> succeeded|failed|canceled`.
- `pending` covers both "recorded durably on a peer but not yet replicated to the authoritative server" and "seen by the authoritative server but not yet materialized into durable provider or job outbox work."
- `materialized` means the authoritative server has created provider or job outbox work from that intent.
- `succeeded`, `failed`, and `canceled` are durable terminal states for the logical intent itself, even if the underlying provider outbox has its own attempt history.
- The authoritative server must materialize at most one logical provider or job action per intent id plus provider scope, and every derived outbox record carries that same intent id forward as its origin link and dedupe root.
- The CLI must expose inspect and repair surfaces for these intents rather than hiding them entirely behind provider-specific outboxes, including `sync intent list|get|retry|cancel`.
- The shared schema, lifecycle, and trigger-facing event contract for these intents and provider ingress are defined in [provider_ingress_api.md](./api/provider_ingress_api.md) and surfaced through the stable CLI docs entrypoint [origin_incur_cli.ts](./api/origin_incur_cli.ts), which re-exports the app-owned spec at `apps/server/src/cli/spec.ts`.
- Clients consume provider domains through server-mediated read models, activity, and targeted fetches rather than by owning full replicated provider mirrors.

### Provider Authority Contract (Global)

Provider ingress and provider outbox dispatch are single-writer per provider account-set scope.

Canonical authority record: `ProviderAuthorityRecord`

- `id`
- `provider`
- `accountSetScope`
  - exact provider authority boundary. It uses the smallest stable provider surface Origin can lease independently, never mutable local follow/tracking/attachment state. If a provider exposes multiple independently selected sub-surfaces, Origin uses one authority record per selected sub-surface. V1 examples: mailbox id; connected GitHub account + one selected installation grant `installationId`; connected Telegram bot identity; connected Google account + one selected calendar id; connected Google account + one selected task-list id.
- `authoritativePeerId`
- `authorityEpoch`
  - monotonic fencing token; every provider cursor advance and provider write must verify this epoch
- `leaseStatus`
  - `active|grace|expired|transferring|standby`
- `leaseGrantedAt`
- `leaseHeartbeatAt`
- `leaseDurationSeconds`
- `leaseGraceSeconds`
- `lastHandoffRequestedAt`
- `lastHandoffStartedAt`
- `lastHandoffCompletedAt`
- `takeoverReason`
  - `bootstrap|planned_cutover|operator_forced|peer_unhealthy|credential_relink|repair`
- `takeoverHistory[]`
  - append-only handoff/takeover log including prior peer id, next peer id, old/new epoch, reason, actor, and timestamps
- `updatedAt`

Required semantics:

- Provider workers run only when `authoritativePeerId` matches the local peer, `leaseStatus=active`, and the lease heartbeat is fresh within `leaseDurationSeconds + leaseGraceSeconds`.
- Cutover requires durable transfer intent + epoch increment + lease activation on the new peer before any provider worker starts there.
- The old peer must fence itself immediately once it observes a higher epoch or non-local authority record.
- Stop-before-start is operational guidance only; epoch fencing is the hard safety boundary.
- Bootstrap conflict rule: if multiple peers start at once, only the peer that atomically acquires the next epoch for the scope becomes authoritative; all others enter standby and must not run provider workers until an explicit transfer or lease expiry path succeeds.
- Restart rule: process restart never restores authority implicitly from local memory; the peer must re-read and validate the durable authority record and reacquire/renew heartbeat before resuming provider workers.

Runtime/API control surface requirement:

- Authority state must be inspectable and operable through explicit CLI/API surfaces, including status, history, transfer, renew, and emergency fence operations.
- The canonical command family is `provider authority ...` and is specified in [provider_ingress_api.md](./api/provider_ingress_api.md).

### Provider-Domain Offline/Client Residency Minimums (Global)

Provider domains are server-canonical operational domains with bounded client-visible minimums.

Minimum global guarantees:

- Clients always retain replicated first-party overlays and `ExternalActionIntent` history offline.
- Clients can always inspect the last synced provider read-model snapshot they already have for each configured domain.
- Clients can always queue new provider-targeted intent offline; execution waits for authoritative server sync.
- Clients are not guaranteed full provider-history search or full raw-content availability offline.
- Server-owned provider caches are recoverable/evictable; they are not peer-replicated source-of-truth mirrors.

Per-domain minimum offline/client contracts are normative in:

- [email_api.md](./api/email_api.md)
- [github_api.md](./api/github_api.md)
- [telegram_api.md](./api/telegram_api.md)

### Local-First Requirement

The product architecture must satisfy all of the following:

- The app is fully readable and editable offline on macOS and iPhone
- Notes, calendar views, tasks, and relevant mirrored state remain accessible offline
- User actions taken offline are durably stored locally and queued for sync
- Chats sent to the AI while offline are queued locally and sent automatically once connectivity returns
- When online, sync is bidirectional between devices and the server
- Conflicts never destroy data; raw conflicting edits remain recoverable
- Every change can be attributed to an actor such as a device, the user, or the server-side agent

### Recommended Sync Architecture

- Use a CRDT-based replicated document model as the primary sync substrate for app-owned state
- Chosen sync substrate: `Automerge`
- Each device and the server keep a durable local replica
- The server acts as an always-on cloud peer for sync, automation, and integrations, but not as the only writer
- Peers exchange changes bidirectionally whenever they are online
- The app remains fully functional against its local replica when offline

#### Why this is the right shape

- This matches the local-first model directly instead of trying to simulate it with caches around a central database
- It gives automatic merge behavior for offline concurrent edits
- It gives built-in history semantics that are closer to version control than to ordinary CRUD sync
- It lets the server-side agent and user devices all participate as peers while keeping an always-on automation node

#### Why not use ElectricSQL as the core v1 sync layer

- Electric is designed to sync subsets of Postgres data into apps and services
- That is a strong fit for Postgres-backed structured state, but not for the full local-first problem here
- Our hardest shared data includes markdown notes with exact edit history, offline chat outboxes, and agent/user conflict resolution semantics
- Adopting Electric as the primary substrate would introduce a Postgres-centric sync model while still leaving the note/versioning problem unsolved

#### Why not use CR-SQLite as the only sync substrate

- CR-SQLite is a serious option for replicated SQLite state
- However, its `crsql_changes` table stores current mergeable state plus metadata, not the full history of every change
- Because Origin requires exact edit history, actor attribution, and durable conflict review, CR-SQLite alone is not a complete fit for the main requirement
- It may still be useful later for replicated relational projections or caches, but it should not be the sole history model

### Proposed Peer Storage Architecture

Every peer, including each Apple device and the server, should have a local Origin state directory.

#### 1. Replicated store

- Purpose: durable local copy of the synchronized app state
- Recommended shape: CRDT document store persisted locally
- Stores:
  - notes and note metadata
  - plans, routines, and tasks
  - calendar shadow objects and pending calendar mutations
  - chat threads and offline outbox messages
  - replicated integration linkage metadata and explicit Origin-owned overlays
  - actor-attributed change history

#### 2. Projection / index database

- Default: local SQLite
- Purpose: fast local queries, search indexes, view models, and caches derived from the replicated store
- Stores:
  - normalized lists and indexes for notes, chats, tasks, and calendar items
  - retrieval indexes, tags, hashes, search state, and vector indexes / embeddings where useful
- sync bookkeeping and local bookkeeping
- This is a materialized view, not the primary history layer
- On the server, SQLite is also the default operational relational database for provider pollers, cursors, backoff/rate-limit state, provider execution queues, primary provider caches, audit/activity records, and other non-CRDT state

#### 2a. Retrieval model

- Retrieval should combine deterministic filtering with semantic retrieval rather than relying on embeddings alone
- Structured queries, tags, links, paths, timestamps, and exact filters remain the first layer
- Embeddings / vector retrieval are a first-class derived layer for managed content where semantic search materially improves agent context
- The main initial embedding targets are notes, agent memory, chats, planning objects, and selectively cached external context
- Embeddings are derived indexes, not canonical data
- Retrieval should prefer the narrowest high-confidence context possible before broad semantic expansion

#### 3. Blob store

- Default: local filesystem inside the Origin state directory
- Purpose: attachments, imported documents, cached raw payloads, generated exports, and large artifacts
- This exists on every peer as needed
- The server can additionally retain larger integration caches if useful

#### 4. Secrets store

- Purpose: oauth tokens, API keys, session material, and credentials for agent-owned accounts
- Requirement: encrypted at rest and separated from normal replicated state
- Important boundary: the agent should use named capabilities and handles, not read raw secret values by default

### Sync Rules

- Devices edit their local replica first
- Online peers sync changes bidirectionally with the server peer
- The server peer is responsible for always-on automation, integration execution, and durable relay between intermittently connected devices
- No Apple device needs to be online for the server to continue acting
- No server round-trip is required for the user to keep working locally

### Conflict and History Model

- Every change should carry actor identity, local sequence information, and wall-clock timestamp metadata for UI display
- Text edits should merge automatically at the collaborative-text layer
- Structured conflicts should preserve all concurrent values until a later resolving change selects or merges revision candidates
- The agent may assist with conflict resolution, but resolution must always be another explicit change, never silent data loss
- Conflict review should be expressed in actor-attributed revision candidates, not a canonical `ours/theirs` split
- Automerge is the fine-grained history layer:
  - document history is preserved locally
  - text insertions and deletions are preserved and merged automatically
  - same-field concurrent writes remain inspectable as conflicts instead of being dropped
- The system should support viewing:
  - when an edit happened
  - who made it
  - what changed
  - what conflict, if any, was resolved later

### Activity Events

- Origin should maintain a first-class activity-event stream for agent-visible operations
- The app must expose this activity stream so the user can see what the agent did
- Activity events are distinct from chat history and object change history
- Activity events should cover at least:
  - agent task starts and completions
  - tool / CLI actions
  - external actions taken against integrations
  - scheduled job runs
  - failures, retries, and notable warnings
- Each activity event should include actor identity, timestamp, action type, target/context, and outcome status
- The activity stream is primarily a visibility and audit surface, not the source of truth for the underlying objects

### End-to-End Architecture Walkthrough

#### What is canonical

- Canonical live state is a replicated local-first state model shared by devices and the server
- Every peer keeps its own durable local copy
- The server is an always-on peer, not the only authority

#### What happens when the user edits offline

- The app writes immediately to its local replicated store
- The UI updates from local state with no network round-trip
- A change record is stored locally with actor identity and metadata
- If the action targets an external service or the AI, the device records a replicated external-action intent locally with a stable intent id rather than writing provider/server outboxes directly

#### What happens when the device comes back online

- The device syncs its replicated changes to the server peer
- The server syncs any newer changes back to the device
- For external-service or AI work, the server materializes its own provider/job outbox records from the synced replicated intent and executes them with server-held credentials or capabilities
- That materialization reuses the intent's stable intent id as the origin link and dedupe root so one synced intent becomes one logical provider or job action
- If there were concurrent edits, the replicated data model preserves both and merges according to the document rules
- If there is a semantic conflict that still needs resolution, that conflict is represented in state rather than causing silent data loss

#### What happens when the server-side agent acts

- The server agent edits the same replicated state model as any device would
- Those changes sync back down to devices
- If the agent triggers external actions, the server uses integration capabilities backed by stored credentials
- Raw credentials stay behind capability boundaries

#### What happens for chat

- Chat should use normal session-based conversations
- Each chat is its own session
- V1 should not introduce special-purpose chat workspaces or domain-specific chat modes
- Offline user messages are queued locally and sent when connectivity returns
- Chat history remains available through the app like other local-first state

#### What happens for notes

- Notes live as replicated documents whose main body is markdown text
- The app edits those note documents directly
- On peers with a writable filesystem editing surface, Origin also maintains a local markdown vault view of those notes
- Direct file edits to that local vault are a first-class supported write path
- Those file edits are imported back into local replicated note state and then sync normally
- There is no separate note-specific VCS layer in v1; Automerge is the note sync and history layer

#### What happens for calendar, tasks, email, GitHub, and Telegram

- Tasks and calendar items remain first-party Origin planning objects and are replicated offline-first on every peer
- Google Calendar / Google Tasks bridge linkage metadata stored on those planning objects is replicated with them
- Google provider pollers, cursors, backoff/rate-limit state, and execution queues remain server-local operational state
- Provider changes from Google bridges reconcile into replicated planning objects; Origin planning changes sync outward through server-owned bridge jobs
- Email, GitHub, and Telegram remain external-service domains rather than replicated first-party object sets
- The server owns their pollers, primary caches, and provider outboxes; clients consume them through server-mediated read models and activity, with only domain-defined first-party overlays such as `EmailTriageRecord`, `GitHubFollowTarget`, and `TelegramGroupSubscription` replicated when needed
- Offline client actions that target those providers are recorded first as replicated Origin intent, then converted by the server into provider-specific outbox work once sync reaches the authoritative server peer

### Recommended Library Stack

#### Replicated sync core

- Chosen technology: `Automerge`
- Role:
  - local-first replicated state
  - automatic merge of concurrent changes
  - durable change history with actor attribution
  - sync between devices and server peers
- Implementation note:
  - Apple clients should use `automerge-swift`
  - the server should use the JavaScript Automerge repo/networking layer
  - the app should not depend on `automerge-repo-swift` for v1

#### Server-side Automerge layers

- `automerge-repo`
  - the JavaScript-side repository, storage, and networking layer for server peers
  - use this on the TypeScript server for durable peer sync and websocket-based replication

#### Apple-side Automerge layers

- `automerge-swift`
  - the core Swift Automerge library
  - use this to create documents, edit them, merge them, inspect conflicts, and persist Automerge state
- Origin-owned Apple sync layer
  - use `automerge-swift` directly as the document engine
  - implement Origin sync over websocket transport and persistent local storage
  - do not use `automerge-repo-swift` in v1

#### Local query / projection layer

- `SQLite`
- Role:
  - fast local queries
  - search indexes
  - vector indexes / embedding-backed retrieval state
  - denormalized UI projections
  - sync bookkeeping and caches
- This is a projection layer, not the primary replicated-history layer

#### Server runtime

- `TypeScript`
- `Effect`
- Role:
  - server architecture
  - concurrency, workflows, resource management, error handling
  - integration orchestration and background jobs

#### AI and auth / API layer

- `pi` via `pi-mono`
- Role:
  - AI interactions
  - oauth / api handling
  - subscription plumbing where needed

#### Agent action surface

- `incur`
- Role:
  - define the full CLI surface the agent uses
  - keep capabilities composable, discoverable, and easy for the model to call correctly

#### Secrets and capability boundary

- encrypted local secrets store
- Role:
  - keep tokens and credentials out of normal model context
  - expose named capabilities instead of raw secret values

### Sync Technology Decision

#### Decision

- Chosen sync substrate: `Automerge`
- Recommended architecture:
  - `Automerge` for replicated local-first app state and history
  - local `SQLite` projections for fast queries and indexes
  - materialized markdown vaults for portable files and external editing

#### Why `Automerge` is the best fit

- It is explicitly designed for local-first software, offline edits, peer sync, and automatic merge
- It stores full document history and supports reviewing old versions, branching, and merging workflows
- It has first-party JavaScript support for repositories, local storage adapters, and websocket sync
- It has an official Swift implementation for Apple clients
- Its data model includes collaborative text, conflict inspection, and actor-based operation IDs, which align with Origin's requirements for editable notes, preserved conflicts, and attributable history

#### Current maintenance picture

- `automerge-swift` has current recent activity and should be treated as the primary Apple-side foundation
- `automerge-repo-swift` has notably older activity, with the latest verified commit on 2024-11-01
- `automerge-repo-swift` also says in its own README that the API is far from stable and warns that it should currently be used as a local package dependency
- V1 therefore uses `automerge-swift` directly and does not depend on `automerge-repo-swift`

#### Why not `Electric` as the main sync layer

- Electric's current primary product is Postgres Sync: syncing subsets of Postgres data into local apps and services
- That is a strong fit for Postgres-backed structured state, but Origin's hardest requirement is not "sync Postgres to clients"
- Origin needs exact local-first editing semantics for note content, offline outboxes, actor-attributed history, and conflict preservation across app state
- Electric remains interesting later for structured projections or streaming primitives, but it should not be the core source of truth for v1 sync

#### Why not `CR-SQLite` as the main sync layer

- CR-SQLite is strong for multi-master replicated SQLite data and offline merges
- However, its `crsql_changes` table stores current mergeable state plus metadata, not the full history of every change ever made
- Origin explicitly wants exact edit history, actor identity, and durable conflict inspection
- CR-SQLite is also packaged primarily as a SQLite extension, which adds more integration complexity on Apple platforms than using a native Swift Automerge library
- It remains interesting as an advanced lower-level option, but not the best default choice for v1

#### Important caveat

- The strongest remaining implementation risk is implementation effort, not architectural fit
- `automerge-swift` is the chosen Apple-side foundation
- Recommended posture:
  - rely on `automerge-swift` for core Apple-side document/state handling
  - build a thin Origin sync layer for Apple clients over Automerge primitives and websocket transport
  - keep `automerge-repo-swift` out of the v1 implementation

### Final Recommendation

- Best fit for Origin: `automerge` core + `automerge-swift`, with an Origin-owned sync layer on Apple clients
- V1 does not use `automerge-repo-swift`

### Data Ownership Model

Origin should be deliberate about which domains it owns directly and which it treats as synchronized external systems.

#### Planning domain: first-party Origin model

- Origin should own the primary planning model for tasks and calendar items
- The planning model should feel closer to Linear than to a thin calendar wrapper
- The detailed v1 planning contract is defined in [calendar_tasks_api.md](./api/calendar_tasks_api.md)
- Core first-party planning objects should include:
  - tasks
  - calendar items
  - projects
  - labels
  - Origin-specific metadata needed for planning, automation, and agent workflows
- These objects must be fully available offline through the replicated local-first state model

#### Google planning sync model

- Google Calendar and Google Tasks are synchronized external planning surfaces, not the primary internal planning model
- Origin should support bidirectional sync with both
- This means:
  - Google Calendar events can be imported into Origin calendar items
  - Origin calendar items can be exported or mirrored to Google Calendar events
  - Google Tasks tasks can be imported into Origin tasks
  - Origin tasks can be exported or mirrored to Google Tasks tasks
  - changes from either side should reconcile through Origin's local-first planning model
- `import` binds Origin to an existing Google object or selected bridge surface and never creates a new remote object
- `mirror` may create a remote Google object when no provider object is already bound
- In v1, Google Calendar recurrence round-trips through the bridge as a series root plus explicit per-occurrence exceptions keyed by the original scheduled slot
- In v1, Google Tasks bridging does not mirror a recurring master/exception graph; recurring Origin tasks stay Origin-canonical series and any Google Tasks link is only a lossy root/current-task projection
- Each synced item should keep stable linkage metadata between the Origin object and its external Google object
- Metadata may be stored in the external object body or another practical carrier when needed, but the canonical planning state remains inside Origin

#### Why this model

- It keeps planning fully usable offline
- It avoids forcing task semantics into Google Calendar's event model
- It gives the agent a single planning API surface to reason about
- It lets integrations react only against Origin's own planning objects, even when the original source was Google Calendar or Google Tasks
- It gives Origin room to add planning-specific features without being boxed in by an external provider model

#### Integration consequence

- If a Google Calendar event appears or changes, Origin syncs it into its own planning model
- If Origin creates or updates a calendar item, the Google Calendar sync bridge can mirror that outward
- If a Google Tasks task appears or changes, Origin syncs it into its own planning model
- If Origin creates or updates a task, the Google Tasks sync bridge can mirror that outward
- Agent workflows and automations should generally operate against Origin planning objects rather than talking to Google Calendar or Google Tasks semantics directly

#### Tasks versus calendar items

- Tasks and calendar items should be distinct first-party object types
- A task may optionally link to one or more calendar items for scheduling or time blocking
- Calendar items may also exist without a task when they represent standalone events
- Tasks support both `dueFrom` and `dueAt`, allowing a task to define a due window from `x` to `y`
- Tasks support dependency edges through `blockedByTaskIds[]`
- Tasks support recurrence as recurring task series whose canonical records are the series root plus explicit per-occurrence exceptions, with derived/materialized occurrences and per-occurrence history when present
- Calendar items support recurrence as recurring series whose canonical records are the series root plus explicit per-occurrence exceptions, with derived/materialized occurrences and per-occurrence history when present
- The UI should be able to render a due window as spanning multiple days without forcing the task to become a calendar event
- This keeps planning flexible while still supporting tight scheduling flows

#### Notes and memory

- Notes should be editable offline on every peer
- Recommended v1 shape: notes are replicated documents whose main content is markdown text
- Origin should provide its own interface for reading and editing markdown in the app
- The portable file representation should remain plain markdown with attachments
- Origin should also have a first-party memory object for the agent
- In v1, that memory object should be implemented as a managed markdown file inside the vault rather than as a separate structured database object
- The memory file is the canonical place for important durable facts, preferences, standing instructions, and other context the agent should keep in mind
- The app must expose this memory file directly so the user can inspect and edit it for customization
- Agent prompts should explicitly locate this memory file and explain how the agent is expected to read from it and update it
- Memory behavior should be governed by a protocol rather than a fixed schema; that protocol is defined in [memory_protocol.md](./details/memory_protocol.md)
- The agent may create supporting files or datasets referenced from memory when a topic becomes recurrent, large, or worth organizing
- The key distinction is:
  - primary sync/history layer: replicated note document history
  - portable/export layer: materialized markdown vault on disk

#### Managed workspace and vault boundary

- The managed workspace root is the full filesystem area Origin manages on a peer
- In v1, the markdown vault is the managed workspace root itself
- Markdown notes and explicitly managed note attachments inside the vault bridge into replicated note state
- A managed note attachment is a file that Origin explicitly attached to a note or explicitly imported as note-managed supporting content
- Non-note files in the managed workspace remain normal host files unless Origin explicitly imports or attaches them into managed replicated state

#### Recommended markdown-vault design

- Canonical file representation: a markdown vault with attachments
- Canonical file format: `.md` files plus simple YAML properties where useful
- The managed workspace should be treated as a single shared assistant workspace rather than split into separate user and agent areas
- On filesystem-bearing peers, Origin materializes note state into this vault and treats direct file edits as a supported input path
- Any file inside the managed workspace root is accessible to the agent like any other host file
- The vault should include a stable managed memory file at `Origin/Memory.md`
- Origin behavior:
  - edit note state through the replicated document model
  - export current note state to markdown files
  - import external markdown edits back into replicated note state
  - replicate non-markdown files only when they are explicitly attached or imported as managed note content
  - keep richer operational metadata in the replicated store and projection database rather than stuffing large metadata into frontmatter

#### Filesystem-first note editing requirement

- Direct filesystem edits are a first-class supported note workflow, not an edge-case compatibility feature
- This applies both locally and remotely
- In particular, agents and automation running on the VPS may edit markdown files directly
- Origin must therefore treat file changes as authoritative inputs to local note state on any peer that hosts a vault
- The system must not assume all note edits pass through an Origin API

#### Filesystem bridge model (notes)

- Every peer that hosts a markdown vault runs a filesystem bridge for managed note content
- The filesystem bridge is responsible for:
  - exporting replicated note state to markdown files
  - watching filesystem changes in the vault
  - diffing changed files against the last exported version
  - applying those diffs as text operations into local Automerge note documents
  - recording canonical actor attribution and source metadata for each imported change
  - preventing export/import echo loops
- Terminology contract:
  - `filesystem bridge` is the canonical subsystem name in docs and CLI
  - `importer` refers only to the bridge's internal import stage, not a separate actor or service
- The filesystem bridge automatically imports markdown note edits. Non-markdown files do not become replicated managed state just by existing in the workspace or being linked from a note.
- Explicitly managed note attachments sync only through explicit attach/import/replace flows; ordinary local workspace artifacts are outside the bridge's replicated import path in v1.
- Peers sync note state through Automerge, not by sharing the vault filesystem directly
- This means concurrent file edits on different peers still reconcile through the replicated note model

#### Recommended vault workflow

- macOS and the server keep local materialized vaults for supported external editing workflows
- Origin converts current replicated note state into markdown files in the vault
- Origin watches for external file changes and imports them back into replicated note state
- The vault remains a materialized editable projection of replicated note state, not a separate note-history system

#### Workspace attach and adoption

- If the selected workspace/vault path does not exist, Origin creates it
- If it exists and is empty, Origin initializes it
- If it exists and is non-empty, Origin performs an adoption/import pass before any export
- First-attach adoption applies only when the profile does not already have replicated note state for another workspace
- Managed markdown note paths are unique within the workspace root. `Origin/Memory.md` is the reserved managed path for the canonical memory note.
- During first-attach adoption, existing `.md` files in the workspace root are imported as managed notes with their relative paths preserved
- Existing `Origin/Memory.md` is adopted in place as the canonical memory file and must not be overwritten
- Existing non-markdown files remain ordinary local workspace artifacts unless the user or agent later explicitly imports or attaches them into managed state
- If a profile already has replicated note state and the target path is already populated, attach must go through an explicit reconcile/repair flow instead of silently importing or overwriting
- That reconcile flow must show the existing replicated note state and on-disk contents side by side, then require an explicit choice to adopt the target path, keep the current managed root, or replace the target path from an exported managed copy before any write occurs
- During `setup vault reconcile apply --resolution adopt`, relative markdown path is the collision key:
  - if an on-disk `.md` path matches an existing replicated managed note path, Origin retains that note id and imports the disk file as a new filesystem-authored revision for that note rather than creating a duplicate note
  - if an on-disk `.md` path does not match any replicated managed note path, Origin creates a new managed note at that path
  - if a replicated managed note path is absent on disk, that note remains in replicated state and is re-materialized into the adopted root after reconcile
  - if the colliding path is `Origin/Memory.md`, the canonical memory note keeps its stable note identity and the disk file imports into that note rather than creating, deleting, or renaming a second memory note
- The machine-actionable contract is: `setup vault init` stops with a stable reconcile id when such a choice is required, and `setup vault reconcile apply` performs the chosen `adopt`, `keep-current`, or `replace-target` path before any write occurs
- Origin must not silently clobber existing files during attach, adoption, or first export

#### External editing import path

- Editing notes outside Origin should be a supported workflow
- External edits do not bypass the replicated model; they are imported into it
- Automatic external-edit import applies to managed markdown note files
- Once a workspace is attached, a newly created `.md` file under the managed workspace root becomes a new managed note on the next bridge import unless its relative path already belongs to another managed note, in which case the bridge must surface a conflict instead of silently replacing or duplicating state
- A filesystem rename or move of a managed `.md` file preserves the note id and history when the bridge can attribute the new path uniquely to one existing managed note; if the move is not uniquely attributable, the bridge must surface a workspace conflict instead of guessing
- A filesystem delete of a managed `.md` file imports as a managed note delete when that delete is not part of a matched rename or move
- `Origin/Memory.md` is a reserved managed path. Content edits to that file import normally, but filesystem rename or delete of `Origin/Memory.md` must surface a workspace conflict instead of silently moving or removing the canonical memory note
- Mere presence of a local file, or linking to it from `Origin/Memory.md` or another note, does not promote it into replicated managed state
- Explicitly managed note attachments may be replaced or re-imported through managed attachment flows, but ordinary local workspace artifacts are not opportunistically imported into replicated state
- Canonical attribution contract for filesystem-imported edits:
  - Actor identity and source metadata are separate fields
  - `actor` identifies who authored the replicated change and is always derived by Origin, never taken from free-form file content or a free-form CLI value
  - `source` metadata describes where the content came from (for example `source.kind=filesystem`, path, file hash, and import trigger)
  - Automatic watcher import uses actor `bridge:<peer-id>` and source trigger `watcher`
  - Manual `sync bridge import` / `workspace bridge import` uses the authenticated CLI invoker as actor (for example user or agent principal for that session) and source trigger `manual-cli`
- The filesystem bridge importer stage should track the last exported note revision and file hash for each note
- When a file changes, the importer stage computes a text diff against the last exported content and applies that change into the replicated note document
- Once imported, the change syncs normally to other peers and back to the server
- The server then re-materializes its local markdown vault from the replicated note state

#### Recommended conflict policy

- Assume both the user and Origin may edit the same note while offline on different peers
- The replicated note model is responsible for preserving and merging concurrent edits
- External markdown edits are treated the same as any other authored change once imported
- Conflict handling should be framed as choosing or merging actor-attributed revision candidates, not `ours` vs `theirs`

#### Recommended folder shape

- `Inbox/`
- `Daily/`
- `Projects/`
- `Reference/`
- `Origin/Memory.md`
- `Origin/Logs/`
- Other folders as needed based on the content the agent is organizing

#### Recommended metadata policy

- Keep note files portable and human-readable
- Use minimal flat frontmatter only when a stable cross-tool identifier is useful
- Keep most Origin-specific state in the replicated store and projection database keyed by stable note IDs, paths, and hashes

#### Recommended write policy

- Origin should create, edit, reorganize, or update notes in whatever way best fits the task at hand
- It should not be artificially constrained to only additive writes or Origin-managed areas when modifying existing content is the sensible action
- Persisted agent-authored documents should just be normal notes in the vault, organized into whatever folders make sense
- One-off or non-persistent output should remain in chat rather than being turned into files by default

#### App responsibility

- The Origin app should provide a clean markdown-native note browsing and editing experience
- V1 should not depend on third-party note app UX for core workflows
- The markdown vault remains portable on disk even though Origin provides the main interface

#### Filesystem model

- Origin must be able to operate on its own managed files, including the managed workspace root, the markdown vault within it, and other Origin-owned runtime directories
- Origin must also be able to operate on arbitrary files and folders that already exist on the host where the server runs
- In local mode, this means files on the local machine that the server process can access
- In VPS mode, this means files on the VPS that the server process can access
- Arbitrary host-filesystem access is a first-class operational capability for the agent, not an edge case
- These arbitrary host files are not part of the replicated local-first app state by default
- The special thing about the managed workspace/vault is sync behavior, not access control
- Markdown notes and explicitly managed note attachments inside the managed vault are bridged into Origin's replicated note model and sync across peers
- Non-note files in the managed workspace and arbitrary host files outside it remain normal host files unless Origin explicitly imports them into managed state
- Ordinary local workspace artifacts do not get replicated history or restore semantics in v1; replicated history applies to managed note state and any file explicitly imported into that state
- Other host files should be treated as external operational resources that Origin can inspect, modify, create, move, or organize through its CLI capability surface

#### Email, GitHub, and Telegram

- Canonical source remains the external service
- Origin should keep metadata, caches, and operational state only as needed
- Raw content should be cached selectively for performance or robustness, not persisted broadly by default
- The v1 "subscription" model for external systems is server-owned incremental polling, not a separate first-class subscription product surface
- Each provider keeps a server-local saved cursor or last-successful-sync marker and polls only for new or changed state after that point
- Provider polling updates selective server-owned caches, emits normalized activity events, and those events are what automations react to
- Caches are the current-state working set for context and actions; activity events are the trigger surface for reactive automation
- Provider pollers, cursors, primary caches, and provider outboxes are server-owned operational state rather than replicated app-state
- Domain-defined Origin-owned overlays may still be replicated when the domain makes them first-party objects
- The shared ingress model is defined in [provider_ingress_api.md](./api/provider_ingress_api.md)

#### Email model

- Email should remain especially agent-centric rather than becoming a first-party user-facing offline domain in Origin
- The agent mailbox is a real working mailbox for the agent, not only a forwarding target
- Origin should connect directly to the agent mailbox through the provider API and manage it as a real inbox for agent operations
- Forwarded user emails should appear as normal messages in the agent mailbox, not as a separate mailbox mode
- If useful, Origin may preserve lightweight provenance metadata indicating that a message was forwarded or shared in from the user side
- The human user can rely on their normal email client when they need direct mailbox access
- V1 should therefore not build a full offline mirrored mailbox inside the replicated local-first state model
- Gmail or the relevant mail provider remains canonical
- Origin should fetch on demand and keep only selective recent caches when that improves agent performance, reduces repeated fetch cost, or supports short-lived workflow robustness
- The replicated email overlay should stay minimal: triage state, follow-up time, linked task, and internal triage note
- Provider unread, starred, label, and archive state remain provider-derived mailbox read-model state rather than replicated email overlay state
- Email cache retention controls such as local pinning are cache behavior only and do not become replicated triage state
- The detailed v1 email surface is defined in [email_api.md](./api/email_api.md)

#### GitHub model

- GitHub should remain an external-service domain rather than a first-party offline mirror inside Origin
- The human user can rely on normal GitHub tools when they need direct repository or notification access
- V1 should not build a full offline mirrored GitHub state model
- GitHub remains canonical
- Origin should fetch on demand and keep only selective caches plus lightweight workflow metadata needed for agent follow-up, summaries, and automation
- Dismissing a GitHub follow target suppresses local attention only; it stores the current repo refresh cursor watermark and the target resurfaces on newer matching GitHub activity or when the follow target is explicitly updated again
- The detailed v1 GitHub surface is defined in [github_api.md](./api/github_api.md)

#### Telegram model

- Telegram should remain an external-service domain rather than a first-party offline mirror inside Origin
- The human user can rely on Telegram directly when they need direct conversation access
- V1 should not build a full offline mirrored Telegram state model
- Telegram remains canonical
- Origin should fetch on demand and keep only selective caches plus lightweight workflow metadata needed for summaries, reactions, and agent participation
- The Telegram bot must be able to be added to groups and operate there as a supported workflow
- Origin should target the maximum Telegram bot access model available, including group participation and reading all group messages where Telegram allows it
- In v1, tracked-group workflows require the bot to validate with privacy mode disabled so it can receive the group traffic needed for summaries and participation
- Telegram bot constraints still apply: a bot is not identical to a normal user account, cannot initiate conversations with users on its own, and cannot see messages from other bots
- The detailed v1 Telegram surface is defined in [telegram_api.md](./api/telegram_api.md)

#### Automation model

- Automations are first-class Origin objects
- They are chat-first to create but may also be reviewed and edited through structured UI
- The detailed v1 automation surface is defined in [automation_api.md](./api/automation_api.md)

### References / LLM Coding Context

All core libraries and tools used by the system should be cloned locally into `docs/references/` as git submodules, then referenced from `AGENTS.md`, so code agents have close-at-hand source context for implementation:

- `incur`
- `pi-mono`
- `Effect`
- `pi`
- `automerge`
- `automerge-repo`
- `automerge-swift`
- other core runtime dependencies as needed

### Linked Specs

- [calendar_tasks_api.md](./api/calendar_tasks_api.md)
- [memory_protocol.md](./details/memory_protocol.md)
- [email_api.md](./api/email_api.md)
- [github_api.md](./api/github_api.md)
- [telegram_api.md](./api/telegram_api.md)
- [provider_ingress_api.md](./api/provider_ingress_api.md)
- [automation_api.md](./api/automation_api.md)
- [onboarding.md](./details/onboarding.md)
- [origin_incur_cli.ts](./api/origin_incur_cli.ts)

## Security Principles

- Secure by default
- Prefer delegated or shared access over direct primary-account takeover
- Separate agent identity from user identity
- Make access grants explicit and revocable
- Support local deployment for users who want maximal control
- Design for auditability of actions, credentials, and automation behavior
- Treat autonomy as a permissioned capability, not an implicit side effect
- Make it obvious which data is mirrored to the remote server and why
- Prefer capability-based access to credentials over exposing raw secrets to the model

## Autonomy Model

- Default mode is high autonomy
- The product should not assume routine approval checkpoints before acting
- The normal execution posture is to act directly rather than defaulting to dry runs or simulation
- Safety should come mainly from account boundaries, explicit shared access, clear audit trails, and capability limits
- The main hard boundary is around secret handling: the agent should be able to use its accounts and integrations, but normal operation should not require surfacing raw credential material into model context

## Core Capability Areas

### Communication

- AI chat with the user
- email intake via forwarded email or shared mailbox patterns
- Telegram participation through an agent-owned bot, including group participation

### Planning and Memory

- notes and knowledge retrieval
- calendar awareness and scheduling support
- memory over prior chats, external knowledge sources, and user context

### Automation

- cron jobs / scheduled tasks
- reactive workflows triggered by signals or external events
- recurring routines
- automations should be creatable through chat and also reviewable/editable through structured UI

### External Systems

- Google account and workspace surfaces
- Telegram
- GitHub

## Likely System Responsibilities

- run a local-first sync peer on every client and on the server
- manage connected agent-linked accounts, bot tokens, and credentials
- guide account connection and authorization flows for external services
- collect the user's own identity handles so Origin can recognize and reason about the user across services
- expose integration and operational capabilities through CLI commands
- keep model context grounded in current system state
- own the primary planning model for tasks, calendar items, projects, labels, and automation metadata
- preserve actor-attributed change history and support conflict inspection / resolution
- enforce policy boundaries around secrets and administrative setup actions
- deliver in-app and push notifications for system events and agent-originated alerts
- run locally with minimal infrastructure
- run remotely with manageable deployment ergonomics
- onboard the user by collecting their own identity handles, connecting the pre-created agent Google and GitHub accounts, connecting the pre-created Telegram bot, and guiding the related sharing flows

## Decisions So Far

1. V1 is for a single founder-user, not a broad audience.
2. The long-term design should stay extensible to other users, but that is not a v1 optimization target.
3. Default posture is high autonomy, especially in VPS mode.
4. Remote deployment is not optional in product thinking; it is a first-class mode because it unlocks always-on behavior.
5. The product should guide connection of the pre-created agent Google and GitHub accounts through OAuth, connect the pre-created Telegram bot through its token, and avoid raw manual setup beyond the provider-required flow.
6. Calendar + planning is the primary daily loop.
7. Email triage, GitHub follow-up, and Telegram summaries are part of the initial value proposition, not deferred ideas.
8. Routine action confirmations are not part of the default UX.
9. The preferred security model is capability use of credentials, not frequent raw-secret exposure to the model.
10. Origin should not broadly store raw content or summaries by default; it should fetch on demand and cache selectively when useful.
11. Origin should primarily orchestrate external systems and attach metadata, while still maintaining local-first shadow state and pending mutations where offline behavior requires it.
12. The app must be fully usable offline, with queued outbound actions and bidirectional sync when online.
13. The primary sync substrate should be a local-first replicated state model, not a server-authoritative cache model.
14. The markdown vault should be materialized from replicated note state and remain an editable projection on filesystem-bearing peers.
15. Automerge is the note sync and history substrate in v1; there is no separate VCS layer for notes.
16. `Automerge` is the chosen live sync substrate and `automerge-swift` is the chosen Apple-side implementation base for v1.
17. External markdown editing is a supported first-class workflow on filesystem-bearing peers; file edits are imported back into replicated state and then sync normally.
18. Tasks and calendar items are first-party Origin planning objects, not thin wrappers around an external provider.
19. Google Calendar is a bidirectional sync target and import surface for Origin calendar items, not the primary internal planning model.
20. Google Tasks is a bidirectional sync target and import surface for Origin tasks, not the primary internal planning model.
21. Agent workflows should generally operate against Origin planning objects rather than directly against Google provider semantics.
22. Tasks support an optional `dueFrom` in addition to `dueAt`, allowing due windows that can span multiple days in planning views.
23. The full v1 calendar/tasks API surface is specified in [calendar_tasks_api.md](./api/calendar_tasks_api.md).
24. Tasks support dependency edges and recurring task series in v1.
25. Calendar items also support first-party recurrence in v1.
26. Email remains an external-service domain in v1; Origin does not build a full offline mailbox and only keeps selective caches/operational metadata for agent workflows.
27. The agent mailbox is a real working inbox connected directly through the provider API; forwarded user emails are simply normal messages inside that inbox, optionally with lightweight provenance metadata.
28. GitHub remains an external-service domain in v1; Origin does not build a full offline mirror and only keeps selective caches/operational metadata for agent workflows.
29. Telegram remains an external-service domain in v1; Origin does not build a full offline mirror and only keeps selective caches/operational metadata for agent workflows.
30. Origin can operate both on its own managed files and on arbitrary files/folders accessible on the server host filesystem.
31. Onboarding should collect the user's own identity handles across supported services so Origin can identify the user correctly.
32. The Telegram bot must be usable inside Telegram groups.
33. Telegram should use the maximum bot access model Telegram supports in v1, including group participation and disabled privacy mode where needed, while respecting remaining bot-only platform limits.
34. Origin should have a first-party agent memory object implemented in v1 as a managed markdown file at `Origin/Memory.md`, editable in the app and explicitly referenced by agent prompts.
35. Chat uses ordinary session-based conversations in v1; each chat is its own session and there are no special-purpose chat workspace types.
36. The app must expose a first-class activity-event log so the user can inspect what the agent did across jobs, tool actions, and integration actions.
37. Automations are chat-first but may also be reviewed and edited through structured UI in v1.
38. The normal execution posture is direct action, not dry-run-first behavior.
39. Apple clients are assumed to be SwiftUI-native, but the PRD should stay focused on functionality rather than detailed UI design.
40. Retrieval should use a hybrid model: structured filters and exact search first, with embeddings / vector retrieval as a first-class derived layer where semantic search improves context quality.
41. Origin should support proactive notifications through in-app surfaces and push notifications, but not through outbound email or Telegram notifications in v1.
42. Persisted agent-authored documents should be ordinary notes in the vault organized as needed; transient one-off output should remain in chat by default.
43. The managed workspace is a single shared assistant workspace, and in v1 the vault is that workspace root itself rather than a separate subtree or user/agent split.
44. Agent memory behavior is defined by [memory_protocol.md](./details/memory_protocol.md): `Origin/Memory.md` is the curated memory index, and the agent may create supporting files or datasets referenced from it without requiring fixed schemas upfront.
45. Origin itself should use the simplest viable single-owner auth model in v1 and should not introduce an internal multi-user account system.
46. The preferred v1 deployment target is a single Linux VPS compatible with Hetzner-style deployment, using a bare-metal / systemd-first service model rather than container-first packaging.
47. SQLite is the chosen lightweight operational database where Origin needs relational/local metadata storage beyond the replicated Automerge state.

## V1 Shape

V1 should be minimal in implementation, but not artificially narrow in product promise. The current shape is:

- primary loop: calendar + planning
- supporting loops: email triage, GitHub follow-up, Telegram summaries
- architecture priority: local-first clients plus an always-on server peer
- planning model: first-party Origin tasks / calendar items with Google Calendar and Google Tasks bidirectional sync
- integration principle: broad enough to support the core loops, but each integration should start with the minimum action surface needed for the loop

## Initial Assumptions To Validate

- Chat-first is the correct top-level UX, with structured views supporting review and management
- The CLI abstraction is central and should be designed before broad integration work
- The product should support both local and remote deployment from early on
- The agent-account model is a key differentiator
- A CRDT-based replicated store plus local projection SQLite is the right sync foundation for v1
- The markdown vault should be a durable user-owned projection, not the primary synchronization substrate
- The planning model should be owned by Origin even when synchronized with external calendars

## Spec Process Notes

This document should be updated continuously during product-spec discussions. It is expected to evolve from rough concept to implementation-shaping requirements.
