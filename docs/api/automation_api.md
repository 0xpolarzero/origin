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
- `args`
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
- `activityEventIds[]`
- `createdAt`
- `updatedAt`

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

Filter evaluation is against the normalized ingress event contract from [provider_ingress_api.md](./provider_ingress_api.md), not provider-native webhook or polling payloads.

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

Canonical filter-field mapping in v1:

- `changeKinds[]` matches event `changeKinds[]`
- `status[]` matches event `attributes.status`
- `labels[]` matches event `attributes.labels[]`
- `reviewDecisions[]` matches event `attributes.reviewDecision`
- `summaryTriggerKinds[]` matches event `attributes.summaryTriggerKind`
- `authorRoles[]` matches event `attributes.authorRole`
- `isMention` matches event `attributes.isMention`

Matching semantics in v1:

- `eventKinds[]` match exact durable event-kind strings.
- `sourceScope` keys are conjunctive. Scalar keys such as `provider` must match exactly. List-valued keys such as `repo`, `chatId`, or `calendarId` match when the event carries at least one overlapping value.
- `changeKinds[]`, `labels[]`, `reviewDecisions[]`, `summaryTriggerKinds[]`, and `authorRoles[]` also match by non-empty intersection with the event payload.
- If a filter refers to an attribute the event does not carry, the filter fails rather than silently passing.

Array-valued filters are exact-match intersection checks against the event payload. Scalar normalized fields such as `attributes.status`, `reviewDecision`, `summaryTriggerKind`, and `authorRole` match when one requested value exactly equals the event value.

`summaryTriggerKinds[]` is for Telegram summary-job style events only. Supported v1 values are:

- `manual`
- `scheduled`
- `mention`
- `agent_decision`

Telegram automatic summaries are still ordinary automations. Their schedule or event trigger lives here; Telegram group policy only gates whether summary automation may run or post for a group and provides default lookback context.

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

Each action carries:

- `type`
- `command`
- `args`
- `summary`

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

## Execution Model

- The server peer is the execution authority for always-on automations.
- Client peers may create and edit automation state locally.
- When online, the server picks up active automations and runs them.
- When offline, desired state can still be edited and queued.
- A scheduled automation should not double-run if the server restarts or a peer reconnects.
- Missed runs should follow `runPolicy`.
- Manual runs should record the triggering actor and reason.
- Scheduled runs dedupe on `(automationId, scheduledAt)`.
- Reactive runs dedupe on `(automationId, activityEventId)`.
- `scheduledAt` and `activityEventId` are the logical run identity anchors when present.
- Retrying a failed run reuses the same logical run record and increments attempt state.

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
