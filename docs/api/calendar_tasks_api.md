# Origin Calendar and Tasks API

## Status

- Working draft
- Scope: v1 planning domain
- Linked from: [prd.md](../prd.md)

## Purpose

This document defines the full v1 API surface for Origin's planning domain:

- tasks
- calendar items
- projects
- labels
- Google Calendar sync
- Google Tasks sync
- planning read models used by the app and by the agent CLI

The planning domain is first-party. Google Calendar is a bidirectional sync target and import source for calendar items. Google Tasks is a bidirectional sync target and import source only for non-recurring task links. Neither is the primary internal model.

`docs/api/origin_incur_cli.ts` is the stable documentation entrypoint for the canonical CLI contract for this domain. That file re-exports the app-owned CLI spec from `apps/server/src/cli/spec.ts`. This document is normative on planning semantics and command families, but exact CLI spellings, nesting, flags, examples, and output schemas come from the canonical CLI contract.

## Design Principles

- Origin owns the canonical planning model
- The planning model works fully offline on every peer
- All planning objects live in replicated local-first state
- Google provider sync is additive to Origin's model, not a substitute for it
- Tasks and calendar items are distinct object types
- Direct agent reasoning should target Origin planning objects, not raw Google event semantics
- API design should feel closer to Linear than to a thin calendar wrapper
- Calendar items sync with Google Calendar events
- Non-recurring tasks sync with Google Tasks tasks

## Non-Goals For V1

- Subtasks
- Dependency kinds beyond `blockedBy`
- Custom user-defined workflows or fields
- Multiple assignees or multi-user collaboration semantics
- A separate external task provider as the primary task backend

## Common Conventions

### Object identity

Every planning object has:

- `id`
- `createdAt`
- `updatedAt`
- `createdByActor`
- `updatedByActor`
- `archivedAt`
- `deletedAt`

### Actor identity

Actor identifiers should be explicit and machine-readable.

They should encode:

- actor kind
- peer identity
- source or subsystem when useful

Recommended shapes:

- `user:<peer-id>`
- `agent:<peer-id>:<agent-name>`
- `sync:<provider>`
- `external:<peer-id>:filesystem`
- `external:<peer-id>:<source>`

Examples:

- `user:macbook`
- `user:iphone`
- `agent:server:planner`
- `sync:google-calendar`
- `sync:google-tasks`
- `external:macbook:filesystem`
- `external:server:filesystem`

The distinction between `external:macbook:filesystem` and `external:server:filesystem` is peer attribution, not type-level semantics. The system needs to know where an imported filesystem change originated for history, debugging, conflict inspection, and trust decisions.

### Soft deletion

- `archive` means hidden from normal active views but recoverable
- `delete` means tombstoned in replicated state and hidden from normal UI
- Hard purge is not part of the normal v1 planning surface

### Timestamps

- Canonical machine format: ISO 8601
- Timezone format: IANA timezone string
- Datetime values must be timezone-aware

## Shared Types

### `Priority`

- `none`
- `low`
- `medium`
- `high`
- `urgent`

### `TaskStatus`

- `backlog`
- `todo`
- `in_progress`
- `done`
- `canceled`

### `ProjectStatus`

- `active`
- `paused`
- `completed`
- `archived`

### `CalendarItemStatus`

- `confirmed`
- `tentative`
- `canceled`

### `CalendarItemKind`

- `event`
- `time_block`

### `SourceKind`

- `manual`
- `agent`
- `imported`
- `synced`

### `RecurrenceFrequency`

- `daily`
- `weekly`
- `monthly`
- `yearly`

### `Weekday`

- `monday`
- `tuesday`
- `wednesday`
- `thursday`
- `friday`
- `saturday`
- `sunday`

`RecurrenceFrequency` and `Weekday` remain useful helper vocab for UI, previews, and rule editing, but the canonical persisted recurrence contract in v1 is the recurrence `rule` described below rather than a second field-by-field recurrence object.

### Canonical recurrence contract

- V1 persists one canonical recurrence shape for both tasks and calendar items:
  - `rule`
  - `startDate`
  - `endDate`
  - `timezone`
  - `seriesId`
  - `occurrenceKey`
  - `occurrenceIndex`
  - `materializationKind`
- `rule` is an RRULE-style cadence expression for the series. Series bounds live in `startDate` and `endDate`, not inside the rule itself.
- `startDate` and `endDate` are local series-date bounds. For timed task series, the time-of-day comes from the root task's datetime due-window fields (`dueFrom` and/or `dueAt` with `dueKind = "datetime"`). For timed calendar-item series, it comes from the root calendar item's scheduled `startAt` / `endAt` fields.
- There is no separate hidden series header in v1. The series root occurrence is both the canonical series definition and the first scheduled occurrence.

## Object Model

## `Project`

Represents a planning container similar to a Linear project.

### Fields

- `id`
- `name`
- `slug`
- `status: ProjectStatus`
- `descriptionMd`
- `color`
- `labelIds[]`
- `source: SourceKind`
- `createdAt`
- `updatedAt`
- `archivedAt`
- `deletedAt`

## `Label`

Represents a reusable planning tag.

### Fields

- `id`
- `name`
- `slug`
- `color`
- `descriptionMd`
- `createdAt`
- `updatedAt`
- `archivedAt`
- `deletedAt`

## `Task`

Represents a unit of work in Origin's first-party planning system.

### Fields

- `id`
- `title`
- `status: TaskStatus`
- `priority: Priority`
- `projectId`
- `labelIds[]`
- `descriptionMd`
- `noteId`
- `calendarItemIds[]`
- `blockedByTaskIds[]`
- `dueKind: "date" | "datetime" | null`
- `dueFrom`
- `dueAt`
- `dueTimezone`
- `recurrence`
- `completedAt`
- `canceledAt`
- `source: SourceKind`
- `externalLinks`
- `createdAt`
- `updatedAt`
- `createdByActor`
- `updatedByActor`
- `archivedAt`
- `deletedAt`

### `dueFrom` and `dueAt`

`dueFrom` and `dueAt` define a due window.

- `dueAt` alone:
  a deadline
- `dueFrom` alone:
  a not-before / earliest-work date or datetime
- `dueFrom` plus `dueAt`:
  a due window from `x` to `y`

### Due window rules

- If `dueKind = "date"`, `dueFrom` and `dueAt` are stored as `YYYY-MM-DD`
- If `dueKind = "datetime"`, `dueFrom` and `dueAt` are stored as timezone-aware ISO 8601 datetimes and `dueTimezone` is required
- If both are present, `dueFrom <= dueAt`
- If neither is present, the task has no due window

### UI semantics

- A task with only `dueAt` is shown as due at a point in time
- A task with `dueFrom` and `dueAt` can be rendered as spanning multiple days in planning views
- A due window is not itself a calendar booking; it is planning metadata

### Dependency semantics

- `blockedByTaskIds[]` lists the tasks that must be completed or cleared before this task is unblocked
- Reverse blocking relationships are derived in read models rather than stored separately as canonical task fields
- A task is considered blocked when `blockedByTaskIds[]` contains at least one active task that is neither `done` nor `canceled`

### Google Tasks sync semantics

- A non-recurring task may optionally be synchronized with Google Tasks
- The task remains the canonical planning object; Google Tasks is an external synchronized representation
- Some Origin task fields are richer than Google Tasks and therefore remain Origin-only
- In particular:
  - `dueFrom` has no direct Google Tasks equivalent
  - dependency edges remain Origin-only
  - recurring Origin tasks are not attachable to Google Tasks in v1
  - Google Tasks v1 does not model the full Origin recurrence series, exception graph, or recurring-task linkage model

### Recurrence semantics

- Recurrence is modeled as a canonical series plus materialized occurrences, not as one task whose due window mutates forever
- The series root plus explicit exceptions are the canonical records for the series
- Materialized recurring occurrences behave like normal tasks for status, history, links, and due window when they are present
- Every occurrence has a stable `occurrenceKey` representing its original scheduled slot inside the series
- `occurrenceIndex` is a zero-based projection for ordering and display; it is not the sole cross-system identity for bridge reconciliation
- The series root is the occurrence whose `materializationKind = "root"` and whose `occurrenceIndex = 0`
- Series-level recurrence mutations operate on the series root task occurrence
- A single-occurrence edit creates or updates an explicit exception occurrence for that `occurrenceKey`; it does not rewrite the series root
- This preserves clean per-occurrence history and keeps completion semantics intuitive
- The same materialization and exception rules below apply to task series and calendar item series

## `TaskRecurrence`

Represents recurrence metadata attached to a task occurrence.

### Fields

- `seriesId`
- `rule`
- `startDate`
- `endDate`
- `timezone`
- `occurrenceKey`
- `occurrenceIndex`
- `materializationKind: "root" | "exception" | "derived"`
- `previousOccurrenceTaskId`
- `nextOccurrenceTaskId`
- `providerRef`
- `providerHash`
- `advanceMode: "on_completion" | "on_schedule"`

### Rules

- `rule` is the canonical persisted RRULE-style cadence expression for the series
- `startDate` is the canonical local series start bound
- `endDate` is optional and bounds a finite series in v1 when present; no occurrence whose scheduled local series date falls after `endDate` belongs to the series
- `timezone` is required for datetime-based recurring tasks
- For timed recurring tasks, the root task's datetime due-window fields carry the canonical time-of-day; the recurrence object carries the cadence and local date bounds
- `occurrenceKey` is the canonical occurrence identity for exceptions, bridge reconciliation, and history joins
- `occurrenceKey` is a recurrence-id-style slot key derived from the occurrence's original scheduled local slot before exception edits:
  - date-based series use `YYYY-MM-DD`
  - datetime-based series use local `YYYY-MM-DDTHH:mm:ss` in the series timezone
- `occurrenceIndex` is zero-based within a recurrence series projection and may change if the rule or series bounds change
- The series root is the occurrence whose `materializationKind = "root"` and whose `occurrenceIndex = 0`
- Explicit exceptions use `materializationKind = "exception"` and are keyed by `occurrenceKey`
- Generated occurrences use `materializationKind = "derived"` and do not introduce a second canonical record
- Series-level recurrence mutations operate on the series root task
- `occurrenceKey` is immutable once assigned. Series-level edits never rebase an explicit exception by `occurrenceIndex`, nearest date, or rewritten cadence
- Root-level provider linkage and hashes live in the task's stable `externalLinks[]`
- `providerRef` and `providerHash` are only populated on explicit exception occurrences when the attached provider exposes per-occurrence remote objects
- `advanceMode = "on_completion"` means the next occurrence is created when the current occurrence is completed
- `advanceMode = "on_schedule"` means the system creates or maintains the next occurrence according to the recurrence rule even if the current occurrence is not yet completed
- A non-recurring task has `recurrence = null`

## `CalendarItem`

Represents a scheduled block or event in Origin's planning domain.

### Fields

- `id`
- `title`
- `kind: CalendarItemKind`
- `status: CalendarItemStatus`
- `descriptionMd`
- `projectId`
- `labelIds[]`
- `taskIds[]`
- `allDay`
- `startDate`
- `endDateExclusive`
- `startAt`
- `endAt`
- `timezone`
- `recurrence`
- `location`
- `source: SourceKind`
- `externalLinks`
- `createdAt`
- `updatedAt`
- `createdByActor`
- `updatedByActor`
- `archivedAt`
- `deletedAt`

### Schedule rules

- If `allDay = true`:
  - use `startDate`
  - use `endDateExclusive`
  - do not use `startAt` or `endAt`
- If `allDay = false`:
  - use `startAt`
  - use `endAt`
  - `timezone` is required
- `taskIds[]` may be empty
- A calendar item may exist without a task when it represents a standalone event

### Recurrence semantics

- Calendar recurrence is first-party in v1
- Recurrence is modeled as a canonical series plus materialized occurrences, not as one calendar item whose time mutates forever
- The series root plus explicit exceptions are the canonical records for the series
- Materialized recurring occurrences behave like normal calendar items for history, sync links, and status when they are present
- Every occurrence has a stable `occurrenceKey` representing its original scheduled slot inside the series
- `occurrenceIndex` is a zero-based projection for ordering and display; it is not the sole bridge identity
- The series root is the occurrence whose `materializationKind = "root"` and whose `occurrenceIndex = 0`
- Series-level recurrence mutations operate on the series root calendar item occurrence
- A single-occurrence edit creates or updates an explicit exception occurrence for that `occurrenceKey`; it does not rewrite the series root
- The recurrence rule defines how future occurrences are generated and related

### Recurrence materialization and exceptions

- The series root is the canonical recurrence definition for both tasks and calendar items
- Origin may materialize future occurrences ahead of time for planning, sync, and history views, but generated occurrences are derived from the root rule and are not alternate canonical roots
- Only the series root and explicit exception occurrences are canonical records for the series
- A single-occurrence edit creates or updates an explicit exception occurrence for that `occurrenceKey`; it does not rewrite the series root
- For tasks, single-occurrence completion, due window, schedule, or status changes are stored as task-occurrence exceptions
- For calendar items, single-occurrence time or status changes are stored as calendar-item-occurrence exceptions
- Series-level edits update the root recurrence rule and apply to future generated occurrences; existing explicit exceptions remain exceptions unless edited directly
- Series projection is the root rule/bounds expansion plus explicit exceptions keyed by `occurrenceKey`. An explicit exception replaces the generated occurrence with the same `occurrenceKey`
- If the updated rule or bounds no longer generate an existing exception's `occurrenceKey`, that explicit exception remains as a preserved out-of-pattern exception in the series until edited or deleted directly
- A canceled or skipped occurrence is represented as an explicit exception, not by deleting the whole series

## `CalendarItemRecurrence`

Represents recurrence metadata attached to a calendar item occurrence.

### Fields

- `seriesId`
- `rule`
- `startDate`
- `endDate`
- `timezone`
- `occurrenceKey`
- `occurrenceIndex`
- `materializationKind: "root" | "exception" | "derived"`
- `previousOccurrenceCalendarItemId`
- `nextOccurrenceCalendarItemId`
- `providerRef`
- `providerHash`

### Rules

- `rule` is the canonical persisted RRULE-style cadence expression for the series
- `startDate` is the canonical local series start bound
- `endDate` is optional and bounds a finite series in v1 when present; no occurrence whose scheduled local series date falls after `endDate` belongs to the series
- `timezone` is required for datetime-based recurring calendar items
- For timed recurring calendar items, the root calendar item's `startAt` / `endAt` fields carry the canonical time-of-day; the recurrence object carries the cadence and local date bounds
- `occurrenceKey` is the canonical occurrence identity for exceptions, bridge reconciliation, and history joins
- `occurrenceKey` is a recurrence-id-style slot key derived from the occurrence's original scheduled local slot before exception edits:
  - all-day series use `YYYY-MM-DD`
  - timed series use local `YYYY-MM-DDTHH:mm:ss` in the series timezone
- `occurrenceIndex` is zero-based within a recurrence series projection and may change if the rule or series bounds change
- The series root is the occurrence whose `materializationKind = "root"` and whose `occurrenceIndex = 0`
- Explicit exceptions use `materializationKind = "exception"` and are keyed by `occurrenceKey`
- Generated occurrences use `materializationKind = "derived"` and do not introduce a second canonical record
- Series-level recurrence mutations operate on the series root calendar item
- Root-level provider linkage and hashes live in the calendar item's stable `externalLinks[]`
- `providerRef` and `providerHash` are only populated on explicit exception occurrences when the attached provider exposes per-occurrence remote objects
- A non-recurring calendar item has `recurrence = null`

## `ExternalLink`

Planning objects may keep external linkage metadata.

### Current v1 link target

- `google-calendar`
- `google-tasks`

### `google-calendar` fields

- `calendarId`
- `eventId`
- `lastPulledAt`
- `lastPushedAt`
- `lastExternalHash`
- `syncMode: "import" | "mirror" | "detached"`

### `google-tasks` fields

- `taskListId`
- `taskId`
- `lastPulledAt`
- `lastPushedAt`
- `lastExternalHash`
- `syncMode: "import" | "mirror" | "detached"`

### Lifecycle rules

- External links carry `syncMode: "import" | "mirror" | "detached"`
- For recurring Google Calendar series, `attach` and `detach` apply at the series root; explicit calendar exception occurrences may additionally carry per-occurrence `providerRef` / `providerHash` in recurrence metadata when Google Calendar exposes distinct remote exception objects. Recurring tasks are not attachable to Google Tasks in v1
- `attach` creates or updates the stable external link for an Origin object
- `attach` targets a selected Google bridge surface. If the referenced calendar or task list is not already selected as an active bridge surface, the canonical CLI/runtime must refuse the attach and require explicit surface selection first rather than silently creating an implicit bridge scope
- If provider object ids are supplied by the canonical CLI/runtime, `attach` may bind the Origin object to an existing Google event or Google task instead of creating a fresh external object
- The planning object remains the source of truth for its own external-link metadata; the selected Google calendar or task list is the server-owned bridge surface that defines where that link may dispatch
- `attach`, `detach`, `pull`, `push`, and `reconcile` are server-owned provider actions even when they are requested from another peer. If one is requested while a peer is offline, Origin records the requested bridge state locally first and treats provider dispatch as pending until the provider execution home applies it
- `syncMode = "import"` binds to an existing external object or selected bridge surface and imports shared external fields into Origin on the next pull or reconcile; it does not create a new remote object and it never propagates destructive local deletes or cancels outward
- `syncMode = "mirror"` means Origin and Google sync bidirectionally through the stable external link, and a remote object may be created if no provider object id is already bound. For Google Tasks, this applies only to non-recurring Origin tasks
- Pull or reconcile must match a remote Google object to an existing Origin object by stable bridge linkage first. If no stable link exists, the bridge creates a new Origin object rather than heuristically merging by title, time, or other fuzzy fields; binding an existing local object to that remote object requires explicit attach or repair flow
- For recurring Google Calendar events, the Google master maps to the Origin series root and a Google exception instance maps to an explicit Origin exception keyed by `occurrenceKey`
- The series root's Google master id and hash stay in `externalLinks[]`; per-occurrence Google exception ids and hashes stay on explicit exception recurrence metadata
- Mirror mode exports explicit Origin calendar exceptions back as Google Calendar exceptions when the provider supports them
- Import mode keeps Origin canonical; Google Calendar exceptions are read as external representations of Origin exceptions, not as a separate series branch
- Google Tasks v1 does not model or mirror a remote recurring master/exception graph
- Recurring Origin task series are not attachable to Google Tasks in v1; the canonical runtime must reject `attach` or mirror setup for recurring tasks there
- Google Tasks recurrence linking therefore never creates per-occurrence provider refs or hashes in v1
- If a provider deletes one occurrence of a recurring series, Origin preserves the series root and records that occurrence as an explicit canceled or skipped exception
- If the linked Google object is deleted or otherwise disappears remotely, Origin preserves the local object, detaches the external link, and records the situation for review or conflict resolution
- `detach` leaves the external provider object untouched, preserves the local object, and changes the local link state to `detached`
- `syncMode = "detached"` is an inert local preservation state. Detached links are excluded from automatic pull/push until an explicit attach or repair action re-binds them to a selected bridge surface

Operational ownership under the shared provider ingress model:

- Google Calendar work runs only on the provider execution home and is narrowed there by the selected calendar bridge surfaces
- Google Tasks work runs only on the provider execution home and is narrowed there by the selected task-list bridge surfaces
- Individual `attach` / `detach` operations and planning-object `externalLinks[]` route through an existing selected bridge surface; they do not create another provider worker home

## Planning Relationships

- A project can contain many tasks and calendar items
- A label can be attached to many tasks and calendar items
- A task can link to zero or more calendar items
- A calendar item can link to zero or more tasks
- A task may link to a note for long-form context
- A task can depend on zero or more other tasks through `blockedByTaskIds[]`
- A recurring task occurrence can link to a previous and next occurrence through recurrence metadata
- A recurring calendar item occurrence can link to a previous and next occurrence through recurrence metadata

## Command And Query Surface

`docs/api/origin_incur_cli.ts` is the stable documentation entrypoint for the canonical planning CLI contract, re-exporting the app-owned spec at `apps/server/src/cli/spec.ts`. This document defines the domain surface and semantics; exact command spellings and flags come from the canonical CLI.

### Representative canonical read surface

- Planning views: `origin planning today`, `week`, `agenda`, `window`, `inbox`, `upcoming`, `overdue`, `backlog`, `board`, `recurring`, `task-graph`
- Projects: `origin planning project list|get|search`
- Labels: `origin planning label list|get|search`
- Tasks: `origin planning task list|get|search|related`
- Calendar items: `origin planning calendar-item list|get|search|related`

### Representative canonical mutation surface

- Projects: `origin planning project create|update|archive|unarchive|delete|history|restore`
- Labels: `origin planning label create|update|archive|unarchive|delete|history|restore`
- Tasks: `origin planning task create|update|complete|reopen|cancel|archive|unarchive|delete|history|restore`
- Task subcommands: `project set|clear`, `label add|remove|clear`, `note link|unlink`, `dependency list|add|remove|clear`, `due set|clear`, `schedule set|clear`, `recurrence set|clear|preview|occurrences`, `conflict list|get|resolve`
- Calendar items: `origin planning calendar-item create|update|move|confirm|cancel|archive|unarchive|delete|history|restore`
- Calendar-item subcommands: `label add|remove|clear`, `task link|unlink`, `recurrence set|clear|preview|occurrences`, `conflict list|get|resolve`

Any command examples in this document are illustrative summaries of the canonical CLI families, not a second source of truth for exact flags.

## Google Calendar Bridge

### Operational ownership

- Selected Google calendars are bridge surfaces configured during onboarding or integration setup, not ad hoc per-item attachments
- Each selected calendar has a server-owned poller and cursor under the shared provider ingress model
- Bridge pollers, cursor advancement, and outbound Google Calendar writes run only on the provider execution home
- Origin planning objects stay canonical; the selected Google calendar is the external bridge surface that feeds or receives those objects
- Status and repair live on the canonical CLI; this document does not define a separate operational surface
- Use canonical CLI surfaces such as `origin planning google-calendar status`, `origin planning google-calendar reset-cursor`, and `origin planning google-calendar repair`

### Domain rules

- The Google Calendar bridge syncs Origin calendar items with Google Calendar events
- Imported Google events create or update Origin calendar items
- Exported Origin calendar items push to Google Calendar through stable external links
- Recurring Google events reconcile into first-party recurring calendar item series
- Recurring Origin calendar item series remain Origin-canonical even when mirrored to Google Calendar
- Explicit Origin exception occurrences may carry Google Calendar exception refs and hashes in their recurrence metadata when the provider exposes them
- Google Calendar only sees events; Origin keeps the richer planning semantics

### Representative canonical bridge commands

- `origin planning google-calendar surface list|get|select|deselect`
- `origin planning google-calendar status`
- `origin planning google-calendar pull`
- `origin planning google-calendar push`
- `origin planning google-calendar reconcile`
- `origin planning google-calendar attach`
- `origin planning google-calendar detach`
- Deselecting a selected calendar must refuse while Origin items still target it unless the operator explicitly requests force-detach, which only detaches local links and never deletes remote Google events

## Google Tasks Bridge

### Operational ownership

- Selected Google task lists are bridge surfaces configured during onboarding or integration setup, not ad hoc per-item attachments
- Each selected task list has a server-owned poller and cursor under the shared provider ingress model
- Bridge pollers, cursor advancement, and outbound Google Tasks writes run only on the provider execution home
- Origin planning objects stay canonical; the selected Google task list is the external bridge surface that feeds or receives those objects
- Status and repair live on the canonical CLI; this document does not define a separate operational surface
- Use canonical CLI surfaces such as `origin planning google-tasks status`, `origin planning google-tasks reset-cursor`, and `origin planning google-tasks repair`

### Domain rules

- The Google Tasks bridge syncs Google Tasks tasks with eligible non-recurring Origin tasks
- Imported Google Tasks entries create or update Origin tasks
- Exported non-recurring Origin tasks push to Google Tasks through stable external links
- Google Tasks limitations do not reduce Origin's canonical task model
- Google Tasks v1 is a flat task-list bridge, not a full planning mirror
- Fields unsupported by Google Tasks remain Origin-only metadata and are not expected to round-trip losslessly
- In v1, the bridge does not model the full Origin recurrence series, exception graph, dependency graph, project/label topology, or calendar-link relationships as first-class Google Tasks state
- Recurring Origin tasks are not mirrored to Google Tasks in v1. The bridge supports only non-recurring task links there
- `syncMode = "import"` for Google Tasks binds to an existing Google task or selected task-list import path; it does not create a remote task
- `syncMode = "mirror"` for Google Tasks may create or update a remote Google task for one non-recurring Origin task, but never creates a recurring master/exception graph
- `dueFrom` remains Origin-only; Google Tasks can at best carry a simplified due value

### Representative canonical bridge commands

- `origin planning google-tasks surface list|get|select|deselect`
- `origin planning google-tasks status`
- `origin planning google-tasks pull`
- `origin planning google-tasks push`
- `origin planning google-tasks reconcile`
- Deselecting a selected task list must refuse while Origin tasks still target it unless the operator explicitly requests force-detach, which only detaches local links and never deletes remote Google Tasks entries
- `origin planning google-tasks attach`
- `origin planning google-tasks detach`

## Bridge Conflict Semantics

- External Google Calendar changes are imported as normal Origin changes authored by `sync:google-calendar`
- External Google Tasks changes are imported as normal Origin changes authored by `sync:google-tasks`
- Local Origin changes remain in local-first state even while offline
- Reconciliation should preserve data and prefer explicit conflict recording over silent overwrite
- Stable linkage lives in Origin state; Google-side markers may help recovery but are not canonical metadata storage
- Unsupported Google Tasks fields must not erase richer Origin task fields

## Planning Domain Events

Planning events should be emitted for agent workflows and background jobs.

These are first-party planning object events after Origin has reconciled or mutated planning state.

When a workflow needs to react to Google provider changes specifically, the canonical provider-backed trigger surface remains the ingress events such as `planning.google-calendar.changed` and `planning.google-tasks.changed` from [provider_ingress_api.md](./provider_ingress_api.md).

For those coarse Google bridge ingress events, v1 automation matching is narrowed by `filters.changeKinds[]` plus `sourceScope.calendarId` / `taskListId` / `entityId` from [automation_api.md](./automation_api.md). Activity `sourceRefs[]` and `entityRefs[]` remain contextual read fields, not additional trigger keys.

The `synced_from_google*` events below are planning-domain audit and lifecycle events, not a second competing provider-ingress trigger surface.

### Task events

- `planning.task.created`
- `planning.task.updated`
- `planning.task.completed`
- `planning.task.reopened`
- `planning.task.canceled`
- `planning.task.due_window_changed`
- `planning.task.project_changed`
- `planning.task.labels_changed`
- `planning.task.calendar_links_changed`
- `planning.task.dependencies_changed`
- `planning.task.blocked_state_changed`
- `planning.task.recurrence_changed`
- `planning.task.recurrence_advanced`
- `planning.task.google_tasks_linked`
- `planning.task.google_tasks_unlinked`
- `planning.task.synced_from_google_tasks`
- `planning.task.synced_to_google_tasks`

### Calendar item events

- `planning.calendar_item.created`
- `planning.calendar_item.updated`
- `planning.calendar_item.canceled`
- `planning.calendar_item.tasks_changed`
- `planning.calendar_item.recurrence_changed`
- `planning.calendar_item.google_linked`
- `planning.calendar_item.google_unlinked`
- `planning.calendar_item.synced_from_google`
- `planning.calendar_item.synced_to_google`

### Project and label events

- `planning.project.created`
- `planning.project.updated`
- `planning.project.archived`
- `planning.label.created`
- `planning.label.updated`
- `planning.label.archived`

## Invariants

- A task is not a calendar item
- A due window does not allocate time on the calendar
- A calendar item may schedule work for a task, but does not replace the task
- A blocked task may still carry a due window and calendar links
- Recurrence creates future occurrences; it does not erase past completed occurrences
- Calendar recurrence creates future calendar item occurrences; it does not mutate one item forever
- Google Calendar sync never becomes the canonical source for Origin planning metadata
- Google Tasks sync never becomes the canonical source for Origin planning metadata
- All planning mutations must remain valid offline and sync later

## V1 Defaults

- Use first-party Origin tasks, calendar items, projects, and labels
- Keep task workflow minimal
- Support `dueFrom` plus `dueAt`
- Support task dependencies through `blockedByTaskIds[]`
- Support recurring task series
- Support task-to-calendar linking
- Support bidirectional Google Tasks sync for non-recurring tasks
- Support recurring calendar item series
- Support bidirectional Google Calendar sync for calendar items
