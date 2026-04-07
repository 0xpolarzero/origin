# Origin Automation API

## Status

- Working draft
- Scope: v1 automation / routine domain
- Linked from: [prd.md](./prd.md)

## Purpose

This document defines the v1 automation surface for Origin.

The automation layer is for:

- scheduled routines
- reactive workflows triggered by signals or events
- always-on agent execution on the server peer
- direct action against external systems and local files
- visible activity and audit history

Automations are first-class Origin objects. They can be created through chat and reviewed or edited through structured UI.

## Design Principles

- Origin owns the canonical automation model.
- Automations live in replicated local-first state so they remain visible offline.
- The server peer executes automations as an always-on peer.
- Direct execution is the normal posture; dry-run-first behavior is not the default.
- Activity events are first-class and user-visible.
- Notifications are in-app and push only.
- Automation objects should be easy to expose through the CLI.
- Automation definitions should be minimal but real: enough structure to be reliable, not enough to become workflow-bloated.

## Non-Goals For V1

- Visual workflow builders
- Arbitrary nested workflow graphs
- Complex conditional branching languages
- Multi-user delegation semantics
- Dry-run simulation as the normal execution mode

## Core Concepts

### Automation

An `Automation` is a durable object that describes when and how Origin should act.

Automations may:

- run on a schedule
- react to external or internal events
- perform one or more actions
- link to planning objects, memory, notes, or external systems
- emit activity events and notifications

### Automation Run

An `AutomationRun` is a single execution instance of an automation.

Runs capture:

- start and end time
- triggering reason
- actor identity
- status
- emitted activity events
- outputs / side effects
- error information if any

### Activity Event

Activity events are the visible trail of what the automation did.

They are distinct from:

- chat history
- object change history
- plan/task history

They should be readable by the user in the app.

## Common Conventions

### Object Identity

Every automation object has:

- `id`
- `createdAt`
- `updatedAt`
- `createdByActor`
- `updatedByActor`
- `archivedAt`
- `deletedAt`

All fields listed above are canonical persisted state unless a later note marks them as server-managed execution metadata. The CLI may present some of them with shorter labels, but it must round-trip the canonical object model.

### Actor Identity

Actor identifiers should be explicit and machine-readable.

Recommended shapes:

- `user:<peer-id>`
- `agent:<peer-id>:<agent-name>`
- `automation:<automation-id>`
- `system:<peer-id>`
- `sync:<provider>`
- `external:<peer-id>:filesystem`

### Statuses

#### `AutomationStatus`

- `active`
- `paused`
- `disabled`
- `archived`

Normative status semantics in v1:

- `active`: eligible for schedule evaluation, reactive event matching, and explicit manual run requests.
- `paused`: suppresses automatic schedule and event starts only. Matching reactive events are ignored while paused and are not replayed later. Scheduled boundaries that pass while paused are not counted as missed for `catchUp`. Explicit `automation run` remains allowed. In-flight runs continue unless canceled separately.
- `disabled`: suppresses all new starts, including schedule, event, manual `automation run`, and `automation backfill`. In-flight runs continue unless canceled separately.
- `archived`: retained for history/query only. Archived automations are not eligible for schedule evaluation, event matching, manual run, `skip-next`, or backfill.

#### `RunStatus`

- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`
- `skipped`

## Object Model

## `Automation`

Represents a durable routine or reactive workflow.

### Fields

- `id`
- `name`
- `slug`
- `descriptionMd`
- `status: AutomationStatus`
- `kind`
- `trigger`
- `actions[]`
- `linkedTaskIds[]`
- `linkedCalendarItemIds[]`
- `linkedProjectIds[]`
- `labelIds[]`
- `notificationPolicy`
- `runPolicy`
- `retryPolicy`
- `lastRunAt`
- `nextRunAt`
- `lastRunStatus`
- `source`
- `createdAt`
- `updatedAt`
- `createdByActor`
- `updatedByActor`
- `archivedAt`
- `deletedAt`

`name` is the canonical human-facing title for the automation. CLI surfaces may label it `title`, but that is an alias, not a separate persisted field.
`descriptionMd` is the canonical long-form description. CLI surfaces may label it `summary`, but that is likewise an alias.
`slug` is the stable machine key and should not be inferred from `name`.
`lastRunAt`, `nextRunAt`, and `lastRunStatus` are server-managed execution metadata.
`source` records where the automation definition came from and must survive read/update round-trips even when the create flow does not set it explicitly.

### `kind`

`kind` is a coarse persisted classification derived from the trigger shape. It is not a second source of truth for execution behavior.

An automation can be one of:

- `scheduled`
- `reactive`
- `manual`
- `hybrid`

### `trigger`

The trigger is a discriminated object. It defines what starts the automation.

Supported forms:

- schedule-based
- event-based
- manual start
- hybrid schedule plus event start where needed

The trigger type is the canonical source of truth for start behavior. `kind` follows the trigger shape above.

The trigger shape is intentionally small and typed in v1.

### `actions[]`

An ordered list of actions to execute.

Actions are intentionally high-level in v1, but not opaque blobs.

The canonical v1 shape is a small typed action object aligned with the CLI:

- `type: "command"`
- `command`
- `args[]`
- `options`
- `summary`

`command` names the exact canonical CLI command path to invoke, not a loose command family.

`args` are the positional arguments for that command path.

`options` are the named CLI flags or key/value options for that command path.
`summary` is a short human-readable intent note for the action, not a second workflow definition.

### `notificationPolicy`

Controls when Origin surfaces in-app / push notifications for this automation.

### `runPolicy`

Controls execution behavior such as:

- concurrency
- whether overlapping runs are allowed
- whether missed schedules should catch up
- whether actions should continue after partial failure

Required v1 fields:

- `allowOverlap: boolean = false`
- `catchUp: "skip" | "one" | "all" = "skip"`
- `continueOnError: boolean = false`

Normative run-policy semantics in v1:

- `allowOverlap = false` means the runtime must not have more than one run of the same automation in status `running` at the same time. Distinct triggers may still produce later queued runs with their own logical identities, but they must execute serially.
- `allowOverlap = true` permits concurrent `running` runs for distinct logical triggers. Dedupe still uses `(automationId, scheduledAt)` for scheduled runs and `(automationId, activityEventId)` for reactive runs.
- `catchUp` applies only to the scheduled side of `schedule` and `hybrid` triggers, and only for schedule boundaries that became due while the automation was `active`.
- `catchUp = "skip"` creates no retroactive scheduled run.
- `catchUp = "one"` creates at most one retroactive scheduled run, anchored to the latest eligible missed `scheduledAt`.
- `catchUp = "all"` creates one retroactive scheduled run per eligible missed `scheduledAt`, in chronological order.

### `retryPolicy`

Controls retry behavior on failure.

Required v1 fields:

- `maxAttempts: integer = 3`
- `backoff: "none" | "linear" | "exponential" = "exponential"`

### `linkedTaskIds[]`, `linkedCalendarItemIds[]`, `linkedProjectIds[]`

Optional links to planning objects that the automation is about.

These links are used for:

- context
- filtering
- notification routing
- activity audit

## `AutomationRun`

Represents one execution instance of an automation.

### Fields

- `id`
- `automationId`
- `status: RunStatus`
- `triggeredAt`
- `scheduledAt`
- `activityEventId`
- `startedAt`
- `finishedAt`
- `triggerReason`
- `actor`
- `inputSummaryMd`
- `outputSummaryMd`
- `errorMd`
- `retryCount`
- `attemptNumber`
- `createdAt`
- `updatedAt`

`activityEventId` is a singular stable trigger-event reference for reactive runs. v1 does not support multiple trigger event ids per run.

## `AutomationTrigger`

### Schedule Trigger

Represents a recurring schedule.

Fields:

- `type: "schedule"`
- `cron`
- `timezone`
- `startAt`
- `endAt`

Cron is the base scheduled form in v1.

### Event Trigger

Represents a workflow that starts when something happens.

Fields:

- `type: "event"`
- `eventKinds[]`
- `filters`
- `sourceScope`

Event triggers are used for things like:

- a calendar item changes
- a task is completed
- an external message arrives
- a file changes
- a sync event lands
- an integration reports a notable state change

Allowed event families in v1 are the normalized durable events emitted by provider ingress and first-party domain lifecycle events. Event triggers must match those durable event kinds exactly; they do not match raw cache diffs or ad hoc payload changes.

For provider-backed reactive workflows, `eventKinds[]` should point at fine-grained provider ingress activity kinds such as `email.message.received`, `github.pr.review_requested`, `telegram.message.mentioned`, or `planning.google-calendar.changed`, not raw cache diffs.

`filters` are conjunctive: all supplied filters must pass after the event kind matches.

`sourceScope` limits which objects or providers can emit matching events; it does not redefine the event kind itself.

Filter evaluation is against the normalized activity-event contract from [provider_ingress_api.md](./provider_ingress_api.md), not provider-native webhook or polling payloads.

First-party domain lifecycle events that are intended to trigger automations must use that same normalized activity-event envelope for the shared triggerable fields: `kind`, `status`, `actor`, `at`, `sourceScope`, `changeKinds[]`, `attributes`, `sourceRefs[]`, `entityRefs[]`, `causedByActivityEventId`, and `traceId`. Provider-only fields such as `provider`, `pollerId`, and `upstreamChangeBoundary` remain optional and are normally absent on pure first-party events.

`sourceScope` is a structured object, not an open-ended map. In v1, `provider` is a single exact-match string and the remaining keys are arrays of exact ids or refs. A trigger matches when every supplied scope key matches and each array-valued key has at least one overlapping value with the event's `sourceScope`.

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

Canonical `filters` keys in v1:

- `changeKinds[]`
- `status[]`
- `labels[]`
- `reviewDecisions[]`
- `summaryTriggerKinds[]`
- `isMention`
- `authorRoles[]`
- `changedFields[]`
- `syncDirection[]`

Canonical filter-field mapping in v1:

- `changeKinds[]` matches event `changeKinds[]`
- `status[]` matches event `attributes.status`
- `labels[]` matches event `attributes.labels[]`
- `reviewDecisions[]` matches event `attributes.reviewDecision`
- `summaryTriggerKinds[]` matches event `attributes.summaryTriggerKind`
- `authorRoles[]` matches event `attributes.authorRole`
- `isMention` matches event `attributes.isMention`
- `changedFields[]` matches event `attributes.changedFields[]`
- `syncDirection[]` matches event `attributes.syncDirection`

Matching semantics in v1:

- `eventKinds[]` match exact durable event-kind strings.
- `sourceScope` keys are conjunctive. Scalar keys such as `provider` must match exactly. List-valued keys such as `repo`, `chatId`, or `calendarId` match when the event carries at least one overlapping value.
- `changeKinds[]`, `labels[]`, `reviewDecisions[]`, `summaryTriggerKinds[]`, `authorRoles[]`, and `changedFields[]` also match by non-empty intersection with the event payload.
- If a filter refers to an attribute the event does not carry, the filter fails rather than silently passing.

Array-valued filters are exact-match intersection checks against the event payload. Scalar normalized fields such as `attributes.status`, `reviewDecision`, `summaryTriggerKind`, `authorRole`, and `syncDirection` match when one requested value exactly equals the event value.

For coarse Google bridge ingress events such as `planning.google-calendar.changed` and `planning.google-tasks.changed`, v1 consumers should narrow matches with `filters.changeKinds[]` and `sourceScope.calendarId` / `taskListId` / `entityId`. Fields such as `sourceRefs[]` and `entityRefs[]` may still appear on activity events for inspection, but they are not extra trigger keys in v1.

`summaryTriggerKinds[]` is valid only for Telegram summary lifecycle events `telegram.summary.generated` and `telegram.summary.posted`. Those events carry `attributes.summaryTriggerKind`. Supported v1 values are:

- `manual`
- `scheduled`
- `mention`
- `agent_decision`

Telegram automatic summaries are still ordinary automations. Their schedule or event trigger lives here; Telegram group policy only gates whether summary automation may run or post for a group and provides default lookback context. The filter does not apply to `telegram.message.received` or `telegram.message.mentioned`.

Unknown filter keys should be rejected by the canonical CLI/runtime rather than treated as silently ignored hints.

### Manual Trigger

Represents a workflow started directly by the user or the agent.

Fields:

- `type: "manual"`

### Hybrid Trigger

Represents an automation that may start either on a schedule or from matching events.

Fields:

- `type: "hybrid"`
- `schedule`
- `event`

## `AutomationAction`

Actions are the work units inside an automation.

The v1 action set should stay aligned with the CLI rather than inventing a second workflow DSL.

Examples of valid command-backed actions:

- create or update a planning object
- create or update a note
- modify a managed file
- send or reply to email
- post a Telegram message
- create or update a GitHub follow target

Each action carries the canonical CLI-backed shape:

- `type: "command"`
- `command` (exact canonical Origin CLI command path)
- `args[]` (ordered positional arguments)
- `options` (named CLI options/flags object)
- `summary` (optional human-readable intent note)

## Read Surface

The app and CLI should support:

- listing automations
- reading one automation
- listing automation runs
- reading a single run
- listing activity events
- filtering by status, trigger type, linked planning object, or recent failures
- viewing next run time and last run result

Useful query shapes:

- `automation list`
- `automation get <id>`
- `automation runs <id>`
- `automation events [filters]`
- `automation list --status active`
- `automation list --linked-task <task-id>`

## Mutation Surface

The app and CLI should support:

- create automation
- update automation
- archive automation
- delete automation
- pause automation
- resume automation
- enable automation
- disable automation
- run automation now
- skip next run
- edit trigger
- edit actions
- edit notification policy
- edit run policy
- edit retry policy

Mutation behavior:

- changes are replicated local-first
- user edits work offline
- the server applies execution when online and available
- enabling/disabling/pause state is part of canonical automation state

Imperative automation control in v1 splits in two:

- canonical automation object mutations such as create, update, pause, resume, enable, disable, archive, and delete are replicated local-first state and remain durable/offline
- imperative execution-control commands such as `automation run`, `automation skip-next`, and `automation backfill` are execution-home operations in v1 and are not modeled as replicated `ExternalActionIntent`

## Execution Model

- The server peer is the execution authority for always-on automations.
- Client peers may create and edit automation state locally.
- When online, the server picks up active automations and runs them.
- When offline, desired state can still be edited and queued.
- A scheduled automation should not double-run if the server restarts or a peer reconnects.
- Missed runs should follow `runPolicy`.
- Manual runs should record the triggering actor and reason.
- Scheduled runs dedupe on `(automationId, scheduledAt)`.
- Reactive runs dedupe on `(automationId, activityEventId)` where `activityEventId` is exactly one canonical triggering event id.
- `scheduledAt` and `activityEventId` are the logical run identity anchors when present; no multi-event trigger-id list is part of the run identity model in v1.
- Retrying a failed run reuses the same logical run record and increments attempt state.

`automation run` is an explicit manual start request. It may target any non-`disabled`, non-`archived` automation regardless of trigger type. The resulting run records `actor` and `triggerReason`, sets neither `scheduledAt` nor `activityEventId`, and follows normal queueing / `allowOverlap` rules.

`automation skip-next` applies only to automations with a schedule component and only while the automation is `active`. It reserves exactly one next eligible `scheduledAt` boundary as skipped. That skipped boundary should still appear in history as one logical run with `status = skipped` and the reserved `scheduledAt`. For `hybrid` automations, only the scheduled side is affected; event triggers remain active.

`automation backfill` applies only to automations with a schedule component, only for automations that are not `disabled` or `archived`, and only when `runPolicy.catchUp` is `one` or `all`. It materializes missed eligible `scheduledAt` boundaries inside the requested time window using the same dedupe keys and queueing rules as ordinary scheduled runs.

### Concurrency

- At most one active run per automation should be the default.
- If overlapping execution is allowed, that must be explicit in `runPolicy`.

### Failure Handling

- Failures must be recorded as runs and as activity events.
- Retry behavior follows `retryPolicy`.
- Permanent failures should surface in the app and through push notifications if configured.

## History and Audit Model

Automations should preserve:

- object history
- run history
- activity-event history
- status transitions
- actor attribution

What the user should be able to inspect:

- when the automation changed
- who changed it
- when it ran
- what triggered it
- what it did
- what failed
- what was retried

## Activity Events

Every meaningful automation execution should emit activity events.

Event categories should include:

- run started
- run completed
- run failed
- run retried
- action started
- action completed
- action failed
- notification emitted
- automation paused/resumed/disabled/enabled

Event fields should include:

- `id`
- `automationId`
- `runId`
- `actor`
- `timestamp`
- `kind`
- `severity`
- `summary`
- `detailsMd`
- `targetRef`
- `status`

## Notification Hooks

Notifications should route through Origin only.

Supported uses:

- run failure
- repeated failure
- important completion
- manual attention requested
- external event requiring review

Delivery channels in v1:

- in-app
- push

Not in v1:

- outbound email notifications
- Telegram notifications

## Relationship To Planning

Automations may be linked to:

- tasks
- calendar items
- projects

This linkage is for:

- filtering
- context
- notification routing
- generating follow-up work

An automation should generally operate against Origin planning objects rather than raw Google semantics.

## Relationship To Chat

- Chat is the primary way to create automations.
- The agent should be able to gather requirements in chat and then persist them as structured automation state.
- Structured UI can later review and edit those same objects.

## Relationship To Memory

Automations may read from `Origin/Memory.md` and related memory artifacts as part of their context.

Memory is not an automation object, but it is valid execution context.

## Relationship To External Systems

Automations may act on:

- email
- GitHub
- Telegram
- Google Calendar
- Google Tasks
- local files
- managed notes

They should not require the user to manually re-state provider semantics in chat once the automation object exists.

## Relationship To Provider Ingress

For provider-backed reactive workflows, automations should trigger from normalized activity events emitted by provider ingress, not by diffing provider cache state directly.

The intended flow is:

1. a provider poller runs
2. the selective provider cache is updated
3. Origin emits activity events for meaningful changes
4. matching automations trigger from those events
5. the automation reads provider cache and linked Origin objects for execution context

Examples:

- `on new email` should trigger from an email ingress event such as `email.thread.created` or `email.message.received`
- `on followed GitHub PR review requested` should trigger from a GitHub ingress event such as `github.pr.review_requested`
- `on Telegram mention in tracked group` should trigger from a Telegram ingress event such as `telegram.message.mentioned`

First-party domain events may still be emitted after reconciliation, but they are a separate audit and object-lifecycle surface.

They should not become a second trigger surface for the same provider change unless the implementation explicitly preserves the same durable event identity across both surfaces by carrying the originating ingress event id forward.

This keeps the trigger surface edge-based and makes retries, observability, and duplicate suppression much cleaner.

## Implementation Notes

- Use SQLite for operational state that is easier to query outside the CRDT store.
- Keep the durable automation definition in replicated local-first state.
- Keep execution logs, runs, and activity events queryable from the app.
- Favor a small number of explicit trigger and action types over a generic workflow DSL.
- The shared provider polling and event-ingress model is defined in [provider_ingress_api.md](./provider_ingress_api.md).
