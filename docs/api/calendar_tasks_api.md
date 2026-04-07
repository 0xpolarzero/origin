# Origin Calendar and Tasks API

## Status

- Working draft
- Scope: v1 planning domain
- Linked from: [prd.md](./prd.md)

## Purpose

This document defines the full v1 API surface for Origin's planning domain:

- tasks
- calendar items
- projects
- labels
- Google Calendar sync
- Google Tasks sync
- planning read models used by the app and by the agent CLI

The planning domain is first-party. Google Calendar and Google Tasks are bidirectional sync targets and import sources, not the primary internal model.

`docs/api/origin_incur_cli.ts` is the canonical CLI contract for this domain. This document is normative on planning semantics and command families, but exact CLI spellings, nesting, flags, examples, and output schemas come from the canonical CLI.

## Design Principles

- Origin owns the canonical planning model
- The planning model works fully offline on every peer
- All planning objects live in replicated local-first state
- Google provider sync is additive to Origin's model, not a substitute for it
- Tasks and calendar items are distinct object types
- Direct agent reasoning should target Origin planning objects, not raw Google event semantics
- API design should feel closer to Linear than to a thin calendar wrapper
- Calendar items sync with Google Calendar events
- Tasks sync with Google Tasks tasks

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

- A task may optionally be synchronized with Google Tasks
- The task remains the canonical planning object; Google Tasks is an external synchronized representation
- Some Origin task fields are richer than Google Tasks and therefore remain Origin-only
- In particular:
  - `dueFrom` has no direct Google Tasks equivalent
  - dependency edges remain Origin-only
  - recurrence remains Origin-canonical even if mirrored externally in a simpler form
  - Google Tasks v1 does not model the full Origin recurrence series or planning-bridge relationship graph

### Recurrence semantics

- Recurrence is modeled as a canonical series plus materialized occurrences, not as one task whose due window mutates forever
- The series root plus explicit exceptions are the canonical records for the series
- Materialized recurring occurrences behave like normal tasks for status, history, links, and due window when they are present
- Recurrence is occurrence-based
- The series root is the occurrence whose `occurrenceIndex = 0`
- Series-level recurrence mutations operate on the series root task occurrence
- A single-occurrence edit creates or updates an explicit exception occurrence for that `occurrenceIndex`; it does not rewrite the series root
- This preserves clean per-occurrence history and keeps completion semantics intuitive
- The same materialization and exception rules below apply to task series and calendar item series

## `TaskRecurrence`

Represents recurrence metadata attached to a task occurrence.

### Fields

- `seriesId`
- `frequency: RecurrenceFrequency`
- `interval`
- `byWeekday[]`
- `byMonthDay[]`
- `timezone`
- `occurrenceIndex`
- `previousOccurrenceTaskId`
- `nextOccurrenceTaskId`
- `advanceMode: "on_completion" | "on_schedule"`

### Rules

- `interval >= 1`
- `byWeekday[]` is only valid for weekly recurrence
- `byMonthDay[]` is only valid for monthly recurrence
- `timezone` is required for datetime-based recurring tasks
- `occurrenceIndex` is zero-based within a recurrence series
- The series root is the occurrence whose `occurrenceIndex = 0`
- Series-level recurrence mutations operate on the series root task
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
- Recurrence is occurrence-based
- The series root is the occurrence whose `occurrenceIndex = 0`
- Series-level recurrence mutations operate on the series root calendar item occurrence
- A single-occurrence edit creates or updates an explicit exception occurrence for that `occurrenceIndex`; it does not rewrite the series root
- The recurrence rule defines how future occurrences are generated and related

### Recurrence materialization and exceptions

- The series root is the canonical recurrence definition for both tasks and calendar items
- Origin may materialize future occurrences ahead of time for planning, sync, and history views, but generated occurrences are derived from the root rule and are not alternate canonical roots
- Only the series root and explicit exception occurrences are canonical records for the series
- A single-occurrence edit creates or updates an explicit exception occurrence for that `occurrenceIndex`; it does not rewrite the series root
- For tasks, single-occurrence completion, due window, schedule, or status changes are stored as task-occurrence exceptions
- For calendar items, single-occurrence time or status changes are stored as calendar-item-occurrence exceptions
- Series-level edits update the root recurrence rule and apply to future generated occurrences; existing explicit exceptions remain exceptions unless edited directly
- A canceled or skipped occurrence is represented as an explicit exception, not by deleting the whole series

## `CalendarItemRecurrence`

Represents recurrence metadata attached to a calendar item occurrence.

### Fields

- `seriesId`
- `frequency: RecurrenceFrequency`
- `interval`
- `byWeekday[]`
- `byMonthDay[]`
- `timezone`
- `occurrenceIndex`
- `previousOccurrenceCalendarItemId`
- `nextOccurrenceCalendarItemId`

### Rules

- `interval >= 1`
- `byWeekday[]` is only valid for weekly recurrence
- `byMonthDay[]` is only valid for monthly recurrence
- `timezone` is required for datetime-based recurring calendar items
- `occurrenceIndex` is zero-based within a recurrence series
- The series root is the occurrence whose `occurrenceIndex = 0`
- Series-level recurrence mutations operate on the series root calendar item
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
- For recurring series, `attach` and `detach` apply at the series root; occurrences inherit the linkage and do not carry independent attach state.
- `attach` creates or updates the stable external link for an Origin object
- If provider object ids are supplied by the canonical CLI/runtime, `attach` may bind the Origin object to an existing Google event or Google task instead of creating a fresh external object
- The planning object remains the source of truth for its own external-link metadata; the selected Google calendar or task list is the server-owned bridge surface that defines where that link may dispatch
- If `attach`, `detach`, `pull`, `push`, or `reconcile` is requested while a peer is offline, Origin records the requested bridge state locally first and treats provider dispatch as pending until the server-owned bridge job applies it
- `syncMode = "import"` means the next pull or reconcile imports from the linked external object into the Origin object without making Google canonical, and it never propagates destructive local deletes or cancels outward
- `syncMode = "mirror"` means Origin and Google sync bidirectionally through the stable external link, and destructive local changes propagate outward when the provider supports the corresponding remote change
- For recurring Google Calendar events and Google Tasks series, the Google master maps to the Origin series root
- A single Google recurring exception maps to an explicit Origin exception occurrence tied to the same series and `occurrenceIndex`
- Mirror mode exports explicit Origin exceptions back as Google exceptions when the provider supports them
- Import mode keeps Origin canonical; Google-side recurrence exceptions are read as external representations of Origin exceptions, not as a separate series branch
- If a provider deletes one occurrence of a recurring series, Origin preserves the series root and records that occurrence as an explicit canceled or skipped exception
- If the linked Google object is deleted or otherwise disappears remotely, Origin preserves the local object, detaches the external link, and records the situation for review or conflict resolution
- `detach` leaves the external provider object untouched, preserves the local object, and changes the local link state to `detached`

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

`docs/api/origin_incur_cli.ts` is the canonical CLI contract for planning. This document defines the domain surface and semantics; exact command spellings and flags come from the canonical CLI.

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
- Origin planning objects stay canonical; the selected Google calendar is the external bridge surface that feeds or receives those objects
- Status and repair live on the canonical CLI; this document does not define a separate operational surface
- Use canonical CLI surfaces such as `origin planning google-calendar status`, `origin planning google-calendar reset-cursor`, and `origin planning google-calendar repair`

### Domain rules

- The Google Calendar bridge syncs Origin calendar items with Google Calendar events
- Imported Google events create or update Origin calendar items
- Exported Origin calendar items push to Google Calendar through stable external links
- Recurring Google events reconcile into first-party recurring calendar item series
- Recurring Origin calendar item series remain Origin-canonical even when mirrored to Google Calendar
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
- Origin planning objects stay canonical; the selected Google task list is the external bridge surface that feeds or receives those objects
- Status and repair live on the canonical CLI; this document does not define a separate operational surface
- Use canonical CLI surfaces such as `origin planning google-tasks status`, `origin planning google-tasks reset-cursor`, and `origin planning google-tasks repair`

### Domain rules

- The Google Tasks bridge syncs Origin tasks with Google Tasks tasks
- Imported Google Tasks entries create or update Origin tasks
- Exported Origin tasks push to Google Tasks through stable external links
- Google Tasks limitations do not reduce Origin's canonical task model
- Google Tasks v1 is a flat task-list bridge, not a full planning mirror
- Fields unsupported by Google Tasks remain Origin-only metadata and are not expected to round-trip losslessly
- In v1, the bridge does not model the full Origin recurrence series, dependency graph, project/label topology, or calendar-link relationships as first-class Google Tasks state
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
- Support bidirectional Google Tasks sync for tasks
- Support recurring calendar item series
- Support bidirectional Google Calendar sync for calendar items
