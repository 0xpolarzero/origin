import { join } from 'node:path'

import { addActivity, createHistoryEntry, createRevisionDiff, now, nextId, recordRevision } from './helpers.ts'
import type {
  AgentIdentity,
  IdentityHandleRecord,
  IntegrationRecord,
  OriginState,
  OwnerIdentity,
  RuntimePaths,
} from './types.ts'

function seedIdentityHandles(user: OwnerIdentity, agent: AgentIdentity): IdentityHandleRecord[] {
  const handles: IdentityHandleRecord[] = []

  if (user.emails[0]) {
    handles.push({
      id: 'hdl_0001',
      service: 'email',
      handle: user.emails[0],
      role: 'user',
    })
  }

  if (user.githubUsername) {
    handles.push({
      id: 'hdl_0002',
      service: 'github',
      handle: user.githubUsername,
      role: 'user',
    })
  }

  if (user.telegramHandle) {
    handles.push({
      id: 'hdl_0003',
      service: 'telegram',
      handle: user.telegramHandle,
      role: 'user',
    })
  }

  if (agent.google) {
    handles.push({
      id: 'hdl_0004',
      service: 'google',
      handle: agent.google,
      role: 'agent',
    })
  }

  if (agent.github) {
    handles.push({
      id: 'hdl_0005',
      service: 'github',
      handle: agent.github,
      role: 'agent',
    })
  }

  if (agent.telegram) {
    handles.push({
      id: 'hdl_0006',
      service: 'telegram',
      handle: agent.telegram,
      role: 'agent',
    })
  }

  return handles
}

export function createInitialState(paths: RuntimePaths): OriginState {
  const createdAt = now()

  const user: OwnerIdentity = {
    displayName: 'Origin Owner',
    emails: ['owner@example.com'],
    githubUsername: 'origin-owner',
    telegramHandle: '@origin_owner',
  }

  const agent: AgentIdentity = {
    displayName: 'Origin Agent',
    google: 'agent@example.com',
    github: 'origin-agent',
    telegram: '@origin_bot',
  }

  const state: OriginState = {
    version: 1,
    createdAt,
    updatedAt: createdAt,
    nextId: 800,
    identity: {
      user,
      agent,
      handles: seedIdentityHandles(user, agent),
      sources: [
        { kind: 'onboarding', value: user.displayName ?? 'Origin Owner' },
        { kind: 'onboarding', service: 'email', value: user.emails[0] ?? '' },
        { kind: 'onboarding', service: 'google', value: agent.google ?? '' },
        { kind: 'onboarding', service: 'github', value: agent.github ?? '' },
      ],
    },
    setup: {
      mode: 'local',
      status: 'ready',
      phases: [
        {
          key: 'mode',
          title: 'Deployment mode',
          status: 'complete',
          summary: 'Origin is configured for local mode.',
        },
        {
          key: 'identity',
          title: 'Identity',
          status: 'complete',
          summary: 'Owner and agent identities are recorded.',
        },
        {
          key: 'providers',
          title: 'Providers',
          status: 'complete',
          summary: 'Google, email, GitHub, and Telegram are linked in local state.',
        },
        {
          key: 'workspace',
          title: 'Workspace',
          status: 'complete',
          summary: 'The managed workspace and memory file are ready.',
        },
      ],
      inputs: [
        { key: 'mode', value: 'local', source: 'bootstrap' },
        { key: 'workspace-root', value: paths.workspaceRoot, source: 'bootstrap' },
      ],
      deployment: {
        stateDir: paths.stateDir,
        serviceName: 'origin-local',
        logs: ['Local Origin runtime initialized.'],
      },
    },
    integrations: {
      email: createIntegration('email', 'connected', 'Mailbox connected and polling recent threads.'),
      github: createIntegration('github', 'connected', 'GitHub account and working-set repositories are connected.'),
      telegram: createIntegration('telegram', 'connected', 'Telegram bot is configured for group observation.'),
      'google-calendar': createIntegration('google-calendar', 'connected', 'Google Calendar bridge is attached to one calendar.'),
      'google-tasks': createIntegration('google-tasks', 'connected', 'Google Tasks bridge is attached to one task list.'),
      notification: createIntegration('notification', 'connected', 'Notification delivery channels are ready.'),
    },
    chat: {
      sessions: [
        {
          id: 'chat_0001',
          title: 'Daily operator session',
          status: 'active',
          archived: false,
          seedContext: ['tsk_0001', 'mail_thr_0001'],
          messages: [
            {
              id: 'chat_msg_0001',
              role: 'user',
              body: 'What should I focus on today?',
              at: createdAt,
            },
            {
              id: 'chat_msg_0002',
              role: 'assistant',
              body: 'Finish the Origin CLI runtime, triage the mailbox, and review the pending pull request.',
              at: createdAt,
            },
          ],
        },
      ],
      outbox: [
        {
          id: 'chat_out_0001',
          kind: 'chat-message',
          status: 'queued',
          summary: 'Queued offline follow-up for chat_0001.',
          provider: 'chat',
        },
      ],
    },
    memory: {
      revisions: [],
      artifacts: [
        {
          path: 'Origin/Memory.md',
          kind: 'note',
          summary: 'Curated durable memory index.',
          replicatedState: true,
        },
        {
          path: 'Projects/origin-cli-brief.md',
          kind: 'note',
          summary: 'Implementation notes for the Origin CLI.',
          replicatedState: true,
        },
        {
          path: 'Data/contacts.json',
          kind: 'json',
          summary: 'Local supporting contact dataset.',
          replicatedState: false,
        },
      ],
    },
    workspace: {
      revisions: [],
      conflicts: [],
      bridgeJobs: [
        { id: 'bridge_0001', status: 'completed', summary: 'Initial workspace scan completed.' },
      ],
      indexStatus: 'Fresh',
      bridgeStatus: 'In sync',
    },
    notes: {
      notes: [],
      conflicts: [],
    },
    planning: {
      projects: [],
      labels: [],
      tasks: [],
      calendarItems: [],
    },
    email: {
      accounts: [
        {
          id: 'mail_acc_0001',
          address: 'agent@example.com',
          status: 'connected',
          summary: 'Primary agent mailbox.',
          lastSyncAt: createdAt,
          syncState: 'idle',
          labels: ['INBOX', 'ACTION', 'FOLLOW_UP'],
          aliases: ['assistant@example.com'],
        },
      ],
      threads: [],
      messages: [],
      drafts: [],
      outbox: [
        {
          id: 'mail_out_0001',
          kind: 'email-send',
          status: 'queued',
          summary: 'Queued follow-up email to vendor.',
          provider: 'email',
        },
      ],
    },
    github: {
      repositories: [],
      follows: [],
      issues: [],
      pullRequests: [],
      comments: [],
      reviews: [],
      outbox: [
        {
          id: 'gh_out_0001',
          kind: 'github-comment',
          status: 'queued',
          summary: 'Queued PR reply on origin/cli#8.',
          provider: 'github',
        },
      ],
    },
    telegram: {
      connection: {
        status: 'valid',
        botUsername: '@origin_bot',
        privacyMode: 'disabled',
        summary: 'Bot is configured for group observation.',
        defaultMode: 'observe',
        defaultSummaryEnabled: true,
        defaultSummaryWindow: '24h',
      },
      chats: [],
      groups: [],
      messages: [],
      summaries: [],
      outbox: [
        {
          id: 'tg_out_0001',
          kind: 'telegram-message',
          status: 'queued',
          summary: 'Queued Telegram summary delivery.',
          provider: 'telegram',
        },
      ],
    },
    automations: {
      automations: [],
      runs: [],
      queue: [
        {
          name: 'automation',
          pending: 1,
          summary: 'One automation is scheduled for the next planning sweep.',
        },
      ],
    },
    notifications: {
      items: [],
      preferences: {
        push: true,
        emailDigest: 'daily',
      },
      devices: [
        {
          id: 'dev_0001',
          kind: 'macos',
          status: 'enabled',
          summary: 'Primary macOS device.',
        },
      ],
      deliveries: [],
    },
    sync: {
      replicaPeers: [
        { id: 'peer_0001', kind: 'server', status: 'online', summary: 'Local server peer.' },
        { id: 'peer_0002', kind: 'iphone', status: 'idle', summary: 'iPhone peer last seen recently.' },
      ],
      replicaJobs: [
        {
          id: 'sync_job_0001',
          kind: 'replica-sync',
          status: 'completed',
          summary: 'Replica state synchronized.',
          endedAt: createdAt,
        },
      ],
      providerJobs: [
        {
          id: 'sync_job_0002',
          kind: 'provider-refresh',
          status: 'completed',
          summary: 'Provider caches refreshed.',
          endedAt: createdAt,
        },
      ],
      replicaConflicts: [],
      providerOutbox: [
        {
          id: 'sync_out_0001',
          kind: 'sync-export',
          status: 'pending',
          summary: 'Workspace export scheduled.',
        },
      ],
    },
    activities: [],
    entityLinks: [],
  }

  seedPlanning(state)
  seedNotes(state, paths)
  seedEmail(state)
  seedGithub(state)
  seedTelegram(state)
  seedAutomations(state)
  seedNotifications(state)

  addActivity(state, {
    kind: 'system.bootstrap',
    status: 'completed',
    actor: 'origin/system',
    summary: 'Initialized Origin CLI demo state.',
    severity: 'info',
  })

  return state
}

function createIntegration(key: string, status: string, summary: string): IntegrationRecord {
  return {
    status: {
      key,
      status,
      summary,
    },
    config: {},
    configuredScopes: ['read', 'write'],
    grantedScopes: ['read', 'write'],
    missingScopes: [],
    provider: {
      provider: key,
      status,
      summary,
      surfaces: [
        {
          id: `${key}_surface_0001`,
          provider: key,
          scope: `${key}-default`,
          status,
          summary,
          displayName: `${key} default`,
          selected: true,
          cachedItems: 4,
          pollers: [
            {
              id: `${key}_poller_0001`,
              provider: key,
              scope: `${key}-default`,
              status: 'active',
              mode: 'poll',
              cursor: `${key}-cursor-1`,
              lastSucceededAt: now(),
              intervalSeconds: 300,
              itemsSeen: 12,
              itemsChanged: 3,
            },
          ],
        },
      ],
      pollers: [
        {
          id: `${key}_poller_0001`,
          provider: key,
          scope: `${key}-default`,
          status: 'active',
          mode: 'poll',
          cursor: `${key}-cursor-1`,
          lastSucceededAt: now(),
          intervalSeconds: 300,
          itemsSeen: 12,
          itemsChanged: 3,
        },
      ],
      lastRefreshedAt: now(),
    },
    rateLimits: [
      {
        integration: key,
        bucket: 'default',
        remaining: 4999,
        resetAt: now(),
      },
    ],
    jobs: [
      {
        id: `${key}_job_0001`,
        integration: key,
        kind: 'validate',
        status: 'completed',
        summary: `${key} validated successfully.`,
        endedAt: now(),
      },
    ],
  }
}

function seedPlanning(state: OriginState) {
  const projectId = 'prj_0001'
  const labelId = 'lbl_0001'
  const taskId = 'tsk_0001'
  const taskId2 = 'tsk_0002'
  const calendarId = 'cal_0001'

  state.planning.projects.push({
    id: projectId,
    name: 'Origin CLI',
    status: 'active',
    description: 'Ship the full incur-based Origin CLI runtime.',
    history: [],
    revisions: [],
  })

  state.planning.labels.push({
    id: labelId,
    name: 'today',
    color: '#d97706',
    history: [],
    revisions: [],
  })

  state.planning.tasks.push(
    {
      id: taskId,
      title: 'Implement full Origin CLI runtime',
      status: 'in_progress',
      priority: 'high',
      projectId,
      labelIds: [labelId],
      descriptionMd: 'Replace the bootstrap with the full incur command surface.',
      calendarItemIds: [calendarId],
      blockedBy: [],
      externalLinks: [],
      history: [],
      revisions: [],
    },
    {
      id: taskId2,
      title: 'Triage mailbox follow-ups',
      status: 'todo',
      priority: 'medium',
      projectId,
      labelIds: [],
      descriptionMd: 'Review pending email threads and convert actionable items into planning state.',
      calendarItemIds: [],
      blockedBy: [taskId],
      dueKind: 'date',
      dueAt: now().slice(0, 10),
      externalLinks: [],
      history: [],
      revisions: [],
    },
  )

  state.planning.calendarItems.push({
    id: calendarId,
    title: 'Origin CLI implementation block',
    status: 'confirmed',
    kind: 'time_block',
    projectId,
    labelIds: [labelId],
    descriptionMd: 'Deep implementation work for the full CLI surface.',
    startAt: now(),
    endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    timezone: 'Europe/Paris',
    allDay: false,
    taskIds: [taskId],
    externalLinks: [],
    history: [],
    revisions: [],
  })

  for (const project of state.planning.projects) {
    const revisionId = nextId(state, 'rev')
    project.revisions = recordRevision(project.revisions, {
      id: revisionId,
      actor: 'origin/system',
      at: now(),
      summary: 'Created project.',
      snapshot: { name: project.name, status: project.status },
    })
    project.history.push(createHistoryEntry(state, 'origin/system', 'Created project.', revisionId))
  }

  for (const label of state.planning.labels) {
    const revisionId = nextId(state, 'rev')
    label.revisions = recordRevision(label.revisions, {
      id: revisionId,
      actor: 'origin/system',
      at: now(),
      summary: 'Created label.',
      snapshot: { name: label.name, color: label.color ?? null },
    })
    label.history.push(createHistoryEntry(state, 'origin/system', 'Created label.', revisionId))
  }

  for (const task of state.planning.tasks) {
    const revisionId = nextId(state, 'rev')
    task.revisions = recordRevision(task.revisions, {
      id: revisionId,
      actor: 'origin/system',
      at: now(),
      summary: 'Created task.',
      snapshot: { title: task.title, status: task.status },
    })
    task.history.push(createHistoryEntry(state, 'origin/system', 'Created task.', revisionId))
  }

  for (const item of state.planning.calendarItems) {
    const revisionId = nextId(state, 'rev')
    item.revisions = recordRevision(item.revisions, {
      id: revisionId,
      actor: 'origin/system',
      at: now(),
      summary: 'Created calendar item.',
      snapshot: { title: item.title, status: item.status },
    })
    item.history.push(createHistoryEntry(state, 'origin/system', 'Created calendar item.', revisionId))
  }

  state.entityLinks.push(
    { from: taskId, to: projectId, kind: 'belongs-to' },
    { from: taskId, to: calendarId, kind: 'scheduled-by' },
    { from: taskId2, to: taskId, kind: 'blocked-by' },
  )
}

function seedNotes(state: OriginState, paths: RuntimePaths) {
  const memoryContent = [
    '# Origin Memory',
    '',
    '## Stable preferences',
    '- Prefer concise, factual updates.',
    '- Keep durable memory high signal and lightweight.',
    '',
    '## Active focus',
    '- Ship the incur-based Origin CLI runtime.',
    '',
    '## Linked artifacts',
    `- [Origin CLI brief](${join(paths.workspaceRoot, 'Projects/origin-cli-brief.md')})`,
  ].join('\n')

  const memoryRevisionId = nextId(state, 'rev')
  state.memory.revisions = recordRevision(state.memory.revisions, {
    id: memoryRevisionId,
    actor: 'origin/system',
    at: now(),
    summary: 'Seeded memory file.',
    diff: createRevisionDiff(undefined, memoryContent),
    content: memoryContent,
  })

  const notes = [
    {
      id: 'note_0001',
      title: 'Origin CLI brief',
      path: 'Projects/origin-cli-brief.md',
      content: '# Origin CLI brief\n\n- Implement every command from the incur contract.\n- Keep docs and runtime aligned.',
      updatedAt: now(),
      attachments: [],
      revisions: [] as OriginState['notes']['notes'][number]['revisions'],
      history: [] as OriginState['notes']['notes'][number]['history'],
    },
    {
      id: 'note_0002',
      title: 'Inbox capture',
      path: 'Inbox/capture.md',
      content: '# Inbox capture\n\n- Review vendor follow-up\n- Summarize Telegram group activity',
      updatedAt: now(),
      attachments: [],
      revisions: [] as OriginState['notes']['notes'][number]['revisions'],
      history: [] as OriginState['notes']['notes'][number]['history'],
    },
  ]

  for (const note of notes) {
    const revisionId = nextId(state, 'rev')
    note.revisions = recordRevision(note.revisions, {
      id: revisionId,
      actor: 'origin/system',
      at: note.updatedAt,
      summary: 'Seeded note.',
      diff: createRevisionDiff(undefined, note.content),
      content: note.content,
    })
    note.history.push(createHistoryEntry(state, 'origin/system', 'Seeded note.', revisionId))
    state.notes.notes.push(note)
    state.workspace.revisions.push({
      id: nextId(state, 'wrev'),
      path: note.path,
      actor: 'origin/system',
      at: note.updatedAt,
      summary: 'Seeded managed note in workspace.',
      diff: createRevisionDiff(undefined, note.content),
      content: note.content,
    })
  }

  state.entityLinks.push(
    { from: 'note_0001', to: 'prj_0001', kind: 'references' },
    { from: 'note_0002', to: 'tsk_0002', kind: 'captures' },
  )
}

function seedEmail(state: OriginState) {
  const threadId = 'mail_thr_0001'
  const messageId = 'mail_msg_0001'
  const messageId2 = 'mail_msg_0002'

  state.email.messages.push(
    {
      id: messageId,
      threadId,
      from: 'ops@example.com',
      to: ['agent@example.com'],
      subject: 'Need confirmation on deployment timing',
      body: 'Can you confirm whether the Origin CLI rollout can happen today?',
      snippet: 'Need confirmation on deployment timing',
      headers: { 'message-id': '<m1@example.com>' },
      raw: 'RAW MESSAGE 1',
      at: now(),
      attachments: [],
    },
    {
      id: messageId2,
      threadId,
      from: 'agent@example.com',
      to: ['ops@example.com'],
      subject: 'Re: Need confirmation on deployment timing',
      body: 'Working on it now. I will send a confirmation once the smoke tests pass.',
      snippet: 'Working on it now.',
      headers: { 'message-id': '<m2@example.com>' },
      raw: 'RAW MESSAGE 2',
      at: now(),
      attachments: [],
    },
  )

  state.email.threads.push({
    id: threadId,
    accountId: 'mail_acc_0001',
    subject: 'Need confirmation on deployment timing',
    status: 'inbox',
    messageIds: [messageId, messageId2],
    labelIds: ['INBOX', 'ACTION'],
    triage: {
      threadId,
      state: 'needs_reply',
      linkedTaskId: 'tsk_0002',
      note: 'Convert the rollout confirmation into a concise update once tests pass.',
    },
    lastMessageAt: now(),
    freshness: 'fresh',
    unread: true,
    linkedTaskIds: ['tsk_0002'],
  })

  state.email.drafts.push({
    id: 'draft_0001',
    subject: 'Origin CLI rollout update',
    to: ['ops@example.com'],
    body: 'I will confirm the rollout after the full CLI smoke test passes.',
    threadId,
  })

  state.entityLinks.push({ from: threadId, to: 'tsk_0002', kind: 'tracked-by' })
}

function seedGithub(state: OriginState) {
  const repoId = 'repo_0001'
  const issueId = 'gh_issue_0001'
  const prId = 'gh_pr_0001'
  const commentId = 'gh_comment_0001'
  const reviewId = 'gh_review_0001'
  const followId = 'gh_follow_0001'

  state.github.repositories.push({
    id: repoId,
    name: 'origin/origin',
    tracked: true,
    summary: 'Primary Origin repository.',
    pinned: true,
    followed: true,
  })

  state.github.comments.push({
    id: commentId,
    author: 'reviewer',
    body: 'Please verify the nested command schemas once the runtime lands.',
    at: now(),
  })

  state.github.issues.push({
    id: issueId,
    ref: 'origin/origin#12',
    title: 'Tighten CLI contract coverage',
    state: 'open',
    summary: 'Ensure every documented command has a runtime implementation.',
    labels: ['cli', 'coverage'],
    assignees: ['origin-agent'],
    commentIds: [commentId],
  })

  state.github.pullRequests.push({
    id: prId,
    ref: 'origin/origin#18',
    title: 'Implement the Origin CLI',
    state: 'open',
    summary: 'Adds the incur-based CLI surface and runtime store.',
    reviewers: ['reviewer'],
    checks: ['typecheck pending', 'smoke-tests pending'],
    commentIds: [commentId],
    reviewIds: [reviewId],
    files: ['apps/server/src/index.ts', 'docs/api/origin_incur_cli.ts'],
    diff: '+ implement runtime\n+ add dispatcher\n+ add docs sync',
    draft: true,
  })

  state.github.reviews.push({
    id: reviewId,
    prRef: 'origin/origin#18',
    author: 'reviewer',
    state: 'commented',
    body: 'Please make sure `origin planning day --schema` still works.',
    at: now(),
  })

  state.github.follows.push({
    id: followId,
    kind: 'pr',
    repo: 'origin/origin',
    targetRef: 'origin/origin#18',
    reason: 'Track the CLI implementation rollout.',
    linkedTaskIds: ['tsk_0001'],
    linkedNoteIds: ['note_0001'],
  })

  state.entityLinks.push(
    { from: issueId, to: 'tsk_0001', kind: 'tracked-by' },
    { from: prId, to: 'tsk_0001', kind: 'implements' },
    { from: followId, to: prId, kind: 'targets' },
  )
}

function seedTelegram(state: OriginState) {
  const chatId = 'tg_chat_0001'
  const summaryId = 'tg_sum_0001'

  state.telegram.chats.push({
    id: chatId,
    title: 'Origin Ops',
    kind: 'group',
    summary: 'Primary operator chat for Origin.',
    isRegistered: true,
    messageCacheState: 'warm',
  })

  state.telegram.groups.push({
    chatId,
    enabled: true,
    participationMode: 'observe',
    summaryPolicy: {
      enabled: true,
      window: '24h',
    },
    mentionTrackingEnabled: true,
    messageCacheEnabled: true,
    summary: 'Daily summary with mention tracking enabled.',
  })

  state.telegram.messages.push(
    {
      id: 'tg_msg_0001',
      chatId,
      author: 'Alice',
      body: 'Can the bot summarize today’s implementation progress later?',
      at: now(),
    },
    {
      id: 'tg_msg_0002',
      chatId,
      author: 'Origin Bot',
      body: 'Yes. A summary job is already scheduled for tonight.',
      at: now(),
    },
  )

  state.telegram.summaries.push({
    id: summaryId,
    chatId,
    triggerKind: 'scheduled',
    status: 'queued',
    summary: 'Evening summary for Origin Ops.',
    queuedAt: now(),
    at: now(),
  })

  state.entityLinks.push({ from: chatId, to: 'auto_0001', kind: 'summarized-by' })
}

function seedAutomations(state: OriginState) {
  const automationId = 'auto_0001'
  const runId = 'run_0001'

  state.automations.automations.push({
    id: automationId,
    title: 'Daily Telegram summary',
    status: 'enabled',
    kind: 'scheduled',
    summary: 'Posts a daily summary into the Origin Ops Telegram group.',
    trigger: {
      type: 'schedule',
      cron: '0 18 * * *',
      timezone: 'Europe/Paris',
    },
    actions: [
      {
        type: 'command',
        command: 'telegram summary run',
        args: ['tg_chat_0001'],
        options: { window: '24h' },
        summary: 'Generate the daily Telegram summary.',
      },
      {
        type: 'command',
        command: 'telegram summary post',
        args: ['tg_sum_0001'],
        summary: 'Post the generated summary.',
      },
    ],
    runPolicy: {
      allowOverlap: false,
      catchUp: 'skip',
      continueOnError: false,
    },
    retryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
    },
  })

  state.automations.runs.push({
    id: runId,
    automationId,
    status: 'completed',
    summary: 'Daily summary posted successfully.',
    triggeredAt: now(),
    scheduledAt: now(),
    triggerReason: 'schedule',
    startedAt: now(),
    endedAt: now(),
    traceId: 'trace_0001',
    steps: [
      { id: 'step_0001', kind: 'command', status: 'completed', summary: 'Generated summary.' },
      { id: 'step_0002', kind: 'command', status: 'completed', summary: 'Posted summary.' },
    ],
    eventIds: [],
  })
}

function seedNotifications(state: OriginState) {
  state.notifications.items.push({
    id: 'notif_0001',
    kind: 'task',
    title: 'Origin CLI block is in progress',
    status: 'unread',
    at: now(),
    read: false,
  })

  state.notifications.deliveries.push({
    id: 'deliv_0001',
    notificationId: 'notif_0001',
    channel: 'push',
    status: 'delivered',
    summary: 'Delivered to the primary macOS device.',
  })
}
