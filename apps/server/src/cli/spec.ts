/**
 * Origin Incur CLI Spec
 *
 * Shared CLI contract used by both the runtime and the docs surface.
 *
 * The runtime imports this module directly so command shape, metadata, env,
 * config, and schemas live in app-owned code instead of depending on `docs/`.
 *
 * The important design choice is that Origin should lean on incur's built-in
 * discovery surface:
 *
 * - `origin --help`
 * - `origin --llms`
 * - `origin --llms-full`
 * - `origin <command> --schema`
 * - `origin skills add`
 * - `origin mcp add`
 *
 * So this file focuses only on Origin-specific domains and lets incur own
 * the generic discovery, schema, and agent-sync mechanisms.
 */

import { Cli, z } from 'incur'

const specOnly = <
  const context extends {
    error: (options: { code: string; message: string }) => never
  },
>(
  context: context,
) =>
  context.error({
    code: 'SPEC_ONLY',
    message:
      'Documentation-only CLI contract. Use --help, --llms, and --schema for discovery; runtime behavior is not implemented here.',
  })

const id = (description: string) => z.string().describe(description)
const isoDate = z.string().describe('ISO 8601 date string.')
const isoDateTime = z.string().describe('ISO 8601 datetime string.')
const duration = z.string().describe('Human-friendly duration string such as `15m` or `24h`.')
const path = z.string().describe('Filesystem path.')
const markdown = z.string().describe('Markdown content.')
const secureRef = z
  .string()
  .describe(
    'Opaque secure-handoff ref created by an operator-only channel. Pass refs here instead of raw secret material in the agent CLI.',
  )

const list = <const item extends z.ZodTypeAny>(item: item, itemDescription: string) =>
  z.object({
    items: z.array(item).describe(itemDescription),
    ['next-cursor']: z.string().optional().describe('Opaque cursor for the next page.'),
    total: z.number().optional().describe('Known total when cheap to compute.'),
    summary: z.string().optional().describe('Compact summary of the result set.'),
  })

const actionResult = z.object({
  summary: z.string().describe('Human-readable summary of the action result.'),
  ['affected-ids']: z.array(z.string()).optional().describe('Affected Origin entity ids.'),
  ['provider-refs']: z
    .array(z.string())
    .optional()
    .describe('Provider-side ids or refs touched by the command.'),
  ['trace-id']: z.string().optional().describe('Correlated trace id for deeper inspection.'),
  ['activity-ids']: z
    .array(z.string())
    .optional()
    .describe('Activity event ids emitted by the action.'),
  ['job-id']: z.string().optional().describe('Job id when the action schedules or touches a job.'),
  ['run-id']: z.string().optional().describe('Run id when the action schedules or touches a run.'),
  ['conflict-id']: z
    .string()
    .optional()
    .describe('Conflict id when the action creates or resolves a conflict.'),
})

const contentResolutionOptions = (description: string) =>
  z.object({
    resolution: z.enum(['select', 'merge', 'replace']).describe('Conflict resolution strategy.'),
    ['candidate-id']: z
      .string()
      .optional()
      .describe('Candidate id to select directly or use as the primary merge base.'),
    content: z.string().optional().describe(description),
  })

const payloadResolutionOptions = (description: string) =>
  z.object({
    resolution: z.enum(['select', 'merge', 'replace']).describe('Conflict resolution strategy.'),
    ['candidate-id']: z
      .string()
      .optional()
      .describe('Candidate id to select directly or use as the primary merge base.'),
    payload: z.record(z.string(), z.unknown()).optional().describe(description),
  })

const validationCheck = z.object({
  id: id('Stable check id.'),
  kind: z.string().describe('Check kind.'),
  target: z.string().describe('Subsystem, provider, or object being checked.'),
  status: z.enum(['pass', 'warn', 'fail']).describe('Check result status.'),
  message: z.string().describe('Human-readable check summary.'),
  remediation: z.array(z.string()).optional().describe('Suggested remediation steps.'),
})

const validationResult = z.object({
  summary: z.string().describe('Overall validation summary.'),
  status: z.enum(['pass', 'warn', 'fail']).describe('Aggregate validation result.'),
  checks: z.array(validationCheck).describe('Individual validation checks.'),
})

const activityEvent = z.object({
  id: id('Activity event id.'),
  kind: z.string().describe('Event kind.'),
  status: z.string().describe('Event status.'),
  actor: z.string().describe('Actor id that produced the event.'),
  target: z.string().optional().describe('Primary target ref if one exists.'),
  at: isoDateTime.describe('Creation time.'),
  summary: z.string().describe('Compact human-readable event summary.'),
  severity: z.enum(['info', 'warn', 'error']).optional().describe('Event severity when classified.'),
  provider: z.string().optional().describe('Provider key when the event came from provider ingress.'),
  ['poller-id']: z.string().optional().describe('Provider poller id when the event came from provider ingress.'),
  ['source-refs']: z.array(z.string()).optional().describe('Provider-side refs or other source refs associated with the event.'),
  ['entity-refs']: z.array(z.string()).optional().describe('Related Origin entity refs when known.'),
  ['details-md']: markdown.optional().describe('Optional extended event details.'),
  ['trace-id']: z.string().optional().describe('Trace id that correlates related events.'),
})

const activitySummary = z.object({
  summary: z.string().describe('Natural-language summary of the selected activity window.'),
  counts: z.record(z.string(), z.number()).describe('Counts by kind or status.'),
})

const searchHit = z.object({
  kind: z.string().describe('Resolved domain kind.'),
  id: id('Origin id or external ref.'),
  title: z.string().describe('Primary label for the result.'),
  score: z.number().optional().describe('Relevance score when available.'),
  excerpt: z.string().optional().describe('Compact excerpt or explanation of the match.'),
  path: z.string().optional().describe('Workspace path when relevant.'),
})

const entityRef = z.object({
  kind: z.string().describe('Domain kind.'),
  id: id('Stable Origin id.'),
  title: z.string().describe('Display title.'),
})

const contextPack = z.object({
  summary: z.string().describe('Short synthesis of why this context matters.'),
  entities: z.array(entityRef).describe('Primary entities in the pack.'),
  notes: z.array(z.string()).optional().describe('Context notes worth reading next.'),
  highlights: z.array(z.string()).optional().describe('High-signal observations.'),
})

const blocker = z.object({
  id: id('Blocker id.'),
  kind: z.string().describe('Blocker kind.'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Blocker severity.'),
  summary: z.string().describe('Blocker summary.'),
  remediation: z.array(z.string()).optional().describe('Suggested next steps.'),
})

const userIdentity = z.object({
  ['display-name']: z.string().optional().describe('Owner display name.'),
  emails: z.array(z.string()).describe('Known owner email addresses.'),
  ['github-username']: z.string().optional().describe('Owner GitHub username.'),
  ['telegram-handle']: z.string().optional().describe('Owner Telegram handle.'),
})

const agentIdentity = z.object({
  ['display-name']: z.string().optional().describe('Friendly label for the agent identity.'),
  google: z.string().optional().describe('Connected Google account email.'),
  github: z.string().optional().describe('Connected GitHub username.'),
  telegram: z.string().optional().describe('Connected Telegram bot username.'),
})

const identityStatus = z.object({
  summary: z.string().describe('Completeness and consistency summary.'),
  status: z.enum(['complete', 'partial', 'invalid']).describe('Identity completeness status.'),
  ['missing-facts']: z.array(z.string()).optional().describe('Missing owner or agent facts.'),
})

const identityHandle = z.object({
  id: id('Identity handle record id.'),
  service: z.string().describe('Service name, such as email, github, or telegram.'),
  handle: z.string().describe('User-facing handle or address.'),
  role: z.enum(['user', 'agent']).describe('Whether the handle belongs to the owner or the agent.'),
})

const identitySource = z.object({
  kind: z.string().describe('Source kind such as onboarding, provider-profile, or manual.'),
  service: z.string().optional().describe('Service name when the source is provider-backed.'),
  value: z.string().describe('Value contributed by the source.'),
})

const integrationStatus = z.object({
  key: z.string().describe('Integration key.'),
  status: z.string().describe('Connection status.'),
  summary: z.string().describe('Human-readable integration summary.'),
  ['last-validated-at']: isoDateTime.optional().describe('Last validation timestamp.'),
  ['last-refreshed-at']: isoDateTime.optional().describe('Last refresh timestamp.'),
})

const providerPollerStatus = z.object({
  id: id('Provider poller id.'),
  provider: z.string().describe('Provider key.'),
  scope: z.string().describe('Provider scope covered by this poller.'),
  status: z
    .enum(['active', 'paused', 'degraded', 'auth_failed', 'rate_limited'])
    .describe('Current poller status.'),
  mode: z.enum(['poll']).describe('Ingress mode.'),
  cursor: z.string().optional().describe('Opaque provider cursor or last-successful-sync marker when known.'),
  ['last-started-at']: isoDateTime.optional().describe('Most recent poll start time.'),
  ['last-succeeded-at']: isoDateTime.optional().describe('Most recent successful poll completion time.'),
  ['last-failed-at']: isoDateTime.optional().describe('Most recent failed poll completion time.'),
  ['last-error']: z.string().optional().describe('Most recent poller error summary when known.'),
  ['interval-seconds']: z.number().optional().describe('Nominal polling interval in seconds.'),
  ['backoff-until']: isoDateTime.optional().describe('Backoff horizon when the poller is temporarily delayed.'),
  ['items-seen']: z.number().optional().describe('Total items seen during the most recent relevant window.'),
  ['items-changed']: z.number().optional().describe('Total changed items emitted during the most recent relevant window.'),
})

const providerSurfaceStatus = z.object({
  id: id('Provider surface id.'),
  provider: z.string().describe('Provider key.'),
  scope: z.string().describe('Surface scope handled by this selection, such as a mailbox, tracked working set, chat set, calendar, or task list.'),
  status: z.string().describe('Surface status.'),
  summary: z.string().describe('Surface summary.'),
  ['provider-ref']: z.string().optional().describe('Provider-side container ref for the surface when known.'),
  ['display-name']: z.string().optional().describe('Display label for the surface when known.'),
  selected: z.boolean().optional().describe('Whether this surface is currently selected for active ingress or sync.'),
  ['cached-items']: z.number().optional().describe('Approximate cached item count for this surface.'),
  pollers: z.array(providerPollerStatus).optional().describe('Pollers that serve this surface.'),
})

const providerIngressStatus = z.object({
  provider: z.string().describe('Provider key.'),
  status: z.string().describe('Overall ingress or cache status.'),
  summary: z.string().describe('Overall ingress or cache summary.'),
  surfaces: z.array(providerSurfaceStatus).optional().describe('Selected or known provider surfaces.'),
  pollers: z.array(providerPollerStatus).describe('Known pollers across the provider or selected surfaces.'),
  ['last-refreshed-at']: isoDateTime.optional().describe('Most recent provider refresh completion time when known.'),
})

const integrationConfig = z.object({
  key: z.string().describe('Integration key.'),
  values: z.record(z.string(), z.unknown()).describe('Operator-configurable integration settings.'),
})

const oauthStart = z.object({
  url: z.string().describe('Provider authorization URL.'),
  state: z.string().describe('Opaque state token.'),
  scopes: z.array(z.string()).describe('Requested scopes.'),
})

const integrationScopeStatus = z.object({
  key: z.string().describe('Integration key.'),
  configured: z.array(z.string()).describe('Expected scopes or permissions.'),
  granted: z.array(z.string()).describe('Granted scopes or permissions.'),
  missing: z.array(z.string()).describe('Missing scopes or permissions.'),
})

const integrationJob = z.object({
  id: id('Integration job id.'),
  integration: z.string().describe('Integration key.'),
  kind: z.string().describe('Job kind.'),
  status: z.string().describe('Job status.'),
  summary: z.string().describe('Job summary.'),
  ['started-at']: isoDateTime.optional().describe('Job start time.'),
  ['ended-at']: isoDateTime.optional().describe('Job end time.'),
  ['trace-id']: z.string().optional().describe('Correlated trace id.'),
})

const rateLimitStatus = z.object({
  integration: z.string().describe('Integration key.'),
  bucket: z.string().describe('Rate-limit bucket or resource.'),
  remaining: z.number().describe('Remaining capacity.'),
  resetAt: isoDateTime.optional().describe('Reset time when known.'),
})

const setupPhase = z.object({
  key: z.string().describe('Phase key.'),
  title: z.string().describe('Phase title.'),
  status: z.string().describe('Phase completion status.'),
  summary: z.string().describe('Phase summary.'),
  ['next-actions']: z.array(z.string()).optional().describe('Next steps for the phase.'),
})

const setupStatus = z.object({
  mode: z.enum(['unselected', 'local', 'vps']).describe('Selected deployment mode, or `unselected` before setup mode is chosen.'),
  status: z.enum(['not-started', 'in-progress', 'ready']).describe('Overall setup state.'),
  summary: z.string().describe('Top-level setup summary.'),
  phases: z.array(setupPhase).describe('Current phase states.'),
})

const setupInput = z.object({
  key: z.string().describe('Setup input key.'),
  value: z.unknown().optional().describe('Current value when present.'),
  source: z.string().optional().describe('How the value was provided.'),
})

const deploymentPlan = z.object({
  mode: z.enum(['local', 'vps']).describe('Deployment mode.'),
  steps: z.array(z.string()).describe('Planned deployment steps.'),
})

const deploymentStatus = z.object({
  summary: z.string().describe('Deployment summary.'),
  status: z.string().describe('Deployment status.'),
  ['last-run-at']: isoDateTime.optional().describe('Last deployment run time.'),
})

const deploymentLog = z.object({
  lines: z.array(z.string()).describe('Recent deployment log lines.'),
})

const statusSummary = z.object({
  mode: z.enum(['local', 'vps']).describe('Current instance mode.'),
  summary: z.string().describe('High-level status summary.'),
  setup: z.string().describe('Setup completeness summary.'),
  integrations: z.array(integrationStatus).describe('Connected integration summaries.'),
  blockers: z.array(blocker).optional().describe('Outstanding blockers.'),
})

const runtimeStatus = z.object({
  uptime: duration.describe('Process uptime.'),
  pid: z.number().optional().describe('Primary process id when applicable.'),
  version: z.string().optional().describe('Origin version.'),
  mode: z.enum(['local', 'vps']).describe('Current instance mode.'),
})

const serviceStatus = z.object({
  name: z.string().describe('Service name.'),
  status: z.string().describe('Service status.'),
  summary: z.string().describe('Service summary.'),
})

const storageStatus = z.object({
  sqlite: z.string().describe('SQLite health summary.'),
  replica: z.string().describe('Replicated state health summary.'),
  workspace: z.string().describe('Workspace and vault health summary.'),
  cache: z.string().optional().describe('Cache health summary.'),
})

const queueStatus = z.object({
  name: z.string().describe('Queue name.'),
  pending: z.number().describe('Pending item count.'),
  failed: z.number().optional().describe('Failed item count.'),
  summary: z.string().describe('Queue summary.'),
})

const pathSummary = z.object({
  state: path.describe('Origin state directory.'),
  workspace: path.describe('Managed workspace root that contains the synced note vault plus local workspace artifacts.'),
  vault: path.describe('Synced note vault path. In v1 this is the same path as the managed workspace root.'),
  sqlite: path.describe('SQLite file path.'),
  blobs: path.optional().describe('Blob/cache root when present.'),
})

const chatMessage = z.object({
  id: id('Chat message id.'),
  role: z.enum(['user', 'assistant', 'system']).describe('Message role.'),
  body: markdown,
  at: isoDateTime.describe('Creation time.'),
})

const chatSession = z.object({
  id: id('Chat session id.'),
  title: z.string().optional().describe('Chat title.'),
  status: z.string().describe('Session status.'),
  messages: z.array(chatMessage).optional().describe('Session messages.'),
})

const chatOutboxItem = z.object({
  id: id('Outbox item id.'),
  ['session-id']: id('Chat session id.'),
  status: z.string().describe('Outbox status.'),
  body: markdown.describe('Queued message body.'),
})

const memoryFile = z.object({
  path: path.describe('Path to `Origin/Memory.md` inside the synced vault.'),
  content: markdown.describe('Current memory markdown content.'),
  ['linked-artifacts']: z.array(path).optional().describe('Linked supporting artifacts.'),
})

const memoryArtifact = z.object({
  path: path.describe('Managed workspace path for the artifact. Non-note artifacts remain local workspace artifacts by default unless explicitly imported into replicated state.'),
  kind: z.string().describe('Artifact kind.'),
  summary: z.string().describe('Artifact purpose summary.'),
  ['replicated-state']: z
    .boolean()
    .optional()
    .describe('Whether the artifact has been explicitly imported into replicated state. Non-note artifacts default to local workspace-only storage.'),
})

const workspaceEntry = z.object({
  path: path.describe('Path relative to the managed workspace root.'),
  kind: z.enum(['file', 'folder']).describe('Workspace entry kind.'),
  ['last-modified-at']: isoDateTime.optional().describe('Last modification time.'),
})

const workspaceStatus = z.object({
  root: path.describe('Managed workspace root.'),
  vault: path.optional().describe('Synced note vault path. In v1 this is the same path as the managed workspace root.'),
  summary: z.string().describe('Workspace health summary across the managed root, synced vault, and local workspace artifacts.'),
  ['index-status']: z.string().describe('Indexing summary.'),
  ['bridge-status']: z.string().describe('Filesystem bridge summary.'),
})

const revisionDiff = z.object({
  summary: z.string().describe('Compact summary of what changed.'),
  ['changed-fields']: z.array(z.string()).optional().describe('Changed fields or sections.'),
  patch: z.string().optional().describe('Unified diff or patch summary when applicable.'),
})

const workspaceRevision = z.object({
  id: id('Workspace revision id.'),
  path: path.describe('Workspace-relative path for replicated managed content such as notes or explicitly imported managed attachments.'),
  actor: z.string().describe('Actor id that produced the revision.'),
  at: isoDateTime.describe('Revision time.'),
  summary: z.string().describe('Revision summary.'),
  diff: revisionDiff.optional().describe('Compact diff summary when available.'),
})

const workspaceConflict = z.object({
  id: id('Workspace conflict id.'),
  path: path.describe('Workspace-relative path.'),
  summary: z.string().describe('Conflict summary.'),
  actors: z.array(z.string()).describe('Actors involved in the conflict.'),
})

const noteSummary = z.object({
  id: id('Note id.'),
  title: z.string().describe('Note title.'),
  path: path.describe('Workspace-relative note path.'),
  ['updated-at']: isoDateTime.describe('Last update time.'),
})

const note = z.object({
  id: id('Note id.'),
  title: z.string().describe('Note title.'),
  path: path.describe('Workspace-relative note path.'),
  content: markdown.describe('Full markdown content.'),
  ['updated-at']: isoDateTime.describe('Last update time.'),
})

const noteHistoryEntry = z.object({
  id: id('Revision id.'),
  actor: z.string().describe('Actor id that produced the revision.'),
  at: isoDateTime.describe('Revision time.'),
  summary: z.string().describe('Revision summary.'),
})

const conflictRevision = z.object({
  id: id('Conflict revision id.'),
  source: z.string().describe('Source of the competing revision, import, or provider snapshot.'),
  label: z.string().describe('Explicit candidate label shown to the operator or agent.'),
  actor: z.string().optional().describe('Actor id when known.'),
  at: isoDateTime.optional().describe('Revision or import time when known.'),
  summary: z.string().describe('Competing revision summary.'),
  diff: revisionDiff.optional().describe('Compact diff summary when available.'),
})

const conflictCandidate = z.object({
  id: z.string().describe('Stable candidate id used when selecting a resolution outcome.'),
  label: z.string().describe('Explicit candidate label such as `local-head`, `provider-import`, or `merged-preview`.'),
  summary: z.string().describe('What adopting this candidate would do.'),
  ['revision-id']: z.string().optional().describe('Underlying competing revision id when the candidate maps directly to one revision.'),
})

const workspaceConflictDetail = workspaceConflict.extend({
  revisions: z.array(conflictRevision).optional().describe('Competing workspace revisions or imported candidates.'),
  candidates: z.array(conflictCandidate).optional().describe('Explicit resolution candidates that can be selected or used as merge inputs.'),
})

const noteRevision = z.object({
  id: id('Revision id.'),
  actor: z.string().describe('Actor id that produced the revision.'),
  at: isoDateTime.describe('Revision time.'),
  summary: z.string().describe('Revision summary.'),
  head: z.boolean().optional().describe('Whether this revision is the current head.'),
  diff: revisionDiff.optional().describe('Compact diff summary when available.'),
})

const noteAttachment = z.object({
  id: id('Note attachment id.'),
  name: z.string().describe('Attachment file name.'),
  path: path.describe('Workspace-relative attachment path.'),
  ['content-type']: z.string().optional().describe('Attachment content type.'),
  size: z.number().optional().describe('Attachment size in bytes.'),
})

const noteConflict = z.object({
  id: id('Conflict id.'),
  ['note-id']: id('Conflicting note id.'),
  summary: z.string().describe('Conflict summary.'),
  actors: z.array(z.string()).describe('Actors involved in the conflict.'),
})

const noteConflictDetail = noteConflict.extend({
  revisions: z.array(conflictRevision).optional().describe('Competing note revisions or imported candidates.'),
  candidates: z
    .array(conflictCandidate)
    .optional()
    .describe('Explicit resolution candidates that can be selected or used as merge inputs.'),
})

const fileEntry = z.object({
  path: path.describe('Host path.'),
  kind: z.enum(['file', 'folder', 'symlink']).describe('Filesystem entry kind.'),
  size: z.number().optional().describe('Size in bytes when known.'),
  ['modified-at']: isoDateTime.optional().describe('Modification time.'),
})

const fileReadResult = z.object({
  path: path.describe('Host path.'),
  encoding: z.string().describe('Read encoding.'),
  content: z.string().describe('Read content.'),
})

const fileSearchResult = z.object({
  path: path.describe('Matched path.'),
  excerpt: z.string().optional().describe('Matched excerpt when content search is enabled.'),
})

const googleCalendarExternalLink = z.object({
  provider: z.literal('google-calendar').describe('Provider name.'),
  ref: z.string().describe('Canonical provider ref, typically `<calendar-id>/<event-id>` when the remote event exists.'),
  ['sync-mode']: z.enum(['import', 'mirror', 'detached']).describe('Local Google Calendar linkage mode.'),
  ['lifecycle-status']: z
    .enum(['linked', 'detached'])
    .describe('Lifecycle of the local link. `detached` means the local object is preserved and the remote Google event is left untouched.'),
  ['calendar-id']: z.string().describe('Google calendar id for the linked or previously linked surface.'),
  ['google-event-id']: z.string().optional().describe('Bound Google event id when one exists.'),
  ['last-pulled-at']: isoDateTime.optional().describe('Most recent successful import time.'),
  ['last-pushed-at']: isoDateTime.optional().describe('Most recent successful export time.'),
  ['last-external-hash']: z.string().optional().describe('Last observed Google-side content hash when tracked.'),
})

const googleTasksExternalLink = z.object({
  provider: z.literal('google-tasks').describe('Provider name.'),
  ref: z.string().describe('Canonical provider ref, typically `<task-list-id>/<google-task-id>` when the remote task exists.'),
  ['sync-mode']: z.enum(['import', 'mirror', 'detached']).describe('Local Google Tasks linkage mode.'),
  ['lifecycle-status']: z
    .enum(['linked', 'detached'])
    .describe('Lifecycle of the local link. `detached` means the local object is preserved and the remote Google task is left untouched.'),
  ['task-list-id']: z.string().describe('Google task list id for the linked or previously linked surface.'),
  ['google-task-id']: z.string().optional().describe('Bound Google task id when one exists.'),
  ['last-pulled-at']: isoDateTime.optional().describe('Most recent successful import time.'),
  ['last-pushed-at']: isoDateTime.optional().describe('Most recent successful export time.'),
  ['last-external-hash']: z.string().optional().describe('Last observed Google-side content hash when tracked.'),
})

const externalLink = z.discriminatedUnion('provider', [googleCalendarExternalLink, googleTasksExternalLink])

const project = z.object({
  id: id('Project id.'),
  name: z.string().describe('Project name.'),
  status: z.string().describe('Project status.'),
  description: markdown.optional().describe('Project description.'),
})

const label = z.object({
  id: id('Label id.'),
  name: z.string().describe('Label name.'),
  color: z.string().optional().describe('Optional color token.'),
})

const recurrence = z.object({
  rule: z.string().describe('Recurrence rule.'),
  ['start-date']: isoDate.optional().describe('Series start date.'),
  ['end-date']: isoDate.optional().describe('Series end date.'),
  ['series-id']: z.string().optional().describe('Stable recurrence series id shared by every occurrence in the series.'),
  ['occurrence-index']: z
    .number()
    .optional()
    .describe('Zero-based index of this occurrence in the series. The series root is the occurrence whose `occurrence-index` is `0`.'),
  ['materialization-kind']: z
    .enum(['root', 'exception', 'derived'])
    .optional()
    .describe('How this occurrence exists within the series. `root` and `exception` are canonical records; `derived` is a generated/materialized occurrence projected from them.'),
  ['previous-occurrence-id']: z.string().optional().describe('Previous occurrence id when this is not the series root.'),
  ['next-occurrence-id']: z.string().optional().describe('Next occurrence id when it already exists.'),
  ['advance-mode']: z
    .enum(['on_completion', 'on_schedule'])
    .optional()
    .describe('Task-series advancement mode. This is task-specific and is omitted for calendar-only recurrence.'),
})

const task = z.object({
  id: id('Task id.'),
  title: z.string().describe('Task title.'),
  status: z.string().describe('Task status.'),
  priority: z.string().optional().describe('Task priority.'),
  project: project.optional().describe('Linked project when present.'),
  labels: z.array(label).optional().describe('Linked labels.'),
  ['description-md']: markdown.optional().describe('Task description markdown.'),
  ['note-id']: z.string().optional().describe('Linked note id when present.'),
  ['calendar-item-ids']: z.array(z.string()).optional().describe('Linked calendar item ids.'),
  ['due-kind']: z
    .enum(['date', 'datetime'])
    .optional()
    .describe('Whether the due window uses date-only or datetime semantics.'),
  ['due-from']: z.string().optional().describe('Due window start, date or datetime depending on due-kind.'),
  ['due-at']: z.string().optional().describe('Due window end, date or datetime depending on due-kind.'),
  ['due-timezone']: z.string().optional().describe('IANA timezone for datetime due windows.'),
  ['blocked-by']: z.array(id('Blocking task id.')).optional().describe('Blocking task ids.'),
  recurrence: recurrence.optional().describe('Recurrence definition when present. The series root plus explicit exceptions are canonical; `materialization-kind=derived` is projected from them.'),
  ['external-links']: z.array(externalLink).optional().describe('Provider links.'),
})

const calendarItem = z.object({
  id: id('Calendar item id.'),
  title: z.string().describe('Calendar item title.'),
  status: z.string().describe('Calendar item status.'),
  kind: z.string().optional().describe('Calendar item kind.'),
  project: project.optional().describe('Linked project when present.'),
  labels: z.array(label).optional().describe('Linked labels.'),
  ['description-md']: markdown.optional().describe('Calendar item description markdown.'),
  location: z.string().optional().describe('Location text when present.'),
  ['start-date']: isoDate.optional().describe('All-day start date when the item is all-day.'),
  ['end-date-exclusive']: isoDate.optional().describe('Exclusive all-day end date when the item is all-day.'),
  ['start-at']: isoDateTime.optional().describe('Scheduled start time for timed events.'),
  ['end-at']: isoDateTime.optional().describe('Scheduled end time for timed events.'),
  timezone: z.string().optional().describe('IANA timezone for timed or all-day events.'),
  ['all-day']: z.boolean().optional().describe('Whether the item is all-day.'),
  recurrence: recurrence.optional().describe('Recurrence definition when present. The series root plus explicit exceptions are canonical; `materialization-kind=derived` is projected from them.'),
  ['task-ids']: z.array(z.string()).optional().describe('Linked task ids when present.'),
  ['external-links']: z.array(externalLink).optional().describe('Provider links.'),
})

const googleCalendarSurfaceStatus = z.object({
  id: id('Google Calendar surface id.'),
  provider: z.literal('google-calendar').describe('Provider key.'),
  scope: z.string().describe('Attached Google Calendar surface scope.'),
  status: z.string().describe('Surface status.'),
  summary: z.string().describe('Surface summary.'),
  ['calendar-id']: z.string().describe('Selected Google calendar id.'),
  ['calendar-title']: z.string().optional().describe('Calendar display name when known.'),
  selected: z.boolean().describe('Whether this calendar is selected for sync or mirroring.'),
  ['attached-item-count']: z.number().optional().describe('Number of Origin calendar items currently linked to this calendar.'),
  pollers: z.array(providerPollerStatus).describe('Pollers that serve this selected calendar.'),
})

const googleTasksSurfaceStatus = z.object({
  id: id('Google Tasks surface id.'),
  provider: z.literal('google-tasks').describe('Provider key.'),
  scope: z.string().describe('Attached Google Tasks surface scope.'),
  status: z.string().describe('Surface status.'),
  summary: z.string().describe('Surface summary.'),
  ['task-list-id']: z.string().describe('Selected Google task list id.'),
  ['task-list-title']: z.string().optional().describe('Task list display name when known.'),
  selected: z.boolean().describe('Whether this task list is selected for sync or mirroring.'),
  ['attached-task-count']: z.number().optional().describe('Number of Origin tasks currently linked to this task list.'),
  pollers: z.array(providerPollerStatus).describe('Pollers that serve this selected task list.'),
})

const googleCalendarBridgeStatus = z.object({
  provider: z.literal('google-calendar').describe('Provider key.'),
  status: z.string().describe('Overall Google Calendar bridge status.'),
  summary: z.string().describe('Overall Google Calendar bridge summary.'),
  ['selected-calendars']: z.array(googleCalendarSurfaceStatus).describe('Google calendars selected for sync, import, or mirroring.'),
  pollers: z.array(providerPollerStatus).describe('Flattened pollers across selected Google calendars.'),
  ['last-refreshed-at']: isoDateTime.optional().describe('Most recent Google Calendar refresh completion time when known.'),
})

const googleTasksBridgeStatus = z.object({
  provider: z.literal('google-tasks').describe('Provider key.'),
  status: z.string().describe('Overall Google Tasks bridge status.'),
  summary: z.string().describe('Overall Google Tasks bridge summary.'),
  ['selected-task-lists']: z.array(googleTasksSurfaceStatus).describe('Google task lists selected for sync, import, or mirroring.'),
  pollers: z.array(providerPollerStatus).describe('Flattened pollers across selected Google task lists.'),
  ['last-refreshed-at']: isoDateTime.optional().describe('Most recent Google Tasks refresh completion time when known.'),
})

const planningDayView = z.object({
  date: isoDate.describe('Day represented by this view.'),
  tasks: z.array(task).describe('Tasks relevant to the day.'),
  ['calendar-items']: z.array(calendarItem).describe('Calendar items for the day.'),
  summary: z.string().describe('Planning summary for the day.'),
})

const planningWeekView = z.object({
  ['week-start']: isoDate.describe('Week start date.'),
  days: z.array(planningDayView).describe('Daily planning views.'),
  summary: z.string().describe('Week summary.'),
})

const planningWindowView = z.object({
  from: isoDate.describe('Inclusive lower bound.'),
  to: isoDate.describe('Inclusive upper bound.'),
  tasks: z.array(task).describe('Tasks in the window.'),
  ['calendar-items']: z.array(calendarItem).describe('Calendar items in the window.'),
  summary: z.string().describe('Window summary.'),
})

const agendaView = z.object({
  date: isoDate.describe('Agenda date.'),
  items: z.array(calendarItem).describe('Ordered agenda items.'),
  summary: z.string().describe('Agenda summary.'),
})

const planningBoardView = z.object({
  columns: z
    .array(
      z.object({
        key: z.string().describe('Board column key.'),
        title: z.string().describe('Board column title.'),
        tasks: z.array(task).describe('Tasks in the column.'),
      }),
    )
    .describe('Board columns.'),
  summary: z.string().describe('Board summary.'),
})

const taskGraphView = z.object({
  roots: z.array(task).describe('Root tasks in the dependency graph.'),
  edges: z
    .array(
      z.object({
        from: id('Task id.'),
        to: id('Blocking task id.'),
      }),
    )
    .describe('Dependency edges.'),
  summary: z.string().describe('Dependency graph summary.'),
})

const emailAccount = z.object({
  id: id('Email account id.'),
  address: z.string().describe('Connected mailbox address.'),
  status: z.string().describe('Connection status.'),
  summary: z.string().describe('Account summary.'),
  ['last-sync-at']: isoDateTime.optional().describe('Last sync timestamp.'),
  ['sync-state']: z.string().optional().describe('Current provider sync state.'),
  labels: z.array(z.string()).optional().describe('Known provider labels.'),
  aliases: z.array(z.string()).optional().describe('Known send-as aliases.'),
})

const emailAttachment = z.object({
  id: id('Attachment id.'),
  name: z.string().describe('Attachment file name.'),
  ['content-type']: z.string().optional().describe('Attachment content type.'),
  size: z.number().optional().describe('Attachment size in bytes.'),
  ['cached-path']: path.optional().describe('Cached attachment path when stored locally.'),
})

const emailMessage = z.object({
  id: id('Message id.'),
  from: z.string().describe('From address.'),
  to: z.array(z.string()).describe('Recipient addresses.'),
  cc: z.array(z.string()).optional().describe('Cc recipient addresses.'),
  bcc: z.array(z.string()).optional().describe('Bcc recipient addresses when known.'),
  subject: z.string().describe('Message subject.'),
  body: markdown.optional().describe('Message body when cached or fetched.'),
  snippet: z.string().optional().describe('Cached provider snippet.'),
  headers: z.record(z.string(), z.string()).optional().describe('Selected provider headers when fetched.'),
  raw: z.string().optional().describe('Raw provider message representation when fetched.'),
  at: isoDateTime.describe('Message timestamp.'),
  attachments: z.array(emailAttachment).optional().describe('Known attachments.'),
  provenance: z
    .object({
      ['is-forwarded']: z.boolean().optional().describe('Whether the message appears forwarded.'),
      ['forwarded-by-user']: z.boolean().optional().describe('Whether the forwarding source is the owner.'),
      ['forwarded-from-address']: z.string().optional().describe('Original source address when known.'),
    })
    .optional()
    .describe('Lightweight provenance when known.'),
})

const emailTriageRecord = z.object({
  ['thread-id']: id('Thread id.'),
  state: z.string().describe('Origin triage state.'),
  ['follow-up-at']: isoDateTime.optional().describe('Scheduled follow-up time.'),
  ['linked-task-id']: z.string().optional().describe('Linked task id.'),
})

const emailThread = z.object({
  id: id('Thread id.'),
  subject: z.string().describe('Thread subject.'),
  status: z.string().describe('Provider thread status summary.'),
  ['archived-at']: isoDateTime.optional().describe('Provider mailbox archive timestamp when the thread is archived remotely.'),
  messages: z.array(emailMessage).optional().describe('Messages when expanded.'),
  triage: emailTriageRecord.optional().describe('Origin triage metadata.'),
  ['last-message-at']: isoDateTime.optional().describe('Most recent message timestamp.'),
  labels: z.array(z.string()).optional().describe('Provider labels applied to the thread.'),
  freshness: z.string().optional().describe('Cache freshness summary.'),
})

const emailDraft = z.object({
  id: id('Draft id.'),
  subject: z.string().describe('Draft subject.'),
  to: z.array(z.string()).describe('Draft recipients.'),
  body: markdown.describe('Draft body.'),
  ['thread-id']: z.string().optional().describe('Thread id when the draft belongs to an existing thread.'),
})

const emailThreadContext = z.object({
  thread: emailThread.describe('Provider thread snapshot with Origin overlay.'),
  ['linked-entities']: z.array(entityRef).optional().describe('Linked Origin entities.'),
  ['recent-activity']: z.array(activityEvent).optional().describe('Recent related activity.'),
  ['pending-actions']: z
    .array(
      z.object({
        id: id('Pending action id.'),
        kind: z.string().describe('Pending action kind.'),
        status: z.string().describe('Pending action status.'),
      }),
    )
    .optional()
    .describe('Pending outbound actions for the thread.'),
})

const githubRepository = z.object({
  id: id('Repository id.'),
  name: z.string().describe('owner/name repository ref.'),
  tracked: z.boolean().describe('Whether Origin actively tracks the repository.'),
  summary: z.string().describe('Repository summary.'),
  pinned: z.boolean().optional().describe('Whether the repository is pinned locally.'),
})

const githubFollowTarget = z.object({
  id: id('Follow target id.'),
  kind: z.string().describe('Follow target kind.'),
  repo: z.string().describe('Repository owner/name.'),
  ['target-ref']: z.string().optional().describe('Issue or PR ref when applicable.'),
  enabled: z.boolean().optional().describe('Whether the follow target is active.'),
  pinned: z.boolean().optional().describe('Whether the target is pinned in the local working set.'),
  reason: z.string().optional().describe('Why this follow target exists.'),
  ['dismissed-at']: isoDateTime.optional().describe('When the current attention state was dismissed.'),
  ['dismissed-by-actor']: z.string().optional().describe('Actor that last dismissed the current attention state.'),
  ['dismissed-through-cursor']: z.string().optional().describe('Repository refresh cursor boundary through which attention is suppressed. The target resurfaces only after newer activity advances beyond this cursor.'),
  ['last-refreshed-at']: isoDateTime.optional().describe('Most recent refresh time for this follow target when known.'),
})

const githubIssue = z.object({
  id: id('Issue snapshot id.'),
  ref: z.string().describe('Issue ref such as owner/name#123.'),
  title: z.string().describe('Issue title.'),
  state: z.string().describe('Issue state.'),
  summary: z.string().describe('Issue summary.'),
  labels: z.array(z.string()).optional().describe('Issue labels.'),
  assignees: z.array(z.string()).optional().describe('Issue assignees.'),
})

const githubPullRequest = z.object({
  id: id('Pull request snapshot id.'),
  ref: z.string().describe('Pull request ref such as owner/name#456.'),
  title: z.string().describe('Pull request title.'),
  state: z.string().describe('Pull request state.'),
  summary: z.string().describe('Pull request summary.'),
  reviewers: z.array(z.string()).optional().describe('Requested or participating reviewers.'),
  checks: z.array(z.string()).optional().describe('Compact checks summary.'),
})

const githubComment = z.object({
  id: id('GitHub comment id.'),
  author: z.string().describe('Comment author.'),
  body: markdown.describe('Comment body.'),
  at: isoDateTime.describe('Comment time.'),
})

const githubReview = z.object({
  id: id('GitHub review id.'),
  author: z.string().describe('Review author.'),
  state: z.string().describe('Review state.'),
  body: markdown.optional().describe('Review body.'),
  at: isoDateTime.describe('Review time.'),
})

const githubIssueContext = z.object({
  issue: githubIssue.describe('Issue snapshot.'),
  comments: z.array(githubComment).optional().describe('Issue comments.'),
  timeline: z.array(activityEvent).optional().describe('Recent issue timeline summary.'),
  ['linked-entities']: z.array(entityRef).optional().describe('Linked Origin entities.'),
  freshness: z.string().optional().describe('Cache freshness summary.'),
})

const githubPullRequestContext = z.object({
  pr: githubPullRequest.describe('Pull request snapshot.'),
  comments: z.array(githubComment).optional().describe('Pull request comments.'),
  reviews: z.array(githubReview).optional().describe('Pull request reviews.'),
  files: z.array(z.string()).optional().describe('Changed files when hydrated.'),
  diff: z.string().optional().describe('Compact diff or diff summary when hydrated.'),
  ['linked-entities']: z.array(entityRef).optional().describe('Linked Origin entities.'),
  freshness: z.string().optional().describe('Cache freshness summary.'),
})

const telegramConnection = z.object({
  status: z.string().describe('Connection status.'),
  ['bot-username']: z.string().optional().describe('Connected bot username.'),
  ['privacy-mode']: z.string().optional().describe('Observed privacy mode state used for validation.'),
  ['default-mode']: z.enum(['observe', 'participate']).optional().describe('Default participation mode seeded onto newly enabled groups.'),
  ['default-summary-enabled']: z.boolean().optional().describe('Whether summaries are enabled by default for newly registered groups.'),
  ['default-summary-window']: duration.optional().describe('Default summary lookback or cadence used only to seed group policy when a group has no explicit summary window.'),
  summary: z.string().describe('Connection summary.'),
})

const telegramChat = z.object({
  id: id('Telegram chat id.'),
  title: z.string().describe('Chat title.'),
  kind: z.string().describe('Chat kind.'),
  summary: z.string().describe('Chat summary.'),
  ['is-registered']: z.boolean().optional().describe('Whether the chat is registered in Origin.'),
  ['message-cache-state']: z.string().optional().describe('Recent message cache state.'),
})

const telegramSummaryPolicy = z.object({
  enabled: z.boolean().describe('Whether summaries are enabled for the group.'),
  window: duration.optional().describe('Canonical per-group summary lookback or cadence when configured. Connection defaults may seed new groups but do not override an explicit group window.'),
})

const telegramGroupPolicy = z.object({
  ['chat-id']: id('Telegram chat id.'),
  enabled: z.boolean().describe('Whether the group is enabled in Origin.'),
  ['participation-mode']: z
    .enum(['observe', 'participate'])
    .optional()
    .describe('Bot participation mode when the group is enabled.'),
  ['summary-policy']: telegramSummaryPolicy.optional().describe('Per-group canonical summary policy.'),
  ['mention-tracking-enabled']: z.boolean().optional().describe('Whether mention tracking is enabled.'),
  ['message-cache-enabled']: z.boolean().optional().describe('Whether recent message cache is enabled.'),
  summary: z.string().optional().describe('Group policy summary.'),
})

const telegramMessage = z.object({
  id: id('Telegram message id.'),
  author: z.string().optional().describe('Telegram author identity when known.'),
  body: markdown.describe('Telegram message body.'),
  at: isoDateTime.describe('Telegram message time.'),
})

const telegramSummaryJob = z.object({
  id: id('Summary job id.'),
  ['chat-id']: id('Telegram chat id.'),
  status: z.string().describe('Summary job status.'),
  summary: z.string().describe('Generated or queued summary.'),
  at: isoDateTime.optional().describe('Summary creation time.'),
})

const telegramChatContext = z.object({
  chat: telegramChat.describe('Telegram chat snapshot.'),
  policy: telegramGroupPolicy.optional().describe('Origin-managed group policy.'),
  messages: z.array(telegramMessage).optional().describe('Cached recent messages.'),
  ['recent-activity']: z.array(activityEvent).optional().describe('Recent related activity.'),
  freshness: z.string().optional().describe('Cache freshness summary.'),
})

const automationTriggerSchedule = z.object({
  type: z.literal('schedule').describe('Scheduled trigger kind.'),
  cron: z.string().describe('Cron expression used for schedule evaluation.'),
  timezone: z.string().optional().describe('IANA timezone for schedule evaluation.'),
  ['start-at']: isoDateTime.optional().describe('Optional first eligible run time.'),
  ['end-at']: isoDateTime.optional().describe('Optional last eligible run time.'),
})

const automationTriggerEvent = z.object({
  type: z.literal('event').describe('Reactive trigger kind.'),
  ['event-kinds']: z.array(z.string()).describe('Canonical durable Origin activity-event kinds that may trigger the automation.'),
  filters: z.record(z.string(), z.unknown()).optional().describe('Conjunctive structured event filters evaluated after the event kind matches.'),
  ['source-scope']: z.record(z.string(), z.unknown()).optional().describe('Optional provider, object, or entity scope constraints that further limit matching events.'),
})

const automationTriggerManual = z.object({
  type: z.literal('manual').describe('Manual trigger kind.'),
})

const automationTriggerHybrid = z.object({
  type: z.literal('hybrid').describe('Schedule plus event trigger kind.'),
  schedule: z
    .object({
      cron: z.string().describe('Cron expression used for schedule evaluation.'),
      timezone: z.string().optional().describe('IANA timezone for schedule evaluation.'),
      ['start-at']: isoDateTime.optional().describe('Optional first eligible run time.'),
      ['end-at']: isoDateTime.optional().describe('Optional last eligible run time.'),
    })
    .describe('Schedule portion of the trigger.'),
  event: z
    .object({
      ['event-kinds']: z.array(z.string()).describe('Canonical durable Origin activity-event kinds that may trigger the automation.'),
      filters: z.record(z.string(), z.unknown()).optional().describe('Conjunctive structured event filters evaluated after the event kind matches.'),
      ['source-scope']: z.record(z.string(), z.unknown()).optional().describe('Optional provider, object, or entity scope constraints that further limit matching events.'),
    })
    .describe('Reactive event portion of the trigger.'),
})

const automationTrigger = z.discriminatedUnion('type', [
  automationTriggerSchedule,
  automationTriggerEvent,
  automationTriggerManual,
  automationTriggerHybrid,
])

const automationAction = z.object({
  type: z.literal('command').describe('Action kind.'),
  command: z.string().describe('Exact canonical Origin CLI command path to invoke.'),
  args: z.array(z.string()).optional().describe('Ordered positional arguments for that command path.'),
  options: z.record(z.string(), z.unknown()).optional().describe('Named CLI options or flags for that command path.'),
  summary: z.string().optional().describe('Human-readable action summary.'),
})

const automationRunPolicy = z.object({
  ['allow-overlap']: z.boolean().default(false).describe('Whether runs of the same automation may overlap. Defaults to false.'),
  ['catch-up']: z.enum(['skip', 'one', 'all']).default('skip').describe('How missed scheduled runs are handled. Defaults to `skip`.'),
  ['continue-on-error']: z.boolean().default(false).describe('Whether later actions continue after an action failure. Defaults to false.'),
})

const automationRetryPolicy = z.object({
  ['max-attempts']: z.number().int().min(0).default(3).describe('Maximum total attempts for one logical run. Defaults to 3.'),
  backoff: z.enum(['none', 'linear', 'exponential']).default('exponential').describe('Retry backoff strategy. Defaults to `exponential`.'),
})

const automation = z.object({
  id: id('Automation id.'),
  name: z.string().describe('Canonical automation name.'),
  slug: z.string().optional().describe('Stable automation slug or machine key when available.'),
  ['description-md']: markdown.optional().describe('Canonical automation description markdown.'),
  status: z.string().describe('Automation status.'),
  kind: z.enum(['scheduled', 'reactive', 'manual', 'hybrid']).describe('Derived automation kind based on the trigger shape.'),
  summary: z.string().optional().describe('Compact derived automation summary. This is read-model text, not a second canonical description field.'),
  trigger: automationTrigger.optional().describe('Typed trigger definition.'),
  actions: z.array(automationAction).optional().describe('Ordered action definitions.'),
  ['linked-task-ids']: z.array(z.string()).optional().describe('Linked task ids.'),
  ['linked-calendar-item-ids']: z.array(z.string()).optional().describe('Linked calendar item ids.'),
  ['linked-project-ids']: z.array(z.string()).optional().describe('Linked project ids.'),
  ['label-ids']: z.array(z.string()).optional().describe('Linked label ids.'),
  ['notification-policy']: z.record(z.string(), z.unknown()).optional().describe('Notification policy.'),
  ['run-policy']: automationRunPolicy.optional().describe('Run policy.'),
  ['retry-policy']: automationRetryPolicy.optional().describe('Retry policy.'),
  source: z.string().optional().describe('Where the automation definition came from when known.'),
  ['last-run-at']: isoDateTime.optional().describe('Most recent run start or completion time.'),
  ['next-run-at']: isoDateTime.optional().describe('Next eligible run time when scheduled.'),
  ['last-run-status']: z.string().optional().describe('Most recent run status when known.'),
})

const automationRun = z.object({
  id: id('Automation run id.'),
  ['automation-id']: id('Automation id.'),
  status: z.string().describe('Run status.'),
  summary: z.string().describe('Run summary.'),
  ['triggered-at']: isoDateTime.optional().describe('Logical trigger time for the run.'),
  ['scheduled-at']: isoDateTime.optional().describe('Scheduled trigger boundary when this is a scheduled run.'),
  ['activity-event-id']: z.string().optional().describe('Triggering activity-event id when this is a reactive run.'),
  ['trigger-reason']: z.string().optional().describe('Why the run started, such as schedule, matching event, or manual request.'),
  ['started-at']: isoDateTime.optional().describe('Run start time.'),
  ['ended-at']: isoDateTime.optional().describe('Run end time.'),
  ['trace-id']: z.string().optional().describe('Correlated trace id.'),
})

const automationRunStep = z.object({
  id: id('Automation run step id.'),
  kind: z.string().describe('Step kind.'),
  status: z.string().describe('Step status.'),
  summary: z.string().describe('Step summary.'),
})

const automationRunDetail = automationRun.extend({
  steps: z.array(automationRunStep).optional().describe('Per-step run outcomes.'),
  events: z.array(activityEvent).optional().describe('Structured events emitted by the run.'),
})

const automationSchedulePreview = z.object({
  summary: z.string().describe('Schedule preview summary.'),
  ['next-runs']: z.array(isoDateTime).describe('Projected next run times.'),
})

const activityTrace = z.object({
  ['trace-id']: z.string().describe('Trace id.'),
  summary: z.string().describe('Trace summary.'),
  events: z.array(activityEvent).describe('Events in the trace.'),
})

const notification = z.object({
  id: id('Notification id.'),
  kind: z.string().describe('Notification kind.'),
  title: z.string().describe('Notification title.'),
  status: z.string().describe('Notification status.'),
  at: isoDateTime.describe('Notification time.'),
})

const notificationDevice = z.object({
  id: id('Notification device id.'),
  kind: z.string().describe('Device kind.'),
  status: z.string().describe('Device status.'),
  summary: z.string().describe('Device summary.'),
})

const notificationDelivery = z.object({
  id: id('Delivery id.'),
  ['notification-id']: id('Notification id.'),
  channel: z.string().describe('Delivery channel.'),
  status: z.string().describe('Delivery status.'),
  summary: z.string().describe('Delivery summary.'),
})

const syncPeerStatus = z.object({
  id: id('Peer id.'),
  kind: z.string().describe('Peer kind.'),
  status: z.string().describe('Peer sync status.'),
  summary: z.string().describe('Peer summary.'),
})

const syncJob = z.object({
  id: id('Sync job id.'),
  kind: z.string().describe('Job kind.'),
  status: z.string().describe('Job status.'),
  summary: z.string().describe('Job summary.'),
  ['trace-id']: z.string().optional().describe('Correlated trace id.'),
})

const outboxItem = z.object({
  id: id('Outbox item id.'),
  kind: z.string().describe('Outbox item kind.'),
  status: z.string().describe('Outbox item status.'),
  provider: z.string().optional().describe('Owning provider or subsystem when applicable.'),
  ['origin-intent-id']: z.string().optional().describe('Stable replicated intent id or other origin record id that produced this logical outbox item.'),
  ['target-ref']: z.string().optional().describe('Primary provider or entity target for the outbox item when known.'),
  ['dedupe-key']: z.string().optional().describe('Stable dedupe key reused across retries for the same logical action.'),
  ['queued-at']: isoDateTime.optional().describe('When the outbox item was queued.'),
  ['attempted-at']: isoDateTime.optional().describe('When the latest dispatch attempt started.'),
  ['succeeded-at']: isoDateTime.optional().describe('When the outbox item last succeeded.'),
  ['failed-at']: isoDateTime.optional().describe('When the outbox item last failed.'),
  ['last-error']: z.string().optional().describe('Most recent error summary when the outbox item is degraded or failed.'),
  summary: z.string().describe('Outbox item summary.'),
})

const bridgeJob = z.object({
  id: id('Bridge job id.'),
  status: z.string().describe('Bridge job status.'),
  summary: z.string().describe('Bridge job summary.'),
})

const syncConflict = z.object({
  id: id('Conflict id.'),
  kind: z.string().describe('Conflict kind.'),
  summary: z.string().describe('Conflict summary.'),
  peers: z.array(z.string()).optional().describe('Peers involved in the conflict.'),
})

const syncConflictDetail = syncConflict.extend({
  revisions: z.array(conflictRevision).optional().describe('Competing revisions, provider imports, or bridge candidates.'),
  candidates: z.array(conflictCandidate).optional().describe('Available resolution candidates that can be selected explicitly.'),
})

const syncStatus = z.object({
  summary: z.string().describe('Top-level sync summary.'),
  replica: z.string().describe('Replica-sync summary.'),
  provider: z.string().describe('Provider-sync summary.'),
  outbox: z.string().describe('Outbox summary.'),
  bridge: z.string().describe('Filesystem bridge summary.'),
})

const originEntity = z.object({
  kind: z.string().describe('Entity kind.'),
  id: id('Stable Origin id.'),
  title: z.string().describe('Entity title.'),
  summary: z.string().optional().describe('Compact entity summary.'),
})

const entityHistoryEntry = z.object({
  id: id('History entry id.'),
  actor: z.string().describe('Actor id.'),
  at: isoDateTime.describe('History timestamp.'),
  summary: z.string().describe('History summary.'),
})

const doc = <const definition extends Record<string, unknown>>(definition: definition) => ({
  ...definition,
  run: specOnly,
})

const status = Cli.create('status', {
  description: 'Health, runtime, storage, queue, and blocker views.',
})
  .command(
    'show',
    doc({
      description: 'Show the top-level Origin state across setup, integrations, sync, and automation.',
      output: statusSummary,
      examples: [{ description: 'Show the current Origin status overview' }],
    }),
  )
  .command(
    'doctor',
    doc({
      description: 'Run active end-to-end health checks and return remediation guidance.',
      output: validationResult,
      hint: 'Use this for active diagnosis, not just cheap status reads.',
    }),
  )
  .command(
    'blockers',
    doc({
      description: 'List actionable blockers such as broken integrations, failed jobs, or unresolved conflicts.',
      output: list(blocker, 'Outstanding blocker entries.'),
    }),
  )
  .command(
    'checks',
    doc({
      description: 'List recent or current subsystem checks.',
      output: list(validationCheck, 'Check entries.'),
    }),
  )
  .command(
    Cli.create('check', { description: 'Inspect one status check.' }).command(
      'get',
      doc({
        description: 'Get one status check by id.',
        args: z.object({ ['check-id']: id('Status check id.') }),
        output: validationCheck,
      }),
    ),
  )
  .command(
    'runtime',
    doc({
      description: 'Inspect process/runtime state.',
      output: runtimeStatus,
    }),
  )
  .command(
    'services',
    doc({
      description: 'List internal services and their health.',
      output: list(serviceStatus, 'Service status entries.'),
    }),
  )
  .command(
    'storage',
    doc({
      description: 'Inspect SQLite, replicated state, workspace, and cache storage health.',
      output: storageStatus,
    }),
  )
  .command(
    'queues',
    doc({
      description: 'List queue backlogs across chat, automation, notifications, and sync.',
      output: list(queueStatus, 'Queue status entries.'),
    }),
  )
  .command(
    'paths',
    doc({
      description: 'Show important runtime paths such as the state dir, workspace, vault, and SQLite file.',
      output: pathSummary,
    }),
  )

const context = Cli.create('context', {
  description: 'Cross-domain context retrieval for planning and execution.',
})
  .command(
    'now',
    doc({
      description: 'Return the highest-signal cross-domain context right now.',
      options: z.object({
        domains: z.array(z.string()).optional().describe('Optional domain filter.'),
      }),
      output: contextPack,
      examples: [{ description: 'Show what matters right now' }],
    }),
  )
  .command(
    'relevant',
    doc({
      description: 'Return the most relevant context for a goal, question, or intended action.',
      args: z.object({ goal: z.string().describe('Plain-language goal or question.') }),
      options: z.object({
        mode: z
          .enum(['exact', 'semantic', 'hybrid'])
          .default('hybrid')
          .describe('Retrieval mode.'),
        domains: z.array(z.string()).optional().describe('Optional domain filter.'),
        limit: z.number().optional().describe('Maximum entity count.'),
      }),
      output: contextPack,
      examples: [{ args: { goal: 'What should I do next for today?' } }],
    }),
  )
  .command(
    'entity',
    doc({
      description: 'Return an enriched context pack centered on one entity.',
      args: z.object({ entity: id('Entity id or ref.') }),
      output: contextPack,
    }),
  )
  .command(
    'day',
    doc({
      description: 'Return a day-scoped context pack including planning, inbox pressure, and recent agent actions.',
      args: z.object({ date: isoDate }),
      output: contextPack,
    }),
  )
  .command(
    'inbox',
    doc({
      description: 'Return a consolidated inbox context across email, GitHub, Telegram, and notifications.',
      options: z.object({
        limit: z.number().optional().describe('Maximum items to include.'),
      }),
      output: contextPack,
    }),
  )
  .command(
    'project',
    doc({
      description: 'Return a cross-domain context pack for one project.',
      args: z.object({ ['project-id']: id('Project id.') }),
      output: contextPack,
    }),
  )

const search = Cli.create('search', {
  description: 'Cross-domain exact and semantic search.',
})
  .command(
    'query',
    doc({
      description: 'Run a cross-domain search query.',
      options: z.object({
        query: z.string().describe('Search query.'),
        mode: z.enum(['exact', 'semantic', 'hybrid']).default('hybrid').describe('Search mode.'),
        domains: z.array(z.string()).optional().describe('Optional domain filter.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(searchHit, 'Search hits.'),
      examples: [{ options: { query: 'passport renewal' } }],
    }),
  )
  .command(
    'similar',
    doc({
      description: 'Find items semantically similar to a given seed entity or block of text.',
      args: z.object({ seed: z.string().describe('Seed entity id or free text.') }),
      options: z.object({
        domains: z.array(z.string()).optional().describe('Optional domain filter.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(searchHit, 'Similarity search hits.'),
    }),
  )
  .command(
    'related',
    doc({
      description: 'Find exact and semantic neighbors for one entity.',
      args: z.object({ entity: id('Entity id or ref.') }),
      options: z.object({
        domains: z.array(z.string()).optional().describe('Optional domain filter.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(searchHit, 'Related search hits.'),
    }),
  )
  .command(
    'recent',
    doc({
      description: 'List recently touched entities across domains.',
      options: z.object({
        domains: z.array(z.string()).optional().describe('Optional domain filter.'),
        since: isoDateTime.optional().describe('Lower time bound.'),
        until: isoDateTime.optional().describe('Upper time bound.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(searchHit, 'Recent entities.'),
    }),
  )
  .command(
    'resolve',
    doc({
      description: 'Resolve a fuzzy handle, name, or label into likely Origin entities or identities.',
      options: z.object({
        query: z.string().describe('Name, handle, or fuzzy reference to resolve.'),
        domains: z.array(z.string()).optional().describe('Optional domain filter.'),
      }),
      output: list(searchHit, 'Resolution candidates.'),
    }),
  )

const identity = Cli.create('identity', {
  description: 'Owner and agent identity state that Origin tracks for recognition and setup.',
})
  .command(
    'status',
    doc({
      description: 'Check whether owner and agent identity data is complete and internally consistent.',
      output: identityStatus,
    }),
  )
  .command(
    Cli.create('user', { description: 'Owner identity commands.' })
      .command('get', doc({ description: 'Get the owner identity record.', output: userIdentity }))
      .command(
        'update',
        doc({
          description: 'Update the owner identity record.',
          options: z.object({
            ['display-name']: z.string().optional().describe('Owner display name.'),
            emails: z.array(z.string()).optional().describe('Owner email addresses.'),
            ['github-username']: z.string().optional().describe('Owner GitHub username.'),
            ['telegram-handle']: z.string().optional().describe('Owner Telegram handle.'),
          }),
          output: actionResult,
        }),
      ),
  )
  .command(
    Cli.create('agent', { description: 'Agent identity commands.' })
      .command('get', doc({ description: 'Get the agent identity record.', output: agentIdentity }))
      .command(
        'update',
        doc({
          description: 'Update the agent identity record.',
          options: z.object({
            ['display-name']: z.string().optional().describe('Agent display name.'),
            google: z.string().optional().describe('Agent Google account email.'),
            github: z.string().optional().describe('Agent GitHub username.'),
            telegram: z.string().optional().describe('Agent Telegram bot username.'),
          }),
          output: actionResult,
        }),
      ),
  )
  .command(
    'resolve',
    doc({
      description: 'Resolve an identity handle into the known Origin identity record.',
      options: z.object({
        query: z.string().describe('Handle or address to resolve.'),
      }),
      output: list(identityHandle, 'Matching identity handles.'),
    }),
  )
  .command(
    'handles',
    doc({
      description: 'List known handles and addresses across owner and agent identities.',
      output: list(identityHandle, 'Known identity handles.'),
    }),
  )
  .command(
    Cli.create('handle', { description: 'Mutate individual identity handles.' })
      .command(
        'add',
        doc({
          description: 'Add an identity handle.',
          options: z.object({
            service: z.string().describe('Service name.'),
            handle: z.string().describe('Handle or address.'),
            role: z.enum(['user', 'agent']).describe('Whether the handle belongs to the owner or agent.'),
          }),
          output: actionResult,
        }),
      )
      .command(
        'remove',
        doc({
          description: 'Remove an identity handle.',
          args: z.object({ ['handle-id']: id('Identity handle id.') }),
          output: actionResult,
        }),
      ),
  )
  .command(
    'verify',
    doc({
      description: 'Compare stored identity assumptions with the currently linked provider identities.',
      output: validationResult,
    }),
  )
  .command(
    'sources',
    doc({
      description: 'List where identity facts came from.',
      output: list(identitySource, 'Identity source records.'),
    }),
  )

const integration = Cli.create('integration', {
  description: 'Integration connection, configuration, permissions, jobs, and cache controls.',
})
  .command('list', doc({ description: 'List integrations and their current status.', output: list(integrationStatus, 'Integration status entries.') }))
  .command(
    'get',
    doc({
      description: 'Get one integration status record.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: integrationStatus,
    }),
  )
  .command(
    Cli.create('config', { description: 'Integration configuration state.' })
      .command(
        'get',
        doc({
          description: 'Get Origin-managed configuration for one integration.',
          args: z.object({ integration: z.string().describe('Integration key.') }),
          output: integrationConfig,
        }),
      )
      .command(
        'set',
        doc({
          description: 'Set or patch Origin-managed configuration for one integration.',
          args: z.object({ integration: z.string().describe('Integration key.') }),
          options: z.object({
            values: z.record(z.string(), z.unknown()).describe('Configuration payload.'),
          }),
          output: actionResult,
        }),
      ),
  )
  .command(
    Cli.create('connect', { description: 'Integration connection flows.' })
      .command(
        Cli.create('oauth', { description: 'OAuth connection flows.' })
          .command(
            'start',
            doc({
              description: 'Start an OAuth flow for a provider such as Google or GitHub.',
              args: z.object({ integration: z.string().describe('Integration key.') }),
              options: z.object({
                ['redirect-uri']: z.string().optional().describe('Explicit redirect URI override.'),
                scopes: z.array(z.string()).optional().describe('Explicit scope override.'),
              }),
              output: oauthStart,
            }),
          )
          .command(
            'complete',
            doc({
              description:
                'Complete an OAuth flow after authorization using a secure handoff ref from an operator-only browser flow. If an expected agent identity is stored for the integration, the returned provider principal must match it or the command fails.',
              args: z.object({ integration: z.string().describe('Integration key.') }),
              options: z.object({
                ['code-ref']: secureRef.describe(
                  'Secure handoff ref for the provider authorization code returned by the operator-only browser flow.',
                ),
                state: z.string().optional().describe('Provider state token.'),
              }),
              output: actionResult,
            }),
          ),
      )
      .command(
        Cli.create('token', { description: 'Token-based connection flows.' }).command(
          'set',
          doc({
            description:
              'Set a provider token when the integration does not use OAuth, such as Telegram bot token setup. The token ref must come from an operator-only secure handoff rather than raw secret material typed into the agent CLI.',
            args: z.object({ integration: z.string().describe('Integration key.') }),
            options: z.object({
              ['token-ref']: secureRef.describe(
                'Secure handoff ref for the provider token. Do not pass the raw token directly in the agent CLI.',
              ),
            }),
            output: actionResult,
          }),
        ),
      ),
  )
  .command(
    'reconnect',
    doc({
      description: 'Repair or reconnect an integration without recreating all local metadata.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: actionResult,
    }),
  )
  .command(
    'disconnect',
    doc({
      description: 'Disconnect an integration and invalidate its active connection.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: actionResult,
    }),
  )
  .command(
    'scopes',
    doc({
      description: 'Inspect configured, granted, and missing scopes for an integration.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: integrationScopeStatus,
    }),
  )
  .command(
    'permissions',
    doc({
      description: 'Inspect effective provider permissions or capabilities for an integration.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: integrationScopeStatus,
    }),
  )
  .command(
    'validate',
    doc({
      description: 'Validate credentials, scopes, provider reachability, and minimal behavior.',
      options: z.object({
        integration: z.string().optional().describe('Optional integration filter.'),
      }),
      output: validationResult,
    }),
  )
  .command(
    'refresh',
    doc({
      description: 'Refresh integration metadata or connection state without mutating provider data.',
      options: z.object({
        integration: z.string().optional().describe('Optional integration filter.'),
      }),
      output: actionResult,
    }),
  )
  .command(
    'jobs',
    doc({
      description: 'List recent integration jobs such as validation, reconnect, refresh, or cache work.',
      options: z.object({
        integration: z.string().optional().describe('Optional integration filter.'),
        status: z.array(z.string()).optional().describe('Optional status filter.'),
        since: isoDateTime.optional().describe('Lower time bound.'),
        until: isoDateTime.optional().describe('Upper time bound.'),
        limit: z.number().optional().describe('Maximum job count.'),
      }),
      output: list(integrationJob, 'Integration jobs.'),
    }),
  )
  .command(
    Cli.create('job', { description: 'Inspect one integration job.' }).command(
      'get',
      doc({
        description: 'Get one integration job by id.',
        args: z.object({ ['job-id']: id('Integration job id.') }),
        output: integrationJob,
      }),
    ),
  )
  .command(
    'retry',
    doc({
      description: 'Retry a failed integration job.',
      args: z.object({ ['job-id']: id('Integration job id.') }),
      output: actionResult,
    }),
  )
  .command(
    Cli.create('cache', { description: 'Integration cache controls.' })
      .command(
        'status',
        doc({
          description: 'Inspect integration cache status, selected provider surfaces, and ingress pollers.',
          args: z.object({ integration: z.string().describe('Integration key.') }),
          output: providerIngressStatus,
        }),
      )
      .command(
        'refresh',
        doc({
          description: 'Refresh integration caches.',
          args: z.object({ integration: z.string().describe('Integration key.') }),
          output: actionResult,
        }),
      )
      .command(
        'clear',
        doc({
          description: 'Clear selected integration caches.',
          args: z.object({ integration: z.string().describe('Integration key.') }),
          output: actionResult,
        }),
      ),
  )
  .command(
    'rate-limits',
    doc({
      description: 'Inspect provider rate-limit state.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: list(rateLimitStatus, 'Rate-limit buckets.'),
    }),
  )
  .command(
    'history',
    doc({
      description: 'List notable integration history entries for audit or debugging.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: list(integrationJob, 'Historical integration jobs.'),
    }),
  )
  .command(
    'diagnose',
    doc({
      description: 'Diagnose why an integration is degraded and return remediation guidance.',
      args: z.object({ integration: z.string().describe('Integration key.') }),
      output: validationResult,
    }),
  )

const setup = Cli.create('setup', {
  description: 'Onboarding, deployment, resumability, and operator repair workflows.',
})
  .command('start', doc({ description: 'Initialize setup state for the current Origin instance.', output: actionResult }))
  .command('status', doc({ description: 'Get current setup status and next steps.', output: setupStatus }))
  .command('resume', doc({ description: 'Resume the next actionable setup step.', output: actionResult }))
  .command('phases', doc({ description: 'List onboarding phases and their current state.', output: list(setupPhase, 'Setup phases.') }))
  .command(
    Cli.create('phase', { description: 'Inspect and run individual setup phases.' })
      .command(
        'get',
        doc({
          description: 'Get one setup phase by key.',
          args: z.object({ phase: z.string().describe('Setup phase key.') }),
          output: setupPhase,
        }),
      )
      .command(
        'run',
        doc({
          description: 'Run or resume one setup phase explicitly.',
          args: z.object({ phase: z.string().describe('Setup phase key.') }),
          output: actionResult,
        }),
      )
      .command(
        'validate',
        doc({
          description: 'Validate one setup phase.',
          args: z.object({ phase: z.string().describe('Setup phase key.') }),
          output: validationResult,
        }),
      )
      .command(
        'reset',
        doc({
          description: 'Reset one setup phase when recovery requires it.',
          args: z.object({ phase: z.string().describe('Setup phase key.') }),
          output: actionResult,
        }),
      ),
  )
  .command(
    'inputs',
    doc({
      description: 'List persisted onboarding inputs and their sources.',
      output: list(setupInput, 'Setup inputs.'),
    }),
  )
  .command(
    Cli.create('input', { description: 'Manage individual setup inputs.' })
      .command(
        'get',
        doc({
          description: 'Get one setup input by key.',
          args: z.object({ key: z.string().describe('Setup input key.') }),
          output: setupInput,
        }),
      )
      .command(
        'set',
        doc({
          description: 'Set one setup input.',
          args: z.object({ key: z.string().describe('Setup input key.') }),
          options: z.object({
            value: z.unknown().describe('Input value.'),
          }),
          output: actionResult,
        }),
      )
      .command(
        'unset',
        doc({
          description: 'Clear one setup input.',
          args: z.object({ key: z.string().describe('Setup input key.') }),
          output: actionResult,
        }),
      ),
  )
  .command(
    Cli.create('mode', { description: 'Deployment mode controls.' }).command(
      'set',
      doc({
        description: 'Set deployment mode.',
        args: z.object({
          mode: z.enum(['local', 'vps']).describe('Deployment mode.'),
        }),
        output: actionResult,
      }),
    ),
  )
  .command(
    Cli.create('identity', { description: 'Explicit onboarding inputs for owner and agent identity.' })
      .command(
        Cli.create('user', { description: 'Owner identity inputs.' }).command(
          'set',
          doc({
            description: 'Persist the owner identity handles collected during onboarding.',
            options: z.object({
              ['display-name']: z.string().optional().describe('Owner display name.'),
              emails: z.array(z.string()).optional().describe('Owner email addresses.'),
              ['github-username']: z.string().optional().describe('Owner GitHub username.'),
              ['telegram-handle']: z.string().optional().describe('Owner Telegram handle.'),
            }),
            output: actionResult,
          }),
        ),
      )
      .command(
        Cli.create('agent', { description: 'Agent identity inputs.' }).command(
          'set',
          doc({
            description: 'Persist the pre-created agent account identities collected during onboarding.',
            options: z.object({
              ['display-name']: z.string().optional().describe('Agent display name.'),
              google: z.string().optional().describe('Agent Google account email.'),
              github: z.string().optional().describe('Agent GitHub username.'),
              telegram: z.string().optional().describe('Agent Telegram bot username.'),
            }),
            output: actionResult,
          }),
        ),
      ),
  )
  .command(
    Cli.create('provider', { description: 'Provider-specific setup flows.' })
      .command(
        Cli.create('google', { description: 'Google setup inputs.' })
          .command('oauth-start', doc({ description: 'Start Google OAuth during onboarding.', output: oauthStart }))
          .command(
            'oauth-complete',
            doc({
              description:
                'Complete Google OAuth during onboarding using a secure handoff ref from an operator-only browser flow. If an agent Google identity is already stored, the returned Google principal must match it or the command fails.',
              options: z.object({
                ['code-ref']: secureRef.describe(
                  'Secure handoff ref for the Google authorization code returned by the operator-only browser flow.',
                ),
                state: z.string().optional().describe('Provider state token.'),
              }),
              output: actionResult,
            }),
          ),
      )
      .command(
        Cli.create('github', { description: 'GitHub setup inputs.' })
          .command('oauth-start', doc({ description: 'Start the GitHub App user-authorization OAuth flow during onboarding.', output: oauthStart }))
          .command(
            'oauth-complete',
            doc({
              description:
                'Complete GitHub OAuth during onboarding using a secure handoff ref from an operator-only browser flow. This flow produces the GitHub App user access token for the connected agent account. OAuth completion does not by itself make GitHub usable; the selected GitHub App installation grants must also be valid for the intended repo or org scope. If an agent GitHub identity is already stored, the returned GitHub principal must match it or the command fails.',
              options: z.object({
                ['code-ref']: secureRef.describe(
                  'Secure handoff ref for the GitHub authorization code returned by the operator-only browser flow.',
                ),
                state: z.string().optional().describe('Provider state token.'),
              }),
              output: actionResult,
            }),
          ),
      )
      .command(
        Cli.create('telegram', { description: 'Telegram setup inputs.' })
          .command(
            'token-set',
            doc({
              description:
                'Set the pre-created Telegram bot token during onboarding using a secure handoff ref from an operator-only channel. Do not type raw bot tokens into the agent CLI.',
              options: z.object({
                ['token-ref']: secureRef.describe('Secure handoff ref for the Telegram bot token.'),
              }),
              output: actionResult,
            }),
          )
          .command('configure', doc({ description: 'Persist initial Telegram onboarding configuration.', options: z.object({ ['privacy-mode']: z.enum(['enabled', 'disabled', 'unknown']).optional().describe('Observed or operator-expected privacy mode state used for validation.'), ['group-ids']: z.array(z.string()).optional().describe('Initial Telegram groups to register.') }), output: actionResult })),
      ),
  )
  .command(
    Cli.create('vault', { description: 'Managed workspace and vault setup inputs.' })
      .command('init', doc({ description: 'Set or validate the managed workspace root. In v1 the synced vault path is the same root. If the target path is non-empty and this is the first attach, Origin adopts existing markdown files there before any export, adopts an existing `Origin/Memory.md` in place, and leaves non-markdown files local unless explicitly imported later. If replicated note state already exists and the target path is populated, Origin must stop for an explicit reconcile flow that shows managed state and on-disk contents, then requires adopt, keep-current, or replace-target confirmation before any write. Origin must not silently overwrite files.', options: z.object({ path, ['create-if-missing']: z.boolean().default(true).describe('Create the workspace root if it does not exist.') }), output: actionResult }))
      .command('memory-bootstrap', doc({ description: 'Seed Origin/Memory.md with initial user-provided facts or preferences.', options: z.object({ content: markdown.describe('Initial memory content.') }), output: actionResult })),
  )
  .command(
    Cli.create('notification', { description: 'Notification setup inputs.' })
      .command('register-device', doc({ description: 'Register a notification device during onboarding using a secure handoff ref for the device registration token.', options: z.object({ kind: z.enum(['iphone', 'macos']).describe('Device kind.'), ['token-ref']: secureRef.describe('Secure handoff ref for the push device token or registration token.') }), output: actionResult }))
      .command('preferences-set', doc({ description: 'Persist initial notification preferences during onboarding.', options: z.object({ values: z.record(z.string(), z.unknown()).describe('Notification preference payload.') }), output: actionResult })),
  )
  .command(
    Cli.create('deployment', { description: 'VPS deployment planning, execution, and repair.' })
      .command('configure', doc({ description: 'Persist VPS deployment inputs such as host, user, and systemd service parameters.', options: z.object({ host: z.string().optional().describe('VPS host name or IP.'), user: z.string().optional().describe('SSH user or service user.'), ['state-dir']: path.optional().describe('Origin state directory on the host.'), ['service-name']: z.string().optional().describe('Systemd service name.') }), output: actionResult }))
      .command('plan', doc({ description: 'Show the current deployment plan.', output: deploymentPlan }))
      .command('run', doc({ description: 'Run deployment steps.', output: actionResult }))
      .command('status', doc({ description: 'Get deployment status.', output: deploymentStatus }))
      .command('logs', doc({ description: 'Get recent deployment logs.', output: deploymentLog }))
      .command('repair', doc({ description: 'Repair deployment drift or failures.', output: actionResult })),
  )
  .command('validate', doc({ description: 'Run end-to-end setup validation.', output: validationResult }))
  .command(
    'export-summary',
    doc({
      description: 'Export an operator-readable setup summary.',
      output: z.object({
        summary: z.string().describe('Setup export summary.'),
        phases: z.array(setupPhase).describe('Phase states.'),
      }),
    }),
  )

const chat = Cli.create('chat', {
  description: 'Session-based conversations with the Origin agent.',
})
  .command(
    'list',
    doc({
      description: 'List chat sessions.',
      options: z.object({
        archived: z.boolean().default(false).describe('Include archived sessions.'),
        limit: z.number().optional().describe('Maximum session count.'),
      }),
      output: list(chatSession, 'Chat sessions.'),
    }),
  )
  .command(
    'create',
    doc({
      description: 'Create a new chat session.',
      options: z.object({
        title: z.string().optional().describe('Optional session title.'),
        ['seed-context']: z.array(z.string()).optional().describe('Optional entity refs to attach.'),
      }),
      output: actionResult,
    }),
  )
  .command(
    'get',
    doc({
      description: 'Get one chat session, including messages and queue state.',
      args: z.object({ ['session-id']: id('Chat session id.') }),
      output: chatSession,
    }),
  )
  .command(
    'send',
    doc({
      description: 'Send a message into a chat session.',
      args: z.object({ ['session-id']: id('Chat session id.') }),
      options: z.object({
        message: markdown.describe('Message body.'),
        context: z.array(z.string()).optional().describe('Optional entity refs to attach.'),
      }),
      output: actionResult,
    }),
  )
  .command(
    'rename',
    doc({
      description: 'Rename a chat session.',
      args: z.object({ ['session-id']: id('Chat session id.') }),
      options: z.object({
        title: z.string().describe('New session title.'),
      }),
      output: actionResult,
    }),
  )
  .command('archive', doc({ description: 'Archive a chat session.', args: z.object({ ['session-id']: id('Chat session id.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a chat session.', args: z.object({ ['session-id']: id('Chat session id.') }), output: actionResult }))
  .command('outbox', doc({ description: 'List queued offline or retriable chat messages.', output: list(chatOutboxItem, 'Chat outbox items.') }))

const memory = Cli.create('memory', {
  description: 'Curated agent memory centered on Origin/Memory.md.',
})
  .command('get', doc({ description: 'Get Origin/Memory.md with linked artifacts.', output: memoryFile }))
  .command(
    'update',
    doc({
      description: 'Update Origin/Memory.md.',
      options: z.object({
        mode: z.enum(['append', 'replace-section', 'patch']).describe('Revision mode.'),
        content: markdown.describe('Markdown content or patch payload.'),
        section: z.string().optional().describe('Section heading for replace-section mode.'),
      }),
      output: actionResult,
    }),
  )
  .command(
    'add',
    doc({
      description: 'Persist a durable high-signal memory item.',
      options: z.object({
        content: markdown.describe('Memory content to add.'),
        reason: z.string().optional().describe('Why this belongs in durable memory.'),
      }),
      output: actionResult,
      hint: 'Use this only for durable, high-signal memory. One-off output should stay in chat.',
    }),
  )
  .command(
    'search',
    doc({
      description: 'Search Origin memory and linked artifacts only.',
      options: z.object({
        query: z.string().describe('Memory search query.'),
        mode: z.enum(['exact', 'semantic', 'hybrid']).default('hybrid').describe('Search mode.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(searchHit, 'Memory search hits.'),
    }),
  )
  .command(
    'related',
    doc({
      description: 'Return memory entries and artifacts related to a goal or entity.',
      options: z.object({
        goal: z.string().optional().describe('Goal or question to ground the retrieval.'),
        entity: z.string().optional().describe('Optional seed entity id or ref.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: contextPack,
    }),
  )
  .command('history', doc({ description: 'Inspect the edit history of Origin/Memory.md.', output: list(noteRevision, 'Memory revisions.') }))
  .command(
    Cli.create('revision', { description: 'Inspect specific memory revisions.' })
      .command('list', doc({ description: 'List memory revisions.', output: list(noteRevision, 'Memory revisions.') }))
      .command('get', doc({ description: 'Get one memory revision.', args: z.object({ ['revision-id']: id('Revision id.') }), output: noteRevision }))
      .command(
        'diff',
        doc({
          description: 'Compare one memory revision to another or to head.',
          args: z.object({ ['revision-id']: id('Revision id.') }),
          options: z.object({
            against: z.string().optional().describe('Optional comparison revision id.'),
          }),
          output: revisionDiff,
        }),
      ),
  )
  .command('restore', doc({ description: 'Restore Origin/Memory.md to a prior revision.', args: z.object({ ['revision-id']: id('Revision id.') }), output: actionResult }))
  .command('validate', doc({ description: 'Validate memory structure, links, and artifact references.', output: validationResult }))
  .command(
    Cli.create('artifact', { description: 'Supporting memory files and datasets.' })
      .command('list', doc({ description: 'List memory artifacts linked from Origin/Memory.md.', output: list(memoryArtifact, 'Memory artifacts.') }))
      .command(
        'get',
        doc({
          description: 'Get one linked memory artifact.',
          args: z.object({ path }),
          output: memoryArtifact,
        }),
      )
      .command(
        'search',
        doc({
          description: 'Search linked memory artifacts.',
          options: z.object({
            query: z.string().describe('Artifact search query.'),
            limit: z.number().optional().describe('Maximum result count.'),
          }),
          output: list(searchHit, 'Memory artifact search hits.'),
        }),
      )
      .command(
        'create',
        doc({
          description: 'Create a supporting memory artifact and link it from memory. Markdown notes become replicated managed notes; non-note artifacts remain local workspace artifacts unless explicitly imported into managed state later.',
          options: z.object({
            kind: z.enum(['note', 'folder', 'json', 'csv', 'markdown-table']).describe('Artifact kind.'),
            path,
            summary: z.string().optional().describe('Artifact summary.'),
          }),
          output: actionResult,
        }),
      )
      .command(
        'update',
        doc({
          description: 'Update metadata for a memory artifact.',
          args: z.object({ path }),
          options: z.object({
            summary: z.string().optional().describe('Updated artifact summary.'),
          }),
          output: actionResult,
        }),
      )
      .command(
        'move',
        doc({
          description: 'Move a memory artifact and preserve its link from memory.',
          args: z.object({ path }),
          options: z.object({
            to: path.describe('Destination path.'),
          }),
          output: actionResult,
        }),
      )
      .command('delete', doc({ description: 'Delete a memory artifact and unlink it from memory.', args: z.object({ path }), output: actionResult }))
      .command(
        'link',
        doc({
          description: 'Link an existing artifact from Origin/Memory.md. Linking does not by itself import the artifact into replicated managed state.',
          options: z.object({
            path,
            summary: z.string().describe('Artifact summary.'),
          }),
          output: actionResult,
        }),
      )
      .command('unlink', doc({ description: 'Unlink an artifact from Origin/Memory.md without deleting the file.', args: z.object({ path }), output: actionResult }))
      .command('history', doc({ description: 'Inspect revision history for one memory artifact when that artifact has been explicitly imported into replicated managed state.', args: z.object({ path }), output: list(workspaceRevision, 'Artifact revisions.') }))
      .command(
        'restore',
        doc({
          description: 'Restore one memory artifact to a prior revision when that artifact participates in replicated managed state.',
          args: z.object({ path, ['revision-id']: id('Revision id.') }),
          output: actionResult,
        }),
      ),
  )

const workspace = Cli.create('workspace', {
  description: 'Managed assistant workspace and vault-level operations.',
})
  .command('status', doc({ description: 'Inspect workspace, index, and bridge status.', output: workspaceStatus }))
  .command(
    'tree',
    doc({
      description: 'List the current managed workspace tree.',
      options: z.object({
        path: path.optional().describe('Optional path under the workspace root.'),
        depth: z.number().optional().describe('Maximum tree depth.'),
      }),
      output: list(workspaceEntry, 'Workspace tree entries.'),
    }),
  )
  .command(
    'recent',
    doc({
      description: 'List recently touched workspace entries.',
      options: z.object({
        since: isoDateTime.optional().describe('Lower time bound.'),
        until: isoDateTime.optional().describe('Upper time bound.'),
        limit: z.number().optional().describe('Maximum entry count.'),
      }),
      output: list(workspaceEntry, 'Recent workspace entries.'),
    }),
  )
  .command(
    'search',
    doc({
      description: 'Search within the managed workspace only.',
      options: z.object({
        query: z.string().describe('Workspace search query.'),
        mode: z.enum(['exact', 'semantic', 'hybrid']).default('hybrid').describe('Search mode.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(searchHit, 'Workspace search hits.'),
    }),
  )
  .command(
    'resolve',
    doc({
      description: 'Resolve a workspace path or fuzzy file reference inside the managed workspace.',
      options: z.object({
        query: z.string().describe('Workspace path, title, or fuzzy reference.'),
      }),
      output: list(workspaceEntry, 'Workspace resolution candidates.'),
    }),
  )
  .command('stat', doc({ description: 'Inspect one managed workspace path.', args: z.object({ path }), output: workspaceEntry }))
  .command('read', doc({ description: 'Read one managed workspace file.', args: z.object({ path }), output: fileReadResult }))
  .command('write', doc({ description: 'Write one managed workspace file.', args: z.object({ path }), options: z.object({ content: z.string().describe('File content.') }), output: actionResult }))
  .command('patch', doc({ description: 'Patch a managed workspace text file.', args: z.object({ path }), options: z.object({ patch: z.string().describe('Patch payload.') }), output: actionResult }))
  .command('mkdir', doc({ description: 'Create a managed workspace directory.', args: z.object({ path }), output: actionResult }))
  .command('move', doc({ description: 'Move or rename a managed workspace path.', args: z.object({ path }), options: z.object({ to: path.describe('Destination path.') }), output: actionResult }))
  .command('copy', doc({ description: 'Copy a managed workspace path.', args: z.object({ path }), options: z.object({ to: path.describe('Destination path.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a managed workspace path.', args: z.object({ path }), output: actionResult }))
  .command(
    'history',
    doc({
      description: 'Inspect workspace revision history for one managed path that participates in replicated managed state, such as a note or explicitly imported managed attachment.',
      args: z.object({ path }),
      output: list(workspaceRevision, 'Workspace revisions.'),
    }),
  )
  .command(
    Cli.create('revision', { description: 'Inspect specific workspace revisions.' })
      .command('list', doc({ description: 'List revisions for one managed path that participates in replicated managed state.', args: z.object({ path }), output: list(workspaceRevision, 'Workspace revisions.') }))
      .command('get', doc({ description: 'Get one workspace revision.', args: z.object({ ['revision-id']: id('Revision id.') }), output: workspaceRevision }))
      .command(
        'diff',
        doc({
          description: 'Compare one workspace revision to another or to head.',
          args: z.object({ ['revision-id']: id('Revision id.') }),
          options: z.object({
            against: z.string().optional().describe('Optional comparison revision id.'),
          }),
          output: revisionDiff,
        }),
      ),
  )
  .command('reindex', doc({ description: 'Reindex the workspace and derived retrieval data.', output: actionResult }))
  .command(
    Cli.create('bridge', { description: 'Workspace import/export bridge state.' })
      .command('status', doc({ description: 'Inspect the managed workspace bridge status.', output: workspaceStatus }))
      .command('scan', doc({ description: 'Scan bridged note files and explicitly managed attachment paths for external changes that Origin can import in v1.', output: actionResult }))
      .command('import', doc({ description: 'Import detected note-file edits and explicit managed-attachment replacements into replicated managed state.', output: actionResult }))
      .command('export', doc({ description: 'Materialize replicated managed notes and explicitly managed attachments back into workspace files.', output: actionResult }))
      .command('reconcile', doc({ description: 'Run a full bridge reconcile pass for replicated managed note content and explicitly managed attachments.', output: actionResult })),
  )
  .command(
    Cli.create('conflict', { description: 'Inspect and resolve workspace bridge conflicts.' })
      .command('list', doc({ description: 'List workspace conflicts.', output: list(workspaceConflict, 'Workspace conflicts.') }))
      .command('get', doc({ description: 'Get one workspace conflict with competing revisions and explicit resolution candidates.', args: z.object({ ['conflict-id']: id('Conflict id.') }), output: workspaceConflictDetail }))
      .command(
        'resolve',
        doc({
          description: 'Resolve a workspace conflict by selecting an explicit candidate or providing merged or replacement content.',
          args: z.object({ ['conflict-id']: id('Conflict id.') }),
          options: contentResolutionOptions(
            'Merged or replacement workspace content. Required for merge and replace resolutions.',
          ),
          output: actionResult,
        }),
      ),
  )

const noteCli = Cli.create('note', {
  description: 'Replicated note operations over the managed markdown workspace.',
})
  .command(
    'list',
    doc({
      description: 'List managed notes.',
      options: z.object({
        query: z.string().optional().describe('Free-text search query.'),
        folder: path.optional().describe('Optional folder filter.'),
        limit: z.number().optional().describe('Maximum note count.'),
      }),
      output: list(noteSummary, 'Managed notes.'),
    }),
  )
  .command('get', doc({ description: 'Get one managed note.', args: z.object({ ['note-id']: id('Note id.') }), output: note }))
  .command(
    'get-by-path',
    doc({
      description: 'Resolve and get one managed note by workspace path.',
      args: z.object({ path }),
      output: note,
    }),
  )
  .command(
    'create',
    doc({
      description: 'Create a managed note.',
      options: z.object({
        path,
        title: z.string().optional().describe('Optional note title.'),
        content: markdown.describe('Initial markdown content.'),
      }),
      output: actionResult,
    }),
  )
  .command(
    'update',
    doc({
      description: 'Update a managed note.',
      args: z.object({ ['note-id']: id('Note id.') }),
      options: z.object({
        content: markdown.describe('Replacement or patch content.'),
        mode: z.enum(['replace', 'append', 'patch']).default('patch').describe('Update mode.'),
      }),
      output: actionResult,
    }),
  )
  .command('move', doc({ description: 'Move a note to a new workspace path.', args: z.object({ ['note-id']: id('Note id.') }), options: z.object({ path }), output: actionResult }))
  .command('rename', doc({ description: 'Rename a note file.', args: z.object({ ['note-id']: id('Note id.') }), options: z.object({ name: z.string().describe('New file name.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a note.', args: z.object({ ['note-id']: id('Note id.') }), output: actionResult }))
  .command(
    'search',
    doc({
      description: 'Search note content and metadata.',
      options: z.object({
        query: z.string().describe('Note search query.'),
        mode: z.enum(['exact', 'semantic', 'hybrid']).default('hybrid').describe('Search mode.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(searchHit, 'Matching note search hits.'),
    }),
  )
  .command('related', doc({ description: 'List notes related to a note or any other entity.', args: z.object({ entity: id('Entity id or ref.') }), output: list(noteSummary, 'Related notes.') }))
  .command('backlinks', doc({ description: 'List notes that link back to a note.', args: z.object({ ['note-id']: id('Note id.') }), output: list(noteSummary, 'Backlink notes.') }))
  .command(
    'history',
    doc({
      description: 'Inspect preserved note history.',
      args: z.object({ ['note-id']: id('Note id.') }),
      options: z.object({
        since: isoDateTime.optional().describe('Lower time bound.'),
        until: isoDateTime.optional().describe('Upper time bound.'),
      }),
      output: list(noteHistoryEntry, 'Note history entries.'),
    }),
  )
  .command(
    Cli.create('revision', { description: 'Inspect specific note revisions.' })
      .command('list', doc({ description: 'List revisions for one note.', args: z.object({ ['note-id']: id('Note id.') }), output: list(noteRevision, 'Note revisions.') }))
      .command('get', doc({ description: 'Get one note revision.', args: z.object({ ['revision-id']: id('Revision id.') }), output: noteRevision }))
      .command(
        'diff',
        doc({
          description: 'Compare one note revision to another or to head.',
          args: z.object({ ['revision-id']: id('Revision id.') }),
          options: z.object({
            against: z.string().optional().describe('Optional comparison revision id.'),
          }),
          output: revisionDiff,
        }),
      ),
  )
  .command('restore', doc({ description: 'Restore a note to a prior revision.', args: z.object({ ['note-id']: id('Note id.'), ['revision-id']: id('Revision id.') }), output: actionResult }))
  .command(
    Cli.create('conflict', { description: 'Inspect and resolve note conflicts.' })
      .command('list', doc({ description: 'List note conflicts.', options: z.object({ limit: z.number().optional().describe('Maximum conflict count.') }), output: list(noteConflict, 'Note conflicts.') }))
      .command('get', doc({ description: 'Get one note conflict.', args: z.object({ ['conflict-id']: id('Conflict id.') }), output: noteConflictDetail }))
      .command(
        'resolve',
        doc({
          description: 'Resolve a note conflict by selecting an explicit candidate or by providing merged or replacement note content.',
          args: z.object({ ['conflict-id']: id('Conflict id.') }),
          options: contentResolutionOptions(
            'Merged or replacement note content. Required for merge and replace resolutions.',
          ),
          output: actionResult,
        }),
      ),
  )
  .command(
    Cli.create('attachment', { description: 'Managed note attachments.' })
      .command('list', doc({ description: 'List attachments linked to a note.', args: z.object({ ['note-id']: id('Note id.') }), output: list(noteAttachment, 'Note attachments.') }))
      .command(
        'add',
        doc({
          description: 'Attach a file to a note. If the path is outside the managed vault, Origin imports a managed copy into the vault before linking it.',
          args: z.object({ ['note-id']: id('Note id.') }),
          options: z.object({
            path,
          }),
          output: actionResult,
        }),
      )
      .command(
        'remove',
        doc({
          description: 'Remove a linked attachment from a note.',
          args: z.object({ ['note-id']: id('Note id.'), ['attachment-id']: id('Attachment id.') }),
          output: actionResult,
        }),
      ),
  )

const file = Cli.create('file', {
  description: 'Direct host filesystem operations for paths Origin can access.',
})
  .command('list', doc({ description: 'List files and folders under a host path.', args: z.object({ path }), options: z.object({ depth: z.number().optional().describe('Maximum recursion depth.') }), output: list(fileEntry, 'Filesystem entries.') }))
  .command('stat', doc({ description: 'Inspect one filesystem path.', args: z.object({ path }), output: fileEntry }))
  .command('read', doc({ description: 'Read a host file.', args: z.object({ path }), options: z.object({ encoding: z.enum(['utf8', 'base64', 'binary']).default('utf8').describe('Read encoding.') }), output: fileReadResult }))
  .command('write', doc({ description: 'Write a host file.', args: z.object({ path }), options: z.object({ content: z.string().describe('File content.'), encoding: z.enum(['utf8', 'base64']).default('utf8').describe('Write encoding.') }), output: actionResult }))
  .command('patch', doc({ description: 'Patch a host text file.', args: z.object({ path }), options: z.object({ patch: z.string().describe('Patch payload.') }), output: actionResult }))
  .command('mkdir', doc({ description: 'Create a host directory.', args: z.object({ path }), output: actionResult }))
  .command('move', doc({ description: 'Move or rename a host path.', args: z.object({ path }), options: z.object({ to: path.describe('Destination path.') }), output: actionResult }))
  .command('copy', doc({ description: 'Copy a host path.', args: z.object({ path }), options: z.object({ to: path.describe('Destination path.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a host path.', args: z.object({ path }), output: actionResult }))
  .command(
    'search',
    doc({
      description: 'Search file names or content under a host path.',
      args: z.object({ path }),
      options: z.object({
        query: z.string().describe('Search query.'),
        content: z.boolean().default(true).describe('Search content instead of names only.'),
        limit: z.number().optional().describe('Maximum result count.'),
      }),
      output: list(fileSearchResult, 'File search results.'),
    }),
  )
  .command(
    'glob',
    doc({
      description: 'Expand a glob pattern under a host path.',
      args: z.object({ path }),
      options: z.object({
        pattern: z.string().describe('Glob pattern.'),
        limit: z.number().optional().describe('Maximum match count.'),
      }),
      output: list(fileEntry, 'Glob matches.'),
    }),
  )
  .command(
    'tail',
    doc({
      description: 'Tail a host text file.',
      args: z.object({ path }),
      options: z.object({
        lines: z.number().default(100).describe('Line count to tail.'),
      }),
      output: fileReadResult,
    }),
  )

const planning = Cli.create('planning', {
  description: 'Canonical planning domain for projects, labels, tasks, calendar items, and Google bridges.',
})
  .command(
    'today',
    doc({
      description: 'Show the planning view for one day.',
      options: z.object({ date: isoDate.optional().describe('Optional explicit day override.') }),
      output: planningDayView,
      examples: [{ options: { date: '2026-04-06' } }],
    }),
  )
  .command('week', doc({ description: 'Show the planning view for one week.', options: z.object({ ['week-start']: isoDate.optional().describe('Explicit week start date.') }), output: planningWeekView }))
  .command('agenda', doc({ description: 'Show the agenda centered on calendar items and linked tasks.', options: z.object({ date: isoDate.optional().describe('Optional agenda day.') }), output: agendaView }))
  .command('window', doc({ description: 'Show the planning view over an explicit date window.', options: z.object({ from: isoDate.describe('Inclusive lower bound.'), to: isoDate.describe('Inclusive upper bound.') }), output: planningWindowView }))
  .command('inbox', doc({ description: 'List planning items that need sorting, scheduling, or clarification.', output: list(task, 'Planning inbox tasks.') }))
  .command('upcoming', doc({ description: 'List upcoming tasks and calendar items that need near-term attention.', output: planningWindowView }))
  .command('overdue', doc({ description: 'List overdue tasks and stale scheduled items.', output: list(task, 'Overdue tasks.') }))
  .command('backlog', doc({ description: 'List unscheduled or backlog tasks for planning work.', options: z.object({ query: z.string().optional().describe('Optional filter query.'), limit: z.number().optional().describe('Maximum task count.') }), output: list(task, 'Backlog tasks.') }))
  .command('board', doc({ description: 'Show the planning board grouped by task status.', output: planningBoardView }))
  .command('recurring', doc({ description: 'List recurring tasks and calendar series roots.', output: z.object({ tasks: z.array(task).describe('Recurring task roots.'), ['calendar-items']: z.array(calendarItem).describe('Recurring calendar roots.') }) }))
  .command('task-graph', doc({ description: 'Show task dependency structure across the planning domain.', output: taskGraphView }))

const projectCli = Cli.create('project', {
  description: 'Project CRUD within the planning domain.',
})
  .command('list', doc({ description: 'List projects.', options: z.object({ status: z.array(z.string()).optional().describe('Optional status filter.'), limit: z.number().optional().describe('Maximum project count.') }), output: list(project, 'Projects.') }))
  .command('get', doc({ description: 'Get one project.', args: z.object({ ['project-id']: id('Project id.') }), output: project }))
  .command('search', doc({ description: 'Search projects by name or description.', options: z.object({ query: z.string().describe('Project search query.'), limit: z.number().optional().describe('Maximum project count.') }), output: list(project, 'Matching projects.') }))
  .command('create', doc({ description: 'Create a project.', options: z.object({ name: z.string().describe('Project name.'), description: markdown.optional().describe('Project description.') }), output: actionResult }))
  .command('update', doc({ description: 'Update a project.', args: z.object({ ['project-id']: id('Project id.') }), options: z.object({ name: z.string().optional().describe('New project name.'), status: z.string().optional().describe('New project status.'), description: markdown.optional().describe('New description.') }), output: actionResult }))
  .command('archive', doc({ description: 'Archive a project.', args: z.object({ ['project-id']: id('Project id.') }), output: actionResult }))
  .command('unarchive', doc({ description: 'Unarchive a project.', args: z.object({ ['project-id']: id('Project id.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a project.', args: z.object({ ['project-id']: id('Project id.') }), output: actionResult }))
  .command('history', doc({ description: 'Inspect project history.', args: z.object({ ['project-id']: id('Project id.') }), output: list(entityHistoryEntry, 'Project history entries.') }))
  .command('restore', doc({ description: 'Restore a project to a prior revision.', args: z.object({ ['project-id']: id('Project id.'), ['revision-id']: id('Revision id.') }), output: actionResult }))

const labelCli = Cli.create('label', {
  description: 'Label CRUD within the planning domain.',
})
  .command('list', doc({ description: 'List labels.', options: z.object({ limit: z.number().optional().describe('Maximum label count.') }), output: list(label, 'Labels.') }))
  .command('get', doc({ description: 'Get one label.', args: z.object({ ['label-id']: id('Label id.') }), output: label }))
  .command('search', doc({ description: 'Search labels by name or description.', options: z.object({ query: z.string().describe('Label search query.'), limit: z.number().optional().describe('Maximum label count.') }), output: list(label, 'Matching labels.') }))
  .command('create', doc({ description: 'Create a label.', options: z.object({ name: z.string().describe('Label name.'), color: z.string().optional().describe('Optional color.') }), output: actionResult }))
  .command('update', doc({ description: 'Update a label.', args: z.object({ ['label-id']: id('Label id.') }), options: z.object({ name: z.string().optional().describe('New label name.'), color: z.string().optional().describe('New color.') }), output: actionResult }))
  .command('archive', doc({ description: 'Archive a label.', args: z.object({ ['label-id']: id('Label id.') }), output: actionResult }))
  .command('unarchive', doc({ description: 'Unarchive a label.', args: z.object({ ['label-id']: id('Label id.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a label.', args: z.object({ ['label-id']: id('Label id.') }), output: actionResult }))
  .command('history', doc({ description: 'Inspect label history.', args: z.object({ ['label-id']: id('Label id.') }), output: list(entityHistoryEntry, 'Label history entries.') }))
  .command('restore', doc({ description: 'Restore a label to a prior revision.', args: z.object({ ['label-id']: id('Label id.'), ['revision-id']: id('Revision id.') }), output: actionResult }))

const taskCli = Cli.create('task', {
  description: 'First-party task commands.',
})
  .command('list', doc({ description: 'List tasks.', options: z.object({ status: z.array(z.string()).optional().describe('Task status filter.'), project: z.array(z.string()).optional().describe('Project id filter.'), label: z.array(z.string()).optional().describe('Label id filter.'), due: z.enum(['today', 'overdue', 'upcoming', 'none']).optional().describe('Due-window filter.'), ['linked-calendar-item']: z.string().optional().describe('Optional linked calendar item id.'), ['google-tasks-synced']: z.boolean().optional().describe('Only tasks attached to Google Tasks.'), limit: z.number().optional().describe('Maximum task count.') }), output: list(task, 'Tasks.') }))
  .command('get', doc({ description: 'Get one task.', args: z.object({ ['task-id']: id('Task id.') }), output: task }))
  .command('search', doc({ description: 'Search tasks by title, description, metadata, or semantic relevance.', options: z.object({ query: z.string().describe('Task search query.'), mode: z.enum(['exact', 'semantic', 'hybrid']).default('hybrid').describe('Search mode.'), limit: z.number().optional().describe('Maximum task count.') }), output: list(task, 'Matching tasks.') }))
  .command('related', doc({ description: 'List entities related to a task.', args: z.object({ ['task-id']: id('Task id.') }), output: list(originEntity, 'Related entities.') }))
  .command('create', doc({ description: 'Create a task.', options: z.object({ title: z.string().describe('Task title.'), ['description-md']: markdown.optional().describe('Task description markdown.'), project: z.string().optional().describe('Project id.'), labels: z.array(z.string()).optional().describe('Label ids.'), priority: z.string().optional().describe('Priority.'), ['due-kind']: z.enum(['date', 'datetime']).optional().describe('Due-kind semantics.'), ['due-from']: z.string().optional().describe('Due window start.'), ['due-at']: z.string().optional().describe('Due window end.'), ['due-timezone']: z.string().optional().describe('Due window timezone.'), ['blocked-by']: z.array(z.string()).optional().describe('Initial blocking task ids.') }), output: actionResult }))
  .command('update', doc({ description: 'Update a task.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ title: z.string().optional().describe('New title.'), ['description-md']: markdown.optional().describe('New description.'), status: z.string().optional().describe('New status.'), priority: z.string().optional().describe('New priority.') }), output: actionResult }))
  .command('complete', doc({ description: 'Mark a task done.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult }))
  .command('reopen', doc({ description: 'Reopen a completed or canceled task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult }))
  .command('cancel', doc({ description: 'Cancel a task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult }))
  .command('archive', doc({ description: 'Archive a task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult }))
  .command('unarchive', doc({ description: 'Unarchive a task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult }))
  .command('history', doc({ description: 'Inspect task history.', args: z.object({ ['task-id']: id('Task id.') }), output: list(entityHistoryEntry, 'Task history entries.') }))
  .command('restore', doc({ description: 'Restore a task to a prior revision.', args: z.object({ ['task-id']: id('Task id.'), ['revision-id']: id('Revision id.') }), output: actionResult }))
  .command(
    Cli.create('revision', { description: 'Inspect specific task revisions.' })
      .command('list', doc({ description: 'List task revisions.', args: z.object({ ['task-id']: id('Task id.') }), output: list(entityHistoryEntry, 'Task revisions.') }))
      .command('get', doc({ description: 'Get one task revision.', args: z.object({ ['revision-id']: id('Revision id.') }), output: entityHistoryEntry }))
      .command('diff', doc({ description: 'Compare one task revision to another or to head.', args: z.object({ ['revision-id']: id('Revision id.') }), options: z.object({ against: z.string().optional().describe('Optional comparison revision id.') }), output: revisionDiff })),
  )
  .command(
    Cli.create('project', { description: 'Task project linkage.' })
      .command('set', doc({ description: 'Set the project for a task.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['project-id']: z.string().describe('Project id.') }), output: actionResult }))
      .command('clear', doc({ description: 'Clear the project for a task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult })),
  )
  .command(
    Cli.create('label', { description: 'Task label linkage.' })
      .command('add', doc({ description: 'Add labels to a task.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ labels: z.array(z.string()).describe('Label ids.') }), output: actionResult }))
      .command('remove', doc({ description: 'Remove labels from a task.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ labels: z.array(z.string()).describe('Label ids.') }), output: actionResult }))
      .command('clear', doc({ description: 'Clear all labels from a task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult })),
  )
  .command(
    Cli.create('note', { description: 'Task note linkage.' })
      .command('link', doc({ description: 'Link a task to a note.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['note-id']: z.string().describe('Note id.') }), output: actionResult }))
      .command('unlink', doc({ description: 'Unlink a task from a note.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['note-id']: z.string().describe('Note id.') }), output: actionResult })),
  )
  .command(
    Cli.create('dependency', { description: 'Task dependency edges.' })
      .command('list', doc({ description: 'List blocking task edges for a task.', args: z.object({ ['task-id']: id('Task id.') }), output: list(task, 'Blocking tasks.') }))
      .command('add', doc({ description: 'Add blocking task edges.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['blocked-by']: z.array(z.string()).describe('Blocking task ids.') }), output: actionResult }))
      .command('remove', doc({ description: 'Remove blocking task edges.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['blocked-by']: z.array(z.string()).describe('Blocking task ids to remove.') }), output: actionResult }))
      .command('clear', doc({ description: 'Clear all blocking edges for a task.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult })),
  )
  .command(
    Cli.create('due', { description: 'Task due-window controls.' })
      .command('set', doc({ description: 'Set a task due window.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['due-kind']: z.enum(['date', 'datetime']).describe('Due-kind semantics.'), ['due-from']: z.string().optional().describe('Due window start.'), ['due-at']: z.string().optional().describe('Due window end.'), ['due-timezone']: z.string().optional().describe('Due timezone.') }), output: actionResult }))
      .command('clear', doc({ description: 'Clear a task due window.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult })),
  )
  .command(
    Cli.create('schedule', { description: 'Task scheduling via linked calendar items.' })
      .command('set', doc({ description: 'Create or update a linked calendar item for a task.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['calendar-item-id']: z.string().optional().describe('Existing linked calendar item to reuse.'), ['start-at']: isoDateTime.optional().describe('Scheduled start time.'), ['end-at']: isoDateTime.optional().describe('Scheduled end time.'), ['start-date']: isoDate.optional().describe('All-day start date.'), ['end-date-exclusive']: isoDate.optional().describe('All-day end date.') }), output: actionResult, hint: 'This changes Origin planning state first. Provider sync happens through planning google-calendar or planning google-tasks bridges.' }))
      .command('clear', doc({ description: 'Detach one or all linked calendar items from a task.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['calendar-item-id']: z.string().optional().describe('Specific linked calendar item to detach.') }), output: actionResult })),
  )
  .command(
    Cli.create('recurrence', { description: 'Recurring-task series controls.' })
      .command('set', doc({ description: 'Set recurrence on a task series root. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['task-id']: id('Task series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), options: z.object({ frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('Recurrence frequency.'), interval: z.number().optional().describe('Optional recurrence interval.'), ['by-weekday']: z.array(z.string()).optional().describe('Weekly weekday filters.'), ['by-month-day']: z.array(z.number()).optional().describe('Monthly day filters.'), timezone: z.string().optional().describe('Recurrence timezone.'), ['advance-mode']: z.enum(['on_completion', 'on_schedule']).optional().describe('How the task series advances after the root or later occurrences are scheduled or completed.') }), output: actionResult }))
      .command('clear', doc({ description: 'Remove recurrence metadata from a task series root. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['task-id']: id('Task series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), output: actionResult }))
      .command('preview', doc({ description: 'Preview upcoming task occurrences projected from a task series root without mutating state. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['task-id']: id('Task series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), options: z.object({ count: z.number().default(10).describe('Occurrence count to preview.') }), output: list(task, 'Preview task occurrences.') }))
      .command('occurrences', doc({ description: 'List materialized recurring task occurrences and explicit exceptions for a task series root. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['task-id']: id('Task series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), options: z.object({ from: isoDate.optional().describe('Inclusive lower bound.'), to: isoDate.optional().describe('Inclusive upper bound.'), limit: z.number().optional().describe('Maximum occurrence count.') }), output: list(task, 'Recurring task occurrences.') })),
  )
  .command(
    Cli.create('conflict', { description: 'Inspect and resolve task conflicts.' })
      .command('list', doc({ description: 'List task conflicts.', output: list(syncConflict, 'Task conflicts.') }))
      .command('get', doc({ description: 'Get one task conflict.', args: z.object({ ['conflict-id']: id('Conflict id.') }), output: syncConflictDetail }))
      .command('resolve', doc({ description: 'Resolve a task conflict by selecting an explicit candidate or by providing merged or replacement structured payload.', args: z.object({ ['conflict-id']: id('Conflict id.') }), options: payloadResolutionOptions('Merged or replacement task payload. Required for merge and replace resolutions.'), output: actionResult })),
  )

const calendarItemCli = Cli.create('calendar-item', {
  description: 'First-party calendar item commands.',
})
  .command('list', doc({ description: 'List calendar items.', options: z.object({ kind: z.array(z.string()).optional().describe('Kind filter.'), ['date-from']: isoDate.optional().describe('Lower day bound.'), ['date-to']: isoDate.optional().describe('Upper day bound.'), limit: z.number().optional().describe('Maximum item count.') }), output: list(calendarItem, 'Calendar items.') }))
  .command('get', doc({ description: 'Get one calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: calendarItem }))
  .command('search', doc({ description: 'Search calendar items.', options: z.object({ query: z.string().describe('Calendar-item search query.'), mode: z.enum(['exact', 'semantic', 'hybrid']).default('hybrid').describe('Search mode.'), limit: z.number().optional().describe('Maximum item count.') }), output: list(calendarItem, 'Matching calendar items.') }))
  .command('related', doc({ description: 'List entities related to a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: list(originEntity, 'Related entities.') }))
  .command('create', doc({ description: 'Create a calendar item.', options: z.object({ title: z.string().describe('Calendar title.'), kind: z.string().optional().describe('Item kind.'), ['project-id']: z.string().optional().describe('Linked project id.'), labels: z.array(z.string()).optional().describe('Label ids.'), ['description-md']: markdown.optional().describe('Calendar item description.'), ['task-id']: z.array(z.string()).optional().describe('Linked task ids.'), ['all-day']: z.boolean().default(false).describe('Whether the item is all-day.'), ['start-date']: isoDate.optional().describe('All-day start date.'), ['end-date-exclusive']: isoDate.optional().describe('All-day exclusive end date.'), ['start-at']: isoDateTime.optional().describe('Timed start.'), ['end-at']: isoDateTime.optional().describe('Timed end.'), timezone: z.string().optional().describe('Item timezone.'), location: z.string().optional().describe('Location.') }), output: actionResult }))
  .command('update', doc({ description: 'Update a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), options: z.object({ title: z.string().optional().describe('New title.'), kind: z.string().optional().describe('New kind.'), status: z.string().optional().describe('New status.'), ['description-md']: markdown.optional().describe('New description.'), location: z.string().optional().describe('New location.'), ['all-day']: z.boolean().optional().describe('Whether the item is all-day.'), ['start-date']: isoDate.optional().describe('All-day start date.'), ['end-date-exclusive']: isoDate.optional().describe('All-day exclusive end date.'), ['start-at']: isoDateTime.optional().describe('Timed start.'), ['end-at']: isoDateTime.optional().describe('Timed end.'), timezone: z.string().optional().describe('Item timezone.') }), output: actionResult }))
  .command('move', doc({ description: 'Reschedule a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), options: z.object({ ['all-day']: z.boolean().optional().describe('Whether the moved item is all-day.'), ['start-date']: isoDate.optional().describe('All-day start date.'), ['end-date-exclusive']: isoDate.optional().describe('All-day exclusive end date.'), ['start-at']: isoDateTime.optional().describe('Timed start.'), ['end-at']: isoDateTime.optional().describe('Timed end.'), timezone: z.string().optional().describe('Item timezone.') }), output: actionResult }))
  .command('confirm', doc({ description: 'Mark a calendar item confirmed.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: actionResult }))
  .command('cancel', doc({ description: 'Cancel a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: actionResult }))
  .command('archive', doc({ description: 'Archive a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: actionResult }))
  .command('unarchive', doc({ description: 'Unarchive a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: actionResult }))
  .command('history', doc({ description: 'Inspect calendar-item history.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: list(entityHistoryEntry, 'Calendar-item history entries.') }))
  .command('restore', doc({ description: 'Restore a calendar item to a prior revision.', args: z.object({ ['calendar-item-id']: id('Calendar item id.'), ['revision-id']: id('Revision id.') }), output: actionResult }))
  .command(
    Cli.create('revision', { description: 'Inspect specific calendar-item revisions.' })
      .command('list', doc({ description: 'List calendar-item revisions.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: list(entityHistoryEntry, 'Calendar-item revisions.') }))
      .command('get', doc({ description: 'Get one calendar-item revision.', args: z.object({ ['revision-id']: id('Revision id.') }), output: entityHistoryEntry }))
      .command('diff', doc({ description: 'Compare one calendar-item revision to another or to head.', args: z.object({ ['revision-id']: id('Revision id.') }), options: z.object({ against: z.string().optional().describe('Optional comparison revision id.') }), output: revisionDiff })),
  )
  .command(
    Cli.create('label', { description: 'Calendar-item label linkage.' })
      .command('add', doc({ description: 'Add labels to a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), options: z.object({ labels: z.array(z.string()).describe('Label ids.') }), output: actionResult }))
      .command('remove', doc({ description: 'Remove labels from a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), options: z.object({ labels: z.array(z.string()).describe('Label ids.') }), output: actionResult }))
      .command('clear', doc({ description: 'Clear all labels from a calendar item.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: actionResult })),
  )
  .command(
    Cli.create('task', { description: 'Calendar-item task linkage.' })
      .command('link', doc({ description: 'Link a calendar item to a task.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), options: z.object({ ['task-id']: z.string().describe('Task id.') }), output: actionResult }))
      .command('unlink', doc({ description: 'Unlink a calendar item from a task.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), options: z.object({ ['task-id']: z.string().describe('Task id.') }), output: actionResult })),
  )
  .command(
    Cli.create('recurrence', { description: 'Recurring calendar-series controls.' })
      .command('set', doc({ description: 'Set recurrence on a calendar series root. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['calendar-item-id']: id('Calendar series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), options: z.object({ frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('Recurrence frequency.'), interval: z.number().optional().describe('Optional recurrence interval.'), ['by-weekday']: z.array(z.string()).optional().describe('Weekly weekday filters.'), ['by-month-day']: z.array(z.number()).optional().describe('Monthly day filters.'), timezone: z.string().optional().describe('Recurrence timezone.') }), output: actionResult }))
      .command('clear', doc({ description: 'Remove recurrence metadata from a calendar series root. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['calendar-item-id']: id('Calendar series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), output: actionResult }))
      .command('preview', doc({ description: 'Preview upcoming calendar occurrences projected from a calendar series root without mutating state. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['calendar-item-id']: id('Calendar series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), options: z.object({ count: z.number().default(10).describe('Occurrence count to preview.') }), output: list(calendarItem, 'Preview calendar occurrences.') }))
      .command('occurrences', doc({ description: 'List materialized recurring calendar occurrences and explicit exceptions for a calendar series root. The series root is the occurrence whose `occurrence-index` is `0`.', args: z.object({ ['calendar-item-id']: id('Calendar series root id. The series root is the occurrence whose `occurrence-index` is `0`.') }), options: z.object({ from: isoDate.optional().describe('Inclusive lower bound.'), to: isoDate.optional().describe('Inclusive upper bound.'), limit: z.number().optional().describe('Maximum occurrence count.') }), output: list(calendarItem, 'Recurring calendar occurrences.') })),
  )
  .command(
    Cli.create('conflict', { description: 'Inspect and resolve calendar-item conflicts.' })
      .command('list', doc({ description: 'List calendar-item conflicts.', output: list(syncConflict, 'Calendar-item conflicts.') }))
      .command('get', doc({ description: 'Get one calendar-item conflict.', args: z.object({ ['conflict-id']: id('Conflict id.') }), output: syncConflictDetail }))
      .command('resolve', doc({ description: 'Resolve a calendar-item conflict by selecting an explicit candidate or by providing merged or replacement structured payload.', args: z.object({ ['conflict-id']: id('Conflict id.') }), options: payloadResolutionOptions('Merged or replacement calendar-item payload. Required for merge and replace resolutions.'), output: actionResult })),
  )

const googleCalendarCli = Cli.create('google-calendar', {
  description: 'Google Calendar bridge for Origin calendar items.',
})
  .command('status', doc({ description: 'Inspect Google Calendar bridge status, selected calendars, and per-surface pollers.', output: googleCalendarBridgeStatus }))
  .command(
    Cli.create('surface', { description: 'Google Calendar bridge-surface selection.' })
      .command('list', doc({ description: 'List discoverable Google calendars and whether they are selected bridge surfaces.', output: list(googleCalendarSurfaceStatus, 'Google Calendar surfaces.') }))
      .command('get', doc({ description: 'Get one Google Calendar bridge surface.', args: z.object({ ['calendar-id']: z.string().describe('Google calendar id.') }), output: googleCalendarSurfaceStatus }))
      .command('select', doc({ description: 'Select a Google calendar as a bridge surface. This creates or repairs the server-owned poller scope for that calendar but does not attach any specific Origin item.', args: z.object({ ['calendar-id']: z.string().describe('Google calendar id.') }), output: actionResult }))
      .command('deselect', doc({ description: 'Deselect a Google calendar bridge surface. If Origin items are still attached to that calendar, the command must refuse unless `force-detach` is true; with `force-detach`, those local links transition to `detached` and the remote Google events are left untouched.', args: z.object({ ['calendar-id']: z.string().describe('Google calendar id.') }), options: z.object({ ['force-detach']: z.boolean().default(false).describe('Detach local links that still target this calendar before deselecting it.') }), output: actionResult })),
  )
  .command('pull', doc({ description: 'Import changes from Google Calendar into Origin calendar items.', options: z.object({ ['calendar-id']: z.string().optional().describe('Optional Google calendar id filter.') }), output: actionResult }))
  .command('push', doc({ description: 'Push Origin calendar-item changes to Google Calendar.', options: z.object({ ['calendar-id']: z.string().optional().describe('Optional Google calendar id filter.') }), output: actionResult }))
  .command('reconcile', doc({ description: 'Reconcile Origin calendar items with Google Calendar state. Remote deletions must surface as detached-preserved local objects for review rather than silently deleting local state.', options: z.object({ ['calendar-id']: z.string().optional().describe('Optional Google calendar id filter.') }), output: actionResult }))
  .command('attach', doc({ description: 'Attach one calendar item to Google Calendar mirroring or import. This may bind the local item to an existing Google event when `google-event-id` is provided. For recurring series, attach the series root; occurrences keep derived remote refs only.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), options: z.object({ ['calendar-id']: z.string().describe('Google calendar id.'), ['google-event-id']: z.string().optional().describe('Optional existing Google event id to bind instead of creating a new remote event.'), mode: z.enum(['import', 'mirror']).describe('Attach mode.') }), output: actionResult }))
  .command('detach', doc({ description: 'Detach one calendar item from Google Calendar mirroring. The local calendar item is preserved, the remote Google event is left untouched, and the local link transitions to `detached`.', args: z.object({ ['calendar-item-id']: id('Calendar item id.') }), output: actionResult }))
  .command('reset-cursor', doc({ description: 'Reset one Google Calendar bridge poller cursor as an explicit repair action. Local calendar items remain intact and remote Google events are not deleted.', options: z.object({ ['poller-id']: z.string().optional().describe('Specific Google Calendar poller id.'), ['calendar-id']: z.string().optional().describe('Optional selected Google calendar id.') }), output: actionResult }))
  .command('repair', doc({ description: 'Repair a degraded Google Calendar bridge poller or selected calendar surface after auth, cursor, or reconcile failures. Local calendar items remain intact and remote Google events are not deleted.', options: z.object({ ['poller-id']: z.string().optional().describe('Specific Google Calendar poller id.'), ['calendar-id']: z.string().optional().describe('Optional selected Google calendar id.') }), output: actionResult }))

const googleTasksCli = Cli.create('google-tasks', {
  description: 'Google Tasks bridge for Origin tasks.',
})
  .command('status', doc({ description: 'Inspect Google Tasks bridge status, selected task lists, and per-surface pollers.', output: googleTasksBridgeStatus }))
  .command(
    Cli.create('surface', { description: 'Google Tasks bridge-surface selection.' })
      .command('list', doc({ description: 'List discoverable Google task lists and whether they are selected bridge surfaces.', output: list(googleTasksSurfaceStatus, 'Google Tasks surfaces.') }))
      .command('get', doc({ description: 'Get one Google Tasks bridge surface.', args: z.object({ ['task-list-id']: z.string().describe('Google task list id.') }), output: googleTasksSurfaceStatus }))
      .command('select', doc({ description: 'Select a Google task list as a bridge surface. This creates or repairs the server-owned poller scope for that task list but does not attach any specific Origin task.', args: z.object({ ['task-list-id']: z.string().describe('Google task list id.') }), output: actionResult }))
      .command('deselect', doc({ description: 'Deselect a Google task-list bridge surface. If Origin tasks are still attached to that task list, the command must refuse unless `force-detach` is true; with `force-detach`, those local links transition to `detached` and the remote Google tasks are left untouched.', args: z.object({ ['task-list-id']: z.string().describe('Google task list id.') }), options: z.object({ ['force-detach']: z.boolean().default(false).describe('Detach local links that still target this task list before deselecting it.') }), output: actionResult })),
  )
  .command('pull', doc({ description: 'Import changes from Google Tasks into Origin tasks.', options: z.object({ ['task-list-id']: z.string().optional().describe('Optional Google task list id filter.') }), output: actionResult }))
  .command('push', doc({ description: 'Push Origin task changes to Google Tasks.', options: z.object({ ['task-list-id']: z.string().optional().describe('Optional Google task list id filter.') }), output: actionResult }))
  .command('reconcile', doc({ description: 'Reconcile Origin tasks with Google Tasks state. Remote deletions must surface as detached-preserved local tasks for review rather than silently deleting local state.', options: z.object({ ['task-list-id']: z.string().optional().describe('Optional Google task list id filter.') }), output: actionResult }))
  .command('attach', doc({ description: 'Attach one task to Google Tasks mirroring or import. This may bind the local task to an existing Google task when `google-task-id` is provided. For recurring series, attach the series root; occurrences keep derived remote refs only.', args: z.object({ ['task-id']: id('Task id.') }), options: z.object({ ['task-list-id']: z.string().describe('Google task list id.'), ['google-task-id']: z.string().optional().describe('Optional existing Google task id to bind instead of creating a new remote task.'), mode: z.enum(['import', 'mirror']).describe('Attach mode.') }), output: actionResult }))
  .command('detach', doc({ description: 'Detach one task from Google Tasks mirroring. The local task is preserved, the remote Google task is left untouched, and the local link transitions to `detached`.', args: z.object({ ['task-id']: id('Task id.') }), output: actionResult }))
  .command('reset-cursor', doc({ description: 'Reset one Google Tasks bridge poller cursor as an explicit repair action. Local tasks remain intact and remote Google tasks are not deleted.', options: z.object({ ['poller-id']: z.string().optional().describe('Specific Google Tasks poller id.'), ['task-list-id']: z.string().optional().describe('Optional selected Google task list id.') }), output: actionResult }))
  .command('repair', doc({ description: 'Repair a degraded Google Tasks bridge poller or selected task-list surface after auth, cursor, or reconcile failures. Local tasks remain intact and remote Google tasks are not deleted.', options: z.object({ ['poller-id']: z.string().optional().describe('Specific Google Tasks poller id.'), ['task-list-id']: z.string().optional().describe('Optional selected Google task list id.') }), output: actionResult }))

const planningCli = planning
  .command(projectCli)
  .command(labelCli)
  .command(taskCli)
  .command(calendarItemCli)
  .command(googleCalendarCli)
  .command(googleTasksCli)

const email = Cli.create('email', {
  description: 'Provider-canonical mailbox actions with selective cache and Origin triage metadata.',
})
  .command(
    Cli.create('account', { description: 'Mailbox connection, labels, aliases, and sync state.' })
      .command('list', doc({ description: 'List connected email accounts.', output: list(emailAccount, 'Connected email accounts.') }))
      .command('get', doc({ description: 'Get one email account.', args: z.object({ ['account-id']: id('Email account id.') }), output: emailAccount }))
      .command('status', doc({ description: 'Get agent mailbox connection, validation, and sync status.', output: emailAccount }))
      .command('validate', doc({ description: 'Validate mailbox connectivity and permissions.', output: validationResult }))
      .command('labels', doc({ description: 'List provider labels for the connected mailbox.', output: z.object({ labels: z.array(z.string()).describe('Provider labels.') }) }))
      .command('aliases', doc({ description: 'List provider send-as aliases for the connected mailbox.', output: z.object({ aliases: z.array(z.string()).describe('Provider aliases.') }) })),
  )
  .command(
    Cli.create('thread', { description: 'Email-thread reads and actions.' })
      .command('list', doc({ description: 'List email threads.', options: z.object({ query: z.string().optional().describe('Search query.'), label: z.array(z.string()).optional().describe('Provider label filter.'), ['triage-state']: z.array(z.string()).optional().describe('Origin triage-state filter.'), limit: z.number().optional().describe('Maximum thread count.') }), output: list(emailThread, 'Email threads.') }))
      .command('get', doc({ description: 'Get one email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: emailThread }))
      .command('context', doc({ description: 'Get one thread with linked entities, recent activity, and pending actions.', args: z.object({ ['thread-id']: id('Thread id.') }), output: emailThreadContext }))
      .command('search', doc({ description: 'Search the email domain.', options: z.object({ query: z.string().describe('Email search query.'), mode: z.enum(['exact', 'semantic', 'hybrid']).default('hybrid').describe('Search mode.'), limit: z.number().optional().describe('Maximum thread count.') }), output: list(emailThread, 'Matching threads.') }))
      .command('recent', doc({ description: 'List recent email threads.', options: z.object({ limit: z.number().optional().describe('Maximum thread count.') }), output: list(emailThread, 'Recent threads.') }))
      .command('unread', doc({ description: 'List unread email threads.', options: z.object({ limit: z.number().optional().describe('Maximum thread count.') }), output: list(emailThread, 'Unread threads.') }))
      .command('triage-needed', doc({ description: 'List email threads that need triage attention.', options: z.object({ limit: z.number().optional().describe('Maximum thread count.') }), output: list(emailThread, 'Threads needing triage.') }))
      .command('archive', doc({ description: 'Archive an email thread in the provider mailbox. This does not change Origin triage state.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('unarchive', doc({ description: 'Return an email thread from provider mailbox archive to the inbox. This does not change Origin triage state.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('read', doc({ description: 'Mark an email thread read.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('unread-mark', doc({ description: 'Mark an email thread unread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('star', doc({ description: 'Star an email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('unstar', doc({ description: 'Remove the star from an email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('spam', doc({ description: 'Mark an email thread as spam.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('unspam', doc({ description: 'Remove the spam mark from an email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('trash', doc({ description: 'Move an email thread to trash.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('restore', doc({ description: 'Restore an email thread from trash.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('refresh', doc({ description: 'Refresh one email thread from the provider.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command(
        Cli.create('label', { description: 'Email-thread label actions.' })
          .command('add', doc({ description: 'Add provider labels to an email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ labels: z.array(z.string()).describe('Provider labels.') }), output: actionResult }))
          .command('remove', doc({ description: 'Remove provider labels from an email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ labels: z.array(z.string()).describe('Provider labels.') }), output: actionResult })),
      ),
  )
  .command(
    Cli.create('message', { description: 'Email-message inspection and actions.' })
      .command('list', doc({ description: 'List messages in a thread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: list(emailMessage, 'Email messages.') }))
      .command('get', doc({ description: 'Get one email message.', args: z.object({ ['message-id']: id('Message id.') }), output: emailMessage }))
      .command('body', doc({ description: 'Get the message body only.', args: z.object({ ['message-id']: id('Message id.') }), output: z.object({ body: markdown.describe('Message body.') }) }))
      .command('headers', doc({ description: 'Get message headers only.', args: z.object({ ['message-id']: id('Message id.') }), output: z.object({ headers: z.record(z.string(), z.string()).describe('Message headers.') }) }))
      .command('raw', doc({ description: 'Get the raw provider message representation.', args: z.object({ ['message-id']: id('Message id.') }), output: z.object({ raw: z.string().describe('Raw message payload.') }) }))
      .command('attachments', doc({ description: 'List attachments for one message.', args: z.object({ ['message-id']: id('Message id.') }), output: list(emailAttachment, 'Email attachments.') }))
      .command('forward', doc({ description: 'Forward one email message.', args: z.object({ ['message-id']: id('Message id.') }), options: z.object({ to: z.array(z.string()).describe('Recipient addresses.'), body: markdown.optional().describe('Optional forwarding note.') }), output: actionResult }))
      .command(
        Cli.create('attachment', { description: 'Email attachment inspection.' })
          .command('get', doc({ description: 'Get one attachment record.', args: z.object({ ['attachment-id']: id('Attachment id.') }), output: emailAttachment }))
          .command('download', doc({ description: 'Materialize one attachment into the workspace or cache.', args: z.object({ ['attachment-id']: id('Attachment id.') }), options: z.object({ to: path.optional().describe('Optional destination path.') }), output: actionResult })),
      ),
  )
  .command(
    Cli.create('draft', { description: 'Draft email commands.' })
      .command('list', doc({ description: 'List drafts in the connected mailbox.', output: list(emailDraft, 'Email drafts.') }))
      .command('get', doc({ description: 'Get one draft.', args: z.object({ ['draft-id']: id('Draft id.') }), output: emailDraft }))
      .command('create', doc({ description: 'Create an email draft.', options: z.object({ to: z.array(z.string()).describe('Recipient addresses.'), subject: z.string().describe('Draft subject.'), body: markdown.describe('Draft body.'), ['thread-id']: z.string().optional().describe('Optional thread id for reply context.') }), output: actionResult }))
      .command('update', doc({ description: 'Update an email draft.', args: z.object({ ['draft-id']: id('Draft id.') }), options: z.object({ to: z.array(z.string()).optional().describe('Recipient addresses.'), subject: z.string().optional().describe('Draft subject.'), body: markdown.optional().describe('Draft body.') }), output: actionResult }))
      .command('send', doc({ description: 'Send an existing draft.', args: z.object({ ['draft-id']: id('Draft id.') }), output: actionResult }))
      .command('delete', doc({ description: 'Delete an email draft.', args: z.object({ ['draft-id']: id('Draft id.') }), output: actionResult })),
  )
  .command('send', doc({ description: 'Send a new email.', options: z.object({ to: z.array(z.string()).describe('Recipient addresses.'), subject: z.string().describe('Subject.'), body: markdown.describe('Body.') }), output: actionResult }))
  .command('reply', doc({ description: 'Reply to an email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ body: markdown.describe('Reply body.'), ['reply-all']: z.boolean().default(false).describe('Reply to all recipients.') }), output: actionResult }))
  .command('reply-all', doc({ description: 'Reply to all recipients in an email thread.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ body: markdown.describe('Reply body.') }), output: actionResult }))
  .command(
    Cli.create('triage', { description: 'Origin triage metadata for email threads.' })
      .command('list', doc({ description: 'List triage records.', options: z.object({ state: z.array(z.string()).optional().describe('Triage-state filter.'), limit: z.number().optional().describe('Maximum record count.') }), output: list(emailTriageRecord, 'Email triage records.') }))
      .command('get', doc({ description: 'Get triage metadata for a thread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: emailTriageRecord }))
      .command('set', doc({ description: 'Set Origin triage metadata for a thread. `state=archived` archives the triage overlay only and does not change provider mailbox archive state.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ state: z.string().describe('Triage state.'), ['follow-up-at']: isoDateTime.optional().describe('Follow-up time.'), ['linked-task-id']: z.string().optional().describe('Linked task id.') }), output: actionResult }))
      .command('clear', doc({ description: 'Clear triage metadata for a thread.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult })),
  )
  .command(
    Cli.create('triage-note', { description: 'Internal triage notes for email threads.' })
      .command('set', doc({ description: 'Set or replace the internal triage note for a thread.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ body: markdown.describe('Triage note body.') }), output: actionResult })),
  )
  .command(
    Cli.create('follow-up', { description: 'Email follow-up metadata.' })
      .command('set', doc({ description: 'Set follow-up time for a thread.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ at: isoDateTime.describe('Follow-up timestamp.') }), output: actionResult })),
  )
  .command(
    Cli.create('task', { description: 'Link email threads to tasks.' })
      .command('link', doc({ description: 'Link a thread to a task.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ ['task-id']: z.string().describe('Task id.') }), output: actionResult }))
      .command('unlink', doc({ description: 'Unlink a thread from a task.', args: z.object({ ['thread-id']: id('Thread id.') }), options: z.object({ ['task-id']: z.string().describe('Task id.') }), output: actionResult })),
  )
  .command('next', doc({ description: 'Return the next highest-signal triage targets.', output: list(emailThreadContext, 'Next email triage targets.') }))
  .command(
    Cli.create('cache', { description: 'Email cache controls.' })
      .command('status', doc({ description: 'Inspect email cache status, selected mailbox surfaces, and the pollers that hydrate them.', output: providerIngressStatus }))
      .command('warm', doc({ description: 'Warm the recent email cache.', output: actionResult }))
      .command('hydrate', doc({ description: 'Hydrate full bodies or attachments for selected threads.', options: z.object({ ['thread-id']: z.array(z.string()).optional().describe('Thread ids to hydrate.') }), output: actionResult }))
      .command('pin', doc({ description: 'Pin a thread in the local email cache.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('unpin', doc({ description: 'Unpin a thread from the local email cache.', args: z.object({ ['thread-id']: id('Thread id.') }), output: actionResult }))
      .command('evict', doc({ description: 'Evict cached email state for one thread or the recent cache.', options: z.object({ ['thread-id']: z.string().optional().describe('Optional thread id.') }), output: actionResult })),
  )
  .command(
    Cli.create('refresh', { description: 'Email refresh and cursor controls.' })
      .command('status', doc({ description: 'Inspect mailbox refresh status, selected mailbox surfaces, pollers, and cursors.', output: providerIngressStatus }))
      .command('run', doc({ description: 'Refresh recent email state and caches.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.') }), output: actionResult }))
      .command('reset-cursor', doc({ description: 'Reset the provider refresh cursor for one mailbox.', options: z.object({ ['account-id']: z.string().optional().describe('Optional account id.') }), output: actionResult })),
  )
  .command(
    Cli.create('outbox', { description: 'Queued outbound email actions.' })
      .command('list', doc({ description: 'List queued outbound email actions from the server-owned provider outbox.', output: list(outboxItem, 'Email outbox items.') }))
      .command('get', doc({ description: 'Get one queued outbound email action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: outboxItem }))
      .command('retry', doc({ description: 'Retry one queued outbound email action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('cancel', doc({ description: 'Cancel one queued outbound email action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('resolve', doc({ description: 'Mark one queued outbound email action resolved after provider inspection.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult })),
  )

const github = Cli.create('github', {
  description: 'Selective GitHub tracking, follow-up, and direct actions.',
})
  .command(
    Cli.create('account', { description: 'Connected GitHub account state.' })
      .command('status', doc({ description: 'Inspect connected GitHub account state.', output: integrationStatus }))
      .command('validate', doc({ description: 'Validate GitHub connectivity, effective permissions, and GitHub App installation grants for the current working set.', output: validationResult }))
      .command('permissions', doc({ description: 'Inspect effective GitHub permissions and installation-grant scope for the connected account.', output: integrationScopeStatus })),
  )
  .command(
    Cli.create('repo', { description: 'Repository tracking.' })
      .command('list', doc({ description: 'List followed or recently relevant repositories.', options: z.object({ query: z.string().optional().describe('Search query.'), followed: z.boolean().default(false).describe('Only followed repositories.'), limit: z.number().optional().describe('Maximum repo count.') }), output: list(githubRepository, 'GitHub repositories.') }))
      .command('get', doc({ description: 'Get one repository.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), output: githubRepository }))
      .command('search', doc({ description: 'Search repositories within the local GitHub working set.', options: z.object({ query: z.string().describe('Repository search query.'), limit: z.number().optional().describe('Maximum repo count.') }), output: list(githubRepository, 'Matching repositories.') }))
      .command('context', doc({ description: 'Get one repository with linked Origin overlay context.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), output: z.object({ repo: githubRepository, ['linked-entities']: z.array(entityRef).optional().describe('Linked Origin entities.'), ['recent-activity']: z.array(activityEvent).optional().describe('Recent related activity.') }) }))
      .command('follow', doc({ description: 'Follow a repository locally for Origin follow-up. This is sugar for creating or enabling the repo-kind GitHub follow target that defines polling scope.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), options: z.object({ reason: z.string().optional().describe('Why this repo is followed.') }), output: actionResult }))
      .command('unfollow', doc({ description: 'Stop following a repository locally. This is sugar for clearing or disabling the repo-kind GitHub follow target that defines polling scope.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), output: actionResult }))
      .command('pin', doc({ description: 'Pin a repository in the local working set.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), output: actionResult }))
      .command('unpin', doc({ description: 'Unpin a repository from the local working set.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), output: actionResult }))
      .command('star', doc({ description: 'Star a repository on GitHub.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), output: actionResult }))
      .command('unstar', doc({ description: 'Remove the GitHub star from a repository.', args: z.object({ ['repo-id-or-name']: z.string().describe('Stable repo id or owner/name.') }), output: actionResult })),
  )
  .command(
    Cli.create('follow', { description: 'Fine-grained follow targets across tracked repositories.' })
      .command('list', doc({ description: 'List follow targets across repositories, issues, and pull requests.', options: z.object({ repo: z.array(z.string()).optional().describe('Repository filters.'), kind: z.array(z.string()).optional().describe('Follow-target kind filter.'), limit: z.number().optional().describe('Maximum target count.') }), output: list(githubFollowTarget, 'GitHub follow targets.') }))
      .command('get', doc({ description: 'Get one follow target.', args: z.object({ ['follow-id']: id('Follow target id.') }), output: githubFollowTarget }))
      .command('set', doc({ description: 'Create or update a follow target. Repo-kind follow targets are the canonical GitHub working-set scope, while server-owned pollers keep repository refresh cursors.', options: z.object({ repo: z.string().describe('Repository owner/name.'), kind: z.enum(['repo', 'issue', 'pr']).describe('Follow-target kind.'), ['target-ref']: z.string().optional().describe('Issue or PR ref when applicable.'), reason: z.string().optional().describe('Why this matters.') }), output: actionResult }))
      .command('clear', doc({ description: 'Clear one follow target.', args: z.object({ ['follow-id']: id('Follow target id.') }), output: actionResult }))
      .command('dismiss', doc({ description: 'Suppress current attention for one follow target after manual review. This stores the current repository refresh cursor as `dismissed-through-cursor`; the target resurfaces only after newer activity advances beyond that cursor. This does not remove the follow target.', args: z.object({ ['follow-id']: id('Follow target id.') }), output: actionResult }))
      .command('next', doc({ description: 'Return the next highest-signal follow-up targets.', output: list(githubFollowTarget, 'Next GitHub follow targets.') }))
      .command(
        Cli.create('task', { description: 'Link follow targets to planning tasks.' })
          .command('link', doc({ description: 'Link a follow target to a task.', args: z.object({ ['follow-id']: id('Follow target id.') }), options: z.object({ ['task-id']: z.string().describe('Task id.') }), output: actionResult }))
          .command('unlink', doc({ description: 'Unlink a follow target from a task.', args: z.object({ ['follow-id']: id('Follow target id.') }), options: z.object({ ['task-id']: z.string().describe('Task id.') }), output: actionResult })),
      )
      .command(
        Cli.create('note', { description: 'Link follow targets to notes.' })
          .command('link', doc({ description: 'Link a follow target to a note.', args: z.object({ ['follow-id']: id('Follow target id.') }), options: z.object({ ['note-id']: z.string().describe('Note id.') }), output: actionResult }))
          .command('unlink', doc({ description: 'Unlink a follow target from a note.', args: z.object({ ['follow-id']: id('Follow target id.') }), options: z.object({ ['note-id']: z.string().describe('Note id.') }), output: actionResult })),
      ),
  )
  .command(
    Cli.create('issue', { description: 'GitHub issue commands.' })
      .command('list', doc({ description: 'List issues across tracked repositories or a specific repository.', options: z.object({ query: z.string().optional().describe('Search query.'), repo: z.array(z.string()).optional().describe('Repository filters.'), state: z.array(z.string()).optional().describe('Issue state filters.'), limit: z.number().optional().describe('Maximum issue count.') }), output: list(githubIssue, 'GitHub issues.') }))
      .command('get', doc({ description: 'Get one issue with local tracking metadata.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref such as owner/name#123.') }), output: githubIssue }))
      .command('context', doc({ description: 'Get one issue with comments, timeline, and linked Origin context.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref such as owner/name#123.') }), output: githubIssueContext }))
      .command('timeline', doc({ description: 'List timeline events for one issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), output: list(activityEvent, 'Issue timeline events.') }))
      .command('comments', doc({ description: 'List comments on one issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), output: list(githubComment, 'Issue comments.') }))
      .command('create', doc({ description: 'Create a GitHub issue.', options: z.object({ repo: z.string().describe('Repository owner/name.'), title: z.string().describe('Issue title.'), body: markdown.optional().describe('Issue body.'), labels: z.array(z.string()).optional().describe('Issue labels.') }), output: actionResult }))
      .command('update', doc({ description: 'Update a GitHub issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), options: z.object({ title: z.string().optional().describe('New title.'), body: markdown.optional().describe('New body.'), labels: z.array(z.string()).optional().describe('Replacement labels.') }), output: actionResult }))
      .command('comment', doc({ description: 'Comment on an issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), options: z.object({ body: markdown.describe('Comment body.') }), output: actionResult }))
      .command(
        Cli.create('label', { description: 'Issue label actions.' })
          .command('add', doc({ description: 'Add labels to an issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), options: z.object({ labels: z.array(z.string()).describe('Labels to add.') }), output: actionResult }))
          .command('remove', doc({ description: 'Remove labels from an issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), options: z.object({ labels: z.array(z.string()).describe('Labels to remove.') }), output: actionResult })),
      )
      .command(
        Cli.create('assignee', { description: 'Issue assignee actions.' })
          .command('add', doc({ description: 'Add assignees to an issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), options: z.object({ assignees: z.array(z.string()).describe('Assignees to add.') }), output: actionResult }))
          .command('remove', doc({ description: 'Remove assignees from an issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), options: z.object({ assignees: z.array(z.string()).describe('Assignees to remove.') }), output: actionResult })),
      )
      .command('close', doc({ description: 'Close an issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), output: actionResult }))
      .command('lock', doc({ description: 'Lock an issue conversation.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), output: actionResult }))
      .command('unlock', doc({ description: 'Unlock an issue conversation.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), output: actionResult }))
      .command('reopen', doc({ description: 'Reopen an issue.', args: z.object({ ['issue-ref']: z.string().describe('Issue ref.') }), output: actionResult })),
  )
  .command(
    Cli.create('pr', { description: 'GitHub pull request commands.' })
      .command('list', doc({ description: 'List pull requests across tracked repositories or a specific repository.', options: z.object({ query: z.string().optional().describe('Search query.'), repo: z.array(z.string()).optional().describe('Repository filters.'), state: z.array(z.string()).optional().describe('Pull request state filters.'), limit: z.number().optional().describe('Maximum pull request count.') }), output: list(githubPullRequest, 'GitHub pull requests.') }))
      .command('get', doc({ description: 'Get one pull request with local tracking metadata.', args: z.object({ ['pr-ref']: z.string().describe('PR ref such as owner/name#456.') }), output: githubPullRequest }))
      .command('context', doc({ description: 'Get one pull request with comments, reviews, files, diff, checks, and linked Origin context.', args: z.object({ ['pr-ref']: z.string().describe('PR ref such as owner/name#456.') }), output: githubPullRequestContext }))
      .command('timeline', doc({ description: 'List timeline events for one pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: list(activityEvent, 'PR timeline events.') }))
      .command('comments', doc({ description: 'List comments on one pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: list(githubComment, 'PR comments.') }))
      .command('reviews', doc({ description: 'List reviews on one pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: list(githubReview, 'PR reviews.') }))
      .command('files', doc({ description: 'List changed files on one pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: z.object({ files: z.array(z.string()).describe('Changed files.') }) }))
      .command('diff', doc({ description: 'Get the diff or diff summary for one pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: z.object({ diff: z.string().describe('Pull request diff or diff summary.') }) }))
      .command('checks', doc({ description: 'Inspect checks for one pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: z.object({ checks: z.array(z.string()).describe('Check summaries.') }) }))
      .command('open', doc({ description: 'Open a pull request from existing branch state.', options: z.object({ repo: z.string().describe('Repository owner/name.'), head: z.string().describe('Head ref.'), base: z.string().describe('Base ref.'), title: z.string().describe('PR title.'), body: markdown.optional().describe('PR body.') }), output: actionResult }))
      .command('update', doc({ description: 'Update a pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), options: z.object({ title: z.string().optional().describe('New title.'), body: markdown.optional().describe('New body.') }), output: actionResult }))
      .command('comment', doc({ description: 'Comment on a pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), options: z.object({ body: markdown.describe('Comment body.') }), output: actionResult }))
      .command('close', doc({ description: 'Close a pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: actionResult }))
      .command('reopen', doc({ description: 'Reopen a pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: actionResult }))
      .command('merge', doc({ description: 'Merge a pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), options: z.object({ method: z.enum(['merge', 'squash', 'rebase']).default('squash').describe('Merge method.') }), output: actionResult }))
      .command(
        Cli.create('reviewer', { description: 'Reviewer request actions.' })
          .command('request', doc({ description: 'Request reviewers for a pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), options: z.object({ reviewers: z.array(z.string()).describe('Requested reviewers.') }), output: actionResult }))
          .command('unrequest', doc({ description: 'Remove requested reviewers from a pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), options: z.object({ reviewers: z.array(z.string()).describe('Reviewers to remove.') }), output: actionResult })),
      )
      .command('ready', doc({ description: 'Mark a draft pull request ready for review.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: actionResult }))
      .command('draft', doc({ description: 'Convert a pull request back to draft when supported.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: actionResult })),
  )
  .command(
    Cli.create('review', { description: 'Pull-request review commands.' })
      .command('list', doc({ description: 'List reviews on one pull request.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), output: list(githubReview, 'Pull-request reviews.') }))
      .command('get', doc({ description: 'Get one review by id.', args: z.object({ ['review-id']: id('Review id.') }), output: githubReview }))
      .command(
        'submit',
        doc({
          description: 'Submit a pull-request review.',
          args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }),
          options: z.object({
            event: z.enum(['comment', 'approve', 'request-changes']).describe('Review event.'),
            body: markdown.optional().describe('Review body.'),
          }),
          output: actionResult,
        }),
      )
      .command('thread-reply', doc({ description: 'Reply to a pull-request review thread.', args: z.object({ ['pr-ref']: z.string().describe('PR ref.') }), options: z.object({ ['thread-id']: z.string().describe('Review thread id.'), body: markdown.describe('Reply body.') }), output: actionResult })),
  )
  .command(
    Cli.create('search', { description: 'Search GitHub within provider and local follow-up scope.' })
      .command('query', doc({ description: 'Search GitHub issues, pull requests, repositories, or comments.', options: z.object({ query: z.string().describe('Search query.'), scope: z.enum(['repo', 'issue', 'pr', 'comment']).describe('Search scope.'), limit: z.number().optional().describe('Maximum result count.') }), output: list(searchHit, 'GitHub search hits.') }))
      .command('recent', doc({ description: 'List recent GitHub items relevant to the local working set.', output: list(searchHit, 'Recent GitHub items.') }))
      .command('attention', doc({ description: 'Return the next GitHub items that need attention.', output: list(searchHit, 'GitHub attention items.') })),
  )
  .command(
    Cli.create('cache', { description: 'GitHub cache controls.' })
      .command('status', doc({ description: 'Inspect GitHub cache status, tracked working-set surfaces, and ingress pollers.', output: providerIngressStatus }))
      .command('refresh', doc({ description: 'Refresh cached GitHub state.', options: z.object({ repo: z.array(z.string()).optional().describe('Repository filters.') }), output: actionResult }))
      .command('hydrate', doc({ description: 'Hydrate selected GitHub snapshots with richer details.', options: z.object({ repo: z.array(z.string()).optional().describe('Repository filters.'), refs: z.array(z.string()).optional().describe('Issue or PR refs to hydrate.') }), output: actionResult }))
      .command('evict', doc({ description: 'Evict selected GitHub cached state.', options: z.object({ repo: z.array(z.string()).optional().describe('Repository filters.'), refs: z.array(z.string()).optional().describe('Issue or PR refs to evict.') }), output: actionResult })),
  )
  .command(
    Cli.create('refresh', { description: 'GitHub refresh and cursor controls.' })
      .command('status', doc({ description: 'Inspect GitHub refresh status, tracked working-set surfaces, pollers, and cursors.', output: providerIngressStatus }))
      .command('run', doc({ description: 'Refresh followed GitHub state and caches.', options: z.object({ repo: z.array(z.string()).optional().describe('Repository filters.'), since: isoDateTime.optional().describe('Lower time bound.') }), output: actionResult }))
      .command('reset-cursor', doc({ description: 'Reset GitHub refresh cursors.', options: z.object({ repo: z.array(z.string()).optional().describe('Repository filters.') }), output: actionResult })),
  )
  .command(
    Cli.create('outbox', { description: 'Queued outbound GitHub mutations.' })
      .command('list', doc({ description: 'List queued outbound GitHub actions from the server-owned provider outbox.', output: list(outboxItem, 'GitHub outbox items.') }))
      .command('get', doc({ description: 'Get one queued outbound GitHub action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: outboxItem }))
      .command('retry', doc({ description: 'Retry one queued outbound GitHub action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('cancel', doc({ description: 'Cancel one queued outbound GitHub action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('resolve', doc({ description: 'Mark one queued outbound GitHub action resolved after provider inspection.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult })),
  )

const telegram = Cli.create('telegram', {
  description: 'Telegram bot operations for group participation, summaries, and direct actions.',
})
  .command(
    Cli.create('connection', { description: 'Telegram bot connection state.' })
      .command('status', doc({ description: 'Inspect Telegram bot connection state.', output: telegramConnection }))
      .command('set-token', doc({ description: 'Set or replace the Telegram bot token using a secure handoff ref from an operator-only channel. Do not type raw bot tokens into the agent CLI.', options: z.object({ ['token-ref']: secureRef.describe('Secure handoff ref for the Telegram bot token from BotFather.') }), output: actionResult }))
      .command('revoke', doc({ description: 'Revoke the stored Telegram bot token locally.', output: actionResult }))
      .command('validate', doc({ description: 'Validate the Telegram bot token and configuration.', output: validationResult }))
      .command('configure', doc({ description: 'Configure tracked Telegram bot behavior such as privacy expectations for validation and default participation mode. Summary defaults only seed new or repaired group policy when that group has no explicit summary window.', options: z.object({ ['privacy-mode']: z.enum(['enabled', 'disabled', 'unknown']).optional().describe('Observed or operator-expected privacy mode state used for validation.'), ['default-mode']: z.enum(['observe', 'participate']).optional().describe('Default participation mode for enabled groups.'), ['default-summary-enabled']: z.boolean().optional().describe('Whether summaries are enabled by default for newly registered groups.'), ['default-summary-window']: duration.optional().describe('Default summary lookback or cadence for newly registered groups when summaries are enabled.') }), output: actionResult }))
      .command('refresh-metadata', doc({ description: 'Refresh bot metadata and membership state from Telegram.', output: actionResult })),
  )
  .command(
    Cli.create('chat', { description: 'Known Telegram chats and group state.' })
      .command('list', doc({ description: 'List known Telegram chats and lightweight discovery state. A chat only becomes actively tracked after explicit group registration.', options: z.object({ query: z.string().optional().describe('Search query.'), kind: z.array(z.string()).optional().describe('Chat kind filter.'), limit: z.number().optional().describe('Maximum chat count.') }), output: list(telegramChat, 'Telegram chats.') }))
      .command('get', doc({ description: 'Get one Telegram chat or lightweight discovery record.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), output: telegramChat }))
      .command('context', doc({ description: 'Get one Telegram chat with policy, cached messages, and recent activity.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), output: telegramChatContext }))
      .command('recent', doc({ description: 'List recently active Telegram chats.', options: z.object({ limit: z.number().optional().describe('Maximum chat count.') }), output: list(telegramChat, 'Recent Telegram chats.') }))
      .command('search', doc({ description: 'Search within cached recent Telegram messages.', options: z.object({ query: z.string().describe('Telegram search query.'), limit: z.number().optional().describe('Maximum match count.') }), output: list(searchHit, 'Telegram search hits.') }))
      .command('refresh', doc({ description: 'Refresh one chat or the Telegram working set.', options: z.object({ ['chat-id']: z.string().optional().describe('Optional chat id.'), since: isoDateTime.optional().describe('Lower time bound.') }), output: actionResult })),
  )
  .command(
    Cli.create('group', { description: 'Telegram group participation controls.' })
      .command('list', doc({ description: 'List registered Telegram groups.', output: list(telegramGroupPolicy, 'Registered Telegram group policies.') }))
      .command('get', doc({ description: 'Get one group policy.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), output: telegramGroupPolicy }))
      .command('register', doc({ description: 'Register a group after the bot has been invited. Registration is the step that turns lightweight chat discovery into active Origin tracking and policy management.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), output: actionResult }))
      .command('enable', doc({ description: 'Enable a group for observation or active bot participation. Summary policy is configured separately.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), options: z.object({ mode: z.enum(['observe', 'participate']).describe('Participation mode for the enabled group.') }), output: actionResult }))
      .command('disable', doc({ description: 'Disable a Telegram group subscription.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), output: actionResult }))
      .command(
        Cli.create('mode', { description: 'Group participation mode.' }).command(
          'set',
          doc({
            description: 'Change the participation mode for an enabled group.',
            args: z.object({ ['chat-id']: id('Telegram chat id.') }),
            options: z.object({ mode: z.enum(['observe', 'participate']).describe('New participation mode.') }),
            output: actionResult,
          }),
        ),
      )
      .command(
        Cli.create('policy', { description: 'Per-group policy controls.' })
          .command('summary-set', doc({ description: 'Set summary policy for a group. This is the canonical per-group summary window and overrides connection defaults for that group.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), options: z.object({ enabled: z.boolean().describe('Whether summaries are enabled.'), window: duration.optional().describe('Optional summary lookback or cadence.') }), output: actionResult }))
          .command('mention-set', doc({ description: 'Set mention tracking policy for a group.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), options: z.object({ enabled: z.boolean().describe('Whether mention tracking is enabled.') }), output: actionResult }))
          .command('cache-set', doc({ description: 'Set message-cache policy for a group.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), options: z.object({ enabled: z.boolean().describe('Whether recent message caching is enabled.') }), output: actionResult })),
      ),
  )
  .command(
    Cli.create('message', { description: 'Direct Telegram bot messages.' })
      .command('send', doc({ description: 'Send a Telegram bot message.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), options: z.object({ body: markdown.describe('Message body.') }), output: actionResult }))
      .command('reply', doc({ description: 'Reply to a Telegram message.', args: z.object({ ['chat-id']: id('Telegram chat id.'), ['message-id']: id('Telegram message id.') }), options: z.object({ body: markdown.describe('Reply body.') }), output: actionResult }))
      .command('get', doc({ description: 'Get one cached Telegram message.', args: z.object({ ['chat-id']: id('Telegram chat id.'), ['message-id']: id('Telegram message id.') }), output: telegramMessage }))
      .command('edit', doc({ description: 'Edit a Telegram message previously sent by the bot.', args: z.object({ ['chat-id']: id('Telegram chat id.'), ['message-id']: id('Telegram message id.') }), options: z.object({ body: markdown.describe('Updated message body.') }), output: actionResult }))
      .command('delete', doc({ description: 'Delete a Telegram message previously sent by the bot when permitted.', args: z.object({ ['chat-id']: id('Telegram chat id.'), ['message-id']: id('Telegram message id.') }), output: actionResult })),
  )
  .command(
    Cli.create('summary', { description: 'Telegram summary generation and posting.' })
      .command('list', doc({ description: 'List recent Telegram summary-job projections produced by automation runs or explicit summary requests.', options: z.object({ ['chat-id']: z.string().optional().describe('Optional chat filter.'), since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum summary count.') }), output: list(telegramSummaryJob, 'Telegram summary jobs.') }))
      .command('get', doc({ description: 'Get one Telegram summary job.', args: z.object({ ['summary-id']: id('Summary job id.') }), output: telegramSummaryJob }))
      .command('run', doc({ description: 'Generate a summary for a Telegram group over a recent window.', args: z.object({ ['chat-id']: id('Telegram chat id.') }), options: z.object({ window: duration.default('24h').describe('Window to summarize.') }), output: actionResult }))
      .command('post', doc({ description: 'Post a generated summary into a Telegram group.', args: z.object({ ['summary-id']: id('Summary job id.') }), output: actionResult }))
      .command('next', doc({ description: 'Return the next groups whose current Telegram summary policy and automation state indicate a summary is due.', output: list(telegramSummaryJob, 'Next Telegram summary candidates.') })),
  )
  .command(
    Cli.create('cache', { description: 'Telegram cache controls.' })
      .command('status', doc({ description: 'Inspect Telegram cache status, tracked chats, and ingress pollers.', output: providerIngressStatus }))
      .command('refresh', doc({ description: 'Refresh Telegram recent-message caches.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.') }), output: actionResult }))
      .command('rehydrate', doc({ description: 'Rehydrate cached Telegram windows from provider state when possible.', options: z.object({ ['chat-id']: z.string().optional().describe('Optional chat id.') }), output: actionResult }))
      .command('expire', doc({ description: 'Expire selected Telegram cached windows.', options: z.object({ ['chat-id']: z.string().optional().describe('Optional chat id.') }), output: actionResult }))
      .command('evict', doc({ description: 'Evict selected Telegram cached state.', options: z.object({ ['chat-id']: z.string().optional().describe('Optional chat id.') }), output: actionResult })),
  )
  .command(
    Cli.create('refresh', { description: 'Telegram refresh controls.' })
      .command('status', doc({ description: 'Inspect Telegram refresh status, tracked chats, pollers, and cursors.', output: providerIngressStatus }))
      .command('run', doc({ description: 'Refresh Telegram working-set state.', output: actionResult })),
  )
  .command(
    Cli.create('outbox', { description: 'Queued outbound Telegram actions.' })
      .command('list', doc({ description: 'List queued outbound Telegram actions from the server-owned provider outbox.', output: list(outboxItem, 'Telegram outbox items.') }))
      .command('get', doc({ description: 'Get one queued outbound Telegram action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: outboxItem }))
      .command('retry', doc({ description: 'Retry one queued outbound Telegram action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('cancel', doc({ description: 'Cancel one queued outbound Telegram action.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('resolve', doc({ description: 'Mark one queued outbound Telegram action resolved after provider inspection.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult })),
  )

const automationCli = Cli.create('automation', {
  description: 'First-class automation objects, schedules, runs, failures, and queue state.',
})
  .command('list', doc({ description: 'List automations.', options: z.object({ status: z.array(z.string()).optional().describe('Automation status filter.'), trigger: z.array(z.string()).optional().describe('Trigger filter.'), ['linked-task']: z.array(z.string()).optional().describe('Linked task filter.'), limit: z.number().optional().describe('Maximum automation count.') }), output: list(automation, 'Automations.') }))
  .command('get', doc({ description: 'Get one automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: automation }))
  .command('create', doc({ description: 'Create an automation. The persisted automation kind is derived from the trigger shape and is not supplied separately.', options: z.object({ name: z.string().describe('Canonical automation name.'), slug: z.string().optional().describe('Stable automation slug or machine key.'), ['description-md']: markdown.optional().describe('Canonical automation description markdown.'), trigger: automationTrigger.describe('Typed trigger definition.'), actions: z.array(automationAction).describe('Ordered action definitions.'), ['linked-task-ids']: z.array(z.string()).optional().describe('Linked task ids.'), ['linked-calendar-item-ids']: z.array(z.string()).optional().describe('Linked calendar item ids.'), ['linked-project-ids']: z.array(z.string()).optional().describe('Linked project ids.'), ['label-ids']: z.array(z.string()).optional().describe('Linked label ids.'), ['notification-policy']: z.record(z.string(), z.unknown()).optional().describe('Notification policy.'), ['run-policy']: automationRunPolicy.optional().describe('Run policy. Defaults to serial execution, skipped catch-up, and stop-on-error.'), ['retry-policy']: automationRetryPolicy.optional().describe('Retry policy. Defaults to three total attempts with exponential backoff.'), source: z.string().optional().describe('Definition source when known.') }), output: actionResult }))
  .command('update', doc({ description: 'Update an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), options: z.object({ name: z.string().optional().describe('New canonical automation name.'), slug: z.string().optional().describe('Replacement stable slug or machine key.'), ['description-md']: markdown.optional().describe('Replacement canonical automation description markdown.'), trigger: automationTrigger.optional().describe('Replacement trigger.'), actions: z.array(automationAction).optional().describe('Replacement actions.'), ['linked-task-ids']: z.array(z.string()).optional().describe('Replacement linked task ids.'), ['linked-calendar-item-ids']: z.array(z.string()).optional().describe('Replacement linked calendar item ids.'), ['linked-project-ids']: z.array(z.string()).optional().describe('Replacement linked project ids.'), ['label-ids']: z.array(z.string()).optional().describe('Replacement linked label ids.'), ['notification-policy']: z.record(z.string(), z.unknown()).optional().describe('Notification policy patch.'), ['run-policy']: automationRunPolicy.partial().optional().describe('Run policy patch.'), ['retry-policy']: automationRetryPolicy.partial().optional().describe('Retry policy patch.'), source: z.string().optional().describe('Definition source patch.') }), output: actionResult }))
  .command('archive', doc({ description: 'Archive an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: actionResult }))
  .command('delete', doc({ description: 'Delete an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: actionResult }))
  .command('enable', doc({ description: 'Enable an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: actionResult }))
  .command('disable', doc({ description: 'Disable an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: actionResult }))
  .command('pause', doc({ description: 'Pause an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: actionResult }))
  .command('resume', doc({ description: 'Resume a paused automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: actionResult }))
  .command('validate', doc({ description: 'Validate an automation definition.', args: z.object({ ['automation-id']: id('Automation id.') }), output: validationResult }))
  .command('diagnose', doc({ description: 'Diagnose why an automation is unhealthy or failing.', args: z.object({ ['automation-id']: id('Automation id.') }), output: validationResult }))
  .command(
    Cli.create('schedule', { description: 'Automation schedule inspection.' })
      .command('preview', doc({ description: 'Preview the next schedule decisions for an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: automationSchedulePreview }))
      .command('next-runs', doc({ description: 'List next scheduled run times for an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: automationSchedulePreview })),
  )
  .command('due', doc({ description: 'List automations due to run soon or now.', output: list(automation, 'Due automations.') }))
  .command('queue', doc({ description: 'Inspect the automation execution queue.', output: list(queueStatus, 'Automation queue entries.') }))
  .command('failures', doc({ description: 'List recent failed automation runs.', output: list(automationRun, 'Failed automation runs.') }))
  .command('stats', doc({ description: 'Summarize automation health and execution counts.', output: activitySummary }))
  .command('run', doc({ description: 'Run an automation immediately.', args: z.object({ ['automation-id']: id('Automation id.') }), options: z.object({ reason: z.string().optional().describe('Manual run reason.') }), output: actionResult }))
  .command('skip-next', doc({ description: 'Skip the next scheduled run of an automation.', args: z.object({ ['automation-id']: id('Automation id.') }), output: actionResult }))
  .command('backfill', doc({ description: 'Backfill missed scheduled runs where policy allows catch-up.', args: z.object({ ['automation-id']: id('Automation id.') }), options: z.object({ from: isoDateTime.optional().describe('Backfill lower bound.'), to: isoDateTime.optional().describe('Backfill upper bound.') }), output: actionResult }))
  .command(
    Cli.create('runs', { description: 'Automation run history and controls.' })
      .command('list', doc({ description: 'List runs for one automation or all automations.', options: z.object({ ['automation-id']: z.string().optional().describe('Optional automation filter.'), since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum run count.') }), output: list(automationRun, 'Automation runs.') }))
      .command('get', doc({ description: 'Get one automation run with step-level detail.', args: z.object({ ['run-id']: id('Automation run id.') }), output: automationRunDetail }))
      .command('cancel', doc({ description: 'Cancel an in-flight automation run when supported.', args: z.object({ ['run-id']: id('Automation run id.') }), output: actionResult }))
      .command('retry', doc({ description: 'Retry a failed automation run.', args: z.object({ ['run-id']: id('Automation run id.') }), output: actionResult }))
      .command('tail', doc({ description: 'Tail a run’s structured execution events.', args: z.object({ ['run-id']: id('Automation run id.') }), options: z.object({ follow: z.boolean().default(true).describe('Follow new events.') }), output: list(activityEvent, 'Run activity events.') }))
      .command('events', doc({ description: 'List execution events for one automation run.', args: z.object({ ['run-id']: id('Automation run id.') }), output: list(activityEvent, 'Run activity events.') })),
  )
  .command('events', doc({ description: 'List automation-related activity events.', options: z.object({ ['automation-id']: z.string().optional().describe('Optional automation filter.'), since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum event count.') }), output: list(activityEvent, 'Automation activity events.') }))

const activity = Cli.create('activity', {
  description: 'User-visible activity-event log and correlated traces.',
})
  .command('list', doc({ description: 'List recent activity events.', options: z.object({ domains: z.array(z.string()).optional().describe('Optional domain filter.'), since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum event count.') }), output: list(activityEvent, 'Activity events.') }))
  .command('get', doc({ description: 'Get one activity event.', args: z.object({ ['activity-id']: id('Activity event id.') }), output: activityEvent }))
  .command('tail', doc({ description: 'Tail recent activity events.', options: z.object({ follow: z.boolean().default(true).describe('Follow new events.'), domains: z.array(z.string()).optional().describe('Optional domain filter.') }), output: list(activityEvent, 'Live or recent activity events.') }))
  .command('summarize', doc({ description: 'Summarize activity across a time window.', options: z.object({ domains: z.array(z.string()).optional().describe('Optional domain filter.'), since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.') }), output: activitySummary }))
  .command('stats', doc({ description: 'Return activity counts by kind, status, or actor.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.') }), output: activitySummary }))
  .command('trace', doc({ description: 'Get a correlated activity trace spanning jobs, runs, conflicts, and deliveries.', args: z.object({ ['trace-id']: z.string().describe('Trace id.') }), output: activityTrace }))
  .command('related', doc({ description: 'List activity related to one entity, run, job, or delivery.', args: z.object({ entity: z.string().describe('Entity id, run id, job id, conflict id, or delivery id.') }), output: list(activityEvent, 'Related activity events.') }))
  .command('errors', doc({ description: 'List recent error activity events.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), limit: z.number().optional().describe('Maximum event count.') }), output: list(activityEvent, 'Error events.') }))
  .command('pending', doc({ description: 'List pending or in-flight activity entries.', output: list(activityEvent, 'Pending activity events.') }))
  .command('actors', doc({ description: 'List actors currently represented in the activity stream.', output: z.object({ actors: z.array(z.string()).describe('Known actor ids.') }) }))
  .command('kinds', doc({ description: 'List activity kinds currently represented in the stream.', output: z.object({ kinds: z.array(z.string()).describe('Known activity kinds.') }) }))
  .command('export', doc({ description: 'Export activity within a time window.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), format: z.enum(['json', 'jsonl', 'md']).optional().describe('Preferred export format.') }), output: z.object({ summary: z.string().describe('Export summary.'), path: path.optional().describe('Export path when materialized.') }) }))

const entity = Cli.create('entity', {
  description: 'Cross-domain entity graph operations.',
})
  .command('get', doc({ description: 'Resolve and return any Origin entity.', args: z.object({ entity: id('Entity id or ref.') }), output: originEntity }))
  .command('related', doc({ description: 'List linked or contextually related entities.', args: z.object({ entity: id('Entity id or ref.') }), options: z.object({ domains: z.array(z.string()).optional().describe('Optional domain filter.'), limit: z.number().optional().describe('Maximum entity count.') }), output: list(originEntity, 'Related entities.') }))
  .command('history', doc({ description: 'Inspect object-level history for an entity.', args: z.object({ entity: id('Entity id or ref.') }), options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.') }), output: list(entityHistoryEntry, 'Entity history entries.') }))
  .command('link', doc({ description: 'Create an Origin-side cross-domain link.', args: z.object({ entity: id('Source entity id or ref.') }), options: z.object({ to: z.string().describe('Target entity id or ref.'), kind: z.string().describe('Link kind.') }), output: actionResult }))
  .command('unlink', doc({ description: 'Remove an Origin-side cross-domain link.', args: z.object({ entity: id('Source entity id or ref.') }), options: z.object({ to: z.string().describe('Target entity id or ref.'), kind: z.string().describe('Link kind.') }), output: actionResult }))
  .command('restore', doc({ description: 'Restore a first-party entity to a prior revision where supported.', args: z.object({ entity: id('Entity id or ref.'), ['revision-id']: id('Revision id.') }), output: actionResult }))

const notificationCli = Cli.create('notification', {
  description: 'User-facing notifications, devices, deliveries, and preferences.',
})
  .command('list', doc({ description: 'List notifications.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum notification count.') }), output: list(notification, 'Notifications.') }))
  .command('get', doc({ description: 'Get one notification.', args: z.object({ ['notification-id']: id('Notification id.') }), output: notification }))
  .command('unread', doc({ description: 'List unread notifications.', output: list(notification, 'Unread notifications.') }))
  .command('ack', doc({ description: 'Acknowledge one notification.', args: z.object({ ['notification-id']: id('Notification id.') }), output: actionResult }))
  .command('ack-all', doc({ description: 'Acknowledge all visible notifications.', output: actionResult }))
  .command('snooze', doc({ description: 'Snooze one notification.', args: z.object({ ['notification-id']: id('Notification id.') }), options: z.object({ until: isoDateTime.describe('Snooze-until timestamp.') }), output: actionResult }))
  .command('test', doc({ description: 'Send a test in-app/push notification.', output: actionResult }))
  .command(
    Cli.create('preferences', { description: 'Notification preferences.' })
      .command('get', doc({ description: 'Get notification preferences.', output: z.object({ values: z.record(z.string(), z.unknown()).describe('Notification preference values.') }) }))
      .command('set', doc({ description: 'Set notification preferences.', options: z.object({ values: z.record(z.string(), z.unknown()).describe('Preference payload.') }), output: actionResult })),
  )
  .command('channels', doc({ description: 'List available notification channels.', output: z.object({ channels: z.array(z.string()).describe('Notification channels.') }) }))
  .command('devices', doc({ description: 'List registered notification devices.', output: list(notificationDevice, 'Notification devices.') }))
  .command(
    Cli.create('device', { description: 'Individual notification device controls.' })
      .command('get', doc({ description: 'Get one notification device.', args: z.object({ ['device-id']: id('Device id.') }), output: notificationDevice }))
      .command('enable', doc({ description: 'Enable a notification device.', args: z.object({ ['device-id']: id('Device id.') }), output: actionResult }))
      .command('disable', doc({ description: 'Disable a notification device.', args: z.object({ ['device-id']: id('Device id.') }), output: actionResult }))
      .command('revoke', doc({ description: 'Revoke a notification device.', args: z.object({ ['device-id']: id('Device id.') }), output: actionResult })),
  )
  .command('deliveries', doc({ description: 'List notification deliveries.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum delivery count.') }), output: list(notificationDelivery, 'Notification deliveries.') }))
  .command(
    Cli.create('delivery', { description: 'Inspect one notification delivery.' }).command(
      'get',
      doc({
        description: 'Get one notification delivery.',
        args: z.object({ ['delivery-id']: id('Delivery id.') }),
        output: notificationDelivery,
      }),
    ),
  )
  .command('failures', doc({ description: 'List failed notification deliveries.', output: list(notificationDelivery, 'Failed deliveries.') }))
  .command('retry', doc({ description: 'Retry a failed notification delivery.', args: z.object({ ['delivery-id']: id('Delivery id.') }), output: actionResult }))

const sync = Cli.create('sync', {
  description: 'Replication, provider sync, outbox, and filesystem bridge observability.',
})
  .command('overview', doc({ description: 'Show the top-level sync overview across replica, provider, outbox, and bridge.', output: syncStatus }))
  .command('diagnose', doc({ description: 'Diagnose lag, divergence, or queue pressure across sync subsystems.', output: validationResult }))
  .command('repair', doc({ description: 'Run safe sync repair routines for common failure modes.', output: actionResult }))
  .command(
    Cli.create('replica', { description: 'Automerge peer replication state.' })
      .command('status', doc({ description: 'Inspect replica-sync status.', output: syncStatus }))
      .command('peers', doc({ description: 'List replica peers.', output: list(syncPeerStatus, 'Replica peers.') }))
      .command(Cli.create('peer', { description: 'Inspect one replica peer.' }).command('get', doc({ description: 'Get one replica peer.', args: z.object({ ['peer-id']: id('Peer id.') }), output: syncPeerStatus })))
      .command('run', doc({ description: 'Trigger a replica-sync pass.', output: actionResult }))
      .command('jobs', doc({ description: 'List replica-sync jobs.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum job count.') }), output: list(syncJob, 'Replica-sync jobs.') }))
      .command(Cli.create('job', { description: 'Inspect one replica-sync job.' }).command('get', doc({ description: 'Get one replica-sync job.', args: z.object({ ['job-id']: id('Sync job id.') }), output: syncJob })))
      .command('pending', doc({ description: 'Inspect pending replica-sync work.', output: list(outboxItem, 'Pending replica-sync items.') }))
      .command('lag', doc({ description: 'Inspect replica lag by peer or scope.', output: list(syncPeerStatus, 'Replica lag summaries.') }))
      .command('conflicts', doc({ description: 'List outstanding replica conflicts.', output: list(syncConflict, 'Replica conflicts.') }))
      .command('retry', doc({ description: 'Retry a replica-sync job.', args: z.object({ ['job-id']: id('Sync job id.') }), output: actionResult })),
  )
  .command(
    Cli.create('provider', { description: 'Provider refresh and reconcile jobs.' })
      .command('status', doc({ description: 'Inspect provider-sync status.', output: syncStatus }))
      .command('run', doc({ description: 'Trigger a provider refresh or reconcile pass.', output: actionResult }))
      .command('jobs', doc({ description: 'List provider-sync jobs.', options: z.object({ since: isoDateTime.optional().describe('Lower time bound.'), until: isoDateTime.optional().describe('Upper time bound.'), limit: z.number().optional().describe('Maximum job count.') }), output: list(syncJob, 'Provider-sync jobs.') }))
      .command(Cli.create('job', { description: 'Inspect one provider-sync job.' }).command('get', doc({ description: 'Get one provider-sync job.', args: z.object({ ['job-id']: id('Sync job id.') }), output: syncJob })))
      .command('retry', doc({ description: 'Retry a provider-sync job.', args: z.object({ ['job-id']: id('Sync job id.') }), output: actionResult })),
  )
  .command(
    Cli.create('outbox', { description: 'Queued offline or deferred mutations.' })
      .command('list', doc({ description: 'List outbox items.', options: z.object({ kind: z.array(z.string()).optional().describe('Optional kind filter.'), status: z.array(z.string()).optional().describe('Optional status filter.'), limit: z.number().optional().describe('Maximum outbox count.') }), output: list(outboxItem, 'Outbox items.') }))
      .command('get', doc({ description: 'Get one outbox item.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: outboxItem }))
      .command('retry', doc({ description: 'Retry one outbox item.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('cancel', doc({ description: 'Cancel one outbox item.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult }))
      .command('resolve', doc({ description: 'Mark one outbox item resolved after inspection.', args: z.object({ ['outbox-id']: id('Outbox item id.') }), output: actionResult })),
  )
  .command('conflicts', doc({ description: 'List outstanding sync conflicts.', options: z.object({ limit: z.number().optional().describe('Maximum conflict count.') }), output: list(syncConflict, 'Sync conflicts.') }))
  .command(
    Cli.create('conflict', { description: 'Inspect and resolve one sync conflict.' })
      .command('get', doc({ description: 'Get one sync conflict.', args: z.object({ ['conflict-id']: id('Conflict id.') }), output: syncConflictDetail }))
      .command('resolve', doc({ description: 'Resolve one sync conflict by selecting an explicit candidate or by providing merged or replacement structured payload.', args: z.object({ ['conflict-id']: id('Conflict id.') }), options: payloadResolutionOptions('Merged or replacement structured payload. Required for merge and replace resolutions.'), output: actionResult })),
  )
  .command(
    Cli.create('bridge', { description: 'Filesystem import/export watcher state.' })
      .command('status', doc({ description: 'Inspect the note-vault bridge state.', output: syncStatus }))
      .command('jobs', doc({ description: 'List bridge jobs such as scans and imports.', output: list(bridgeJob, 'Bridge jobs.') }))
      .command('rescan', doc({ description: 'Rescan the workspace and filesystem bridge inputs.', output: actionResult }))
      .command('import', doc({ description: 'Import external filesystem edits into replicated state.', output: actionResult }))
      .command('export', doc({ description: 'Export replicated state back into workspace files.', output: actionResult }))
      .command('reconcile', doc({ description: 'Run a full filesystem bridge reconcile pass.', output: actionResult })),
  )

/** The documentation-first incur CLI contract for Origin. */
export const originRootDefinition = {
  version: '0.1.0',
  description:
    'Origin is a local-first personal chief-of-staff. This CLI is its full agent-facing action surface, modeled directly with incur for help, schema, llms, skills, and MCP discovery.',
  config: {
    flag: 'config',
    files: ['origin.json', '~/.config/origin/config.json'] as string[],
  },
  env: z.object({
    ORIGIN_PROFILE: z.string().optional().describe('Logical Origin profile to use.'),
    ORIGIN_INSTANCE: z.enum(['local', 'vps']).optional().describe('Preferred execution target when both local and VPS are available.'),
    ORIGIN_API_URL: z.string().optional().describe('Explicit Origin server base URL when the CLI is not co-located with the server.'),
  }),
  sync: {
    depth: 1,
    suggestions: [
      'show me what matters right now',
      'show my planning today',
      'triage the email inbox',
      'show recent agent activity',
      'find notes related to a topic',
      'diagnose sync problems',
      'check integration health',
      'show blocked tasks',
    ] as string[],
  },
}

export const origin = Cli.create('origin', originRootDefinition)
  .command(status)
  .command(context)
  .command(search)
  .command(identity)
  .command(integration)
  .command(setup)
  .command(chat)
  .command(memory)
  .command(workspace)
  .command(noteCli)
  .command(file)
  .command(planningCli)
  .command(email)
  .command(github)
  .command(telegram)
  .command(automationCli)
  .command(activity)
  .command(entity)
  .command(notificationCli)
  .command(sync)

export default origin
