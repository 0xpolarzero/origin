import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { defineHandlers } from '../cli/types.ts'
import {
  DAY_IN_MS,
  addActivity,
  asMarkdownTable,
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
  summarizeCounts,
  takeLimit,
} from '../runtime/helpers.ts'
import type { JsonValue, OriginState } from '../runtime/types.ts'

type HandlerContext = any

type ActivityRecord = OriginState['activities'][number]
type AutomationRecord = OriginState['automations']['automations'][number]
type AutomationRunRecord = OriginState['automations']['runs'][number]
type AutomationRunStepRecord = AutomationRunRecord['steps'][number]
type AutomationActionRecord = NonNullable<AutomationRecord['actions']>[number]
type AutomationRunPolicyRecord = NonNullable<AutomationRecord['runPolicy']>
type AutomationRetryPolicyRecord = NonNullable<AutomationRecord['retryPolicy']>
type NotificationRecord = OriginState['notifications']['items'][number]
type NotificationDeviceRecord = OriginState['notifications']['devices'][number]
type NotificationDeliveryRecord = OriginState['notifications']['deliveries'][number]
type SyncPeerRecord = OriginState['sync']['replicaPeers'][number]
type SyncJobRecord = OriginState['sync']['replicaJobs'][number]
type OutboxItemRecord = OriginState['sync']['providerOutbox'][number]
type SyncConflictRecord = OriginState['sync']['replicaConflicts'][number]
type BridgeJobRecord = OriginState['workspace']['bridgeJobs'][number]
type EntityLinkRecord = OriginState['entityLinks'][number]

type NoteRecord = OriginState['notes']['notes'][number]
type ProjectRecord = OriginState['planning']['projects'][number]
type LabelRecord = OriginState['planning']['labels'][number]
type TaskRecord = OriginState['planning']['tasks'][number]
type CalendarItemRecord = OriginState['planning']['calendarItems'][number]
type EmailThreadRecord = OriginState['email']['threads'][number]
type EmailAccountRecord = OriginState['email']['accounts'][number]
type GithubRepositoryRecord = OriginState['github']['repositories'][number]
type GithubIssueRecord = OriginState['github']['issues'][number]
type GithubPullRequestRecord = OriginState['github']['pullRequests'][number]
type GithubFollowTargetRecord = OriginState['github']['follows'][number]
type TelegramChatRecord = OriginState['telegram']['chats'][number]
type TelegramGroupPolicyRecord = OriginState['telegram']['groups'][number]
type TelegramSummaryJobRecord = OriginState['telegram']['summaries'][number]

type EntitySummary = {
  kind: string
  id: string
  title: string
  summary?: string
  aliases: string[]
}

function compactObject(entries: Array<[string, unknown]>) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined))
}

function buildDomainHandlers<const Domain extends string, const Suffixes extends readonly string[]>(
  domain: Domain,
  suffixes: Suffixes,
  dispatcher: (context: HandlerContext, suffix: Suffixes[number]) => Promise<unknown> | unknown,
) {
  const entries = suffixes.map((suffix) => [
    `${domain} ${suffix}`,
    (context: HandlerContext) => dispatcher(context, suffix),
  ])
  return Object.fromEntries(entries) as {
    [key in `${Domain} ${Suffixes[number]}`]: (context: HandlerContext) => Promise<unknown> | unknown
  }
}

function loadState(context: HandlerContext): Promise<OriginState> {
  return context.runtime.store.load()
}

function mutateState<T>(context: HandlerContext, mutator: (state: OriginState) => T | Promise<T>): Promise<T> {
  return context.runtime.store.mutate(mutator)
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function compactSummary(value: string | undefined, fallback: string) {
  const line = (value ?? '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean)
  if (!line) return fallback
  return line.replace(/^#+\s*/, '').slice(0, 160)
}

function sortByLatest<T>(items: T[], getTime: (item: T) => string | undefined) {
  return [...items].sort((left, right) => cmpDateDescending(getTime(left), getTime(right)))
}

function latestTime(record: {
  at?: string
  startedAt?: string
  triggeredAt?: string
  endedAt?: string
  lastMessageAt?: string
  updatedAt?: string
}) {
  return record.at ?? record.startedAt ?? record.triggeredAt ?? record.endedAt ?? record.lastMessageAt ?? record.updatedAt
}

function withinWindow(timestamp: string | undefined, since?: string, until?: string) {
  if (!timestamp) return true
  if (since && timestamp < since) return false
  if (until && timestamp > until) return false
  return true
}

function withWindow<T>(
  items: T[],
  getTime: (item: T) => string | undefined,
  since?: string,
  until?: string,
) {
  return items.filter((item) => withinWindow(getTime(item), since, until))
}

function matchesAnyQuery(values: Array<string | undefined>, query: string | undefined) {
  if (!query) return true
  return values.some((value) => includesQuery(value, query))
}

function matchesFilters(values: Array<string | undefined>, filters: string[] | undefined) {
  const normalized = coerceArray(filters)
  if (normalized.length === 0) return true
  return normalized.some((filter) => matchesAnyQuery(values, filter))
}

function ensureFound<T>(context: HandlerContext, value: T | undefined, kind: string, id: string): T {
  if (!value) {
    throw context.error({
      code: 'NOT_FOUND',
      message: `Unknown ${kind}: ${id}`,
    })
  }
  return value
}

function toActivityEvent(record: ActivityRecord) {
  return compactObject([
    ['id', record.id],
    ['kind', record.kind],
    ['status', record.status],
    ['actor', record.actor],
    ['target', record.target],
    ['at', record.at],
    ['summary', record.summary],
    ['severity', record.severity],
    ['provider', record.provider],
    ['poller-id', record.pollerId],
    ['source-refs', record.sourceRefs],
    ['entity-refs', record.entityRefs],
    ['details-md', record.detailsMd],
    ['trace-id', record.traceId],
  ])
}

function toAutomationTriggerOutput(trigger: AutomationRecord['trigger']) {
  if (!trigger) return undefined
  if (trigger.type === 'schedule') {
    return compactObject([
      ['type', 'schedule'],
      ['cron', trigger.cron],
      ['timezone', trigger.timezone],
      ['start-at', trigger.startAt],
      ['end-at', trigger.endAt],
    ])
  }

  if (trigger.type === 'event') {
    return compactObject([
      ['type', 'event'],
      ['event-kinds', trigger.eventKinds],
      ['filters', trigger.filters],
      ['source-scope', trigger.sourceScope],
    ])
  }

  if (trigger.type === 'manual') {
    return { type: 'manual' }
  }

  return compactObject([
    ['type', 'hybrid'],
    [
      'schedule',
      compactObject([
        ['cron', trigger.schedule.cron],
        ['timezone', trigger.schedule.timezone],
        ['start-at', trigger.schedule.startAt],
        ['end-at', trigger.schedule.endAt],
      ]),
    ],
    [
      'event',
      compactObject([
        ['event-kinds', trigger.event.eventKinds],
        ['filters', trigger.event.filters],
        ['source-scope', trigger.event.sourceScope],
      ]),
    ],
  ])
}

function toAutomationActionOutput(action: AutomationActionRecord) {
  return compactObject([
    ['type', action.type],
    ['command', action.command],
    ['args', action.args],
    ['options', action.options],
    ['summary', action.summary],
  ])
}

function toAutomationRunPolicyOutput(policy: AutomationRunPolicyRecord | undefined) {
  if (!policy) return undefined
  return compactObject([
    ['allow-overlap', policy.allowOverlap],
    ['catch-up', policy.catchUp],
    ['continue-on-error', policy.continueOnError],
  ])
}

function toAutomationRetryPolicyOutput(policy: AutomationRetryPolicyRecord | undefined) {
  if (!policy) return undefined
  return compactObject([
    ['max-attempts', policy.maxAttempts],
    ['backoff', policy.backoff],
  ])
}

function toPublicAutomationStatus(status: string) {
  if (status === 'enabled' || status === 'active') return 'active'
  if (status === 'paused' || status === 'disabled' || status === 'archived') return status
  return 'active'
}

function toPublicAutomationRunStatus(status: string) {
  if (status === 'completed' || status === 'succeeded') return 'succeeded'
  if (status === 'queued' || status === 'running' || status === 'failed' || status === 'canceled' || status === 'skipped') {
    return status
  }
  return 'succeeded'
}

function automationMetadata(state: OriginState, automationId: string) {
  const events = automationEventsForAutomation(state, automationId)
    .slice()
    .sort((left, right) => left.at.localeCompare(right.at))
  const createdEvent = events[0]
  const updatedEvent = events.at(-1)
  const latestRun = automationRunsForAutomation(state, automationId)[0]

  return compactObject([
    ['created-at', createdEvent?.at ?? state.createdAt],
    ['updated-at', updatedEvent?.at ?? state.updatedAt],
    ['created-by-actor', createdEvent?.actor ?? 'origin/system'],
    ['updated-by-actor', updatedEvent?.actor ?? 'origin/system'],
    ['last-run-at', latestRun ? latestTime(latestRun) : undefined],
    ['next-run-at', undefined],
    ['last-run-status', latestRun ? toPublicAutomationRunStatus(latestRun.status) : undefined],
  ])
}

function toAutomationOutput(state: OriginState, automation: AutomationRecord) {
  return compactObject([
    ['id', automation.id],
    ['name', automation.title],
    ['title', automation.title],
    ['status', toPublicAutomationStatus(automation.status)],
    ['kind', automation.kind],
    ['summary', automation.summary],
    ['trigger', toAutomationTriggerOutput(automation.trigger)],
    ['actions', automation.actions?.map(toAutomationActionOutput)],
    ['run-policy', toAutomationRunPolicyOutput(automation.runPolicy)],
    ['retry-policy', toAutomationRetryPolicyOutput(automation.retryPolicy)],
    ...Object.entries(automationMetadata(state, automation.id)),
  ])
}

function toAutomationRunOutput(run: AutomationRunRecord) {
  return compactObject([
    ['id', run.id],
    ['automation-id', run.automationId],
    ['status', toPublicAutomationRunStatus(run.status)],
    ['summary', run.summary],
    ['triggered-at', run.triggeredAt],
    ['scheduled-at', run.scheduledAt],
    ['activity-event-id', run.activityEventId],
    ['trigger-reason', run.triggerReason],
    ['actor', run.triggerReason === 'manual' ? 'origin/operator' : 'origin/automation'],
    ['input-summary-md', undefined],
    ['output-summary-md', undefined],
    ['error-md', undefined],
    ['retry-count', undefined],
    ['attempt-number', undefined],
    ['started-at', run.startedAt],
    ['finished-at', run.endedAt],
    ['ended-at', run.endedAt],
    ['created-at', run.triggeredAt],
    ['updated-at', run.endedAt ?? run.startedAt ?? run.triggeredAt],
    ['trace-id', run.traceId],
  ])
}

function toAutomationRunStepOutput(step: AutomationRunStepRecord) {
  return compactObject([
    ['id', step.id],
    ['kind', step.kind],
    ['status', step.status],
    ['summary', step.summary],
  ])
}

function toAutomationRunDetailOutput(run: AutomationRunRecord, events: ActivityRecord[] = []) {
  return compactObject([
    ...Object.entries(toAutomationRunOutput(run)),
    ['steps', run.steps.map(toAutomationRunStepOutput)],
    ['events', events.map(toActivityEvent)],
  ])
}

function toAutomationSchedulePreviewOutput(summary: string, runs: string[]) {
  return {
    summary,
    ['next-runs']: runs,
  }
}

function toNotificationOutput(notification: NotificationRecord) {
  return compactObject([
    ['id', notification.id],
    ['kind', notification.kind],
    ['title', notification.title],
    ['status', notification.status],
    ['at', notification.at],
    ['read', notification.read],
    ['snoozed-until', notification.snoozedUntil],
  ])
}

function toNotificationDeviceOutput(device: NotificationDeviceRecord) {
  return compactObject([
    ['id', device.id],
    ['kind', device.kind],
    ['status', device.status],
    ['summary', device.summary],
  ])
}

function toNotificationDeliveryOutput(delivery: NotificationDeliveryRecord) {
  return compactObject([
    ['id', delivery.id],
    ['notification-id', delivery.notificationId],
    ['channel', delivery.channel],
    ['status', delivery.status],
    ['summary', delivery.summary],
  ])
}

function toSyncPeerOutput(peer: SyncPeerRecord) {
  return compactObject([
    ['id', peer.id],
    ['kind', peer.kind],
    ['status', peer.status],
    ['summary', peer.summary],
  ])
}

function toSyncJobOutput(job: SyncJobRecord) {
  return compactObject([
    ['id', job.id],
    ['kind', job.kind],
    ['status', job.status],
    ['summary', job.summary],
    ['trace-id', job.traceId],
  ])
}

function toOutboxItemOutput(item: OutboxItemRecord) {
  return compactObject([
    ['id', item.id],
    ['kind', item.kind],
    ['status', item.status],
    ['summary', item.summary],
  ])
}

type ExternalActionIntentSource = {
  item: OutboxItemRecord
  provider: 'email' | 'github' | 'telegram' | 'google-calendar' | 'google-tasks'
  targetScope: string
}

function externalActionIntentStatus(status: string) {
  if (status === 'canceled') return 'canceled'
  if (status === 'resolved' || status === 'completed') return 'succeeded'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'pending') return 'pending'
  return 'materialized'
}

function externalActionIntentAction(provider: ExternalActionIntentSource['provider'], kind: string) {
  if (provider === 'email') {
    if (kind.includes('reply-all')) return 'reply_all'
    if (kind.includes('reply')) return 'reply'
    if (kind.includes('forward')) return 'forward'
    if (kind.includes('archive')) return 'archive'
    if (kind.includes('unarchive')) return 'unarchive'
    if (kind.includes('mark-read')) return 'mark_read'
    if (kind.includes('mark-unread')) return 'mark_unread'
    if (kind.includes('unstar')) return 'unstar'
    if (kind.includes('star')) return 'star'
    if (kind.includes('unspam')) return 'unspam'
    if (kind.includes('spam')) return 'spam'
    if (kind.includes('restore')) return 'restore'
    if (kind.includes('trash')) return 'trash'
    return 'send'
  }

  if (provider === 'github') {
    if (kind.includes('review-thread')) return 'review_thread_reply'
    if (kind.includes('review')) return 'review_submit'
    if (kind.includes('merge')) return 'pr_merge'
    if (kind.includes('draft')) return 'pr_draft'
    if (kind.includes('ready')) return 'pr_ready'
    if (kind.includes('comment')) return 'pr_comment'
    if (kind.includes('issue')) return 'issue_update'
    return 'pr_update'
  }

  if (provider === 'telegram') {
    return kind.includes('reply') ? 'reply' : 'send'
  }

  if (kind.includes('attach')) return 'attach'
  if (kind.includes('detach')) return 'detach'
  if (kind.includes('reconcile')) return 'reconcile'
  return kind.includes('pull') ? 'pull' : 'push'
}

function externalActionIntentSources(state: OriginState): ExternalActionIntentSource[] {
  const emailAccountId = state.email.accounts[0]?.id ?? 'mail_acc_0001'
  const githubRepo = state.github.repositories[0]?.name ?? 'origin/origin'
  const telegramChatId = state.telegram.chats[0]?.id ?? 'tg_chat_0001'
  const googleCalendarId =
    state.integrations['google-calendar']?.provider.surfaces[0]?.providerRef ??
    state.integrations['google-calendar']?.provider.surfaces[0]?.scope ??
    'google-calendar-default'
  const googleTaskListId =
    state.integrations['google-tasks']?.provider.surfaces[0]?.providerRef ??
    state.integrations['google-tasks']?.provider.surfaces[0]?.scope ??
    'google-tasks-default'

  return [
    ...state.email.outbox.map((item) => ({
      item,
      provider: 'email' as const,
      targetScope: emailAccountId,
    })),
    ...state.github.outbox.map((item) => ({
      item,
      provider: 'github' as const,
      targetScope: githubRepo,
    })),
    ...state.telegram.outbox.map((item) => ({
      item,
      provider: 'telegram' as const,
      targetScope: telegramChatId,
    })),
    ...state.sync.providerOutbox
      .filter(
        (item): item is OutboxItemRecord & { provider: 'google-calendar' | 'google-tasks' } =>
          item.provider === 'google-calendar' || item.provider === 'google-tasks',
      )
      .map((item) => ({
        item,
        provider: item.provider,
        targetScope: item.provider === 'google-calendar' ? googleCalendarId : googleTaskListId,
      })),
  ]
}

function externalActionIntentTimestamp(
  state: OriginState,
  provider: ExternalActionIntentSource['provider'],
) {
  if (provider === 'email') return state.email.accounts[0]?.lastSyncAt ?? now()
  if (provider === 'github') return state.sync.providerJobs[0]?.endedAt ?? now()
  if (provider === 'telegram') return state.telegram.summaries[0]?.at ?? now()
  return state.integrations[provider]?.provider.lastRefreshedAt ?? now()
}

function toExternalActionIntentOutput(state: OriginState, source: ExternalActionIntentSource) {
  const intentStatus = externalActionIntentStatus(source.item.status)
  const timestamp = externalActionIntentTimestamp(state, source.provider)
  const action = externalActionIntentAction(source.provider, source.item.kind)
  const base = compactObject([
    ['id', source.item.id],
    [
      'kind',
      source.provider === 'google-calendar' || source.provider === 'google-tasks'
        ? 'planning_bridge_action'
        : 'provider_write',
    ],
    ['provider', source.provider],
    ['target-ref', source.targetScope],
    ['action', action],
    ['status', intentStatus],
    ['payload', safeObject(source.item.payload)],
    ['created-by-actor', 'origin/agent'],
    ['updated-by-actor', intentStatus === 'materialized' ? undefined : 'origin/agent'],
    ['created-at', timestamp],
    ['updated-at', intentStatus === 'materialized' ? undefined : timestamp],
    ['materialized-at', intentStatus === 'pending' ? undefined : timestamp],
    ['succeeded-at', intentStatus === 'succeeded' ? timestamp : undefined],
    ['failed-at', intentStatus === 'failed' ? timestamp : undefined],
    ['canceled-at', intentStatus === 'canceled' ? timestamp : undefined],
    ['outbox-refs', [source.item.id]],
    ['last-error', intentStatus === 'failed' ? source.item.summary : undefined],
    ['summary', source.item.summary],
  ])

  if (source.provider === 'email') {
    return compactObject([...Object.entries(base), ['scope', { 'account-id': source.targetScope }]])
  }

  if (source.provider === 'github') {
    return compactObject([...Object.entries(base), ['scope', { repo: source.targetScope }]])
  }

  if (source.provider === 'telegram') {
    return compactObject([...Object.entries(base), ['scope', { 'chat-id': source.targetScope }]])
  }

  return compactObject([
    ...Object.entries(base),
    [
      'scope',
      source.provider === 'google-calendar'
        ? { 'calendar-id': source.targetScope }
        : { 'task-list-id': source.targetScope },
    ],
  ])
}

function toBridgeJobOutput(job: BridgeJobRecord) {
  return compactObject([
    ['id', job.id],
    ['status', job.status],
    ['summary', job.summary],
  ])
}

function toConflictRevisionOutput(revision: SyncConflictRecord['revisions'][number]) {
  return compactObject([
    ['id', revision.id],
    ['source', revision.source],
    ['label', revision.label],
    ['actor', revision.actor],
    ['at', revision.at],
    ['summary', revision.summary],
    ['diff', revision.diff],
  ])
}

function toConflictCandidateOutput(candidate: SyncConflictRecord['candidates'][number]) {
  return compactObject([
    ['id', candidate.id],
    ['label', candidate.label],
    ['summary', candidate.summary],
    ['revision-id', candidate.revisionId],
  ])
}

function toSyncConflictOutput(conflict: SyncConflictRecord) {
  return compactObject([
    ['id', conflict.id],
    ['kind', conflict.kind],
    ['summary', conflict.summary],
    ['peers', conflict.peers],
  ])
}

function toSyncConflictDetailOutput(conflict: SyncConflictRecord) {
  return compactObject([
    ...Object.entries(toSyncConflictOutput(conflict)),
    ['revisions', conflict.revisions.map(toConflictRevisionOutput)],
    ['candidates', conflict.candidates.map(toConflictCandidateOutput)],
  ])
}

function toEntitySummary(record: EntitySummary) {
  return compactObject([
    ['kind', record.kind],
    ['id', record.id],
    ['title', record.title],
    ['summary', record.summary],
  ])
}

function resolveAutomationKind(trigger: AutomationRecord['trigger']) {
  if (!trigger) return 'manual'
  switch (trigger.type) {
    case 'schedule':
      return 'scheduled'
    case 'event':
      return 'reactive'
    case 'manual':
      return 'manual'
    case 'hybrid':
      return 'hybrid'
  }
  return 'manual'
}

function normalizeRunPolicy(options: Record<string, unknown> | undefined): AutomationRunPolicyRecord | undefined {
  if (!options) return undefined
  return {
    allowOverlap: Boolean(options['allow-overlap'] ?? false),
    catchUp: asString(options['catch-up'], 'skip') as 'skip' | 'one' | 'all',
    continueOnError: Boolean(options['continue-on-error'] ?? false),
  }
}

function normalizeRetryPolicy(options: Record<string, unknown> | undefined): AutomationRetryPolicyRecord | undefined {
  if (!options) return undefined
  return {
    maxAttempts: Number(options['max-attempts'] ?? 3),
    backoff: asString(options.backoff, 'exponential') as 'none' | 'linear' | 'exponential',
  }
}

function normalizeAutomationTrigger(input: unknown): AutomationRecord['trigger'] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const trigger = input as Record<string, unknown>
  const type = trigger.type
  if (type === 'schedule') {
    return {
      type: 'schedule',
      cron: asString(trigger.cron, '* * * * *'),
      timezone: asString(trigger.timezone) || undefined,
      startAt: asString(trigger['start-at']) || undefined,
      endAt: asString(trigger['end-at']) || undefined,
    }
  }
  if (type === 'event') {
    return {
      type: 'event',
      eventKinds: coerceArray(trigger['event-kinds'] as string[] | string | undefined),
      filters: trigger.filters && typeof trigger.filters === 'object' && !Array.isArray(trigger.filters)
        ? (trigger.filters as Record<string, JsonValue>)
        : undefined,
      sourceScope:
        trigger['source-scope'] && typeof trigger['source-scope'] === 'object' && !Array.isArray(trigger['source-scope'])
          ? (trigger['source-scope'] as Record<string, JsonValue>)
          : undefined,
    }
  }
  if (type === 'manual') {
    return { type: 'manual' }
  }
  if (type === 'hybrid') {
    const schedule = trigger.schedule && typeof trigger.schedule === 'object' && !Array.isArray(trigger.schedule)
      ? (trigger.schedule as Record<string, unknown>)
      : {}
    const event = trigger.event && typeof trigger.event === 'object' && !Array.isArray(trigger.event)
      ? (trigger.event as Record<string, unknown>)
      : {}
    return {
      type: 'hybrid',
      schedule: {
        cron: asString(schedule.cron, '* * * * *'),
        timezone: asString(schedule.timezone) || undefined,
        startAt: asString(schedule['start-at']) || undefined,
        endAt: asString(schedule['end-at']) || undefined,
      },
      event: {
        eventKinds: coerceArray(event['event-kinds'] as string[] | string | undefined),
        filters:
          event.filters && typeof event.filters === 'object' && !Array.isArray(event.filters)
            ? (event.filters as Record<string, JsonValue>)
            : undefined,
        sourceScope:
          event['source-scope'] && typeof event['source-scope'] === 'object' && !Array.isArray(event['source-scope'])
            ? (event['source-scope'] as Record<string, JsonValue>)
            : undefined,
      },
    }
  }
  return undefined
}

function sanitizeAutomationActions(actions: unknown): AutomationRecord['actions'] | undefined {
  if (!Array.isArray(actions)) return undefined
  return actions
    .filter((action) => action && typeof action === 'object' && !Array.isArray(action))
    .map((action) => {
      const record = action as Record<string, unknown>
      return {
        type: 'command' as const,
        command: asString(record.command, ''),
        ...(record.args ? { args: coerceArray(record.args as string[] | string) } : {}),
        ...(record.options && typeof record.options === 'object' && !Array.isArray(record.options)
          ? { options: record.options as Record<string, JsonValue> }
          : {}),
        ...(record.summary ? { summary: asString(record.summary) } : {}),
      }
    })
    .filter((action) => action.command.length > 0)
}

function toActivitySummary(events: ActivityRecord[], summary: string) {
  return {
    summary,
    counts: summarizeCounts(events.map((event) => event.kind)),
  }
}

function toDetailedActivityStats(events: ActivityRecord[]) {
  return {
    summary: `Activity stream contains ${events.length} event(s).`,
    counts: {
      ...Object.fromEntries(Object.entries(summarizeCounts(events.map((event) => event.kind))).map(([key, value]) => [`kind:${key}`, value])),
      ...Object.fromEntries(Object.entries(summarizeCounts(events.map((event) => event.status))).map(([key, value]) => [`status:${key}`, value])),
      ...Object.fromEntries(Object.entries(summarizeCounts(events.map((event) => event.actor))).map(([key, value]) => [`actor:${key}`, value])),
    },
  }
}

function summarizeSyncStatus(state: OriginState) {
  return {
    summary: `${state.sync.replicaPeers.length} replica peer(s), ${state.sync.replicaJobs.length} replica job(s), ${state.sync.providerJobs.length} provider job(s), ${state.sync.providerOutbox.length} queued outbox item(s), ${state.workspace.bridgeJobs.length} bridge job(s).`,
    replica: `${state.sync.replicaPeers.length} peer(s), ${state.sync.replicaConflicts.length} conflict(s), ${state.sync.replicaJobs.filter((job) => job.status === 'failed').length} failed job(s).`,
    provider: `${state.sync.providerJobs.length} job(s), ${state.sync.providerOutbox.length} outbox item(s).`,
    outbox: `${state.sync.providerOutbox.length} queued item(s).`,
    bridge: `${state.workspace.bridgeJobs.length} job(s), bridge status: ${state.workspace.bridgeStatus}.`,
  }
}

function summarizeBridgeStatus(state: OriginState) {
  return {
    summary: `${state.workspace.bridgeJobs.length} bridge job(s), bridge status ${state.workspace.bridgeStatus}.`,
    replica: `${state.sync.replicaPeers.length} peer(s), ${state.sync.replicaConflicts.length} conflict(s).`,
    provider: `${state.sync.providerJobs.length} provider job(s), ${state.sync.providerOutbox.length} provider outbox item(s).`,
    outbox: `${state.sync.providerOutbox.length} queued item(s).`,
    bridge: `${state.workspace.bridgeJobs.length} bridge job(s), bridge status: ${state.workspace.bridgeStatus}.`,
  }
}

function summarizeEntity(record: EntitySummary, limit = 160) {
  return toEntitySummary({
    ...record,
    summary: record.summary?.slice(0, limit),
  })
}

function buildEntityRegistry(state: OriginState): EntitySummary[] {
  const items: EntitySummary[] = []

  for (const project of state.planning.projects) {
    items.push({
      kind: 'project',
      id: project.id,
      title: project.name,
      summary: compactSummary(project.description, project.status),
      aliases: [project.name],
    })
  }

  for (const label of state.planning.labels) {
    items.push({
      kind: 'label',
      id: label.id,
      title: label.name,
      summary: label.color ?? undefined,
      aliases: [label.name],
    })
  }

  for (const task of state.planning.tasks) {
    items.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      summary: compactSummary(task.descriptionMd, task.status),
      aliases: [task.title],
    })
  }

  for (const item of state.planning.calendarItems) {
    items.push({
      kind: 'calendar-item',
      id: item.id,
      title: item.title,
      summary: compactSummary(item.descriptionMd, item.status),
      aliases: [item.title],
    })
  }

  for (const note of state.notes.notes) {
    items.push({
      kind: 'note',
      id: note.id,
      title: note.title,
      summary: compactSummary(note.content, note.path),
      aliases: [note.path, note.title],
    })
  }

  for (const account of state.email.accounts) {
    items.push({
      kind: 'email-account',
      id: account.id,
      title: account.address,
      summary: account.summary,
      aliases: [account.address],
    })
  }

  for (const thread of state.email.threads) {
    items.push({
      kind: 'email-thread',
      id: thread.id,
      title: thread.subject,
      summary: thread.status,
      aliases: [thread.subject],
    })
  }

  for (const repository of state.github.repositories) {
    items.push({
      kind: 'github-repository',
      id: repository.id,
      title: repository.name,
      summary: repository.summary,
      aliases: [repository.name],
    })
  }

  for (const issue of state.github.issues) {
    items.push({
      kind: 'github-issue',
      id: issue.id,
      title: issue.title,
      summary: issue.summary,
      aliases: [issue.ref, issue.title],
    })
  }

  for (const pr of state.github.pullRequests) {
    items.push({
      kind: 'github-pull-request',
      id: pr.id,
      title: pr.title,
      summary: pr.summary,
      aliases: [pr.ref, pr.title],
    })
  }

  for (const follow of state.github.follows) {
    items.push({
      kind: 'github-follow',
      id: follow.id,
      title: follow.repo,
      summary: follow.reason ?? follow.kind,
      aliases: [follow.targetRef ?? follow.repo],
    })
  }

  for (const chat of state.telegram.chats) {
    items.push({
      kind: 'telegram-chat',
      id: chat.id,
      title: chat.title,
      summary: chat.summary,
      aliases: [chat.title],
    })
  }

  for (const group of state.telegram.groups) {
    items.push({
      kind: 'telegram-group',
      id: group.chatId,
      title: group.chatId,
      summary: group.summary ?? 'Telegram group policy',
      aliases: [group.chatId],
    })
  }

  for (const summary of state.telegram.summaries) {
    items.push({
      kind: 'telegram-summary',
      id: summary.id,
      title: summary.summary,
      summary: summary.status,
      aliases: [summary.chatId],
    })
  }

  for (const automation of state.automations.automations) {
    items.push({
      kind: 'automation',
      id: automation.id,
      title: automation.title,
      summary: automation.summary,
      aliases: [automation.title],
    })
  }

  for (const run of state.automations.runs) {
    items.push({
      kind: 'automation-run',
      id: run.id,
      title: run.summary,
      summary: run.status,
      aliases: [run.automationId],
    })
  }

  for (const notification of state.notifications.items) {
    items.push({
      kind: 'notification',
      id: notification.id,
      title: notification.title,
      summary: notification.kind,
      aliases: [notification.title],
    })
  }

  for (const device of state.notifications.devices) {
    items.push({
      kind: 'notification-device',
      id: device.id,
      title: device.kind,
      summary: device.summary,
      aliases: [device.kind],
    })
  }

  for (const delivery of state.notifications.deliveries) {
    items.push({
      kind: 'notification-delivery',
      id: delivery.id,
      title: delivery.summary,
      summary: delivery.status,
      aliases: [delivery.notificationId],
    })
  }

  for (const peer of state.sync.replicaPeers) {
    items.push({
      kind: 'sync-peer',
      id: peer.id,
      title: peer.kind,
      summary: peer.summary,
      aliases: [peer.kind],
    })
  }

  for (const job of state.sync.replicaJobs) {
    items.push({
      kind: 'sync-job',
      id: job.id,
      title: job.kind,
      summary: job.summary,
      aliases: [job.kind],
    })
  }

  for (const conflict of state.sync.replicaConflicts) {
    items.push({
      kind: 'sync-conflict',
      id: conflict.id,
      title: conflict.kind,
      summary: conflict.summary,
      aliases: [conflict.kind],
    })
  }

  for (const item of state.sync.providerOutbox) {
    items.push({
      kind: 'outbox-item',
      id: item.id,
      title: item.kind,
      summary: item.summary,
      aliases: [item.kind],
    })
  }

  for (const job of state.workspace.bridgeJobs) {
    items.push({
      kind: 'bridge-job',
      id: job.id,
      title: job.summary,
      summary: job.status,
      aliases: [job.id],
    })
  }

  return items
}

function resolveEntity(state: OriginState, query: string) {
  const registry = buildEntityRegistry(state)
  const exact = registry.find((item) =>
    item.id === query ||
    item.title === query ||
    item.aliases.some((alias) => alias === query),
  )
  if (exact) return exact

  const scored = registry
    .map((item) => {
      const score = Math.max(
        scoreText(query, item.id),
        scoreText(query, item.title),
        scoreText(query, item.summary ?? ''),
      )
      return { item, score }
    })
    .sort((left, right) => right.score - left.score)
  return scored[0]?.score && scored[0].score > 0.5 ? scored[0].item : undefined
}

function resolveEntityRecord(state: OriginState, query: string) {
  const entity = resolveEntity(state, query)
  if (!entity) return undefined

  const note = state.notes.notes.find((item) => item.id === entity.id)
  if (note) return { kind: 'note', record: note }

  const project = state.planning.projects.find((item) => item.id === entity.id)
  if (project) return { kind: 'project', record: project }

  const label = state.planning.labels.find((item) => item.id === entity.id)
  if (label) return { kind: 'label', record: label }

  const task = state.planning.tasks.find((item) => item.id === entity.id)
  if (task) return { kind: 'task', record: task }

  const calendarItem = state.planning.calendarItems.find((item) => item.id === entity.id)
  if (calendarItem) return { kind: 'calendar-item', record: calendarItem }

  const emailAccount = state.email.accounts.find((item) => item.id === entity.id)
  if (emailAccount) return { kind: 'email-account', record: emailAccount }

  const emailThread = state.email.threads.find((item) => item.id === entity.id)
  if (emailThread) return { kind: 'email-thread', record: emailThread }

  const repository = state.github.repositories.find((item) => item.id === entity.id)
  if (repository) return { kind: 'github-repository', record: repository }

  const issue = state.github.issues.find((item) => item.id === entity.id)
  if (issue) return { kind: 'github-issue', record: issue }

  const pr = state.github.pullRequests.find((item) => item.id === entity.id)
  if (pr) return { kind: 'github-pull-request', record: pr }

  const follow = state.github.follows.find((item) => item.id === entity.id)
  if (follow) return { kind: 'github-follow', record: follow }

  const chat = state.telegram.chats.find((item) => item.id === entity.id)
  if (chat) return { kind: 'telegram-chat', record: chat }

  const group = state.telegram.groups.find((item) => item.chatId === entity.id)
  if (group) return { kind: 'telegram-group', record: group }

  const summary = state.telegram.summaries.find((item) => item.id === entity.id)
  if (summary) return { kind: 'telegram-summary', record: summary }

  const automation = state.automations.automations.find((item) => item.id === entity.id)
  if (automation) return { kind: 'automation', record: automation }

  const run = state.automations.runs.find((item) => item.id === entity.id)
  if (run) return { kind: 'automation-run', record: run }

  const notification = state.notifications.items.find((item) => item.id === entity.id)
  if (notification) return { kind: 'notification', record: notification }

  const device = state.notifications.devices.find((item) => item.id === entity.id)
  if (device) return { kind: 'notification-device', record: device }

  const delivery = state.notifications.deliveries.find((item) => item.id === entity.id)
  if (delivery) return { kind: 'notification-delivery', record: delivery }

  const peer = state.sync.replicaPeers.find((item) => item.id === entity.id)
  if (peer) return { kind: 'sync-peer', record: peer }

  const job = state.sync.replicaJobs.find((item) => item.id === entity.id)
  if (job) return { kind: 'sync-job', record: job }

  const conflict = state.sync.replicaConflicts.find((item) => item.id === entity.id)
  if (conflict) return { kind: 'sync-conflict', record: conflict }

  const outbox = state.sync.providerOutbox.find((item) => item.id === entity.id)
  if (outbox) return { kind: 'outbox-item', record: outbox }

  const bridgeJob = state.workspace.bridgeJobs.find((item) => item.id === entity.id)
  if (bridgeJob) return { kind: 'bridge-job', record: bridgeJob }

  return undefined
}

function relatedEntityIds(state: OriginState, entityId: string) {
  const ids = new Set<string>()

  for (const link of state.entityLinks) {
    if (link.from === entityId) ids.add(link.to)
    if (link.to === entityId) ids.add(link.from)
  }

  const task = state.planning.tasks.find((item) => item.id === entityId)
  if (task) {
    task.projectId && ids.add(task.projectId)
    for (const labelId of task.labelIds) ids.add(labelId)
    for (const itemId of task.calendarItemIds) ids.add(itemId)
    task.noteId && ids.add(task.noteId)
    for (const blocker of task.blockedBy) ids.add(blocker)
  }

  const calendarItem = state.planning.calendarItems.find((item) => item.id === entityId)
  if (calendarItem) {
    calendarItem.projectId && ids.add(calendarItem.projectId)
    for (const labelId of calendarItem.labelIds) ids.add(labelId)
    for (const taskId of calendarItem.taskIds) ids.add(taskId)
  }

  const note = state.notes.notes.find((item) => item.id === entityId)
  if (note) {
    for (const attachment of note.attachments) ids.add(attachment.path)
  }

  const thread = state.email.threads.find((item) => item.id === entityId)
  if (thread) {
    for (const taskId of thread.linkedTaskIds) ids.add(taskId)
  }

  const follow = state.github.follows.find((item) => item.id === entityId)
  if (follow) {
    for (const taskId of follow.linkedTaskIds) ids.add(taskId)
    for (const noteId of follow.linkedNoteIds) ids.add(noteId)
    follow.targetRef && ids.add(follow.targetRef)
  }

  const automation = state.automations.automations.find((item) => item.id === entityId)
  if (automation) {
    for (const action of automation.actions ?? []) {
      for (const arg of action.args ?? []) ids.add(arg)
    }
  }

  return [...ids]
}

function historyEntriesForEntity(state: OriginState, entityId: string) {
  const record = resolveEntityRecord(state, entityId)
  if (!record) return []
  const source = record.record as
    | NoteRecord
    | ProjectRecord
    | LabelRecord
    | TaskRecord
    | CalendarItemRecord
    | undefined
  if (source && 'history' in source) {
    return source.history.map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      at: entry.at,
      summary: entry.summary,
    }))
  }
  return []
}

function automationRunsForAutomation(state: OriginState, automationId?: string) {
  const runs = automationId
    ? state.automations.runs.filter((run) => run.automationId === automationId)
    : state.automations.runs
  return sortByLatest(runs, latestTime)
}

function automationEventsForAutomation(state: OriginState, automationId?: string) {
  return state.activities.filter((event) => {
    if (!event.kind.startsWith('automation.')) return false
    if (!automationId) return true
    return event.target === automationId || event.entityRefs?.includes(automationId) || event.sourceRefs?.includes(automationId)
  })
}

function runEventsForTrace(state: OriginState, run: AutomationRunRecord) {
  if (!run.traceId) return []
  return state.activities.filter((event) => event.traceId === run.traceId || run.eventIds.includes(event.id))
}

function activityMatchesQuery(record: ActivityRecord, query: string) {
  const haystack = [
    record.id,
    record.kind,
    record.status,
    record.actor,
    record.target,
    record.summary,
    record.provider,
    record.pollerId,
    record.traceId,
    ...(record.sourceRefs ?? []),
    ...(record.entityRefs ?? []),
  ]
  return haystack.some((value) => includesQuery(value, query))
}

function activityEventsByDomain(state: OriginState, domains: string[] | undefined) {
  const filters = coerceArray(domains)
  if (filters.length === 0) return state.activities
  return state.activities.filter((event) =>
    filters.some((domain) => event.kind === domain || event.kind.startsWith(`${domain}.`)),
  )
}

function activityEventsInWindow(state: OriginState, since?: string, until?: string, domains?: string[]) {
  return withWindow(activityEventsByDomain(state, domains), (event) => event.at, since, until)
}

function activityExportPayload(events: ActivityRecord[], format: 'json' | 'jsonl' | 'md') {
  if (format === 'jsonl') {
    return events.map((event) => JSON.stringify(toActivityEvent(event))).join('\n')
  }
  if (format === 'md') {
    return [
      '# Origin Activity Export',
      '',
      asMarkdownTable(
        events.map((event) => ({
          id: event.id,
          kind: event.kind,
          status: event.status,
          actor: event.actor,
          at: event.at,
          summary: event.summary,
        })),
      ),
      '',
    ].join('\n')
  }
  return `${JSON.stringify(events.map(toActivityEvent), null, 2)}\n`
}

function simpleSchedulePreview(trigger: AutomationRecord['trigger'], count = 3) {
  if (!trigger) return []
  const source = trigger.type === 'hybrid' ? trigger.schedule : trigger.type === 'schedule' ? trigger : undefined
  if (!source) return []

  const parts = source.cron.trim().split(/\s+/)
  const minute = Number(parts[0] ?? 0)
  const hour = Number(parts[1] ?? 0)
  const dayOfMonth = parts[2] ?? '*'
  const month = parts[3] ?? '*'
  const dayOfWeek = parts[4] ?? '*'
  const nowDate = new Date()
  const start = source.startAt ? new Date(source.startAt) : nowDate
  const end = source.endAt ? new Date(source.endAt) : undefined
  const runs: string[] = []

  if (Number.isInteger(minute) && Number.isInteger(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const cursor = new Date(Math.max(nowDate.getTime(), start.getTime()))
    cursor.setSeconds(0, 0)
    for (let index = 0; runs.length < count && index < 30; index += 1) {
      const candidate = new Date(cursor)
      candidate.setDate(cursor.getDate() + index)
      candidate.setHours(hour, minute, 0, 0)
      if (candidate < start) continue
      if (end && candidate > end) break
      if (candidate > nowDate) runs.push(candidate.toISOString())
    }
  }

  if (runs.length === 0) {
    const base = Math.max(nowDate.getTime(), start.getTime())
    for (let index = 1; runs.length < count && index <= count + 4; index += 1) {
      const candidate = new Date(base + index * 60 * 60 * 1000)
      if (end && candidate > end) break
      runs.push(candidate.toISOString())
    }
  }

  return runs.slice(0, count)
}

function buildAutomationValidationChecks(state: OriginState, automation: AutomationRecord) {
  const checks = [
    {
      id: `automation_${automation.id}_title`,
      kind: 'automation',
      target: automation.id,
      status: automation.title.trim() ? 'pass' : 'fail',
      message: automation.title.trim() ? 'Automation title is set.' : 'Automation title is missing.',
      remediation: automation.title.trim() ? undefined : ['Set a non-empty automation title.'],
    },
    {
      id: `automation_${automation.id}_trigger`,
      kind: 'automation',
      target: automation.id,
      status: automation.trigger ? 'pass' : 'warn',
      message: automation.trigger ? 'Automation trigger is defined.' : 'Automation trigger is missing.',
      remediation: automation.trigger ? undefined : ['Add a trigger definition before enabling the automation.'],
    },
    {
      id: `automation_${automation.id}_actions`,
      kind: 'automation',
      target: automation.id,
      status: (automation.actions?.length ?? 0) > 0 ? 'pass' : 'fail',
      message: (automation.actions?.length ?? 0) > 0 ? 'Automation has actions.' : 'Automation has no actions.',
      remediation: (automation.actions?.length ?? 0) > 0 ? undefined : ['Add at least one command action.'],
    },
    {
      id: `automation_${automation.id}_runs`,
      kind: 'automation',
      target: automation.id,
      status: automationRunsForAutomation(state, automation.id).some((run) => run.status === 'failed') ? 'warn' : 'pass',
      message: automationRunsForAutomation(state, automation.id).some((run) => run.status === 'failed')
        ? 'Recent automation runs include failures.'
        : 'No failed automation runs were found.',
      remediation: automationRunsForAutomation(state, automation.id).some((run) => run.status === 'failed')
        ? ['Inspect failed runs and retry them if appropriate.']
        : undefined,
    },
  ] as const

  return checks.map((check) => ({
    ...check,
    status: check.status,
  }))
}

function automationStatistics(state: OriginState, automation?: AutomationRecord) {
  const automations = automation ? [automation] : state.automations.automations
  const runs = automation ? automationRunsForAutomation(state, automation.id) : state.automations.runs
  return {
    summary: `${automations.length} automation(s), ${runs.length} run(s), ${runs.filter((run) => run.status === 'failed').length} failed run(s).`,
    counts: {
      ...Object.fromEntries(Object.entries(summarizeCounts(automations.map((item) => item.status))).map(([key, value]) => [`automation-status:${key}`, value])),
      ...Object.fromEntries(Object.entries(summarizeCounts(automations.map((item) => item.kind))).map(([key, value]) => [`automation-kind:${key}`, value])),
      ...Object.fromEntries(Object.entries(summarizeCounts(runs.map((run) => run.status))).map(([key, value]) => [`run-status:${key}`, value])),
    },
  }
}

function createAutomationExecution(
  state: OriginState,
  automation: AutomationRecord,
  summary: string,
  status: AutomationRunRecord['status'],
  reason: string,
) {
  const traceId = nextId(state, 'trace')
  const startEvent = addActivity(state, {
    kind: 'automation.run.start',
    status: 'started',
    actor: 'origin/automation',
    target: automation.id,
    summary: `${automation.title}: ${summary}`,
    severity: 'info',
    traceId,
    entityRefs: [automation.id],
  })
  const completeEvent = addActivity(state, {
    kind: status === 'failed' ? 'automation.run.failed' : 'automation.run.completed',
    status: status === 'failed' ? 'failed' : 'completed',
    actor: 'origin/automation',
    target: automation.id,
    summary: `${automation.title}: ${summary}`,
    severity: status === 'failed' ? 'error' : 'info',
    traceId,
    entityRefs: [automation.id],
  })
  const run: AutomationRunRecord = {
    id: nextId(state, 'run'),
    automationId: automation.id,
    status,
    summary,
    triggeredAt: now(),
    scheduledAt: now(),
    triggerReason: reason,
    startedAt: startEvent.at,
    endedAt: completeEvent.at,
    traceId,
    steps: [
      {
        id: nextId(state, 'step'),
        kind: 'command',
        status: 'completed',
        summary: 'Automation execution started.',
      },
      {
        id: nextId(state, 'step'),
        kind: 'command',
        status,
        summary,
      },
    ],
    eventIds: [startEvent.id, completeEvent.id],
  }
  state.automations.runs.unshift(run)
  return { run, traceId, activityIds: [startEvent.id, completeEvent.id] }
}

function createBackfillRuns(state: OriginState, automation: AutomationRecord, from?: string, to?: string) {
  const runs: AutomationRunRecord[] = []
  const start = from ? new Date(from) : new Date(Date.now() - DAY_IN_MS)
  const end = to ? new Date(to) : new Date()
  const totalDays = Math.max(1, Math.min(10, Math.ceil(Math.max(0, end.getTime() - start.getTime()) / DAY_IN_MS) || 1))
  for (let index = 0; index < totalDays; index += 1) {
    const { run } = createAutomationExecution(
      state,
      automation,
      `Backfilled missed run ${index + 1} of ${totalDays}.`,
      'completed',
      'backfill',
    )
    runs.push(run)
  }
  return runs
}

function mutateAutomationRunStatus(run: AutomationRunRecord, status: AutomationRunRecord['status']) {
  run.status = status
  run.endedAt = now()
}

function normalizeTimeRange(options: { since?: string; until?: string }) {
  return {
    since: options.since,
    until: options.until,
  }
}

function matchesEntityQuery(entity: EntitySummary, query: string) {
  return [
    entity.id,
    entity.kind,
    entity.title,
    entity.summary,
    ...entity.aliases,
  ].some((value) => includesQuery(value, query))
}

function entityDisplay(record: ReturnType<typeof resolveEntityRecord>) {
  if (!record) return undefined
  const item = record.record as Record<string, unknown>
  switch (record.kind) {
    case 'note':
      return summarizeEntity({
        kind: 'note',
        id: asString(item.id),
        title: asString(item.title),
        summary: compactSummary(asString(item.content), asString(item.path)),
        aliases: [asString(item.path), asString(item.title)],
      })
    case 'project':
      return summarizeEntity({
        kind: 'project',
        id: asString(item.id),
        title: asString(item.name),
        summary: compactSummary(asString(item.description), asString(item.status)),
        aliases: [asString(item.name)],
      })
    case 'label':
      return summarizeEntity({
        kind: 'label',
        id: asString(item.id),
        title: asString(item.name),
        summary: asString(item.color, ''),
        aliases: [asString(item.name)],
      })
    case 'task':
      return summarizeEntity({
        kind: 'task',
        id: asString(item.id),
        title: asString(item.title),
        summary: compactSummary(asString(item.descriptionMd), asString(item.status)),
        aliases: [asString(item.title)],
      })
    case 'calendar-item':
      return summarizeEntity({
        kind: 'calendar-item',
        id: asString(item.id),
        title: asString(item.title),
        summary: compactSummary(asString(item.descriptionMd), asString(item.status)),
        aliases: [asString(item.title)],
      })
    case 'email-account':
      return summarizeEntity({
        kind: 'email-account',
        id: asString(item.id),
        title: asString(item.address),
        summary: asString(item.summary),
        aliases: [asString(item.address)],
      })
    case 'email-thread':
      return summarizeEntity({
        kind: 'email-thread',
        id: asString(item.id),
        title: asString(item.subject),
        summary: asString(item.status),
        aliases: [asString(item.subject)],
      })
    case 'github-repository':
      return summarizeEntity({
        kind: 'github-repository',
        id: asString(item.id),
        title: asString(item.name),
        summary: asString(item.summary),
        aliases: [asString(item.name)],
      })
    case 'github-issue':
      return summarizeEntity({
        kind: 'github-issue',
        id: asString(item.id),
        title: asString(item.title),
        summary: asString(item.summary),
        aliases: [asString(item.ref), asString(item.title)],
      })
    case 'github-pull-request':
      return summarizeEntity({
        kind: 'github-pull-request',
        id: asString(item.id),
        title: asString(item.title),
        summary: asString(item.summary),
        aliases: [asString(item.ref), asString(item.title)],
      })
    case 'github-follow':
      return summarizeEntity({
        kind: 'github-follow',
        id: asString(item.id),
        title: asString(item.repo),
        summary: asString(item.reason ?? item.kind),
        aliases: [asString(item.targetRef ?? item.repo)],
      })
    case 'telegram-chat':
      return summarizeEntity({
        kind: 'telegram-chat',
        id: asString(item.id),
        title: asString(item.title),
        summary: asString(item.summary),
        aliases: [asString(item.title)],
      })
    case 'telegram-group':
      return summarizeEntity({
        kind: 'telegram-group',
        id: asString(item.chatId),
        title: asString(item.chatId),
        summary: asString(item.summary ?? 'Telegram group policy'),
        aliases: [asString(item.chatId)],
      })
    case 'telegram-summary':
      return summarizeEntity({
        kind: 'telegram-summary',
        id: asString(item.id),
        title: asString(item.summary),
        summary: asString(item.status),
        aliases: [asString(item.chatId)],
      })
    case 'automation':
      return summarizeEntity({
        kind: 'automation',
        id: asString(item.id),
        title: asString(item.title),
        summary: asString(item.summary),
        aliases: [asString(item.title)],
      })
    case 'automation-run':
      return summarizeEntity({
        kind: 'automation-run',
        id: asString(item.id),
        title: asString(item.summary),
        summary: asString(item.status),
        aliases: [asString(item.automationId)],
      })
    case 'notification':
      return summarizeEntity({
        kind: 'notification',
        id: asString(item.id),
        title: asString(item.title),
        summary: asString(item.kind),
        aliases: [asString(item.title)],
      })
    case 'notification-device':
      return summarizeEntity({
        kind: 'notification-device',
        id: asString(item.id),
        title: asString(item.kind),
        summary: asString(item.summary),
        aliases: [asString(item.kind)],
      })
    case 'notification-delivery':
      return summarizeEntity({
        kind: 'notification-delivery',
        id: asString(item.id),
        title: asString(item.summary),
        summary: asString(item.status),
        aliases: [asString(item.notificationId)],
      })
    case 'sync-peer':
      return summarizeEntity({
        kind: 'sync-peer',
        id: asString(item.id),
        title: asString(item.kind),
        summary: asString(item.summary),
        aliases: [asString(item.kind)],
      })
    case 'sync-job':
      return summarizeEntity({
        kind: 'sync-job',
        id: asString(item.id),
        title: asString(item.kind),
        summary: asString(item.summary),
        aliases: [asString(item.kind)],
      })
    case 'sync-conflict':
      return summarizeEntity({
        kind: 'sync-conflict',
        id: asString(item.id),
        title: asString(item.kind),
        summary: asString(item.summary),
        aliases: [asString(item.kind)],
      })
    case 'outbox-item':
      return summarizeEntity({
        kind: 'outbox-item',
        id: asString(item.id),
        title: asString(item.kind),
        summary: asString(item.summary),
        aliases: [asString(item.kind)],
      })
    case 'bridge-job':
      return summarizeEntity({
        kind: 'bridge-job',
        id: asString(item.id),
        title: asString(item.summary),
        summary: asString(item.status),
        aliases: [asString(item.id)],
      })
    default:
      return undefined
  }
}

function allAutomationEvents(state: OriginState, automationId?: string) {
  return automationEventsForAutomation(state, automationId)
}

function buildAutomationRunEvents(state: OriginState, run: AutomationRunRecord) {
  const events = runEventsForTrace(state, run)
  return sortByLatest(events, (event) => event.at)
}

function listEntityRelations(state: OriginState, entityId: string, limit?: number) {
  const ids = relatedEntityIds(state, entityId)
  const entities = ids
    .map((id) => resolveEntityRecord(state, id))
    .filter(Boolean)
    .map((record) => entityDisplay(record))
    .filter(Boolean) as EntitySummary[]
  return takeLimit(entities, limit)
}

function maybeResolveAutomation(state: OriginState, automationId: string) {
  return state.automations.automations.find((automation) => automation.id === automationId)
}

function maybeResolveAutomationRun(state: OriginState, runId: string) {
  return state.automations.runs.find((run) => run.id === runId)
}

function maybeResolveNotification(state: OriginState, notificationId: string) {
  return state.notifications.items.find((notification) => notification.id === notificationId)
}

function maybeResolveNotificationDevice(state: OriginState, deviceId: string) {
  return state.notifications.devices.find((device) => device.id === deviceId)
}

function maybeResolveDelivery(state: OriginState, deliveryId: string) {
  return state.notifications.deliveries.find((delivery) => delivery.id === deliveryId)
}

function maybeResolveSyncPeer(state: OriginState, peerId: string) {
  return state.sync.replicaPeers.find((peer) => peer.id === peerId)
}

function maybeResolveSyncJob(state: OriginState, jobId: string) {
  return state.sync.replicaJobs.find((job) => job.id === jobId)
}

function maybeResolveOutboxItem(state: OriginState, itemId: string) {
  return state.sync.providerOutbox.find((item) => item.id === itemId)
}

function maybeResolveExternalActionIntent(state: OriginState, intentId: string) {
  return externalActionIntentSources(state).find((source) => source.item.id === intentId)
}

function maybeResolveConflict(state: OriginState, conflictId: string) {
  return state.sync.replicaConflicts.find((conflict) => conflict.id === conflictId)
}

function maybeResolveBridgeJob(state: OriginState, jobId: string) {
  return state.workspace.bridgeJobs.find((job) => job.id === jobId)
}

function formatNotificationPreferenceValues(values: Record<string, JsonValue>) {
  return { values }
}

function automationListView(state: OriginState, options: { status?: string[]; trigger?: string[]; linkedTask?: string[]; limit?: number }) {
  let items = state.automations.automations

  if (options.status?.length) {
    items = items.filter((automation) => {
      const status = toPublicAutomationStatus(automation.status)
      return options.status!.some((filter) => {
        const normalizedFilter = filter === 'enabled' ? 'active' : filter
        return status === normalizedFilter
      })
    })
  }

  if (options.trigger?.length) {
    items = items.filter((automation) =>
      options.trigger!.some((filter) =>
        matchesAnyQuery([automation.kind, automation.trigger?.type, automation.trigger?.type === 'hybrid' ? automation.trigger.schedule.cron : undefined], filter) ||
        matchesAnyQuery([automation.title, automation.summary], filter),
      ),
    )
  }

  if (options.linkedTask?.length) {
    items = items.filter((automation) =>
      options.linkedTask!.some((taskId) =>
        automation.actions?.some((action) =>
          [action.command, ...(action.args ?? []), ...Object.values(action.options ?? {}).map((value) => asString(value))].some((value) =>
            includesQuery(value, taskId),
          ),
        ) ?? false,
      ),
    )
  }

  const sorted = sortByLatest(items, (automation) => automation.id)
  return takeLimit(sorted, options.limit)
}

function listAutomationRuns(state: OriginState, options: { automationId?: string; since?: string; until?: string; limit?: number }) {
  const items = automationRunsForAutomation(state, options.automationId)
    .filter((run) => withinWindow(latestTime(run), options.since, options.until))
  return takeLimit(items, options.limit)
}

function listNotificationDeliveries(
  state: OriginState,
  options: { limit?: number; status?: string[]; since?: string; until?: string },
) {
  let items = state.notifications.deliveries
  if (options.status?.length) {
    items = items.filter((delivery) => matchesFilters([delivery.status], options.status))
  }
  return takeLimit(items, options.limit)
}

function listSyncJobs(items: SyncJobRecord[], options: { since?: string; until?: string; limit?: number }) {
  const filtered = items.filter((job) => withinWindow(latestTime(job), options.since, options.until))
  return takeLimit(sortByLatest(filtered, latestTime), options.limit)
}

function listOutboxItems(items: OutboxItemRecord[], options: { kind?: string[]; status?: string[]; limit?: number }) {
  let filtered = [...items]
  if (options.kind?.length) {
    filtered = filtered.filter((item) => matchesFilters([item.kind], options.kind))
  }
  if (options.status?.length) {
    filtered = filtered.filter((item) => matchesFilters([item.status], options.status))
  }
  return takeLimit(filtered, options.limit)
}

function listReplicaConflicts(conflicts: SyncConflictRecord[], limit?: number) {
  return takeLimit(conflicts, limit)
}

function historyList(entries: Array<{ id: string; actor: string; at: string; summary: string }>, since?: string, until?: string) {
  return selectWindow(entries, since, until)
}

function exportFileName(prefix: string, extension: string) {
  return `${prefix}-${Date.now()}.${extension}`
}

function applySnapshotToTask(task: TaskRecord, snapshot: Record<string, JsonValue>) {
  if (typeof snapshot.title === 'string') task.title = snapshot.title
  if (typeof snapshot.status === 'string') task.status = snapshot.status
  if (typeof snapshot.priority === 'string') task.priority = snapshot.priority
  if (typeof snapshot.projectId === 'string' || snapshot.projectId === null) task.projectId = (snapshot.projectId as string | undefined) ?? undefined
  if (Array.isArray(snapshot.labelIds)) task.labelIds = snapshot.labelIds.filter((value): value is string => typeof value === 'string')
  if (typeof snapshot.descriptionMd === 'string' || snapshot.descriptionMd === null) task.descriptionMd = (snapshot.descriptionMd as string | undefined) ?? undefined
  if (typeof snapshot.noteId === 'string' || snapshot.noteId === null) task.noteId = (snapshot.noteId as string | undefined) ?? undefined
  if (Array.isArray(snapshot.calendarItemIds)) task.calendarItemIds = snapshot.calendarItemIds.filter((value): value is string => typeof value === 'string')
  if (typeof snapshot.dueKind === 'string' || snapshot.dueKind === null) task.dueKind = (snapshot.dueKind as TaskRecord['dueKind'] | undefined) ?? undefined
  if (typeof snapshot.dueFrom === 'string' || snapshot.dueFrom === null) task.dueFrom = (snapshot.dueFrom as string | undefined) ?? undefined
  if (typeof snapshot.dueAt === 'string' || snapshot.dueAt === null) task.dueAt = (snapshot.dueAt as string | undefined) ?? undefined
  if (typeof snapshot.dueTimezone === 'string' || snapshot.dueTimezone === null) task.dueTimezone = (snapshot.dueTimezone as string | undefined) ?? undefined
  if (Array.isArray(snapshot.blockedBy)) task.blockedBy = snapshot.blockedBy.filter((value): value is string => typeof value === 'string')
  if (typeof snapshot.archived === 'boolean' || snapshot.archived === null) task.archived = (snapshot.archived as boolean | undefined) ?? undefined
}

function applySnapshotToProject(project: ProjectRecord, snapshot: Record<string, JsonValue>) {
  if (typeof snapshot.name === 'string') project.name = snapshot.name
  if (typeof snapshot.status === 'string') project.status = snapshot.status
  if (typeof snapshot.description === 'string' || snapshot.description === null) project.description = (snapshot.description as string | undefined) ?? undefined
  if (typeof snapshot.archived === 'boolean' || snapshot.archived === null) project.archived = (snapshot.archived as boolean | undefined) ?? undefined
}

function applySnapshotToLabel(label: LabelRecord, snapshot: Record<string, JsonValue>) {
  if (typeof snapshot.name === 'string') label.name = snapshot.name
  if (typeof snapshot.color === 'string' || snapshot.color === null) label.color = (snapshot.color as string | undefined) ?? undefined
  if (typeof snapshot.archived === 'boolean' || snapshot.archived === null) label.archived = (snapshot.archived as boolean | undefined) ?? undefined
}

function applySnapshotToCalendarItem(item: CalendarItemRecord, snapshot: Record<string, JsonValue>) {
  if (typeof snapshot.title === 'string') item.title = snapshot.title
  if (typeof snapshot.status === 'string') item.status = snapshot.status
  if (typeof snapshot.kind === 'string' || snapshot.kind === null) item.kind = (snapshot.kind as string | undefined) ?? undefined
  if (typeof snapshot.projectId === 'string' || snapshot.projectId === null) item.projectId = (snapshot.projectId as string | undefined) ?? undefined
  if (Array.isArray(snapshot.labelIds)) item.labelIds = snapshot.labelIds.filter((value): value is string => typeof value === 'string')
  if (typeof snapshot.descriptionMd === 'string' || snapshot.descriptionMd === null) item.descriptionMd = (snapshot.descriptionMd as string | undefined) ?? undefined
  if (typeof snapshot.location === 'string' || snapshot.location === null) item.location = (snapshot.location as string | undefined) ?? undefined
  if (typeof snapshot.startDate === 'string' || snapshot.startDate === null) item.startDate = (snapshot.startDate as string | undefined) ?? undefined
  if (typeof snapshot.endDateExclusive === 'string' || snapshot.endDateExclusive === null) item.endDateExclusive = (snapshot.endDateExclusive as string | undefined) ?? undefined
  if (typeof snapshot.startAt === 'string' || snapshot.startAt === null) item.startAt = (snapshot.startAt as string | undefined) ?? undefined
  if (typeof snapshot.endAt === 'string' || snapshot.endAt === null) item.endAt = (snapshot.endAt as string | undefined) ?? undefined
  if (typeof snapshot.timezone === 'string' || snapshot.timezone === null) item.timezone = (snapshot.timezone as string | undefined) ?? undefined
  if (typeof snapshot.allDay === 'boolean' || snapshot.allDay === null) item.allDay = (snapshot.allDay as boolean | undefined) ?? undefined
  if (Array.isArray(snapshot.taskIds)) item.taskIds = snapshot.taskIds.filter((value): value is string => typeof value === 'string')
  if (typeof snapshot.archived === 'boolean' || snapshot.archived === null) item.archived = (snapshot.archived as boolean | undefined) ?? undefined
}

function restoreEntityFromRevision(state: OriginState, entityId: string, revisionId: string) {
  const note = state.notes.notes.find((item) => item.id === entityId)
  if (note) {
    const revision = note.revisions.find((entry) => entry.id === revisionId)
    if (!revision) return undefined
    const previousContent = note.content
    if (revision.content !== undefined) {
      note.content = revision.content
      note.updatedAt = now()
      const nextRevisionId = nextId(state, 'rev')
      note.revisions = recordRevision(note.revisions, {
        id: nextRevisionId,
        actor: 'origin/operator',
        at: now(),
        summary: `Restored revision ${revisionId}.`,
        diff: createRevisionDiff(previousContent, note.content),
        content: note.content,
      })
      note.history.push(createHistoryEntry(state, 'origin/operator', `Restored revision ${revisionId}.`, nextRevisionId))
      return true
    }
  }

  const project = state.planning.projects.find((item) => item.id === entityId)
  if (project) {
    const revision = project.revisions.find((entry) => entry.id === revisionId)
    if (!revision || !revision.snapshot) return undefined
    const before = JSON.stringify({
      name: project.name,
      status: project.status,
      description: project.description,
      archived: project.archived,
    })
    applySnapshotToProject(project, revision.snapshot)
    const nextRevisionId = nextId(state, 'rev')
    project.revisions = recordRevision(project.revisions, {
      id: nextRevisionId,
      actor: 'origin/operator',
      at: now(),
      summary: `Restored revision ${revisionId}.`,
      diff: createRevisionDiff(before, JSON.stringify(revision.snapshot), ['snapshot']),
      snapshot: revision.snapshot,
    })
    project.history.push(createHistoryEntry(state, 'origin/operator', `Restored revision ${revisionId}.`, nextRevisionId))
    return true
  }

  const label = state.planning.labels.find((item) => item.id === entityId)
  if (label) {
    const revision = label.revisions.find((entry) => entry.id === revisionId)
    if (!revision || !revision.snapshot) return undefined
    const before = JSON.stringify({ name: label.name, color: label.color, archived: label.archived })
    applySnapshotToLabel(label, revision.snapshot)
    const nextRevisionId = nextId(state, 'rev')
    label.revisions = recordRevision(label.revisions, {
      id: nextRevisionId,
      actor: 'origin/operator',
      at: now(),
      summary: `Restored revision ${revisionId}.`,
      diff: createRevisionDiff(before, JSON.stringify(revision.snapshot), ['snapshot']),
      snapshot: revision.snapshot,
    })
    label.history.push(createHistoryEntry(state, 'origin/operator', `Restored revision ${revisionId}.`, nextRevisionId))
    return true
  }

  const task = state.planning.tasks.find((item) => item.id === entityId)
  if (task) {
    const revision = task.revisions.find((entry) => entry.id === revisionId)
    if (!revision || !revision.snapshot) return undefined
    const before = JSON.stringify({
      title: task.title,
      status: task.status,
      priority: task.priority,
      projectId: task.projectId,
      labelIds: task.labelIds,
      descriptionMd: task.descriptionMd,
      noteId: task.noteId,
      calendarItemIds: task.calendarItemIds,
      dueKind: task.dueKind,
      dueFrom: task.dueFrom,
      dueAt: task.dueAt,
      dueTimezone: task.dueTimezone,
      blockedBy: task.blockedBy,
      archived: task.archived,
    })
    applySnapshotToTask(task, revision.snapshot)
    const nextRevisionId = nextId(state, 'rev')
    task.revisions = recordRevision(task.revisions, {
      id: nextRevisionId,
      actor: 'origin/operator',
      at: now(),
      summary: `Restored revision ${revisionId}.`,
      diff: createRevisionDiff(before, JSON.stringify(revision.snapshot), ['snapshot']),
      snapshot: revision.snapshot,
    })
    task.history.push(createHistoryEntry(state, 'origin/operator', `Restored revision ${revisionId}.`, nextRevisionId))
    return true
  }

  const calendarItem = state.planning.calendarItems.find((item) => item.id === entityId)
  if (calendarItem) {
    const revision = calendarItem.revisions.find((entry) => entry.id === revisionId)
    if (!revision || !revision.snapshot) return undefined
    const before = JSON.stringify({
      title: calendarItem.title,
      status: calendarItem.status,
      kind: calendarItem.kind,
      projectId: calendarItem.projectId,
      labelIds: calendarItem.labelIds,
      descriptionMd: calendarItem.descriptionMd,
      location: calendarItem.location,
      startDate: calendarItem.startDate,
      endDateExclusive: calendarItem.endDateExclusive,
      startAt: calendarItem.startAt,
      endAt: calendarItem.endAt,
      timezone: calendarItem.timezone,
      allDay: calendarItem.allDay,
      taskIds: calendarItem.taskIds,
      archived: calendarItem.archived,
    })
    applySnapshotToCalendarItem(calendarItem, revision.snapshot)
    const nextRevisionId = nextId(state, 'rev')
    calendarItem.revisions = recordRevision(calendarItem.revisions, {
      id: nextRevisionId,
      actor: 'origin/operator',
      at: now(),
      summary: `Restored revision ${revisionId}.`,
      diff: createRevisionDiff(before, JSON.stringify(revision.snapshot), ['snapshot']),
      snapshot: revision.snapshot,
    })
    calendarItem.history.push(createHistoryEntry(state, 'origin/operator', `Restored revision ${revisionId}.`, nextRevisionId))
    return true
  }

  return undefined
}

function formatEntityHistory(entries: Array<{ id: string; actor: string; at: string; summary: string }>) {
  return entries.map((entry) => ({
    id: entry.id,
    actor: entry.actor,
    at: entry.at,
    summary: entry.summary,
  }))
}

function entityRecordHistory(record: ReturnType<typeof resolveEntityRecord>, since?: string, until?: string) {
  if (!record) return []
  const source = record.record as { history?: Array<{ id: string; actor: string; at: string; summary: string }> }
  return historyList(source.history ?? [], since, until)
}

function listEntityResults(state: OriginState, query: string, limit?: number) {
  return listEntityRelations(state, query, limit).map(toEntitySummary)
}

function entitySourceRecord(state: OriginState, query: string) {
  return resolveEntityRecord(state, query)
}

function createActivityExportPath(runtime: HandlerContext['runtime'], format: 'json' | 'jsonl' | 'md') {
  const extension = format === 'jsonl' ? 'jsonl' : format
  return join(runtime.paths.exportsDir, exportFileName('activity-export', extension))
}

function automationFilterByTask(automation: AutomationRecord, taskId: string) {
  return automation.actions?.some((action) =>
    [action.command, ...(action.args ?? []), ...(Object.values(action.options ?? {}) as JsonValue[]).map((value) => asString(value))].some((value) =>
      includesQuery(value, taskId),
    ),
  ) ?? false
}

function automationQueuedRuns(state: OriginState) {
  return state.automations.runs.filter((run) => run.status === 'queued' || run.status === 'running')
}

function automationDueList(state: OriginState) {
  return state.automations.automations
    .filter((automation) => toPublicAutomationStatus(automation.status) === 'active')
    .sort((left, right) => left.title.localeCompare(right.title))
}

function activityDomainCounts(events: ActivityRecord[]) {
  return summarizeCounts(events.map((event) => event.kind))
}

function activityListView(state: OriginState, options: { since?: string; until?: string; domains?: string[]; limit?: number }) {
  const events = activityEventsInWindow(state, options.since, options.until, options.domains)
  return takeLimit(events, options.limit)
}

function activityRelatedEvents(state: OriginState, query: string) {
  return state.activities.filter((event) => activityMatchesQuery(event, query))
}

function activityPendingEvents(state: OriginState) {
  return state.activities.filter((event) => ['queued', 'pending', 'running', 'in_progress'].includes(event.status))
}

function syncJobsForScope(state: OriginState, scope: 'replica' | 'provider') {
  return scope === 'replica' ? state.sync.replicaJobs : state.sync.providerJobs
}

function syncStatusForScope(state: OriginState, scope: 'replica' | 'provider') {
  return summarizeSyncStatus(state)
}

function addSyncJob(state: OriginState, scope: 'replica' | 'provider', kind: string, summary: string, status: SyncJobRecord['status'] = 'completed') {
  const job: SyncJobRecord = {
    id: nextId(state, 'sync_job'),
    kind,
    status,
    summary,
    traceId: nextId(state, 'trace'),
  }
  if (scope === 'replica') {
    state.sync.replicaJobs.unshift(job)
  } else {
    state.sync.providerJobs.unshift(job)
  }
  return job
}

function addBridgeJob(state: OriginState, summary: string, status = 'completed') {
  const job: BridgeJobRecord = {
    id: nextId(state, 'bridge'),
    status,
    summary,
  }
  state.workspace.bridgeJobs.unshift(job)
  return job
}

function addNotificationDelivery(state: OriginState, notificationId: string, summary: string, status = 'delivered') {
  const delivery: NotificationDeliveryRecord = {
    id: nextId(state, 'deliv'),
    notificationId,
    channel: 'in_app',
    status,
    summary,
  }
  state.notifications.deliveries.unshift(delivery)
  return delivery
}

function addNotification(state: OriginState, kind: string, title: string, status: string, read = false) {
  const notification: NotificationRecord = {
    id: nextId(state, 'notif'),
    kind,
    title,
    status,
    at: now(),
    read,
  }
  state.notifications.items.unshift(notification)
  return notification
}

function addAutomationRunEntry(state: OriginState, automation: AutomationRecord, summary: string, status: AutomationRunRecord['status'], reason: string) {
  return createAutomationExecution(state, automation, summary, status, reason)
}

function addAutomationBackfill(state: OriginState, automation: AutomationRecord, from?: string, to?: string) {
  return createBackfillRuns(state, automation, from, to)
}

function serializeHistoryEntries(entries: Array<{ id: string; actor: string; at: string; summary: string }>) {
  return entries.map((entry) => ({
    id: entry.id,
    actor: entry.actor,
    at: entry.at,
    summary: entry.summary,
  }))
}

const automationRoutes = [
  'list',
  'get',
  'create',
  'update',
  'archive',
  'delete',
  'enable',
  'disable',
  'pause',
  'resume',
  'validate',
  'diagnose',
  'schedule preview',
  'schedule next-runs',
  'due',
  'queue',
  'failures',
  'stats',
  'run',
  'skip-next',
  'backfill',
  'runs list',
  'runs get',
  'runs cancel',
  'runs retry',
  'runs tail',
  'runs events',
  'events',
] as const

const activityRoutes = [
  'list',
  'get',
  'tail',
  'summarize',
  'stats',
  'trace',
  'related',
  'errors',
  'pending',
  'actors',
  'kinds',
  'export',
] as const

const entityRoutes = [
  'get',
  'related',
  'history',
  'link',
  'unlink',
  'restore',
] as const

const notificationRoutes = [
  'list',
  'get',
  'unread',
  'ack',
  'ack-all',
  'snooze',
  'test',
  'preferences get',
  'preferences set',
  'channels',
  'devices',
  'device get',
  'device enable',
  'device disable',
  'device revoke',
  'deliveries',
  'delivery get',
  'failures',
  'retry',
] as const

const syncRoutes = [
  'overview',
  'diagnose',
  'repair',
  'replica status',
  'replica peers',
  'replica peer get',
  'replica run',
  'replica jobs',
  'replica job get',
  'replica pending',
  'replica lag',
  'replica conflicts',
  'replica retry',
  'provider status',
  'provider run',
  'provider jobs',
  'provider job get',
  'provider retry',
  'outbox list',
  'outbox get',
  'outbox retry',
  'outbox cancel',
  'outbox resolve',
  'intent list',
  'intent get',
  'intent retry',
  'intent cancel',
  'conflicts',
  'conflict get',
  'conflict resolve',
  'bridge status',
  'bridge jobs',
  'bridge rescan',
  'bridge import',
  'bridge export',
  'bridge reconcile',
] as const

async function handleAutomationRoute(context: HandlerContext, route: (typeof automationRoutes)[number]) {
  const state = await loadState(context)

  switch (route) {
    case 'list': {
      const items = automationListView(state, {
        status: coerceArray(context.options.status as string[] | string | undefined),
        trigger: coerceArray(context.options.trigger as string[] | string | undefined),
        linkedTask: coerceArray(context.options['linked-task'] as string[] | string | undefined),
        limit: context.options.limit as number | undefined,
      })
      return createListResult(items.map((automation) => toAutomationOutput(state, automation)), {
        total: items.length,
        summary: 'Automations.',
      })
    }

    case 'get': {
      const automation = ensureFound(context, maybeResolveAutomation(state, String(context.args['automation-id'])), 'automation', String(context.args['automation-id']))
      return toAutomationOutput(state, automation)
    }

    case 'create': {
      return mutateState(context, async (draft) => {
        const id = nextId(draft, 'auto')
        const trigger = normalizeAutomationTrigger(context.options.trigger)
        const automation: AutomationRecord = {
          id,
          title: asString(context.options.title, 'Untitled automation'),
          status: 'enabled',
          kind: resolveAutomationKind(trigger),
          summary: compactSummary(asString(context.options.title, 'Untitled automation'), 'Automation'),
          trigger,
          actions: sanitizeAutomationActions(context.options.actions),
          runPolicy: normalizeRunPolicy(context.options['run-policy'] as Record<string, unknown> | undefined),
          retryPolicy: normalizeRetryPolicy(context.options['retry-policy'] as Record<string, unknown> | undefined),
        }
        draft.automations.automations.unshift(automation)
        const activity = addActivity(draft, {
          kind: 'automation.create',
          status: 'completed',
          actor: 'origin/operator',
          target: automation.id,
          summary: `Created automation ${automation.title}.`,
          severity: 'info',
          entityRefs: [automation.id],
        })
        return createActionResult(`Created automation ${automation.title}.`, {
          affectedIds: [automation.id],
          activityIds: [activity.id],
          runId: undefined,
          traceId: activity.traceId,
        })
      })
    }

    case 'update': {
      return mutateState(context, async (draft) => {
        const automation = ensureFound(context, maybeResolveAutomation(draft, String(context.args['automation-id'])), 'automation', String(context.args['automation-id']))
        const before = JSON.stringify({
          title: automation.title,
          status: automation.status,
          kind: automation.kind,
          summary: automation.summary,
          trigger: automation.trigger,
          actions: automation.actions,
          runPolicy: automation.runPolicy,
          retryPolicy: automation.retryPolicy,
        })
        if (context.options.title !== undefined) automation.title = asString(context.options.title, automation.title)
        if (context.options.trigger !== undefined) automation.trigger = normalizeAutomationTrigger(context.options.trigger) ?? automation.trigger
        if (context.options.actions !== undefined) automation.actions = sanitizeAutomationActions(context.options.actions) ?? automation.actions
        if (context.options['run-policy'] !== undefined) automation.runPolicy = {
          ...(automation.runPolicy ?? { allowOverlap: false, catchUp: 'skip', continueOnError: false }),
          ...normalizeRunPolicy(context.options['run-policy'] as Record<string, unknown> | undefined),
        }
        if (context.options['retry-policy'] !== undefined) automation.retryPolicy = {
          ...(automation.retryPolicy ?? { maxAttempts: 3, backoff: 'exponential' }),
          ...normalizeRetryPolicy(context.options['retry-policy'] as Record<string, unknown> | undefined),
        }
        if (context.options['notification-policy'] !== undefined) {
          ;(automation as any).notificationPolicy = safeObject(context.options['notification-policy'])
        }
        automation.kind = resolveAutomationKind(automation.trigger)
        automation.summary = compactSummary(automation.summary || automation.title, automation.title)
        const activity = addActivity(draft, {
          kind: 'automation.update',
          status: 'completed',
          actor: 'origin/operator',
          target: automation.id,
          summary: `Updated automation ${automation.title}.`,
          severity: 'info',
          entityRefs: [automation.id],
        })
        void createRevisionDiff(before, JSON.stringify({
          title: automation.title,
          status: automation.status,
          kind: automation.kind,
          summary: automation.summary,
          trigger: automation.trigger,
          actions: automation.actions,
          runPolicy: automation.runPolicy,
          retryPolicy: automation.retryPolicy,
        }))
        return createActionResult(`Updated automation ${automation.title}.`, {
          affectedIds: [automation.id],
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }

    case 'archive':
    case 'delete':
    case 'enable':
    case 'disable':
    case 'pause':
    case 'resume': {
      return mutateState(context, async (draft) => {
        const automationId = String(context.args['automation-id'])
        const automation = ensureFound(context, maybeResolveAutomation(draft, automationId), 'automation', automationId)
        if (route === 'delete') {
          draft.automations.automations = draft.automations.automations.filter((entry) => entry.id !== automation.id)
        } else {
          automation.status =
            route === 'archive' ? 'archived' :
            route === 'enable' ? 'enabled' :
            route === 'disable' ? 'disabled' :
            route === 'pause' ? 'paused' :
            'enabled'
        }
        const activity = addActivity(draft, {
          kind: `automation.${route}`,
          status: 'completed',
          actor: 'origin/operator',
          target: automation.id,
          summary:
            route === 'delete'
              ? `Deleted automation ${automation.title}.`
              : `${route === 'resume' ? 'Resumed' : route === 'pause' ? 'Paused' : route === 'disable' ? 'Disabled' : route === 'enable' ? 'Enabled' : 'Archived'} automation ${automation.title}.`,
          severity: 'info',
          entityRefs: [automation.id],
        })
        return createActionResult(
          route === 'delete'
            ? `Deleted automation ${automation.title}.`
            : `${route === 'resume' ? 'Resumed' : route === 'pause' ? 'Paused' : route === 'disable' ? 'Disabled' : route === 'enable' ? 'Enabled' : 'Archived'} automation ${automation.title}.`,
          {
            affectedIds: [automation.id],
            activityIds: [activity.id],
            traceId: activity.traceId,
          },
        )
      })
    }

    case 'validate':
    case 'diagnose': {
      const automationId = String(context.args['automation-id'])
      const automation = ensureFound(context, maybeResolveAutomation(state, automationId), 'automation', automationId)
      return createValidationResult(buildAutomationValidationChecks(state, automation), `${route === 'validate' ? 'Validation' : 'Diagnosis'} for automation ${automation.title}.`)
    }

    case 'schedule preview':
    case 'schedule next-runs': {
      const automationId = String(context.args['automation-id'])
      const automation = ensureFound(context, maybeResolveAutomation(state, automationId), 'automation', automationId)
      const runs = simpleSchedulePreview(automation.trigger, 3)
      return toAutomationSchedulePreviewOutput(
        route === 'schedule preview'
          ? `Previewed schedule for ${automation.title}.`
          : `Projected next runs for ${automation.title}.`,
        runs,
      )
    }

    case 'due': {
      const items = automationDueList(state)
      return createListResult(items.map((automation) => toAutomationOutput(state, automation)), {
        total: items.length,
        summary: 'Due automations.',
      })
    }

    case 'queue': {
      return createListResult(state.automations.queue.map((item) => ({
        name: item.name,
        pending: item.pending,
        ...(item.failed !== undefined ? { failed: item.failed } : {}),
        summary: item.summary,
      })), { summary: 'Automation queue entries.' })
    }

    case 'failures': {
      const items = automationRunsForAutomation(state).filter((run) => run.status === 'failed')
      return createListResult(items.map(toAutomationRunOutput), {
        total: items.length,
        summary: 'Failed automation runs.',
      })
    }

    case 'stats': {
      return toAutomationSummary(state)
    }

    case 'run': {
      return mutateState(context, async (draft) => {
        const automationId = String(context.args['automation-id'])
        const automation = ensureFound(context, maybeResolveAutomation(draft, automationId), 'automation', automationId)
        const result = addAutomationRunEntry(
          draft,
          automation,
          context.options.reason ? `Manually triggered: ${asString(context.options.reason)}` : 'Manual run completed.',
          'completed',
          asString(context.options.reason, 'manual'),
        )
        return createActionResult(`Ran automation ${automation.title}.`, {
          affectedIds: [automation.id],
          runId: result.run.id,
          traceId: result.traceId,
          activityIds: result.activityIds,
        })
      })
    }

    case 'skip-next': {
      return mutateState(context, async (draft) => {
        const automationId = String(context.args['automation-id'])
        const automation = ensureFound(context, maybeResolveAutomation(draft, automationId), 'automation', automationId)
        const result = addAutomationRunEntry(draft, automation, 'Skipped the next scheduled run.', 'skipped', 'skip-next')
        const activity = addActivity(draft, {
          kind: 'automation.skip-next',
          status: 'completed',
          actor: 'origin/operator',
          target: automation.id,
          summary: `Skipped the next run for ${automation.title}.`,
          severity: 'info',
          entityRefs: [automation.id],
          traceId: result.traceId,
        })
        return createActionResult(`Skipped the next run for ${automation.title}.`, {
          affectedIds: [automation.id],
          runId: result.run.id,
          traceId: result.traceId,
          activityIds: [activity.id, ...result.activityIds],
        })
      })
    }

    case 'backfill': {
      return mutateState(context, async (draft) => {
        const automationId = String(context.args['automation-id'])
        const automation = ensureFound(context, maybeResolveAutomation(draft, automationId), 'automation', automationId)
        const runs = addAutomationBackfill(
          draft,
          automation,
          asString(context.options.from),
          asString(context.options.to),
        )
        const activity = addActivity(draft, {
          kind: 'automation.backfill',
          status: 'completed',
          actor: 'origin/operator',
          target: automation.id,
          summary: `Backfilled ${runs.length} run(s) for ${automation.title}.`,
          severity: 'info',
          entityRefs: [automation.id],
          traceId: runs[0]?.traceId,
        })
        return createActionResult(`Backfilled ${runs.length} run(s) for ${automation.title}.`, {
          affectedIds: [automation.id],
          runId: runs[0]?.id,
          traceId: runs[0]?.traceId,
          activityIds: [activity.id, ...runs.flatMap((run) => run.eventIds)],
        })
      })
    }

    case 'runs list': {
      const runs = listAutomationRuns(state, {
        automationId: asString(context.options['automation-id']) || undefined,
        since: asString(context.options.since) || undefined,
        until: asString(context.options.until) || undefined,
        limit: context.options.limit as number | undefined,
      })
      return createListResult(runs.map(toAutomationRunOutput), {
        total: runs.length,
        summary: 'Automation runs.',
      })
    }

    case 'runs get': {
      const runId = String(context.args['run-id'])
      const run = ensureFound(context, maybeResolveAutomationRun(state, runId), 'automation run', runId)
      return toAutomationRunDetailOutput(run, buildAutomationRunEvents(state, run))
    }

    case 'runs cancel':
    case 'runs retry': {
      return mutateState(context, async (draft) => {
        const runId = String(context.args['run-id'])
        const run = ensureFound(context, maybeResolveAutomationRun(draft, runId), 'automation run', runId)
        if (route === 'runs cancel') {
          mutateAutomationRunStatus(run, 'canceled')
          const activity = addActivity(draft, {
            kind: 'automation.run.cancel',
            status: 'completed',
            actor: 'origin/operator',
            target: run.automationId,
            summary: `Canceled automation run ${run.id}.`,
            severity: 'warn',
            entityRefs: [run.id, run.automationId],
            traceId: run.traceId,
          })
          return createActionResult(`Canceled automation run ${run.id}.`, {
            runId: run.id,
            affectedIds: [run.automationId, run.id],
            traceId: run.traceId,
            activityIds: [activity.id],
          })
        }

        const automation = ensureFound(context, maybeResolveAutomation(draft, run.automationId), 'automation', run.automationId)
        const retry = addAutomationRunEntry(draft, automation, `Retry of run ${run.id}.`, 'queued', 'retry')
        const activity = addActivity(draft, {
          kind: 'automation.run.retry',
          status: 'completed',
          actor: 'origin/operator',
          target: automation.id,
          summary: `Queued retry for automation run ${run.id}.`,
          severity: 'info',
          entityRefs: [run.id, automation.id, retry.run.id],
          traceId: retry.traceId,
        })
        return createActionResult(`Queued retry for automation run ${run.id}.`, {
          affectedIds: [automation.id, run.id, retry.run.id],
          runId: retry.run.id,
          traceId: retry.traceId,
          activityIds: [activity.id, ...retry.activityIds],
        })
      })
    }

    case 'runs tail':
    case 'runs events':
    case 'events': {
      const runId = route === 'events' ? undefined : String(context.args['run-id'])
      const events = route === 'events'
        ? allAutomationEvents(state, asString(context.options['automation-id']) || undefined)
        : buildAutomationRunEvents(state, ensureFound(context, maybeResolveAutomationRun(state, runId!), 'automation run', runId!))
      return createListResult(events.map(toActivityEvent), {
        total: events.length,
        summary:
          route === 'events'
            ? 'Automation activity events.'
            : 'Automation run activity events.',
      })
    }
  }
}

function toAutomationSummary(state: OriginState) {
  return automationStatistics(state)
}

async function handleActivityRoute(context: HandlerContext, route: (typeof activityRoutes)[number]) {
  const state = await loadState(context)

  switch (route) {
    case 'list':
    case 'tail': {
      const events = activityListView(state, {
        domains: coerceArray(context.options.domains as string[] | string | undefined),
        since: asString(context.options.since) || undefined,
        until: asString(context.options.until) || undefined,
        limit: context.options.limit as number | undefined,
      })
      return createListResult(events.map(toActivityEvent), {
        total: events.length,
        summary: route === 'tail' ? 'Live or recent activity events.' : 'Activity events.',
      })
    }

    case 'get': {
      const id = String(context.args['activity-id'])
      const event = ensureFound(context, state.activities.find((entry) => entry.id === id), 'activity event', id)
      return toActivityEvent(event)
    }

    case 'summarize':
    case 'stats': {
      const events = activityListView(state, {
        domains: coerceArray(context.options.domains as string[] | string | undefined),
        since: asString(context.options.since) || undefined,
        until: asString(context.options.until) || undefined,
      })
      return route === 'summarize'
        ? toActivitySummary(events, `Summarized ${events.length} activity event(s).`)
        : toDetailedActivityStats(events)
    }

    case 'trace': {
      const traceId = String(context.args['trace-id'])
      const events = sortByLatest(state.activities.filter((event) => event.traceId === traceId), (event) => event.at)
      return {
        ['trace-id']: traceId,
        summary: `Trace contains ${events.length} event(s).`,
        events: events.map(toActivityEvent),
      }
    }

    case 'related': {
      const query = String(context.args.entity)
      const events = activityRelatedEvents(state, query)
      return createListResult(events.map(toActivityEvent), {
        total: events.length,
        summary: `Related activity events for ${query}.`,
      })
    }

    case 'errors': {
      const events = activityListView(state, {
        since: asString(context.options.since) || undefined,
        limit: context.options.limit as number | undefined,
      }).filter((event) => event.severity === 'error' || event.status === 'failed')
      return createListResult(events.map(toActivityEvent), {
        total: events.length,
        summary: 'Error events.',
      })
    }

    case 'pending': {
      const events = activityPendingEvents(state)
      return createListResult(events.map(toActivityEvent), {
        total: events.length,
        summary: 'Pending activity events.',
      })
    }

    case 'actors': {
      const actors = [...new Set(state.activities.map((event) => event.actor))].sort()
      return { actors }
    }

    case 'kinds': {
      const kinds = [...new Set(state.activities.map((event) => event.kind))].sort()
      return { kinds }
    }

    case 'export': {
      const events = activityListView(state, {
        since: asString(context.options.since) || undefined,
        until: asString(context.options.until) || undefined,
      })
      const format = (context.options.format as 'json' | 'jsonl' | 'md' | undefined) ?? 'json'
      const path = createActivityExportPath(context.runtime, format)
      await mkdir(context.runtime.paths.exportsDir, { recursive: true })
      await writeFile(path, activityExportPayload(events, format), 'utf8')
      return {
        summary: `Exported ${events.length} activity event(s).`,
        path,
      }
    }
  }
}

async function handleEntityRoute(context: HandlerContext, route: (typeof entityRoutes)[number]) {
  const state = await loadState(context)

  switch (route) {
    case 'get': {
      const query = String(context.args.entity)
      const entity = ensureFound(context, entityDisplay(entitySourceRecord(state, query)), 'entity', query)
      return entity
    }

    case 'related': {
      const query = String(context.args.entity)
      const limit = context.options.limit as number | undefined
      const items = listEntityResults(state, query, limit)
      return createListResult(items, {
        total: items.length,
        summary: `Related entities for ${query}.`,
      })
    }

    case 'history': {
      const query = String(context.args.entity)
      const record = ensureFound(context, entitySourceRecord(state, query), 'entity', query)
      const entries = entityRecordHistory(record, asString(context.options.since) || undefined, asString(context.options.until) || undefined)
      return createListResult(formatEntityHistory(entries), {
        total: entries.length,
        summary: `Entity history for ${query}.`,
      })
    }

    case 'link':
    case 'unlink': {
      return mutateState(context, async (draft) => {
        const source = String(context.args.entity)
        const target = asString(context.options.to)
        const kind = asString(context.options.kind, 'related')
        ensureFound(context, entitySourceRecord(draft, source), 'entity', source)
        ensureFound(context, entitySourceRecord(draft, target), 'entity', target)
        if (route === 'link') {
          if (!draft.entityLinks.some((link) => link.from === source && link.to === target && link.kind === kind)) {
            draft.entityLinks.push({ from: source, to: target, kind })
          }
        } else {
          draft.entityLinks = draft.entityLinks.filter((link) => !(link.from === source && link.to === target && link.kind === kind))
        }
        const activity = addActivity(draft, {
          kind: `entity.${route}`,
          status: 'completed',
          actor: 'origin/operator',
          target: source,
          summary:
            route === 'link'
              ? `Linked ${source} to ${target} as ${kind}.`
              : `Unlinked ${source} from ${target} as ${kind}.`,
          severity: 'info',
          entityRefs: [source, target],
        })
        return createActionResult(
          route === 'link'
            ? `Linked ${source} to ${target}.`
            : `Unlinked ${source} from ${target}.`,
          {
            affectedIds: [source, target],
            activityIds: [activity.id],
            traceId: activity.traceId,
          },
        )
      })
    }

    case 'restore': {
      return mutateState(context, async (draft) => {
        const entityId = String(context.args.entity)
        const revisionId = String(context.args['revision-id'])
        ensureFound(context, entitySourceRecord(draft, entityId), 'entity', entityId)
        const restored = restoreEntityFromRevision(draft, entityId, revisionId)
        if (!restored) {
          throw context.error({
            code: 'NOT_FOUND',
            message: `Unknown revision ${revisionId} for entity ${entityId}.`,
          })
        }
        const activity = addActivity(draft, {
          kind: 'entity.restore',
          status: 'completed',
          actor: 'origin/operator',
          target: entityId,
          summary: `Restored entity ${entityId} from revision ${revisionId}.`,
          severity: 'info',
          entityRefs: [entityId],
        })
        return createActionResult(`Restored entity ${entityId} from revision ${revisionId}.`, {
          affectedIds: [entityId],
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }
  }
}

async function handleNotificationRoute(context: HandlerContext, route: (typeof notificationRoutes)[number]) {
  const state = await loadState(context)

  switch (route) {
    case 'list':
    case 'unread': {
      const items = withWindow(
        state.notifications.items.filter((notification) => route === 'unread' ? notification.read !== true : true),
        (notification) => notification.at,
        asString(context.options.since) || undefined,
        asString(context.options.until) || undefined,
      )
      return createListResult(takeLimit(items.map(toNotificationOutput), context.options.limit as number | undefined), {
        total: items.length,
        summary: route === 'unread' ? 'Unread notifications.' : 'Notifications.',
      })
    }

    case 'get': {
      const notificationId = String(context.args['notification-id'])
      const notification = ensureFound(context, maybeResolveNotification(state, notificationId), 'notification', notificationId)
      return toNotificationOutput(notification)
    }

    case 'ack':
    case 'snooze': {
      return mutateState(context, async (draft) => {
        const notificationId = String(context.args['notification-id'])
        const notification = ensureFound(context, maybeResolveNotification(draft, notificationId), 'notification', notificationId)
        if (route === 'ack') {
          notification.read = true
          notification.status = 'read'
        } else {
          notification.read = true
          notification.status = 'snoozed'
          notification.snoozedUntil = asString(context.options.until)
        }
        const activity = addActivity(draft, {
          kind: route === 'ack' ? 'notification.ack' : 'notification.snooze',
          status: 'completed',
          actor: 'origin/operator',
          target: notification.id,
          summary:
            route === 'ack'
              ? `Acknowledged notification ${notification.id}.`
              : `Snoozed notification ${notification.id} until ${asString(context.options.until)}.`,
          severity: 'info',
          entityRefs: [notification.id],
        })
        return createActionResult(
          route === 'ack'
            ? `Acknowledged notification ${notification.id}.`
            : `Snoozed notification ${notification.id}.`,
          {
            affectedIds: [notification.id],
            activityIds: [activity.id],
            traceId: activity.traceId,
          },
        )
      })
    }

    case 'ack-all': {
      return mutateState(context, async (draft) => {
        const visible = draft.notifications.items.filter((notification) => notification.read !== true)
        for (const notification of visible) {
          notification.read = true
          notification.status = 'read'
        }
        const activity = addActivity(draft, {
          kind: 'notification.ack-all',
          status: 'completed',
          actor: 'origin/operator',
          summary: `Acknowledged ${visible.length} notification(s).`,
          severity: 'info',
          entityRefs: visible.map((notification) => notification.id),
        })
        return createActionResult(`Acknowledged ${visible.length} notification(s).`, {
          affectedIds: visible.map((notification) => notification.id),
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }

    case 'test': {
      return mutateState(context, async (draft) => {
        const notification = addNotification(draft, 'test', 'Test notification', 'sent')
        const delivery = addNotificationDelivery(draft, notification.id, 'Delivered test notification.', 'delivered')
        const activity = addActivity(draft, {
          kind: 'notification.test',
          status: 'completed',
          actor: 'origin/operator',
          target: notification.id,
          summary: `Created test notification ${notification.id}.`,
          severity: 'info',
          entityRefs: [notification.id, delivery.id],
        })
        return createActionResult('Sent a test notification.', {
          affectedIds: [notification.id],
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }

    case 'preferences get': {
      return formatNotificationPreferenceValues(state.notifications.preferences)
    }

    case 'preferences set': {
      return mutateState(context, async (draft) => {
        const values = safeObject(context.options.values)
        draft.notifications.preferences = {
          ...draft.notifications.preferences,
          ...values,
        }
        const activity = addActivity(draft, {
          kind: 'notification.preferences.set',
          status: 'completed',
          actor: 'origin/operator',
          summary: 'Updated notification preferences.',
          severity: 'info',
        })
        return createActionResult('Updated notification preferences.', {
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }

    case 'channels': {
      return { channels: ['in_app', 'push', 'email'] }
    }

    case 'devices': {
      return createListResult(state.notifications.devices.map(toNotificationDeviceOutput), {
        total: state.notifications.devices.length,
        summary: 'Notification devices.',
      })
    }

    case 'device get': {
      const deviceId = String(context.args['device-id'])
      const device = ensureFound(context, maybeResolveNotificationDevice(state, deviceId), 'notification device', deviceId)
      return toNotificationDeviceOutput(device)
    }

    case 'device enable':
    case 'device disable':
    case 'device revoke': {
      return mutateState(context, async (draft) => {
        const deviceId = String(context.args['device-id'])
        const device = ensureFound(context, maybeResolveNotificationDevice(draft, deviceId), 'notification device', deviceId)
        device.status =
          route === 'device enable' ? 'enabled' :
          route === 'device disable' ? 'disabled' :
          'revoked'
        const activity = addActivity(draft, {
          kind: `notification.${route}`,
          status: 'completed',
          actor: 'origin/operator',
          target: device.id,
          summary: `${route === 'device enable' ? 'Enabled' : route === 'device disable' ? 'Disabled' : 'Revoked'} notification device ${device.id}.`,
          severity: 'info',
          entityRefs: [device.id],
        })
        return createActionResult(
          `${route === 'device enable' ? 'Enabled' : route === 'device disable' ? 'Disabled' : 'Revoked'} notification device ${device.id}.`,
          {
            affectedIds: [device.id],
            activityIds: [activity.id],
            traceId: activity.traceId,
          },
        )
      })
    }

    case 'deliveries': {
      const items = listNotificationDeliveries(state, {
        limit: context.options.limit as number | undefined,
        status: coerceArray(context.options.status as string[] | string | undefined),
        since: asString(context.options.since) || undefined,
        until: asString(context.options.until) || undefined,
      })
      return createListResult(items.map(toNotificationDeliveryOutput), {
        total: items.length,
        summary: 'Notification deliveries.',
      })
    }

    case 'delivery get': {
      const deliveryId = String(context.args['delivery-id'])
      const delivery = ensureFound(context, maybeResolveDelivery(state, deliveryId), 'notification delivery', deliveryId)
      return toNotificationDeliveryOutput(delivery)
    }

    case 'failures': {
      const items = state.notifications.deliveries.filter((delivery) => delivery.status === 'failed')
      return createListResult(items.map(toNotificationDeliveryOutput), {
        total: items.length,
        summary: 'Failed notification deliveries.',
      })
    }

    case 'retry': {
      return mutateState(context, async (draft) => {
        const deliveryId = String(context.args['delivery-id'])
        const delivery = ensureFound(context, maybeResolveDelivery(draft, deliveryId), 'notification delivery', deliveryId)
        delivery.status = 'retried'
        delivery.summary = `${delivery.summary} Retry queued.`
        const retry = addNotificationDelivery(draft, delivery.notificationId, `Retry queued for ${delivery.notificationId}.`, 'delivered')
        const activity = addActivity(draft, {
          kind: 'notification.retry',
          status: 'completed',
          actor: 'origin/operator',
          target: delivery.notificationId,
          summary: `Retried notification delivery ${delivery.id}.`,
          severity: 'info',
          entityRefs: [delivery.id, retry.id, delivery.notificationId],
        })
        return createActionResult(`Retried notification delivery ${delivery.id}.`, {
          affectedIds: [delivery.id, retry.id, delivery.notificationId],
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }
  }
}

async function handleSyncRoute(context: HandlerContext, route: (typeof syncRoutes)[number]) {
  const state = await loadState(context)

  switch (route) {
    case 'overview':
    case 'replica status':
    case 'provider status':
    case 'bridge status':
      return summarizeSyncStatus(state)

    case 'diagnose': {
      return createValidationResult([
        {
          id: 'sync_replica_peers',
          kind: 'sync',
          target: 'replica',
          status: state.sync.replicaPeers.length > 0 ? 'pass' : 'warn',
          message: state.sync.replicaPeers.length > 0 ? 'Replica peers are registered.' : 'No replica peers are registered.',
          remediation: state.sync.replicaPeers.length > 0 ? undefined : ['Register at least one replica peer.'],
        },
        {
          id: 'sync_replica_conflicts',
          kind: 'sync',
          target: 'replica',
          status: state.sync.replicaConflicts.length > 0 ? 'warn' : 'pass',
          message: state.sync.replicaConflicts.length > 0 ? 'Replica conflicts need review.' : 'No replica conflicts are outstanding.',
          remediation: state.sync.replicaConflicts.length > 0 ? ['Inspect and resolve the outstanding sync conflicts.'] : undefined,
        },
        {
          id: 'sync_provider_outbox',
          kind: 'sync',
          target: 'provider',
          status: state.sync.providerOutbox.some((item) => item.status === 'failed') ? 'warn' : 'pass',
          message: state.sync.providerOutbox.some((item) => item.status === 'failed') ? 'Provider outbox has failed items.' : 'Provider outbox is healthy.',
          remediation: state.sync.providerOutbox.some((item) => item.status === 'failed') ? ['Retry or cancel failed outbox items.'] : undefined,
        },
        {
          id: 'sync_bridge_jobs',
          kind: 'sync',
          target: 'bridge',
          status: state.workspace.bridgeJobs.some((job) => job.status === 'failed') ? 'warn' : 'pass',
          message: state.workspace.bridgeJobs.some((job) => job.status === 'failed') ? 'Bridge jobs include failures.' : 'Bridge jobs are healthy.',
          remediation: state.workspace.bridgeJobs.some((job) => job.status === 'failed') ? ['Run a bridge repair or reconcile pass.'] : undefined,
        },
      ], 'Sync diagnostics completed.')
    }

    case 'repair': {
      return mutateState(context, async (draft) => {
        const repaired: string[] = []
        for (const job of [...draft.sync.replicaJobs, ...draft.sync.providerJobs]) {
          if (job.status === 'failed' || job.status === 'error') {
            job.status = 'pending'
            repaired.push(job.id)
          }
        }
        for (const item of draft.sync.providerOutbox) {
          if (item.status === 'failed') {
            item.status = 'pending'
            repaired.push(item.id)
          }
        }
        for (const job of draft.workspace.bridgeJobs) {
          if (job.status === 'failed') {
            job.status = 'queued'
            repaired.push(job.id)
          }
        }
        const activity = addActivity(draft, {
          kind: 'sync.repair',
          status: 'completed',
          actor: 'origin/operator',
          summary: `Repaired ${repaired.length} sync item(s).`,
          severity: 'info',
          entityRefs: repaired,
        })
        return createActionResult(`Repaired ${repaired.length} sync item(s).`, {
          affectedIds: repaired,
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }

    case 'replica peers': {
      return createListResult(state.sync.replicaPeers.map(toSyncPeerOutput), {
        total: state.sync.replicaPeers.length,
        summary: 'Replica peers.',
      })
    }

    case 'replica peer get': {
      const peerId = String(context.args['peer-id'])
      const peer = ensureFound(context, maybeResolveSyncPeer(state, peerId), 'replica peer', peerId)
      return toSyncPeerOutput(peer)
    }

    case 'replica run': {
      return mutateState(context, async (draft) => {
        const job = addSyncJob(draft, 'replica', 'replica-sync', 'Replica sync completed.')
        const activity = addActivity(draft, {
          kind: 'sync.replica.run',
          status: 'completed',
          actor: 'origin/operator',
          target: job.id,
          summary: `Ran replica sync job ${job.id}.`,
          severity: 'info',
          entityRefs: [job.id],
          traceId: job.traceId,
        })
        return createActionResult(`Ran replica sync job ${job.id}.`, {
          jobId: job.id,
          traceId: job.traceId,
          activityIds: [activity.id],
        })
      })
    }

    case 'replica jobs': {
      const jobs = listSyncJobs(
        state.sync.replicaJobs,
        {
          since: asString(context.options.since) || undefined,
          until: asString(context.options.until) || undefined,
          limit: context.options.limit as number | undefined,
        },
      )
      return createListResult(jobs.map(toSyncJobOutput), {
        total: jobs.length,
        summary: 'Replica-sync jobs.',
      })
    }

    case 'replica job get': {
      const jobId = String(context.args['job-id'])
      const job = ensureFound(context, maybeResolveSyncJob(state, jobId), 'sync job', jobId)
      return toSyncJobOutput(job)
    }

    case 'replica pending': {
      const items = state.sync.providerOutbox.filter((item) => ['pending', 'queued'].includes(item.status))
      return createListResult(items.map(toOutboxItemOutput), {
        total: items.length,
        summary: 'Pending replica-sync items.',
      })
    }

    case 'replica lag': {
      return createListResult(
        state.sync.replicaPeers.map((peer) => ({
          id: peer.id,
          kind: peer.kind,
          status: peer.status,
          summary: `${peer.summary} Lag not materially measured in the in-process runtime.`,
        })),
        { total: state.sync.replicaPeers.length, summary: 'Replica lag summaries.' },
      )
    }

    case 'replica conflicts': {
      const items = listReplicaConflicts(state.sync.replicaConflicts)
      return createListResult(items.map(toSyncConflictOutput), {
        total: items.length,
        summary: 'Replica conflicts.',
      })
    }

    case 'replica retry': {
      return mutateState(context, async (draft) => {
        const jobId = String(context.args['job-id'])
        const job = ensureFound(context, maybeResolveSyncJob(draft, jobId), 'sync job', jobId)
        const retryJob = addSyncJob(draft, 'replica', job.kind, `Retry queued for ${job.id}.`, 'pending')
        const activity = addActivity(draft, {
          kind: 'sync.replica.retry',
          status: 'completed',
          actor: 'origin/operator',
          target: job.id,
          summary: `Queued replica retry for job ${job.id}.`,
          severity: 'info',
          entityRefs: [job.id, retryJob.id],
          traceId: retryJob.traceId,
        })
        return createActionResult(`Queued replica retry for job ${job.id}.`, {
          jobId: retryJob.id,
          affectedIds: [job.id, retryJob.id],
          traceId: retryJob.traceId,
          activityIds: [activity.id],
        })
      })
    }

    case 'provider run': {
      return mutateState(context, async (draft) => {
        const job = addSyncJob(draft, 'provider', 'provider-refresh', 'Provider refresh completed.')
        const activity = addActivity(draft, {
          kind: 'sync.provider.run',
          status: 'completed',
          actor: 'origin/operator',
          target: job.id,
          summary: `Ran provider sync job ${job.id}.`,
          severity: 'info',
          entityRefs: [job.id],
          traceId: job.traceId,
        })
        return createActionResult(`Ran provider sync job ${job.id}.`, {
          jobId: job.id,
          traceId: job.traceId,
          activityIds: [activity.id],
        })
      })
    }

    case 'provider jobs': {
      const jobs = listSyncJobs(
        state.sync.providerJobs,
        {
          since: asString(context.options.since) || undefined,
          until: asString(context.options.until) || undefined,
          limit: context.options.limit as number | undefined,
        },
      )
      return createListResult(jobs.map(toSyncJobOutput), {
        total: jobs.length,
        summary: 'Provider-sync jobs.',
      })
    }

    case 'provider job get': {
      const jobId = String(context.args['job-id'])
      const job = ensureFound(context, state.sync.providerJobs.find((entry) => entry.id === jobId), 'sync job', jobId)
      return toSyncJobOutput(job)
    }

    case 'provider retry': {
      return mutateState(context, async (draft) => {
        const jobId = String(context.args['job-id'])
        const job = ensureFound(context, draft.sync.providerJobs.find((entry) => entry.id === jobId), 'sync job', jobId)
        const retryJob = addSyncJob(draft, 'provider', job.kind, `Retry queued for ${job.id}.`, 'pending')
        const activity = addActivity(draft, {
          kind: 'sync.provider.retry',
          status: 'completed',
          actor: 'origin/operator',
          target: job.id,
          summary: `Queued provider retry for job ${job.id}.`,
          severity: 'info',
          entityRefs: [job.id, retryJob.id],
          traceId: retryJob.traceId,
        })
        return createActionResult(`Queued provider retry for job ${job.id}.`, {
          jobId: retryJob.id,
          affectedIds: [job.id, retryJob.id],
          traceId: retryJob.traceId,
          activityIds: [activity.id],
        })
      })
    }

    case 'outbox list': {
      const items = listOutboxItems(state.sync.providerOutbox, {
        kind: coerceArray(context.options.kind as string[] | string | undefined),
        status: coerceArray(context.options.status as string[] | string | undefined),
        limit: context.options.limit as number | undefined,
      })
      return createListResult(items.map(toOutboxItemOutput), {
        total: items.length,
        summary: 'Outbox items.',
      })
    }

    case 'outbox get': {
      const itemId = String(context.args['outbox-id'])
      const item = ensureFound(context, maybeResolveOutboxItem(state, itemId), 'outbox item', itemId)
      return toOutboxItemOutput(item)
    }

    case 'outbox retry':
    case 'outbox cancel':
    case 'outbox resolve': {
      return mutateState(context, async (draft) => {
        const itemId = String(context.args['outbox-id'])
        const item = ensureFound(context, maybeResolveOutboxItem(draft, itemId), 'outbox item', itemId)
        item.status =
          route === 'outbox retry' ? 'pending' :
          route === 'outbox cancel' ? 'canceled' :
          'resolved'
        const activity = addActivity(draft, {
          kind: `sync.${route.replace(/\s+/g, '.')}`,
          status: 'completed',
          actor: 'origin/operator',
          target: item.id,
          summary:
            route === 'outbox retry'
              ? `Retried outbox item ${item.id}.`
              : route === 'outbox cancel'
                ? `Canceled outbox item ${item.id}.`
                : `Resolved outbox item ${item.id}.`,
          severity: 'info',
          entityRefs: [item.id],
        })
        return createActionResult(
          route === 'outbox retry'
            ? `Retried outbox item ${item.id}.`
            : route === 'outbox cancel'
              ? `Canceled outbox item ${item.id}.`
              : `Resolved outbox item ${item.id}.`,
          {
            affectedIds: [item.id],
            activityIds: [activity.id],
            traceId: activity.traceId,
          },
        )
      })
    }

    case 'intent list': {
      let intents = externalActionIntentSources(state)
      const providerFilters = coerceArray(context.options.provider as string[] | string | undefined)
      const kindFilters = coerceArray(context.options.kind as string[] | string | undefined)
      const actionFilters = coerceArray(context.options.action as string[] | string | undefined)
      const statusFilters = coerceArray(context.options.status as string[] | string | undefined)

      if (providerFilters.length > 0) {
        intents = intents.filter((intent) => providerFilters.includes(intent.provider))
      }
      if (kindFilters.length > 0) {
        intents = intents.filter((intent) =>
          kindFilters.includes(
            intent.provider === 'google-calendar' || intent.provider === 'google-tasks'
              ? 'planning_bridge_action'
              : 'provider_write',
          ),
        )
      }
      if (actionFilters.length > 0) {
        intents = intents.filter((intent) =>
          actionFilters.includes(externalActionIntentAction(intent.provider, intent.item.kind)),
        )
      }
      if (statusFilters.length > 0) {
        intents = intents.filter((intent) =>
          statusFilters.includes(externalActionIntentStatus(intent.item.status)),
        )
      }

      const limited = takeLimit(intents, context.options.limit as number | undefined)
      return createListResult(limited.map((intent) => toExternalActionIntentOutput(state, intent)), {
        total: intents.length,
        summary: 'External-action intents.',
      })
    }

    case 'intent get': {
      const intentId = String(context.args['intent-id'])
      const intent = ensureFound(
        context,
        maybeResolveExternalActionIntent(state, intentId),
        'external-action intent',
        intentId,
      )
      return toExternalActionIntentOutput(state, intent)
    }

    case 'intent retry':
    case 'intent cancel': {
      return mutateState(context, async (draft) => {
        const intentId = String(context.args['intent-id'])
        const intent = ensureFound(
          context,
          maybeResolveExternalActionIntent(draft, intentId),
          'external-action intent',
          intentId,
        )
        intent.item.status = route === 'intent retry' ? 'pending' : 'canceled'
        const activity = addActivity(draft, {
          kind: `sync.${route.replace(/\s+/g, '.')}`,
          status: 'completed',
          actor: 'origin/operator',
          target: intent.item.id,
          summary:
            route === 'intent retry'
              ? `Retried external-action intent ${intent.item.id}.`
              : `Canceled external-action intent ${intent.item.id}.`,
          severity: 'info',
          entityRefs: [intent.item.id],
        })
        return createActionResult(
          route === 'intent retry'
            ? `Retried external-action intent ${intent.item.id}.`
            : `Canceled external-action intent ${intent.item.id}.`,
          {
            affectedIds: [intent.item.id],
            activityIds: [activity.id],
            traceId: activity.traceId,
          },
        )
      })
    }

    case 'conflicts': {
      const items = listReplicaConflicts(state.sync.replicaConflicts, context.options.limit as number | undefined)
      return createListResult(items.map(toSyncConflictOutput), {
        total: items.length,
        summary: 'Sync conflicts.',
      })
    }

    case 'conflict get': {
      const conflictId = String(context.args['conflict-id'])
      const conflict = ensureFound(context, maybeResolveConflict(state, conflictId), 'sync conflict', conflictId)
      return toSyncConflictDetailOutput(conflict)
    }

    case 'conflict resolve': {
      return mutateState(context, async (draft) => {
        const conflictId = String(context.args['conflict-id'])
        const conflict = ensureFound(context, maybeResolveConflict(draft, conflictId), 'sync conflict', conflictId)
        const resolution = asString(context.options.resolution)
        const candidateId = asString(context.options['candidate-id']) || undefined
        if (resolution === 'select' && candidateId && !conflict.candidates.some((candidate) => candidate.id === candidateId)) {
          throw context.error({
            code: 'NOT_FOUND',
            message: `Unknown conflict candidate ${candidateId} for conflict ${conflictId}.`,
          })
        }
        if (resolution === 'merge' || resolution === 'replace') {
          if (context.options.payload === undefined || typeof context.options.payload !== 'object') {
            throw context.error({
              code: 'INVALID_INPUT',
              message: 'Structured payload is required for merge and replace conflict resolutions.',
            })
          }
        }
        draft.sync.replicaConflicts = draft.sync.replicaConflicts.filter((entry) => entry.id !== conflict.id)
        const activity = addActivity(draft, {
          kind: 'sync.conflict.resolve',
          status: 'completed',
          actor: 'origin/operator',
          target: conflict.id,
          summary:
            resolution === 'select'
              ? `Resolved conflict ${conflict.id} by selecting candidate ${candidateId}.`
              : resolution === 'merge'
                ? `Resolved conflict ${conflict.id} by merging structured payload.`
                : `Resolved conflict ${conflict.id} by replacement payload.`,
          severity: 'info',
          entityRefs: [conflict.id, ...(candidateId ? [candidateId] : [])],
        })
        return createActionResult(
          resolution === 'select'
            ? `Resolved conflict ${conflict.id} by selecting candidate ${candidateId}.`
            : resolution === 'merge'
              ? `Resolved conflict ${conflict.id} by merging structured payload.`
              : `Resolved conflict ${conflict.id} by replacement payload.`,
          {
            affectedIds: [conflict.id, ...(candidateId ? [candidateId] : [])],
            conflictId: conflict.id,
            activityIds: [activity.id],
            traceId: activity.traceId,
          },
        )
      })
    }

    case 'bridge jobs': {
      return createListResult(state.workspace.bridgeJobs.map(toBridgeJobOutput), {
        total: state.workspace.bridgeJobs.length,
        summary: 'Bridge jobs.',
      })
    }

    case 'bridge rescan':
    case 'bridge import':
    case 'bridge export':
    case 'bridge reconcile': {
      return mutateState(context, async (draft) => {
        const job = addBridgeJob(
          draft,
          route === 'bridge rescan'
            ? 'Rescanned workspace and filesystem bridge inputs.'
            : route === 'bridge import'
              ? 'Imported external filesystem edits into replicated state.'
              : route === 'bridge export'
                ? 'Exported replicated state back into workspace files.'
                : 'Ran a full filesystem bridge reconcile pass.',
        )
        draft.workspace.bridgeStatus =
          route === 'bridge rescan'
            ? 'Rescanned'
            : route === 'bridge import'
              ? 'Imported'
              : route === 'bridge export'
                ? 'Exported'
                : 'In sync'
        const activity = addActivity(draft, {
          kind: `sync.${route.replace(/\s+/g, '.')}`,
          status: 'completed',
          actor: 'origin/operator',
          target: job.id,
          summary: job.summary,
          severity: 'info',
          entityRefs: [job.id],
        })
        return createActionResult(job.summary, {
          jobId: job.id,
          affectedIds: [job.id],
          activityIds: [activity.id],
          traceId: activity.traceId,
        })
      })
    }
  }
}

const automationHandlers = buildDomainHandlers('automation', automationRoutes, handleAutomationRoute)
const activityHandlers = buildDomainHandlers('activity', activityRoutes, handleActivityRoute)
const entityHandlers = buildDomainHandlers('entity', entityRoutes, handleEntityRoute)
const notificationHandlers = buildDomainHandlers('notification', notificationRoutes, handleNotificationRoute)
const syncHandlers = buildDomainHandlers('sync', syncRoutes, handleSyncRoute)

const handlers = {
  ...automationHandlers,
  ...activityHandlers,
  ...entityHandlers,
  ...notificationHandlers,
  ...syncHandlers,
} satisfies Record<string, (context: HandlerContext) => unknown | Promise<unknown>>

const expectedRoutes = [
  ...automationRoutes.map((suffix) => `automation ${suffix}`),
  ...activityRoutes.map((suffix) => `activity ${suffix}`),
  ...entityRoutes.map((suffix) => `entity ${suffix}`),
  ...notificationRoutes.map((suffix) => `notification ${suffix}`),
  ...syncRoutes.map((suffix) => `sync ${suffix}`),
]

const missingRoutes = expectedRoutes.filter((route) => !(route in handlers))
if (missingRoutes.length > 0) {
  throw new Error(`Origin CLI handler coverage is incomplete: ${missingRoutes.join(', ')}`)
}

export const automationActivityEntityNotificationSyncHandlers = defineHandlers(handlers as any)
