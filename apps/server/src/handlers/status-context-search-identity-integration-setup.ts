import type { HandlerMap, RouteHandlerContext } from '../cli/types.ts'
import { addActivity, createActionResult, createListResult, createRevisionDiff, createValidationResult, includesQuery, nextId, now, recordRevision, safeObject, scoreText, today } from '../runtime/helpers.ts'
import type { RuntimeContext } from '../runtime/context.ts'
import type { JsonValue, OriginState } from '../runtime/types.ts'
import { defineHandlers } from '../cli/types.ts'

type State = OriginState
type IntegrationRecord = State['integrations'][string]
type SetupPhase = State['setup']['phases'][number]
type SetupInput = State['setup']['inputs'][number]
type ActivityEvent = State['activities'][number]
type ProjectRecord = State['planning']['projects'][number]
type LabelRecord = State['planning']['labels'][number]
type TaskRecord = State['planning']['tasks'][number]
type CalendarItemRecord = State['planning']['calendarItems'][number]
type NoteRecord = State['notes']['notes'][number]
type EmailThreadRecord = State['email']['threads'][number]
type EmailAccountRecord = State['email']['accounts'][number]
type GithubRepositoryRecord = State['github']['repositories'][number]
type GithubIssueRecord = State['github']['issues'][number]
type GithubPullRequestRecord = State['github']['pullRequests'][number]
type TelegramChatRecord = State['telegram']['chats'][number]
type TelegramMessageRecord = State['telegram']['messages'][number]
type AutomationRecord = State['automations']['automations'][number]
type NotificationRecord = State['notifications']['items'][number]
type NotificationDeviceRecord = State['notifications']['devices'][number]
type NotificationDeliveryRecord = State['notifications']['deliveries'][number]
type SyncPeerRecord = State['sync']['replicaPeers'][number]
type SyncJobRecord = State['sync']['replicaJobs'][number] | State['sync']['providerJobs'][number]
type OutboxItemRecord = State['sync']['providerOutbox'][number] | State['email']['outbox'][number] | State['github']['outbox'][number] | State['telegram']['outbox'][number] | State['chat']['outbox'][number]
type QueueEntry = State['automations']['queue'][number]

type EntityRef = {
  kind: string
  id: string
  title: string
  summary?: string
}

type SearchHit = {
  kind: string
  id: string
  title: string
  score: number
  excerpt?: string
  path?: string
}

type SearchCandidate = {
  domain: string
  kind: string
  id: string
  title: string
  path?: string
  excerpt?: string
  summary?: string
  texts: Array<string | undefined>
}

type ValidationCheck = {
  id: string
  kind: string
  target: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  remediation?: string[]
}

type Blocker = {
  id: string
  kind: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  remediation?: string[]
}

const route = <R extends keyof HandlerMap>(_: R, fn: any) => fn

const actionResult = createActionResult
const listResult = createListResult
const validationResult = createValidationResult
const matchesQuery = includesQuery

async function loadState(runtime: RuntimeContext): Promise<State> {
  return (await runtime.store.load()) as State
}

async function mutateState<T>(runtime: RuntimeContext, mutator: (state: State) => T | Promise<T>) {
  return (await runtime.store.mutate(mutator as (state: State) => T | Promise<T>)) as T
}

function isoNow() {
  return now()
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  const segments: string[] = []
  if (hours > 0) segments.push(`${hours}h`)
  if (minutes > 0 || hours > 0) segments.push(`${minutes}m`)
  segments.push(`${remainingSeconds}s`)
  return segments.join('')
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function entityRef(kind: string, id: string, title: string, summary?: string): EntityRef {
  return { kind, id, title, ...(summary ? { summary } : {}) }
}

function mapHandle(handle: State['identity']['handles'][number]) {
  return handle
}

function mapIdentitySource(source: State['identity']['sources'][number]) {
  return source
}

function mapStatusCheck(check: ValidationCheck) {
  return check
}

function mapBlocker(blocker: Blocker) {
  return blocker
}

function mapIntegrationStatus(key: string, integration: IntegrationRecord) {
  return {
    key,
    status: integration.status.status,
    summary: integration.status.summary,
    ...(integration.status.lastValidatedAt ? { ['last-validated-at']: integration.status.lastValidatedAt } : {}),
    ...(integration.status.lastRefreshedAt ? { ['last-refreshed-at']: integration.status.lastRefreshedAt } : {}),
  }
}

function mapIntegrationConfig(key: string, integration: IntegrationRecord) {
  return {
    key,
    values: integration.config,
  }
}

function mapIntegrationScopeStatus(key: string, integration: IntegrationRecord) {
  return {
    key,
    configured: integration.configuredScopes,
    granted: integration.grantedScopes,
    missing: integration.missingScopes,
  }
}

function mapProviderIngressStatus(key: string, integration: IntegrationRecord) {
  return {
    provider: integration.provider.provider,
    status: integration.provider.status,
    summary: integration.provider.summary,
    ...(integration.provider.surfaces?.length ? { surfaces: integration.provider.surfaces } : {}),
    pollers: integration.provider.pollers,
    ...(integration.provider.lastRefreshedAt ? { ['last-refreshed-at']: integration.provider.lastRefreshedAt } : {}),
  }
}

function mapRateLimit(integration: string, bucket: { bucket: string; remaining: number; resetAt?: string }) {
  return {
    integration,
    bucket: bucket.bucket,
    remaining: bucket.remaining,
    ...(bucket.resetAt ? { resetAt: bucket.resetAt } : {}),
  }
}

function mapSetupPhase(phase: SetupPhase) {
  return {
    key: phase.key,
    title: phase.title,
    status: phase.status,
    summary: phase.summary,
    ...(phase.nextActions?.length ? { ['next-actions']: phase.nextActions } : {}),
  }
}

function mapSetupInput(input: SetupInput) {
  return {
    key: input.key,
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.source ? { source: input.source } : {}),
  }
}

function mapTaskRef(task: TaskRecord): EntityRef {
  return entityRef('task', task.id, task.title, task.descriptionMd)
}

function mapProjectRef(project: ProjectRecord): EntityRef {
  return entityRef('project', project.id, project.name, project.description)
}

function mapLabelRef(label: LabelRecord): EntityRef {
  return entityRef('label', label.id, label.name, label.color)
}

function mapCalendarRef(item: CalendarItemRecord): EntityRef {
  return entityRef('calendar-item', item.id, item.title, item.descriptionMd)
}

function mapNoteRef(note: NoteRecord): EntityRef {
  return entityRef('note', note.id, note.title, note.path)
}

function mapEmailThreadRef(thread: EmailThreadRecord): EntityRef {
  return entityRef('email-thread', thread.id, thread.subject, thread.status)
}

function mapGithubIssueRef(issue: GithubIssueRecord): EntityRef {
  return entityRef('github-issue', issue.id, issue.title, issue.summary)
}

function mapGithubPrRef(pr: GithubPullRequestRecord): EntityRef {
  return entityRef('github-pr', pr.id, pr.title, pr.summary)
}

function mapTelegramChatRef(chat: TelegramChatRecord): EntityRef {
  return entityRef('telegram-chat', chat.id, chat.title, chat.summary)
}

function mapAutomationRef(automation: AutomationRecord): EntityRef {
  return entityRef('automation', automation.id, automation.title, automation.summary)
}

function mapNotificationRef(notification: NotificationRecord): EntityRef {
  return entityRef('notification', notification.id, notification.title)
}

function buildIdentityHandles(state: State) {
  const user = state.identity.user
  const agent = state.identity.agent
  const seedHandles: Array<Omit<State['identity']['handles'][number], 'id'>> = [
    ...(user.emails[0] ? [{ service: 'email', handle: user.emails[0], role: 'user' as const }] : []),
    ...(user.githubUsername ? [{ service: 'github', handle: user.githubUsername, role: 'user' as const }] : []),
    ...(user.telegramHandle ? [{ service: 'telegram', handle: user.telegramHandle, role: 'user' as const }] : []),
    ...(agent.google ? [{ service: 'google', handle: agent.google, role: 'agent' as const }] : []),
    ...(agent.github ? [{ service: 'github', handle: agent.github, role: 'agent' as const }] : []),
    ...(agent.telegram ? [{ service: 'telegram', handle: agent.telegram, role: 'agent' as const }] : []),
  ]

  const existing = new Map(
    state.identity.handles.map((handle) => [`${handle.role}:${handle.service}:${handle.handle}`, handle]),
  )

  state.identity.handles = seedHandles.map((seed) => {
    const key = `${seed.role}:${seed.service}:${seed.handle}`
    const cached = existing.get(key)
    if (cached) return cached
    return {
      id: nextId(state, 'hdl'),
      ...seed,
    }
  })
}

function upsertIdentitySource(state: State, source: State['identity']['sources'][number]) {
  state.identity.sources = [
    source,
    ...state.identity.sources.filter((item) => {
      return !(item.kind === source.kind && item.service === source.service && item.value === source.value)
    }),
  ]
}

function ensureIntegration(state: State, key: string): IntegrationRecord {
  if (!state.integrations[key]) {
    const timestamp = isoNow()
    state.integrations[key] = {
      config: {},
      configuredScopes: [],
      grantedScopes: [],
      missingScopes: [],
      jobs: [],
      provider: {
        provider: key,
        pollers: [],
        status: 'disconnected',
        summary: `${key} is not connected.`,
        surfaces: [],
        lastRefreshedAt: timestamp,
      },
      rateLimits: [],
      status: {
        key,
        status: 'disconnected',
        summary: `${key} is not connected.`,
      },
    }
  }
  return state.integrations[key]
}

function buildOauthStart(key: string, scopes: string[]) {
  return {
    url: `https://origin.local/oauth/${encodeURIComponent(key)}?scopes=${encodeURIComponent(scopes.join(' '))}`,
    state: `state_${key}_${Date.now().toString(36)}`,
    scopes,
  }
}

function collectChecks(state: State): ValidationCheck[] {
  const identityStatus = deriveIdentityStatus(state)
  const integrationStatuses = Object.values(state.integrations)
  const setupReady = state.setup.status === 'ready'
  const workspaceReady = Boolean(state.workspace.indexStatus) && Boolean(state.workspace.bridgeStatus)
  const syncHealthy = state.sync.replicaPeers.length > 0 && state.sync.providerJobs.length > 0
  const notificationReady = state.notifications.devices.length > 0

  return [
    {
      id: 'setup',
      kind: 'setup',
      target: 'setup',
      status: setupReady ? 'pass' : 'warn',
      message: setupReady ? 'Setup is complete.' : 'Setup still has pending work.',
      remediation: setupReady ? undefined : ['Run `origin setup status` and complete the remaining setup phases.'],
    },
    {
      id: 'identity',
      kind: 'identity',
      target: 'identity',
      status: identityStatus.status === 'complete' ? 'pass' : identityStatus.status === 'partial' ? 'warn' : 'fail',
      message: identityStatus.summary,
      remediation: identityStatus['missing-facts']?.length
        ? ['Run `origin identity user update` and `origin identity agent update` to fill the missing facts.']
        : undefined,
    },
    {
      id: 'integrations',
      kind: 'integration',
      target: 'integrations',
      status: integrationStatuses.some((integration) => integration.status.status === 'disconnected')
        ? 'warn'
        : 'pass',
      message: `${integrationStatuses.length} integration(s) tracked.`,
      remediation: integrationStatuses.some((integration) => integration.status.status === 'disconnected')
        ? ['Run `origin integration validate` for the disconnected integrations.']
        : undefined,
    },
    {
      id: 'workspace',
      kind: 'workspace',
      target: 'workspace',
      status: workspaceReady ? 'pass' : 'warn',
      message: workspaceReady ? 'Workspace state is available.' : 'Workspace state needs attention.',
      remediation: workspaceReady ? undefined : ['Run `origin setup vault init` and `origin workspace status`.'],
    },
    {
      id: 'sync',
      kind: 'sync',
      target: 'sync',
      status: syncHealthy ? 'pass' : 'warn',
      message: syncHealthy ? 'Replica and provider sync are populated.' : 'Sync still has incomplete work.',
      remediation: syncHealthy ? undefined : ['Run `origin sync overview` or `origin sync diagnose`.'],
    },
    {
      id: 'notifications',
      kind: 'notification',
      target: 'notifications',
      status: notificationReady ? 'pass' : 'warn',
      message: notificationReady ? 'Notification devices are registered.' : 'No notification devices are registered yet.',
      remediation: notificationReady ? undefined : ['Run `origin setup notification register-device`.'],
    },
    {
      id: 'runtime',
      kind: 'runtime',
      target: 'process',
      status: 'pass',
      message: 'Runtime process is available.',
    },
  ]
}

function deriveBlockers(checks: ValidationCheck[]): Blocker[] {
  return checks
    .filter((check) => check.status !== 'pass')
    .map((check) => ({
      id: `blocker_${check.id}`,
      kind: check.kind,
      severity: check.status === 'fail' ? 'high' : 'medium',
      summary: check.message,
      remediation: check.remediation,
    }))
}

function deriveIdentityStatus(state: State) {
  const missingFacts: string[] = []
  if (!state.identity.user.displayName) missingFacts.push('owner display name')
  if (state.identity.user.emails.length === 0) missingFacts.push('owner email')
  if (!state.identity.user.githubUsername) missingFacts.push('owner GitHub username')
  if (!state.identity.user.telegramHandle) missingFacts.push('owner Telegram handle')
  if (!state.identity.agent.displayName) missingFacts.push('agent display name')
  if (!state.identity.agent.google) missingFacts.push('agent Google account')
  if (!state.identity.agent.github) missingFacts.push('agent GitHub username')
  if (!state.identity.agent.telegram) missingFacts.push('agent Telegram bot username')

  const userHandleValues = new Set([
    ...state.identity.user.emails,
    ...(state.identity.user.githubUsername ? [state.identity.user.githubUsername] : []),
    ...(state.identity.user.telegramHandle ? [state.identity.user.telegramHandle] : []),
  ])
  const agentHandleValues = new Set([
    ...(state.identity.agent.google ? [state.identity.agent.google] : []),
    ...(state.identity.agent.github ? [state.identity.agent.github] : []),
    ...(state.identity.agent.telegram ? [state.identity.agent.telegram] : []),
  ])
  const overlap = [...userHandleValues].filter((value) => agentHandleValues.has(value))
  if (overlap.length > 0) missingFacts.push('identity role overlap')

  const status = missingFacts.length === 0 ? 'complete' : missingFacts.length <= 2 ? 'partial' : 'invalid'
  return {
    summary:
      status === 'complete'
        ? 'Owner and agent identity records are complete.'
        : status === 'partial'
          ? 'Identity records are mostly complete with a few missing facts.'
          : 'Identity records are incomplete or inconsistent.',
    status,
    ...(missingFacts.length ? { ['missing-facts']: missingFacts } : {}),
  }
}

function deriveStatusSummary(state: State, runtime: RuntimeContext) {
  const integrations = Object.entries(state.integrations)
    .map(([key, integration]) => mapIntegrationStatus(key, integration))
    .sort((a, b) => a.key.localeCompare(b.key))
  const blockers = deriveBlockers(collectChecks(state))
  return {
    mode: runtime.instance,
    summary: 'Origin is running with local state, provider overlays, and planning data.',
    setup: state.setup.status === 'ready' ? 'Ready' : state.setup.status === 'in-progress' ? 'In progress' : 'Not started',
    integrations,
    ...(blockers.length ? { blockers } : {}),
  }
}

function deriveServiceStatus(state: State, runtime: RuntimeContext) {
  return [
    {
      name: 'runtime',
      status: runtime.instance,
      summary: `Profile ${runtime.profile} is active.`,
    },
    {
      name: 'store',
      status: 'healthy',
      summary: `State file: ${runtime.store.paths.stateFile}`,
    },
    {
      name: 'workspace',
      status: state.workspace.bridgeStatus ? 'healthy' : 'warning',
      summary: `${state.workspace.indexStatus}; ${state.workspace.bridgeStatus}.`,
    },
    {
      name: 'integrations',
      status: Object.values(state.integrations).some((integration) => integration.status.status === 'disconnected')
        ? 'degraded'
        : 'healthy',
      summary: `${Object.keys(state.integrations).length} integration(s) tracked.`,
    },
    {
      name: 'sync',
      status:
        state.sync.replicaPeers.length > 0 && state.sync.providerJobs.length > 0 ? 'healthy' : 'degraded',
      summary: `${state.sync.replicaPeers.length} peer(s), ${state.sync.providerJobs.length} provider job(s).`,
    },
    {
      name: 'notifications',
      status: state.notifications.devices.length > 0 ? 'healthy' : 'degraded',
      summary: `${state.notifications.devices.length} notification device(s).`,
    },
  ]
}

function deriveStorageStatus(state: State, runtime: RuntimeContext) {
  return {
    sqlite: `State persisted to ${runtime.store.paths.stateFile}.`,
    replica: `${state.sync.replicaPeers.length} peer(s), ${state.sync.replicaJobs.length} replica job(s).`,
    workspace: `${state.workspace.indexStatus}; ${state.workspace.bridgeStatus}.`,
    cache: `${state.memory.artifacts.length} memory artifact(s) and ${state.notes.notes.length} note(s) cached.`,
  }
}

function deriveQueueStatus(state: State) {
  const queueItems: QueueEntry[] = state.automations.queue
  return [
    {
      name: 'chat',
      pending: state.chat.outbox.filter((item) => item.status === 'queued').length,
      failed: state.chat.outbox.filter((item) => item.status === 'failed').length || undefined,
      summary: `${state.chat.outbox.length} chat outbox item(s).`,
    },
    {
      name: 'automation',
      pending: queueItems.reduce((total, item) => total + item.pending, 0),
      failed: queueItems.reduce((total, item) => total + (item.failed ?? 0), 0) || undefined,
      summary: queueItems.map((item) => item.summary).join(' '),
    },
    {
      name: 'notifications',
      pending: state.notifications.deliveries.filter((item) => item.status !== 'delivered').length,
      failed: state.notifications.deliveries.filter((item) => item.status === 'failed').length || undefined,
      summary: `${state.notifications.deliveries.length} delivery record(s).`,
    },
    {
      name: 'sync',
      pending: state.sync.providerOutbox.length,
      failed: state.sync.providerOutbox.filter((item) => item.status === 'failed').length || undefined,
      summary: `${state.sync.providerOutbox.length} pending sync mutation(s).`,
    },
    {
      name: 'email',
      pending: state.email.outbox.length,
      failed: state.email.outbox.filter((item) => item.status === 'failed').length || undefined,
      summary: `${state.email.outbox.length} outbound email action(s).`,
    },
    {
      name: 'github',
      pending: state.github.outbox.length,
      failed: state.github.outbox.filter((item) => item.status === 'failed').length || undefined,
      summary: `${state.github.outbox.length} outbound GitHub action(s).`,
    },
    {
      name: 'telegram',
      pending: state.telegram.outbox.length,
      failed: state.telegram.outbox.filter((item) => item.status === 'failed').length || undefined,
      summary: `${state.telegram.outbox.length} outbound Telegram action(s).`,
    },
  ]
}

function derivePathSummary(runtime: RuntimeContext) {
  return {
    state: runtime.store.paths.stateDir,
    workspace: runtime.store.paths.workspaceRoot,
    vault: runtime.store.paths.vaultRoot,
    sqlite: runtime.store.paths.sqliteFile,
    blobs: runtime.store.paths.blobsDir,
  }
}

function collectSearchCandidates(state: State): SearchCandidate[] {
  const candidates: SearchCandidate[] = []

  for (const project of state.planning.projects) {
    candidates.push({
      domain: 'planning',
      kind: 'project',
      id: project.id,
      title: project.name,
      summary: project.description,
      texts: [project.name, project.status, project.description],
    })
  }
  for (const label of state.planning.labels) {
    candidates.push({
      domain: 'planning',
      kind: 'label',
      id: label.id,
      title: label.name,
      summary: label.color,
      texts: [label.name, label.color],
    })
  }
  for (const task of state.planning.tasks) {
    candidates.push({
      domain: 'planning',
      kind: 'task',
      id: task.id,
      title: task.title,
      summary: task.descriptionMd,
      texts: [task.title, task.status, task.priority, task.descriptionMd, task.dueAt, task.dueFrom, task.noteId],
    })
  }
  for (const item of state.planning.calendarItems) {
    candidates.push({
      domain: 'planning',
      kind: 'calendar-item',
      id: item.id,
      title: item.title,
      summary: item.descriptionMd,
      texts: [item.title, item.kind, item.status, item.descriptionMd, item.location, item.startAt, item.endAt],
    })
  }

  for (const note of state.notes.notes) {
    candidates.push({
      domain: 'note',
      kind: 'note',
      id: note.id,
      title: note.title,
      path: note.path,
      summary: note.content.slice(0, 160),
      excerpt: note.content.slice(0, 180),
      texts: [note.title, note.path, note.content],
    })
  }
  for (const revision of state.memory.revisions) {
    candidates.push({
      domain: 'memory',
      kind: 'memory',
      id: revision.id,
      title: 'Origin Memory',
      path: 'Origin/Memory.md',
      excerpt: revision.content?.slice(0, 180),
      summary: revision.summary,
      texts: [revision.summary, revision.content],
    })
  }
  for (const artifact of state.memory.artifacts) {
    candidates.push({
      domain: 'memory',
      kind: 'memory-artifact',
      id: artifact.path,
      title: artifact.path,
      path: artifact.path,
      summary: artifact.summary,
      texts: [artifact.path, artifact.kind, artifact.summary],
    })
  }

  for (const account of state.email.accounts) {
    candidates.push({
      domain: 'email',
      kind: 'email-account',
      id: account.id,
      title: account.address,
      summary: account.summary,
      texts: [account.address, account.summary, account.status, ...account.labels, ...account.aliases],
    })
  }
  for (const thread of state.email.threads) {
    candidates.push({
      domain: 'email',
      kind: 'email-thread',
      id: thread.id,
      title: thread.subject,
      summary: thread.status,
      texts: [thread.subject, thread.status, ...thread.labelIds, ...thread.linkedTaskIds, thread.triage?.state, thread.triage?.note],
    })
  }
  for (const message of state.email.messages) {
    candidates.push({
      domain: 'email',
      kind: 'email-message',
      id: message.id,
      title: message.subject,
      excerpt: message.snippet ?? message.body?.slice(0, 180),
      summary: message.from,
      texts: [message.subject, message.body, message.snippet, message.from, message.to.join(' '), message.cc?.join(' '), message.bcc?.join(' ')],
    })
  }
  for (const draft of state.email.drafts) {
    candidates.push({
      domain: 'email',
      kind: 'email-draft',
      id: draft.id,
      title: draft.subject,
      summary: draft.body.slice(0, 120),
      texts: [draft.subject, draft.body, draft.to.join(' '), draft.threadId],
    })
  }

  for (const repo of state.github.repositories) {
    candidates.push({
      domain: 'github',
      kind: 'github-repo',
      id: repo.id,
      title: repo.name,
      summary: repo.summary,
      texts: [repo.name, repo.summary],
    })
  }
  for (const issue of state.github.issues) {
    candidates.push({
      domain: 'github',
      kind: 'github-issue',
      id: issue.id,
      title: issue.title,
      summary: issue.summary,
      texts: [issue.ref, issue.title, issue.state, issue.summary, ...issue.labels, ...issue.assignees],
    })
  }
  for (const pr of state.github.pullRequests) {
    candidates.push({
      domain: 'github',
      kind: 'github-pr',
      id: pr.id,
      title: pr.title,
      summary: pr.summary,
      texts: [pr.ref, pr.title, pr.state, pr.summary, ...pr.reviewers, ...pr.checks],
    })
  }
  for (const follow of state.github.follows) {
    candidates.push({
      domain: 'github',
      kind: 'github-follow',
      id: follow.id,
      title: `${follow.repo} ${follow.kind}`,
      summary: follow.reason,
      texts: [follow.repo, follow.kind, follow.targetRef, follow.reason, ...follow.linkedTaskIds, ...follow.linkedNoteIds],
    })
  }

  for (const chat of state.telegram.chats) {
    candidates.push({
      domain: 'telegram',
      kind: 'telegram-chat',
      id: chat.id,
      title: chat.title,
      summary: chat.summary,
      texts: [chat.title, chat.kind, chat.summary, chat.messageCacheState],
    })
  }
  for (const message of state.telegram.messages) {
    candidates.push({
      domain: 'telegram',
      kind: 'telegram-message',
      id: message.id,
      title: message.author ?? 'Telegram message',
      excerpt: message.body.slice(0, 180),
      summary: message.body.slice(0, 120),
      texts: [message.author, message.body, message.chatId],
    })
  }
  for (const summary of state.telegram.summaries) {
    candidates.push({
      domain: 'telegram',
      kind: 'telegram-summary',
      id: summary.id,
      title: summary.chatId,
      summary: summary.summary,
      texts: [summary.chatId, summary.status, summary.summary],
    })
  }

  for (const automation of state.automations.automations) {
    candidates.push({
      domain: 'automation',
      kind: 'automation',
      id: automation.id,
      title: automation.title,
      summary: automation.summary,
      texts: [automation.title, automation.summary, automation.status, automation.kind, JSON.stringify(automation.trigger ?? {})],
    })
  }
  for (const run of state.automations.runs) {
    candidates.push({
      domain: 'automation',
      kind: 'automation-run',
      id: run.id,
      title: run.automationId,
      summary: run.summary,
      texts: [run.automationId, run.summary, run.status, run.triggerReason, run.activityEventId],
    })
  }

  for (const notification of state.notifications.items) {
    candidates.push({
      domain: 'notification',
      kind: 'notification',
      id: notification.id,
      title: notification.title,
      summary: notification.status,
      texts: [notification.title, notification.kind, notification.status],
    })
  }
  for (const device of state.notifications.devices) {
    candidates.push({
      domain: 'notification',
      kind: 'notification-device',
      id: device.id,
      title: `${device.kind} device`,
      summary: device.summary,
      texts: [device.kind, device.status, device.summary],
    })
  }
  for (const delivery of state.notifications.deliveries) {
    candidates.push({
      domain: 'notification',
      kind: 'notification-delivery',
      id: delivery.id,
      title: delivery.notificationId,
      summary: delivery.summary,
      texts: [delivery.notificationId, delivery.channel, delivery.status, delivery.summary],
    })
  }

  for (const peer of state.sync.replicaPeers) {
    candidates.push({
      domain: 'sync',
      kind: 'sync-peer',
      id: peer.id,
      title: peer.kind,
      summary: peer.summary,
      texts: [peer.kind, peer.status, peer.summary],
    })
  }
  for (const job of state.sync.replicaJobs) {
    candidates.push({
      domain: 'sync',
      kind: 'sync-job',
      id: job.id,
      title: job.kind,
      summary: job.summary,
      texts: [job.kind, job.status, job.summary, job.traceId],
    })
  }
  for (const job of state.sync.providerJobs) {
    candidates.push({
      domain: 'sync',
      kind: 'sync-job',
      id: job.id,
      title: job.kind,
      summary: job.summary,
      texts: [job.kind, job.status, job.summary, job.traceId],
    })
  }
  for (const conflict of state.sync.replicaConflicts) {
    candidates.push({
      domain: 'sync',
      kind: 'sync-conflict',
      id: conflict.id,
      title: conflict.kind,
      summary: conflict.summary,
      texts: [conflict.kind, conflict.summary, ...(conflict.peers ?? [])],
    })
  }
  for (const item of state.sync.providerOutbox) {
    candidates.push({
      domain: 'sync',
      kind: 'outbox',
      id: item.id,
      title: item.kind,
      summary: item.summary,
      texts: [item.kind, item.status, item.summary],
    })
  }

  for (const session of state.chat.sessions) {
    candidates.push({
      domain: 'chat',
      kind: 'chat-session',
      id: session.id,
      title: session.title ?? session.id,
      summary: session.status,
      texts: [session.title, session.status, ...session.seedContext, ...session.messages.map((message) => message.body)],
    })
  }
  for (const item of state.chat.outbox) {
    candidates.push({
      domain: 'chat',
      kind: 'chat-outbox',
      id: item.id,
      title: item.kind,
      summary: item.summary,
      texts: [item.kind, item.status, item.summary, item.provider],
    })
  }

  for (const [key, integration] of Object.entries(state.integrations)) {
    candidates.push({
      domain: 'integration',
      kind: 'integration',
      id: key,
      title: key,
      summary: integration.status.summary,
      texts: [key, integration.status.status, integration.status.summary, JSON.stringify(integration.config), ...integration.configuredScopes, ...integration.grantedScopes, ...integration.missingScopes],
    })
    for (const job of integration.jobs) {
      candidates.push({
        domain: 'integration',
        kind: 'integration-job',
        id: job.id,
        title: `${key} ${job.kind}`,
        summary: job.summary,
        texts: [job.kind, job.status, job.summary, job.traceId],
      })
    }
  }

  for (const input of state.setup.inputs) {
    candidates.push({
      domain: 'setup',
      kind: 'setup-input',
      id: input.key,
      title: input.key,
      summary: input.source,
      texts: [input.key, JSON.stringify(input.value), input.source],
    })
  }
  for (const phase of state.setup.phases) {
    candidates.push({
      domain: 'setup',
      kind: 'setup-phase',
      id: phase.key,
      title: phase.title,
      summary: phase.summary,
      texts: [phase.key, phase.title, phase.status, phase.summary, ...(phase.nextActions ?? [])],
    })
  }

  for (const activity of state.activities) {
    candidates.push({
      domain: 'activity',
      kind: 'activity',
      id: activity.id,
      title: activity.summary,
      summary: activity.kind,
      excerpt: activity.detailsMd?.slice(0, 160),
      texts: [activity.kind, activity.summary, activity.status, activity.actor, activity.target, activity.traceId, ...(activity.entityRefs ?? []), ...(activity.sourceRefs ?? [])],
    })
  }

  return candidates
}

function scoreCandidate(candidate: SearchCandidate, query: string, mode: 'exact' | 'semantic' | 'hybrid') {
  const haystack = candidate.texts.filter(Boolean).join(' ')
  if (mode === 'exact') {
    return matchesQuery(haystack, query) ? 1 : 0
  }
  const semantic = scoreText(query, haystack)
  if (mode === 'semantic') return semantic
  return Math.max(semantic, matchesQuery(haystack, query) ? 1 : 0)
}

function searchState(
  state: State,
  options: {
    query: string
    mode?: 'exact' | 'semantic' | 'hybrid'
    domains?: string[]
    limit?: number
  },
) {
  const mode = options.mode ?? 'hybrid'
  const allowedDomains = options.domains?.length ? new Set(options.domains) : undefined
  const scored = collectSearchCandidates(state)
    .filter((candidate) => !allowedDomains || allowedDomains.has(candidate.domain))
    .map((candidate) => {
      const score = scoreCandidate(candidate, options.query, mode)
      return score > 0
        ? {
            kind: candidate.kind,
            id: candidate.id,
            title: candidate.title,
            score,
            ...(candidate.excerpt ? { excerpt: candidate.excerpt } : {}),
            ...(candidate.path ? { path: candidate.path } : {}),
          }
        : undefined
    })
    .filter((candidate): candidate is SearchHit => Boolean(candidate))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title))
  return options.limit === undefined ? scored : scored.slice(0, options.limit)
}

function resolveEntity(state: State, ref: string): EntityRef | undefined {
  const lowerRef = ref.toLowerCase()
  const candidates: EntityRef[] = []

  for (const project of state.planning.projects) candidates.push(mapProjectRef(project))
  for (const label of state.planning.labels) candidates.push(mapLabelRef(label))
  for (const task of state.planning.tasks) candidates.push(mapTaskRef(task))
  for (const item of state.planning.calendarItems) candidates.push(mapCalendarRef(item))
  for (const note of state.notes.notes) candidates.push(mapNoteRef(note))
  for (const thread of state.email.threads) candidates.push(mapEmailThreadRef(thread))
  for (const account of state.email.accounts) candidates.push(entityRef('email-account', account.id, account.address, account.summary))
  for (const repo of state.github.repositories) candidates.push(entityRef('github-repo', repo.id, repo.name, repo.summary))
  for (const issue of state.github.issues) candidates.push(mapGithubIssueRef(issue))
  for (const pr of state.github.pullRequests) candidates.push(mapGithubPrRef(pr))
  for (const chat of state.telegram.chats) candidates.push(mapTelegramChatRef(chat))
  for (const automation of state.automations.automations) candidates.push(mapAutomationRef(automation))
  for (const notification of state.notifications.items) candidates.push(mapNotificationRef(notification))
  for (const [key, integration] of Object.entries(state.integrations)) {
    candidates.push(entityRef('integration', key, key, integration.status.summary))
  }
  for (const input of state.setup.inputs) {
    candidates.push(entityRef('setup-input', input.key, input.key, typeof input.value === 'string' ? input.value : undefined))
  }
  for (const phase of state.setup.phases) {
    candidates.push(entityRef('setup-phase', phase.key, phase.title, phase.summary))
  }
  for (const activity of state.activities) {
    candidates.push(entityRef('activity', activity.id, activity.summary, activity.kind))
  }

  return (
    candidates.find((candidate) => candidate.id === ref) ??
    candidates.find((candidate) => candidate.title.toLowerCase() === lowerRef) ??
    candidates.find((candidate) => candidate.title.toLowerCase().includes(lowerRef)) ??
    candidates.find((candidate) => candidate.summary?.toLowerCase().includes(lowerRef))
  )
}

function relatedEntityRefs(state: State, ref: string, domains?: string[], limit = 10) {
  const resolved = resolveEntity(state, ref)
  const result: EntityRef[] = []

  const allowDomain = (kind: string) => !domains?.length || domains.includes(kind)
  const add = (candidate?: EntityRef) => {
    if (!candidate) return
    if (!allowDomain(candidate.kind)) return
    if (candidate.id === resolved?.id) return
    if (result.some((item) => item.id === candidate.id && item.kind === candidate.kind)) return
    result.push(candidate)
  }

  for (const link of state.entityLinks) {
    if (link.from === ref) add(resolveEntity(state, link.to))
    else if (link.to === ref) add(resolveEntity(state, link.from))
  }

  if (resolved?.kind === 'project') {
    for (const task of state.planning.tasks.filter((item) => item.projectId === resolved.id)) add(mapTaskRef(task))
    for (const item of state.planning.calendarItems.filter((entry) => entry.projectId === resolved.id)) add(mapCalendarRef(item))
  } else if (resolved?.kind === 'task') {
    const task = state.planning.tasks.find((entry) => entry.id === resolved.id)
    if (task) {
      for (const project of state.planning.projects.filter((entry) => entry.id === task.projectId)) add(mapProjectRef(project))
      for (const linked of state.planning.tasks.filter((entry) => task.blockedBy.includes(entry.id))) add(mapTaskRef(linked))
      if (task.noteId) add(resolveEntity(state, task.noteId))
      for (const calendar of state.planning.calendarItems.filter((entry) => task.calendarItemIds.includes(entry.id))) add(mapCalendarRef(calendar))
    }
  } else if (resolved?.kind === 'note') {
    for (const link of state.entityLinks.filter((entry) => entry.from === resolved.id || entry.to === resolved.id)) {
      add(resolveEntity(state, link.from === resolved.id ? link.to : link.from))
    }
  } else if (resolved?.kind === 'email-thread') {
    const thread = state.email.threads.find((entry) => entry.id === resolved.id)
    if (thread) {
      for (const message of state.email.messages.filter((entry) => entry.threadId === thread.id)) {
        add(entityRef('email-message', message.id, message.subject))
      }
      for (const task of state.planning.tasks.filter((entry) => thread.linkedTaskIds.includes(entry.id))) add(mapTaskRef(task))
    }
  }

  if (resolved?.kind === 'github-issue') {
    for (const follow of state.github.follows.filter((entry) => entry.targetRef === resolved.id)) {
      add(entityRef('github-follow', follow.id, `${follow.repo} ${follow.kind}`, follow.reason))
    }
  }

  return result.slice(0, limit)
}

function recentActivityEntities(state: State, limit = 10) {
  const refs: EntityRef[] = []
  for (const activity of state.activities.slice(0, limit * 2)) {
    for (const ref of activity.entityRefs ?? []) {
      const entity = resolveEntity(state, ref)
      if (entity && !refs.some((item) => item.id === entity.id && item.kind === entity.kind)) refs.push(entity)
    }
    if (activity.target) {
      const entity = resolveEntity(state, activity.target)
      if (entity && !refs.some((item) => item.id === entity.id && item.kind === entity.kind)) refs.push(entity)
    }
  }
  return refs.slice(0, limit)
}

function resolveHandleCandidates(state: State, query: string) {
  const normalized = query.toLowerCase()
  return state.identity.handles.filter(
    (handle) =>
      matchesQuery(handle.handle, normalized) ||
      matchesQuery(handle.service, normalized) ||
      matchesQuery(handle.role, normalized),
  )
}

function updateSetupStatus(state: State) {
  if (state.setup.phases.length === 0) {
    return
  }
  if (state.setup.phases.every((phase) => phase.status === 'complete')) {
    state.setup.status = 'ready'
  } else if (state.setup.phases.some((phase) => phase.status !== 'complete')) {
    state.setup.status = 'in-progress'
  }
}

function findIntegrationJobs(state: State) {
  return Object.entries(state.integrations).flatMap(([key, integration]) =>
    integration.jobs.map((job) => ({
      id: job.id,
      integration: key,
      kind: job.kind,
      status: job.status,
      summary: job.summary,
      ...(job.startedAt ? { ['started-at']: job.startedAt } : {}),
      ...(job.endedAt ? { ['ended-at']: job.endedAt } : {}),
      ...(job.traceId ? { ['trace-id']: job.traceId } : {}),
    })),
  )
}

function findIntegrationJob(state: State, jobId: string) {
  for (const [key, integration] of Object.entries(state.integrations)) {
    const job = integration.jobs.find((item) => item.id === jobId)
    if (job) {
      return {
        id: job.id,
        integration: key,
        kind: job.kind,
        status: job.status,
        summary: job.summary,
        ...(job.startedAt ? { ['started-at']: job.startedAt } : {}),
        ...(job.endedAt ? { ['ended-at']: job.endedAt } : {}),
        ...(job.traceId ? { ['trace-id']: job.traceId } : {}),
      }
    }
  }
  return undefined
}

function deriveDeploymentPlan(state: State) {
  const steps = [
    state.setup.mode === 'vps' ? 'Provision VPS runtime and service' : 'Validate local runtime state',
    state.identity.user.emails.length > 0 ? 'Identity already seeded' : 'Collect owner identity',
    Object.keys(state.integrations).length > 0 ? 'Validate integrations' : 'Connect core integrations',
    state.setup.deployment.logs.length > 0 ? 'Review deployment logs' : 'Start deployment',
  ]
  return {
    mode: state.setup.mode === 'vps' ? 'vps' : 'local',
    steps,
  }
}

function deriveDeploymentStatus(state: State) {
  const status = state.setup.deployment.lastRunAt ? 'healthy' : 'not-run'
  return {
    summary: state.setup.deployment.lastRunAt ? 'Deployment checks have been executed.' : 'Deployment has not run yet.',
    status,
    ...(state.setup.deployment.lastRunAt ? { ['last-run-at']: state.setup.deployment.lastRunAt } : {}),
  }
}

function deriveDeploymentLogs(state: State) {
  return {
    lines: state.setup.deployment.logs.length
      ? state.setup.deployment.logs
      : ['No deployment logs have been recorded yet.'],
  }
}

function deriveSetupStatus(state: State) {
  return {
    mode: state.setup.mode,
    status: state.setup.status,
    summary:
      state.setup.status === 'ready'
        ? 'Setup is complete.'
        : state.setup.status === 'in-progress'
          ? 'Setup is still in progress.'
          : 'Setup has not started.',
    phases: state.setup.phases.map(mapSetupPhase),
  }
}

function deriveSetupExportSummary(state: State) {
  return {
    summary: `Setup is ${state.setup.status} in ${state.setup.mode} mode.`,
    phases: state.setup.phases.map(mapSetupPhase),
  }
}

function createDeploymentLogLine(action: string, state: State) {
  return `${isoNow()} ${action} (${state.setup.mode})`
}

function deriveContextPack(state: State, entities: EntityRef[], notes: string[], highlights: string[]) {
  return {
    summary:
      highlights[0] ??
      notes[0] ??
      (entities[0] ? `Context centered on ${entities[0].title}.` : 'No high-signal context found.'),
    entities,
    ...(notes.length ? { notes } : {}),
    ...(highlights.length ? { highlights } : {}),
  }
}

function buildContextNow(state: State, domains?: string[], limit = 5) {
  const entityPool: EntityRef[] = [
    ...state.planning.tasks.filter((task) => task.status !== 'complete' && task.status !== 'done').map(mapTaskRef),
    ...state.email.threads.filter((thread) => thread.unread || thread.status !== 'read').map(mapEmailThreadRef),
    ...state.github.issues.filter((issue) => issue.state !== 'closed').map(mapGithubIssueRef),
    ...state.github.pullRequests.filter((pr) => pr.state !== 'closed').map(mapGithubPrRef),
    ...state.telegram.chats.map(mapTelegramChatRef),
    ...state.notifications.items.filter((notification) => !notification.read).map(mapNotificationRef),
    ...state.automations.automations.filter((automation) => automation.status !== 'disabled').map(mapAutomationRef),
  ]

  const filtered = domains?.length
    ? entityPool.filter((entity) => domains.includes(entity.kind) || domains.includes(entity.kind.replace(/-.*/, '')))
    : entityPool

  const entities = uniqueById(filtered).slice(0, limit)
  const notes = [
    `${state.planning.tasks.filter((task) => task.status !== 'complete' && task.status !== 'done').length} task(s) are not complete.`,
    `${state.email.threads.filter((thread) => thread.unread || thread.status !== 'read').length} email thread(s) still need attention.`,
  ]
  const highlights = state.activities.slice(0, 3).map((activity) => activity.summary)
  return deriveContextPack(state, entities, notes, highlights)
}

function buildContextRelevant(state: State, goal: string, options: { mode?: 'exact' | 'semantic' | 'hybrid'; domains?: string[]; limit?: number }) {
  const hits = searchState(state, {
    query: goal,
    mode: options.mode,
    domains: options.domains,
    limit: options.limit ?? 8,
  })
  const entities = hits.map((hit) => resolveEntity(state, hit.id) ?? entityRef(hit.kind, hit.id, hit.title, hit.excerpt))
  return deriveContextPack(
    state,
    uniqueById(entities).slice(0, options.limit ?? 5),
    [`Search goal: ${goal}`],
    hits.slice(0, 3).map((hit) => hit.excerpt ?? hit.title),
  )
}

function buildContextEntity(state: State, ref: string, domains?: string[], limit = 5) {
  const entity = resolveEntity(state, ref)
  const entities = uniqueById([
    ...(entity ? [entity] : []),
    ...relatedEntityRefs(state, ref, domains, limit - 1),
    ...recentActivityEntities(state, 2),
  ]).slice(0, limit)
  return deriveContextPack(state, entities, [`Resolved entity: ${entity?.title ?? ref}`], relatedEntityRefs(state, ref, domains, limit).slice(0, 3).map((item) => item.title))
}

function buildContextDay(state: State, date: string) {
  const tasks = state.planning.tasks.filter((task) => task.dueAt?.startsWith(date) || task.dueFrom?.startsWith(date))
  const items = state.planning.calendarItems.filter(
    (item) => item.startDate === date || item.startAt?.startsWith(date) || item.endDateExclusive === date,
  )
  const entities = uniqueById([...tasks.map(mapTaskRef), ...items.map(mapCalendarRef)]).slice(0, 5)
  return deriveContextPack(
    state,
    entities,
    [`Planning items selected for ${date}.`],
    [
      `${tasks.length} task(s) due or scheduled on this day.`,
      `${items.length} calendar item(s) scheduled on this day.`,
    ],
  )
}

function buildContextInbox(state: State, limit = 5) {
  const entities: EntityRef[] = [
    ...state.email.threads.filter((thread) => thread.unread || thread.triage?.state !== 'done').map(mapEmailThreadRef),
    ...state.github.issues.filter((issue) => issue.state !== 'closed').map(mapGithubIssueRef),
    ...state.github.pullRequests.filter((pr) => pr.state !== 'closed').map(mapGithubPrRef),
    ...state.telegram.chats.map(mapTelegramChatRef),
    ...state.notifications.items.filter((notification) => !notification.read).map(mapNotificationRef),
  ]
  const unique = uniqueById(entities).slice(0, limit)
  return deriveContextPack(
    state,
    unique,
    [`${state.email.threads.length} email thread(s), ${state.github.issues.length} GitHub issue(s), and ${state.notifications.items.length} notification(s) in the inbox set.`],
    unique.map((item) => item.title).slice(0, 3),
  )
}

function buildContextProject(state: State, projectId: string) {
  const project = state.planning.projects.find((item) => item.id === projectId)
  const tasks = state.planning.tasks.filter((task) => task.projectId === projectId)
  const calendarItems = state.planning.calendarItems.filter((item) => item.projectId === projectId)
  const entities = uniqueById([
    ...(project ? [mapProjectRef(project)] : []),
    ...tasks.map(mapTaskRef),
    ...calendarItems.map(mapCalendarRef),
  ]).slice(0, 5)
  return deriveContextPack(
    state,
    entities,
    [project ? `Project ${project.name} selected.` : `Unknown project ${projectId}.`],
    [`${tasks.length} related task(s).`, `${calendarItems.length} related calendar item(s).`],
  )
}

function searchResolveCandidates(state: State, query: string, domains?: string[]) {
  const hits = searchState(state, { query, mode: 'hybrid', domains, limit: 10 })
  const handles = resolveHandleCandidates(state, query).map((handle) => ({
    kind: 'identity-handle',
    id: handle.id,
    title: handle.handle,
    score: 1,
    excerpt: `${handle.service} (${handle.role})`,
  }))
  return uniqueById([...hits, ...handles])
}

function deriveIdentityVerifyResult(state: State) {
  const checks: ValidationCheck[] = []
  const status = deriveIdentityStatus(state)
  checks.push({
    id: 'identity-completeness',
    kind: 'identity',
    target: 'owner-and-agent',
    status: status.status === 'complete' ? 'pass' : status.status === 'partial' ? 'warn' : 'fail',
    message: status.summary,
    remediation: status['missing-facts']?.length ? ['Update the missing identity facts.'] : undefined,
  })
  checks.push({
    id: 'identity-handles',
    kind: 'identity',
    target: 'handles',
    status: state.identity.handles.length > 0 ? 'pass' : 'warn',
    message: `${state.identity.handles.length} handle record(s) stored.`,
    remediation: state.identity.handles.length > 0 ? undefined : ['Add identity handles during onboarding.'],
  })
  checks.push({
    id: 'identity-sources',
    kind: 'identity',
    target: 'sources',
    status: state.identity.sources.length > 0 ? 'pass' : 'warn',
    message: `${state.identity.sources.length} source record(s) stored.`,
  })
  return validationResult(checks, 'Identity validation completed.')
}

function ensureSetupInput(state: State, key: string, value: JsonValue | undefined, source?: string) {
  const existing = state.setup.inputs.find((item) => item.key === key)
  if (existing) {
    existing.value = value
    existing.source = source
    return existing
  }
  const input: SetupInput = { key, value, source }
  state.setup.inputs.push(input)
  return input
}

function resolveOrCreateSetupPhase(state: State, phaseKey: string) {
  const existing = state.setup.phases.find((phase) => phase.key === phaseKey)
  if (existing) return existing
  const phase: SetupPhase = {
    key: phaseKey,
    title: phaseKey,
    status: 'pending',
    summary: `Setup phase ${phaseKey} is pending.`,
    nextActions: [],
  }
  state.setup.phases.push(phase)
  return phase
}

function updateTelegramGroupPolicies(state: State, chatIds: string[], privacyMode?: string) {
  const nowValue = isoNow()
  state.telegram.groups = chatIds.map((chatId) => ({
    chatId,
    enabled: true,
    participationMode: privacyMode === 'disabled' ? 'observe' : 'participate',
    summaryPolicy: {
      enabled: true,
      window: '24h',
    },
    mentionTrackingEnabled: true,
    messageCacheEnabled: true,
    summary: `Configured from onboarding at ${nowValue}.`,
  }))
}

function updateIntegrationState(
  state: State,
  key: string,
  patch: Partial<IntegrationRecord>,
  activitySummary: string,
) {
  const integration = ensureIntegration(state, key)
  Object.assign(integration, patch)
  addActivity(state, {
    kind: 'integration.update',
    status: 'completed',
    actor: 'origin/agent',
    summary: activitySummary,
    provider: key,
    entityRefs: [key],
  })
  return integration
}

function ensureIntegrationDefaults(state: State, key: string) {
  const integration = ensureIntegration(state, key)
  if (!integration.status.key) integration.status.key = key
  if (!integration.provider.provider) integration.provider.provider = key
  return integration
}

function integrationJobRecord(key: string, job: IntegrationRecord['jobs'][number]) {
  return {
    id: job.id,
    integration: key,
    kind: job.kind,
    status: job.status,
    summary: job.summary,
    ...(job.startedAt ? { ['started-at']: job.startedAt } : {}),
    ...(job.endedAt ? { ['ended-at']: job.endedAt } : {}),
    ...(job.traceId ? { ['trace-id']: job.traceId } : {}),
  }
}

function allIntegrationJobs(state: State) {
  return Object.entries(state.integrations).flatMap(([key, integration]) =>
    integration.jobs.map((job) => integrationJobRecord(key, job)),
  )
}

function integrationJobById(state: State, jobId: string) {
  for (const [key, integration] of Object.entries(state.integrations)) {
    const job = integration.jobs.find((entry) => entry.id === jobId)
    if (job) return integrationJobRecord(key, job)
  }
  return undefined
}

function buildIntegrationValidation(state: State, key?: string) {
  const keys = key ? [key] : Object.keys(state.integrations)
  const checks: ValidationCheck[] = keys.map((integrationKey) => {
    const integration = ensureIntegrationDefaults(state, integrationKey)
    const healthy = integration.status.status === 'connected'
    return {
      id: `integration-${integrationKey}`,
      kind: 'integration',
      target: integrationKey,
      status: healthy ? 'pass' : 'warn',
      message: integration.status.summary,
      remediation: healthy ? undefined : [`Run \`origin integration connect\` or \`origin integration refresh ${integrationKey}\`. `],
    }
  })
  return validationResult(checks, key ? `Validation completed for ${key}.` : 'Validation completed for integrations.')
}

function buildSetupValidation(state: State) {
  const checks: ValidationCheck[] = [
    {
      id: 'setup-mode',
      kind: 'setup',
      target: 'mode',
      status: state.setup.mode === 'unselected' ? 'warn' : 'pass',
      message: `Setup mode is ${state.setup.mode}.`,
      remediation: state.setup.mode === 'unselected' ? ['Run `origin setup mode set local` or `origin setup mode set vps`.'] : undefined,
    },
    {
      id: 'setup-phases',
      kind: 'setup',
      target: 'phases',
      status: state.setup.phases.every((phase) => phase.status === 'complete') ? 'pass' : 'warn',
      message: `${state.setup.phases.filter((phase) => phase.status === 'complete').length}/${state.setup.phases.length} setup phases complete.`,
      remediation: state.setup.phases.every((phase) => phase.status === 'complete') ? undefined : ['Run the pending setup phases.'],
    },
    {
      id: 'setup-identity',
      kind: 'setup',
      target: 'identity',
      status: deriveIdentityStatus(state).status === 'complete' ? 'pass' : 'warn',
      message: deriveIdentityStatus(state).summary,
    },
    {
      id: 'setup-notifications',
      kind: 'setup',
      target: 'notifications',
      status: state.notifications.devices.length > 0 ? 'pass' : 'warn',
      message: `${state.notifications.devices.length} notification device(s) registered.`,
    },
  ]
  return validationResult(checks, 'Setup validation completed.')
}

export const statusContextSearchIdentityIntegrationSetupHandlers = defineHandlers({
  'status show': route('status show', async (context: RouteHandlerContext<'status show'>) => {
    const state = await loadState(context.runtime)
    return deriveStatusSummary(state, context.runtime)
  }),
  'status doctor': route('status doctor', async (context: RouteHandlerContext<'status doctor'>) => {
    const state = await loadState(context.runtime)
    return validationResult(
      collectChecks(state),
      collectChecks(state).every((check) => check.status === 'pass')
        ? 'All status checks passed.'
        : collectChecks(state).some((check) => check.status === 'fail')
          ? 'One or more blocking status checks failed.'
          : 'Status checks completed with warnings.',
    )
  }),
  'status blockers': route('status blockers', async (context: RouteHandlerContext<'status blockers'>) => {
    const state = await loadState(context.runtime)
    const blockers = deriveBlockers(collectChecks(state))
    return listResult(blockers.map(mapBlocker), {
      summary: blockers.length ? `${blockers.length} blocker(s) identified.` : 'No blockers identified.',
      total: blockers.length,
    })
  }),
  'status checks': route('status checks', async (context: RouteHandlerContext<'status checks'>) => {
    const state = await loadState(context.runtime)
    const checks = collectChecks(state)
    return listResult(checks.map(mapStatusCheck), { total: checks.length, summary: `${checks.length} check(s).` })
  }),
  'status check get': route('status check get', async (context: RouteHandlerContext<'status check get'>) => {
    const state = await loadState(context.runtime)
    const checks = collectChecks(state)
    const check = checks.find((item) => item.id === context.args['check-id'])
    if (!check) {
      return context.error({ code: 'NOT_FOUND', message: `Unknown status check '${context.args['check-id']}'.` })
    }
    return check
  }),
  'status runtime': route('status runtime', async (context: RouteHandlerContext<'status runtime'>) => {
    const state = await loadState(context.runtime)
    return {
      uptime: formatDuration(process.uptime()),
      pid: process.pid,
      version: '0.0.0-spec',
      mode: context.runtime.instance,
    }
  }),
  'status services': route('status services', async (context: RouteHandlerContext<'status services'>) => {
    const state = await loadState(context.runtime)
    const services = deriveServiceStatus(state, context.runtime)
    return listResult(services, { total: services.length, summary: `${services.length} service(s).` })
  }),
  'status storage': route('status storage', async (context: RouteHandlerContext<'status storage'>) => {
    const state = await loadState(context.runtime)
    return deriveStorageStatus(state, context.runtime)
  }),
  'status queues': route('status queues', async (context: RouteHandlerContext<'status queues'>) => {
    const state = await loadState(context.runtime)
    const queues = deriveQueueStatus(state)
    return listResult(queues, { total: queues.length, summary: `${queues.length} queue(s).` })
  }),
  'status paths': route('status paths', async (context: RouteHandlerContext<'status paths'>) => {
    const state = await loadState(context.runtime)
    return derivePathSummary(context.runtime)
  }),

  'context now': route('context now', async (context: RouteHandlerContext<'context now'>) => {
    const state = await loadState(context.runtime)
    return buildContextNow(state, context.options.domains ?? undefined, 5)
  }),
  'context relevant': route('context relevant', async (context: RouteHandlerContext<'context relevant'>) => {
    const state = await loadState(context.runtime)
    return buildContextRelevant(state, context.args.goal, {
      mode: context.options.mode,
      domains: context.options.domains ?? undefined,
      limit: context.options.limit ?? undefined,
    })
  }),
  'context entity': route('context entity', async (context: RouteHandlerContext<'context entity'>) => {
    const state = await loadState(context.runtime)
    return buildContextEntity(state, context.args.entity, undefined, 5)
  }),
  'context day': route('context day', async (context: RouteHandlerContext<'context day'>) => {
    const state = await loadState(context.runtime)
    return buildContextDay(state, context.args.date)
  }),
  'context inbox': route('context inbox', async (context: RouteHandlerContext<'context inbox'>) => {
    const state = await loadState(context.runtime)
    return buildContextInbox(state, context.options.limit ?? 5)
  }),
  'context project': route('context project', async (context: RouteHandlerContext<'context project'>) => {
    const state = await loadState(context.runtime)
    return buildContextProject(state, context.args['project-id'])
  }),

  'search query': route('search query', async (context: RouteHandlerContext<'search query'>) => {
    const state = await loadState(context.runtime)
    const hits = searchState(state, {
      query: context.options.query,
      mode: context.options.mode,
      domains: context.options.domains ?? undefined,
      limit: context.options.limit ?? undefined,
    })
    return listResult(hits, { total: hits.length, summary: `${hits.length} search hit(s).` })
  }),
  'search similar': route('search similar', async (context: RouteHandlerContext<'search similar'>) => {
    const state = await loadState(context.runtime)
    const seed = resolveEntity(state, context.args.seed)
    const query = seed ? [seed.title, seed.summary].filter(Boolean).join(' ') : context.args.seed
    const hits = searchState(state, {
      query,
      domains: context.options.domains ?? undefined,
      limit: context.options.limit ?? undefined,
    })
    return listResult(hits, { total: hits.length, summary: `${hits.length} similarity hit(s).` })
  }),
  'search related': route('search related', async (context: RouteHandlerContext<'search related'>) => {
    const state = await loadState(context.runtime)
    const ref = context.args.entity
    const hits = uniqueById([
      ...relatedEntityRefs(state, ref, context.options.domains ?? undefined, context.options.limit ?? 10).map((entity) => ({
        kind: entity.kind,
        id: entity.id,
        title: entity.title,
        score: 1,
        ...(entity.summary ? { excerpt: entity.summary } : {}),
      })),
      ...searchState(state, { query: ref, mode: 'hybrid', domains: context.options.domains ?? undefined, limit: 5 }),
    ])
    return listResult(hits.slice(0, context.options.limit ?? 10), { total: hits.length, summary: `${hits.length} related hit(s).` })
  }),
  'search recent': route('search recent', async (context: RouteHandlerContext<'search recent'>) => {
    const state = await loadState(context.runtime)
    const domains = context.options.domains ?? []
    const hits: SearchHit[] = []
    for (const activity of state.activities.slice(0, context.options.limit ?? 10)) {
      if (domains.length > 0 && !domains.some((domain: string) => activity.kind.startsWith(domain))) continue
      for (const ref of activity.entityRefs ?? []) {
        const entity = resolveEntity(state, ref)
        if (!entity) continue
        hits.push({
          kind: entity.kind,
          id: entity.id,
          title: entity.title,
          score: 1,
          excerpt: activity.summary,
        })
      }
    }
    return listResult(uniqueById(hits), { total: hits.length, summary: `${hits.length} recent hit(s).` })
  }),
  'search resolve': route('search resolve', async (context: RouteHandlerContext<'search resolve'>) => {
    const state = await loadState(context.runtime)
    const hits = searchResolveCandidates(state, context.options.query, context.options.domains ?? undefined)
    return listResult(hits, { total: hits.length, summary: `${hits.length} resolution candidate(s).` })
  }),

  'identity status': route('identity status', async (context: RouteHandlerContext<'identity status'>) => {
    const state = await loadState(context.runtime)
    return deriveIdentityStatus(state)
  }),
  'identity user get': route('identity user get', async (context: RouteHandlerContext<'identity user get'>) => {
    const state = await loadState(context.runtime)
    return {
      ...(state.identity.user.displayName ? { ['display-name']: state.identity.user.displayName } : {}),
      emails: state.identity.user.emails,
      ...(state.identity.user.githubUsername ? { ['github-username']: state.identity.user.githubUsername } : {}),
      ...(state.identity.user.telegramHandle ? { ['telegram-handle']: state.identity.user.telegramHandle } : {}),
    }
  }),
  'identity user update': route('identity user update', async (context: RouteHandlerContext<'identity user update'>) => {
    return mutateState(context.runtime, async (state) => {
      const user = state.identity.user
      if (context.options['display-name'] !== undefined) user.displayName = context.options['display-name'] || undefined
      if (context.options.emails !== undefined) user.emails = context.options.emails
      if (context.options['github-username'] !== undefined) user.githubUsername = context.options['github-username'] || undefined
      if (context.options['telegram-handle'] !== undefined) user.telegramHandle = context.options['telegram-handle'] || undefined
      buildIdentityHandles(state)
      upsertIdentitySource(state, { kind: 'manual', service: 'identity', value: 'user-update' })
      addActivity(state, {
        kind: 'identity.update',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Updated owner identity.',
        entityRefs: ['identity:user'],
      })
      return actionResult('Updated owner identity.', { affectedIds: state.identity.handles.map((handle) => handle.id) })
    })
  }),
  'identity agent get': route('identity agent get', async (context: RouteHandlerContext<'identity agent get'>) => {
    const state = await loadState(context.runtime)
    return {
      ...(state.identity.agent.displayName ? { ['display-name']: state.identity.agent.displayName } : {}),
      ...(state.identity.agent.google ? { google: state.identity.agent.google } : {}),
      ...(state.identity.agent.github ? { github: state.identity.agent.github } : {}),
      ...(state.identity.agent.telegram ? { telegram: state.identity.agent.telegram } : {}),
    }
  }),
  'identity agent update': route('identity agent update', async (context: RouteHandlerContext<'identity agent update'>) => {
    return mutateState(context.runtime, async (state) => {
      const agent = state.identity.agent
      if (context.options['display-name'] !== undefined) agent.displayName = context.options['display-name'] || undefined
      if (context.options.google !== undefined) agent.google = context.options.google || undefined
      if (context.options.github !== undefined) agent.github = context.options.github || undefined
      if (context.options.telegram !== undefined) agent.telegram = context.options.telegram || undefined
      buildIdentityHandles(state)
      upsertIdentitySource(state, { kind: 'manual', service: 'identity', value: 'agent-update' })
      addActivity(state, {
        kind: 'identity.update',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Updated agent identity.',
        entityRefs: ['identity:agent'],
      })
      return actionResult('Updated agent identity.', { affectedIds: state.identity.handles.map((handle) => handle.id) })
    })
  }),
  'identity resolve': route('identity resolve', async (context: RouteHandlerContext<'identity resolve'>) => {
    const state = await loadState(context.runtime)
    const query = context.options.query.toLowerCase()
    const handles = state.identity.handles.filter(
      (handle) => matchesQuery(handle.handle, query) || matchesQuery(handle.service, query) || matchesQuery(handle.role, query),
    )
    return listResult(handles.map(mapHandle), { total: handles.length, summary: `${handles.length} handle candidate(s).` })
  }),
  'identity handles': route('identity handles', async (context: RouteHandlerContext<'identity handles'>) => {
    const state = await loadState(context.runtime)
    return listResult(state.identity.handles.map(mapHandle), { total: state.identity.handles.length, summary: `${state.identity.handles.length} handle record(s).` })
  }),
  'identity handle add': route('identity handle add', async (context: RouteHandlerContext<'identity handle add'>) => {
    return mutateState(context.runtime, async (state) => {
      const existing = state.identity.handles.find(
        (handle) =>
          handle.service === context.options.service &&
          handle.handle === context.options.handle &&
          handle.role === context.options.role,
      )
      if (existing) {
        existing.handle = context.options.handle
        existing.service = context.options.service
        existing.role = context.options.role
      } else {
        state.identity.handles.push({
          id: nextId(state, 'hdl'),
          service: context.options.service,
          handle: context.options.handle,
          role: context.options.role,
        })
      }
      addActivity(state, {
        kind: 'identity.handle.add',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Added identity handle for ${context.options.service}.`,
        entityRefs: ['identity:handles'],
      })
      return actionResult(`Added identity handle for ${context.options.service}.`, { affectedIds: state.identity.handles.map((handle) => handle.id) })
    })
  }),
  'identity handle remove': route('identity handle remove', async (context: RouteHandlerContext<'identity handle remove'>) => {
    return mutateState(context.runtime, async (state) => {
      const before = state.identity.handles.length
      state.identity.handles = state.identity.handles.filter((handle) => handle.id !== context.args['handle-id'])
      if (state.identity.handles.length === before) {
        return context.error({ code: 'NOT_FOUND', message: `Unknown identity handle '${context.args['handle-id']}'.` })
      }
      addActivity(state, {
        kind: 'identity.handle.remove',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Removed identity handle ${context.args['handle-id']}.`,
        entityRefs: ['identity:handles'],
      })
      return actionResult(`Removed identity handle ${context.args['handle-id']}.`, { affectedIds: [context.args['handle-id']] })
    })
  }),
  'identity verify': route('identity verify', async (context: RouteHandlerContext<'identity verify'>) => {
    const state = await loadState(context.runtime)
    return deriveIdentityVerifyResult(state)
  }),
  'identity sources': route('identity sources', async (context: RouteHandlerContext<'identity sources'>) => {
    const state = await loadState(context.runtime)
    return listResult(state.identity.sources.map(mapIdentitySource), { total: state.identity.sources.length, summary: `${state.identity.sources.length} source record(s).` })
  }),

  'integration list': route('integration list', async (context: RouteHandlerContext<'integration list'>) => {
    const state = await loadState(context.runtime)
    const integrations = Object.entries(state.integrations)
      .map(([key, integration]) => mapIntegrationStatus(key, integration))
      .sort((a, b) => a.key.localeCompare(b.key))
    return listResult(integrations, { total: integrations.length, summary: `${integrations.length} integration(s).` })
  }),
  'integration get': route('integration get', async (context: RouteHandlerContext<'integration get'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    return mapIntegrationStatus(context.args.integration, integration)
  }),
  'integration config get': route('integration config get', async (context: RouteHandlerContext<'integration config get'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    return mapIntegrationConfig(context.args.integration, integration)
  }),
  'integration config set': route('integration config set', async (context: RouteHandlerContext<'integration config set'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, context.args.integration)
      integration.config = {
        ...integration.config,
        ...safeObject(context.options.values),
      }
      addActivity(state, {
        kind: 'integration.config.set',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Updated ${context.args.integration} config.`,
        entityRefs: [context.args.integration],
      })
      return actionResult(`Updated ${context.args.integration} config.`, { affectedIds: [context.args.integration] })
    })
  }),
  'integration connect oauth start': route('integration connect oauth start', async (context: RouteHandlerContext<'integration connect oauth start'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    const scopes = integration.configuredScopes.length ? integration.configuredScopes : ['read']
    return buildOauthStart(context.args.integration, scopes)
  }),
  'integration connect oauth complete': route('integration connect oauth complete', async (context: RouteHandlerContext<'integration connect oauth complete'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, context.args.integration)
      integration.status.status = 'connected'
      integration.provider.status = 'connected'
      integration.provider.lastRefreshedAt = isoNow()
      integration.status.lastValidatedAt = isoNow()
      integration.status.lastRefreshedAt = isoNow()
      integration.grantedScopes = integration.configuredScopes.length ? [...integration.configuredScopes] : ['read']
      integration.missingScopes = []
      addActivity(state, {
        kind: 'integration.oauth.complete',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Completed OAuth for ${context.args.integration}.`,
        entityRefs: [context.args.integration],
      })
      return actionResult(`Completed OAuth for ${context.args.integration}.`, { affectedIds: [context.args.integration] })
    })
  }),
  'integration connect token set': route('integration connect token set', async (context: RouteHandlerContext<'integration connect token set'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, context.args.integration)
      integration.config = {
        ...integration.config,
        tokenRef: context.options['token-ref'],
      }
      integration.status.status = 'connected'
      integration.provider.status = 'connected'
      integration.status.lastValidatedAt = isoNow()
      integration.status.lastRefreshedAt = isoNow()
      integration.provider.lastRefreshedAt = isoNow()
      addActivity(state, {
        kind: 'integration.token.set',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Stored token ref for ${context.args.integration}.`,
        entityRefs: [context.args.integration],
      })
      return actionResult(`Stored token ref for ${context.args.integration}.`, { affectedIds: [context.args.integration] })
    })
  }),
  'integration reconnect': route('integration reconnect', async (context: RouteHandlerContext<'integration reconnect'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, context.args.integration)
      integration.status.status = 'connected'
      integration.provider.status = 'connected'
      integration.status.lastValidatedAt = isoNow()
      integration.status.lastRefreshedAt = isoNow()
      addActivity(state, {
        kind: 'integration.reconnect',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Reconnected ${context.args.integration}.`,
        entityRefs: [context.args.integration],
      })
      return actionResult(`Reconnected ${context.args.integration}.`, { affectedIds: [context.args.integration] })
    })
  }),
  'integration disconnect': route('integration disconnect', async (context: RouteHandlerContext<'integration disconnect'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, context.args.integration)
      integration.status.status = 'disconnected'
      integration.provider.status = 'disconnected'
      integration.grantedScopes = []
      integration.missingScopes = [...integration.configuredScopes]
      integration.status.lastValidatedAt = isoNow()
      addActivity(state, {
        kind: 'integration.disconnect',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Disconnected ${context.args.integration}.`,
        entityRefs: [context.args.integration],
      })
      return actionResult(`Disconnected ${context.args.integration}.`, { affectedIds: [context.args.integration] })
    })
  }),
  'integration scopes': route('integration scopes', async (context: RouteHandlerContext<'integration scopes'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    return mapIntegrationScopeStatus(context.args.integration, integration)
  }),
  'integration permissions': route('integration permissions', async (context: RouteHandlerContext<'integration permissions'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    return mapIntegrationScopeStatus(context.args.integration, integration)
  }),
  'integration validate': route('integration validate', async (context: RouteHandlerContext<'integration validate'>) => {
    const state = await loadState(context.runtime)
    const keys = context.options.integration ? [context.options.integration] : Object.keys(state.integrations)
    const checks: ValidationCheck[] = keys.map((key) => {
      const integration = ensureIntegrationDefaults(state, key)
      const healthy = integration.status.status === 'connected'
      return {
        id: `integration-${key}`,
        kind: 'integration',
        target: key,
        status: healthy ? 'pass' : 'warn',
        message: integration.status.summary,
        remediation: healthy ? undefined : [`Run \`origin integration connect oauth start ${key}\` or set a token.`],
      }
    })
    return validationResult(checks, 'Integration validation completed.')
  }),
  'integration refresh': route('integration refresh', async (context: RouteHandlerContext<'integration refresh'>) => {
    return mutateState(context.runtime, async (state) => {
      const keys = context.options.integration ? [context.options.integration] : Object.keys(state.integrations)
      for (const key of keys) {
        const integration = ensureIntegrationDefaults(state, key)
        const timestamp = isoNow()
        integration.status.lastRefreshedAt = timestamp
        integration.provider.lastRefreshedAt = timestamp
      }
      addActivity(state, {
        kind: 'integration.refresh',
        status: 'completed',
        actor: 'origin/agent',
        summary: keys.length === 1 ? `Refreshed ${keys[0]}.` : `Refreshed ${keys.length} integrations.`,
        entityRefs: keys,
      })
      return actionResult(keys.length === 1 ? `Refreshed ${keys[0]}.` : `Refreshed ${keys.length} integrations.`, {
        affectedIds: keys,
      })
    })
  }),
  'integration jobs': route('integration jobs', async (context: RouteHandlerContext<'integration jobs'>) => {
    const state = await loadState(context.runtime)
    let jobs = allIntegrationJobs(state)
    if (context.options.integration) jobs = jobs.filter((job) => job.integration === context.options.integration)
    if (context.options.status?.length) jobs = jobs.filter((job) => context.options.status!.includes(job.status))
    return listResult(jobs, { total: jobs.length, summary: `${jobs.length} integration job(s).` })
  }),
  'integration job get': route('integration job get', async (context: RouteHandlerContext<'integration job get'>) => {
    const state = await loadState(context.runtime)
    const job = integrationJobById(state, context.args['job-id'])
    if (!job) {
      return context.error({ code: 'NOT_FOUND', message: `Unknown integration job '${context.args['job-id']}'.` })
    }
    return job
  }),
  'integration retry': route('integration retry', async (context: RouteHandlerContext<'integration retry'>) => {
    return mutateState(context.runtime, async (state) => {
      for (const integration of Object.values(state.integrations)) {
        const job = integration.jobs.find((entry) => entry.id === context.args['job-id'])
        if (!job) continue
        job.status = 'retrying'
        job.summary = `${job.summary} Retry scheduled.`
        job.startedAt = isoNow()
        addActivity(state, {
          kind: 'integration.job.retry',
          status: 'completed',
          actor: 'origin/agent',
          summary: `Retry scheduled for integration job ${context.args['job-id']}.`,
          entityRefs: [context.args['job-id']],
        })
        return actionResult(`Retry scheduled for integration job ${context.args['job-id']}.`, { jobId: context.args['job-id'] })
      }
      return context.error({ code: 'NOT_FOUND', message: `Unknown integration job '${context.args['job-id']}'.` })
    })
  }),
  'integration cache status': route('integration cache status', async (context: RouteHandlerContext<'integration cache status'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    return mapProviderIngressStatus(context.args.integration, integration)
  }),
  'integration cache refresh': route('integration cache refresh', async (context: RouteHandlerContext<'integration cache refresh'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, context.args.integration)
      integration.provider.lastRefreshedAt = isoNow()
      integration.provider.summary = `${context.args.integration} cache refreshed.`
      addActivity(state, {
        kind: 'integration.cache.refresh',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Refreshed cache for ${context.args.integration}.`,
        entityRefs: [context.args.integration],
      })
      return actionResult(`Refreshed cache for ${context.args.integration}.`, { affectedIds: [context.args.integration] })
    })
  }),
  'integration cache clear': route('integration cache clear', async (context: RouteHandlerContext<'integration cache clear'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, context.args.integration)
      integration.provider.surfaces = integration.provider.surfaces.map((surface) => ({
        ...surface,
        cachedItems: 0,
      }))
      integration.provider.summary = `${context.args.integration} cache cleared.`
      addActivity(state, {
        kind: 'integration.cache.clear',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Cleared cache for ${context.args.integration}.`,
        entityRefs: [context.args.integration],
      })
      return actionResult(`Cleared cache for ${context.args.integration}.`, { affectedIds: [context.args.integration] })
    })
  }),
  'integration rate-limits': route('integration rate-limits', async (context: RouteHandlerContext<'integration rate-limits'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    const items = integration.rateLimits.map((limit) => mapRateLimit(context.args.integration, limit))
    return listResult(items, { total: items.length, summary: `${items.length} rate-limit bucket(s).` })
  }),
  'integration history': route('integration history', async (context: RouteHandlerContext<'integration history'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    const items = integration.jobs.map((job) => integrationJobRecord(context.args.integration, job))
    return listResult(items, { total: items.length, summary: `${items.length} integration history item(s).` })
  }),
  'integration diagnose': route('integration diagnose', async (context: RouteHandlerContext<'integration diagnose'>) => {
    const state = await loadState(context.runtime)
    const integration = ensureIntegrationDefaults(state, context.args.integration)
    const checks: ValidationCheck[] = [
      {
        id: 'integration-status',
        kind: 'integration',
        target: context.args.integration,
        status: integration.status.status === 'connected' ? 'pass' : 'warn',
        message: integration.status.summary,
      },
      {
        id: 'integration-scopes',
        kind: 'integration',
        target: `${context.args.integration}:scopes`,
        status: integration.missingScopes.length === 0 ? 'pass' : 'warn',
        message: integration.missingScopes.length === 0 ? 'All scopes are granted.' : `${integration.missingScopes.length} scope(s) still missing.`,
      },
      {
        id: 'integration-provider',
        kind: 'integration',
        target: `${context.args.integration}:provider`,
        status: integration.provider.status === 'connected' ? 'pass' : 'warn',
        message: integration.provider.summary,
      },
    ]
    return validationResult(checks, `Diagnosed ${context.args.integration}.`)
  }),

  'setup start': route('setup start', async (context: RouteHandlerContext<'setup start'>) => {
    return mutateState(context.runtime, async (state) => {
      if (state.setup.status === 'not-started') state.setup.status = 'in-progress'
      state.setup.mode = state.setup.mode === 'unselected' ? 'local' : state.setup.mode
      addActivity(state, {
        kind: 'setup.start',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Setup started.',
        entityRefs: ['setup'],
      })
      return actionResult('Setup started.')
    })
  }),
  'setup status': route('setup status', async (context: RouteHandlerContext<'setup status'>) => {
    const state = await loadState(context.runtime)
    return deriveSetupStatus(state)
  }),
  'setup resume': route('setup resume', async (context: RouteHandlerContext<'setup resume'>) => {
    return mutateState(context.runtime, async (state) => {
      state.setup.status = 'in-progress'
      addActivity(state, {
        kind: 'setup.resume',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Resumed setup.',
        entityRefs: ['setup'],
      })
      return actionResult('Resumed setup.')
    })
  }),
  'setup phases': route('setup phases', async (context: RouteHandlerContext<'setup phases'>) => {
    const state = await loadState(context.runtime)
    const phases = state.setup.phases.map(mapSetupPhase)
    return listResult(phases, { total: phases.length, summary: `${phases.length} setup phase(s).` })
  }),
  'setup phase get': route('setup phase get', async (context: RouteHandlerContext<'setup phase get'>) => {
    const state = await loadState(context.runtime)
    const phase = resolveOrCreateSetupPhase(state, context.args.phase)
    return mapSetupPhase(phase)
  }),
  'setup phase run': route('setup phase run', async (context: RouteHandlerContext<'setup phase run'>) => {
    return mutateState(context.runtime, async (state) => {
      const phase = resolveOrCreateSetupPhase(state, context.args.phase)
      phase.status = 'complete'
      phase.summary = `${phase.title} completed.`
      phase.nextActions = []
      updateSetupStatus(state)
      addActivity(state, {
        kind: 'setup.phase.run',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Ran setup phase ${context.args.phase}.`,
        entityRefs: ['setup', context.args.phase],
      })
      return actionResult(`Ran setup phase ${context.args.phase}.`)
    })
  }),
  'setup phase validate': route('setup phase validate', async (context: RouteHandlerContext<'setup phase validate'>) => {
    const state = await loadState(context.runtime)
    const phase = resolveOrCreateSetupPhase(state, context.args.phase)
    return validationResult(
      [
        {
          id: `phase-${phase.key}`,
          kind: 'setup-phase',
          target: phase.key,
          status: phase.status === 'complete' ? 'pass' : 'warn',
          message: phase.summary,
          remediation: phase.status === 'complete' ? undefined : phase.nextActions,
        },
      ],
      `Validated setup phase ${phase.key}.`,
    )
  }),
  'setup phase reset': route('setup phase reset', async (context: RouteHandlerContext<'setup phase reset'>) => {
    return mutateState(context.runtime, async (state) => {
      const phase = resolveOrCreateSetupPhase(state, context.args.phase)
      phase.status = 'pending'
      phase.summary = `${phase.title} reset and ready to rerun.`
      phase.nextActions = phase.nextActions ?? ['Run the setup phase again.']
      state.setup.status = 'in-progress'
      addActivity(state, {
        kind: 'setup.phase.reset',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Reset setup phase ${context.args.phase}.`,
        entityRefs: ['setup', context.args.phase],
      })
      return actionResult(`Reset setup phase ${context.args.phase}.`)
    })
  }),
  'setup inputs': route('setup inputs', async (context: RouteHandlerContext<'setup inputs'>) => {
    const state = await loadState(context.runtime)
    const inputs = state.setup.inputs.map(mapSetupInput)
    return listResult(inputs, { total: inputs.length, summary: `${inputs.length} setup input(s).` })
  }),
  'setup input get': route('setup input get', async (context: RouteHandlerContext<'setup input get'>) => {
    const state = await loadState(context.runtime)
    const input = state.setup.inputs.find((item) => item.key === context.args.key)
    if (!input) {
      return context.error({ code: 'NOT_FOUND', message: `Unknown setup input '${context.args.key}'.` })
    }
    return mapSetupInput(input)
  }),
  'setup input set': route('setup input set', async (context: RouteHandlerContext<'setup input set'>) => {
    return mutateState(context.runtime, async (state) => {
      ensureSetupInput(state, context.args.key, context.options.value as JsonValue, 'manual')
      addActivity(state, {
        kind: 'setup.input.set',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Set setup input ${context.args.key}.`,
        entityRefs: ['setup', context.args.key],
      })
      return actionResult(`Set setup input ${context.args.key}.`, { affectedIds: [context.args.key] })
    })
  }),
  'setup input unset': route('setup input unset', async (context: RouteHandlerContext<'setup input unset'>) => {
    return mutateState(context.runtime, async (state) => {
      const before = state.setup.inputs.length
      state.setup.inputs = state.setup.inputs.filter((item) => item.key !== context.args.key)
      if (state.setup.inputs.length === before) {
        return context.error({ code: 'NOT_FOUND', message: `Unknown setup input '${context.args.key}'.` })
      }
      addActivity(state, {
        kind: 'setup.input.unset',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Unset setup input ${context.args.key}.`,
        entityRefs: ['setup', context.args.key],
      })
      return actionResult(`Unset setup input ${context.args.key}.`, { affectedIds: [context.args.key] })
    })
  }),
  'setup mode set': route('setup mode set', async (context: RouteHandlerContext<'setup mode set'>) => {
    return mutateState(context.runtime, async (state) => {
      state.setup.mode = context.args.mode
      if (state.setup.status === 'not-started') state.setup.status = 'in-progress'
      ensureSetupInput(state, 'mode', context.args.mode, 'manual')
      addActivity(state, {
        kind: 'setup.mode.set',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Set deployment mode to ${context.args.mode}.`,
        entityRefs: ['setup'],
      })
      return actionResult(`Set deployment mode to ${context.args.mode}.`, { affectedIds: ['setup'] })
    })
  }),
  'setup identity user set': route('setup identity user set', async (context: RouteHandlerContext<'setup identity user set'>) => {
    return mutateState(context.runtime, async (state) => {
      if (context.options['display-name'] !== undefined) state.identity.user.displayName = context.options['display-name'] || undefined
      if (context.options.emails !== undefined) state.identity.user.emails = context.options.emails
      if (context.options['github-username'] !== undefined) state.identity.user.githubUsername = context.options['github-username'] || undefined
      if (context.options['telegram-handle'] !== undefined) state.identity.user.telegramHandle = context.options['telegram-handle'] || undefined
      buildIdentityHandles(state)
      upsertIdentitySource(state, { kind: 'setup', service: 'identity', value: 'user' })
      addActivity(state, {
        kind: 'setup.identity.user.set',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Persisted owner identity onboarding inputs.',
        entityRefs: ['identity:user'],
      })
      return actionResult('Persisted owner identity onboarding inputs.', { affectedIds: state.identity.handles.map((handle) => handle.id) })
    })
  }),
  'setup identity agent set': route('setup identity agent set', async (context: RouteHandlerContext<'setup identity agent set'>) => {
    return mutateState(context.runtime, async (state) => {
      if (context.options['display-name'] !== undefined) state.identity.agent.displayName = context.options['display-name'] || undefined
      if (context.options.google !== undefined) state.identity.agent.google = context.options.google || undefined
      if (context.options.github !== undefined) state.identity.agent.github = context.options.github || undefined
      if (context.options.telegram !== undefined) state.identity.agent.telegram = context.options.telegram || undefined
      buildIdentityHandles(state)
      upsertIdentitySource(state, { kind: 'setup', service: 'identity', value: 'agent' })
      addActivity(state, {
        kind: 'setup.identity.agent.set',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Persisted agent identity onboarding inputs.',
        entityRefs: ['identity:agent'],
      })
      return actionResult('Persisted agent identity onboarding inputs.', { affectedIds: state.identity.handles.map((handle) => handle.id) })
    })
  }),
  'setup provider google oauth-start': route('setup provider google oauth-start', async (context: RouteHandlerContext<'setup provider google oauth-start'>) => {
    const state = await loadState(context.runtime)
    return buildOauthStart('google', state.integrations.google?.configuredScopes?.length ? state.integrations.google.configuredScopes : ['calendar', 'tasks'])
  }),
  'setup provider google oauth-complete': route('setup provider google oauth-complete', async (context: RouteHandlerContext<'setup provider google oauth-complete'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, 'google')
      integration.status.status = 'connected'
      integration.provider.status = 'connected'
      integration.status.lastValidatedAt = isoNow()
      integration.status.lastRefreshedAt = isoNow()
      integration.provider.lastRefreshedAt = isoNow()
      integration.grantedScopes = integration.configuredScopes.length ? [...integration.configuredScopes] : ['calendar', 'tasks']
      integration.missingScopes = []
      addActivity(state, {
        kind: 'setup.provider.google.complete',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Completed Google onboarding.',
        entityRefs: ['google'],
      })
      return actionResult('Completed Google onboarding.', { affectedIds: ['google'] })
    })
  }),
  'setup provider github oauth-start': route('setup provider github oauth-start', async (context: RouteHandlerContext<'setup provider github oauth-start'>) => {
    const state = await loadState(context.runtime)
    return buildOauthStart('github', state.integrations.github?.configuredScopes?.length ? state.integrations.github.configuredScopes : ['repo', 'pull_requests'])
  }),
  'setup provider github oauth-complete': route('setup provider github oauth-complete', async (context: RouteHandlerContext<'setup provider github oauth-complete'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, 'github')
      integration.status.status = 'connected'
      integration.provider.status = 'connected'
      integration.status.lastValidatedAt = isoNow()
      integration.status.lastRefreshedAt = isoNow()
      integration.provider.lastRefreshedAt = isoNow()
      integration.grantedScopes = integration.configuredScopes.length ? [...integration.configuredScopes] : ['repo', 'pull_requests']
      integration.missingScopes = []
      addActivity(state, {
        kind: 'setup.provider.github.complete',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Completed GitHub onboarding.',
        entityRefs: ['github'],
      })
      return actionResult('Completed GitHub onboarding.', { affectedIds: ['github'] })
    })
  }),
  'setup provider telegram token-set': route('setup provider telegram token-set', async (context: RouteHandlerContext<'setup provider telegram token-set'>) => {
    return mutateState(context.runtime, async (state) => {
      const integration = ensureIntegrationDefaults(state, 'telegram')
      integration.config = { ...integration.config, tokenRef: context.options['token-ref'] }
      integration.status.status = 'connected'
      integration.provider.status = 'connected'
      integration.status.lastValidatedAt = isoNow()
      integration.status.lastRefreshedAt = isoNow()
      state.telegram.connection.status = 'connected'
      state.telegram.connection.botUsername = state.identity.agent.telegram ?? state.telegram.connection.botUsername
      addActivity(state, {
        kind: 'setup.provider.telegram.token-set',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Configured Telegram bot token.',
        entityRefs: ['telegram'],
      })
      return actionResult('Configured Telegram bot token.', { affectedIds: ['telegram'] })
    })
  }),
  'setup provider telegram configure': route('setup provider telegram configure', async (context: RouteHandlerContext<'setup provider telegram configure'>) => {
    return mutateState(context.runtime, async (state) => {
      const privacyMode = context.options['privacy-mode']
      if (privacyMode !== undefined) {
        state.telegram.connection.privacyMode = privacyMode
      }
      updateTelegramGroupPolicies(state, context.options['group-ids'] ?? [], privacyMode)
      upsertIdentitySource(state, { kind: 'setup', service: 'telegram', value: privacyMode ?? 'unknown' })
      addActivity(state, {
        kind: 'setup.provider.telegram.configure',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Configured Telegram onboarding settings.',
        entityRefs: ['telegram'],
      })
      return actionResult('Configured Telegram onboarding settings.', { affectedIds: context.options['group-ids'] ?? [] })
    })
  }),
  'setup vault init': route('setup vault init', async (context: RouteHandlerContext<'setup vault init'>) => {
    return mutateState(context.runtime, async (state) => {
      ensureSetupInput(state, 'workspace-root', context.options.path, 'setup')
      ensureSetupInput(state, 'workspace-create-if-missing', context.options['create-if-missing'], 'setup')
      if (state.setup.deployment.stateDir === undefined) state.setup.deployment.stateDir = context.runtime.store.paths.stateDir
      addActivity(state, {
        kind: 'setup.vault.init',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Initialized workspace at ${context.options.path}.`,
        entityRefs: ['workspace'],
      })
      return actionResult(`Initialized workspace at ${context.options.path}.`, { affectedIds: [context.options.path] })
    })
  }),
  'setup vault memory-bootstrap': route('setup vault memory-bootstrap', async (context: RouteHandlerContext<'setup vault memory-bootstrap'>) => {
    return mutateState(context.runtime, async (state) => {
      const content = context.options.content
      const previous = state.memory.revisions.at(-1)?.content
      const revision = {
        id: nextId(state, 'rev'),
        actor: 'origin/agent',
        at: isoNow(),
        summary: 'Bootstrapped memory.',
        diff: createRevisionDiff(previous, content),
        content,
      }
      state.memory.revisions = recordRevision(state.memory.revisions, revision)
      addActivity(state, {
        kind: 'setup.memory.bootstrap',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Bootstrapped Origin memory.',
        entityRefs: ['memory'],
      })
      return actionResult('Bootstrapped Origin memory.', { affectedIds: [revision.id] })
    })
  }),
  'setup notification register-device': route('setup notification register-device', async (context: RouteHandlerContext<'setup notification register-device'>) => {
    return mutateState(context.runtime, async (state) => {
      const existing = state.notifications.devices.find((device) => device.kind === context.options.kind)
      if (existing) {
        existing.status = 'enabled'
        existing.summary = `Registered ${context.options.kind} device.`
      } else {
        state.notifications.devices.push({
          id: nextId(state, 'dev'),
          kind: context.options.kind,
          status: 'enabled',
          summary: `Registered ${context.options.kind} device.`,
        })
      }
      addActivity(state, {
        kind: 'setup.notification.register-device',
        status: 'completed',
        actor: 'origin/agent',
        summary: `Registered ${context.options.kind} notification device.`,
        entityRefs: ['notifications'],
      })
      return actionResult(`Registered ${context.options.kind} notification device.`, { affectedIds: state.notifications.devices.map((device) => device.id) })
    })
  }),
  'setup notification preferences-set': route('setup notification preferences-set', async (context: RouteHandlerContext<'setup notification preferences-set'>) => {
    return mutateState(context.runtime, async (state) => {
      state.notifications.preferences = safeObject(context.options.values)
      addActivity(state, {
        kind: 'setup.notification.preferences-set',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Updated notification preferences.',
        entityRefs: ['notifications'],
      })
      return actionResult('Updated notification preferences.', { affectedIds: ['notifications'] })
    })
  }),
  'setup deployment configure': route('setup deployment configure', async (context: RouteHandlerContext<'setup deployment configure'>) => {
    return mutateState(context.runtime, async (state) => {
      if (context.options.host !== undefined) state.setup.deployment.host = context.options.host
      if (context.options.user !== undefined) state.setup.deployment.user = context.options.user
      if (context.options['state-dir'] !== undefined) state.setup.deployment.stateDir = context.options['state-dir']
      if (context.options['service-name'] !== undefined) state.setup.deployment.serviceName = context.options['service-name']
      addActivity(state, {
        kind: 'setup.deployment.configure',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Configured deployment settings.',
        entityRefs: ['setup'],
      })
      return actionResult('Configured deployment settings.', { affectedIds: ['setup'] })
    })
  }),
  'setup deployment plan': route('setup deployment plan', async (context: RouteHandlerContext<'setup deployment plan'>) => {
    const state = await loadState(context.runtime)
    return deriveDeploymentPlan(state)
  }),
  'setup deployment run': route('setup deployment run', async (context: RouteHandlerContext<'setup deployment run'>) => {
    return mutateState(context.runtime, async (state) => {
      state.setup.deployment.lastRunAt = isoNow()
      state.setup.deployment.logs = state.setup.deployment.logs ?? []
      state.setup.deployment.logs.push(createDeploymentLogLine('Deployment run executed', state))
      addActivity(state, {
        kind: 'setup.deployment.run',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Executed deployment run.',
        entityRefs: ['setup'],
      })
      return actionResult('Executed deployment run.', { affectedIds: ['setup'] })
    })
  }),
  'setup deployment status': route('setup deployment status', async (context: RouteHandlerContext<'setup deployment status'>) => {
    const state = await loadState(context.runtime)
    return deriveDeploymentStatus(state)
  }),
  'setup deployment logs': route('setup deployment logs', async (context: RouteHandlerContext<'setup deployment logs'>) => {
    const state = await loadState(context.runtime)
    return deriveDeploymentLogs(state)
  }),
  'setup deployment repair': route('setup deployment repair', async (context: RouteHandlerContext<'setup deployment repair'>) => {
    return mutateState(context.runtime, async (state) => {
      state.setup.deployment.logs = state.setup.deployment.logs ?? []
      state.setup.deployment.logs.push(createDeploymentLogLine('Deployment repair executed', state))
      state.setup.deployment.lastRunAt = isoNow()
      addActivity(state, {
        kind: 'setup.deployment.repair',
        status: 'completed',
        actor: 'origin/agent',
        summary: 'Repaired deployment drift.',
        entityRefs: ['setup'],
      })
      return actionResult('Repaired deployment drift.', { affectedIds: ['setup'] })
    })
  }),
  'setup validate': route('setup validate', async (context: RouteHandlerContext<'setup validate'>) => {
    const state = await loadState(context.runtime)
    return buildSetupValidation(state)
  }),
  'setup export-summary': route('setup export-summary', async (context: RouteHandlerContext<'setup export-summary'>) => {
    const state = await loadState(context.runtime)
    return deriveSetupExportSummary(state)
  }),
})
