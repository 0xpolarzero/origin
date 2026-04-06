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
- Clients consume provider domains through server-mediated read models and activity rather than full replicated provider mirrors.

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
- one Google Calendar poller for attached calendars
- one Google Tasks poller for attached task lists

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

- new email thread/message
- email triage-relevant state change
- new or updated followed GitHub issue/PR/review/comment
- new Telegram message in a tracked chat
- summary trigger becoming true
- new or changed Google Calendar event
- new or changed Google Task

## Automation Trigger Semantics

Automations that react to provider changes should listen to activity events emitted by ingress.

Examples:

- `on new email`
- `on GitHub PR updated`
- `on Telegram message in tracked group`
- `on calendar item created`

They should not continuously diff provider cache state directly.

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
- domain events
  - `email.thread.received`
  - `email.thread.updated`
  - `github.issue.updated`
  - `github.pr.updated`
  - `telegram.message.received`
  - `planning.google-calendar.changed`
  - `planning.google-tasks.changed`

Each event should include:

- provider
- poller id
- cursor before / after when useful
- provider object refs
- Origin entity refs when already linked
- activity timestamp
- outcome status

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
- cache stores recent relevant threads/messages plus Origin triage overlay
- events drive things like `on new email`

### GitHub

- one poller over the local followed working set
- follow targets define scope
- cache stores selected repo / issue / PR / review state
- events drive things like `on followed PR updated`

### Telegram

- one bot update / tracked-chat poller
- cache stores recent tracked messages and group policy state
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

Examples:

- `email refresh status|run|reset-cursor`
- `github refresh status|run|reset-cursor`
- `telegram refresh status|run`
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
