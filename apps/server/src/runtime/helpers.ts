import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'

import type {
  ActivityEventRecord,
  EntityHistoryRecord,
  IsoDate,
  IsoDateTime,
  JsonValue,
  OriginState,
  RevisionDiffRecord,
  StoredRevisionRecord,
} from './types.ts'

export const DAY_IN_MS = 24 * 60 * 60 * 1000

export function now(): IsoDateTime {
  return new Date().toISOString()
}

export function today(): IsoDate {
  return now().slice(0, 10)
}

export function coerceArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function includesQuery(haystack: string | undefined, needle: string | undefined): boolean {
  if (!needle) return true
  return normalizeText(haystack).includes(normalizeText(needle))
}

export function maybe<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : value
}

export function createActionResult(
  summary: string,
  extra: Partial<{
    affectedIds: string[]
    providerRefs: string[]
    reconcileId: string
    traceId: string
    activityIds: string[]
    jobId: string
    runId: string
    conflictId: string
  }> = {},
) {
  return {
    summary,
    ...(extra.affectedIds?.length ? { ['affected-ids']: extra.affectedIds } : {}),
    ...(extra.providerRefs?.length ? { ['provider-refs']: extra.providerRefs } : {}),
    ...(extra.reconcileId ? { ['reconcile-id']: extra.reconcileId } : {}),
    ...(extra.traceId ? { ['trace-id']: extra.traceId } : {}),
    ...(extra.activityIds?.length ? { ['activity-ids']: extra.activityIds } : {}),
    ...(extra.jobId ? { ['job-id']: extra.jobId } : {}),
    ...(extra.runId ? { ['run-id']: extra.runId } : {}),
    ...(extra.conflictId ? { ['conflict-id']: extra.conflictId } : {}),
  }
}

export function createListResult<T>(
  items: T[],
  options: Partial<{
    nextCursor: string
    total: number
    summary: string
  }> = {},
) {
  return {
    items,
    ...(options.nextCursor ? { ['next-cursor']: options.nextCursor } : {}),
    ...(options.total !== undefined ? { total: options.total } : {}),
    ...(options.summary ? { summary: options.summary } : {}),
  }
}

export function createValidationResult(
  checks: Array<{
    id: string
    kind: string
    target: string
    status: 'pass' | 'warn' | 'fail'
    message: string
    remediation?: string[]
  }>,
  summary?: string,
) {
  const hasFail = checks.some((check) => check.status === 'fail')
  const hasWarn = checks.some((check) => check.status === 'warn')
  return {
    summary:
      summary ??
      (hasFail
        ? 'One or more blocking validation checks failed.'
        : hasWarn
          ? 'Validation completed with warnings.'
          : 'All validation checks passed.'),
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    checks,
  }
}

export function pickSummary<T extends { summary?: string }>(items: T[], fallback: string): string {
  if (items.length === 0) return fallback
  if (items.length === 1 && items[0]?.summary) return items[0].summary
  return fallback
}

export function inferTitleFromPath(path: string): string {
  const name = basename(path, extname(path))
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function safeObject(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, JsonValue>
}

export function stableHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

export function recordRevision(
  revisions: StoredRevisionRecord[],
  entry: Omit<StoredRevisionRecord, 'head'>,
): StoredRevisionRecord[] {
  const next = revisions.map((revision) => ({ ...revision, head: false }))
  next.push({ ...entry, head: true })
  return next
}

export function createRevisionDiff(
  previousContent: string | undefined,
  nextContent: string | undefined,
  changedFields: string[] = ['content'],
): RevisionDiffRecord {
  if (previousContent === nextContent) {
    return {
      summary: 'No material changes.',
      changedFields,
    }
  }

  const before = (previousContent ?? '').split('\n')
  const after = (nextContent ?? '').split('\n')
  const removed = before.filter((line) => !after.includes(line)).slice(0, 6)
  const added = after.filter((line) => !before.includes(line)).slice(0, 6)
  const patch = [
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n')

  return {
    summary: 'Content changed.',
    changedFields,
    ...(patch ? { patch } : {}),
  }
}

export function createHistoryEntry(
  state: OriginState,
  actor: string,
  summary: string,
  revisionId?: string,
): EntityHistoryRecord {
  return {
    id: nextId(state, 'hist'),
    actor,
    at: now(),
    summary,
    ...(revisionId ? { revisionId } : {}),
  }
}

export function nextId(state: OriginState, prefix: string): string {
  state.nextId += 1
  return `${prefix}_${String(state.nextId).padStart(4, '0')}`
}

export function addActivity(
  state: OriginState,
  entry: Omit<ActivityEventRecord, 'id' | 'at'>,
): ActivityEventRecord {
  const activity: ActivityEventRecord = {
    id: nextId(state, 'act'),
    at: now(),
    ...entry,
  }
  state.activities.unshift(activity)
  state.updatedAt = activity.at
  return activity
}

export function summarizeCounts(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

export function scoreText(query: string, text: string): number {
  const normalizedQuery = normalizeText(query)
  const normalizedText = normalizeText(text)
  if (!normalizedQuery || !normalizedText) return 0
  if (normalizedText === normalizedQuery) return 1
  if (normalizedText.includes(normalizedQuery)) return 0.8
  const queryTerms = normalizedQuery.split(/\s+/)
  const matches = queryTerms.filter((term) => normalizedText.includes(term)).length
  return matches / queryTerms.length
}

export function cmpDateDescending(a: string | undefined, b: string | undefined): number {
  return (b ?? '').localeCompare(a ?? '')
}

export function selectWindow<T extends { at?: string; updatedAt?: string; lastMessageAt?: string }>(
  items: T[],
  since?: string,
  until?: string,
): T[] {
  return items.filter((item) => {
    const timestamp = item.at ?? item.updatedAt ?? item.lastMessageAt
    if (!timestamp) return true
    if (since && timestamp < since) return false
    if (until && timestamp > until) return false
    return true
  })
}

export function takeLimit<T>(items: T[], limit?: number): T[] {
  return limit === undefined ? items : items.slice(0, limit)
}

export function asMarkdownTable(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0] ?? {})
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${headers.map((key) => row[key] ?? '').join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}
