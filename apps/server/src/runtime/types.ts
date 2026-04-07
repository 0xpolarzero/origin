export type IsoDate = string
export type IsoDateTime = string

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type DomainName =
  | 'status'
  | 'context'
  | 'search'
  | 'identity'
  | 'integration'
  | 'setup'
  | 'chat'
  | 'memory'
  | 'workspace'
  | 'note'
  | 'file'
  | 'planning'
  | 'email'
  | 'github'
  | 'telegram'
  | 'automation'
  | 'activity'
  | 'entity'
  | 'notification'
  | 'sync'

export type OwnerIdentity = {
  displayName?: string
  emails: string[]
  githubUsername?: string
  telegramHandle?: string
}

export type AgentIdentity = {
  displayName?: string
  google?: string
  github?: string
  telegram?: string
}

export type IdentityHandleRecord = {
  id: string
  service: string
  handle: string
  role: 'user' | 'agent'
}

export type IdentitySourceRecord = {
  kind: string
  service?: string
  value: string
}

export type SetupInputRecord = {
  key: string
  value?: JsonValue
  source?: string
}

export type SetupPhaseRecord = {
  key: string
  title: string
  status: string
  summary: string
  nextActions?: string[]
}

export type IntegrationStatusRecord = {
  key: string
  status: string
  summary: string
  lastValidatedAt?: IsoDateTime
  lastRefreshedAt?: IsoDateTime
}

export type ProviderPollerRecord = {
  id: string
  provider: string
  scope: string
  status: 'active' | 'paused' | 'degraded' | 'auth_failed' | 'rate_limited'
  mode: 'poll'
  cursor?: string
  lastStartedAt?: IsoDateTime
  lastSucceededAt?: IsoDateTime
  lastFailedAt?: IsoDateTime
  lastError?: string
  intervalSeconds?: number
  backoffUntil?: IsoDateTime
  itemsSeen?: number
  itemsChanged?: number
}

export type ProviderSurfaceRecord = {
  id: string
  provider: string
  scope: string
  status: string
  summary: string
  providerRef?: string
  displayName?: string
  selected?: boolean
  cachedItems?: number
  pollers: ProviderPollerRecord[]
}

export type ProviderIngressRecord = {
  provider: string
  status: string
  summary: string
  surfaces: ProviderSurfaceRecord[]
  pollers: ProviderPollerRecord[]
  lastRefreshedAt?: IsoDateTime
}

export type IntegrationRecord = {
  status: IntegrationStatusRecord
  config: Record<string, JsonValue>
  configuredScopes: string[]
  grantedScopes: string[]
  missingScopes: string[]
  provider: ProviderIngressRecord
  rateLimits: Array<{
    integration: string
    bucket: string
    remaining: number
    resetAt?: IsoDateTime
  }>
  jobs: JobRecord[]
}

export type JobRecord = {
  id: string
  integration?: string
  kind: string
  status: string
  summary: string
  startedAt?: IsoDateTime
  endedAt?: IsoDateTime
  traceId?: string
}

export type ActivityEventRecord = {
  id: string
  kind: string
  status: string
  actor: string
  target?: string
  at: IsoDateTime
  summary: string
  severity?: 'info' | 'warn' | 'error'
  provider?: string
  pollerId?: string
  sourceRefs?: string[]
  entityRefs?: string[]
  detailsMd?: string
  traceId?: string
}

export type EntityHistoryRecord = {
  id: string
  actor: string
  at: IsoDateTime
  summary: string
  revisionId?: string
}

export type RevisionDiffRecord = {
  summary: string
  changedFields?: string[]
  patch?: string
}

export type StoredRevisionRecord = {
  id: string
  actor: string
  at: IsoDateTime
  summary: string
  diff?: RevisionDiffRecord
  content?: string
  snapshot?: Record<string, JsonValue>
  head?: boolean
}

export type ConflictRevisionRecord = {
  id: string
  source: string
  label: string
  actor?: string
  at?: IsoDateTime
  summary: string
  diff?: RevisionDiffRecord
}

export type ConflictCandidateRecord = {
  id: string
  label: string
  summary: string
  revisionId?: string
}

export type ConflictRecord = {
  id: string
  kind: string
  path?: string
  noteId?: string
  entityId?: string
  summary: string
  actors: string[]
  peers?: string[]
  revisions: ConflictRevisionRecord[]
  candidates: ConflictCandidateRecord[]
}

export type ChatMessageRecord = {
  id: string
  role: 'user' | 'assistant' | 'system'
  body: string
  at: IsoDateTime
}

export type ChatSessionRecord = {
  id: string
  title?: string
  status: string
  archived: boolean
  seedContext: string[]
  messages: ChatMessageRecord[]
}

export type OutboxItemRecord = {
  id: string
  kind: string
  status: string
  summary: string
  provider?: string
  payload?: Record<string, JsonValue>
}

export type MemoryArtifactRecord = {
  path: string
  kind: string
  summary: string
  replicatedState?: boolean
}

export type NoteAttachmentRecord = {
  id: string
  name: string
  path: string
  contentType?: string
  size?: number
}

export type NoteRecord = {
  id: string
  title: string
  path: string
  content: string
  updatedAt: IsoDateTime
  attachments: NoteAttachmentRecord[]
  revisions: StoredRevisionRecord[]
  history: EntityHistoryRecord[]
  archived?: boolean
}

export type WorkspaceEntryRecord = {
  path: string
  kind: 'file' | 'folder'
  lastModifiedAt?: IsoDateTime
}

export type WorkspaceRevisionRecord = {
  id: string
  path: string
  actor: string
  at: IsoDateTime
  summary: string
  diff?: RevisionDiffRecord
  content?: string
}

export type ProjectRecord = {
  id: string
  name: string
  status: string
  description?: string
  archived?: boolean
  history: EntityHistoryRecord[]
  revisions: StoredRevisionRecord[]
}

export type LabelRecord = {
  id: string
  name: string
  color?: string
  archived?: boolean
  history: EntityHistoryRecord[]
  revisions: StoredRevisionRecord[]
}

export type ExternalLinkRecord =
  | {
      provider: 'google-calendar'
      ref: string
      syncMode: 'import' | 'mirror' | 'detached'
      lifecycleStatus: 'linked' | 'detached'
      calendarId: string
      googleEventId?: string
      lastPulledAt?: IsoDateTime
      lastPushedAt?: IsoDateTime
      lastExternalHash?: string
    }
  | {
      provider: 'google-tasks'
      ref: string
      syncMode: 'import' | 'mirror' | 'detached'
      lifecycleStatus: 'linked' | 'detached'
      taskListId: string
      googleTaskId?: string
      lastPulledAt?: IsoDateTime
      lastPushedAt?: IsoDateTime
      lastExternalHash?: string
    }

export type RecurrenceRecord = {
  rule: string
  startDate?: IsoDate
  endDate?: IsoDate
  seriesId?: string
  occurrenceIndex?: number
  previousOccurrenceId?: string
  nextOccurrenceId?: string
  advanceMode?: 'on_completion' | 'on_schedule'
}

export type TaskRecord = {
  id: string
  title: string
  status: string
  priority?: string
  projectId?: string
  labelIds: string[]
  descriptionMd?: string
  noteId?: string
  calendarItemIds: string[]
  dueKind?: 'date' | 'datetime'
  dueFrom?: string
  dueAt?: string
  dueTimezone?: string
  blockedBy: string[]
  recurrence?: RecurrenceRecord
  externalLinks: ExternalLinkRecord[]
  archived?: boolean
  history: EntityHistoryRecord[]
  revisions: StoredRevisionRecord[]
}

export type CalendarItemRecord = {
  id: string
  title: string
  status: string
  kind?: string
  projectId?: string
  labelIds: string[]
  descriptionMd?: string
  location?: string
  startDate?: IsoDate
  endDateExclusive?: IsoDate
  startAt?: IsoDateTime
  endAt?: IsoDateTime
  timezone?: string
  allDay?: boolean
  recurrence?: RecurrenceRecord
  taskIds: string[]
  externalLinks: ExternalLinkRecord[]
  archived?: boolean
  history: EntityHistoryRecord[]
  revisions: StoredRevisionRecord[]
}

export type EmailAttachmentRecord = {
  id: string
  name: string
  contentType?: string
  size?: number
  cachedPath?: string
}

export type EmailMessageRecord = {
  id: string
  threadId: string
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body?: string
  snippet?: string
  headers?: Record<string, string>
  raw?: string
  at: IsoDateTime
  attachments: EmailAttachmentRecord[]
  provenance?: {
    isForwarded?: boolean
    forwardedByUser?: boolean
    forwardedFromAddress?: string
  }
}

export type EmailTriageRecordState = {
  threadId: string
  state: string
  followUpAt?: IsoDateTime
  linkedTaskId?: string
  note?: string
}

export type EmailThreadRecord = {
  id: string
  accountId: string
  subject: string
  status: string
  messageIds: string[]
  labelIds: string[]
  triage?: EmailTriageRecordState
  lastMessageAt?: IsoDateTime
  freshness?: string
  archived?: boolean
  unread?: boolean
  starred?: boolean
  spam?: boolean
  trashed?: boolean
  pinned?: boolean
  linkedTaskIds: string[]
}

export type EmailDraftRecord = {
  id: string
  subject: string
  to: string[]
  body: string
  threadId?: string
}

export type EmailAccountRecord = {
  id: string
  address: string
  status: string
  summary: string
  lastSyncAt?: IsoDateTime
  syncState?: string
  labels: string[]
  aliases: string[]
}

export type GithubRepositoryRecord = {
  id: string
  name: string
  tracked: boolean
  summary: string
  pinned?: boolean
  starred?: boolean
  followed?: boolean
}

export type GithubFollowTargetRecord = {
  id: string
  kind: string
  repo: string
  targetRef?: string
  reason?: string
  linkedTaskIds: string[]
  linkedNoteIds: string[]
  dismissed?: boolean
}

export type GithubCommentRecord = {
  id: string
  author: string
  body: string
  at: IsoDateTime
}

export type GithubReviewRecord = {
  id: string
  prRef: string
  author: string
  state: string
  body?: string
  at: IsoDateTime
}

export type GithubIssueRecord = {
  id: string
  ref: string
  title: string
  state: string
  summary: string
  labels: string[]
  assignees: string[]
  commentIds: string[]
}

export type GithubPullRequestRecord = {
  id: string
  ref: string
  title: string
  state: string
  summary: string
  reviewers: string[]
  checks: string[]
  commentIds: string[]
  reviewIds: string[]
  files: string[]
  diff: string
  draft?: boolean
}

export type TelegramConnectionRecord = {
  status: string
  botUsername?: string
  privacyMode?: string
  summary: string
  defaultMode?: 'observe' | 'participate'
  defaultSummaryEnabled?: boolean
  defaultSummaryWindow?: string
}

export type TelegramChatRecord = {
  id: string
  title: string
  kind: string
  summary: string
  isRegistered?: boolean
  messageCacheState?: string
}

export type TelegramGroupPolicyRecord = {
  chatId: string
  enabled: boolean
  participationMode?: 'observe' | 'participate'
  summaryPolicy?: {
    enabled: boolean
    window?: string
  }
  mentionTrackingEnabled?: boolean
  messageCacheEnabled?: boolean
  summary?: string
}

export type TelegramMessageRecord = {
  id: string
  chatId: string
  author?: string
  body: string
  at: IsoDateTime
}

export type TelegramSummaryJobRecord = {
  id: string
  chatId: string
  status: string
  summary: string
  at?: IsoDateTime
}

export type AutomationTriggerRecord =
  | {
      type: 'schedule'
      cron: string
      timezone?: string
      startAt?: IsoDateTime
      endAt?: IsoDateTime
    }
  | {
      type: 'event'
      eventKinds: string[]
      filters?: Record<string, JsonValue>
      sourceScope?: Record<string, JsonValue>
    }
  | {
      type: 'manual'
    }
  | {
      type: 'hybrid'
      schedule: {
        cron: string
        timezone?: string
        startAt?: IsoDateTime
        endAt?: IsoDateTime
      }
      event: {
        eventKinds: string[]
        filters?: Record<string, JsonValue>
        sourceScope?: Record<string, JsonValue>
      }
    }

export type AutomationActionRecord = {
  type: 'command'
  command: string
  args?: string[]
  options?: Record<string, JsonValue>
  summary?: string
}

export type AutomationRunPolicyRecord = {
  allowOverlap: boolean
  catchUp: 'skip' | 'one' | 'all'
  continueOnError: boolean
}

export type AutomationRetryPolicyRecord = {
  maxAttempts: number
  backoff: 'none' | 'linear' | 'exponential'
}

export type AutomationRecord = {
  id: string
  title: string
  status: string
  kind: 'scheduled' | 'reactive' | 'manual' | 'hybrid'
  summary: string
  trigger?: AutomationTriggerRecord
  actions?: AutomationActionRecord[]
  runPolicy?: AutomationRunPolicyRecord
  retryPolicy?: AutomationRetryPolicyRecord
}

export type AutomationRunStepRecord = {
  id: string
  kind: string
  status: string
  summary: string
}

export type AutomationRunRecord = {
  id: string
  automationId: string
  status: string
  summary: string
  triggeredAt?: IsoDateTime
  scheduledAt?: IsoDateTime
  activityEventId?: string
  triggerReason?: string
  startedAt?: IsoDateTime
  endedAt?: IsoDateTime
  traceId?: string
  steps: AutomationRunStepRecord[]
  eventIds: string[]
}

export type NotificationRecord = {
  id: string
  kind: string
  title: string
  status: string
  at: IsoDateTime
  read?: boolean
  snoozedUntil?: IsoDateTime
}

export type NotificationDeviceRecord = {
  id: string
  kind: string
  status: string
  summary: string
}

export type NotificationDeliveryRecord = {
  id: string
  notificationId: string
  channel: string
  status: string
  summary: string
}

export type SyncPeerRecord = {
  id: string
  kind: string
  status: string
  summary: string
}

export type SyncConflictRecord = {
  id: string
  kind: string
  summary: string
  peers?: string[]
  revisions: ConflictRevisionRecord[]
  candidates: ConflictCandidateRecord[]
}

export type BridgeJobRecord = {
  id: string
  status: string
  summary: string
}

export type EntityLinkRecord = {
  from: string
  to: string
  kind: string
}

export type OriginState = {
  version: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  nextId: number
  identity: {
    user: OwnerIdentity
    agent: AgentIdentity
    handles: IdentityHandleRecord[]
    sources: IdentitySourceRecord[]
  }
  setup: {
    mode: 'unselected' | 'local' | 'vps'
    status: 'not-started' | 'in-progress' | 'ready'
    phases: SetupPhaseRecord[]
    inputs: SetupInputRecord[]
    deployment: {
      host?: string
      user?: string
      stateDir?: string
      serviceName?: string
      lastRunAt?: IsoDateTime
      logs: string[]
    }
  }
  integrations: Record<string, IntegrationRecord>
  chat: {
    sessions: ChatSessionRecord[]
    outbox: OutboxItemRecord[]
  }
  memory: {
    revisions: StoredRevisionRecord[]
    artifacts: MemoryArtifactRecord[]
  }
  workspace: {
    revisions: WorkspaceRevisionRecord[]
    conflicts: ConflictRecord[]
    bridgeJobs: BridgeJobRecord[]
    indexStatus: string
    bridgeStatus: string
  }
  notes: {
    notes: NoteRecord[]
    conflicts: ConflictRecord[]
  }
  planning: {
    projects: ProjectRecord[]
    labels: LabelRecord[]
    tasks: TaskRecord[]
    calendarItems: CalendarItemRecord[]
  }
  email: {
    accounts: EmailAccountRecord[]
    threads: EmailThreadRecord[]
    messages: EmailMessageRecord[]
    drafts: EmailDraftRecord[]
    outbox: OutboxItemRecord[]
  }
  github: {
    repositories: GithubRepositoryRecord[]
    follows: GithubFollowTargetRecord[]
    issues: GithubIssueRecord[]
    pullRequests: GithubPullRequestRecord[]
    comments: GithubCommentRecord[]
    reviews: GithubReviewRecord[]
    outbox: OutboxItemRecord[]
  }
  telegram: {
    connection: TelegramConnectionRecord
    chats: TelegramChatRecord[]
    groups: TelegramGroupPolicyRecord[]
    messages: TelegramMessageRecord[]
    summaries: TelegramSummaryJobRecord[]
    outbox: OutboxItemRecord[]
  }
  automations: {
    automations: AutomationRecord[]
    runs: AutomationRunRecord[]
    queue: Array<{ name: string; pending: number; failed?: number; summary: string }>
  }
  notifications: {
    items: NotificationRecord[]
    preferences: Record<string, JsonValue>
    devices: NotificationDeviceRecord[]
    deliveries: NotificationDeliveryRecord[]
  }
  sync: {
    replicaPeers: SyncPeerRecord[]
    replicaJobs: JobRecord[]
    providerJobs: JobRecord[]
    replicaConflicts: SyncConflictRecord[]
    providerOutbox: OutboxItemRecord[]
  }
  activities: ActivityEventRecord[]
  entityLinks: EntityLinkRecord[]
}

export type RuntimePaths = {
  stateDir: string
  workspaceRoot: string
  vaultRoot: string
  stateFile: string
  sqliteFile: string
  blobsDir: string
  exportsDir: string
}
