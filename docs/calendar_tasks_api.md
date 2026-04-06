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

### Recurrence semantics

- Recurrence is modeled as a series of normal task occurrences, not as one task whose due window mutates forever
- Each recurring occurrence is still a normal task with its own status, history, links, and due window
- Completing an occurrence advances the series by creating the next occurrence according to the recurrence rule
- This preserves clean per-occurrence history and keeps completion semantics intuitive

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
- Recurrence is modeled as a series of normal calendar item occurrences
- Each occurrence is still a normal calendar item with its own history, sync links, and status
- The recurrence rule defines how future occurrences are generated and related

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
- A non-recurring calendar item has `recurrence = null`

## `ExternalLink`

Planning objects may keep external linkage metadata.

### Current v1 link target

- `googleCalendar`
- `googleTasks`

### `googleCalendar` fields

- `calendarId`
- `eventId`
- `lastPulledAt`
- `lastPushedAt`
- `lastExternalHash`
- `syncMode: "import" | "mirror" | "detached"`

### `googleTasks` fields

- `taskListId`
- `taskId`
- `lastPulledAt`
- `lastPushedAt`
- `lastExternalHash`
- `syncMode: "import" | "mirror" | "detached"`

## Planning Relationships

- A project can contain many tasks and calendar items
- A label can be attached to many tasks and calendar items
- A task can link to zero or more calendar items
- A calendar item can link to zero or more tasks
- A task may link to a note for long-form context
- A task can depend on zero or more other tasks through `blockedByTaskIds[]`
- A recurring task occurrence can link to a previous and next occurrence through recurrence metadata
- A recurring calendar item occurrence can link to a previous and next occurrence through recurrence metadata

## Query Surface

## Projects

- `origin planning project list`
- `origin planning project get <project-id>`

### Filters

- `--status`
- `--archived`
- `--search`

## Labels

- `origin planning label list`
- `origin planning label get <label-id>`

### Filters

- `--archived`
- `--search`

## Tasks

- `origin planning task list`
- `origin planning task get <task-id>`

### Filters

- `--status`
- `--priority`
- `--project`
- `--label`
- `--blocked-by`
- `--is-blocked`
- `--is-blocking`
- `--recurring`
- `--recurrence-series`
- `--linked-calendar-item`
- `--google-tasks-synced`
- `--due-before`
- `--due-after`
- `--due-between`
- `--include-archived`
- `--search`

## Calendar items

- `origin planning calendar-item list`
- `origin planning calendar-item get <calendar-item-id>`

### Filters

- `--kind`
- `--status`
- `--project`
- `--label`
- `--task`
- `--recurring`
- `--recurrence-series`
- `--from`
- `--to`
- `--all-day`
- `--include-archived`
- `--search`

## Planning views

These are read models for app UI and agent reasoning.

- `origin planning agenda --from <ts> --to <ts>`
- `origin planning calendar --from <ts> --to <ts> --view day|week|month`
- `origin planning board --group-by status|project|label`
- `origin planning inbox`
- `origin planning upcoming`
- `origin planning overdue`
- `origin planning task graph --task <task-id>`
- `origin planning recurring --from <ts> --to <ts>`

## Mutation Surface

## Projects

- `origin planning project create --name <name> [--slug <slug>] [--description-md <md>] [--color <color>]`
- `origin planning project update <project-id> [--name ...] [--description-md ...] [--color ...] [--status ...]`
- `origin planning project archive <project-id>`
- `origin planning project unarchive <project-id>`
- `origin planning project delete <project-id>`

## Labels

- `origin planning label create --name <name> [--slug <slug>] [--description-md <md>] [--color <color>]`
- `origin planning label update <label-id> [--name ...] [--description-md ...] [--color ...]`
- `origin planning label archive <label-id>`
- `origin planning label unarchive <label-id>`
- `origin planning label delete <label-id>`

## Tasks

- `origin planning task create --title <title> [--status <status>] [--priority <priority>] [--project <project-id>] [--label <label-id>]... [--description-md <md>] [--note <note-id>] [--due-kind date|datetime] [--due-from <value>] [--due-at <value>] [--due-timezone <tz>]`
- `origin planning task update <task-id> [--title ...] [--status ...] [--priority ...] [--description-md ...] [--note ...]`
- `origin planning task set-project <task-id> --project <project-id>`
- `origin planning task clear-project <task-id>`
- `origin planning task add-label <task-id> --label <label-id>`
- `origin planning task remove-label <task-id> --label <label-id>`
- `origin planning task add-dependency <task-id> --blocked-by <task-id>`
- `origin planning task remove-dependency <task-id> --blocked-by <task-id>`
- `origin planning task clear-dependencies <task-id>`
- `origin planning task set-due-window <task-id> [--due-kind date|datetime] [--due-from <value>] [--due-at <value>] [--due-timezone <tz>]`
- `origin planning task clear-due-window <task-id>`
- `origin planning task set-recurrence <task-id> --frequency daily|weekly|monthly|yearly [--interval <n>] [--by-weekday <weekday>]... [--by-month-day <n>]... [--timezone <tz>] [--advance-mode on_completion|on_schedule]`
- `origin planning task clear-recurrence <task-id>`
- `origin planning task recurrence-preview <task-id> [--count <n>]`
- `origin planning task complete <task-id>`
- `origin planning task reopen <task-id>`
- `origin planning task cancel <task-id>`
- `origin planning task archive <task-id>`
- `origin planning task unarchive <task-id>`
- `origin planning task delete <task-id>`
- `origin planning task link-note <task-id> --note <note-id>`
- `origin planning task unlink-note <task-id>`
- `origin planning task link-calendar-item <task-id> --calendar-item <calendar-item-id>`
- `origin planning task unlink-calendar-item <task-id> --calendar-item <calendar-item-id>`

## Calendar items

- `origin planning calendar-item create --title <title> --kind event|time_block [--status <status>] [--project <project-id>] [--label <label-id>]... [--description-md <md>] [--task <task-id>]... [--all-day] [--start-date <date>] [--end-date-exclusive <date>] [--start-at <ts>] [--end-at <ts>] [--timezone <tz>] [--location <text>]`
- `origin planning calendar-item update <calendar-item-id> [--title ...] [--kind ...] [--status ...] [--description-md ...] [--location ...] [schedule flags]`
- `origin planning calendar-item set-recurrence <calendar-item-id> --frequency daily|weekly|monthly|yearly [--interval <n>] [--by-weekday <weekday>]... [--by-month-day <n>]... [--timezone <tz>]`
- `origin planning calendar-item clear-recurrence <calendar-item-id>`
- `origin planning calendar-item recurrence-preview <calendar-item-id> [--count <n>]`
- `origin planning calendar-item add-label <calendar-item-id> --label <label-id>`
- `origin planning calendar-item remove-label <calendar-item-id> --label <label-id>`
- `origin planning calendar-item link-task <calendar-item-id> --task <task-id>`
- `origin planning calendar-item unlink-task <calendar-item-id> --task <task-id>`
- `origin planning calendar-item cancel <calendar-item-id>`
- `origin planning calendar-item archive <calendar-item-id>`
- `origin planning calendar-item unarchive <calendar-item-id>`
- `origin planning calendar-item delete <calendar-item-id>`

## Google Calendar Sync Surface

## Sync bridge rules

- The Google Calendar bridge syncs Origin calendar items with Google Calendar events
- Imported Google events create or update Origin calendar items
- Exported Origin calendar items push to Google Calendar through stable external links
- Recurring Google events should reconcile into first-party recurring calendar item series
- Recurring Origin calendar item series should be exportable back to Google Calendar

### Mental model

- Google Calendar only sees events
- Origin syncs calendar items to Google Calendar

## Commands

- `origin planning google-calendar status`
- `origin planning google-calendar pull [--calendar-id <id>]`
- `origin planning google-calendar push [--calendar-id <id>]`
- `origin planning google-calendar reconcile [--calendar-id <id>]`
- `origin planning google-calendar attach <calendar-item-id> --calendar-id <id> [--mode import|mirror]`
- `origin planning google-calendar detach <calendar-item-id>`

## Google Tasks Sync Surface

## Sync bridge rules

- The Google Tasks bridge syncs Origin tasks with Google Tasks tasks
- Imported Google Tasks entries create or update Origin tasks
- Exported Origin tasks push to Google Tasks through stable external links
- Google Tasks limitations do not reduce Origin's canonical task model
- Fields unsupported by Google Tasks remain Origin-only metadata

## Commands

- `origin planning google-tasks status`
- `origin planning google-tasks pull [--task-list-id <id>]`
- `origin planning google-tasks push [--task-list-id <id>]`
- `origin planning google-tasks reconcile [--task-list-id <id>]`
- `origin planning google-tasks attach <task-id> --task-list-id <id> [--mode import|mirror]`
- `origin planning google-tasks detach <task-id>`

## Sync conflict semantics

- External Google changes are imported as normal Origin changes authored by `sync:google-calendar`
- Local Origin changes remain in local-first state even while offline
- Reconciliation should preserve data and prefer explicit conflict recording over silent overwrite
- Stable linkage lives in Origin state; a small opaque marker in the Google event description is allowed for recovery but is not canonical metadata storage

## Google Tasks conflict semantics

- External Google Tasks changes are imported as normal Origin changes authored by `sync:google-tasks`
- Local Origin changes remain in local-first state even while offline
- Reconciliation should preserve data and prefer explicit conflict recording over silent overwrite
- Stable linkage lives in Origin state; unsupported Google Tasks fields do not erase richer Origin task fields

## Events For Automations

Planning events should be emitted for agent workflows and background jobs.

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
