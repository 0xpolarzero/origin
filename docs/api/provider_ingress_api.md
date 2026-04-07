# Origin Provider Ingress Model

## Status

- Working draft
- Scope: v1 provider polling, cache refresh, change detection, and automation trigger model
- Linked from: [prd.md](../prd.md)

## Purpose

This document defines how Origin watches external systems such as:

- email
- GitHub
- Telegram
- Google Calendar
- Google Tasks

In v1, Origin does not need a broad separate "subscriptions" product surface.

Instead, each integration uses the same ingress model:

1. a server-owned poller runs on a schedule
2. the poller uses a saved cursor or last-successful-sync marker
3. it fetches only new or changed provider state
4. Origin updates its selective local cache
5. Origin emits normalized activity events
6. automations react to those activity events
7. automations read the cache for full context when they execute

This is the canonical v1 "subscription" model.

## Core Principles

- External providers remain canonical.
- Origin does not mirror full provider state offline.
- Origin keeps only selective caches and operational metadata.
- Polling is the default ingress mechanism in v1.
- Push/webhook integrations may be added later, but they should feed the same downstream model.
- Automations should not trigger by diffing cache directly.
- Automations should trigger from normalized change events emitted after ingress updates cache.

## Mental Model

Use this split consistently:

- `overlay/config`
  - first-party durable selections or policies that scope provider work
- `read model`
  - a provider-derived snapshot exposed through the app/CLI and eligible for bounded offline visibility
- `poller`
  - how Origin learns about new provider state
- `cache`
  - execution-home-local hydration/materialization state that backs read models or fetch-on-demand
- `activity event`
  - the normalized signal that something changed
- `automation`
  - reacts to the event, then reads the read model and cache-backed context it needs

So:

- overlay/config answers "what provider scope or policy did Origin choose?"
- read model answers "what last-synced provider state may clients inspect?"
- cache answers "what provider detail does the execution home currently have hydrated?"
- activity events answer "what just changed?"

## Storage Scope

- Pollers are server-owned operational state.
- Poller state includes cursors, status, interval/backoff, rate-limit handling, and last-error metadata.
- Provider caches are selective, evictable working sets and are usually server-local.
- Provider domains may also materialize bounded replicated read-model snapshots so synced clients can inspect the last known provider state offline.
- Those replicated read-model snapshots are derived from the last successful provider-execution-home sync. They are read-only on clients, rebuildable, and are not a second provider source of truth.
- Queued provider mutations are outbox records, separate from pollers.
- Provider caches and outboxes are not the replicated app-state layer.
- A provider domain may define explicit Origin-owned overlay/config objects separately, but that does not make provider-derived caches peer-replicated source-of-truth.
- Examples of replicated overlay/config objects in v1 are `EmailTriageRecord`, `GitHubFollowTarget`, `TelegramGroupSubscription`, selected GitHub installation grants, and selected Google bridge surfaces.
- Clients never enqueue provider outbox records directly. They sync Origin-owned intent or overlay mutations, and the server materializes provider-specific outbox records from those replicated changes before dispatch.
- Clients consume provider domains through read models, activity, and targeted fetches rather than full replicated provider mirrors.

## Provider Execution Home (v1)

In v1, provider ingress and provider outbox dispatch run on exactly one machine per profile.

This is the high-level rule:

- in `local` mode, the local machine is the provider execution home
- in `vps` mode, the VPS/server is the provider execution home
- only that machine runs provider pollers, advances provider cursors, and dispatches provider outbox work
- every other peer only syncs first-party state, reads server-mediated provider state, and queues `ExternalActionIntent` records for later execution

If the user deploys a VPS, the VPS is the only machine allowed to talk to Gmail, GitHub, Telegram, Google Calendar, or Google Tasks on Origin's behalf. A laptop or phone may record local changes and queue intent, but it does not run provider workers itself.

Selected provider surfaces still matter, but only as server-side scope:

- email narrows to the connected mailbox
- GitHub narrows by the selected installation grants and followed repos inside them
- Telegram narrows by the connected bot plus the chats/groups Origin tracks inside that bot
- Google Calendar narrows by the selected calendars
- Google Tasks narrows by the selected task lists

These selected surfaces do not let another peer become a provider worker in v1. They only tell the one provider execution home what to watch and where it may write.

### Cutover semantics

Moving provider work from one machine to another is a deployment or recovery cutover, not a runtime contest between peers.

Required v1 order:

1. bring the new provider execution home up
2. sync replicated Origin state there
3. re-establish provider credentials and provider-local operational state there
4. stop provider pollers, cursor advancement, and outbound provider actions on the old machine
5. start provider workers on the new machine

In short:

`exactly one machine runs provider sync/write work at a time`

Because v1 has one provider execution home, Origin does not need a runtime system for choosing which peer owns provider work. The canonical v1 CLI therefore has no separate command family for that.

## Offline Intent Handoff

When a device is offline and the user or agent requests an external action:

1. the client writes replicated Origin state locally, including any first-party overlay changes and the durable external-action intent
2. that intent carries a stable intent id plus the target provider scope needed for later materialization
3. that replicated state syncs to the provider execution home when connectivity returns
4. the provider execution home validates the intent against provider auth and current scope
5. the provider execution home creates or updates the provider-specific outbox record, carrying forward the same intent id as the origin link and dedupe root
6. provider dispatch, retry, and dedupe happen from the server-owned outbox on that machine

For planning bridges, that durable external-action intent is the local request to attach, detach, pull, push, or reconcile a selected Google surface; it is not a guarantee that the provider side effect has already happened.

This keeps offline behavior local-first without pretending provider outboxes are peer-replicated state.

## `ExternalActionIntent`

`ExternalActionIntent` is the shared replicated first-party handoff object for offline or peer-local actions that eventually need provider or bridge execution on the provider execution home.

`ExternalActionIntent` is a closed v1 union:

- `kind: "provider_write" | "planning_bridge_action"`
- `provider`: required
- `scope`: structured provider-surface object, not a free-form string
- `targetRef`
- `action`
- `payload`

`scope` names the provider surface that authorizes and materializes the action.
`targetRef` names the specific logical object being mutated within that surface when one exists.
`action` is a provider-specific enum from the owning domain contract, not free-form prose.
`payload` is the action-specific typed options object from the owning domain contract. Unknown keys are invalid for the owning domain action. The shared `sync intent` inspect surface preserves `payload` as a structured object, but exhaustive payload-key validation is owned by the domain command that authored the intent and by the execution-home materializer. Provider raw request blobs, cursor tokens, retry metadata, cache hints, and provider outbox state are forbidden in `payload`.

Initial v1 scope registry:

- `email`: `{ accountId }`
- `github`: `{ repo }`
- `telegram`: `{ chatId }`
- `google-calendar`: `{ calendarId }`
- `google-tasks`: `{ taskListId }`

Bulk bridge commands such as Google `pull`, `push`, or `reconcile` without an explicit surface id are command-level sugar in v1. They do not introduce an all-surfaces scope object. Instead, the runtime expands them into one `planning_bridge_action` intent per selected calendar or task list surface.

Initial v1 action registry:

- `email`: `send`, `reply`, `reply_all`, `forward`, `archive`, `unarchive`, `mark_read`, `mark_unread`, `star`, `unstar`, `spam`, `unspam`, `trash`, `restore`, `label_add`, `label_remove`
- `github`: `star`, `unstar`, `issue_create`, `issue_update`, `issue_comment`, `issue_label`, `issue_assignee`, `issue_close`, `issue_reopen`, `issue_lock`, `issue_unlock`, `pr_open`, `pr_update`, `pr_comment`, `pr_close`, `pr_reopen`, `pr_merge`, `pr_request_reviewer`, `pr_unrequest_reviewer`, `pr_ready`, `pr_draft`, `review_submit`, `review_thread_reply`
- `telegram`: `send`, `reply`
- `google-calendar`: `pull`, `push`, `reconcile`, `attach`, `detach`
- `google-tasks`: `pull`, `push`, `reconcile`, `attach`, `detach`

Always-present v1 fields:

- `id`
- `kind`
- `provider`
- `scope`
- `action`
- `status`
- `createdAt`
- `createdByActor`

Lifecycle-conditional or action-conditional fields:

- `targetRef` when the logical action targets a specific object inside the scope
- `payload` when the owning domain action requires typed options beyond the action enum itself
- `updatedAt`
- `updatedByActor`
- `materializedAt`
- `succeededAt`
- `failedAt`
- `canceledAt`
- `lastError`
- `outboxRefs[]`

Canonical v1 status model:

- `pending`
- `materialized`
- `succeeded`
- `failed`
- `canceled`

`pending` covers both cases where the intent has not yet replicated to the provider execution home and where it has replicated but has not yet been materialized into provider or bridge outbox work.

Normative lifecycle:

1. a device or server peer records the intent in replicated state with a stable intent id
2. the provider execution home validates auth and scope after the intent reaches it while the intent remains `pending`
3. the provider execution home creates or updates at most one logical provider/bridge outbox record per `(intent id, kind, provider, scope, action, targetRef?)`
4. the intent transitions to `materialized` once the outbox linkage on the provider execution home is durable
5. downstream dispatch/retry happens from the server-owned outbox while the intent remains the origin link and dedupe root
6. the intent transitions to `succeeded`, `failed`, or `canceled` when the logical action reaches a terminal state

Required behavior:

- the intent id is stable across retries, reconnects, and replica sync
- pure overlay/config mutations do not create `ExternalActionIntent`; only actions that require later execution-home materialization into provider or bridge outbox work do
- canceling an intent before materialization must prevent outbox creation
- canceling an already materialized intent must stop further dispatch attempts where the provider/domain supports cancelation and otherwise mark the intent canceled while preserving audit history
- provider-specific outbox retries must not create a second logical intent
- every derived provider or bridge outbox record must carry `originIntentId` explicitly and reuse the logical action represented by that intent rather than inventing a second origin record
- the intent remains queryable after terminal state for audit and repair

Canonical read / repair surface:

- `sync intent list`
- `sync intent get <intent-id>`
- `sync intent retry <intent-id>`
- `sync intent cancel <intent-id>`

## Why This Model

This is simpler and safer than a separate subscription system because:

- every provider already needs refresh/cursor logic
- every provider already needs a selective cache
- automations need edge-trigger semantics, not endless cache diffing
- retries and failure recovery are easier when ingress is explicit
- the server is already the always-on peer responsible for integrations and automations

## Poller Model

Each integration keeps one or more pollers.

In v1, assume one primary poller per connected integration surface unless a provider naturally needs more than one scope.

Examples:

- one mailbox poller for the connected agent inbox
- one GitHub poller covering the local followed working set
- one Telegram poller for bot updates / tracked chats
- one Google Calendar poller per attached calendar surface
- one Google Tasks poller per attached task-list surface

Each poller stores:

- `id`
- `provider`
- `scope`
- `status`
  - `active`
  - `paused`
  - `degraded`
  - `auth_failed`
  - `rate_limited`
- `mode`
  - `poll`
- `cursor`
- `lastStartedAt`
- `lastSucceededAt`
- `lastFailedAt`
- `lastError`
- `intervalSeconds`
- `backoffUntil`
- `itemsSeen`
- `itemsChanged`

## Cursor Semantics

The cursor is the only thing that makes polling incremental.

Origin should:

- persist the last successful provider cursor
- poll only for changes after that cursor
- advance the cursor only after a successful ingest pass
- keep the previous cursor if the ingest pass fails
- allow cursor reset when repair is needed

Valid cursor examples:

- Gmail history id
- GitHub updated-at watermark plus page/etag state
- Telegram update offset
- Google Calendar sync token
- Google Tasks updated timestamp or page token state

The exact cursor format is provider-specific.
The contract is not.

## Cache Semantics

Provider caches are:

- selective
- recoverable
- evictable
- current-state oriented
- usually server-local
- subordinate to any replicated read-model snapshot already exposed to clients

They are not:

- the primary system of record
- the automation trigger surface
- a complete offline mirror
- the replicated app-state layer

The cache should usually keep:

- recent or relevant provider objects
- local overlays and workflow metadata
- provider ids and cursors
- enough context for agent actions and automation execution
- hydrated provider details such as raw bodies, diff blobs, recent-message windows, or retention metadata that do not need to replicate directly to every peer

## Change Detection

When a poller runs:

1. fetch changed provider objects since the saved cursor
2. normalize them into Origin's provider cache shape
3. compare against existing cached state if needed
4. write the new cache state
5. emit normalized activity events for meaningful changes
6. advance the cursor

Not every provider field change needs a user-visible event.

Origin should emit events for meaningful changes such as:

- new email thread
- new email message in an existing thread
- email thread archived or unarchived
- email thread label or state change that matters to workflows
- new or updated followed GitHub issue
- new or updated followed GitHub pull request
- new GitHub comment or review event that matters to followed work
- new Telegram message in a tracked chat
- Telegram mention in a tracked chat
- new or changed Google Calendar event
- new or changed Google Task

## Durability And Dedupe

Provider ingress is the canonical event source for provider-backed reactive automations.

Ingress should treat cache refresh, activity-event append, and cursor advancement as one durable unit of work whenever the storage layout allows it.

If these steps cannot share one physical transaction, the implementation must still preserve this logical rule:

- do not advance the cursor until the emitted activity events are durably recorded
- do not expose a cache snapshot as processed if the matching activity events were not durably recorded

Each meaningful provider change should produce one stable ingress activity event id.

That event id is the replay and dedupe boundary for provider-backed reactive automations.

Required behavior:

- retries and repairs should reuse the same activity event id for the same logical provider change whenever the provider object refs, event kind, and upstream change boundary are unchanged
- reactive automation runs dedupe on `(automationId, activityEventId)`
- scheduled automation runs dedupe on `(automationId, scheduledAt)`
- rerunning a failed automation attempt should reuse the same run record rather than creating a second logical run for the same triggering event

Canonical event-identity rule:

- The durable ingress event identity is derived from `(provider, poller scope, event kind, provider object refs, upstream change boundary)`.
- The upstream change boundary should use the provider's strongest stable incremental token when one exists, such as history id, sync token, update offset, ETag/version, review id, comment id, or changed-at watermark plus object ref.
- If the provider later replays the same logical change during repair, Origin must reuse the same activity event id when that tuple is unchanged.
- Downstream first-party audit events may be emitted separately, but if they represent the same logical provider change they must carry the originating ingress event id as `causedByActivityEventId` rather than inventing a second dedupe identity.

## Automation Trigger Semantics

Automations that react to provider changes should listen to activity events emitted by ingress.

Examples:

- `on new email`
- `on GitHub PR updated`
- `on Telegram message in tracked group`
- `on calendar item created`

They should not continuously diff provider cache state directly.

For provider-backed workflows, ingress activity events are the canonical trigger surface.

Provider-domain docs may also define first-party object events such as `planning.task.updated`, `telegram.summary.generated`, or `email.triage.state.changed`.

Those downstream domain events are useful for audit, read models, and first-party workflows. When a first-party domain event is itself triggerable by automation in v1, it must reuse the same normalized `sourceScope` / `changeKinds[]` / `attributes` envelope defined below. They still do not replace the ingress event surface for provider-backed reactive automation unless a domain explicitly re-emits the same logical event with the same durable event identity.

Correct model:

1. poller refreshes provider state
2. cache is updated
3. activity event is emitted
4. automation trigger matches the event
5. automation reads cache / linked Origin objects for context

This guarantees:

- edge-trigger semantics
- fewer duplicate runs
- better observability
- cleaner retries

## Activity Event Contract

Every provider ingress pass may emit:

- lifecycle events
  - `provider.ingress.started`
  - `provider.ingress.completed`
  - `provider.ingress.failed`
- provider-backed domain events
  - `email.thread.created`
  - `email.message.received`
  - `email.thread.archived`
  - `email.thread.unarchived`
  - `email.thread.labels_changed`
  - `email.thread.updated`
  - `github.issue.created`
  - `github.issue.updated`
  - `github.issue.commented`
  - `github.issue.closed`
  - `github.issue.reopened`
  - `github.pr.created`
  - `github.pr.updated`
  - `github.pr.commented`
  - `github.pr.review_requested`
  - `github.pr.review_submitted`
  - `github.pr.merged`
  - `github.pr.closed`
  - `github.pr.reopened`
  - `telegram.message.received`
  - `telegram.message.mentioned`
  - `planning.google-calendar.changed`
  - `planning.google-tasks.changed`

Each event should include:

- stable activity event id
- provider
- actor
- poller id
- source scope
- cursor before / after when useful
- provider object refs
- Origin entity refs when already linked
- `changeKinds[]`
- `attributes`
- activity timestamp
- outcome status
- shared trace id when the ingress event later causes first-party object updates or automation runs

Top-level event `status` is the outcome of the ingress or domain event record itself, not the lifecycle state of the provider object that changed. Provider or domain object state that automations may filter on belongs in `attributes.status`.

Canonical `sourceScope` keys in v1:

- `provider`
- `accountId`
- `mailboxId`
- `calendarId`
- `taskListId`
- `repo`
- `followTargetId`
- `chatId`
- `entityId`

`sourceScope` is a structured object, not an open-ended map. In v1:

- `provider` is a single exact-match string
- every other `sourceScope` key is an array of exact ids or refs, even when only one value is present
- a trigger `sourceScope` matches an event `sourceScope` for one of those array-valued keys when at least one requested value overlaps the event's values for that key

Canonical `changeKinds[]` examples in v1:

- `created`
- `updated`
- `archived`
- `unarchived`
- `commented`
- `review_requested`
- `review_submitted`
- `mentioned`
- `merged`
- `closed`
- `reopened`
- `completed`
- `canceled`
- `linked`
- `unlinked`

Canonical `attributes` keys in v1:

- `status`
- `labels[]`
- `reviewDecision`
- `summaryTriggerKind`
- `authorRole`
- `isMention`
- `changedFields[]`
- `syncDirection`

These keys are present only when the event family makes them meaningful. They are the normalized payload surface that automation filters match instead of provider-specific raw payload fields.

The same normalized envelope is reused by triggerable first-party domain events in v1. A domain event may omit fields that are not meaningful for that event family, but if a field is present it must follow this contract.

Automation-filter mapping in v1:

- `filters.changeKinds[]` matches `changeKinds[]`
- `filters.status[]` matches `attributes.status`
- `filters.labels[]` matches `attributes.labels[]`
- `filters.reviewDecisions[]` matches `attributes.reviewDecision`
- `filters.summaryTriggerKinds[]` matches `attributes.summaryTriggerKind`
- `filters.authorRoles[]` matches `attributes.authorRole`
- `filters.isMention` matches `attributes.isMention`; ingress should also include `mentioned` in `changeKinds[]` when that boolean is true
- `filters.changedFields[]` matches `attributes.changedFields[]`
- `filters.syncDirection[]` matches `attributes.syncDirection`

Event-kind granularity rule in v1:

- email, GitHub, and Telegram use fine-grained event kinds where follow-up behavior materially differs by object family or interaction type
- Google Calendar and Google Tasks bridge ingress stays on the coarser `planning.google-calendar.changed` and `planning.google-tasks.changed` event kinds in v1
- implementations distinguish create/update/archive/complete-style planning changes through `changeKinds[]`, `sourceScope`, and provider object refs rather than multiplying planning event kinds

Array-valued filters are exact-match intersection checks against the normalized event payload. Scalar filter fields such as `attributes.status`, `reviewDecision`, `summaryTriggerKind`, and `authorRole` match when one requested filter value exactly equals the normalized event value.

`planning.google-calendar.changed` and `planning.google-tasks.changed` intentionally remain coarse event kinds in v1. Consumers must disambiguate them with `changeKinds[]`, `sourceScope`, and provider object refs rather than inventing ad hoc planning event names. `sourceRefs[]` and `entityRefs[]` remain contextual read fields, not additional trigger keys.

When available, `actor` should preserve the Origin-attributed source of the change, such as a user, agent, sync actor, or external peer identity.

## Failure And Retry

If a poll fails:

- do not advance the cursor
- record the failure on the poller
- emit ingress failure activity
- retry later with backoff

If auth fails:

- mark the poller degraded or auth_failed
- do not destroy existing cache
- surface recovery through integration status / activity

If rate-limited:

- preserve cursor
- set backoff
- retry after the provider window resets

If a cursor is invalid:

- mark poller degraded
- allow explicit repair / cursor reset
- run a broader resync as needed

## Poll Intervals

Do not hardcode one universal interval like `5s` for every provider.

Each poller should have its own interval and backoff behavior.

Guidance:

- faster for inbox/chat style domains
- slower for broad GitHub repo scans
- adjustable later per provider or scope

The important contract is:

- polling is periodic
- incremental
- server-owned
- cursor-based

## Provider-Specific Mapping

### Email

- one mailbox poller for the agent inbox
- cursor is mailbox/provider specific
- read models expose recent relevant threads/messages plus the Origin triage overlay
- cache stores mailbox cursor state, body/attachment hydration, recent-message working sets, and other execution-home-local detail behind those read models
- events drive things like `on new email`

### GitHub

- one server-side poller pass over the followed repos covered by the selected installation grants
- follow targets define Origin's local working set and attention model within those server-side scopes
- read models expose the selected installation-grant snapshot plus the repo / issue / PR / review summaries clients inspect offline
- cache stores execution-home-local GitHub detail such as cursors, ETags, hydrated bodies, diff payloads, and other richer fetch state behind those read models
- server pollers own repository cursors and refresh state
- follow-target dismissal is overlay state, not cache state: `dismissedThroughCursor` stores the repo refresh cursor watermark, and automatic resurfacing requires a later refresh beyond that watermark plus newer matching target activity
- events drive things like `on followed PR updated`

### Telegram

- one server-side bot-update poller for the connected Telegram bot; tracked chats narrow work inside that scope
- read models expose bot connection state, chat refs, and summary-job projections
- cache stores recent tracked-message windows and other execution-home-local detail behind those read models
- `TelegramGroupSubscription` is the replicated overlay for tracked-group policy; connection state, recent message caches, and outgoing actions remain server-owned operational state
- summary lifecycle events are downstream Telegram-domain activity emitted after automation or outbox work, not alternate provider-ingress message events
- events drive things like `on Telegram message in tracked group`

### Google Calendar / Google Tasks

- one poller per attached provider surface
- cache updates Origin planning bridges
- events drive planning-related automations

## CLI Implications

The CLI does not need a top-level `subscription` domain in v1.

Instead:

- integration-specific `refresh` commands control ingress
- integration-specific `cache` commands control current-state caches
- automations target normalized activity-event triggers
- `sync intent ...` inspects, retries, and cancels the replicated external-intent layer that feeds provider outboxes

Examples:
- `email refresh status|run|reset-cursor`
- `github refresh status|run|reset-cursor`
- `telegram chat refresh`
- `telegram connection refresh-metadata`
- `planning google-calendar status|pull|push|reconcile`
- `planning google-tasks status|pull|push|reconcile`

## Summary

The v1 subscription model is:

- polling, not a separate subscription product
- incremental by saved cursor
- server-owned
- cache-backed
- event-triggered

In one line:

`poller updates cache -> cache update emits activity event -> automation reacts to event`
