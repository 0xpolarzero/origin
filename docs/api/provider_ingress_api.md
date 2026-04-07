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

- `poller`
  - how Origin learns about new provider state
- `cache`
  - the latest provider-derived working set inside Origin
- `activity event`
  - the normalized signal that something changed
- `automation`
  - reacts to the event, then reads the cache for context

So:

- cache answers "what is true now?"
- activity events answer "what just changed?"

## Storage Scope

- Pollers are server-owned operational state.
- Poller state includes cursors, status, interval/backoff, rate-limit handling, and last-error metadata.
- Provider caches are selective, evictable working sets and are usually server-local.
- Queued provider mutations are outbox records, separate from pollers.
- Provider caches and outboxes are not the replicated app-state layer.
- A provider domain may define explicit Origin-owned overlay objects separately, but that does not make provider-derived caches peer-replicated source-of-truth.
- Examples of replicated overlay objects in v1 are `EmailTriageRecord`, `GitHubFollowTarget`, and `TelegramGroupSubscription`.
- Clients never enqueue provider outbox records directly. They sync Origin-owned intent or overlay mutations, and the server materializes provider-specific outbox records from those replicated changes before dispatch.
- Clients consume provider domains through server-mediated read models and activity rather than full replicated provider mirrors.

## Provider Authority Contract

Provider ingress and provider outbox dispatch are single-writer per provider account-set scope.

Canonical authority object: `ProviderAuthorityRecord`

Required v1 fields:

- `id`
- `provider`
- `accountSetScope`
  - exact provider authority boundary for lease, fencing, and dedupe
  - choose the smallest stable provider surface that Origin can lease independently; this may be the connected provider account itself or one explicitly selected provider sub-surface
  - never derive it from mutable Origin-local working-set or attachment state such as GitHub follow targets, Telegram group subscriptions, or per-object Google bridge links
  - if a provider exposes multiple independently selected sub-surfaces, Origin creates one `ProviderAuthorityRecord` per selected sub-surface rather than one scope keyed by the whole current selection set
  - v1 examples: mailbox id; connected GitHub account + one selected installation grant `installationId`; connected Telegram bot identity; connected Google account + one selected calendar id; connected Google account + one selected task-list id
- `authoritativePeerId`
- `authorityEpoch`
  - monotonic fencing token; all provider cursor advances and provider write paths must verify it
- `leaseStatus`
  - `active`
  - `grace`
  - `expired`
  - `transferring`
  - `standby`
- `leaseGrantedAt`
- `leaseHeartbeatAt`
- `leaseDurationSeconds`
- `leaseGraceSeconds`
- `lastHandoffRequestedAt`
- `lastHandoffStartedAt`
- `lastHandoffCompletedAt`
- `takeoverReason`
  - `bootstrap`
  - `planned_cutover`
  - `operator_forced`
  - `peer_unhealthy`
  - `credential_relink`
  - `repair`
- `takeoverHistory[]`
  - append-only handoff/takeover records with `fromPeerId`, `toPeerId`, `fromEpoch`, `toEpoch`, `reason`, `actor`, `requestedAt`, `startedAt`, `completedAt`, `outcome`
- `updatedAt`

`accountSetScope` is the exact authority boundary. A peer may hold authority for one scope and standby for another. The durable coordination-store home and serialized encoding remain implementation-defined; only the logical boundary above is normative. CLI/API surfaces expose the boundary as an opaque exact-match `scope-ref`.

## Authority Runtime Semantics

### Enforceable single-writer rule

Provider pollers, provider cursor advancement, and provider outbox dispatch for a scope may run only when all are true:

- local peer id equals `authoritativePeerId`
- `leaseStatus=active`
- heartbeat freshness is within `leaseDurationSeconds + leaseGraceSeconds`
- the executing operation carries the current `authorityEpoch` and passes fencing verification

Any failed check must fence the operation and surface an authority error.

### Cutover semantics

Cutover is a durable state transition, not a best-effort sequence.

Required order:

1. write transfer intent (`lastHandoffRequestedAt`, target peer, reason)
2. atomically increment `authorityEpoch` and set `authoritativePeerId` to target with `leaseStatus=transferring`
3. old peer observes higher/non-local epoch and fences itself (stop pollers, stop outbox dispatch, reject provider writes)
4. target peer proves readiness, starts heartbeat, and transitions lease to `active`
5. record `lastHandoffCompletedAt` and append takeover history entry with outcome

Stop-before-start remains recommended operationally, but epoch fencing is the hard split-brain prevention contract.

### Restart semantics

- Restart must not restore authority from process memory.
- On startup, a peer must read `ProviderAuthorityRecord` from durable storage before starting any provider workers.
- If local peer is authoritative, it must renew heartbeat and re-validate epoch fencing before resuming pollers/outbox.
- If local peer is not authoritative or lease is stale, it must enter standby and expose recovery status only.

### Bootstrap conflict behavior

If multiple peers bootstrap concurrently for the same `accountSetScope`:

- authority acquisition must be atomic on `(provider, accountSetScope)`
- only one peer may commit the next epoch
- losers must enter `standby` and must not run provider workers for that scope
- if conflicting stale workers are detected, provider writes/cursor advances with stale epoch must fail fencing checks and become no-ops

## Authority Control Surface

Authority is runtime-operable through CLI/API.

Required inspect/operate surface in v1 (documentation-first; implementation may land incrementally):

- `provider authority list`
- `provider authority get --provider <provider> --scope-ref <scope-ref>`
- `provider authority history --provider <provider> --scope-ref <scope-ref>`
- `provider authority transfer --provider <provider> --scope-ref <scope-ref> --to-peer <peer-id> --reason <reason>`
- `provider authority renew --provider <provider> --scope-ref <scope-ref>`
- `provider authority fence --provider <provider> --scope-ref <scope-ref> [--peer <peer-id>]`

Minimum behavior:

- `get` returns the canonical `ProviderAuthorityRecord`
- `history` returns the append-only takeover history for the scope
- `transfer` performs epoch-incremented durable handoff semantics
- `renew` updates lease heartbeat only for the active authoritative peer
- `fence` forces local worker stop and marks lease non-active until a valid renew/transfer path completes

## Offline Intent Handoff

When a device is offline and the user or agent requests an external action:

1. the client writes replicated Origin state locally, including any first-party overlay changes and the durable external-action intent
2. that intent carries a stable intent id plus the target provider scope needed for later materialization
3. that replicated state syncs to the server when connectivity returns
4. the server validates the intent against provider auth and current scope
5. the server creates or updates the provider-specific outbox record, carrying forward the same intent id as the origin link and dedupe root
6. provider dispatch, retry, and dedupe happen from the server-owned outbox

For planning bridges, that durable external-action intent is the local request to attach, detach, pull, push, or reconcile a selected Google surface; it is not a guarantee that the provider side effect has already happened.

This keeps offline behavior local-first without pretending provider outboxes are peer-replicated state.

## `ExternalActionIntent`

`ExternalActionIntent` is the shared replicated first-party handoff object for offline or peer-local actions that eventually need provider or job execution on the authoritative server.

Required v1 fields:

- `id`
- `kind`
- `provider`
- `scope`
- `action`
- `targetRef`
- `payload`
- `status`
- `createdAt`
- `updatedAt`
- `createdByActor`
- `updatedByActor`
- `materializedAt`
- `succeededAt`
- `failedAt`
- `canceledAt`
- `lastError`
- `outboxRefs[]`

`provider` is optional when the intent targets an internal subsystem job rather than a third-party provider. `scope` remains required in either case because it is the authoritative materialization and dedupe boundary.

Canonical v1 status model:

- `pending`
- `materialized`
- `succeeded`
- `failed`
- `canceled`

`pending` covers both cases where the intent has not yet replicated to the authoritative server and where it has replicated but has not yet been materialized into provider or job outbox work.

Normative lifecycle:

1. a device or server peer records the intent in replicated state with a stable intent id
2. the authoritative server validates auth and scope after the intent reaches it while the intent remains `pending`
3. the authoritative server creates or updates at most one logical provider/job outbox record per `(intent id, provider, scope)`
4. the intent transitions to `materialized` once the authoritative outbox linkage is durable
5. downstream dispatch/retry happens from the server-owned outbox while the intent remains the origin link and dedupe root
6. the intent transitions to `succeeded`, `failed`, or `canceled` when the logical action reaches a terminal state

Required behavior:

- the intent id is stable across retries, reconnects, and replica sync
- canceling an intent before materialization must prevent outbox creation
- canceling an already materialized intent must stop further dispatch attempts where the provider/domain supports cancelation and otherwise mark the intent canceled while preserving audit history
- provider-specific outbox retries must not create a second logical intent
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

Provider-domain docs may also define first-party object events such as `planning.task.updated` or `email.triage.state.changed`.

Those downstream domain events are useful for audit, read models, and first-party workflows, but they do not replace the ingress event surface for provider-backed reactive automation unless a domain explicitly re-emits the same logical event with the same durable event identity.

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

Canonical `attributes` keys in v1:

- `status`
- `labels[]`
- `reviewDecision`
- `summaryTriggerKind`
- `authorRole`
- `isMention`

These keys are present only when the event family makes them meaningful. They are the normalized payload surface that automation filters match instead of provider-specific raw payload fields.

Automation-filter mapping in v1:

- `filters.changeKinds[]` matches `changeKinds[]`
- `filters.status[]` matches `attributes.status`
- `filters.labels[]` matches `attributes.labels[]`
- `filters.reviewDecisions[]` matches `attributes.reviewDecision`
- `filters.summaryTriggerKinds[]` matches `attributes.summaryTriggerKind`
- `filters.authorRoles[]` matches `attributes.authorRole`
- `filters.isMention` matches `attributes.isMention`; ingress should also include `mentioned` in `changeKinds[]` when that boolean is true

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
- cache stores recent relevant threads/messages as server read models plus the Origin triage overlay
- events drive things like `on new email`

### GitHub

- one logical poller pass per selected GitHub installation-grant authority scope over the followed repos covered by that grant
- follow targets define Origin's local working set and attention model within those grant scopes
- cache stores selected repo / issue / PR / review state
- server pollers own repository cursors and refresh state
- follow-target dismissal is overlay state, not cache state: `dismissedThroughCursor` stores the repo refresh cursor watermark, and automatic resurfacing requires a later refresh beyond that watermark plus newer matching target activity
- events drive things like `on followed PR updated`

### Telegram

- one bot-update poller per Telegram bot authority scope; tracked chats narrow work inside that scope
- cache stores recent tracked messages plus server read models for bot/chat state
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
- `provider authority ...` inspects and controls provider account-set authority leases and transfers
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
