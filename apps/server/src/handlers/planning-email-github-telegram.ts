import { join } from 'node:path'

import { defineHandlers } from '../cli/types.ts'
import {
  addActivity,
  cmpDateDescending,
  coerceArray,
  createActionResult,
  createHistoryEntry,
  createListResult,
  createRevisionDiff,
  createValidationResult,
  includesQuery,
  nextId,
  now,
  pickSummary,
  recordRevision,
  safeObject,
  scoreText,
  selectWindow,
  stableHash,
  takeLimit,
  today,
} from '../runtime/helpers.ts'
import type { RouteHandlerContext } from '../cli/types.ts'
import type { OriginState } from '../runtime/types.ts'

type State = OriginState
type Ctx = RouteHandlerContext<any>

type ProjectRecord = State['planning']['projects'][number]
type LabelRecord = State['planning']['labels'][number]
type TaskRecord = State['planning']['tasks'][number]
type CalendarItemRecord = State['planning']['calendarItems'][number]
type RecurrenceRecord = NonNullable<TaskRecord['recurrence']>
type ExternalLinkRecord = TaskRecord['externalLinks'][number]
type EmailAccountRecord = State['email']['accounts'][number]
type EmailThreadRecord = State['email']['threads'][number]
type EmailMessageRecord = State['email']['messages'][number]
type EmailDraftRecord = State['email']['drafts'][number]
type EmailAttachmentRecord = EmailMessageRecord['attachments'][number]
type GithubRepositoryRecord = State['github']['repositories'][number]
type GithubFollowTargetRecord = State['github']['follows'][number]
type GithubIssueRecord = State['github']['issues'][number]
type GithubPullRequestRecord = State['github']['pullRequests'][number]
type GithubCommentRecord = State['github']['comments'][number]
type GithubReviewRecord = State['github']['reviews'][number]
type TelegramConnectionRecord = State['telegram']['connection']
type TelegramChatRecord = State['telegram']['chats'][number]
type TelegramGroupPolicyRecord = State['telegram']['groups'][number]
type TelegramMessageRecord = State['telegram']['messages'][number]
type TelegramSummaryJobRecord = State['telegram']['summaries'][number]
type IntegrationRecord = State['integrations'][string]
type ActivityRecord = State['activities'][number]
type ConflictRecord = State['sync']['replicaConflicts'][number]
type ProviderPollerRecord = State['integrations'][string]['provider']['pollers'][number]
type ProviderSurfaceRecord = State['integrations'][string]['provider']['surfaces'][number]

const GITHUB_SELECTED_GRANT_IDS_KEY = 'selectedGrantIds'
const GITHUB_SELECTED_GRANT_REPOS_KEY = 'selectedGrantRepositories'
const GITHUB_GRANT_SELECTION_UPDATED_AT_KEY = 'grantSelectionUpdatedAt'
const TELEGRAM_ACKNOWLEDGED_MENTIONS_KEY = 'acknowledgedMentions'

const handlers: Partial<Record<string, (context: Ctx) => unknown>> = {}

function on(route: string, handler: (context: Ctx) => unknown) {
  handlers[route] = handler
}

const actionResult = createActionResult
const listResult = createListResult
const validationResult = createValidationResult
const matchesQuery = includesQuery

async function loadState(runtime: Ctx['runtime']) {
  return (await runtime.store.load()) as State
}

function mutateState<T>(runtime: Ctx['runtime'], mutator: (state: State) => T | Promise<T>) {
  return runtime.store.mutate(mutator as (state: State) => T | Promise<T>) as Promise<T>
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && !(Array.isArray(entry) && entry.length === 0))) as Partial<T>
}

function normalizeCalendarItemKind(kind: string | undefined) {
  return kind === 'focus' ? 'time_block' : kind
}

function normalizeEmailTriageState(state: string | undefined) {
  return state === 'needs-action' ? 'needs_reply' : state
}

function normalizeTelegramConnectionStatus(status: string | undefined) {
  return status === 'connected' ? 'valid' : status
}

function normalizeTelegramSummaryStatus(status: string | undefined) {
  if (status === 'posted') return 'completed'
  if (status === 'pending') return 'queued'
  return status
}

function firstLine(value: string | undefined, fallback: string) {
  const line = (value ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean)
  return line ? line.replace(/^#+\s*/, '').slice(0, 160) : fallback
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

function ensureFound<T>(context: Ctx, value: T | undefined, kind: string, id: string): T {
  if (!value) {
    throw context.error({ code: 'NOT_FOUND', message: `Unknown ${kind}: ${id}` })
  }
  return value
}

function historyEntry(entry: { id: string; actor: string; at: string; summary: string }) {
  return { id: entry.id, actor: entry.actor, at: entry.at, summary: entry.summary }
}

function revisionEntry(entry: NonNullable<TaskRecord['revisions']>[number]) {
  return historyEntry(entry)
}

function entityRef(kind: string, id: string, title: string, summary?: string) {
  return compact({ kind, id, title, summary })
}

function activityOutput(entry: ActivityRecord) {
  return compact({
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    actor: entry.actor,
    target: entry.target,
    at: entry.at,
    summary: entry.summary,
    severity: entry.severity,
    provider: entry.provider,
    'poller-id': entry.pollerId,
    'source-refs': entry.sourceRefs,
    'entity-refs': entry.entityRefs,
    'details-md': entry.detailsMd,
    'trace-id': entry.traceId,
  })
}

function taskLinkProviderOutput(link: ExternalLinkRecord) {
  if (link.provider === 'google-calendar') {
    return compact({
      provider: 'google-calendar',
      ref: link.ref,
      'sync-mode': link.syncMode,
      'lifecycle-status': link.lifecycleStatus,
      'calendar-id': link.calendarId,
      'google-event-id': link.googleEventId,
      'last-pulled-at': link.lastPulledAt,
      'last-pushed-at': link.lastPushedAt,
      'last-external-hash': link.lastExternalHash,
    })
  }
  return compact({
    provider: 'google-tasks',
    ref: link.ref,
    'sync-mode': link.syncMode,
    'lifecycle-status': link.lifecycleStatus,
    'task-list-id': link.taskListId,
    'google-task-id': link.googleTaskId,
    'last-pulled-at': link.lastPulledAt,
    'last-pushed-at': link.lastPushedAt,
    'last-external-hash': link.lastExternalHash,
  })
}

function recurrenceOutput(recurrence: RecurrenceRecord) {
  return compact({
    rule: recurrence.rule,
    'start-date': recurrence.startDate,
    'end-date': recurrence.endDate,
    'series-id': recurrence.seriesId,
    'occurrence-index': recurrence.occurrenceIndex,
    'previous-occurrence-id': recurrence.previousOccurrenceId,
    'next-occurrence-id': recurrence.nextOccurrenceId,
    'advance-mode': recurrence.advanceMode,
  })
}

function projectOutput(project: ProjectRecord) {
  return compact({
    id: project.id,
    name: project.name,
    status: project.status,
    description: project.description,
  })
}

function labelOutput(label: LabelRecord) {
  return compact({
    id: label.id,
    name: label.name,
    color: label.color,
  })
}

function resolveProject(state: State, projectId: string | undefined) {
  return projectId ? state.planning.projects.find((project) => project.id === projectId) : undefined
}

function resolveLabel(state: State, labelId: string | undefined) {
  return labelId ? state.planning.labels.find((label) => label.id === labelId) : undefined
}

function resolveTask(state: State, taskId: string | undefined) {
  return taskId ? state.planning.tasks.find((task) => task.id === taskId) : undefined
}

function resolveCalendarItem(state: State, itemId: string | undefined) {
  return itemId ? state.planning.calendarItems.find((item) => item.id === itemId) : undefined
}

function taskOutput(state: State, task: TaskRecord) {
  const project = resolveProject(state, task.projectId)
  const labels = task.labelIds.map((id) => resolveLabel(state, id)).filter(Boolean) as LabelRecord[]
  return compact({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project: project ? projectOutput(project) : undefined,
    labels: labels.length ? labels.map(labelOutput) : undefined,
    'description-md': task.descriptionMd,
    'note-id': task.noteId,
    'calendar-item-ids': task.calendarItemIds,
    'due-kind': task.dueKind,
    'due-from': task.dueFrom,
    'due-at': task.dueAt,
    'due-timezone': task.dueTimezone,
    'blocked-by': task.blockedBy,
    recurrence: task.recurrence ? recurrenceOutput(task.recurrence) : undefined,
    'external-links': task.externalLinks.length ? task.externalLinks.map(taskLinkProviderOutput) : undefined,
  })
}

function calendarItemOutput(state: State, item: CalendarItemRecord) {
  const project = resolveProject(state, item.projectId)
  const labels = item.labelIds.map((id) => resolveLabel(state, id)).filter(Boolean) as LabelRecord[]
  return compact({
    id: item.id,
    title: item.title,
    status: item.status,
    kind: normalizeCalendarItemKind(item.kind),
    project: project ? projectOutput(project) : undefined,
    labels: labels.length ? labels.map(labelOutput) : undefined,
    'description-md': item.descriptionMd,
    location: item.location,
    'start-date': item.startDate,
    'end-date-exclusive': item.endDateExclusive,
    'start-at': item.startAt,
    'end-at': item.endAt,
    timezone: item.timezone,
    'all-day': item.allDay,
    recurrence: item.recurrence ? recurrenceOutput(item.recurrence) : undefined,
    'task-ids': item.taskIds,
    'external-links': item.externalLinks.length ? item.externalLinks.map(taskLinkProviderOutput) : undefined,
  })
}

function emailAttachmentOutput(attachment: EmailAttachmentRecord) {
  return compact({
    id: attachment.id,
    name: attachment.name,
    'content-type': attachment.contentType,
    size: attachment.size,
    'cached-path': attachment.cachedPath,
  })
}

function emailMessageOutput(message: EmailMessageRecord) {
  return compact({
    id: message.id,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    body: message.body,
    snippet: message.snippet,
    headers: message.headers,
    raw: message.raw,
    at: message.at,
    attachments: message.attachments.length ? message.attachments.map(emailAttachmentOutput) : undefined,
    provenance: message.provenance
      ? compact({
          'is-forwarded': message.provenance.isForwarded,
          'forwarded-by-user': message.provenance.forwardedByUser,
          'forwarded-from-address': message.provenance.forwardedFromAddress,
        })
      : undefined,
  })
}

function emailTriageOutput(thread: EmailThreadRecord) {
  if (!thread.triage) return undefined
  return compact({
    'thread-id': thread.triage.threadId,
    state: normalizeEmailTriageState(thread.triage.state),
    'follow-up-at': thread.triage.followUpAt,
    'linked-task-id': thread.triage.linkedTaskId,
    'notes-md': thread.triage.note,
  })
}

function emailThreadOutput(state: State, thread: EmailThreadRecord, expandMessages = false) {
  const messages = thread.messageIds.map((id) => state.email.messages.find((message) => message.id === id)).filter(Boolean) as EmailMessageRecord[]
  return compact({
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    messages: expandMessages && messages.length ? messages.map(emailMessageOutput) : undefined,
    'triage-state': normalizeEmailTriageState(thread.triage?.state),
    'follow-up-at': thread.triage?.followUpAt,
    'last-message-at': thread.lastMessageAt,
    labels: thread.labelIds,
    freshness: thread.freshness,
  })
}

function emailDraftOutput(draft: EmailDraftRecord) {
  return compact({
    id: draft.id,
    subject: draft.subject,
    to: draft.to,
    body: draft.body,
    'thread-id': draft.threadId,
  })
}

function githubRepositoryOutput(repo: GithubRepositoryRecord) {
  return compact({
    id: repo.id,
    name: repo.name,
    tracked: repo.tracked,
    summary: repo.summary,
    pinned: repo.pinned,
  })
}

function githubFollowTargetOutput(target: GithubFollowTargetRecord) {
  return compact({
    id: target.id,
    kind: target.kind,
    repo: target.repo,
    'target-ref': target.targetRef,
    reason: target.reason,
  })
}

function githubIssueOutput(issue: GithubIssueRecord) {
  return compact({
    id: issue.id,
    ref: issue.ref,
    title: issue.title,
    state: issue.state,
    summary: issue.summary,
    labels: issue.labels,
    assignees: issue.assignees,
  })
}

function githubPullRequestOutput(pr: GithubPullRequestRecord) {
  return compact({
    id: pr.id,
    ref: pr.ref,
    title: pr.title,
    state: pr.state,
    summary: pr.summary,
    reviewers: pr.reviewers,
    checks: pr.checks,
  })
}

function githubCommentOutput(comment: GithubCommentRecord) {
  return compact({
    id: comment.id,
    author: comment.author,
    body: comment.body,
    at: comment.at,
  })
}

function githubReviewOutput(review: GithubReviewRecord) {
  return compact({
    id: review.id,
    author: review.author,
    state: review.state,
    body: review.body,
    at: review.at,
  })
}

function telegramConnectionOutput(connection: TelegramConnectionRecord) {
  return compact({
    status: normalizeTelegramConnectionStatus(connection.status),
    'bot-username': connection.botUsername,
    'expected-privacy-mode': connection.privacyMode,
    'observed-privacy-mode': connection.privacyMode,
    'default-mode': connection.defaultMode,
    'default-summary-enabled': connection.defaultSummaryEnabled,
    'default-summary-lookback': connection.defaultSummaryWindow,
    summary: connection.summary,
  })
}

function telegramChatOutput(chat: TelegramChatRecord) {
  return compact({
    id: chat.id,
    title: chat.title,
    kind: chat.kind,
    summary: chat.summary,
    'is-registered': chat.isRegistered,
    'message-cache-state': chat.messageCacheState,
  })
}

function telegramGroupOutput(group: TelegramGroupPolicyRecord) {
  return compact({
    'chat-id': group.chatId,
    enabled: group.enabled,
    'participation-mode': group.participationMode,
    'summary-policy': group.summaryPolicy ? compact({ enabled: group.summaryPolicy.enabled, window: group.summaryPolicy.window }) : undefined,
    'mention-tracking-enabled': group.mentionTrackingEnabled,
    'message-cache-enabled': group.messageCacheEnabled,
    summary: group.summary,
  })
}

function telegramMessageOutput(message: TelegramMessageRecord) {
  return compact({
    id: message.id,
    author: message.author,
    body: message.body,
    at: message.at,
  })
}

function telegramSummaryOutput(summary: TelegramSummaryJobRecord) {
  return compact({
    id: summary.id,
    'chat-id': summary.chatId,
    'trigger-kind': summary.triggerKind ?? 'manual',
    status: normalizeTelegramSummaryStatus(summary.status),
    summary: summary.summary,
    'output-message-id': summary.outputMessageId,
    'window-start': summary.windowStart,
    'window-end': summary.windowEnd,
    'queued-at': summary.queuedAt,
    'completed-at': summary.completedAt,
    'failed-at': summary.failedAt,
    'last-error': summary.lastError,
    at: summary.at,
  })
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function recordOfStringArray(value: unknown) {
  return Object.fromEntries(
    Object.entries(safeObject(value)).map(([key, entry]) => [key, stringArrayValue(entry)]),
  ) as Record<string, string[]>
}

function recordOfObjects(value: unknown) {
  return Object.fromEntries(
    Object.entries(safeObject(value)).map(([key, entry]) => [
      key,
      Object.fromEntries(
        Object.entries(safeObject(entry)).flatMap(([innerKey, innerValue]) =>
          typeof innerValue === 'string' ? [[innerKey, innerValue]] : [],
        ),
      ),
    ]),
  ) as Record<string, Record<string, string>>
}

function integrationStatusOutput(key: string, integration: IntegrationRecord) {
  return compact({
    key,
    status: integration.status.status,
    summary: integration.status.summary,
    'last-validated-at': integration.status.lastValidatedAt,
    'last-refreshed-at': integration.status.lastRefreshedAt,
  })
}

function integrationScopeOutput(key: string, integration: IntegrationRecord) {
  return {
    key,
    configured: integration.configuredScopes,
    granted: integration.grantedScopes,
    missing: integration.missingScopes,
  }
}

function providerPollerOutput(poller: ProviderPollerRecord) {
  return compact({
    id: poller.id,
    provider: poller.provider,
    scope: poller.scope,
    status: poller.status,
    mode: poller.mode,
    cursor: poller.cursor,
    'last-started-at': poller.lastStartedAt,
    'last-succeeded-at': poller.lastSucceededAt,
    'last-failed-at': poller.lastFailedAt,
    'last-error': poller.lastError,
    'interval-seconds': poller.intervalSeconds,
    'backoff-until': poller.backoffUntil,
    'items-seen': poller.itemsSeen,
    'items-changed': poller.itemsChanged,
  })
}

function providerSurfaceOutput(provider: string, surface: ProviderSurfaceRecord, extra: Record<string, unknown>) {
  return compact({
    id: surface.id,
    provider,
    scope: surface.scope,
    status: surface.status,
    summary: surface.summary,
    ...extra,
    selected: surface.selected,
    pollers: surface.pollers.map(providerPollerOutput),
  })
}

function providerIngressOutput(integration: IntegrationRecord) {
  return compact({
    provider: integration.provider.provider,
    status: integration.provider.status,
    summary: integration.provider.summary,
    surfaces: integration.provider.surfaces.map((surface) => providerSurfaceOutput(integration.provider.provider, surface, { 'provider-ref': surface.providerRef, 'display-name': surface.displayName, 'cached-items': surface.cachedItems })),
    pollers: integration.provider.pollers.map(providerPollerOutput),
    'last-refreshed-at': integration.provider.lastRefreshedAt,
  })
}

function googleCalendarBridgeOutput(state: State) {
  const integration = ensureIntegration(state, 'google-calendar')
  return compact({
    provider: 'google-calendar',
    status: integration.provider.status,
    summary: integration.provider.summary,
    'selected-calendars': googleCalendarSurfaceOutputs(state, true),
    pollers: integration.provider.pollers.map(providerPollerOutput),
    'last-refreshed-at': integration.provider.lastRefreshedAt,
  })
}

function googleTasksBridgeOutput(state: State) {
  const integration = ensureIntegration(state, 'google-tasks')
  return compact({
    provider: 'google-tasks',
    status: integration.provider.status,
    summary: integration.provider.summary,
    'selected-task-lists': googleTasksSurfaceOutputs(state, true),
    pollers: integration.provider.pollers.map(providerPollerOutput),
    'last-refreshed-at': integration.provider.lastRefreshedAt,
  })
}

function originEntityOutput(kind: string, id: string, title: string, summary?: string) {
  return compact({ kind, id, title, summary })
}

function openSummary(state: State, id: string, title: string, kind: string, summary?: string) {
  addActivity(state, {
    kind,
    status: 'completed',
    actor: 'origin/cli',
    target: id,
    summary: summary ?? title,
    severity: 'info',
    entityRefs: [id],
  })
}

function ensureIntegration(state: State, key: string) {
  if (!state.integrations[key]) {
    state.integrations[key] = {
      status: { key, status: 'disconnected', summary: `${key} integration is not configured.` },
      config: {},
      configuredScopes: [],
      grantedScopes: [],
      missingScopes: [],
      provider: {
        provider: key,
        status: 'idle',
        summary: `${key} provider is not configured.`,
        surfaces: [],
        pollers: [],
      },
      rateLimits: [],
      jobs: [],
    }
  }
  return state.integrations[key]
}

function mutationSummary(action: string, record: { id: string; title?: string; name?: string }) {
  return `${action} ${record.title ?? record.name ?? record.id}.`
}

function projectSnapshot(project: ProjectRecord) {
  return { name: project.name, status: project.status, description: project.description, archived: project.archived ?? false }
}

function labelSnapshot(label: LabelRecord) {
  return { name: label.name, color: label.color, archived: label.archived ?? false }
}

function taskSnapshot(task: TaskRecord) {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    labelIds: [...task.labelIds],
    descriptionMd: task.descriptionMd,
    noteId: task.noteId,
    calendarItemIds: [...task.calendarItemIds],
    dueKind: task.dueKind,
    dueFrom: task.dueFrom,
    dueAt: task.dueAt,
    dueTimezone: task.dueTimezone,
    blockedBy: [...task.blockedBy],
    recurrence: task.recurrence ? { ...task.recurrence } : undefined,
    externalLinks: task.externalLinks.map((link) => ({ ...link })),
    archived: task.archived ?? false,
  }
}

function calendarSnapshot(item: CalendarItemRecord) {
  return {
    title: item.title,
    status: item.status,
    kind: item.kind,
    projectId: item.projectId,
    labelIds: [...item.labelIds],
    descriptionMd: item.descriptionMd,
    location: item.location,
    startDate: item.startDate,
    endDateExclusive: item.endDateExclusive,
    startAt: item.startAt,
    endAt: item.endAt,
    timezone: item.timezone,
    allDay: item.allDay,
    recurrence: item.recurrence ? { ...item.recurrence } : undefined,
    taskIds: [...item.taskIds],
    externalLinks: item.externalLinks.map((link) => ({ ...link })),
    archived: item.archived ?? false,
  }
}

function pushPlanningRevision(state: State, kind: string, record: { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, summary: string, before: string, after: string, changedFields: string[]) {
  const revisionId = nextId(state, 'rev')
  const at = now()
  record.revisions = recordRevision(record.revisions, {
    id: revisionId,
    actor: 'origin/cli',
    at,
    summary,
    diff: createRevisionDiff(before, after, changedFields),
    snapshot: after ? safeObject(JSON.parse(after)) : undefined,
  })
  record.history.push(createHistoryEntry(state, 'origin/cli', summary, revisionId))
  addActivity(state, {
    kind,
    status: 'completed',
    actor: 'origin/cli',
    summary,
    severity: 'info',
  })
  return revisionId
}

function recordPlanningChange<T extends { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }>(
  state: State,
  record: T,
  kind: string,
  summary: string,
  beforeSnapshot: unknown,
  afterSnapshot: unknown,
  changedFields: string[],
) {
  const before = JSON.stringify(beforeSnapshot ?? {})
  const after = JSON.stringify(afterSnapshot ?? {})
  return pushPlanningRevision(state, kind, record, summary, before, after, changedFields)
}

function restorePlanningSnapshot(target: Record<string, unknown>, snapshot: Record<string, unknown> | undefined) {
  if (!snapshot) return
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) target[key] = Array.isArray(value) ? [...value] : typeof value === 'object' && value !== null ? { ...value } : value
  }
}

function entityHistoryFromRevisions(revisions: NonNullable<TaskRecord['revisions']>) {
  return revisions.map(revisionEntry)
}

function lastRevision<T extends { revisions: NonNullable<TaskRecord['revisions']> }>(record: T) {
  return record.revisions.at(-1)
}

function taskEntityRefs(state: State, task: TaskRecord) {
  const refs = [] as ReturnType<typeof entityRef>[]
  const project = resolveProject(state, task.projectId)
  if (project) refs.push(entityRef('project', project.id, project.name, project.description))
  for (const label of task.labelIds.map((id) => resolveLabel(state, id)).filter(Boolean) as LabelRecord[]) {
    refs.push(entityRef('label', label.id, label.name, label.color))
  }
  for (const calendarItem of task.calendarItemIds.map((id) => resolveCalendarItem(state, id)).filter(Boolean) as CalendarItemRecord[]) {
    refs.push(entityRef('calendar-item', calendarItem.id, calendarItem.title, calendarItem.descriptionMd))
  }
  if (task.noteId) refs.push(entityRef('note', task.noteId, task.noteId))
  for (const dependency of task.blockedBy) {
    const other = resolveTask(state, dependency)
    if (other) refs.push(entityRef('task', other.id, other.title, other.descriptionMd))
  }
  return refs
}

function calendarEntityRefs(state: State, item: CalendarItemRecord) {
  const refs = [] as ReturnType<typeof entityRef>[]
  const project = resolveProject(state, item.projectId)
  if (project) refs.push(entityRef('project', project.id, project.name, project.description))
  for (const label of item.labelIds.map((id) => resolveLabel(state, id)).filter(Boolean) as LabelRecord[]) {
    refs.push(entityRef('label', label.id, label.name, label.color))
  }
  for (const taskId of item.taskIds) {
    const task = resolveTask(state, taskId)
    if (task) refs.push(entityRef('task', task.id, task.title, task.descriptionMd))
  }
  return refs
}

function activityMatchesEntity(activity: ActivityRecord, entityId: string) {
  return activity.target === entityId || activity.entityRefs?.includes(entityId) || activity.sourceRefs?.includes(entityId)
}

function linkedActivities(state: State, entityId: string) {
  return state.activities.filter((activity) => activityMatchesEntity(activity, entityId)).map(activityOutput).slice(0, 10)
}

function linkedEntitiesById(state: State, entityId: string) {
  const refs = new Map<string, ReturnType<typeof entityRef>>()
  for (const link of state.entityLinks.filter((link) => link.from === entityId || link.to === entityId)) {
    const otherId = link.from === entityId ? link.to : link.from
    const entity = resolveAnyEntity(state, otherId)
    if (entity) refs.set(otherId, entityRef(entity.kind, entity.id, entity.title, entity.summary))
  }
  return [...refs.values()]
}

function resolveAnyEntity(state: State, id: string) {
  const project = state.planning.projects.find((item) => item.id === id)
  if (project) return { kind: 'project', id: project.id, title: project.name, summary: project.description }
  const label = state.planning.labels.find((item) => item.id === id)
  if (label) return { kind: 'label', id: label.id, title: label.name, summary: label.color }
  const task = state.planning.tasks.find((item) => item.id === id)
  if (task) return { kind: 'task', id: task.id, title: task.title, summary: task.descriptionMd }
  const calendarItem = state.planning.calendarItems.find((item) => item.id === id)
  if (calendarItem) return { kind: 'calendar-item', id: calendarItem.id, title: calendarItem.title, summary: calendarItem.descriptionMd }
  const thread = state.email.threads.find((item) => item.id === id)
  if (thread) return { kind: 'email-thread', id: thread.id, title: thread.subject, summary: thread.status }
  const draft = state.email.drafts.find((item) => item.id === id)
  if (draft) return { kind: 'email-draft', id: draft.id, title: draft.subject, summary: draft.body }
  const repo = state.github.repositories.find((item) => item.id === id)
  if (repo) return { kind: 'github-repository', id: repo.id, title: repo.name, summary: repo.summary }
  const issue = state.github.issues.find((item) => item.id === id)
  if (issue) return { kind: 'github-issue', id: issue.id, title: issue.title, summary: issue.summary }
  const pr = state.github.pullRequests.find((item) => item.id === id)
  if (pr) return { kind: 'github-pr', id: pr.id, title: pr.title, summary: pr.summary }
  const follow = state.github.follows.find((item) => item.id === id)
  if (follow) return { kind: 'github-follow-target', id: follow.id, title: follow.repo, summary: follow.reason }
  const chat = state.telegram.chats.find((item) => item.id === id)
  if (chat) return { kind: 'telegram-chat', id: chat.id, title: chat.title, summary: chat.summary }
  const group = state.telegram.groups.find((item) => item.chatId === id)
  if (group) return { kind: 'telegram-group', id: group.chatId, title: group.chatId, summary: group.summary }
  return undefined
}

function commentActivitySummary(entityId: string, kind: string, summary: string) {
  return { kind, status: 'completed', actor: 'origin/cli', target: entityId, summary, severity: 'info' as const, entityRefs: [entityId] }
}

function findRevision<T extends { revisions: NonNullable<TaskRecord['revisions']> }>(record: T, revisionId: string) {
  return record.revisions.find((revision) => revision.id === revisionId)
}

function projectHistory(project: ProjectRecord) {
  return project.history.map(historyEntry)
}

function labelHistory(label: LabelRecord) {
  return label.history.map(historyEntry)
}

function taskHistory(task: TaskRecord) {
  return task.history.map(historyEntry)
}

function calendarHistory(item: CalendarItemRecord) {
  return item.history.map(historyEntry)
}

function projectRecord(state: State, projectId: string) {
  return state.planning.projects.find((project) => project.id === projectId)!
}

function labelRecord(state: State, labelId: string) {
  return state.planning.labels.find((label) => label.id === labelId)!
}

function taskRecord(state: State, taskId: string) {
  return state.planning.tasks.find((task) => task.id === taskId)!
}

function calendarRecord(state: State, itemId: string) {
  return state.planning.calendarItems.find((item) => item.id === itemId)!
}

function resolveRecordOrError<T>(context: Ctx, record: T | undefined, kind: string, id: string) {
  return ensureFound(context, record, kind, id)
}

function filterByQuery<T>(items: T[], query: string | undefined, text: (item: T) => string) {
  if (!query) return items
  return items.filter((item) => matchesQuery(text(item), query))
}

function scoreAndSort<T>(items: T[], query: string | undefined, text: (item: T) => string) {
  if (!query) return items
  return [...items].sort((left, right) => scoreText(query, text(right)) - scoreText(query, text(left)))
}

function projectQueryText(project: ProjectRecord) {
  return `${project.name}\n${project.description ?? ''}\n${project.status}`
}

function labelQueryText(label: LabelRecord) {
  return `${label.name}\n${label.color ?? ''}\n${label.archived ? 'archived' : ''}`
}

function taskQueryText(state: State, task: TaskRecord) {
  const linkedProject = resolveProject(state, task.projectId)
  const linkedLabels = task.labelIds.map((id) => resolveLabel(state, id)).filter(Boolean) as LabelRecord[]
  return [
    task.title,
    task.descriptionMd,
    task.status,
    task.priority,
    linkedProject?.name,
    ...linkedLabels.map((label) => label.name),
    task.noteId,
    task.blockedBy.join(' '),
  ]
    .filter(Boolean)
    .join('\n')
}

function calendarQueryText(state: State, item: CalendarItemRecord) {
  const linkedProject = resolveProject(state, item.projectId)
  const linkedLabels = item.labelIds.map((id) => resolveLabel(state, id)).filter(Boolean) as LabelRecord[]
  return [
    item.title,
    item.descriptionMd,
    item.status,
    item.kind,
    linkedProject?.name,
    ...linkedLabels.map((label) => label.name),
    item.location,
  ]
    .filter(Boolean)
    .join('\n')
}

function emailQueryText(state: State, thread: EmailThreadRecord) {
  const messages = thread.messageIds.map((id) => state.email.messages.find((message) => message.id === id)).filter(Boolean) as EmailMessageRecord[]
  return [thread.subject, thread.status, thread.labelIds.join(' '), thread.triage?.state, thread.triage?.note, ...messages.map((message) => [message.subject, message.body, message.snippet].filter(Boolean).join('\n'))]
    .filter(Boolean)
    .join('\n')
}

function githubIssueQueryText(issue: GithubIssueRecord) {
  return [issue.ref, issue.title, issue.summary, issue.labels.join(' '), issue.assignees.join(' '), issue.state].filter(Boolean).join('\n')
}

function githubPrQueryText(pr: GithubPullRequestRecord) {
  return [pr.ref, pr.title, pr.summary, pr.reviewers.join(' '), pr.checks.join(' '), pr.state].filter(Boolean).join('\n')
}

function telegramQueryText(message: TelegramMessageRecord) {
  return [message.chatId, message.author, message.body].filter(Boolean).join('\n')
}

function searchOutput(kind: string, id: string, title: string, score: number, excerpt?: string, path?: string) {
  return compact({ kind, id, title, score, excerpt, path })
}

function mapTaskList(state: State, items: TaskRecord[]) {
  return items.map((task) => taskOutput(state, task))
}

function mapCalendarList(state: State, items: CalendarItemRecord[]) {
  return items.map((item) => calendarItemOutput(state, item))
}

function mapProjectList(items: ProjectRecord[]) {
  return items.map(projectOutput)
}

function mapLabelList(items: LabelRecord[]) {
  return items.map(labelOutput)
}

function mapEmailThreads(state: State, items: EmailThreadRecord[], expandMessages = false) {
  return items.map((thread) => emailThreadOutput(state, thread, expandMessages))
}

function mapEmailMessages(items: EmailMessageRecord[]) {
  return items.map(emailMessageOutput)
}

function mapEmailDrafts(items: EmailDraftRecord[]) {
  return items.map(emailDraftOutput)
}

function mapGithubRepos(items: GithubRepositoryRecord[]) {
  return items.map(githubRepositoryOutput)
}

function mapGithubIssues(items: GithubIssueRecord[]) {
  return items.map(githubIssueOutput)
}

function mapGithubPullRequests(items: GithubPullRequestRecord[]) {
  return items.map(githubPullRequestOutput)
}

function mapGithubComments(items: GithubCommentRecord[]) {
  return items.map(githubCommentOutput)
}

function mapGithubReviews(items: GithubReviewRecord[]) {
  return items.map(githubReviewOutput)
}

function mapTelegramChats(items: TelegramChatRecord[]) {
  return items.map(telegramChatOutput)
}

function mapTelegramGroups(items: TelegramGroupPolicyRecord[]) {
  return items.map(telegramGroupOutput)
}

function mapTelegramMessages(items: TelegramMessageRecord[]) {
  return items.map(telegramMessageOutput)
}

function mapTelegramSummaries(items: TelegramSummaryJobRecord[]) {
  return items.map(telegramSummaryOutput)
}

function listWithLimit<T>(items: T[], limit?: number) {
  return takeLimit(items, limit)
}

function dateWindow(date: string, days: number) {
  const start = new Date(`${date}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + days)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

function parseDateLike(value: string | undefined) {
  return value ? value.slice(0, 10) : undefined
}

function isOverdueTask(task: TaskRecord, todayValue: string) {
  return task.status !== 'done' && task.status !== 'completed' && task.dueAt !== undefined && parseDateLike(task.dueAt) !== undefined && parseDateLike(task.dueAt)! < todayValue
}

function taskDueWindow(task: TaskRecord, todayValue: string) {
  const due = parseDateLike(task.dueAt ?? task.dueFrom)
  if (!due) return 'none'
  if (due < todayValue) return 'overdue'
  if (due === todayValue) return 'today'
  if (due <= dateWindow(todayValue, 7).end) return 'upcoming'
  return 'none'
}

function taskRelevantForDay(state: State, task: TaskRecord, day: string) {
  if (task.dueKind && parseDateLike(task.dueFrom ?? task.dueAt) === day) return true
  if (task.calendarItemIds.some((id) => {
    const item = resolveCalendarItem(state, id)
    return item ? (item.startDate === day || parseDateLike(item.startAt) === day) : false
  })) return true
  return task.status === 'in_progress' || task.status === 'todo' || task.status === 'needs_attention'
}

function itemRelevantForDay(item: CalendarItemRecord, day: string) {
  return item.startDate === day || parseDateLike(item.startAt) === day || parseDateLike(item.endAt) === day
}

function planningDayView(state: State, day: string) {
  const tasks = state.planning.tasks.filter((task) => taskRelevantForDay(state, task, day))
  const items = state.planning.calendarItems.filter((item) => itemRelevantForDay(item, day))
  return {
    date: day,
    tasks: mapTaskList(state, tasks),
    'calendar-items': mapCalendarList(state, items),
    summary: `${tasks.length} task(s) and ${items.length} calendar item(s) for ${day}.`,
  }
}

function planningWindowView(state: State, from: string, to: string) {
  const tasks = state.planning.tasks.filter((task) => {
    const due = parseDateLike(task.dueFrom ?? task.dueAt)
    if (!due) return false
    return due >= from && due <= to
  })
  const items = state.planning.calendarItems.filter((item) => {
    const day = parseDateLike(item.startDate ?? item.startAt ?? item.endAt)
    if (!day) return false
    return day >= from && day <= to
  })
  return {
    from,
    to,
    tasks: mapTaskList(state, tasks),
    'calendar-items': mapCalendarList(state, items),
    summary: `${tasks.length} task(s) and ${items.length} calendar item(s) from ${from} to ${to}.`,
  }
}

function planningAgendaView(state: State, day: string) {
  const items = state.planning.calendarItems
    .filter((item) => itemRelevantForDay(item, day))
    .sort((left, right) => (left.startAt ?? left.startDate ?? '').localeCompare(right.startAt ?? right.startDate ?? ''))
  return {
    date: day,
    items: mapCalendarList(state, items),
    summary: `${items.length} agenda item(s) for ${day}.`,
  }
}

function planningBoardView(state: State) {
  const columns = [
    { key: 'todo', title: 'Todo' },
    { key: 'in_progress', title: 'In Progress' },
    { key: 'needs_attention', title: 'Needs Attention' },
    { key: 'done', title: 'Done' },
    { key: 'archived', title: 'Archived' },
  ].map((column) => ({
    key: column.key,
    title: column.title,
    tasks: mapTaskList(
      state,
      state.planning.tasks.filter((task) => (task.archived ? 'archived' : task.status) === column.key),
    ),
  }))
  return {
    columns,
    summary: `${state.planning.tasks.length} task(s) across ${columns.length} board column(s).`,
  }
}

function planningTaskGraphView(state: State) {
  const roots = state.planning.tasks.filter((task) => task.blockedBy.length === 0)
  const edges = state.planning.tasks.flatMap((task) => task.blockedBy.map((blockedBy) => ({ from: task.id, to: blockedBy })))
  return {
    roots: mapTaskList(state, roots),
    edges,
    summary: `${roots.length} root task(s) and ${edges.length} dependency edge(s).`,
  }
}

function planningInbox(state: State) {
  return state.planning.tasks.filter((task) => task.status === 'todo' || !task.projectId || task.blockedBy.length > 0 || !task.dueAt)
}

function planningBacklog(state: State) {
  return state.planning.tasks.filter((task) => !task.archived && !task.projectId && task.status !== 'done' && task.status !== 'completed')
}

function planningOverdue(state: State) {
  const todayValue = today()
  return state.planning.tasks.filter((task) => isOverdueTask(task, todayValue))
}

function planningRecurringTasks(state: State) {
  return state.planning.tasks.filter((task) => task.recurrence?.seriesId || task.recurrence?.occurrenceIndex !== undefined)
}

function planningRecurringCalendarItems(state: State) {
  return state.planning.calendarItems.filter((item) => item.recurrence?.seriesId || item.recurrence?.occurrenceIndex !== undefined)
}

function projectRevisions(project: ProjectRecord) {
  return project.revisions.map(revisionEntry)
}

function labelRevisions(label: LabelRecord) {
  return label.revisions.map(revisionEntry)
}

function taskRevisions(task: TaskRecord) {
  return task.revisions.map(revisionEntry)
}

function calendarRevisions(item: CalendarItemRecord) {
  return item.revisions.map(revisionEntry)
}

function planningRestoreFromRevision(state: State, entity: { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, record: Record<string, unknown>, revisionId: string, kind: string) {
  const revision = entity.revisions.find((entry) => entry.id === revisionId)
  if (!revision?.snapshot) return false
  const before = JSON.stringify(record)
  restorePlanningSnapshot(record, revision.snapshot as Record<string, unknown>)
  const after = JSON.stringify(record)
  recordPlanningChange(state, entity, `planning.${kind}.restore`, `Restored ${kind} from ${revisionId}.`, before, after, Object.keys(revision.snapshot))
  return true
}

function replaceArray<T>(items: T[], value: T, matcher: (entry: T) => boolean) {
  const index = items.findIndex(matcher)
  if (index >= 0) items[index] = value
  else items.push(value)
}

function entityListSummary(kind: string, count: number) {
  return `${count} ${kind}${count === 1 ? '' : 's'}.`
}

function threadOutboxItems(state: State, threadId: string) {
  return state.email.outbox.filter((item) => item.payload && (item.payload['thread-id'] === threadId || item.payload.threadId === threadId))
}

function resolveThread(state: State, threadId: string) {
  return state.email.threads.find((thread) => thread.id === threadId)
}

function resolveMessage(state: State, messageId: string) {
  return state.email.messages.find((message) => message.id === messageId)
}

function resolveDraft(state: State, draftId: string) {
  return state.email.drafts.find((draft) => draft.id === draftId)
}

function emailThreadByMessage(state: State, messageId: string) {
  const message = resolveMessage(state, messageId)
  return message ? resolveThread(state, message.threadId) : undefined
}

function emailThreadsByQuery(state: State, query: string | undefined) {
  const threads = state.email.threads
  if (!query) return threads
  return scoreAndSort(
    threads.filter((thread) => matchesQuery(emailQueryText(state, thread), query)),
    query,
    (thread) => emailQueryText(state, thread),
  )
}

function emailTriageList(state: State) {
  return state.email.threads.filter((thread) => thread.triage)
}

function emailThreadContextOutput(state: State, thread: EmailThreadRecord) {
  return {
    thread: emailThreadOutput(state, thread, true),
    'linked-entities': linkedEntitiesById(state, thread.id),
    'recent-activity': linkedActivities(state, thread.id),
    'pending-actions': threadOutboxItems(state, thread.id).map((item) => ({ id: item.id, kind: item.kind, status: item.status })),
  }
}

function emailAccountOutput(account: EmailAccountRecord) {
  return compact({
    id: account.id,
    address: account.address,
    status: account.status,
    summary: account.summary,
    'last-sync-at': account.lastSyncAt,
    'sync-state': account.syncState,
    labels: account.labels,
    aliases: account.aliases,
  })
}

function validateEmailAccount(state: State) {
  const account = state.email.accounts[0]
  return validationResult(
    [
      {
        id: 'email-account',
        kind: 'email',
        target: account?.id ?? 'email',
        status: account?.status === 'connected' ? 'pass' : 'warn',
        message: account ? `Mailbox ${account.address} is ${account.status}.` : 'No email account is configured.',
        remediation: account ? undefined : ['Configure the mailbox account before relying on email commands.'],
      },
      {
        id: 'email-labels',
        kind: 'email',
        target: account?.id ?? 'email',
        status: account?.labels?.length ? 'pass' : 'warn',
        message: account?.labels?.length ? `${account.labels.length} label(s) available.` : 'No mailbox labels are cached.',
      },
    ],
    account ? `${account.address} validation completed.` : 'Email validation could not find an account.',
  )
}

function emailValidationTarget(state: State) {
  const account = state.email.accounts[0]
  return account ? account.id : 'email'
}

function emailProviderStatus(state: State) {
  return providerIngressOutput(ensureIntegration(state, 'email'))
}

function addEmailMessage(state: State, thread: EmailThreadRecord, message: Omit<EmailMessageRecord, 'id' | 'threadId' | 'attachments' | 'at'> & Partial<Pick<EmailMessageRecord, 'attachments'>>) {
  const created: EmailMessageRecord = {
    id: nextId(state, 'mail_msg'),
    threadId: thread.id,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    body: message.body,
    snippet: message.snippet,
    headers: message.headers,
    raw: message.raw,
    at: now(),
    attachments: message.attachments ?? [],
    provenance: message.provenance,
  }
  state.email.messages.push(created)
  thread.messageIds.push(created.id)
  thread.lastMessageAt = created.at
  thread.status = 'inbox'
  thread.freshness = 'fresh'
  return created
}

function emailThreadMutation(state: State, threadId: string, summary: string, mutate: (thread: EmailThreadRecord) => void, activityKind: string) {
  const thread = ensureFound({} as Ctx, resolveThread(state, threadId), 'thread', threadId)
  mutate(thread)
  addActivity(state, commentActivitySummary(threadId, activityKind, summary))
  return thread
}

function emailThreadMatch(thread: EmailThreadRecord, query: string | undefined, state: State) {
  return matchesQuery(emailQueryText(state, thread), query)
}

function messageAttachments(state: State, messageId: string) {
  const message = resolveMessage(state, messageId)
  return message?.attachments ?? []
}

function githubIntegrationStatus(state: State) {
  return integrationStatusOutput('github', ensureIntegration(state, 'github'))
}

function githubIntegrationScopes(state: State) {
  return integrationScopeOutput('github', ensureIntegration(state, 'github'))
}

function githubProviderStatus(state: State) {
  return providerIngressOutput(ensureIntegration(state, 'github'))
}

function resolveRepo(state: State, ref: string) {
  return state.github.repositories.find((repo) => repo.id === ref || repo.name === ref)
}

function resolveIssue(state: State, ref: string) {
  return state.github.issues.find((issue) => issue.id === ref || issue.ref === ref)
}

function resolvePr(state: State, ref: string) {
  return state.github.pullRequests.find((pr) => pr.id === ref || pr.ref === ref)
}

function resolveFollow(state: State, ref: string) {
  return state.github.follows.find((follow) => follow.id === ref)
}

function issueComments(state: State, issue: GithubIssueRecord) {
  return issue.commentIds.map((id) => state.github.comments.find((comment) => comment.id === id)).filter(Boolean) as GithubCommentRecord[]
}

function prComments(state: State, pr: GithubPullRequestRecord) {
  return pr.commentIds.map((id) => state.github.comments.find((comment) => comment.id === id)).filter(Boolean) as GithubCommentRecord[]
}

function prReviews(state: State, pr: GithubPullRequestRecord) {
  return pr.reviewIds.map((id) => state.github.reviews.find((review) => review.id === id)).filter(Boolean) as GithubReviewRecord[]
}

function githubIssueContextOutput(state: State, issue: GithubIssueRecord) {
  return {
    issue: githubIssueOutput(issue),
    comments: issueComments(state, issue).map(githubCommentOutput),
    timeline: linkedActivities(state, issue.id),
    'linked-entities': linkedEntitiesById(state, issue.id),
    freshness: 'fresh',
  }
}

function githubPrContextOutput(state: State, pr: GithubPullRequestRecord) {
  return {
    pr: githubPullRequestOutput(pr),
    comments: prComments(state, pr).map(githubCommentOutput),
    reviews: prReviews(state, pr).map(githubReviewOutput),
    files: pr.files,
    diff: pr.diff,
    'linked-entities': linkedEntitiesById(state, pr.id),
    freshness: 'fresh',
  }
}

function githubSearchHits(state: State, query: string) {
  const hits = [
    ...state.github.repositories.map((repo) => ({
      kind: 'github-repository',
      id: repo.id,
      title: repo.name,
      text: repo.summary,
    })),
    ...state.github.issues.map((issue) => ({ kind: 'github-issue', id: issue.id, title: issue.ref, text: githubIssueQueryText(issue) })),
    ...state.github.pullRequests.map((pr) => ({ kind: 'github-pr', id: pr.id, title: pr.ref, text: githubPrQueryText(pr) })),
    ...state.github.comments.map((comment) => ({ kind: 'github-comment', id: comment.id, title: comment.author, text: comment.body })),
  ]
    .filter((hit) => matchesQuery(hit.text, query))
    .map((hit) => searchOutput(hit.kind, hit.id, hit.title, scoreText(query, hit.text), firstLine(hit.text, hit.title)))
  return hits.sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
}

function githubAttentionHits(state: State) {
  return [
    ...state.github.follows.filter((follow) => !follow.dismissed).map((follow) => searchOutput('github-follow-target', follow.id, follow.repo, 0.9, follow.reason)),
    ...state.github.issues.filter((issue) => issue.state !== 'closed').map((issue) => searchOutput('github-issue', issue.id, issue.ref, 0.6, issue.summary)),
    ...state.github.pullRequests.filter((pr) => pr.state !== 'merged').map((pr) => searchOutput('github-pr', pr.id, pr.ref, 0.7, pr.summary)),
  ]
}

function telegramIntegrationStatus(state: State) {
  return integrationStatusOutput('telegram', ensureIntegration(state, 'telegram'))
}

function telegramValidationResult(state: State) {
  const connection = state.telegram.connection
  const normalizedStatus = normalizeTelegramConnectionStatus(connection.status)
  return validationResult(
    [
      {
        id: 'telegram-connection',
        kind: 'telegram',
        target: connection.botUsername ?? 'telegram',
        status: normalizedStatus === 'valid' ? 'pass' : 'warn',
        message: connection.summary,
        remediation: normalizedStatus === 'valid' ? undefined : ['Set or refresh the bot token and re-run configuration.'],
      },
      {
        id: 'telegram-groups',
        kind: 'telegram',
        target: 'groups',
        status: state.telegram.groups.length ? 'pass' : 'warn',
        message: `${state.telegram.groups.length} registered group(s).`,
      },
    ],
    `${normalizedStatus} Telegram connection.`,
  )
}

function telegramProviderStatus(state: State) {
  return providerIngressOutput(ensureIntegration(state, 'telegram'))
}

function telegramChatContextOutput(state: State, chat: TelegramChatRecord) {
  const policy = state.telegram.groups.find((group) => group.chatId === chat.id)
  const messages = state.telegram.messages.filter((message) => message.chatId === chat.id)
  return {
    chat: telegramChatOutput(chat),
    policy: policy ? telegramGroupOutput(policy) : undefined,
    messages: messages.length ? messages.map(telegramMessageOutput) : undefined,
    'recent-activity': linkedActivities(state, chat.id),
    freshness: chat.messageCacheState,
  }
}

function telegramMessagesForChat(state: State, chatId: string) {
  return state.telegram.messages.filter((message) => message.chatId === chatId)
}

function telegramSearchHits(state: State, query: string) {
  return state.telegram.messages
    .filter((message) => matchesQuery(telegramQueryText(message), query))
    .map((message) => searchOutput('telegram-message', message.id, message.author ?? message.chatId, scoreText(query, telegramQueryText(message)), firstLine(message.body, message.chatId)))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
}

function getTelegramChat(state: State, chatId: string) {
  return state.telegram.chats.find((chat) => chat.id === chatId)
}

function getTelegramGroup(state: State, chatId: string) {
  return state.telegram.groups.find((group) => group.chatId === chatId)
}

function ensureTelegramGroup(state: State, chatId: string) {
  let group = getTelegramGroup(state, chatId)
  if (!group) {
    group = { chatId, enabled: false, participationMode: 'observe', mentionTrackingEnabled: false, messageCacheEnabled: false, summary: 'Unconfigured Telegram group.' }
    state.telegram.groups.push(group)
  }
  return group
}

function ensureTelegramChat(state: State, chatId: string) {
  let chat = getTelegramChat(state, chatId)
  if (!chat) {
    chat = { id: chatId, title: chatId, kind: 'group', summary: 'Discovered Telegram chat.', isRegistered: false, messageCacheState: 'cold' }
    state.telegram.chats.push(chat)
  }
  return chat
}

function ensureGithubComment(state: State, body: string, author = 'origin-agent') {
  const comment: GithubCommentRecord = { id: nextId(state, 'gh_comment'), author, body, at: now() }
  state.github.comments.push(comment)
  return comment
}

function ensureGithubReview(state: State, prRef: string, author: string, stateValue: string, body?: string) {
  const review: GithubReviewRecord = { id: nextId(state, 'gh_review'), prRef, author, state: stateValue, body, at: now() }
  state.github.reviews.push(review)
  return review
}

function githubCommentThread(state: State, issueOrPrId: string, commentId: string) {
  const issue = state.github.issues.find((item) => item.id === issueOrPrId)
  if (issue) {
    issue.commentIds.push(commentId)
    return issue
  }
  const pr = state.github.pullRequests.find((item) => item.id === issueOrPrId)
  if (pr) {
    pr.commentIds.push(commentId)
    return pr
  }
  return undefined
}

function githubTrackItem(state: State, ref: string, kind: string, summary: string) {
  addActivity(state, {
    kind,
    status: 'completed',
    actor: 'origin/cli',
    target: ref,
    summary,
    severity: 'info',
    entityRefs: [ref],
  })
}

function ensureGithubRepo(state: State, ref: string) {
  let repo = resolveRepo(state, ref)
  if (!repo) {
    repo = { id: nextId(state, 'gh_repo'), name: ref, tracked: true, summary: 'Discovered repository.', followed: true }
    state.github.repositories.push(repo)
  }
  return repo
}

function providerSurfaceByRef(surfaces: ProviderSurfaceRecord[], ref: string) {
  return surfaces.find((surface) => surface.providerRef === ref || surface.scope === ref || surface.id === ref || surface.displayName === ref)
}

function googleCalendarSurfaceOutputs(state: State, selectedOnly = false) {
  const integration = ensureIntegration(state, 'google-calendar')
  return integration.provider.surfaces
    .filter((surface) => !selectedOnly || surface.selected !== false)
    .map((surface) =>
      providerSurfaceOutput('google-calendar', surface, {
        'calendar-id': surface.providerRef ?? surface.scope,
        'calendar-title': surface.displayName,
        'attached-item-count': state.planning.calendarItems.filter((item) =>
          item.externalLinks.some(
            (link) =>
              link.provider === 'google-calendar' &&
              (link.calendarId === (surface.providerRef ?? surface.scope) || link.ref === surface.providerRef || link.ref === surface.scope),
          ),
        ).length,
      }),
    )
}

function googleTasksSurfaceOutputs(state: State, selectedOnly = false) {
  const integration = ensureIntegration(state, 'google-tasks')
  return integration.provider.surfaces
    .filter((surface) => !selectedOnly || surface.selected !== false)
    .map((surface) =>
      providerSurfaceOutput('google-tasks', surface, {
        'task-list-id': surface.providerRef ?? surface.scope,
        'task-list-title': surface.displayName,
        'attached-task-count': state.planning.tasks.filter((task) =>
          task.externalLinks.some(
            (link) =>
              link.provider === 'google-tasks' &&
              (link.taskListId === (surface.providerRef ?? surface.scope) || link.ref === surface.providerRef || link.ref === surface.scope),
          ),
        ).length,
      }),
    )
}

function attachProviderSurface(state: State, providerKey: 'google-calendar' | 'google-tasks', ref: string, displayName?: string) {
  const integration = ensureIntegration(state, providerKey)
  let surface = providerSurfaceByRef(integration.provider.surfaces, ref)
  if (!surface) {
    surface = {
      id: nextId(state, `${providerKey.replace('-', '_')}_surface`),
      provider: providerKey,
      scope: ref,
      status: 'active',
      summary: `${ref} selected for sync.`,
      providerRef: ref,
      displayName,
      selected: true,
      cachedItems: 0,
      pollers: integration.provider.pollers.length ? integration.provider.pollers.map((poller) => ({ ...poller })) : [
        {
          id: nextId(state, `${providerKey.replace('-', '_')}_poller`),
          provider: providerKey,
          scope: ref,
          status: 'active',
          mode: 'poll',
          cursor: `${providerKey}-${stableHash(ref)}`,
          lastSucceededAt: now(),
          intervalSeconds: 300,
        },
      ],
    }
    integration.provider.surfaces.push(surface)
  } else {
    surface.providerRef = ref
    surface.displayName = displayName ?? surface.displayName
    surface.status = 'active'
    surface.summary = `${ref} selected for sync.`
    surface.selected = true
  }
  integration.provider.lastRefreshedAt = now()
  return surface
}

function githubGrantOutputs(state: State) {
  const integration = ensureIntegration(state, 'github')
  const selectedIds = stringArrayValue(integration.config[GITHUB_SELECTED_GRANT_IDS_KEY])
  const repoFilters = recordOfStringArray(integration.config[GITHUB_SELECTED_GRANT_REPOS_KEY])
  const selectionUpdatedAt =
    typeof integration.config[GITHUB_GRANT_SELECTION_UPDATED_AT_KEY] === 'string'
      ? String(integration.config[GITHUB_GRANT_SELECTION_UPDATED_AT_KEY])
      : undefined
  const permissions = Object.fromEntries(
    (integration.grantedScopes.length ? integration.grantedScopes : integration.configuredScopes).map((scope) => [
      scope,
      'granted',
    ]),
  )
  const groupedRepos = new Map<string, string[]>()
  for (const repo of state.github.repositories) {
    const owner = repo.name.split('/')[0] ?? repo.name
    const existing = groupedRepos.get(owner) ?? []
    existing.push(repo.name)
    groupedRepos.set(owner, existing)
  }
  if (groupedRepos.size === 0) {
    const fallbackOwner = state.identity.agent.github ?? 'origin'
    groupedRepos.set(fallbackOwner, [])
  }

  return [...groupedRepos.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, repositories]) => {
      const id = `gh_grant_${stableHash(owner)}`
      const selectedRepositories = repoFilters[id]?.length ? repoFilters[id] : undefined
      const accessibleRepositories = selectedRepositories?.length
        ? repositories.filter((repo) => selectedRepositories.some((filter) => matchesQuery(repo, filter)))
        : repositories
      return compact({
        id,
        'installation-id': `inst_${stableHash(owner)}`,
        'account-login': owner,
        'account-type': owner === state.identity.agent.github ? 'user' : 'organization',
        'repository-selection': selectedRepositories?.length ? 'selected' : 'all',
        'selected-repositories': selectedRepositories,
        'accessible-repositories': accessibleRepositories,
        permissions,
        selected: integration.config[GITHUB_SELECTED_GRANT_IDS_KEY] === undefined ? true : selectedIds.includes(id),
        status: integration.status.status === 'connected' ? 'active' : 'auth_failed',
        'last-refreshed-at': integration.status.lastRefreshedAt,
        'last-validated-at': integration.status.lastValidatedAt,
        'selection-updated-at': selectionUpdatedAt,
      })
    })
}

function githubGrantById(state: State, grantId: string) {
  return githubGrantOutputs(state).find((grant) => grant.id === grantId)
}

function updateGithubGrantSelection(
  integration: IntegrationRecord,
  grantId: string,
  repoFilters: string[] | undefined,
  selected: boolean,
) {
  const selectedGrantIds = new Set(stringArrayValue(integration.config[GITHUB_SELECTED_GRANT_IDS_KEY]))
  if (selected) selectedGrantIds.add(grantId)
  else selectedGrantIds.delete(grantId)

  const grantRepositories = recordOfStringArray(integration.config[GITHUB_SELECTED_GRANT_REPOS_KEY])
  if (selected && repoFilters?.length) grantRepositories[grantId] = repoFilters
  else delete grantRepositories[grantId]

  integration.config[GITHUB_SELECTED_GRANT_IDS_KEY] = [...selectedGrantIds]
  integration.config[GITHUB_SELECTED_GRANT_REPOS_KEY] = grantRepositories
  integration.config[GITHUB_GRANT_SELECTION_UPDATED_AT_KEY] = now()
}

function telegramMentionOutputs(state: State) {
  const acknowledgedMentions = recordOfObjects(
    ensureIntegration(state, 'telegram').config[TELEGRAM_ACKNOWLEDGED_MENTIONS_KEY],
  )
  return state.telegram.messages
    .filter((message) => getTelegramGroup(state, message.chatId)?.mentionTrackingEnabled)
    .map((message) => {
      const mentionId = `tg_mention_${stableHash(message.id)}`
      const chat = getTelegramChat(state, message.chatId)
      const acknowledgement = acknowledgedMentions[mentionId] ?? {}
      const acknowledgedAt =
        typeof acknowledgement.at === 'string' ? acknowledgement.at : undefined
      const acknowledgedByActor =
        typeof acknowledgement.actor === 'string' ? acknowledgement.actor : undefined
      return compact({
        id: mentionId,
        'activity-event-id': `act_${stableHash(`telegram_mention:${message.id}`)}`,
        'chat-id': message.chatId,
        'message-id': message.id,
        status: acknowledgedAt ? 'acknowledged' : 'unread',
        at: message.at,
        'acknowledged-at': acknowledgedAt,
        'acknowledged-by-actor': acknowledgedByActor,
        summary: `Mention in ${chat?.title ?? message.chatId}: ${firstLine(message.body, message.id)}`,
      })
    })
}

function telegramMentionById(state: State, mentionId: string) {
  return telegramMentionOutputs(state).find((mention) => mention.id === mentionId)
}

function bridgePullPushSummary(provider: string, operation: string, count: number) {
  return `${operation} ${count} ${provider} surface${count === 1 ? '' : 's'}.`
}

function planningBridgeProviderKey(kind: 'google-calendar' | 'google-tasks') {
  return kind
}

function googleLinkForTask(task: TaskRecord) {
  return task.externalLinks.find((link) => link.provider === 'google-tasks')
}

function googleLinkForCalendarItem(item: CalendarItemRecord) {
  return item.externalLinks.find((link) => link.provider === 'google-calendar')
}

function addTaskExternalLink(task: TaskRecord, link: ExternalLinkRecord) {
  const index = task.externalLinks.findIndex((existing) => existing.provider === link.provider)
  if (index >= 0) task.externalLinks[index] = link
  else task.externalLinks.push(link)
}

function addCalendarExternalLink(item: CalendarItemRecord, link: ExternalLinkRecord) {
  const index = item.externalLinks.findIndex((existing) => existing.provider === link.provider)
  if (index >= 0) item.externalLinks[index] = link
  else item.externalLinks.push(link)
}

function setTaskRecurrence(task: TaskRecord, recurrence: RecurrenceRecord) {
  task.recurrence = recurrence
}

function setCalendarRecurrence(item: CalendarItemRecord, recurrence: RecurrenceRecord) {
  item.recurrence = recurrence
}

function recurrenceRuleFromOptions(options: Record<string, unknown>, rootType: 'task' | 'calendar-item') {
  const frequency = String(options.frequency ?? 'daily')
  const interval = options.interval ? Number(options.interval) : undefined
  const parts = [`FREQ=${frequency.toUpperCase()}`]
  if (interval) parts.push(`INTERVAL=${interval}`)
  if (coerceArray(options['by-weekday'] as string[] | undefined).length) parts.push(`BYDAY=${coerceArray(options['by-weekday'] as string[] | undefined).join(',')}`)
  if (coerceArray(options['by-month-day'] as number[] | undefined).length) parts.push(`BYMONTHDAY=${coerceArray(options['by-month-day'] as number[] | undefined).join(',')}`)
  if (options.timezone) parts.push(`TZID=${String(options.timezone)}`)
  if (rootType === 'task' && options['advance-mode']) parts.push(`ADVANCE=${String(options['advance-mode'])}`)
  return parts.join(';')
}

function previewOccurrences<T>(root: T, count: number) {
  return Array.from({ length: count }, () => ({ ...(root as any) })) as T[]
}

function planningNextDaysWindow(day: string) {
  return dateWindow(day, 7)
}

function setLinkStatus(link: ExternalLinkRecord, kind: 'import' | 'mirror') {
  return { ...link, syncMode: kind, lifecycleStatus: 'linked' as const }
}

function detachLinkStatus(link: ExternalLinkRecord) {
  return { ...link, lifecycleStatus: 'detached' as const }
}

function outboxItem(state: State, outboxId: string) {
  return [...state.email.outbox, ...state.github.outbox, ...state.telegram.outbox, ...state.sync.providerOutbox].find((item) => item.id === outboxId)
}

function toOutboxList(state: State, provider: 'email' | 'github' | 'telegram' | 'sync') {
  const source = provider === 'email' ? state.email.outbox : provider === 'github' ? state.github.outbox : provider === 'telegram' ? state.telegram.outbox : state.sync.providerOutbox
  return source.map((item) => compact(item))
}

function addOutboxItem(state: State, provider: 'email' | 'github' | 'telegram' | 'sync', kind: string, summary: string, payload?: Record<string, any>) {
  const item = { id: nextId(state, `${provider}_out`), kind, status: 'queued', summary, provider, ...(payload ? { payload } : {}) } as any
  if (provider === 'email') state.email.outbox.push(item)
  else if (provider === 'github') state.github.outbox.push(item)
  else if (provider === 'telegram') state.telegram.outbox.push(item)
  else state.sync.providerOutbox.push(item)
  return item
}

function updateOutboxItem(state: State, outboxId: string, status: string) {
  const item = outboxItem(state, outboxId)
  if (item) item.status = status
  return item
}

function taskByIdOrError(context: Ctx, state: State, taskId: string) {
  return ensureFound(context, resolveTask(state, taskId), 'task', taskId)
}

function projectByIdOrError(context: Ctx, state: State, projectId: string) {
  return ensureFound(context, resolveProject(state, projectId), 'project', projectId)
}

function labelByIdOrError(context: Ctx, state: State, labelId: string) {
  return ensureFound(context, resolveLabel(state, labelId), 'label', labelId)
}

function calendarByIdOrError(context: Ctx, state: State, itemId: string) {
  return ensureFound(context, resolveCalendarItem(state, itemId), 'calendar-item', itemId)
}

function emailThreadByIdOrError(context: Ctx, state: State, threadId: string) {
  return ensureFound(context, resolveThread(state, threadId), 'thread', threadId)
}

function emailMessageByIdOrError(context: Ctx, state: State, messageId: string) {
  return ensureFound(context, resolveMessage(state, messageId), 'message', messageId)
}

function emailDraftByIdOrError(context: Ctx, state: State, draftId: string) {
  return ensureFound(context, resolveDraft(state, draftId), 'draft', draftId)
}

function githubRepoByIdOrError(context: Ctx, state: State, ref: string) {
  return ensureFound(context, resolveRepo(state, ref), 'repository', ref)
}

function githubIssueByIdOrError(context: Ctx, state: State, ref: string) {
  return ensureFound(context, resolveIssue(state, ref), 'issue', ref)
}

function githubPrByIdOrError(context: Ctx, state: State, ref: string) {
  return ensureFound(context, resolvePr(state, ref), 'pull request', ref)
}

function githubFollowByIdOrError(context: Ctx, state: State, ref: string) {
  return ensureFound(context, resolveFollow(state, ref), 'follow target', ref)
}

function telegramChatByIdOrError(context: Ctx, state: State, ref: string) {
  return ensureFound(context, getTelegramChat(state, ref), 'telegram chat', ref)
}

function telegramGroupByIdOrError(context: Ctx, state: State, ref: string) {
  return ensureFound(context, getTelegramGroup(state, ref), 'telegram group', ref)
}

function applyProjectUpdate(project: ProjectRecord, options: Record<string, unknown>) {
  if (options.name !== undefined) project.name = String(options.name)
  if (options.status !== undefined) project.status = String(options.status)
  if (options.description !== undefined) project.description = String(options.description)
}

function applyLabelUpdate(label: LabelRecord, options: Record<string, unknown>) {
  if (options.name !== undefined) label.name = String(options.name)
  if (options.color !== undefined) label.color = String(options.color)
}

function applyTaskUpdate(task: TaskRecord, options: Record<string, unknown>) {
  if (options.title !== undefined) task.title = String(options.title)
  if (options['description-md'] !== undefined) task.descriptionMd = String(options['description-md'])
  if (options.status !== undefined) task.status = String(options.status)
  if (options.priority !== undefined) task.priority = String(options.priority)
}

function applyCalendarUpdate(item: CalendarItemRecord, options: Record<string, unknown>) {
  if (options.title !== undefined) item.title = String(options.title)
  if (options.kind !== undefined) item.kind = String(options.kind)
  if (options.status !== undefined) item.status = String(options.status)
  if (options['description-md'] !== undefined) item.descriptionMd = String(options['description-md'])
  if (options.location !== undefined) item.location = String(options.location)
  if (options['all-day'] !== undefined) item.allDay = Boolean(options['all-day'])
  if (options['start-date'] !== undefined) item.startDate = String(options['start-date'])
  if (options['end-date-exclusive'] !== undefined) item.endDateExclusive = String(options['end-date-exclusive'])
  if (options['start-at'] !== undefined) item.startAt = String(options['start-at'])
  if (options['end-at'] !== undefined) item.endAt = String(options['end-at'])
  if (options.timezone !== undefined) item.timezone = String(options.timezone)
}

function planningTaskConflictList(state: State) {
  return state.sync.replicaConflicts.filter((conflict) => conflict.kind.includes('task') || conflict.kind.includes('planning'))
}

function planningCalendarConflictList(state: State) {
  return state.sync.replicaConflicts.filter((conflict) => conflict.kind.includes('calendar') || conflict.kind.includes('planning'))
}

function syncConflictOutput(conflict: ConflictRecord) {
  return compact({
    id: conflict.id,
    kind: conflict.kind,
    summary: conflict.summary,
    peers: conflict.peers,
  })
}

function syncConflictDetailOutput(conflict: ConflictRecord) {
  return compact({
    id: conflict.id,
    kind: conflict.kind,
    summary: conflict.summary,
    peers: conflict.peers,
    revisions: conflict.revisions,
    candidates: conflict.candidates,
  })
}

function resolveConflict(state: State, conflictId: string, resolution: string, candidateId?: string) {
  const index = state.sync.replicaConflicts.findIndex((conflict) => conflict.id === conflictId)
  if (index < 0) return undefined
  const conflict = state.sync.replicaConflicts[index]!
  if (candidateId) {
    const candidate = conflict.candidates?.find((entry) => entry.id === candidateId)
    if (!candidate) return conflict
  }
  state.sync.replicaConflicts.splice(index, 1)
  addActivity(state, {
    kind: 'sync.conflict.resolved',
    status: 'completed',
    actor: 'origin/cli',
    target: conflictId,
    summary: `Resolved conflict ${conflictId} via ${resolution}.`,
    severity: 'info',
    entityRefs: [conflictId],
  })
  return conflict
}

function providerStatusSummary(provider: string, state: State) {
  const integration = ensureIntegration(state, provider)
  return `${integration.provider.status}; ${integration.provider.surfaces.length} surface(s); ${integration.provider.pollers.length} poller(s).`
}

function rebuildProviderLastRefreshed(integration: IntegrationRecord) {
  integration.provider.lastRefreshedAt = now()
  integration.status.lastRefreshedAt = now()
}

function modifyProviderPollers(integration: IntegrationRecord, update: (poller: ProviderPollerRecord) => void) {
  for (const poller of integration.provider.pollers) update(poller)
  for (const surface of integration.provider.surfaces) {
    for (const poller of surface.pollers) update(poller)
  }
}

function repoMatchesFilter(repo: GithubRepositoryRecord, filters: string[] | undefined) {
  if (!filters?.length) return true
  return filters.some((filter) => matchesQuery(repo.name, filter))
}

function emailThreadIdsForTask(state: State, taskId: string) {
  return state.email.threads.filter((thread) => thread.linkedTaskIds.includes(taskId) || thread.triage?.linkedTaskId === taskId)
}

function githubFollowTargetsForTask(state: State, taskId: string) {
  return state.github.follows.filter((follow) => follow.linkedTaskIds.includes(taskId))
}

function telegramGroupsForAutomation(state: State, automationId: string) {
  return state.telegram.groups.filter((group) => state.entityLinks.some((link) => link.from === group.chatId && link.to === automationId))
}

function planningTaskContext(state: State, task: TaskRecord) {
  return {
    task: taskOutput(state, task),
    'linked-entities': taskEntityRefs(state, task),
    'recent-activity': linkedActivities(state, task.id),
  }
}

function planningCalendarContext(state: State, item: CalendarItemRecord) {
  return {
    'calendar-item': calendarItemOutput(state, item),
    'linked-entities': calendarEntityRefs(state, item),
    'recent-activity': linkedActivities(state, item.id),
  }
}

function searchPlanningHits(state: State, query: string) {
  return [
    ...state.planning.projects.filter((project) => matchesQuery(projectQueryText(project), query)).map((project) => searchOutput('project', project.id, project.name, scoreText(query, projectQueryText(project)), firstLine(project.description, project.name))),
    ...state.planning.labels.filter((label) => matchesQuery(labelQueryText(label), query)).map((label) => searchOutput('label', label.id, label.name, scoreText(query, labelQueryText(label)), label.color)),
    ...state.planning.tasks.filter((task) => matchesQuery(taskQueryText(state, task), query)).map((task) => searchOutput('task', task.id, task.title, scoreText(query, taskQueryText(state, task)), firstLine(task.descriptionMd, task.title))),
    ...state.planning.calendarItems.filter((item) => matchesQuery(calendarQueryText(state, item), query)).map((item) => searchOutput('calendar-item', item.id, item.title, scoreText(query, calendarQueryText(state, item)), firstLine(item.descriptionMd, item.title))),
  ].sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
}

function planningProjectByQuery(state: State, query: string) {
  return scoreAndSort(state.planning.projects.filter((project) => matchesQuery(projectQueryText(project), query)), query, projectQueryText)
}

function planningLabelByQuery(state: State, query: string) {
  return scoreAndSort(state.planning.labels.filter((label) => matchesQuery(labelQueryText(label), query)), query, labelQueryText)
}

function planningTaskByQuery(state: State, query: string) {
  return scoreAndSort(state.planning.tasks.filter((task) => matchesQuery(taskQueryText(state, task), query)), query, (task) => taskQueryText(state, task))
}

function planningCalendarByQuery(state: State, query: string) {
  return scoreAndSort(state.planning.calendarItems.filter((item) => matchesQuery(calendarQueryText(state, item), query)), query, (item) => calendarQueryText(state, item))
}

function applyTaskExternalLinkMutation(task: TaskRecord, provider: 'google-calendar' | 'google-tasks', link: Partial<ExternalLinkRecord>) {
  const existing = task.externalLinks.find((entry) => entry.provider === provider)
  const next = compact({ ...(existing ?? {}), ...(link as Record<string, unknown>), provider }) as ExternalLinkRecord
  addTaskExternalLink(task, next)
  return next
}

function applyCalendarExternalLinkMutation(item: CalendarItemRecord, provider: 'google-calendar' | 'google-tasks', link: Partial<ExternalLinkRecord>) {
  const existing = item.externalLinks.find((entry) => entry.provider === provider)
  const next = compact({ ...(existing ?? {}), ...(link as Record<string, unknown>), provider }) as ExternalLinkRecord
  addCalendarExternalLink(item, next)
  return next
}

function buildPlanningValidation(state: State) {
  const checks = [
    {
      id: 'planning-projects',
      kind: 'planning',
      target: 'projects',
      status: state.planning.projects.length ? ('pass' as const) : ('warn' as const),
      message: `${state.planning.projects.length} project(s) tracked.`,
      remediation: state.planning.projects.length ? undefined : ['Create a project or import one from provider state.'],
    },
    {
      id: 'planning-tasks',
      kind: 'planning',
      target: 'tasks',
      status: state.planning.tasks.length ? ('pass' as const) : ('warn' as const),
      message: `${state.planning.tasks.length} task(s) tracked.`,
    },
  ]
  return validationResult(checks, 'Planning validation completed.')
}

function createProject(state: State, options: Record<string, unknown>) {
  const project: ProjectRecord = {
    id: nextId(state, 'prj'),
    name: String(options.name),
    status: 'active',
    description: options.description ? String(options.description) : undefined,
    history: [],
    revisions: [],
  }
  state.planning.projects.push(project)
  recordPlanningChange(state, project as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.project.create', `Created project ${project.name}.`, {}, projectSnapshot(project), ['name', 'status', 'description'])
  return project
}

function createLabel(state: State, options: Record<string, unknown>) {
  const label: LabelRecord = {
    id: nextId(state, 'lbl'),
    name: String(options.name),
    color: options.color ? String(options.color) : undefined,
    history: [],
    revisions: [],
  }
  state.planning.labels.push(label)
  recordPlanningChange(state, label as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.label.create', `Created label ${label.name}.`, {}, labelSnapshot(label), ['name', 'color'])
  return label
}

function createTask(state: State, options: Record<string, unknown>) {
  const task: TaskRecord = {
    id: nextId(state, 'tsk'),
    title: String(options.title),
    status: 'todo',
    priority: options.priority ? String(options.priority) : undefined,
    projectId: options.project ? String(options.project) : undefined,
    labelIds: coerceArray(options.labels as string[] | undefined),
    descriptionMd: options['description-md'] ? String(options['description-md']) : undefined,
    calendarItemIds: [],
    blockedBy: coerceArray(options['blocked-by'] as string[] | undefined),
    dueKind: options['due-kind'] ? String(options['due-kind']) as TaskRecord['dueKind'] : undefined,
    dueFrom: options['due-from'] ? String(options['due-from']) : undefined,
    dueAt: options['due-at'] ? String(options['due-at']) : undefined,
    dueTimezone: options['due-timezone'] ? String(options['due-timezone']) : undefined,
    externalLinks: [],
    history: [],
    revisions: [],
  }
  if (task.projectId) task.projectId = String(task.projectId)
  state.planning.tasks.push(task)
  if (task.projectId) state.entityLinks.push({ from: task.id, to: task.projectId, kind: 'belongs-to' })
  for (const labelId of task.labelIds) state.entityLinks.push({ from: task.id, to: labelId, kind: 'labeled-by' })
  for (const blockedBy of task.blockedBy) state.entityLinks.push({ from: task.id, to: blockedBy, kind: 'blocked-by' })
  recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.create', `Created task ${task.title}.`, {}, taskSnapshot(task), ['title', 'status', 'priority', 'projectId', 'labelIds', 'descriptionMd', 'blockedBy'])
  return task
}

function createCalendarItem(state: State, options: Record<string, unknown>) {
  const item: CalendarItemRecord = {
    id: nextId(state, 'cal'),
    title: String(options.title),
    status: 'confirmed',
    kind: options.kind ? String(options.kind) : undefined,
    projectId: options['project-id'] ? String(options['project-id']) : undefined,
    labelIds: coerceArray(options.labels as string[] | undefined),
    descriptionMd: options['description-md'] ? String(options['description-md']) : undefined,
    location: options.location ? String(options.location) : undefined,
    startDate: options['start-date'] ? String(options['start-date']) : undefined,
    endDateExclusive: options['end-date-exclusive'] ? String(options['end-date-exclusive']) : undefined,
    startAt: options['start-at'] ? String(options['start-at']) : undefined,
    endAt: options['end-at'] ? String(options['end-at']) : undefined,
    timezone: options.timezone ? String(options.timezone) : undefined,
    allDay: Boolean(options['all-day']),
    taskIds: coerceArray(options['task-id'] as string[] | undefined),
    externalLinks: [],
    history: [],
    revisions: [],
  }
  state.planning.calendarItems.push(item)
  if (item.projectId) state.entityLinks.push({ from: item.id, to: item.projectId, kind: 'belongs-to' })
  for (const labelId of item.labelIds) state.entityLinks.push({ from: item.id, to: labelId, kind: 'labeled-by' })
  for (const taskId of item.taskIds) state.entityLinks.push({ from: item.id, to: taskId, kind: 'linked-task' })
  recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.create', `Created calendar item ${item.title}.`, {}, calendarSnapshot(item), ['title', 'status', 'kind', 'projectId', 'labelIds', 'taskIds'])
  return item
}

function deletePlanningRecord<T extends { id: string; archived?: boolean }>(state: State, array: T[], id: string) {
  const index = array.findIndex((item) => item.id === id)
  if (index < 0) return undefined
  const record = array[index]!
  record.archived = true
  return record
}

function planningRouteSummary(action: string, record: { id: string; name?: string; title?: string }) {
  return actionResult(mutationSummary(action, record), { affectedIds: [record.id] })
}

function genericSortByLatest<T>(items: T[]) {
  return [...items].sort((left, right) =>
    cmpDateDescending(
      (left as any).lastMessageAt ?? (left as any).startAt ?? (left as any).startDate ?? (left as any).at,
      (right as any).lastMessageAt ?? (right as any).startAt ?? (right as any).startDate ?? (right as any).at,
    ),
  )
}

function planningTaskOutputs(state: State, tasks: TaskRecord[], query?: string) {
  return listResult(mapTaskList(state, query ? planningTaskByQuery(state, query) : tasks), { total: tasks.length, summary: entityListSummary('task', tasks.length) })
}

function planningProjectOutputs(projects: ProjectRecord[]) {
  return listResult(mapProjectList(projects), { total: projects.length, summary: entityListSummary('project', projects.length) })
}

function planningLabelOutputs(labels: LabelRecord[]) {
  return listResult(mapLabelList(labels), { total: labels.length, summary: entityListSummary('label', labels.length) })
}

function planningCalendarOutputs(state: State, items: CalendarItemRecord[]) {
  return listResult(mapCalendarList(state, items), { total: items.length, summary: entityListSummary('calendar item', items.length) })
}

function planningEntityRelated(state: State, entityId: string) {
  const refs = linkedEntitiesById(state, entityId)
  return listResult(refs, { total: refs.length, summary: entityListSummary('related entity', refs.length) })
}

function taskDependencies(state: State, task: TaskRecord) {
  return listResult(task.blockedBy.map((id) => resolveTask(state, id)).filter(Boolean).map((item) => taskOutput(state, item as TaskRecord)), { total: task.blockedBy.length, summary: `${task.blockedBy.length} blocking task(s).` })
}

function clearTaskDependencies(state: State, task: TaskRecord, blockedBy?: string[]) {
  if (!blockedBy?.length) {
    task.blockedBy = []
    return
  }
  task.blockedBy = task.blockedBy.filter((id) => !blockedBy.includes(id))
}

function taskLinkedCalendarItems(state: State, task: TaskRecord) {
  return task.calendarItemIds.map((id) => resolveCalendarItem(state, id)).filter(Boolean) as CalendarItemRecord[]
}

function taskLinkedLabels(state: State, task: TaskRecord) {
  return task.labelIds.map((id) => resolveLabel(state, id)).filter(Boolean) as LabelRecord[]
}

function taskProjectSet(state: State, task: TaskRecord, projectId?: string) {
  task.projectId = projectId
}

function taskNoteLink(state: State, task: TaskRecord, noteId?: string) {
  task.noteId = noteId
}

function taskDueSet(task: TaskRecord, options: Record<string, unknown>) {
  task.dueKind = String(options['due-kind']) as TaskRecord['dueKind']
  task.dueFrom = options['due-from'] ? String(options['due-from']) : undefined
  task.dueAt = options['due-at'] ? String(options['due-at']) : undefined
  task.dueTimezone = options['due-timezone'] ? String(options['due-timezone']) : undefined
}

function taskScheduleSet(state: State, task: TaskRecord, options: Record<string, unknown>) {
  let item: CalendarItemRecord | undefined
  if (options['calendar-item-id']) {
    item = resolveCalendarItem(state, String(options['calendar-item-id']))
  }
  if (!item) {
    item = createCalendarItem(state, {
      title: task.title,
      kind: 'task-schedule',
      'project-id': task.projectId,
      labels: task.labelIds,
      'description-md': task.descriptionMd,
      'task-id': [task.id],
      'all-day': Boolean(options['start-date'] || options['end-date-exclusive']),
      'start-date': options['start-date'],
      'end-date-exclusive': options['end-date-exclusive'],
      'start-at': options['start-at'],
      'end-at': options['end-at'],
      timezone: options.timezone,
    })
  } else {
    applyCalendarUpdate(item, options)
  }
  if (!task.calendarItemIds.includes(item.id)) task.calendarItemIds.push(item.id)
  if (!item.taskIds.includes(task.id)) item.taskIds.push(task.id)
}

function taskScheduleClear(state: State, task: TaskRecord, itemId?: string) {
  const ids = itemId ? [itemId] : [...task.calendarItemIds]
  task.calendarItemIds = task.calendarItemIds.filter((id) => !ids.includes(id))
  for (const id of ids) {
    const item = resolveCalendarItem(state, id)
    if (item) item.taskIds = item.taskIds.filter((taskId) => taskId !== task.id)
  }
}

function taskRecurrenceSet(task: TaskRecord, options: Record<string, unknown>) {
  task.recurrence = {
    rule: recurrenceRuleFromOptions(options, 'task'),
    startDate: options['start-date'] ? String(options['start-date']) : undefined,
    endDate: options['end-date'] ? String(options['end-date']) : undefined,
    seriesId: task.recurrence?.seriesId ?? `series_${task.id}`,
    occurrenceIndex: task.recurrence?.occurrenceIndex ?? 0,
    advanceMode: options['advance-mode'] ? String(options['advance-mode']) as RecurrenceRecord['advanceMode'] : undefined,
  }
}

function taskRecurrenceClear(task: TaskRecord) {
  task.recurrence = undefined
}

function calendarRecurrenceSet(item: CalendarItemRecord, options: Record<string, unknown>) {
  item.recurrence = {
    rule: recurrenceRuleFromOptions(options, 'calendar-item'),
    startDate: options['start-date'] ? String(options['start-date']) : undefined,
    endDate: options['end-date'] ? String(options['end-date']) : undefined,
    seriesId: item.recurrence?.seriesId ?? `series_${item.id}`,
    occurrenceIndex: item.recurrence?.occurrenceIndex ?? 0,
  }
}

function calendarRecurrenceClear(item: CalendarItemRecord) {
  item.recurrence = undefined
}

function materializeTaskOccurrences(state: State, task: TaskRecord, count: number) {
  return previewOccurrences(taskOutput(state, task), count).map((item) => item)
}

function materializeCalendarOccurrences(state: State, item: CalendarItemRecord, count: number) {
  return previewOccurrences(calendarItemOutput(state, item), count).map((entry) => entry)
}

function githubIssueActivity(state: State, issue: GithubIssueRecord) {
  return linkedActivities(state, issue.id)
}

function githubPrActivity(state: State, pr: GithubPullRequestRecord) {
  return linkedActivities(state, pr.id)
}

function githubRepoContext(state: State, repo: GithubRepositoryRecord) {
  return {
    repo: githubRepositoryOutput(repo),
    'linked-entities': linkedEntitiesById(state, repo.id),
    'recent-activity': linkedActivities(state, repo.id),
  }
}

function githubRepoList(state: State, filters: any) {
  let repos = state.github.repositories
  if (filters.query) repos = repos.filter((repo) => matchesQuery(normalizeRepoQuery(repo), String(filters.query)))
  if (filters.followed) repos = repos.filter((repo) => repo.followed)
  repos = genericSortByLatest(repos)
  return repos
}

function normalizeRepoQuery(repo: GithubRepositoryRecord) {
  return [repo.name, repo.summary, repo.tracked ? 'tracked' : '', repo.pinned ? 'pinned' : '', repo.starred ? 'starred' : '', repo.followed ? 'followed' : ''].filter(Boolean).join('\n')
}

function githubIssueList(state: State, filters: any) {
  let issues = state.github.issues
  if (filters.repo?.length) issues = issues.filter((issue) => filters.repo.some((repo: string) => issue.ref.startsWith(repo)))
  if (filters.state?.length) issues = issues.filter((issue) => filters.state.includes(issue.state))
  if (filters.query) issues = issues.filter((issue) => matchesQuery(githubIssueQueryText(issue), String(filters.query)))
  return genericSortByLatest(issues)
}

function githubPrList(state: State, filters: any) {
  let prs = state.github.pullRequests
  if (filters.repo?.length) prs = prs.filter((pr) => filters.repo.some((repo: string) => pr.ref.startsWith(repo)))
  if (filters.state?.length) prs = prs.filter((pr) => filters.state.includes(pr.state))
  if (filters.query) prs = prs.filter((pr) => matchesQuery(githubPrQueryText(pr), String(filters.query)))
  return genericSortByLatest(prs)
}

function githubRepoSearch(state: State, query: string) {
  return scoreAndSort(state.github.repositories.filter((repo) => matchesQuery(normalizeRepoQuery(repo), query)), query, normalizeRepoQuery)
}

function githubFollowNext(state: State) {
  return state.github.follows.filter((follow) => !follow.dismissed)
}

function githubFollowList(state: State, filters: any) {
  let follows = state.github.follows
  if (filters.repo?.length) follows = follows.filter((follow) => filters.repo.includes(follow.repo))
  if (filters.kind?.length) follows = follows.filter((follow) => filters.kind.includes(follow.kind))
  return follows
}

function githubIssueContextEntities(state: State, issue: GithubIssueRecord) {
  const refs = linkedEntitiesById(state, issue.id)
  return refs
}

function githubPrContextEntities(state: State, pr: GithubPullRequestRecord) {
  return linkedEntitiesById(state, pr.id)
}

function githubSearchRecent(state: State) {
  return [
    ...state.github.issues.map((issue) => searchOutput('github-issue', issue.id, issue.title, 0.7, issue.summary)),
    ...state.github.pullRequests.map((pr) => searchOutput('github-pr', pr.id, pr.title, 0.8, pr.summary)),
    ...state.github.repositories.map((repo) => searchOutput('github-repository', repo.id, repo.name, 0.6, repo.summary)),
  ]
}

function githubAccountValidate(state: State) {
  const integration = ensureIntegration(state, 'github')
  return validationResult(
    [
      {
        id: 'github-connection',
        kind: 'github',
        target: 'github',
        status: integration.status.status === 'connected' ? 'pass' : 'warn',
        message: integration.status.summary,
      },
      {
        id: 'github-grants',
        kind: 'github',
        target: 'permissions',
        status: integration.missingScopes.length ? 'warn' : 'pass',
        message: integration.missingScopes.length ? `${integration.missingScopes.length} missing scope(s).` : 'All configured scopes granted.',
      },
    ],
    integration.status.summary,
  )
}

function githubIssueOutputWithState(state: State, issue: GithubIssueRecord) {
  return githubIssueOutput(issue)
}

function githubPrOutputWithState(state: State, pr: GithubPullRequestRecord) {
  return githubPullRequestOutput(pr)
}

function githubSearchItems(state: State, query: string, scope: 'repo' | 'issue' | 'pr' | 'comment') {
  if (scope === 'repo') return githubSearchRecent(state).filter((hit) => hit.kind === 'github-repository' && matchesQuery(String(hit.title), query))
  if (scope === 'issue') return state.github.issues.filter((issue) => matchesQuery(githubIssueQueryText(issue), query)).map((issue) => searchOutput('github-issue', issue.id, issue.title, scoreText(query, githubIssueQueryText(issue)), firstLine(issue.summary, issue.title)))
  if (scope === 'pr') return state.github.pullRequests.filter((pr) => matchesQuery(githubPrQueryText(pr), query)).map((pr) => searchOutput('github-pr', pr.id, pr.title, scoreText(query, githubPrQueryText(pr)), firstLine(pr.summary, pr.title)))
  return state.github.comments.filter((comment) => matchesQuery(comment.body, query)).map((comment) => searchOutput('github-comment', comment.id, comment.author, scoreText(query, comment.body), firstLine(comment.body, comment.author)))
}

function telegramConnectionValidate(state: State) {
  return telegramValidationResult(state)
}

function telegramChatSearchHits(state: State, query: string) {
  return telegramSearchHits(state, query)
}

function telegramChatRefresh(state: State, chatId?: string) {
  if (chatId) {
    const chat = ensureTelegramChat(state, chatId)
    chat.messageCacheState = 'warm'
  }
  ensureIntegration(state, 'telegram').provider.lastRefreshedAt = now()
}

function telegramSummaryNext(state: State) {
  return state.telegram.groups
    .filter((group) => group.enabled)
    .map((group) => {
      const existing = state.telegram.summaries.find((summary) => summary.chatId === group.chatId)
      return existing ?? {
        id: nextId(state, 'tg_sum'),
        chatId: group.chatId,
        triggerKind: 'scheduled',
        status: 'pending',
        summary: group.summary ?? 'Telegram summary due.',
      }
    })
}

function emailAccountLabels(state: State) {
  return state.email.accounts.flatMap((account) => account.labels)
}

function emailAccountAliases(state: State) {
  return state.email.accounts.flatMap((account) => account.aliases)
}

function emailNextThreads(state: State) {
  return state.email.threads
    .filter((thread) => thread.unread || normalizeEmailTriageState(thread.triage?.state) === 'needs_reply')
    .sort((left, right) => cmpDateDescending(left.lastMessageAt, right.lastMessageAt))
}

function emailThreadTriages(state: State) {
  return emailTriageList(state)
    .map((thread) => emailTriageOutput(thread))
    .filter(
      (
        triage,
      ): triage is NonNullable<ReturnType<typeof emailTriageOutput>> =>
        triage !== undefined,
    )
}

function emailThreadTriageById(state: State, threadId: string) {
  const thread = resolveThread(state, threadId)
  return thread ? emailTriageOutput(thread) : undefined
}

function setThreadTriage(state: State, thread: EmailThreadRecord, options: Record<string, unknown>) {
  thread.triage = {
    threadId: thread.id,
    state: String(options.state),
    followUpAt: options['follow-up-at'] ? String(options['follow-up-at']) : undefined,
    linkedTaskId: options['linked-task-id'] ? String(options['linked-task-id']) : undefined,
    note: thread.triage?.note,
  }
}

function clearThreadTriage(thread: EmailThreadRecord) {
  thread.triage = undefined
}

function updateThreadLabelIds(thread: EmailThreadRecord, labels: string[], mode: 'add' | 'remove') {
  if (mode === 'add') {
    for (const label of labels) if (!thread.labelIds.includes(label)) thread.labelIds.push(label)
    return
  }
  thread.labelIds = thread.labelIds.filter((label) => !labels.includes(label))
}

function setThreadStatusFlag(thread: EmailThreadRecord, key: 'archived' | 'unread' | 'starred' | 'spam' | 'trashed', value: boolean) {
  thread[key] = value
}

function emailThreadRefresh(state: State, thread: EmailThreadRecord) {
  thread.freshness = 'fresh'
  thread.lastMessageAt = thread.lastMessageAt ?? now()
  ensureIntegration(state, 'email').provider.lastRefreshedAt = now()
}

function emailCacheOutput(state: State) {
  return providerIngressOutput(ensureIntegration(state, 'email'))
}

function emailRefreshReset(state: State, accountId?: string) {
  const integration = ensureIntegration(state, 'email')
  integration.provider.pollers.forEach((poller) => {
    if (!accountId || poller.scope.includes(accountId)) poller.cursor = undefined
  })
}

function emailOutboxResolve(state: State, outboxId: string, status: string) {
  const item = outboxItem(state, outboxId)
  if (item) item.status = status
  return item
}

function planningTaskListByFilters(state: State, filters: any) {
  let tasks = state.planning.tasks
  if (filters.status?.length) tasks = tasks.filter((task) => filters.status.includes(task.status))
  if (filters.project?.length) tasks = tasks.filter((task) => task.projectId && filters.project.includes(task.projectId))
  if (filters.label?.length) tasks = tasks.filter((task) => task.labelIds.some((label) => filters.label.includes(label)))
  if (filters.due) tasks = tasks.filter((task) => taskDueWindow(task, today()) === filters.due)
  if (filters['linked-calendar-item']) tasks = tasks.filter((task) => task.calendarItemIds.includes(String(filters['linked-calendar-item'])))
  if (filters['google-tasks-synced'] !== undefined) tasks = tasks.filter((task) => task.externalLinks.some((link) => link.provider === 'google-tasks') === Boolean(filters['google-tasks-synced']))
  return tasks
}

function calendarListByFilters(state: State, filters: any) {
  let items = state.planning.calendarItems
  if (filters.kind?.length) items = items.filter((item) => item.kind && filters.kind.includes(item.kind))
  if (filters['date-from']) {
    const from = String(filters['date-from'])
    items = items.filter((item) => {
      const day = parseDateLike(item.startDate ?? item.startAt ?? item.endAt)
      return day ? day >= from : false
    })
  }
  if (filters['date-to']) {
    const to = String(filters['date-to'])
    items = items.filter((item) => {
      const day = parseDateLike(item.startDate ?? item.startAt ?? item.endAt)
      return day ? day <= to : false
    })
  }
  return items
}

function planningTaskRelatedOutput(state: State, task: TaskRecord) {
  return listResult(taskEntityRefs(state, task), { total: taskEntityRefs(state, task).length, summary: entityListSummary('related entity', taskEntityRefs(state, task).length) })
}

function planningCalendarRelatedOutput(state: State, item: CalendarItemRecord) {
  return listResult(calendarEntityRefs(state, item), { total: calendarEntityRefs(state, item).length, summary: entityListSummary('related entity', calendarEntityRefs(state, item).length) })
}

function taskConflictGet(state: State, conflictId: string) {
  return state.sync.replicaConflicts.find((conflict) => conflict.id === conflictId)
}

function calendarConflictGet(state: State, conflictId: string) {
  return state.sync.replicaConflicts.find((conflict) => conflict.id === conflictId)
}

function planningBridgeAction(state: State, providerKey: 'google-calendar' | 'google-tasks', action: string, scopeId?: string) {
  const integration = ensureIntegration(state, providerKey)
  rebuildProviderLastRefreshed(integration)
  if (scopeId) {
    const surface = providerSurfaceByRef(integration.provider.surfaces, scopeId)
    if (surface) {
      surface.status = 'active'
      surface.summary = `${action} completed for ${scopeId}.`
      surface.selected = true
    } else {
      attachProviderSurface(state, providerKey, scopeId)
    }
  }
  modifyProviderPollers(integration, (poller) => {
    poller.lastStartedAt = now()
    poller.lastSucceededAt = now()
    poller.status = 'active'
  })
}

function planningBridgeResetCursor(state: State, providerKey: 'google-calendar' | 'google-tasks', scopeId?: string) {
  const integration = ensureIntegration(state, providerKey)
  if (scopeId) {
    const surface = providerSurfaceByRef(integration.provider.surfaces, scopeId)
    if (surface) {
      for (const poller of surface.pollers) poller.cursor = undefined
    }
  }
  for (const poller of integration.provider.pollers) {
    if (!scopeId || poller.scope === scopeId || poller.provider === providerKey) poller.cursor = undefined
  }
  rebuildProviderLastRefreshed(integration)
}

function planningBridgeRepair(state: State, providerKey: 'google-calendar' | 'google-tasks', scopeId?: string) {
  const integration = ensureIntegration(state, providerKey)
  integration.provider.status = 'degraded'
  if (scopeId) attachProviderSurface(state, providerKey, scopeId)
  modifyProviderPollers(integration, (poller) => {
    poller.status = 'active'
    poller.lastSucceededAt = now()
  })
  rebuildProviderLastRefreshed(integration)
}

function applyTaskArchive(task: TaskRecord, archived: boolean) {
  task.archived = archived
  task.status = archived ? 'archived' : task.status === 'archived' ? 'todo' : task.status
}

function applyCalendarArchive(item: CalendarItemRecord, archived: boolean) {
  item.archived = archived
  item.status = archived ? 'archived' : item.status === 'archived' ? 'confirmed' : item.status
}

function restoreFromLatest(task: TaskRecord | CalendarItemRecord | ProjectRecord | LabelRecord) {
  if (!('revisions' in task)) return
}

function mutationActivity(kind: string, target: string, summary: string) {
  return {
    kind,
    status: 'completed',
    actor: 'origin/cli',
    target,
    summary,
    severity: 'info' as const,
    entityRefs: [target],
  }
}

// Planning
on('planning today', async (context) => {
  const state = await loadState(context.runtime)
  const day = String(context.options.date ?? today())
  return planningDayView(state, day)
})

on('planning week', async (context) => {
  const state = await loadState(context.runtime)
  const weekStart = String(context.options['week-start'] ?? today())
  const start = new Date(`${weekStart}T00:00:00.000Z`)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + index)
    return planningDayView(state, date.toISOString().slice(0, 10))
  })
  return { 'week-start': weekStart, days, summary: `${days.length} day(s) in the week view.` }
})

on('planning agenda', async (context) => {
  const state = await loadState(context.runtime)
  return planningAgendaView(state, String(context.options.date ?? today()))
})

on('planning window', async (context) => {
  const state = await loadState(context.runtime)
  return planningWindowView(state, String(context.options.from), String(context.options.to))
})

on('planning inbox', async (context) => {
  const state = await loadState(context.runtime)
  const tasks = planningInbox(state)
  return listResult(mapTaskList(state, tasks), { total: tasks.length, summary: entityListSummary('inbox task', tasks.length) })
})

on('planning upcoming', async (context) => {
  const state = await loadState(context.runtime)
  const from = String(context.options.date ?? today())
  const window = planningNextDaysWindow(from)
  return planningWindowView(state, from, window.end)
})

on('planning overdue', async (context) => {
  const state = await loadState(context.runtime)
  const tasks = planningOverdue(state)
  return listResult(mapTaskList(state, tasks), { total: tasks.length, summary: entityListSummary('overdue task', tasks.length) })
})

on('planning backlog', async (context) => {
  const state = await loadState(context.runtime)
  const tasks = planningBacklog(state)
  const query = context.options.query ? String(context.options.query) : undefined
  const filtered = query ? planningTaskByQuery(state, query).filter((task) => tasks.some((record) => record.id === task.id)) : tasks
  const limited = listWithLimit(filtered, context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapTaskList(state, limited), { total: filtered.length, summary: entityListSummary('backlog task', filtered.length) })
})

on('planning board', async (context) => {
  const state = await loadState(context.runtime)
  return planningBoardView(state)
})

on('planning recurring', async (context) => {
  const state = await loadState(context.runtime)
  const tasks = planningRecurringTasks(state)
  const items = planningRecurringCalendarItems(state)
  return {
    tasks: mapTaskList(state, tasks),
    'calendar-items': mapCalendarList(state, items),
  }
})

on('planning task-graph', async (context) => {
  const state = await loadState(context.runtime)
  return planningTaskGraphView(state)
})

on('planning project list', async (context) => {
  const state = await loadState(context.runtime)
  let projects = state.planning.projects
  if (context.options.status?.length) projects = projects.filter((project) => context.options.status.includes(project.status))
  projects = listWithLimit(projects, context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapProjectList(projects), { total: projects.length, summary: entityListSummary('project', projects.length) })
})

on('planning project get', async (context) => {
  const state = await loadState(context.runtime)
  return projectOutput(projectByIdOrError(context, state, String(context.args['project-id'])))
})

on('planning project search', async (context) => {
  const state = await loadState(context.runtime)
  const query = String(context.options.query)
  const projects = listWithLimit(planningProjectByQuery(state, query), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapProjectList(projects), { total: projects.length, summary: entityListSummary('matching project', projects.length) })
})

on('planning project create', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const project = createProject(state, context.options as Record<string, unknown>)
    return actionResult(mutationSummary('Created project', project), { affectedIds: [project.id] })
  })
})

on('planning project update', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const project = projectByIdOrError(context, state, String(context.args['project-id']))
    const before = projectSnapshot(project)
    applyProjectUpdate(project, context.options as Record<string, unknown>)
    const after = projectSnapshot(project)
    recordPlanningChange(state, project as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.project.update', `Updated project ${project.name}.`, before, after, Object.keys(after))
    return actionResult(`Updated project ${project.name}.`, { affectedIds: [project.id] })
  })
})

on('planning project archive', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const project = projectByIdOrError(context, state, String(context.args['project-id']))
    const before = projectSnapshot(project)
    project.archived = true
    project.status = 'archived'
    const after = projectSnapshot(project)
    recordPlanningChange(state, project as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.project.archive', `Archived project ${project.name}.`, before, after, ['archived', 'status'])
    return actionResult(`Archived project ${project.name}.`, { affectedIds: [project.id] })
  })
})

on('planning project unarchive', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const project = projectByIdOrError(context, state, String(context.args['project-id']))
    const before = projectSnapshot(project)
    project.archived = false
    if (project.status === 'archived') project.status = 'active'
    const after = projectSnapshot(project)
    recordPlanningChange(state, project as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.project.unarchive', `Unarchived project ${project.name}.`, before, after, ['archived', 'status'])
    return actionResult(`Unarchived project ${project.name}.`, { affectedIds: [project.id] })
  })
})

on('planning project delete', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const project = projectByIdOrError(context, state, String(context.args['project-id']))
    const before = projectSnapshot(project)
    project.archived = true
    project.status = 'deleted'
    const after = projectSnapshot(project)
    recordPlanningChange(state, project as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.project.delete', `Deleted project ${project.name}.`, before, after, ['archived', 'status'])
    return actionResult(`Deleted project ${project.name}.`, { affectedIds: [project.id] })
  })
})

on('planning project history', async (context) => {
  const state = await loadState(context.runtime)
  const project = projectByIdOrError(context, state, String(context.args['project-id']))
  return listResult(projectHistory(project), { total: project.history.length, summary: entityListSummary('project history entry', project.history.length) })
})

on('planning project restore', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const project = projectByIdOrError(context, state, String(context.args['project-id']))
    const revisionId = String(context.args['revision-id'])
    const before = projectSnapshot(project)
    const revision = findRevision(project, revisionId)
    if (!revision?.snapshot) return actionResult(`No snapshot available for project revision ${revisionId}.`, { affectedIds: [project.id] })
    restorePlanningSnapshot(project as unknown as Record<string, unknown>, revision.snapshot as Record<string, unknown>)
    const after = projectSnapshot(project)
    recordPlanningChange(state, project as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, `planning.project.restore`, `Restored project ${project.name} from ${revisionId}.`, before, after, Object.keys(revision.snapshot))
    return actionResult(`Restored project ${project.name} from ${revisionId}.`, { affectedIds: [project.id] })
  })
})

on('planning label list', async (context) => {
  const state = await loadState(context.runtime)
  const labels = listWithLimit(state.planning.labels, context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapLabelList(labels), { total: labels.length, summary: entityListSummary('label', labels.length) })
})

on('planning label get', async (context) => {
  const state = await loadState(context.runtime)
  return labelOutput(labelByIdOrError(context, state, String(context.args['label-id'])))
})

on('planning label search', async (context) => {
  const state = await loadState(context.runtime)
  const labels = listWithLimit(planningLabelByQuery(state, String(context.options.query)), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapLabelList(labels), { total: labels.length, summary: entityListSummary('matching label', labels.length) })
})

on('planning label create', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const label = createLabel(state, context.options as Record<string, unknown>)
    return actionResult(mutationSummary('Created label', label), { affectedIds: [label.id] })
  })
})

on('planning label update', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const label = labelByIdOrError(context, state, String(context.args['label-id']))
    const before = labelSnapshot(label)
    applyLabelUpdate(label, context.options as Record<string, unknown>)
    const after = labelSnapshot(label)
    recordPlanningChange(state, label as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.label.update', `Updated label ${label.name}.`, before, after, Object.keys(after))
    return actionResult(`Updated label ${label.name}.`, { affectedIds: [label.id] })
  })
})

on('planning label archive', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const label = labelByIdOrError(context, state, String(context.args['label-id']))
    const before = labelSnapshot(label)
    label.archived = true
    const after = labelSnapshot(label)
    recordPlanningChange(state, label as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.label.archive', `Archived label ${label.name}.`, before, after, ['archived'])
    return actionResult(`Archived label ${label.name}.`, { affectedIds: [label.id] })
  })
})

on('planning label unarchive', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const label = labelByIdOrError(context, state, String(context.args['label-id']))
    const before = labelSnapshot(label)
    label.archived = false
    const after = labelSnapshot(label)
    recordPlanningChange(state, label as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.label.unarchive', `Unarchived label ${label.name}.`, before, after, ['archived'])
    return actionResult(`Unarchived label ${label.name}.`, { affectedIds: [label.id] })
  })
})

on('planning label delete', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const label = labelByIdOrError(context, state, String(context.args['label-id']))
    const before = labelSnapshot(label)
    label.archived = true
    const after = labelSnapshot(label)
    recordPlanningChange(state, label as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.label.delete', `Deleted label ${label.name}.`, before, after, ['archived'])
    return actionResult(`Deleted label ${label.name}.`, { affectedIds: [label.id] })
  })
})

on('planning label history', async (context) => {
  const state = await loadState(context.runtime)
  const label = labelByIdOrError(context, state, String(context.args['label-id']))
  return listResult(labelHistory(label), { total: label.history.length, summary: entityListSummary('label history entry', label.history.length) })
})

on('planning label restore', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const label = labelByIdOrError(context, state, String(context.args['label-id']))
    const revisionId = String(context.args['revision-id'])
    const before = labelSnapshot(label)
    const revision = findRevision(label, revisionId)
    if (!revision?.snapshot) return actionResult(`No snapshot available for label revision ${revisionId}.`, { affectedIds: [label.id] })
    restorePlanningSnapshot(label as unknown as Record<string, unknown>, revision.snapshot as Record<string, unknown>)
    const after = labelSnapshot(label)
    recordPlanningChange(state, label as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, `planning.label.restore`, `Restored label ${label.name} from ${revisionId}.`, before, after, Object.keys(revision.snapshot))
    return actionResult(`Restored label ${label.name} from ${revisionId}.`, { affectedIds: [label.id] })
  })
})

on('planning task list', async (context) => {
  const state = await loadState(context.runtime)
  const tasks = planningTaskListByFilters(state, context.options as Record<string, unknown>)
  return planningTaskOutputs(state, tasks)
})

on('planning task get', async (context) => {
  const state = await loadState(context.runtime)
  const task = taskByIdOrError(context, state, String(context.args['task-id']))
  return taskOutput(state, task)
})

on('planning task search', async (context) => {
  const state = await loadState(context.runtime)
  const tasks = listWithLimit(planningTaskByQuery(state, String(context.options.query)), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapTaskList(state, tasks), { total: tasks.length, summary: entityListSummary('matching task', tasks.length) })
})

on('planning task related', async (context) => {
  const state = await loadState(context.runtime)
  const task = taskByIdOrError(context, state, String(context.args['task-id']))
  return planningTaskRelatedOutput(state, task)
})

for (const suffix of ['complete', 'reopen', 'cancel', 'archive', 'unarchive', 'delete'] as const) {
  on(`planning task ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const task = taskByIdOrError(context, state, String(context.args['task-id']))
      const before = taskSnapshot(task)
      if (suffix === 'complete') task.status = 'done'
      if (suffix === 'reopen') task.status = 'todo'
      if (suffix === 'cancel') task.status = 'canceled'
      if (suffix === 'archive' || suffix === 'delete') applyTaskArchive(task, true)
      if (suffix === 'unarchive') applyTaskArchive(task, false)
      const after = taskSnapshot(task)
      const verb = suffix === 'delete' ? 'Deleted' : capitalize(suffix)
      recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, `planning.task.${suffix}`, `${verb} task ${task.title}.`, before, after, ['status', 'archived'])
      return actionResult(`${verb} task ${task.title}.`, { affectedIds: [task.id] })
    })
  })
}

on('planning task create', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = createTask(state, context.options as Record<string, unknown>)
    return actionResult(mutationSummary('Created task', task), { affectedIds: [task.id] })
  })
})

on('planning task update', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    applyTaskUpdate(task, context.options as Record<string, unknown>)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.update', `Updated task ${task.title}.`, before, after, Object.keys(after))
    return actionResult(`Updated task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task history', async (context) => {
  const state = await loadState(context.runtime)
  const task = taskByIdOrError(context, state, String(context.args['task-id']))
  return listResult(taskHistory(task), { total: task.history.length, summary: entityListSummary('task history entry', task.history.length) })
})

on('planning task restore', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const revisionId = String(context.args['revision-id'])
    const before = taskSnapshot(task)
    const revision = findRevision(task, revisionId)
    if (!revision?.snapshot) return actionResult(`No snapshot available for task revision ${revisionId}.`, { affectedIds: [task.id] })
    restorePlanningSnapshot(task as unknown as Record<string, unknown>, revision.snapshot as Record<string, unknown>)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, `planning.task.restore`, `Restored task ${task.title} from ${revisionId}.`, before, after, Object.keys(revision.snapshot))
    return actionResult(`Restored task ${task.title} from ${revisionId}.`, { affectedIds: [task.id] })
  })
})

on('planning task revision list', async (context) => {
  const state = await loadState(context.runtime)
  const task = taskByIdOrError(context, state, String(context.args['task-id']))
  return listResult(task.revisions.map(revisionEntry), { total: task.revisions.length, summary: entityListSummary('task revision', task.revisions.length) })
})

on('planning task revision get', async (context) => {
  const state = await loadState(context.runtime)
  const task = resolveTask(state, String(context.args['task-id'])) ?? state.planning.tasks.find((entry) => entry.revisions.some((revision) => revision.id === String(context.args['revision-id'])))
  const record = ensureFound(context, task, 'task', String(context.args['task-id']))
  const revision = ensureFound(context, findRevision(record, String(context.args['revision-id'])), 'revision', String(context.args['revision-id']))
  return revisionEntry(revision)
})

on('planning task revision diff', async (context) => {
  const state = await loadState(context.runtime)
  const revisionId = String(context.args['revision-id'])
  const task =
    (context.args['task-id']
      ? resolveTask(state, String(context.args['task-id']))
      : undefined) ??
    state.planning.tasks.find((entry) =>
      entry.revisions.some((revision) => revision.id === revisionId),
    )
  const record = ensureFound(
    context,
    task,
    'task',
    String(context.args['task-id'] ?? revisionId),
  )
  const revision = ensureFound(context, findRevision(record, revisionId), 'revision', revisionId)
  const comparison = context.options.against ? findRevision(record, String(context.options.against)) : undefined
  const left = JSON.stringify(revision.snapshot ?? {})
  const right = JSON.stringify((comparison?.snapshot ?? taskSnapshot(record)) as Record<string, unknown>)
  return createRevisionDiff(left, right, Object.keys(revision.snapshot ?? {}))
})

on('planning task project set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const projectId = String(context.options['project-id'])
    const before = taskSnapshot(task)
    task.projectId = projectId
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.project.set', `Set project for task ${task.title}.`, before, after, ['projectId'])
    return actionResult(`Set project for task ${task.title}.`, { affectedIds: [task.id, projectId] })
  })
})

on('planning task project clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    task.projectId = undefined
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.project.clear', `Cleared project for task ${task.title}.`, before, after, ['projectId'])
    return actionResult(`Cleared project for task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task label add', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const labels = coerceArray(context.options.labels as string[])
    const before = taskSnapshot(task)
    for (const label of labels) if (!task.labelIds.includes(label)) task.labelIds.push(label)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.label.add', `Added labels to task ${task.title}.`, before, after, ['labelIds'])
    return actionResult(`Added labels to task ${task.title}.`, { affectedIds: [task.id, ...labels] })
  })
})

on('planning task label remove', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const labels = coerceArray(context.options.labels as string[])
    const before = taskSnapshot(task)
    task.labelIds = task.labelIds.filter((label) => !labels.includes(label))
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.label.remove', `Removed labels from task ${task.title}.`, before, after, ['labelIds'])
    return actionResult(`Removed labels from task ${task.title}.`, { affectedIds: [task.id, ...labels] })
  })
})

on('planning task label clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    task.labelIds = []
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.label.clear', `Cleared labels for task ${task.title}.`, before, after, ['labelIds'])
    return actionResult(`Cleared labels for task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task note link', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const noteId = String(context.options['note-id'])
    const before = taskSnapshot(task)
    task.noteId = noteId
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.note.link', `Linked note to task ${task.title}.`, before, after, ['noteId'])
    return actionResult(`Linked note to task ${task.title}.`, { affectedIds: [task.id, noteId] })
  })
})

on('planning task note unlink', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const noteId = String(context.options['note-id'])
    const before = taskSnapshot(task)
    if (task.noteId === noteId) task.noteId = undefined
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.note.unlink', `Unlinked note from task ${task.title}.`, before, after, ['noteId'])
    return actionResult(`Unlinked note from task ${task.title}.`, { affectedIds: [task.id, noteId] })
  })
})

on('planning task dependency list', async (context) => {
  const state = await loadState(context.runtime)
  const task = taskByIdOrError(context, state, String(context.args['task-id']))
  return taskDependencies(state, task)
})

on('planning task dependency add', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const blockedBy = coerceArray(context.options['blocked-by'] as string[])
    const before = taskSnapshot(task)
    for (const id of blockedBy) if (!task.blockedBy.includes(id)) task.blockedBy.push(id)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.dependency.add', `Added blocking tasks to ${task.title}.`, before, after, ['blockedBy'])
    return actionResult(`Added blocking tasks to ${task.title}.`, { affectedIds: [task.id, ...blockedBy] })
  })
})

on('planning task dependency remove', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const blockedBy = coerceArray(context.options['blocked-by'] as string[])
    const before = taskSnapshot(task)
    task.blockedBy = task.blockedBy.filter((id) => !blockedBy.includes(id))
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.dependency.remove', `Removed blocking tasks from ${task.title}.`, before, after, ['blockedBy'])
    return actionResult(`Removed blocking tasks from ${task.title}.`, { affectedIds: [task.id, ...blockedBy] })
  })
})

on('planning task dependency clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    task.blockedBy = []
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.dependency.clear', `Cleared task dependencies for ${task.title}.`, before, after, ['blockedBy'])
    return actionResult(`Cleared task dependencies for ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task due set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    taskDueSet(task, context.options as Record<string, unknown>)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.due.set', `Set due window for task ${task.title}.`, before, after, ['dueKind', 'dueFrom', 'dueAt', 'dueTimezone'])
    return actionResult(`Set due window for task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task due clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    task.dueKind = undefined
    task.dueFrom = undefined
    task.dueAt = undefined
    task.dueTimezone = undefined
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.due.clear', `Cleared due window for task ${task.title}.`, before, after, ['dueKind', 'dueFrom', 'dueAt', 'dueTimezone'])
    return actionResult(`Cleared due window for task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task schedule set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    taskScheduleSet(state, task, context.options as Record<string, unknown>)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.schedule.set', `Scheduled task ${task.title}.`, before, after, ['calendarItemIds'])
    return actionResult(`Scheduled task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task schedule clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    taskScheduleClear(state, task, context.options['calendar-item-id'] ? String(context.options['calendar-item-id']) : undefined)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.schedule.clear', `Cleared schedule for task ${task.title}.`, before, after, ['calendarItemIds'])
    return actionResult(`Cleared schedule for task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task recurrence set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    taskRecurrenceSet(task, context.options as Record<string, unknown>)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.recurrence.set', `Set recurrence for task ${task.title}.`, before, after, ['recurrence'])
    return actionResult(`Set recurrence for task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task recurrence clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const before = taskSnapshot(task)
    taskRecurrenceClear(task)
    const after = taskSnapshot(task)
    recordPlanningChange(state, task as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.task.recurrence.clear', `Cleared recurrence for task ${task.title}.`, before, after, ['recurrence'])
    return actionResult(`Cleared recurrence for task ${task.title}.`, { affectedIds: [task.id] })
  })
})

on('planning task recurrence preview', async (context) => {
  const state = await loadState(context.runtime)
  const task = taskByIdOrError(context, state, String(context.args['task-id']))
  const count = context.options.count ? Number(context.options.count) : 10
  return listResult(materializeTaskOccurrences(state, task, count), { total: count, summary: `${count} preview occurrence(s).` })
})

on('planning task recurrence occurrences', async (context) => {
  const state = await loadState(context.runtime)
  const task = taskByIdOrError(context, state, String(context.args['task-id']))
  const occurrences = materializeTaskOccurrences(state, task, context.options.limit ? Number(context.options.limit) : 5)
  return listResult(occurrences, { total: occurrences.length, summary: `${occurrences.length} recurring task occurrence(s).` })
})

on('planning task conflict list', async (context) => {
  const state = await loadState(context.runtime)
  const conflicts = planningTaskConflictList(state)
  return listResult(conflicts.map(syncConflictOutput), { total: conflicts.length, summary: entityListSummary('task conflict', conflicts.length) })
})

on('planning task conflict get', async (context) => {
  const state = await loadState(context.runtime)
  const conflict = ensureFound(context, taskConflictGet(state, String(context.args['conflict-id'])), 'conflict', String(context.args['conflict-id']))
  return syncConflictDetailOutput(conflict)
})

on('planning task conflict resolve', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const conflictId = String(context.args['conflict-id'])
    resolveConflict(state, conflictId, String(context.options.resolution), context.options['candidate-id'] ? String(context.options['candidate-id']) : undefined)
    return actionResult(`Resolved task conflict ${conflictId}.`, { conflictId })
  })
})

on('planning calendar-item list', async (context) => {
  const state = await loadState(context.runtime)
  const items = calendarListByFilters(state, context.options as Record<string, unknown>)
  return planningCalendarOutputs(state, items)
})

on('planning calendar-item get', async (context) => {
  const state = await loadState(context.runtime)
  const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
  return calendarItemOutput(state, item)
})

on('planning calendar-item search', async (context) => {
  const state = await loadState(context.runtime)
  const items = listWithLimit(planningCalendarByQuery(state, String(context.options.query)), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapCalendarList(state, items), { total: items.length, summary: entityListSummary('matching calendar item', items.length) })
})

on('planning calendar-item related', async (context) => {
  const state = await loadState(context.runtime)
  const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
  return planningCalendarRelatedOutput(state, item)
})

on('planning calendar-item create', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = createCalendarItem(state, context.options as Record<string, unknown>)
    return actionResult(mutationSummary('Created calendar item', item), { affectedIds: [item.id] })
  })
})

on('planning calendar-item update', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const before = calendarSnapshot(item)
    applyCalendarUpdate(item, context.options as Record<string, unknown>)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.update', `Updated calendar item ${item.title}.`, before, after, Object.keys(after))
    return actionResult(`Updated calendar item ${item.title}.`, { affectedIds: [item.id] })
  })
})

on('planning calendar-item move', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const before = calendarSnapshot(item)
    applyCalendarUpdate(item, context.options as Record<string, unknown>)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.move', `Moved calendar item ${item.title}.`, before, after, Object.keys(after))
    return actionResult(`Moved calendar item ${item.title}.`, { affectedIds: [item.id] })
  })
})

for (const suffix of ['confirm', 'cancel', 'archive', 'unarchive', 'delete'] as const) {
  on(`planning calendar-item ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
      const before = calendarSnapshot(item)
      if (suffix === 'confirm') item.status = 'confirmed'
      if (suffix === 'cancel') item.status = 'canceled'
      if (suffix === 'archive' || suffix === 'delete') applyCalendarArchive(item, true)
      if (suffix === 'unarchive') applyCalendarArchive(item, false)
      const after = calendarSnapshot(item)
      const verb = capitalize(suffix)
      recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, `planning.calendar-item.${suffix}`, `${verb} calendar item ${item.title}.`, before, after, ['status', 'archived'])
      return actionResult(`${verb} calendar item ${item.title}.`, { affectedIds: [item.id] })
    })
  })
}

on('planning calendar-item history', async (context) => {
  const state = await loadState(context.runtime)
  const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
  return listResult(calendarHistory(item), { total: item.history.length, summary: entityListSummary('calendar-item history entry', item.history.length) })
})

on('planning calendar-item restore', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const revisionId = String(context.args['revision-id'])
    const before = calendarSnapshot(item)
    const revision = findRevision(item, revisionId)
    if (!revision?.snapshot) return actionResult(`No snapshot available for calendar-item revision ${revisionId}.`, { affectedIds: [item.id] })
    restorePlanningSnapshot(item as unknown as Record<string, unknown>, revision.snapshot as Record<string, unknown>)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, `planning.calendar-item.restore`, `Restored calendar item ${item.title} from ${revisionId}.`, before, after, Object.keys(revision.snapshot))
    return actionResult(`Restored calendar item ${item.title} from ${revisionId}.`, { affectedIds: [item.id] })
  })
})

on('planning calendar-item revision list', async (context) => {
  const state = await loadState(context.runtime)
  const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
  return listResult(item.revisions.map(revisionEntry), { total: item.revisions.length, summary: entityListSummary('calendar-item revision', item.revisions.length) })
})

on('planning calendar-item revision get', async (context) => {
  const state = await loadState(context.runtime)
  const revisionId = String(context.args['revision-id'])
  const item =
    (context.args['calendar-item-id']
      ? resolveCalendarItem(state, String(context.args['calendar-item-id']))
      : undefined) ??
    state.planning.calendarItems.find((entry) =>
      entry.revisions.some((revision) => revision.id === revisionId),
    )
  const record = ensureFound(
    context,
    item,
    'calendar-item',
    String(context.args['calendar-item-id'] ?? revisionId),
  )
  const revision = ensureFound(context, findRevision(record, revisionId), 'revision', revisionId)
  return revisionEntry(revision)
})

on('planning calendar-item revision diff', async (context) => {
  const state = await loadState(context.runtime)
  const revisionId = String(context.args['revision-id'])
  const item =
    (context.args['calendar-item-id']
      ? resolveCalendarItem(state, String(context.args['calendar-item-id']))
      : undefined) ??
    state.planning.calendarItems.find((entry) =>
      entry.revisions.some((revision) => revision.id === revisionId),
    )
  const record = ensureFound(
    context,
    item,
    'calendar-item',
    String(context.args['calendar-item-id'] ?? revisionId),
  )
  const revision = ensureFound(context, findRevision(record, revisionId), 'revision', revisionId)
  const comparison = context.options.against ? findRevision(record, String(context.options.against)) : undefined
  const left = JSON.stringify(revision.snapshot ?? {})
  const right = JSON.stringify((comparison?.snapshot ?? calendarSnapshot(record)) as Record<string, unknown>)
  return createRevisionDiff(left, right, Object.keys(revision.snapshot ?? {}))
})

on('planning calendar-item label add', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const labels = coerceArray(context.options.labels as string[])
    const before = calendarSnapshot(item)
    for (const label of labels) if (!item.labelIds.includes(label)) item.labelIds.push(label)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.label.add', `Added labels to calendar item ${item.title}.`, before, after, ['labelIds'])
    return actionResult(`Added labels to calendar item ${item.title}.`, { affectedIds: [item.id, ...labels] })
  })
})

on('planning calendar-item label remove', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const labels = coerceArray(context.options.labels as string[])
    const before = calendarSnapshot(item)
    item.labelIds = item.labelIds.filter((label) => !labels.includes(label))
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.label.remove', `Removed labels from calendar item ${item.title}.`, before, after, ['labelIds'])
    return actionResult(`Removed labels from calendar item ${item.title}.`, { affectedIds: [item.id, ...labels] })
  })
})

on('planning calendar-item label clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const before = calendarSnapshot(item)
    item.labelIds = []
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.label.clear', `Cleared labels for calendar item ${item.title}.`, before, after, ['labelIds'])
    return actionResult(`Cleared labels for calendar item ${item.title}.`, { affectedIds: [item.id] })
  })
})

on('planning calendar-item task link', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const taskId = String(context.options['task-id'])
    const before = calendarSnapshot(item)
    if (!item.taskIds.includes(taskId)) item.taskIds.push(taskId)
    const task = resolveTask(state, taskId)
    if (task && !task.calendarItemIds.includes(item.id)) task.calendarItemIds.push(item.id)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.task.link', `Linked task to calendar item ${item.title}.`, before, after, ['taskIds'])
    return actionResult(`Linked task to calendar item ${item.title}.`, { affectedIds: [item.id, taskId] })
  })
})

on('planning calendar-item task unlink', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const taskId = String(context.options['task-id'])
    const before = calendarSnapshot(item)
    item.taskIds = item.taskIds.filter((id) => id !== taskId)
    const task = resolveTask(state, taskId)
    if (task) task.calendarItemIds = task.calendarItemIds.filter((id) => id !== item.id)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.task.unlink', `Unlinked task from calendar item ${item.title}.`, before, after, ['taskIds'])
    return actionResult(`Unlinked task from calendar item ${item.title}.`, { affectedIds: [item.id, taskId] })
  })
})

on('planning calendar-item recurrence set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const before = calendarSnapshot(item)
    calendarRecurrenceSet(item, context.options as Record<string, unknown>)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.recurrence.set', `Set recurrence for calendar item ${item.title}.`, before, after, ['recurrence'])
    return actionResult(`Set recurrence for calendar item ${item.title}.`, { affectedIds: [item.id] })
  })
})

on('planning calendar-item recurrence clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const before = calendarSnapshot(item)
    calendarRecurrenceClear(item)
    const after = calendarSnapshot(item)
    recordPlanningChange(state, item as unknown as { revisions: NonNullable<TaskRecord['revisions']>; history: TaskRecord['history'] }, 'planning.calendar-item.recurrence.clear', `Cleared recurrence for calendar item ${item.title}.`, before, after, ['recurrence'])
    return actionResult(`Cleared recurrence for calendar item ${item.title}.`, { affectedIds: [item.id] })
  })
})

on('planning calendar-item recurrence preview', async (context) => {
  const state = await loadState(context.runtime)
  const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
  const count = context.options.count ? Number(context.options.count) : 10
  return listResult(materializeCalendarOccurrences(state, item, count), { total: count, summary: `${count} preview occurrence(s).` })
})

on('planning calendar-item recurrence occurrences', async (context) => {
  const state = await loadState(context.runtime)
  const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
  const occurrences = materializeCalendarOccurrences(state, item, context.options.limit ? Number(context.options.limit) : 5)
  return listResult(occurrences, { total: occurrences.length, summary: `${occurrences.length} recurring calendar occurrence(s).` })
})

on('planning calendar-item conflict list', async (context) => {
  const state = await loadState(context.runtime)
  const conflicts = planningCalendarConflictList(state)
  return listResult(conflicts.map(syncConflictOutput), { total: conflicts.length, summary: entityListSummary('calendar-item conflict', conflicts.length) })
})

on('planning calendar-item conflict get', async (context) => {
  const state = await loadState(context.runtime)
  const conflict = ensureFound(context, calendarConflictGet(state, String(context.args['conflict-id'])), 'conflict', String(context.args['conflict-id']))
  return syncConflictDetailOutput(conflict)
})

on('planning calendar-item conflict resolve', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const conflictId = String(context.args['conflict-id'])
    resolveConflict(state, conflictId, String(context.options.resolution), context.options['candidate-id'] ? String(context.options['candidate-id']) : undefined)
    return actionResult(`Resolved calendar-item conflict ${conflictId}.`, { conflictId })
  })
})

on('planning google-calendar status', async (context) => {
  const state = await loadState(context.runtime)
  return googleCalendarBridgeOutput(state)
})

on('planning google-calendar surface list', async (context) => {
  const state = await loadState(context.runtime)
  const surfaces = googleCalendarSurfaceOutputs(state)
  return listResult(surfaces, {
    total: surfaces.length,
    summary: entityListSummary('Google Calendar surface', surfaces.length),
  })
})

on('planning google-calendar surface get', async (context) => {
  const state = await loadState(context.runtime)
  const surface = ensureFound(
    context,
    googleCalendarSurfaceOutputs(state).find(
      (entry) =>
        String((entry as Record<string, unknown>)['calendar-id'] ?? '') ===
          String(context.args['calendar-id']) || entry.id === String(context.args['calendar-id']),
    ),
    'Google Calendar surface',
    String(context.args['calendar-id']),
  )
  return surface
})

on('planning google-calendar surface select', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const calendarId = String(context.args['calendar-id'])
    attachProviderSurface(state, 'google-calendar', calendarId)
    return actionResult(`Selected Google Calendar surface ${calendarId}.`, {
      affectedIds: [calendarId],
    })
  })
})

on('planning google-calendar surface deselect', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const calendarId = String(context.args['calendar-id'])
    const forceDetach = Boolean(context.options['force-detach'])
    const linkedItems = state.planning.calendarItems.filter((item) =>
      item.externalLinks.some(
        (link) => link.provider === 'google-calendar' && link.calendarId === calendarId,
      ),
    )
    if (linkedItems.length > 0 && !forceDetach) {
      throw context.error({
        code: 'INVALID_INPUT',
        message: `Google Calendar surface ${calendarId} still has attached Origin items.`,
      })
    }
    for (const item of linkedItems) {
      const link = googleLinkForCalendarItem(item)
      if (link) addCalendarExternalLink(item, detachLinkStatus(link))
    }
    const integration = ensureIntegration(state, 'google-calendar')
    const surface = providerSurfaceByRef(integration.provider.surfaces, calendarId)
    if (surface) {
      surface.selected = false
      surface.status = 'inactive'
      surface.summary = `${calendarId} not selected for sync.`
    }
    rebuildProviderLastRefreshed(integration)
    return actionResult(`Deselected Google Calendar surface ${calendarId}.`, {
      affectedIds: [calendarId, ...linkedItems.map((item) => item.id)],
    })
  })
})

for (const suffix of ['pull', 'push', 'reconcile'] as const) {
  on(`planning google-calendar ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      planningBridgeAction(state, 'google-calendar', suffix, context.options['calendar-id'] ? String(context.options['calendar-id']) : undefined)
      return actionResult(`${capitalize(suffix)} Google Calendar bridge state.`, { affectedIds: ['google-calendar'] })
    })
  })
}

on('planning google-calendar attach', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const calendarId = String(context.options['calendar-id'])
    const link = applyCalendarExternalLinkMutation(item, 'google-calendar', {
      ref: context.options['google-event-id'] ? `${calendarId}/${String(context.options['google-event-id'])}` : `${calendarId}/${item.id}`,
      syncMode: String(context.options.mode) as ExternalLinkRecord['syncMode'],
      lifecycleStatus: 'linked',
      calendarId,
      googleEventId: context.options['google-event-id'] ? String(context.options['google-event-id']) : undefined,
      lastPulledAt: now(),
      lastPushedAt: now(),
      lastExternalHash: stableHash(`${item.title}:${calendarId}`),
    })
    attachProviderSurface(state, 'google-calendar', calendarId)
    return actionResult(`Attached calendar item ${item.title} to Google Calendar.`, { affectedIds: [item.id], providerRefs: [link.ref] })
  })
})

on('planning google-calendar detach', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const item = calendarByIdOrError(context, state, String(context.args['calendar-item-id']))
    const link = googleLinkForCalendarItem(item)
    if (link) addCalendarExternalLink(item, detachLinkStatus(link))
    return actionResult(`Detached calendar item ${item.title} from Google Calendar.`, { affectedIds: [item.id] })
  })
})

on('planning google-calendar reset-cursor', async (context) => {
  return mutateState(context.runtime, async (state) => {
    planningBridgeResetCursor(state, 'google-calendar', context.options['calendar-id'] ? String(context.options['calendar-id']) : undefined)
    return actionResult('Reset Google Calendar cursors.', { affectedIds: ['google-calendar'] })
  })
})

on('planning google-calendar repair', async (context) => {
  return mutateState(context.runtime, async (state) => {
    planningBridgeRepair(state, 'google-calendar', context.options['calendar-id'] ? String(context.options['calendar-id']) : undefined)
    return actionResult('Repaired Google Calendar bridge state.', { affectedIds: ['google-calendar'] })
  })
})

on('planning google-tasks status', async (context) => {
  const state = await loadState(context.runtime)
  return googleTasksBridgeOutput(state)
})

on('planning google-tasks surface list', async (context) => {
  const state = await loadState(context.runtime)
  const surfaces = googleTasksSurfaceOutputs(state)
  return listResult(surfaces, {
    total: surfaces.length,
    summary: entityListSummary('Google Tasks surface', surfaces.length),
  })
})

on('planning google-tasks surface get', async (context) => {
  const state = await loadState(context.runtime)
  const surface = ensureFound(
    context,
    googleTasksSurfaceOutputs(state).find(
      (entry) =>
        String((entry as Record<string, unknown>)['task-list-id'] ?? '') ===
          String(context.args['task-list-id']) || entry.id === String(context.args['task-list-id']),
    ),
    'Google Tasks surface',
    String(context.args['task-list-id']),
  )
  return surface
})

on('planning google-tasks surface select', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const taskListId = String(context.args['task-list-id'])
    attachProviderSurface(state, 'google-tasks', taskListId)
    return actionResult(`Selected Google Tasks surface ${taskListId}.`, {
      affectedIds: [taskListId],
    })
  })
})

on('planning google-tasks surface deselect', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const taskListId = String(context.args['task-list-id'])
    const forceDetach = Boolean(context.options['force-detach'])
    const linkedTasks = state.planning.tasks.filter((task) =>
      task.externalLinks.some(
        (link) => link.provider === 'google-tasks' && link.taskListId === taskListId,
      ),
    )
    if (linkedTasks.length > 0 && !forceDetach) {
      throw context.error({
        code: 'INVALID_INPUT',
        message: `Google Tasks surface ${taskListId} still has attached Origin tasks.`,
      })
    }
    for (const task of linkedTasks) {
      const link = googleLinkForTask(task)
      if (link) addTaskExternalLink(task, detachLinkStatus(link))
    }
    const integration = ensureIntegration(state, 'google-tasks')
    const surface = providerSurfaceByRef(integration.provider.surfaces, taskListId)
    if (surface) {
      surface.selected = false
      surface.status = 'inactive'
      surface.summary = `${taskListId} not selected for sync.`
    }
    rebuildProviderLastRefreshed(integration)
    return actionResult(`Deselected Google Tasks surface ${taskListId}.`, {
      affectedIds: [taskListId, ...linkedTasks.map((task) => task.id)],
    })
  })
})

for (const suffix of ['pull', 'push', 'reconcile'] as const) {
  on(`planning google-tasks ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      planningBridgeAction(state, 'google-tasks', suffix, context.options['task-list-id'] ? String(context.options['task-list-id']) : undefined)
      return actionResult(`${capitalize(suffix)} Google Tasks bridge state.`, { affectedIds: ['google-tasks'] })
    })
  })
}

on('planning google-tasks attach', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const taskListId = String(context.options['task-list-id'])
    const link = applyTaskExternalLinkMutation(task, 'google-tasks', {
      ref: context.options['google-task-id'] ? `${taskListId}/${String(context.options['google-task-id'])}` : `${taskListId}/${task.id}`,
      syncMode: String(context.options.mode) as ExternalLinkRecord['syncMode'],
      lifecycleStatus: 'linked',
      taskListId,
      googleTaskId: context.options['google-task-id'] ? String(context.options['google-task-id']) : undefined,
      lastPulledAt: now(),
      lastPushedAt: now(),
      lastExternalHash: stableHash(`${task.title}:${taskListId}`),
    })
    attachProviderSurface(state, 'google-tasks', taskListId)
    return actionResult(`Attached task ${task.title} to Google Tasks.`, { affectedIds: [task.id], providerRefs: [link.ref] })
  })
})

on('planning google-tasks detach', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const task = taskByIdOrError(context, state, String(context.args['task-id']))
    const link = googleLinkForTask(task)
    if (link) addTaskExternalLink(task, detachLinkStatus(link))
    return actionResult(`Detached task ${task.title} from Google Tasks.`, { affectedIds: [task.id] })
  })
})

on('planning google-tasks reset-cursor', async (context) => {
  return mutateState(context.runtime, async (state) => {
    planningBridgeResetCursor(state, 'google-tasks', context.options['task-list-id'] ? String(context.options['task-list-id']) : undefined)
    return actionResult('Reset Google Tasks cursors.', { affectedIds: ['google-tasks'] })
  })
})

on('planning google-tasks repair', async (context) => {
  return mutateState(context.runtime, async (state) => {
    planningBridgeRepair(state, 'google-tasks', context.options['task-list-id'] ? String(context.options['task-list-id']) : undefined)
    return actionResult('Repaired Google Tasks bridge state.', { affectedIds: ['google-tasks'] })
  })
})

// Email
on('email account list', async (context) => {
  const state = await loadState(context.runtime)
  return listResult(state.email.accounts.map(emailAccountOutput), { total: state.email.accounts.length, summary: entityListSummary('email account', state.email.accounts.length) })
})

on('email account get', async (context) => {
  const state = await loadState(context.runtime)
  const account = ensureFound(context, state.email.accounts.find((item) => item.id === String(context.args['account-id'])), 'email account', String(context.args['account-id']))
  return emailAccountOutput(account)
})

on('email account status', async (context) => {
  const state = await loadState(context.runtime)
  return emailAccountOutput(state.email.accounts[0] ?? { id: 'mail_acc_0000', address: 'unknown', status: 'missing', summary: 'No email account configured.', labels: [], aliases: [] })
})

on('email account validate', async (context) => {
  const state = await loadState(context.runtime)
  return validateEmailAccount(state)
})

on('email account labels', async (context) => {
  const state = await loadState(context.runtime)
  return { labels: [...new Set(emailAccountLabels(state))] }
})

on('email account aliases', async (context) => {
  const state = await loadState(context.runtime)
  return { aliases: [...new Set(emailAccountAliases(state))] }
})

on('email thread list', async (context) => {
  const state = await loadState(context.runtime)
  let threads = state.email.threads
  if (context.options.query) threads = threads.filter((thread) => emailThreadMatch(thread, String(context.options.query), state))
  if (context.options.label?.length) threads = threads.filter((thread) => coerceArray(context.options.label as string[]).some((label) => thread.labelIds.includes(label)))
  if (context.options['triage-state']?.length) {
    threads = threads.filter(
      (thread) =>
        thread.triage &&
        coerceArray(context.options['triage-state'] as string[]).includes(
          normalizeEmailTriageState(thread.triage.state) ?? '',
        ),
    )
  }
  threads = listWithLimit(genericSortByLatest(threads), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapEmailThreads(state, threads), { total: threads.length, summary: entityListSummary('email thread', threads.length) })
})

on('email thread get', async (context) => {
  const state = await loadState(context.runtime)
  const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
  return emailThreadOutput(state, thread, true)
})

on('email thread context', async (context) => {
  const state = await loadState(context.runtime)
  const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
  return emailThreadContextOutput(state, thread)
})

on('email thread search', async (context) => {
  const state = await loadState(context.runtime)
  const query = String(context.options.query)
  const threads = listWithLimit(emailThreadsByQuery(state, query), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapEmailThreads(state, threads), { total: threads.length, summary: entityListSummary('matching thread', threads.length) })
})

on('email thread recent', async (context) => {
  const state = await loadState(context.runtime)
  const threads = listWithLimit(genericSortByLatest(state.email.threads), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapEmailThreads(state, threads), { total: threads.length, summary: entityListSummary('recent thread', threads.length) })
})

on('email thread unread', async (context) => {
  const state = await loadState(context.runtime)
  const threads = listWithLimit(state.email.threads.filter((thread) => thread.unread), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapEmailThreads(state, threads), { total: threads.length, summary: entityListSummary('unread thread', threads.length) })
})

on('email thread triage-needed', async (context) => {
  const state = await loadState(context.runtime)
  const threads = listWithLimit(
    state.email.threads.filter(
      (thread) => normalizeEmailTriageState(thread.triage?.state) === 'needs_reply' || thread.unread,
    ),
    context.options.limit ? Number(context.options.limit) : undefined,
  )
  return listResult(mapEmailThreads(state, threads), { total: threads.length, summary: entityListSummary('triage-needed thread', threads.length) })
})

for (const suffix of ['archive', 'unarchive', 'read', 'unread-mark', 'star', 'unstar', 'spam', 'unspam', 'trash', 'restore'] as const) {
  on(`email thread ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
      const before = compact({ ...thread })
      if (suffix === 'archive') thread.archived = true
      if (suffix === 'unarchive') thread.archived = false
      if (suffix === 'read') thread.unread = false
      if (suffix === 'unread-mark') thread.unread = true
      if (suffix === 'star') thread.starred = true
      if (suffix === 'unstar') thread.starred = false
      if (suffix === 'spam') thread.spam = true
      if (suffix === 'unspam') thread.spam = false
      if (suffix === 'trash') thread.trashed = true
      if (suffix === 'restore') thread.trashed = false
      const verb = capitalize(suffix)
      addActivity(state, mutationActivity(`email.thread.${suffix}`, thread.id, `${verb} thread ${thread.subject}.`))
      return actionResult(`${verb} thread ${thread.subject}.`, { affectedIds: [thread.id] })
    })
  })
}

on('email thread refresh', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    emailThreadRefresh(state, thread)
    return actionResult(`Refreshed thread ${thread.subject}.`, { affectedIds: [thread.id] })
  })
})

on('email thread label add', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    updateThreadLabelIds(thread, coerceArray(context.options.labels as string[]), 'add')
    addActivity(state, mutationActivity('email.thread.label.add', thread.id, `Added labels to ${thread.subject}.`))
    return actionResult(`Added labels to ${thread.subject}.`, { affectedIds: [thread.id, ...coerceArray(context.options.labels as string[])] })
  })
})

on('email thread label remove', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    updateThreadLabelIds(thread, coerceArray(context.options.labels as string[]), 'remove')
    addActivity(state, mutationActivity('email.thread.label.remove', thread.id, `Removed labels from ${thread.subject}.`))
    return actionResult(`Removed labels from ${thread.subject}.`, { affectedIds: [thread.id, ...coerceArray(context.options.labels as string[])] })
  })
})

on('email message list', async (context) => {
  const state = await loadState(context.runtime)
  const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
  const messages = mapEmailMessages(thread.messageIds.map((id) => resolveMessage(state, id)).filter(Boolean) as EmailMessageRecord[])
  return listResult(messages, { total: messages.length, summary: entityListSummary('email message', messages.length) })
})

on('email message get', async (context) => {
  const state = await loadState(context.runtime)
  return emailMessageOutput(emailMessageByIdOrError(context, state, String(context.args['message-id'])))
})

on('email message body', async (context) => {
  const state = await loadState(context.runtime)
  const message = emailMessageByIdOrError(context, state, String(context.args['message-id']))
  return { body: message.body ?? '' }
})

on('email message headers', async (context) => {
  const state = await loadState(context.runtime)
  const message = emailMessageByIdOrError(context, state, String(context.args['message-id']))
  return { headers: message.headers ?? {} }
})

on('email message raw', async (context) => {
  const state = await loadState(context.runtime)
  const message = emailMessageByIdOrError(context, state, String(context.args['message-id']))
  return { raw: message.raw ?? '' }
})

on('email message attachments', async (context) => {
  const state = await loadState(context.runtime)
  const message = emailMessageByIdOrError(context, state, String(context.args['message-id']))
  const attachments = message.attachments.map(emailAttachmentOutput)
  return listResult(attachments, { total: attachments.length, summary: entityListSummary('email attachment', attachments.length) })
})

on('email message forward', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const message = emailMessageByIdOrError(context, state, String(context.args['message-id']))
    addOutboxItem(state, 'email', 'email-forward', `Forward ${message.subject}.`, { 'message-id': message.id, to: coerceArray(context.options.to as string[]), body: context.options.body ? String(context.options.body) : undefined })
    return actionResult(`Queued forwarding for ${message.subject}.`, { affectedIds: [message.id] })
  })
})

on('email message attachment get', async (context) => {
  const state = await loadState(context.runtime)
  const attachment = ensureFound(context, state.email.messages.flatMap((message) => message.attachments).find((item) => item.id === String(context.args['attachment-id'])), 'attachment', String(context.args['attachment-id']))
  return emailAttachmentOutput(attachment)
})

on('email message attachment download', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const attachment = ensureFound(context, state.email.messages.flatMap((message) => message.attachments).find((item) => item.id === String(context.args['attachment-id'])), 'attachment', String(context.args['attachment-id']))
    attachment.cachedPath = context.options.to ? String(context.options.to) : join(context.runtime.paths.blobsDir, attachment.id)
    return actionResult(`Downloaded attachment ${attachment.name}.`, { affectedIds: [attachment.id] })
  })
})

on('email draft list', async (context) => {
  const state = await loadState(context.runtime)
  const drafts = state.email.drafts
  return listResult(mapEmailDrafts(drafts), { total: drafts.length, summary: entityListSummary('email draft', drafts.length) })
})

on('email draft get', async (context) => {
  const state = await loadState(context.runtime)
  return emailDraftOutput(emailDraftByIdOrError(context, state, String(context.args['draft-id'])))
})

on('email draft create', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const draft: EmailDraftRecord = {
      id: nextId(state, 'draft'),
      subject: String(context.options.subject),
      to: coerceArray(context.options.to as string[]),
      body: String(context.options.body),
      threadId: context.options['thread-id'] ? String(context.options['thread-id']) : undefined,
    }
    state.email.drafts.push(draft)
    return actionResult(`Created draft ${draft.subject}.`, { affectedIds: [draft.id] })
  })
})

on('email draft update', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const draft = emailDraftByIdOrError(context, state, String(context.args['draft-id']))
    if (context.options.to) draft.to = coerceArray(context.options.to as string[])
    if (context.options.subject !== undefined) draft.subject = String(context.options.subject)
    if (context.options.body !== undefined) draft.body = String(context.options.body)
    return actionResult(`Updated draft ${draft.subject}.`, { affectedIds: [draft.id] })
  })
})

on('email draft send', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const draft = emailDraftByIdOrError(context, state, String(context.args['draft-id']))
    addOutboxItem(state, 'email', 'email-send', `Send draft ${draft.subject}.`, { 'draft-id': draft.id, to: draft.to, body: draft.body })
    return actionResult(`Queued draft ${draft.subject} for send.`, { affectedIds: [draft.id] })
  })
})

on('email draft delete', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const index = state.email.drafts.findIndex((draft) => draft.id === String(context.args['draft-id']))
    if (index >= 0) state.email.drafts.splice(index, 1)
    return actionResult(`Deleted draft ${String(context.args['draft-id'])}.`, { affectedIds: [String(context.args['draft-id'])] })
  })
})

on('email send', async (context) => {
  return mutateState(context.runtime, async (state) => {
    addOutboxItem(state, 'email', 'email-send', `Send email to ${coerceArray(context.options.to as string[]).join(', ')}.`, { to: coerceArray(context.options.to as string[]), subject: String(context.options.subject), body: String(context.options.body) })
    return actionResult(`Queued email to ${coerceArray(context.options.to as string[]).join(', ')}.`, { providerRefs: coerceArray(context.options.to as string[]) })
  })
})

on('email reply', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    addOutboxItem(state, 'email', 'email-reply', `Reply to ${thread.subject}.`, { 'thread-id': thread.id, body: String(context.options.body), 'reply-all': Boolean(context.options['reply-all']) })
    return actionResult(`Queued reply for ${thread.subject}.`, { affectedIds: [thread.id] })
  })
})

on('email reply-all', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    addOutboxItem(state, 'email', 'email-reply-all', `Reply-all to ${thread.subject}.`, { 'thread-id': thread.id, body: String(context.options.body), 'reply-all': true })
    return actionResult(`Queued reply-all for ${thread.subject}.`, { affectedIds: [thread.id] })
  })
})

on('email triage list', async (context) => {
  const state = await loadState(context.runtime)
  const states = coerceArray(context.options.state as string[] | string | undefined)
  let triages = emailThreadTriages(state)
  if (states.length > 0) {
    triages = triages.filter((triage) => states.includes(String(triage.state)))
  }
  triages = listWithLimit(triages, context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(triages, { total: triages.length, summary: entityListSummary('email triage record', triages.length) })
})

on('email triage get', async (context) => {
  const state = await loadState(context.runtime)
  const triage = emailThreadTriageById(state, String(context.args['thread-id']))
  return ensureFound(context, triage, 'triage', String(context.args['thread-id']))
})

on('email triage set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    setThreadTriage(state, thread, context.options as Record<string, unknown>)
    return actionResult(`Updated triage for ${thread.subject}.`, { affectedIds: [thread.id] })
  })
})

on('email triage clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    clearThreadTriage(thread)
    return actionResult(`Cleared triage for ${thread.subject}.`, { affectedIds: [thread.id] })
  })
})

on('email triage-note set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    thread.triage ??= { threadId: thread.id, state: 'needs_reply' }
    thread.triage.note = String(context.options.body)
    return actionResult(`Updated triage note for ${thread.subject}.`, { affectedIds: [thread.id] })
  })
})

on('email follow-up set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    thread.triage ??= { threadId: thread.id, state: 'needs_reply' }
    thread.triage.followUpAt = String(context.options.at)
    return actionResult(`Set follow-up for ${thread.subject}.`, { affectedIds: [thread.id] })
  })
})

on('email task link', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    const taskId = String(context.options['task-id'])
    if (!thread.linkedTaskIds.includes(taskId)) thread.linkedTaskIds.push(taskId)
    thread.triage ??= { threadId: thread.id, state: 'needs_reply' }
    thread.triage.linkedTaskId = taskId
    return actionResult(`Linked ${thread.subject} to task ${taskId}.`, { affectedIds: [thread.id, taskId] })
  })
})

on('email task unlink', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
    const taskId = String(context.options['task-id'])
    thread.linkedTaskIds = thread.linkedTaskIds.filter((id) => id !== taskId)
    if (thread.triage?.linkedTaskId === taskId) thread.triage.linkedTaskId = undefined
    return actionResult(`Unlinked ${thread.subject} from task ${taskId}.`, { affectedIds: [thread.id, taskId] })
  })
})

on('email next', async (context) => {
  const state = await loadState(context.runtime)
  const threads = emailNextThreads(state).map((thread) => emailThreadContextOutput(state, thread))
  return listResult(threads, { total: threads.length, summary: entityListSummary('email triage target', threads.length) })
})

on('email cache status', async (context) => {
  const state = await loadState(context.runtime)
  return emailCacheOutput(state)
})

on('email cache warm', async (context) => {
  return mutateState(context.runtime, async (state) => {
    rebuildProviderLastRefreshed(ensureIntegration(state, 'email'))
    return actionResult('Warmed email cache.', { affectedIds: ['email'] })
  })
})

on('email cache hydrate', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const threadIds = coerceArray(context.options['thread-id'] as string[])
    for (const threadId of threadIds) {
      const thread = resolveThread(state, threadId)
      if (thread) thread.freshness = 'fresh'
    }
    rebuildProviderLastRefreshed(ensureIntegration(state, 'email'))
    return actionResult('Hydrated email cache.', { affectedIds: threadIds.length ? threadIds : ['email'] })
  })
})

for (const suffix of ['pin', 'unpin'] as const) {
  on(`email cache ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const thread = emailThreadByIdOrError(context, state, String(context.args['thread-id']))
      thread.pinned = suffix === 'pin'
      const verb = suffix === 'pin' ? 'Pinned' : 'Unpinned'
      return actionResult(`${verb} email cache item ${thread.subject}.`, { affectedIds: [thread.id] })
    })
  })
}

on('email cache evict', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const threadId = context.options['thread-id'] ? String(context.options['thread-id']) : undefined
    if (threadId) {
      const thread = resolveThread(state, threadId)
      if (thread) thread.freshness = 'cold'
    } else {
      for (const thread of state.email.threads) thread.freshness = 'cold'
    }
    return actionResult('Evicted email cache state.', { affectedIds: threadId ? [threadId] : ['email'] })
  })
})

on('email refresh status', async (context) => {
  const state = await loadState(context.runtime)
  return emailCacheOutput(state)
})

on('email refresh run', async (context) => {
  return mutateState(context.runtime, async (state) => {
    rebuildProviderLastRefreshed(ensureIntegration(state, 'email'))
    return actionResult('Ran email refresh.', { affectedIds: ['email'] })
  })
})

on('email refresh reset-cursor', async (context) => {
  return mutateState(context.runtime, async (state) => {
    emailRefreshReset(state, context.options['account-id'] ? String(context.options['account-id']) : undefined)
    return actionResult('Reset email refresh cursors.', { affectedIds: ['email'] })
  })
})

on('email refresh repair', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const integration = ensureIntegration(state, 'email')
    emailRefreshReset(
      state,
      context.options['account-id'] ? String(context.options['account-id']) : undefined,
    )
    modifyProviderPollers(integration, (poller) => {
      if (
        context.options['account-id'] &&
        !poller.scope.includes(String(context.options['account-id']))
      ) {
        return
      }
      poller.status = 'active'
      poller.lastError = undefined
      poller.lastFailedAt = undefined
      poller.backoffUntil = undefined
      poller.lastSucceededAt = now()
    })
    rebuildProviderLastRefreshed(integration)
    return actionResult('Repaired email refresh state.', { affectedIds: ['email'] })
  })
})

on('email outbox list', async (context) => {
  const state = await loadState(context.runtime)
  const items = state.email.outbox.map((item) => compact(item))
  return listResult(items, { total: items.length, summary: entityListSummary('email outbox item', items.length) })
})

on('email outbox get', async (context) => {
  const state = await loadState(context.runtime)
  return ensureFound(context, state.email.outbox.find((item) => item.id === String(context.args['outbox-id'])), 'outbox item', String(context.args['outbox-id']))
})

for (const suffix of ['retry', 'cancel', 'resolve'] as const) {
  on(`email outbox ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const item = ensureFound(context, state.email.outbox.find((outbox) => outbox.id === String(context.args['outbox-id'])), 'outbox item', String(context.args['outbox-id']))
      item.status = suffix === 'retry' ? 'queued' : suffix === 'cancel' ? 'canceled' : 'resolved'
      return actionResult(`${capitalize(suffix)} email outbox item ${item.id}.`, { affectedIds: [item.id] })
    })
  })
}

// GitHub
on('github account status', async (context) => {
  const state = await loadState(context.runtime)
  return integrationStatusOutput('github', ensureIntegration(state, 'github'))
})

on('github account validate', async (context) => {
  const state = await loadState(context.runtime)
  return githubAccountValidate(state)
})

on('github account permissions', async (context) => {
  const state = await loadState(context.runtime)
  return githubIntegrationScopes(state)
})

on('github account grant list', async (context) => {
  const state = await loadState(context.runtime)
  const grants = githubGrantOutputs(state)
  return listResult(grants, {
    total: grants.length,
    summary: entityListSummary('GitHub installation grant', grants.length),
  })
})

on('github account grant get', async (context) => {
  const state = await loadState(context.runtime)
  return ensureFound(
    context,
    githubGrantById(state, String(context.args['grant-id'])),
    'GitHub installation grant',
    String(context.args['grant-id']),
  )
})

on('github account grant refresh', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const integration = ensureIntegration(state, 'github')
    integration.status.lastValidatedAt = now()
    rebuildProviderLastRefreshed(integration)
    return actionResult('Refreshed GitHub installation grants.', { affectedIds: ['github'] })
  })
})

on('github account grant select', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const grantId = String(context.args['grant-id'])
    ensureFound(context, githubGrantById(state, grantId), 'GitHub installation grant', grantId)
    const integration = ensureIntegration(state, 'github')
    updateGithubGrantSelection(
      integration,
      grantId,
      coerceArray(context.options.repo as string[] | string | undefined),
      true,
    )
    rebuildProviderLastRefreshed(integration)
    return actionResult(`Selected GitHub installation grant ${grantId}.`, {
      affectedIds: [grantId],
    })
  })
})

on('github account grant deselect', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const grantId = String(context.args['grant-id'])
    ensureFound(context, githubGrantById(state, grantId), 'GitHub installation grant', grantId)
    const integration = ensureIntegration(state, 'github')
    updateGithubGrantSelection(integration, grantId, undefined, false)
    rebuildProviderLastRefreshed(integration)
    return actionResult(`Deselected GitHub installation grant ${grantId}.`, {
      affectedIds: [grantId],
    })
  })
})

on('github repo list', async (context) => {
  const state = await loadState(context.runtime)
  const repos = githubRepoList(state, context.options as Record<string, unknown>)
  return listResult(mapGithubRepos(listWithLimit(repos, context.options.limit ? Number(context.options.limit) : undefined)), { total: repos.length, summary: entityListSummary('GitHub repository', repos.length) })
})

on('github repo get', async (context) => {
  const state = await loadState(context.runtime)
  return githubRepositoryOutput(githubRepoByIdOrError(context, state, String(context.args['repo-id-or-name'])))
})

on('github repo search', async (context) => {
  const state = await loadState(context.runtime)
  const repos = listWithLimit(githubRepoSearch(state, String(context.options.query)), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapGithubRepos(repos), { total: repos.length, summary: entityListSummary('matching repository', repos.length) })
})

on('github repo context', async (context) => {
  const state = await loadState(context.runtime)
  return githubRepoContext(state, githubRepoByIdOrError(context, state, String(context.args['repo-id-or-name'])))
})

for (const suffix of ['follow', 'unfollow', 'pin', 'unpin', 'star', 'unstar'] as const) {
  on(`github repo ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const repo = githubRepoByIdOrError(context, state, String(context.args['repo-id-or-name']))
      if (suffix === 'follow') repo.followed = true
      if (suffix === 'unfollow') repo.followed = false
      if (suffix === 'pin') repo.pinned = true
      if (suffix === 'unpin') repo.pinned = false
      if (suffix === 'star') repo.starred = true
      if (suffix === 'unstar') repo.starred = false
      if (suffix === 'follow') {
        const existing = state.github.follows.find((follow) => follow.repo === repo.name && follow.kind === 'repo')
        if (existing) {
          existing.reason = String(context.options.reason ?? existing.reason ?? 'Followed repository.')
          existing.dismissed = false
        } else {
          state.github.follows.push({ id: nextId(state, 'gh_follow'), kind: 'repo', repo: repo.name, reason: context.options.reason ? String(context.options.reason) : undefined, linkedTaskIds: [], linkedNoteIds: [], targetRef: repo.name })
        }
      }
      if (suffix === 'unfollow') {
        const follow = state.github.follows.find((item) => item.repo === repo.name && item.kind === 'repo')
        if (follow) follow.dismissed = true
      }
      return actionResult(`${capitalize(suffix)} repository ${repo.name}.`, { affectedIds: [repo.id] })
    })
  })
}

on('github follow list', async (context) => {
  const state = await loadState(context.runtime)
  const follows = githubFollowList(state, context.options as Record<string, unknown>)
  return listResult(follows.map(githubFollowTargetOutput), { total: follows.length, summary: entityListSummary('GitHub follow target', follows.length) })
})

on('github follow get', async (context) => {
  const state = await loadState(context.runtime)
  return githubFollowTargetOutput(githubFollowByIdOrError(context, state, String(context.args['follow-id'])))
})

on('github follow set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const repo = String(context.options.repo)
    const kind = String(context.options.kind)
    const targetRef = context.options['target-ref'] ? String(context.options['target-ref']) : undefined
    const reason = context.options.reason ? String(context.options.reason) : undefined
    const existing = state.github.follows.find((follow) => follow.repo === repo && follow.kind === kind && follow.targetRef === targetRef)
    if (existing) {
      existing.reason = reason ?? existing.reason
      existing.dismissed = false
    } else {
      state.github.follows.push({ id: nextId(state, 'gh_follow'), kind, repo, targetRef, reason, linkedTaskIds: [], linkedNoteIds: [] })
    }
    return actionResult(`Updated follow target for ${repo}.`, { affectedIds: [repo] })
  })
})

on('github follow clear', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const id = String(context.args['follow-id'])
    const index = state.github.follows.findIndex((follow) => follow.id === id)
    if (index >= 0) state.github.follows.splice(index, 1)
    return actionResult(`Cleared follow target ${id}.`, { affectedIds: [id] })
  })
})

on('github follow dismiss', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const follow = githubFollowByIdOrError(context, state, String(context.args['follow-id']))
    follow.dismissed = true
    return actionResult(`Dismissed follow target ${follow.id}.`, { affectedIds: [follow.id] })
  })
})

on('github follow next', async (context) => {
  const state = await loadState(context.runtime)
  const follows = githubFollowNext(state).map(githubFollowTargetOutput)
  return listResult(follows, { total: follows.length, summary: entityListSummary('GitHub follow target', follows.length) })
})

on('github follow task link', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const follow = githubFollowByIdOrError(context, state, String(context.args['follow-id']))
    const taskId = String(context.options['task-id'])
    if (!follow.linkedTaskIds.includes(taskId)) follow.linkedTaskIds.push(taskId)
    return actionResult(`Linked follow target ${follow.id} to task ${taskId}.`, { affectedIds: [follow.id, taskId] })
  })
})

on('github follow task unlink', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const follow = githubFollowByIdOrError(context, state, String(context.args['follow-id']))
    const taskId = String(context.options['task-id'])
    follow.linkedTaskIds = follow.linkedTaskIds.filter((id) => id !== taskId)
    return actionResult(`Unlinked follow target ${follow.id} from task ${taskId}.`, { affectedIds: [follow.id, taskId] })
  })
})

on('github follow note link', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const follow = githubFollowByIdOrError(context, state, String(context.args['follow-id']))
    const noteId = String(context.options['note-id'])
    if (!follow.linkedNoteIds.includes(noteId)) follow.linkedNoteIds.push(noteId)
    return actionResult(`Linked follow target ${follow.id} to note ${noteId}.`, { affectedIds: [follow.id, noteId] })
  })
})

on('github follow note unlink', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const follow = githubFollowByIdOrError(context, state, String(context.args['follow-id']))
    const noteId = String(context.options['note-id'])
    follow.linkedNoteIds = follow.linkedNoteIds.filter((id) => id !== noteId)
    return actionResult(`Unlinked follow target ${follow.id} from note ${noteId}.`, { affectedIds: [follow.id, noteId] })
  })
})

on('github issue list', async (context) => {
  const state = await loadState(context.runtime)
  const issues = githubIssueList(state, context.options as Record<string, unknown>)
  return listResult(mapGithubIssues(listWithLimit(issues, context.options.limit ? Number(context.options.limit) : undefined)), { total: issues.length, summary: entityListSummary('GitHub issue', issues.length) })
})

on('github issue get', async (context) => {
  const state = await loadState(context.runtime)
  return githubIssueOutput(githubIssueByIdOrError(context, state, String(context.args['issue-ref'])))
})

on('github issue context', async (context) => {
  const state = await loadState(context.runtime)
  return githubIssueContextOutput(state, githubIssueByIdOrError(context, state, String(context.args['issue-ref'])))
})

on('github issue timeline', async (context) => {
  const state = await loadState(context.runtime)
  const issue = githubIssueByIdOrError(context, state, String(context.args['issue-ref']))
  return listResult(githubIssueActivity(state, issue), { total: githubIssueActivity(state, issue).length, summary: entityListSummary('issue timeline event', githubIssueActivity(state, issue).length) })
})

on('github issue comments', async (context) => {
  const state = await loadState(context.runtime)
  const issue = githubIssueByIdOrError(context, state, String(context.args['issue-ref']))
  const comments = issueComments(state, issue).map(githubCommentOutput)
  return listResult(comments, { total: comments.length, summary: entityListSummary('issue comment', comments.length) })
})

on('github issue create', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const repo = String(context.options.repo)
    const issue: GithubIssueRecord = {
      id: nextId(state, 'gh_issue'),
      ref: `${repo}#${state.github.issues.length + 1}`,
      title: String(context.options.title),
      state: 'open',
      summary: context.options.body ? String(context.options.body) : String(context.options.title),
      labels: coerceArray(context.options.labels as string[]),
      assignees: [],
      commentIds: [],
    }
    state.github.issues.push(issue)
    ensureGithubRepo(state, repo)
    return actionResult(`Created issue ${issue.ref}.`, { affectedIds: [issue.id] })
  })
})

on('github issue update', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const issue = githubIssueByIdOrError(context, state, String(context.args['issue-ref']))
    if (context.options.title !== undefined) issue.title = String(context.options.title)
    if (context.options.body !== undefined) issue.summary = String(context.options.body)
    if (context.options.labels !== undefined) issue.labels = coerceArray(context.options.labels as string[])
    return actionResult(`Updated issue ${issue.ref}.`, { affectedIds: [issue.id] })
  })
})

on('github issue comment', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const issue = githubIssueByIdOrError(context, state, String(context.args['issue-ref']))
    const comment = ensureGithubComment(state, String(context.options.body))
    issue.commentIds.push(comment.id)
    addActivity(state, commentActivitySummary(issue.id, 'github.issue.comment', `Commented on issue ${issue.ref}.`))
    return actionResult(`Commented on issue ${issue.ref}.`, { affectedIds: [issue.id, comment.id] })
  })
})

for (const suffix of ['label add', 'label remove', 'assignee add', 'assignee remove'] as const) {
  on(`github issue ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const issue = githubIssueByIdOrError(context, state, String(context.args['issue-ref']))
      const values = coerceArray((suffix.includes('label') ? context.options.labels : context.options.assignees) as string[])
      if (suffix === 'label add') for (const value of values) if (!issue.labels.includes(value)) issue.labels.push(value)
      if (suffix === 'label remove') issue.labels = issue.labels.filter((value) => !values.includes(value))
      if (suffix === 'assignee add') for (const value of values) if (!issue.assignees.includes(value)) issue.assignees.push(value)
      if (suffix === 'assignee remove') issue.assignees = issue.assignees.filter((value) => !values.includes(value))
      return actionResult(`Updated issue ${issue.ref}.`, { affectedIds: [issue.id, ...values] })
    })
  })
}

for (const suffix of ['close', 'lock', 'unlock', 'reopen'] as const) {
  on(`github issue ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const issue = githubIssueByIdOrError(context, state, String(context.args['issue-ref']))
      issue.state = suffix === 'reopen' ? 'open' : suffix === 'close' ? 'closed' : suffix === 'lock' ? 'locked' : 'open'
      return actionResult(`${capitalize(suffix)} issue ${issue.ref}.`, { affectedIds: [issue.id] })
    })
  })
}

on('github pr list', async (context) => {
  const state = await loadState(context.runtime)
  const prs = githubPrList(state, context.options as Record<string, unknown>)
  return listResult(mapGithubPullRequests(listWithLimit(prs, context.options.limit ? Number(context.options.limit) : undefined)), { total: prs.length, summary: entityListSummary('GitHub pull request', prs.length) })
})

on('github pr get', async (context) => {
  const state = await loadState(context.runtime)
  return githubPullRequestOutput(githubPrByIdOrError(context, state, String(context.args['pr-ref'])))
})

on('github pr context', async (context) => {
  const state = await loadState(context.runtime)
  return githubPrContextOutput(state, githubPrByIdOrError(context, state, String(context.args['pr-ref'])))
})

on('github pr timeline', async (context) => {
  const state = await loadState(context.runtime)
  const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
  const timeline = githubPrActivity(state, pr)
  return listResult(timeline, { total: timeline.length, summary: entityListSummary('PR timeline event', timeline.length) })
})

on('github pr comments', async (context) => {
  const state = await loadState(context.runtime)
  const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
  const comments = prComments(state, pr).map(githubCommentOutput)
  return listResult(comments, { total: comments.length, summary: entityListSummary('PR comment', comments.length) })
})

on('github pr reviews', async (context) => {
  const state = await loadState(context.runtime)
  const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
  const reviews = prReviews(state, pr).map(githubReviewOutput)
  return listResult(reviews, { total: reviews.length, summary: entityListSummary('PR review', reviews.length) })
})

on('github pr files', async (context) => {
  const state = await loadState(context.runtime)
  const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
  return { files: pr.files }
})

on('github pr diff', async (context) => {
  const state = await loadState(context.runtime)
  const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
  return { diff: pr.diff }
})

on('github pr checks', async (context) => {
  const state = await loadState(context.runtime)
  const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
  return { checks: pr.checks }
})

on('github pr open', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const repo = String(context.options.repo)
    const pr: GithubPullRequestRecord = {
      id: nextId(state, 'gh_pr'),
      ref: `${repo}#${state.github.pullRequests.length + 1}`,
      title: String(context.options.title),
      state: 'open',
      summary: context.options.body ? String(context.options.body) : String(context.options.title),
      reviewers: [],
      checks: [],
      commentIds: [],
      reviewIds: [],
      files: [],
      diff: '',
      draft: false,
    }
    state.github.pullRequests.push(pr)
    ensureGithubRepo(state, repo)
    return actionResult(`Opened PR ${pr.ref}.`, { affectedIds: [pr.id] })
  })
})

on('github pr update', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    if (context.options.title !== undefined) pr.title = String(context.options.title)
    if (context.options.body !== undefined) pr.summary = String(context.options.body)
    return actionResult(`Updated PR ${pr.ref}.`, { affectedIds: [pr.id] })
  })
})

on('github pr comment', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    const comment = ensureGithubComment(state, String(context.options.body))
    pr.commentIds.push(comment.id)
    return actionResult(`Commented on PR ${pr.ref}.`, { affectedIds: [pr.id, comment.id] })
  })
})

for (const suffix of ['close', 'reopen'] as const) {
  on(`github pr ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
      pr.state = suffix === 'close' ? 'closed' : 'open'
      return actionResult(`${capitalize(suffix)} PR ${pr.ref}.`, { affectedIds: [pr.id] })
    })
  })
}

on('github pr merge', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    pr.state = 'merged'
    pr.draft = false
    return actionResult(`Merged PR ${pr.ref}.`, { affectedIds: [pr.id] })
  })
})

on('github pr reviewer request', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    for (const reviewer of coerceArray(context.options.reviewers as string[])) if (!pr.reviewers.includes(reviewer)) pr.reviewers.push(reviewer)
    return actionResult(`Requested reviewers for ${pr.ref}.`, { affectedIds: [pr.id] })
  })
})

on('github pr reviewer unrequest', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    pr.reviewers = pr.reviewers.filter((reviewer) => !coerceArray(context.options.reviewers as string[]).includes(reviewer))
    return actionResult(`Removed requested reviewers for ${pr.ref}.`, { affectedIds: [pr.id] })
  })
})

on('github pr ready', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    pr.draft = false
    return actionResult(`Marked PR ${pr.ref} ready.`, { affectedIds: [pr.id] })
  })
})

on('github pr draft', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    pr.draft = true
    return actionResult(`Marked PR ${pr.ref} draft.`, { affectedIds: [pr.id] })
  })
})

on('github review list', async (context) => {
  const state = await loadState(context.runtime)
  const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
  const reviews = prReviews(state, pr).map(githubReviewOutput)
  return listResult(reviews, { total: reviews.length, summary: entityListSummary('PR review', reviews.length) })
})

on('github review get', async (context) => {
  const state = await loadState(context.runtime)
  const review = ensureFound(context, state.github.reviews.find((item) => item.id === String(context.args['review-id'])), 'review', String(context.args['review-id']))
  return githubReviewOutput(review)
})

on('github review submit', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    const review = ensureGithubReview(state, pr.ref, 'origin-agent', String(context.options.event), context.options.body ? String(context.options.body) : undefined)
    pr.reviewIds.push(review.id)
    return actionResult(`Submitted review for ${pr.ref}.`, { affectedIds: [pr.id, review.id] })
  })
})

on('github review thread-reply', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const pr = githubPrByIdOrError(context, state, String(context.args['pr-ref']))
    const comment = ensureGithubComment(state, String(context.options.body))
    pr.commentIds.push(comment.id)
    return actionResult(`Replied to review thread on ${pr.ref}.`, { affectedIds: [pr.id, comment.id] })
  })
})

on('github search query', async (context) => {
  const state = await loadState(context.runtime)
  const hits = githubSearchItems(state, String(context.options.query), context.options.scope as 'repo' | 'issue' | 'pr' | 'comment')
  const limited = listWithLimit(hits, context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(limited, { total: hits.length, summary: entityListSummary('GitHub search hit', hits.length) })
})

on('github search recent', async (context) => {
  const state = await loadState(context.runtime)
  return listResult(githubSearchRecent(state), { total: githubSearchRecent(state).length, summary: entityListSummary('recent GitHub item', githubSearchRecent(state).length) })
})

on('github search attention', async (context) => {
  const state = await loadState(context.runtime)
  return listResult(githubAttentionHits(state), { total: githubAttentionHits(state).length, summary: entityListSummary('GitHub attention item', githubAttentionHits(state).length) })
})

on('github cache status', async (context) => {
  const state = await loadState(context.runtime)
  return githubProviderStatus(state)
})

for (const suffix of ['refresh', 'hydrate', 'evict'] as const) {
  on(`github cache ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      rebuildProviderLastRefreshed(ensureIntegration(state, 'github'))
      return actionResult(`${capitalize(suffix)} GitHub cache.`, { affectedIds: ['github'] })
    })
  })
}

on('github refresh status', async (context) => {
  const state = await loadState(context.runtime)
  return githubProviderStatus(state)
})

on('github refresh run', async (context) => {
  return mutateState(context.runtime, async (state) => {
    rebuildProviderLastRefreshed(ensureIntegration(state, 'github'))
    return actionResult('Ran GitHub refresh.', { affectedIds: ['github'] })
  })
})

on('github refresh reset-cursor', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const integration = ensureIntegration(state, 'github')
    modifyProviderPollers(integration, (poller) => {
      poller.cursor = undefined
    })
    rebuildProviderLastRefreshed(integration)
    return actionResult('Reset GitHub cursors.', { affectedIds: ['github'] })
  })
})

on('github outbox list', async (context) => {
  const state = await loadState(context.runtime)
  return listResult(state.github.outbox.map((item) => compact(item)), { total: state.github.outbox.length, summary: entityListSummary('GitHub outbox item', state.github.outbox.length) })
})

on('github outbox get', async (context) => {
  const state = await loadState(context.runtime)
  return ensureFound(context, state.github.outbox.find((item) => item.id === String(context.args['outbox-id'])), 'outbox item', String(context.args['outbox-id']))
})

for (const suffix of ['retry', 'cancel', 'resolve'] as const) {
  on(`github outbox ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const item = ensureFound(context, state.github.outbox.find((outbox) => outbox.id === String(context.args['outbox-id'])), 'outbox item', String(context.args['outbox-id']))
      item.status = suffix === 'retry' ? 'queued' : suffix === 'cancel' ? 'canceled' : 'resolved'
      return actionResult(`${capitalize(suffix)} GitHub outbox item ${item.id}.`, { affectedIds: [item.id] })
    })
  })
}

// Telegram
on('telegram connection status', async (context) => {
  const state = await loadState(context.runtime)
  return telegramConnectionOutput(state.telegram.connection)
})

on('telegram connection set-token', async (context) => {
  return mutateState(context.runtime, async (state) => {
    state.telegram.connection.status = 'valid'
    state.telegram.connection.summary = 'Telegram bot token stored and validated.'
    state.telegram.connection.botUsername = state.telegram.connection.botUsername ?? '@origin_bot'
    ensureIntegration(state, 'telegram').status.lastValidatedAt = now()
    return actionResult('Stored Telegram bot token metadata.', { affectedIds: ['telegram'] })
  })
})

on('telegram connection revoke', async (context) => {
  return mutateState(context.runtime, async (state) => {
    state.telegram.connection.status = 'revoked'
    state.telegram.connection.summary = 'Telegram bot token revoked locally.'
    return actionResult('Revoked Telegram bot token metadata.', { affectedIds: ['telegram'] })
  })
})

on('telegram connection validate', async (context) => {
  const state = await loadState(context.runtime)
  return telegramValidationResult(state)
})

on('telegram connection configure', async (context) => {
  return mutateState(context.runtime, async (state) => {
    if (context.options['expected-privacy-mode'] !== undefined) {
      state.telegram.connection.privacyMode = String(context.options['expected-privacy-mode'])
    }
    if (context.options['default-mode'] !== undefined) state.telegram.connection.defaultMode = String(context.options['default-mode']) as TelegramConnectionRecord['defaultMode']
    if (context.options['default-summary-enabled'] !== undefined) state.telegram.connection.defaultSummaryEnabled = Boolean(context.options['default-summary-enabled'])
    if (context.options['default-summary-lookback'] !== undefined) {
      state.telegram.connection.defaultSummaryWindow = String(context.options['default-summary-lookback'])
    }
    return actionResult('Configured Telegram connection defaults.', { affectedIds: ['telegram'] })
  })
})

on('telegram connection refresh-metadata', async (context) => {
  return mutateState(context.runtime, async (state) => {
    ensureIntegration(state, 'telegram').provider.lastRefreshedAt = now()
    return actionResult('Refreshed Telegram metadata.', { affectedIds: ['telegram'] })
  })
})

on('telegram chat list', async (context) => {
  const state = await loadState(context.runtime)
  let chats = state.telegram.chats
  if (context.options.query) chats = chats.filter((chat) => matchesQuery(`${chat.title}\n${chat.summary}\n${chat.kind}`, String(context.options.query)))
  if (context.options.kind?.length) chats = chats.filter((chat) => coerceArray(context.options.kind as string[]).includes(chat.kind))
  chats = listWithLimit(genericSortByLatest(chats), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapTelegramChats(chats), { total: chats.length, summary: entityListSummary('Telegram chat', chats.length) })
})

on('telegram chat get', async (context) => {
  const state = await loadState(context.runtime)
  return telegramChatOutput(telegramChatByIdOrError(context, state, String(context.args['chat-id'])))
})

on('telegram chat context', async (context) => {
  const state = await loadState(context.runtime)
  return telegramChatContextOutput(state, telegramChatByIdOrError(context, state, String(context.args['chat-id'])))
})

on('telegram chat recent', async (context) => {
  const state = await loadState(context.runtime)
  const chats = listWithLimit(genericSortByLatest(state.telegram.chats), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapTelegramChats(chats), { total: chats.length, summary: entityListSummary('recent Telegram chat', chats.length) })
})

on('telegram chat search', async (context) => {
  const state = await loadState(context.runtime)
  const hits = telegramChatSearchHits(state, String(context.options.query))
  const limited = listWithLimit(hits, context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(limited, { total: hits.length, summary: entityListSummary('Telegram search hit', hits.length) })
})

on('telegram chat refresh', async (context) => {
  return mutateState(context.runtime, async (state) => {
    telegramChatRefresh(state, context.options['chat-id'] ? String(context.options['chat-id']) : undefined)
    return actionResult('Refreshed Telegram chats.', { affectedIds: ['telegram'] })
  })
})

on('telegram group list', async (context) => {
  const state = await loadState(context.runtime)
  return listResult(mapTelegramGroups(state.telegram.groups), { total: state.telegram.groups.length, summary: entityListSummary('Telegram group policy', state.telegram.groups.length) })
})

on('telegram group get', async (context) => {
  const state = await loadState(context.runtime)
  return telegramGroupOutput(telegramGroupByIdOrError(context, state, String(context.args['chat-id'])))
})

on('telegram group register', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const chat = ensureTelegramChat(state, String(context.args['chat-id']))
    chat.isRegistered = true
    ensureTelegramGroup(state, chat.id)
    return actionResult(`Registered Telegram group ${chat.id}.`, { affectedIds: [chat.id] })
  })
})

on('telegram group enable', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const group = ensureTelegramGroup(state, String(context.args['chat-id']))
    group.enabled = true
    group.participationMode = String(context.options.mode) as TelegramGroupPolicyRecord['participationMode']
    return actionResult(`Enabled Telegram group ${group.chatId}.`, { affectedIds: [group.chatId] })
  })
})

on('telegram group disable', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const group = ensureTelegramGroup(state, String(context.args['chat-id']))
    group.enabled = false
    return actionResult(`Disabled Telegram group ${group.chatId}.`, { affectedIds: [group.chatId] })
  })
})

on('telegram group mode set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const group = ensureTelegramGroup(state, String(context.args['chat-id']))
    group.participationMode = String(context.options.mode) as TelegramGroupPolicyRecord['participationMode']
    return actionResult(`Updated Telegram group mode for ${group.chatId}.`, { affectedIds: [group.chatId] })
  })
})

on('telegram group policy summary-set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const group = ensureTelegramGroup(state, String(context.args['chat-id']))
    group.summaryPolicy = { enabled: Boolean(context.options.enabled), window: context.options.window ? String(context.options.window) : undefined }
    return actionResult(`Updated Telegram summary policy for ${group.chatId}.`, { affectedIds: [group.chatId] })
  })
})

on('telegram group policy mention-set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const group = ensureTelegramGroup(state, String(context.args['chat-id']))
    group.mentionTrackingEnabled = Boolean(context.options.enabled)
    return actionResult(`Updated Telegram mention policy for ${group.chatId}.`, { affectedIds: [group.chatId] })
  })
})

on('telegram mention list', async (context) => {
  const state = await loadState(context.runtime)
  let mentions = telegramMentionOutputs(state)
  if (context.options['chat-id']) {
    mentions = mentions.filter((mention) => mention['chat-id'] === String(context.options['chat-id']))
  }
  const statuses = coerceArray(context.options.status as string[] | string | undefined)
  if (statuses.length > 0) {
    mentions = mentions.filter((mention) => statuses.includes(String(mention.status)))
  }
  const limit = context.options.limit ? Number(context.options.limit) : undefined
  const items = limit ? takeLimit(mentions, limit) : mentions
  return listResult(items, {
    total: mentions.length,
    summary: entityListSummary('Telegram mention', mentions.length),
  })
})

on('telegram mention get', async (context) => {
  const state = await loadState(context.runtime)
  return ensureFound(
    context,
    telegramMentionById(state, String(context.args['mention-id'])),
    'Telegram mention',
    String(context.args['mention-id']),
  )
})

on('telegram mention ack', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const mentionId = String(context.args['mention-id'])
    ensureFound(context, telegramMentionById(state, mentionId), 'Telegram mention', mentionId)
    const integration = ensureIntegration(state, 'telegram')
    const acknowledgements = recordOfObjects(
      integration.config[TELEGRAM_ACKNOWLEDGED_MENTIONS_KEY],
    )
    acknowledgements[mentionId] = {
      at: now(),
      actor: 'origin/agent',
    }
    integration.config[TELEGRAM_ACKNOWLEDGED_MENTIONS_KEY] = acknowledgements
    rebuildProviderLastRefreshed(integration)
    return actionResult(`Acknowledged Telegram mention ${mentionId}.`, {
      affectedIds: [mentionId],
    })
  })
})

on('telegram group policy cache-set', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const group = ensureTelegramGroup(state, String(context.args['chat-id']))
    group.messageCacheEnabled = Boolean(context.options.enabled)
    return actionResult(`Updated Telegram cache policy for ${group.chatId}.`, { affectedIds: [group.chatId] })
  })
})

on('telegram message send', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const chat = ensureTelegramChat(state, String(context.args['chat-id']))
    const message: TelegramMessageRecord = { id: nextId(state, 'tg_msg'), chatId: chat.id, author: state.telegram.connection.botUsername ?? 'origin-bot', body: String(context.options.body), at: now() }
    state.telegram.messages.push(message)
    return actionResult(`Sent Telegram message to ${chat.id}.`, { affectedIds: [message.id] })
  })
})

on('telegram message reply', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const chat = ensureTelegramChat(state, String(context.args['chat-id']))
    const reply: TelegramMessageRecord = { id: nextId(state, 'tg_msg'), chatId: chat.id, author: state.telegram.connection.botUsername ?? 'origin-bot', body: String(context.options.body), at: now() }
    state.telegram.messages.push(reply)
    return actionResult(`Replied in Telegram chat ${chat.id}.`, { affectedIds: [reply.id] })
  })
})

on('telegram message get', async (context) => {
  const state = await loadState(context.runtime)
  const message = ensureFound(context, state.telegram.messages.find((item) => item.chatId === String(context.args['chat-id']) && item.id === String(context.args['message-id'])), 'telegram message', String(context.args['message-id']))
  return telegramMessageOutput(message)
})

on('telegram message edit', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const message = ensureFound(context, state.telegram.messages.find((item) => item.chatId === String(context.args['chat-id']) && item.id === String(context.args['message-id'])), 'telegram message', String(context.args['message-id']))
    message.body = String(context.options.body)
    return actionResult(`Edited Telegram message ${message.id}.`, { affectedIds: [message.id] })
  })
})

on('telegram message delete', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const index = state.telegram.messages.findIndex((item) => item.chatId === String(context.args['chat-id']) && item.id === String(context.args['message-id']))
    if (index >= 0) state.telegram.messages.splice(index, 1)
    return actionResult(`Deleted Telegram message ${String(context.args['message-id'])}.`, { affectedIds: [String(context.args['message-id'])] })
  })
})

on('telegram summary list', async (context) => {
  const state = await loadState(context.runtime)
  let summaries = state.telegram.summaries
  if (context.options['chat-id']) summaries = summaries.filter((summary) => summary.chatId === String(context.options['chat-id']))
  if (context.options.since) summaries = summaries.filter((summary) => (summary.at ?? '') >= String(context.options.since))
  if (context.options.until) summaries = summaries.filter((summary) => (summary.at ?? '') <= String(context.options.until))
  summaries = listWithLimit(genericSortByLatest(summaries), context.options.limit ? Number(context.options.limit) : undefined)
  return listResult(mapTelegramSummaries(summaries), { total: summaries.length, summary: entityListSummary('Telegram summary job', summaries.length) })
})

on('telegram summary get', async (context) => {
  const state = await loadState(context.runtime)
  return telegramSummaryOutput(ensureFound(context, state.telegram.summaries.find((item) => item.id === String(context.args['summary-id'])), 'summary job', String(context.args['summary-id'])))
})

on('telegram summary run', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const chat = telegramChatByIdOrError(context, state, String(context.args['chat-id']))
    const completedAt = now()
    const summary: TelegramSummaryJobRecord = {
      id: nextId(state, 'tg_sum'),
      chatId: chat.id,
      triggerKind: 'manual',
      status: 'completed',
      summary: `Summary for ${chat.title}.`,
      queuedAt: completedAt,
      completedAt,
      at: completedAt,
    }
    state.telegram.summaries.push(summary)
    return actionResult(`Generated Telegram summary for ${chat.id}.`, { affectedIds: [summary.id] })
  })
})

on('telegram summary post', async (context) => {
  return mutateState(context.runtime, async (state) => {
    const summary = ensureFound(context, state.telegram.summaries.find((item) => item.id === String(context.args['summary-id'])), 'summary job', String(context.args['summary-id']))
    summary.status = 'completed'
    summary.outputMessageId = nextId(state, 'tg_msg')
    summary.completedAt = summary.completedAt ?? now()
    return actionResult(`Posted Telegram summary ${summary.id}.`, { affectedIds: [summary.id] })
  })
})

on('telegram summary next', async (context) => {
  const state = await loadState(context.runtime)
  const summaries = telegramSummaryNext(state).map(telegramSummaryOutput)
  return listResult(summaries, { total: summaries.length, summary: entityListSummary('next Telegram summary', summaries.length) })
})

on('telegram cache status', async (context) => {
  const state = await loadState(context.runtime)
  return telegramProviderStatus(state)
})

for (const suffix of ['refresh', 'rehydrate', 'expire', 'evict'] as const) {
  on(`telegram cache ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      rebuildProviderLastRefreshed(ensureIntegration(state, 'telegram'))
      return actionResult(`${capitalize(suffix)} Telegram cache.`, { affectedIds: ['telegram'] })
    })
  })
}

on('telegram refresh status', async (context) => {
  const state = await loadState(context.runtime)
  return telegramProviderStatus(state)
})

on('telegram refresh run', async (context) => {
  return mutateState(context.runtime, async (state) => {
    rebuildProviderLastRefreshed(ensureIntegration(state, 'telegram'))
    return actionResult('Ran Telegram refresh.', { affectedIds: ['telegram'] })
  })
})

on('telegram outbox list', async (context) => {
  const state = await loadState(context.runtime)
  return listResult(state.telegram.outbox.map((item) => compact(item)), { total: state.telegram.outbox.length, summary: entityListSummary('Telegram outbox item', state.telegram.outbox.length) })
})

on('telegram outbox get', async (context) => {
  const state = await loadState(context.runtime)
  return ensureFound(context, state.telegram.outbox.find((item) => item.id === String(context.args['outbox-id'])), 'outbox item', String(context.args['outbox-id']))
})

for (const suffix of ['retry', 'cancel', 'resolve'] as const) {
  on(`telegram outbox ${suffix}`, async (context) => {
    return mutateState(context.runtime, async (state) => {
      const item = ensureFound(context, state.telegram.outbox.find((outbox) => outbox.id === String(context.args['outbox-id'])), 'outbox item', String(context.args['outbox-id']))
      item.status = suffix === 'retry' ? 'queued' : suffix === 'cancel' ? 'canceled' : 'resolved'
      return actionResult(`${capitalize(suffix)} Telegram outbox item ${item.id}.`, { affectedIds: [item.id] })
    })
  })
}

export const planningEmailGithubTelegramHandlers = defineHandlers(handlers as any)
