import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

import {
  addActivity,
  cmpDateDescending,
  createActionResult,
  createHistoryEntry,
  createListResult,
  createRevisionDiff,
  createValidationResult,
  includesQuery,
  inferTitleFromPath,
  nextId,
  now,
  pickSummary,
  recordRevision,
  scoreText,
  selectWindow,
  takeLimit,
} from '../runtime/helpers.ts'
import { defineHandlers } from '../cli/types.ts'
import type { OriginState, StoredRevisionRecord } from '../runtime/types.ts'

type ManagedState = OriginState & {
  __originCli?: {
    memoryArtifactRevisions?: Record<string, StoredRevisionRecord[]>
  }
}

type RouteContext = any

const workspaceFilePath = 'Origin/Memory.md'

const routes: Record<string, (context: RouteContext) => Promise<unknown> | unknown> = {}

function addRoute(name: string, handler: (context: RouteContext) => Promise<unknown> | unknown) {
  routes[name] = handler
  routes[name.replace(/ /g, '.')] = handler
}

function routeKey(context: RouteContext) {
  return String(context.route ?? context.path ?? '').replace(/\./g, ' ')
}

function workspaceRoot(context: RouteContext) {
  return String(context.runtime?.paths?.workspaceRoot ?? context.runtime?.paths?.vaultRoot ?? process.cwd())
}

function vaultRoot(context: RouteContext) {
  return String(context.runtime?.paths?.vaultRoot ?? workspaceRoot(context))
}

function stateRoot(context: RouteContext) {
  return String(context.runtime?.paths?.stateDir ?? dirname(context.runtime?.paths?.stateFile ?? workspaceRoot(context)))
}

function toWorkspaceAbs(context: RouteContext, value: string) {
  const root = workspaceRoot(context)
  const candidate = isAbsolute(value) ? normalize(value) : resolve(root, value)
  return candidate
}

function toWorkspaceRel(context: RouteContext, value: string) {
  const root = workspaceRoot(context)
  const abs = toWorkspaceAbs(context, value)
  const rel = relative(root, abs)
  if (!rel || rel === '') return ''
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

function insideRoot(root: string, target: string) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function workspaceFileAbs(context: RouteContext) {
  return join(vaultRoot(context), workspaceFilePath)
}

function noteWorkspaceAbs(context: RouteContext, pathValue: string) {
  return join(workspaceRoot(context), pathValue)
}

function ensureParent(absPath: string) {
  return mkdir(dirname(absPath), { recursive: true })
}

async function ensureDir(absPath: string) {
  await mkdir(absPath, { recursive: true })
}

async function safeStat(absPath: string) {
  try {
    return await stat(absPath)
  } catch {
    return undefined
  }
}

function contentLooksLikePatch(content: string) {
  return /^(@@|--- |\+\+\+ |- )/m.test(content) || /\n[-+].+/m.test(content)
}

function applyPatchLike(current: string, patch: string) {
  if (!patch.trim()) return current
  if (!contentLooksLikePatch(patch)) {
    return current ? `${current}\n${patch}` : patch
  }

  const additions = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
  const removals = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1))

  let next = current
  const pairs = Math.min(additions.length, removals.length)
  for (let index = 0; index < pairs; index += 1) {
    const from = removals[index]
    const to = additions[index] ?? ''
    if (from && next.includes(from)) {
      next = next.replace(from, to)
    } else if (to) {
      next = next ? `${next}\n${to}` : to
    }
  }

  if (additions.length > removals.length) {
    for (const line of additions.slice(removals.length)) {
      next = next ? `${next}\n${line}` : line
    }
  }

  if (next === current) {
    return current ? `${current}\n${patch}` : patch
  }

  return next
}

function replaceSection(current: string, section: string | undefined, replacement: string) {
  if (!section) return replacement
  const lines = current.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+/.test(line) && line.replace(/^#{1,6}\s+/, '').trim() === section.trim())
  if (headingIndex === -1) {
    return current ? `${current}\n\n## ${section}\n${replacement}` : `## ${section}\n${replacement}`
  }

  const headingLine = lines[headingIndex] ?? `## ${section}`
  const headingLevel = headingLine.match(/^#+/)?.[0].length ?? 2
  let endIndex = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const level = line.match(/^#+/)?.[0].length
    if (level && level <= headingLevel) {
      endIndex = index
      break
    }
  }

  const nextLines = [...lines.slice(0, headingIndex + 1), replacement, ...lines.slice(endIndex)]
  return nextLines.join('\n').replace(/\n{3,}/g, '\n\n')
}

function memoryContent(state: ManagedState) {
  return state.memory.revisions.at(-1)?.content ?? '# Origin Memory\n'
}

function noteTitleFromContent(content: string, fallbackPath: string) {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || inferTitleFromPath(fallbackPath)
}

function noteSummary(note: { id: string; title: string; path: string; updatedAt: string }) {
  return {
    id: note.id,
    title: note.title,
    path: note.path,
    ['updated-at']: note.updatedAt,
  }
}

function noteOutput(note: any) {
  return {
    id: note.id,
    title: note.title,
    path: note.path,
    content: note.content,
    ['updated-at']: note.updatedAt,
    ...(note.attachments ? { attachments: note.attachments } : {}),
    ...(note.revisions ? { revisions: note.revisions } : {}),
    ...(note.history ? { history: note.history } : {}),
    ...(note.archived ? { archived: note.archived } : {}),
  }
}

function workspaceEntryOutput(pathValue: string, kind: 'file' | 'folder', modifiedAt?: string) {
  return {
    path: pathValue,
    kind,
    ...(modifiedAt ? { ['last-modified-at']: modifiedAt } : {}),
  }
}

function fileEntryOutput(pathValue: string, kind: 'file' | 'folder' | 'symlink', size?: number, modifiedAt?: string) {
  return {
    path: pathValue,
    kind,
    ...(size !== undefined ? { size } : {}),
    ...(modifiedAt ? { ['modified-at']: modifiedAt } : {}),
  }
}

function memoryArtifactOutput(record: any) {
  return {
    path: record.path,
    kind: record.kind,
    summary: record.summary,
    ...(record.replicatedState !== undefined ? { ['replicated-state']: record.replicatedState } : {}),
  }
}

function revisionOutput(pathValue: string, revision: StoredRevisionRecord) {
  return {
    id: revision.id,
    path: pathValue,
    actor: revision.actor,
    at: revision.at,
    summary: revision.summary,
    ...(revision.diff ? { diff: revision.diff } : {}),
    ...(revision.head !== undefined ? { head: revision.head } : {}),
  }
}

function chatSessionOutput(session: any) {
  return {
    id: session.id,
    title: session.title,
    status: session.archived ? 'archived' : session.status,
    messages: session.messages,
    ...(session.seedContext ? { ['seed-context']: session.seedContext } : {}),
    ...(session.archived ? { archived: true } : {}),
  }
}

function artifactHistoryMap(state: ManagedState) {
  const root = (state.__originCli ??= {})
  return (root.memoryArtifactRevisions ??= {})
}

function pushWorkspaceRevision(
  state: ManagedState,
  pathValue: string,
  actor: string,
  summary: string,
  content?: string,
  previousContent?: string,
) {
  state.workspace.revisions.push({
    id: nextId(state, 'wrev'),
    path: pathValue,
    actor,
    at: now(),
    summary,
    ...(previousContent !== content ? { diff: createRevisionDiff(previousContent, content) } : {}),
    ...(content !== undefined ? { content } : {}),
  })
}

function pushArtifactRevision(
  state: ManagedState,
  pathValue: string,
  actor: string,
  summary: string,
  content?: string,
  snapshot?: Record<string, unknown>,
) {
  const history = artifactHistoryMap(state)
  const revisions = history[pathValue] ?? []
  history[pathValue] = recordRevision(revisions, {
    id: nextId(state, 'rev'),
    actor,
    at: now(),
    summary,
    ...(content !== undefined ? { content } : {}),
    ...(snapshot ? { snapshot: snapshot as Record<string, any> } : {}),
    ...(content !== undefined ? { diff: createRevisionDiff(revisions.at(-1)?.content, content) } : {}),
  })
}

function managedNoteById(state: ManagedState, noteId: string) {
  return state.notes.notes.find((note) => note.id === noteId)
}

function managedNoteByPath(state: ManagedState, pathValue: string) {
  return state.notes.notes.find((note) => note.path === pathValue)
}

function managedArtifactByPath(state: ManagedState, pathValue: string) {
  return state.memory.artifacts.find((artifact) => artifact.path === pathValue)
}

function managedTargetsForPath(state: ManagedState, pathValue: string) {
  if (pathValue === workspaceFilePath) return { kind: 'memory' as const }
  const note = managedNoteByPath(state, pathValue)
  if (note) return { kind: 'note' as const, note }
  const artifact = managedArtifactByPath(state, pathValue)
  if (artifact) return { kind: 'artifact' as const, artifact }
  return { kind: 'none' as const }
}

function noteWorkspacePath(context: RouteContext, pathValue: string) {
  return join(workspaceRoot(context), pathValue)
}

function memoryFileWorkspacePath(context: RouteContext) {
  return workspaceFileAbs(context)
}

async function readText(absPath: string) {
  try {
    return await readFile(absPath, 'utf8')
  } catch {
    return undefined
  }
}

async function readBinaryBase64(absPath: string) {
  const bytes = await readFile(absPath)
  return bytes.toString('base64')
}

async function writeBinary(absPath: string, content: string, encoding: 'utf8' | 'base64') {
  await ensureParent(absPath)
  if (encoding === 'base64') {
    await writeFile(absPath, Buffer.from(content, 'base64'))
    return
  }
  await writeFile(absPath, content, 'utf8')
}

async function copyRecursive(source: string, destination: string) {
  const stats = await stat(source)
  if (stats.isDirectory()) {
    await ensureDir(destination)
    const children = await readdir(source, { withFileTypes: true })
    for (const child of children) {
      await copyRecursive(join(source, child.name), join(destination, child.name))
    }
    return
  }
  await ensureParent(destination)
  await copyFile(source, destination)
}

async function movePath(source: string, destination: string) {
  await ensureParent(destination)
  try {
    await rename(source, destination)
  } catch {
    await copyRecursive(source, destination)
    await rm(source, { recursive: true, force: true })
  }
}

async function removePath(target: string) {
  await rm(target, { recursive: true, force: true })
}

function mimeTypeFromPath(pathValue: string) {
  const ext = extname(pathValue).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'text/markdown'
  if (ext === '.json') return 'application/json'
  if (ext === '.csv') return 'text/csv'
  if (ext === '.txt') return 'text/plain'
  return 'application/octet-stream'
}

async function collectTreeEntries(baseAbs: string, baseRel = '', depth = 1): Promise<Array<{ abs: string; rel: string; stats: any }>> {
  const entries: Array<{ abs: string; rel: string; stats: any }> = []
  const baseStats = await safeStat(baseAbs)
  if (!baseStats) return entries

  if (!baseStats.isDirectory()) {
    entries.push({ abs: baseAbs, rel: baseRel || basename(baseAbs), stats: baseStats })
    return entries
  }

  if (baseRel) {
    entries.push({ abs: baseAbs, rel: baseRel, stats: baseStats })
  }

  if (depth <= 0) return entries
  const children = await readdir(baseAbs, { withFileTypes: true })
  for (const child of children) {
    const abs = join(baseAbs, child.name)
    const rel = baseRel ? `${baseRel}/${child.name}` : child.name
    const stats = await safeStat(abs)
    if (!stats) continue
    entries.push({ abs, rel, stats })
    if (stats.isDirectory() && depth > 1) {
      entries.push(...(await collectTreeEntries(abs, rel, depth - 1)))
    }
  }
  return entries
}

function toWorkspaceEntryList(context: RouteContext, entries: Array<{ abs: string; stats: any }>) {
  return entries.map(({ abs, stats }) => workspaceEntryOutput(relative(workspaceRoot(context), abs).split(sep).join('/'), stats.isDirectory() ? 'folder' : 'file', stats.mtime.toISOString()))
}

function toFileEntryList(entries: Array<{ abs: string; stats: any }>) {
  return entries.map(({ abs, stats }) => fileEntryOutput(abs, stats.isDirectory() ? 'folder' : stats.isSymbolicLink() ? 'symlink' : 'file', stats.size, stats.mtime.toISOString()))
}

function searchExcerpt(content: string, query: string) {
  const normalized = query.trim().toLowerCase()
  const line = content
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().includes(normalized))
  return line ? line.slice(0, 180) : undefined
}

async function searchHostPaths(baseAbs: string, query: string, content = true, limit = 20) {
  const matches: Array<{ path: string; excerpt?: string; score: number }> = []
  const entries = await collectTreeEntries(baseAbs, '', 32)
  for (const entry of entries) {
    const nameScore = scoreText(query, basename(entry.abs))
    let excerpt: string | undefined
    let score = nameScore
    if (content && entry.stats.isFile()) {
      const text = await readText(entry.abs)
      if (text) {
        const contentScore = scoreText(query, text)
        if (contentScore > score) score = contentScore
        if (contentScore > 0) excerpt = searchExcerpt(text, query)
      }
    }
    if (score > 0) {
      matches.push({ path: entry.abs, excerpt, score })
    }
  }
  return matches.sort((left, right) => right.score - left.score).slice(0, limit)
}

function globToRegExp(pattern: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*')
  return new RegExp(`^${escaped}$`)
}

async function globEntries(baseAbs: string, pattern: string, limit = 100) {
  const matches: Array<{ abs: string; stats: any }> = []
  const regex = globToRegExp(pattern)
  const entries = await collectTreeEntries(baseAbs, '', 64)
  for (const entry of entries) {
    const rel = relative(baseAbs, entry.abs).split(sep).join('/')
    if (regex.test(rel) || regex.test(basename(entry.abs))) {
      matches.push({ abs: entry.abs, stats: entry.stats })
    }
  }
  return matches.slice(0, limit)
}

function extractRouteArgs(context: RouteContext) {
  return context.args ?? {}
}

function extractRouteOptions(context: RouteContext) {
  return context.options ?? {}
}

function actionIdFromActivity(activity: { id: string }) {
  return [activity.id]
}

function noteRecordFromContent(note: { id: string; path: string; content: string; updatedAt: string; attachments: any[]; revisions: StoredRevisionRecord[]; history: any[]; archived?: boolean }) {
  return note
}

async function createManagedNoteArtifactLink(state: ManagedState, pathValue: string, summary: string, replicatedState = true) {
  const existing = managedArtifactByPath(state, pathValue)
  if (existing) {
    existing.kind = 'note'
    existing.summary = summary
    existing.replicatedState = replicatedState
    return existing
  }
  state.memory.artifacts.unshift({
    path: pathValue,
    kind: 'note',
    summary,
    replicatedState,
  })
  return state.memory.artifacts[0]
}

async function syncManagedNoteFromDisk(state: ManagedState, context: RouteContext, note: any) {
  const abs = noteWorkspaceAbs(context, note.path)
  const content = await readText(abs)
  if (content === undefined || content === note.content) return false
  const previous = note.content
  note.content = content
  note.updatedAt = now()
  note.title = noteTitleFromContent(content, note.path)
  const revisionId = nextId(state, 'rev')
  note.revisions = recordRevision(note.revisions, {
    id: revisionId,
    actor: 'origin/bridge',
    at: note.updatedAt,
    summary: 'Imported note change from disk.',
    diff: createRevisionDiff(previous, content),
    content,
  })
  note.history.push(createHistoryEntry(state, 'origin/bridge', 'Imported note change from disk.', revisionId))
  pushWorkspaceRevision(state, note.path, 'origin/bridge', 'Imported note change from disk.', content, previous)
  await createManagedNoteArtifactLink(state, note.path, note.title, true)
  return true
}

async function syncManagedMemoryFromDisk(state: ManagedState, context: RouteContext) {
  const abs = memoryFileWorkspacePath(context)
  const content = await readText(abs)
  if (content === undefined) return false
  const previous = memoryContent(state)
  if (content === previous) return false
  state.memory.revisions = recordRevision(state.memory.revisions, {
    id: nextId(state, 'rev'),
    actor: 'origin/bridge',
    at: now(),
    summary: 'Imported memory change from disk.',
    diff: createRevisionDiff(previous, content),
    content,
  })
  return true
}

async function syncManagedWorkspaceImports(state: ManagedState, context: RouteContext) {
  let changed = 0
  for (const note of state.notes.notes.filter((item) => !item.archived)) {
    if (await syncManagedNoteFromDisk(state, context, note)) changed += 1
  }
  if (await syncManagedMemoryFromDisk(state, context)) changed += 1
  return changed
}

function conflictSummaryForPath(pathValue: string, detail: string) {
  return `${pathValue}: ${detail}`
}

function noteConflictOutput(conflict: any) {
  return {
    id: conflict.id,
    ['note-id']: conflict.noteId,
    summary: conflict.summary,
    actors: conflict.actors,
  }
}

function workspaceConflictOutput(conflict: any) {
  return {
    id: conflict.id,
    path: conflict.path,
    summary: conflict.summary,
    actors: conflict.actors,
  }
}

async function writeManagedNote(state: ManagedState, context: RouteContext, note: any, content: string, summary: string, actor: string) {
  const previous = note.content
  note.content = content
  note.updatedAt = now()
  note.title = noteTitleFromContent(content, note.path)
  const revisionId = nextId(state, 'rev')
  note.revisions = recordRevision(note.revisions, {
    id: revisionId,
    actor,
    at: note.updatedAt,
    summary,
    diff: createRevisionDiff(previous, content),
    content,
  })
  note.history.push(createHistoryEntry(state, actor, summary, revisionId))
  pushWorkspaceRevision(state, note.path, actor, summary, content, previous)
  await createManagedNoteArtifactLink(state, note.path, note.title, true)
}

async function updateMemoryMarkdown(state: ManagedState, content: string, summary: string, actor = 'origin/cli') {
  const previous = memoryContent(state)
  state.memory.revisions = recordRevision(state.memory.revisions, {
    id: nextId(state, 'rev'),
    actor,
    at: now(),
    summary,
    diff: createRevisionDiff(previous, content),
    content,
  })
}

function latestMemoryArtifactRevision(state: ManagedState, pathValue: string) {
  return artifactHistoryMap(state)[pathValue]?.at(-1)
}

async function writeMemoryArtifactContent(
  state: ManagedState,
  context: RouteContext,
  artifact: any,
  content: string,
  summary: string,
  actor = 'origin/cli',
) {
  const abs = noteWorkspaceAbs(context, artifact.path)
  const previous = await readText(abs)
  await ensureParent(abs)
  await writeFile(abs, content, 'utf8')
  pushArtifactRevision(state, artifact.path, actor, summary, content, {
    kind: artifact.kind,
    summary: artifact.summary,
    replicatedState: artifact.replicatedState ?? false,
  })
  if (artifact.replicatedState || artifact.kind === 'note') {
    pushWorkspaceRevision(state, artifact.path, actor, summary, content, previous)
  }
}

function artifactToSearchHit(record: any, score: number, excerpt?: string) {
  return {
    kind: record.kind === 'note' ? 'note' : 'memory-artifact',
    id: record.path,
    title: inferTitleFromPath(record.path),
    score,
    ...(excerpt ? { excerpt } : {}),
    path: record.path,
  }
}

function noteToSearchHit(note: any, query: string) {
  const score = Math.max(scoreText(query, note.title), scoreText(query, note.path), scoreText(query, note.content))
  if (!score) return undefined
  return {
    kind: 'note',
    id: note.id,
    title: note.title,
    score,
    excerpt: searchExcerpt(note.content, query),
    path: note.path,
  }
}

function workspaceHitFromEntry(abs: string, rel: string, query: string, stats: any, content?: string) {
  const score = Math.max(scoreText(query, rel), scoreText(query, basename(abs)), content ? scoreText(query, content) : 0)
  if (!score) return undefined
  return {
    kind: stats.isDirectory() ? 'folder' : 'file',
    id: rel || abs,
    title: basename(abs),
    score,
    ...(content ? { excerpt: searchExcerpt(content, query) } : {}),
    path: rel,
  }
}

async function memoryArtifactContent(context: RouteContext, artifact: any) {
  if (artifact.kind === 'note') {
    const note = managedNoteByPath((await context.runtime.store.load()) as ManagedState, artifact.path)
    return note?.content
  }
  const abs = noteWorkspaceAbs(context, artifact.path)
  return readText(abs)
}

function noteAttachmentOutput(attachment: any) {
  return {
    id: attachment.id,
    name: attachment.name,
    path: attachment.path,
    ...(attachment.contentType ? { ['content-type']: attachment.contentType } : {}),
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
  }
}

function noteConflictCandidates(conflict: any) {
  return conflict.candidates?.map((candidate: any) => ({
    id: candidate.id,
    label: candidate.label,
    summary: candidate.summary,
    ...(candidate.revisionId ? { ['revision-id']: candidate.revisionId } : {}),
  }))
}

function workspaceConflictCandidates(conflict: any) {
  return conflict.candidates?.map((candidate: any) => ({
    id: candidate.id,
    label: candidate.label,
    summary: candidate.summary,
    ...(candidate.revisionId ? { ['revision-id']: candidate.revisionId } : {}),
  }))
}

async function resolvedRevisionContent(state: ManagedState, pathValue: string, revisionId: string | undefined) {
  if (!revisionId) return undefined
  const note = managedNoteByPath(state, pathValue)
  if (note) {
    const revision = note.revisions.find((item) => item.id === revisionId)
    return revision?.content
  }
  const artifactRevision = artifactHistoryMap(state)[pathValue]?.find((item) => item.id === revisionId)
  return artifactRevision?.content
}

async function restoreManagedPath(
  state: ManagedState,
  context: RouteContext,
  pathValue: string,
  revisionId: string,
  actor: string,
  summary: string,
) {
  const note = managedNoteByPath(state, pathValue)
  if (note) {
    const revision = note.revisions.find((item) => item.id === revisionId)
    if (!revision?.content) return undefined
    await writeManagedNote(state, context, note, revision.content, summary, actor)
    return note
  }
  const artifactRevision = artifactHistoryMap(state)[pathValue]?.find((item) => item.id === revisionId)
  if (!artifactRevision?.content) return undefined
  const artifact = managedArtifactByPath(state, pathValue)
  if (!artifact) return undefined
  await writeMemoryArtifactContent(state, context, artifact, artifactRevision.content, summary, actor)
  return artifact
}

async function noteCreateLike(state: ManagedState, context: RouteContext, pathValue: string, title: string | undefined, content: string, actor = 'origin/cli') {
  const rel = toWorkspaceRel(context, pathValue)
  if (rel === undefined) return undefined
  const existing = managedNoteByPath(state, rel)
  const note = existing ?? {
    id: nextId(state, 'note'),
    title: title ?? noteTitleFromContent(content, rel),
    path: rel,
    content,
    updatedAt: now(),
    attachments: [],
    revisions: [],
    history: [],
  }
  if (existing) {
    await writeManagedNote(state, context, existing, content, existing.title || title || noteTitleFromContent(content, rel), actor)
    await createManagedNoteArtifactLink(state, rel, existing.title, true)
    return existing
  }
  const revisionId = nextId(state, 'rev')
  note.revisions = recordRevision(note.revisions, {
    id: revisionId,
    actor,
    at: note.updatedAt,
    summary: 'Created note.',
    diff: createRevisionDiff(undefined, content),
    content,
  })
  note.history.push(createHistoryEntry(state, actor, 'Created note.', revisionId))
  state.notes.notes.unshift(note)
  pushWorkspaceRevision(state, rel, actor, 'Created note.', content)
  await createManagedNoteArtifactLink(state, rel, note.title, true)
  return note
}

async function deleteNoteLike(state: ManagedState, context: RouteContext, note: any, actor = 'origin/cli') {
  const abs = noteWorkspaceAbs(context, note.path)
  await removePath(abs)
  note.archived = true
  note.updatedAt = now()
  note.history.push(createHistoryEntry(state, actor, 'Archived note.', note.revisions.at(-1)?.id))
  state.memory.artifacts = state.memory.artifacts.filter((artifact) => artifact.path !== note.path)
  pushWorkspaceRevision(state, note.path, actor, 'Archived note.', undefined, note.content)
}

function normalizeRevisionList(revisions: StoredRevisionRecord[], pathValue: string) {
  return revisions.map((revision) => revisionOutput(pathValue, revision))
}

function noteRevisionOutput(revision: StoredRevisionRecord) {
  return {
    id: revision.id,
    actor: revision.actor,
    at: revision.at,
    summary: revision.summary,
    ...(revision.head !== undefined ? { head: revision.head } : {}),
    ...(revision.diff ? { diff: revision.diff } : {}),
  }
}

function activitySummaryFor(items: Array<{ kind: string }>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1
    return acc
  }, {})
}

async function handleChat(context: RouteContext) {
  const route = routeKey(context)
  if (route === 'chat list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const archived = Boolean(extractRouteOptions(context).archived)
    const limit = Number(extractRouteOptions(context).limit ?? 20)
    const sessions = state.chat.sessions
      .filter((session) => (archived ? true : !session.archived))
      .slice(0, limit)
      .map(chatSessionOutput)
    return createListResult(sessions, { total: sessions.length, summary: 'Chat sessions.' })
  }

  if (route === 'chat create') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const options = extractRouteOptions(context)
      const sessionId = nextId(state, 'chat')
      state.chat.sessions.unshift({
        id: sessionId,
        title: options.title ? String(options.title) : undefined,
        status: 'active',
        archived: false,
        seedContext: Array.isArray(options['seed-context']) ? options['seed-context'].map(String) : [],
        messages: [],
      })
      const activity = addActivity(state, {
        kind: 'chat.session.create',
        status: 'completed',
        actor: 'origin/cli',
        target: sessionId,
        summary: `Created chat session ${sessionId}.`,
        severity: 'info',
      })
      return createActionResult('Created a new chat session.', {
        affectedIds: [sessionId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'chat get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const session = state.chat.sessions.find((item) => item.id === String(extractRouteArgs(context)['session-id']))
    if (!session) return context.error({ code: 'NOT_FOUND', message: `Unknown chat session: ${String(extractRouteArgs(context)['session-id'])}` })
    return chatSessionOutput(session)
  }

  if (route === 'chat send') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const sessionId = String(extractRouteArgs(context)['session-id'])
      const session = state.chat.sessions.find((item) => item.id === sessionId)
      if (!session) return context.error({ code: 'NOT_FOUND', message: `Unknown chat session: ${sessionId}` })
      const messageId = nextId(state, 'chat_msg')
      session.messages.push({
        id: messageId,
        role: 'user',
        body: String(extractRouteOptions(context).message),
        at: now(),
      })
      const replyId = nextId(state, 'chat_msg')
      session.messages.push({
        id: replyId,
        role: 'assistant',
        body: 'Acknowledged. The message has been recorded in Origin state.',
        at: now(),
      })
      const activity = addActivity(state, {
        kind: 'chat.message.send',
        status: 'completed',
        actor: 'origin/cli',
        target: sessionId,
        summary: `Added a message to chat session ${sessionId}.`,
        severity: 'info',
      })
      return createActionResult(`Added a message to chat session ${sessionId}.`, {
        affectedIds: [sessionId, messageId, replyId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'chat rename') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const sessionId = String(extractRouteArgs(context)['session-id'])
      const session = state.chat.sessions.find((item) => item.id === sessionId)
      if (!session) return context.error({ code: 'NOT_FOUND', message: `Unknown chat session: ${sessionId}` })
      session.title = String(extractRouteOptions(context).title)
      const activity = addActivity(state, {
        kind: 'chat.session.rename',
        status: 'completed',
        actor: 'origin/cli',
        target: sessionId,
        summary: `Renamed chat session ${sessionId}.`,
        severity: 'info',
      })
      return createActionResult(`Renamed chat session ${sessionId}.`, {
        affectedIds: [sessionId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'chat archive') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const sessionId = String(extractRouteArgs(context)['session-id'])
      const session = state.chat.sessions.find((item) => item.id === sessionId)
      if (!session) return context.error({ code: 'NOT_FOUND', message: `Unknown chat session: ${sessionId}` })
      session.archived = true
      session.status = 'archived'
      const activity = addActivity(state, {
        kind: 'chat.session.archive',
        status: 'completed',
        actor: 'origin/cli',
        target: sessionId,
        summary: `Archived chat session ${sessionId}.`,
        severity: 'info',
      })
      return createActionResult(`Archived chat session ${sessionId}.`, {
        affectedIds: [sessionId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'chat delete') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const sessionId = String(extractRouteArgs(context)['session-id'])
      const before = state.chat.sessions.length
      state.chat.sessions = state.chat.sessions.filter((item) => item.id !== sessionId)
      if (state.chat.sessions.length === before) return context.error({ code: 'NOT_FOUND', message: `Unknown chat session: ${sessionId}` })
      const activity = addActivity(state, {
        kind: 'chat.session.delete',
        status: 'completed',
        actor: 'origin/cli',
        target: sessionId,
        summary: `Deleted chat session ${sessionId}.`,
        severity: 'warn',
      })
      return createActionResult(`Deleted chat session ${sessionId}.`, {
        affectedIds: [sessionId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'chat outbox') {
    const state = (await context.runtime.store.load()) as ManagedState
    const sessionId = state.chat.sessions[0]?.id ?? 'chat_0001'
    const items = state.chat.outbox.map((item) => ({
      id: item.id,
      ['session-id']: sessionId,
      status: item.status,
      body: item.summary,
    }))
    return createListResult(items, { total: items.length, summary: 'Chat outbox items.' })
  }

  return context.error({ code: 'NOT_FOUND', message: `Unhandled chat command: ${context.route}` })
}

async function handleMemory(context: RouteContext) {
  const route = routeKey(context)
  if (route === 'memory get') {
    const state = (await context.runtime.store.load()) as ManagedState
    return {
      path: workspaceFileAbs(context),
      content: memoryContent(state),
      ['linked-artifacts']: state.memory.artifacts.map((artifact) => artifact.path),
    }
  }

  if (route === 'memory update') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const options = extractRouteOptions(context)
      const mode = String(options.mode)
      const content = String(options.content ?? '')
      const previous = memoryContent(state)
      const next =
        mode === 'append'
          ? previous
            ? `${previous}${previous.endsWith('\n') ? '' : '\n'}${content}`
            : content
          : mode === 'replace-section'
            ? replaceSection(previous, options.section ? String(options.section) : undefined, content)
            : applyPatchLike(previous, content)
      state.memory.revisions = recordRevision(state.memory.revisions, {
        id: nextId(state, 'rev'),
        actor: 'origin/cli',
        at: now(),
        summary: `Updated memory file (${mode}).`,
        diff: createRevisionDiff(previous, next),
        content: next,
      })
      const activity = addActivity(state, {
        kind: 'memory.update',
        status: 'completed',
        actor: 'origin/cli',
        target: workspaceFilePath,
        summary: `Updated ${workspaceFilePath}.`,
        severity: 'info',
      })
      return createActionResult(`Updated ${workspaceFilePath}.`, {
        affectedIds: [workspaceFilePath],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory add') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const options = extractRouteOptions(context)
      const previous = memoryContent(state)
      const addition = String(options.content ?? '').trim()
      const reason = options.reason ? `\n\n> Reason: ${String(options.reason)}` : ''
      const block = `${addition}${reason}`
      const next = previous ? `${previous}${previous.endsWith('\n') ? '' : '\n'}\n## Durable memory\n- ${block}` : `# Origin Memory\n\n## Durable memory\n- ${block}`
      state.memory.revisions = recordRevision(state.memory.revisions, {
        id: nextId(state, 'rev'),
        actor: 'origin/cli',
        at: now(),
        summary: 'Added durable memory item.',
        diff: createRevisionDiff(previous, next),
        content: next,
      })
      const activity = addActivity(state, {
        kind: 'memory.add',
        status: 'completed',
        actor: 'origin/cli',
        target: workspaceFilePath,
        summary: 'Added a durable memory item.',
        severity: 'info',
      })
      return createActionResult('Added a durable memory item.', {
        affectedIds: [workspaceFilePath],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory search') {
    const state = (await context.runtime.store.load()) as ManagedState
    const options = extractRouteOptions(context)
    const query = String(options.query)
    const limit = Number(options.limit ?? 20)
    const hits: Array<any> = []
    const memoryHit = artifactToSearchHit(
      { kind: 'note', path: workspaceFilePath, summary: 'Origin memory file', replicatedState: true },
      scoreText(query, memoryContent(state)),
      searchExcerpt(memoryContent(state), query),
    )
    if (memoryHit.score > 0) hits.push(memoryHit)
    for (const artifact of state.memory.artifacts) {
      const score = Math.max(scoreText(query, artifact.path), scoreText(query, artifact.summary), scoreText(query, artifact.kind))
      if (!score) continue
      const content = artifact.kind === 'note' ? managedNoteByPath(state, artifact.path)?.content : await readText(noteWorkspaceAbs(context, artifact.path))
      hits.push(artifactToSearchHit(artifact, score, content ? searchExcerpt(content, query) : undefined))
    }
    return createListResult(takeLimit(hits.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)), limit), {
      total: hits.length,
      summary: `Found ${hits.length} memory hit(s) for "${query}".`,
    })
  }

  if (route === 'memory related') {
    const state = (await context.runtime.store.load()) as ManagedState
    const options = extractRouteOptions(context)
    const seed = String(options.goal ?? options.entity ?? 'memory')
    const entities = [
      ...state.memory.artifacts.slice(0, 5).map((artifact) => ({
        kind: artifact.kind,
        id: artifact.path,
        title: inferTitleFromPath(artifact.path),
      })),
      ...state.notes.notes.slice(0, 5).map((note) => ({
        kind: 'note',
        id: note.id,
        title: note.title,
      })),
    ]
    return {
      summary: `Related memory context for ${seed}.`,
      entities: takeLimit(entities, Number(options.limit ?? 8)),
      notes: takeLimit(
        state.notes.notes
          .filter((note) => includesQuery(note.title, options.goal) || includesQuery(note.content, options.goal) || includesQuery(note.path, options.entity))
          .map((note) => note.title),
        Number(options.limit ?? 8),
      ),
      highlights: [
        `Memory holds ${state.memory.artifacts.length} linked artifact(s).`,
        `Origin/Memory.md currently has ${state.memory.revisions.length} revision(s).`,
      ],
    }
  }

  if (route === 'memory history' || route === 'memory revision list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const revisions = state.memory.revisions.map(noteRevisionOutput)
    return createListResult(revisions, { total: revisions.length, summary: 'Memory revisions.' })
  }

  if (route === 'memory revision get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const revision = state.memory.revisions.find((item) => item.id === String(extractRouteArgs(context)['revision-id']))
    if (!revision) return context.error({ code: 'NOT_FOUND', message: `Unknown memory revision: ${String(extractRouteArgs(context)['revision-id'])}` })
    return noteRevisionOutput(revision)
  }

  if (route === 'memory revision diff') {
    const state = (await context.runtime.store.load()) as ManagedState
    const revision = state.memory.revisions.find((item) => item.id === String(extractRouteArgs(context)['revision-id']))
    if (!revision) return context.error({ code: 'NOT_FOUND', message: `Unknown memory revision: ${String(extractRouteArgs(context)['revision-id'])}` })
    const againstId = extractRouteOptions(context).against ? String(extractRouteOptions(context).against) : undefined
    const against = againstId ? state.memory.revisions.find((item) => item.id === againstId) : state.memory.revisions.at(-2)
    return createRevisionDiff(against?.content, revision.content, ['content'])
  }

  if (route === 'memory restore') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const revisionId = String(extractRouteArgs(context)['revision-id'])
      const revision = state.memory.revisions.find((item) => item.id === revisionId)
      if (!revision?.content) return context.error({ code: 'NOT_FOUND', message: `Unknown memory revision: ${revisionId}` })
      const previous = memoryContent(state)
      state.memory.revisions = recordRevision(state.memory.revisions, {
        id: nextId(state, 'rev'),
        actor: 'origin/cli',
        at: now(),
        summary: `Restored memory revision ${revisionId}.`,
        diff: createRevisionDiff(previous, revision.content),
        content: revision.content,
      })
      const activity = addActivity(state, {
        kind: 'memory.restore',
        status: 'completed',
        actor: 'origin/cli',
        target: workspaceFilePath,
        summary: `Restored ${workspaceFilePath} to revision ${revisionId}.`,
        severity: 'info',
      })
      return createActionResult(`Restored ${workspaceFilePath} to revision ${revisionId}.`, {
        affectedIds: [workspaceFilePath, revisionId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory validate') {
    const state = (await context.runtime.store.load()) as ManagedState
    const checks: Array<{
      id: string
      kind: string
      target: string
      status: 'pass' | 'warn' | 'fail'
      message: string
      remediation?: string[]
    }> = [
      {
        id: 'memory-file',
        kind: 'file',
        target: workspaceFilePath,
        status: memoryContent(state).trim() ? 'pass' : 'fail',
        message: memoryContent(state).trim() ? 'Memory file has content.' : 'Memory file is empty.',
        remediation: memoryContent(state).trim() ? undefined : ['Add durable memory with `origin memory add`.'],
      },
      {
        id: 'artifact-links',
        kind: 'links',
        target: 'memory.artifacts',
        status: state.memory.artifacts.length ? 'pass' : 'warn',
        message: state.memory.artifacts.length ? 'Memory artifacts are linked.' : 'No linked memory artifacts found.',
        remediation: state.memory.artifacts.length ? undefined : ['Create or link a memory artifact.'],
      },
      {
        id: 'workspace-files',
        kind: 'filesystem',
        target: workspaceRoot(context),
        status: state.notes.notes.every((note) => note.archived || includesQuery(note.content, '#')) ? 'pass' : 'warn',
        message: 'Managed notes can be materialized from state.',
      },
    ]
    return createValidationResult(checks, 'Validated memory structure and linked artifacts.')
  }

  if (route === 'memory artifact list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const items = state.memory.artifacts.map(memoryArtifactOutput)
    return createListResult(items, { total: items.length, summary: 'Memory artifacts.' })
  }

  if (route === 'memory artifact get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const pathValue = String(extractRouteArgs(context).path)
    const artifact = managedArtifactByPath(state, pathValue)
    if (!artifact) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact: ${pathValue}` })
    return memoryArtifactOutput(artifact)
  }

  if (route === 'memory artifact search') {
    const state = (await context.runtime.store.load()) as ManagedState
    const query = String(extractRouteOptions(context).query)
    const limit = Number(extractRouteOptions(context).limit ?? 20)
    const hits = state.memory.artifacts
      .map((artifact) => {
        const score = Math.max(scoreText(query, artifact.path), scoreText(query, artifact.summary), scoreText(query, artifact.kind))
        if (!score) return undefined
        return artifactToSearchHit(artifact, score, artifact.summary)
      })
      .filter(Boolean)
    return createListResult(takeLimit((hits as any[]).sort((left, right) => (right.score ?? 0) - (left.score ?? 0)), limit), {
      total: (hits as any[]).length,
      summary: `Found ${(hits as any[]).length} memory artifact hit(s) for "${query}".`,
    })
  }

  if (route === 'memory artifact create') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const options = extractRouteOptions(context)
      const pathValue = toWorkspaceRel(context, String(options.path))
      if (pathValue === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(options.path)}` })
      const kind = String(options.kind)
      const summary = String(options.summary ?? inferTitleFromPath(pathValue))
      const existing = managedArtifactByPath(state, pathValue)
      const abs = noteWorkspaceAbs(context, pathValue)
      if (kind === 'folder') {
        await ensureDir(abs)
      } else if (kind === 'note') {
        await noteCreateLike(state, context, pathValue, summary, `# ${summary}\n`, 'origin/cli')
      } else {
        await ensureParent(abs)
        const content =
          kind === 'json'
            ? '{}\n'
            : kind === 'csv'
              ? 'column,value\n'
              : kind === 'markdown-table'
                ? `# ${summary}\n\n| Key | Value |\n| --- | --- |\n`
                : ''
        if (content) await writeFile(abs, content, 'utf8')
      }
      const linkedNote = kind === 'note' ? managedNoteByPath(state, pathValue) : undefined
      if (existing) {
        existing.kind = kind
        existing.summary = summary
        existing.replicatedState = kind === 'note' ? true : existing.replicatedState
      } else if (!linkedNote) {
        state.memory.artifacts.unshift({
          path: pathValue,
          kind,
          summary,
          replicatedState: kind === 'note' ? true : false,
        })
      } else {
        linkedNote.title = summary
      }
      pushArtifactRevision(state, pathValue, 'origin/cli', `Created memory artifact (${kind}).`, kind === 'folder' ? undefined : contentForArtifactKind(kind, summary), {
        kind,
        summary,
        replicatedState: kind === 'note' ? true : false,
      })
      const activity = addActivity(state, {
        kind: 'memory.artifact.create',
        status: 'completed',
        actor: 'origin/cli',
        target: pathValue,
        summary: `Created memory artifact ${pathValue}.`,
        severity: 'info',
      })
      return createActionResult(`Created memory artifact ${pathValue}.`, {
        affectedIds: [pathValue],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory artifact update') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const pathValue = String(extractRouteArgs(context).path)
      const artifact = managedArtifactByPath(state, pathValue)
      if (!artifact) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact: ${pathValue}` })
      const summary = String(extractRouteOptions(context).summary ?? artifact.summary)
      artifact.summary = summary
      pushArtifactRevision(state, pathValue, 'origin/cli', `Updated memory artifact ${pathValue}.`, undefined, {
        kind: artifact.kind,
        summary,
        replicatedState: artifact.replicatedState ?? false,
      })
      const activity = addActivity(state, {
        kind: 'memory.artifact.update',
        status: 'completed',
        actor: 'origin/cli',
        target: pathValue,
        summary: `Updated memory artifact ${pathValue}.`,
        severity: 'info',
      })
      return createActionResult(`Updated memory artifact ${pathValue}.`, {
        affectedIds: [pathValue],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory artifact move') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const pathValue = String(extractRouteArgs(context).path)
      const artifact = managedArtifactByPath(state, pathValue)
      if (!artifact) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact: ${pathValue}` })
      const toValue = toWorkspaceRel(context, String(extractRouteOptions(context).to))
      if (toValue === undefined) return context.error({ code: 'INVALID_INPUT', message: `Destination must be inside the workspace root: ${String(extractRouteOptions(context).to)}` })
      const fromAbs = noteWorkspaceAbs(context, pathValue)
      const toAbs = noteWorkspaceAbs(context, toValue)
      await movePath(fromAbs, toAbs)
      artifact.path = toValue
      const history = artifactHistoryMap(state)
      history[toValue] = history[pathValue] ?? []
      delete history[pathValue]
      pushArtifactRevision(state, toValue, 'origin/cli', `Moved memory artifact from ${pathValue} to ${toValue}.`, artifact.kind === 'folder' ? undefined : await readText(toAbs), {
        kind: artifact.kind,
        summary: artifact.summary,
        replicatedState: artifact.replicatedState ?? false,
      })
      const activity = addActivity(state, {
        kind: 'memory.artifact.move',
        status: 'completed',
        actor: 'origin/cli',
        target: toValue,
        summary: `Moved memory artifact to ${toValue}.`,
        severity: 'info',
      })
      return createActionResult(`Moved memory artifact to ${toValue}.`, {
        affectedIds: [pathValue, toValue],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory artifact delete') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const pathValue = String(extractRouteArgs(context).path)
      const artifact = managedArtifactByPath(state, pathValue)
      if (!artifact) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact: ${pathValue}` })
      const abs = noteWorkspaceAbs(context, pathValue)
      await removePath(abs)
      state.memory.artifacts = state.memory.artifacts.filter((item) => item.path !== pathValue)
      delete artifactHistoryMap(state)[pathValue]
      const activity = addActivity(state, {
        kind: 'memory.artifact.delete',
        status: 'completed',
        actor: 'origin/cli',
        target: pathValue,
        summary: `Deleted memory artifact ${pathValue}.`,
        severity: 'warn',
      })
      return createActionResult(`Deleted memory artifact ${pathValue}.`, {
        affectedIds: [pathValue],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory artifact link') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const options = extractRouteOptions(context)
      const pathValue = String(options.path)
      const rel = toWorkspaceRel(context, pathValue)
      if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${pathValue}` })
      const existing = managedArtifactByPath(state, rel)
      if (existing) {
        existing.summary = String(options.summary)
      } else {
        state.memory.artifacts.unshift({
          path: rel,
          kind: managedNoteByPath(state, rel) ? 'note' : extname(rel) ? extname(rel).slice(1) || 'file' : 'file',
          summary: String(options.summary),
          replicatedState: Boolean(managedNoteByPath(state, rel)),
        })
      }
      const activity = addActivity(state, {
        kind: 'memory.artifact.link',
        status: 'completed',
        actor: 'origin/cli',
        target: rel,
        summary: `Linked artifact ${rel}.`,
        severity: 'info',
      })
      return createActionResult(`Linked artifact ${rel}.`, {
        affectedIds: [rel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory artifact unlink') {
    return context.runtime.store.mutate((state: ManagedState) => {
      const pathValue = String(extractRouteArgs(context).path)
      const rel = toWorkspaceRel(context, pathValue)
      if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${pathValue}` })
      state.memory.artifacts = state.memory.artifacts.filter((item) => item.path !== rel)
      const activity = addActivity(state, {
        kind: 'memory.artifact.unlink',
        status: 'completed',
        actor: 'origin/cli',
        target: rel,
        summary: `Unlinked artifact ${rel}.`,
        severity: 'info',
      })
      return createActionResult(`Unlinked artifact ${rel}.`, {
        affectedIds: [rel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory artifact history') {
    const state = (await context.runtime.store.load()) as ManagedState
    const pathValue = String(extractRouteArgs(context).path)
    const artifact = managedArtifactByPath(state, pathValue)
    if (!artifact) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact: ${pathValue}` })
    if (artifact.kind === 'note') {
      const note = managedNoteByPath(state, artifact.path)
      const revisions = note ? note.revisions.map(noteRevisionOutput) : []
      return createListResult(revisions, { total: revisions.length, summary: 'Artifact revisions.' })
    }
    const revisions = (artifactHistoryMap(state)[pathValue] ?? []).map((revision) => revisionOutput(pathValue, revision))
    return createListResult(revisions, { total: revisions.length, summary: 'Artifact revisions.' })
  }

  if (route === 'memory artifact restore') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const pathValue = String(extractRouteArgs(context).path)
      const revisionId = String(extractRouteArgs(context)['revision-id'])
      const artifact = managedArtifactByPath(state, pathValue)
      if (!artifact) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact: ${pathValue}` })
      if (artifact.kind === 'note') {
        const note = managedNoteByPath(state, artifact.path)
        const revision = note?.revisions.find((item) => item.id === revisionId)
        if (!note || !revision?.content) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact revision: ${revisionId}` })
        await writeManagedNote(state, context, note, revision.content, `Restored memory artifact ${pathValue} to revision ${revisionId}.`, 'origin/cli')
      } else {
        const revision = artifactHistoryMap(state)[pathValue]?.find((item) => item.id === revisionId)
        if (!revision?.content) return context.error({ code: 'NOT_FOUND', message: `Unknown memory artifact revision: ${revisionId}` })
        await writeMemoryArtifactContent(state, context, artifact, revision.content, `Restored memory artifact ${pathValue} to revision ${revisionId}.`)
      }
      const activity = addActivity(state, {
        kind: 'memory.artifact.restore',
        status: 'completed',
        actor: 'origin/cli',
        target: pathValue,
        summary: `Restored memory artifact ${pathValue} to revision ${revisionId}.`,
        severity: 'info',
      })
      return createActionResult(`Restored memory artifact ${pathValue} to revision ${revisionId}.`, {
        affectedIds: [pathValue, revisionId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'memory revision get') {
    // already handled above
  }

  return context.error({ code: 'NOT_FOUND', message: `Unhandled memory command: ${context.route}` })
}

function contentForArtifactKind(kind: string, summary: string) {
  if (kind === 'note') return `# ${summary}\n`
  if (kind === 'json') return '{}\n'
  if (kind === 'csv') return 'column,value\n'
  if (kind === 'markdown-table') return `# ${summary}\n\n| Key | Value |\n| --- | --- |\n`
  return ''
}

async function handleWorkspace(context: RouteContext) {
  const route = routeKey(context)
  if (route === 'workspace status' || route === 'workspace bridge status') {
    const state = (await context.runtime.store.load()) as ManagedState
    return {
      root: workspaceRoot(context),
      vault: vaultRoot(context),
      summary: `Workspace has ${state.notes.notes.filter((note) => !note.archived).length} managed note(s) and ${state.memory.artifacts.length} artifact(s).`,
      ['index-status']: state.workspace.indexStatus,
      ['bridge-status']: state.workspace.bridgeStatus,
    }
  }

  if (route === 'workspace tree') {
    const state = (await context.runtime.store.load()) as ManagedState
    const options = extractRouteOptions(context)
    const base = options.path ? noteWorkspaceAbs(context, String(options.path)) : workspaceRoot(context)
    const depth = Number(options.depth ?? 1)
    const entries = await collectTreeEntries(base, options.path ? String(options.path).split(sep).join('/') : '', depth)
    const items = toWorkspaceEntryList(context, entries)
    return createListResult(items, { total: items.length, summary: 'Workspace tree entries.' })
  }

  if (route === 'workspace recent') {
    const options = extractRouteOptions(context)
    const base = workspaceRoot(context)
    const entries = await collectTreeEntries(base, '', 32)
    const items = await Promise.all(
      entries.map(async ({ abs, stats }) => workspaceEntryOutput(relative(base, abs).split(sep).join('/'), stats.isDirectory() ? 'folder' : 'file', stats.mtime.toISOString())),
    )
    const filtered = items
      .filter((item) => selectWindow([{ at: item['last-modified-at'] } as any], options.since, options.until).length > 0)
      .sort((left, right) => cmpDateDescending(left['last-modified-at'], right['last-modified-at']))
    const limited = takeLimit(filtered, Number(options.limit ?? 20))
    return createListResult(limited, { total: limited.length, summary: 'Recent workspace entries.' })
  }

  if (route === 'workspace search') {
    const options = extractRouteOptions(context)
    const query = String(options.query)
    const limit = Number(options.limit ?? 20)
    const base = workspaceRoot(context)
    const entries = await collectTreeEntries(base, '', 32)
    const hits: Array<any> = []
    for (const entry of entries) {
      if (!entry.stats.isFile()) {
        const hit = workspaceHitFromEntry(entry.abs, relative(base, entry.abs).split(sep).join('/'), query, entry.stats)
        if (hit) hits.push(hit)
        continue
      }
      const text = await readText(entry.abs)
      const hit = workspaceHitFromEntry(entry.abs, relative(base, entry.abs).split(sep).join('/'), query, entry.stats, text)
      if (hit) hits.push(hit)
    }
    const limited = takeLimit(hits.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)), limit)
    return createListResult(limited, { total: limited.length, summary: `Found ${limited.length} workspace hit(s) for "${query}".` })
  }

  if (route === 'workspace resolve') {
    const state = (await context.runtime.store.load()) as ManagedState
    const query = String(extractRouteOptions(context).query)
    const base = workspaceRoot(context)
    const exactNote = state.notes.notes.find((note) => note.path === query || note.title === query)
    const exactArtifact = state.memory.artifacts.find((artifact) => artifact.path === query)
    const entries = await collectTreeEntries(base, '', 16)
    const candidates: Array<any> = []
    if (exactNote) candidates.push(workspaceEntryOutput(exactNote.path, 'file', exactNote.updatedAt))
    if (exactArtifact) candidates.push(workspaceEntryOutput(exactArtifact.path, exactArtifact.kind === 'folder' ? 'folder' : 'file'))
    for (const entry of entries) {
      const rel = relative(base, entry.abs).split(sep).join('/')
      const score = Math.max(scoreText(query, rel), scoreText(query, basename(entry.abs)))
      if (!score) continue
      candidates.push(workspaceEntryOutput(rel, entry.stats.isDirectory() ? 'folder' : 'file', entry.stats.mtime.toISOString()))
    }
    const unique = candidates.filter((candidate, index, all) => all.findIndex((item) => item.path === candidate.path) === index)
    return createListResult(takeLimit(unique, 12), { total: unique.length, summary: `Workspace resolution candidates for "${query}".` })
  }

  if (route === 'workspace stat') {
    const state = (await context.runtime.store.load()) as ManagedState
    const rel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
    if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
    const note = managedNoteByPath(state, rel)
    if (note) return workspaceEntryOutput(note.path, 'file', note.updatedAt)
    const artifact = managedArtifactByPath(state, rel)
    if (artifact) return workspaceEntryOutput(artifact.path, artifact.kind === 'folder' ? 'folder' : 'file')
    const abs = noteWorkspaceAbs(context, rel)
    const stats = await safeStat(abs)
    if (!stats) return context.error({ code: 'NOT_FOUND', message: `Unknown workspace path: ${rel}` })
    return workspaceEntryOutput(rel, stats.isDirectory() ? 'folder' : 'file', stats.mtime.toISOString())
  }

  if (route === 'workspace read') {
    const state = (await context.runtime.store.load()) as ManagedState
    const rel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
    if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
    const note = managedNoteByPath(state, rel)
    if (note) {
      return {
        path: rel,
        encoding: 'utf8',
        content: note.content,
      }
    }
    if (rel === workspaceFilePath) {
      return {
        path: rel,
        encoding: 'utf8',
        content: memoryContent(state),
      }
    }
    const abs = noteWorkspaceAbs(context, rel)
    const content = await readText(abs)
    if (content === undefined) return context.error({ code: 'NOT_FOUND', message: `Unknown workspace file: ${rel}` })
    return {
      path: rel,
      encoding: 'utf8',
      content,
    }
  }

  if (route === 'workspace write' || route === 'workspace patch') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const rel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
      if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
      const options = extractRouteOptions(context)
      const isPatch = route === 'workspace patch'
      const contentInput = String(isPatch ? options.patch : options.content ?? '')
      if (rel === workspaceFilePath) {
        const next = isPatch ? applyPatchLike(memoryContent(state), contentInput) : contentInput
        await updateMemoryMarkdown(state, next, `Updated ${workspaceFilePath}.`)
      } else {
        const note = managedNoteByPath(state, rel)
        if (note) {
          const next = isPatch ? applyPatchLike(note.content, contentInput) : contentInput
          await writeManagedNote(state, context, note, next, isPatch ? `Patched note ${rel}.` : `Wrote note ${rel}.`, 'origin/cli')
        } else {
          const artifact = managedArtifactByPath(state, rel)
          if (artifact && artifact.kind !== 'folder') {
            const previousContent = (await readText(noteWorkspaceAbs(context, rel))) ?? ''
            const next = isPatch ? applyPatchLike(previousContent, contentInput) : contentInput
            await writeMemoryArtifactContent(state, context, artifact, next, isPatch ? `Patched artifact ${rel}.` : `Wrote artifact ${rel}.`)
          } else {
            const abs = noteWorkspaceAbs(context, rel)
            await writeBinary(abs, contentInput, 'utf8')
          }
        }
      }
      const activity = addActivity(state, {
        kind: isPatch ? 'workspace.patch' : 'workspace.write',
        status: 'completed',
        actor: 'origin/cli',
        target: rel,
        summary: `${isPatch ? 'Patched' : 'Wrote'} workspace path ${rel}.`,
        severity: 'info',
      })
      return createActionResult(`${isPatch ? 'Patched' : 'Wrote'} workspace path ${rel}.`, {
        affectedIds: [rel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'workspace mkdir') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const rel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
      if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
      await ensureDir(noteWorkspaceAbs(context, rel))
      const activity = addActivity(state, {
        kind: 'workspace.mkdir',
        status: 'completed',
        actor: 'origin/cli',
        target: rel,
        summary: `Created workspace directory ${rel}.`,
        severity: 'info',
      })
      return createActionResult(`Created workspace directory ${rel}.`, {
        affectedIds: [rel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'workspace move' || route === 'workspace copy') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const fromRel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
      if (fromRel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
      if (fromRel === workspaceFilePath) return context.error({ code: 'INVALID_OPERATION', message: 'Origin/Memory.md cannot be moved or copied.' })
      const toRel = toWorkspaceRel(context, String(extractRouteOptions(context).to))
      if (toRel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Destination must be inside the workspace root: ${String(extractRouteOptions(context).to)}` })
      const sourceAbs = noteWorkspaceAbs(context, fromRel)
      const destinationAbs = noteWorkspaceAbs(context, toRel)
      const sourceNote = managedNoteByPath(state, fromRel)
      const sourceArtifact = managedArtifactByPath(state, fromRel)
      if (route === 'workspace move') {
        await movePath(sourceAbs, destinationAbs)
      } else {
        await copyRecursive(sourceAbs, destinationAbs)
      }
      if (sourceNote) {
        if (route === 'workspace move') {
          sourceNote.path = toRel
          sourceNote.title = noteTitleFromContent(sourceNote.content, toRel)
          state.memory.artifacts = state.memory.artifacts.filter((artifact) => artifact.path !== fromRel)
          await createManagedNoteArtifactLink(state, toRel, sourceNote.title, true)
          pushWorkspaceRevision(state, toRel, 'origin/cli', `Moved note from ${fromRel} to ${toRel}.`, sourceNote.content)
        } else {
          const copy: any = {
            ...sourceNote,
            id: nextId(state, 'note'),
            path: toRel,
            title: noteTitleFromContent(sourceNote.content, toRel),
            attachments: sourceNote.attachments.map((attachment: any) => ({ ...attachment, id: nextId(state, 'att') })),
            revisions: [],
            history: [],
          }
          const revisionId = nextId(state, 'rev')
          copy.revisions = recordRevision(copy.revisions, {
            id: revisionId,
            actor: 'origin/cli',
            at: now(),
            summary: `Copied from ${fromRel}.`,
            diff: createRevisionDiff(undefined, copy.content),
            content: copy.content,
          })
          copy.history.push(createHistoryEntry(state, 'origin/cli', `Copied from ${fromRel}.`, revisionId))
          state.notes.notes.unshift(copy)
          await createManagedNoteArtifactLink(state, toRel, copy.title, true)
          pushWorkspaceRevision(state, toRel, 'origin/cli', `Copied note from ${fromRel} to ${toRel}.`, copy.content)
        }
      } else if (sourceArtifact) {
        if (route === 'workspace move') {
          sourceArtifact.path = toRel
          const history = artifactHistoryMap(state)
          history[toRel] = history[fromRel] ?? []
          delete history[fromRel]
          sourceArtifact.summary = sourceArtifact.summary
          pushWorkspaceRevision(state, toRel, 'origin/cli', `Moved artifact from ${fromRel} to ${toRel}.`, await readText(destinationAbs))
        } else {
          state.memory.artifacts.unshift({
            ...sourceArtifact,
            path: toRel,
          })
          const history = artifactHistoryMap(state)
          history[toRel] = (history[fromRel] ?? []).map((revision) => ({ ...revision, id: nextId(state, 'rev') }))
          pushWorkspaceRevision(state, toRel, 'origin/cli', `Copied artifact from ${fromRel} to ${toRel}.`, await readText(destinationAbs))
        }
      } else if (fromRel === workspaceFilePath) {
        return context.error({ code: 'INVALID_OPERATION', message: 'Origin/Memory.md is managed by the memory commands.' })
      } else if (route === 'workspace move') {
        pushWorkspaceRevision(state, toRel, 'origin/cli', `Moved workspace file from ${fromRel} to ${toRel}.`, await readText(destinationAbs))
      }
      const activity = addActivity(state, {
        kind: route === 'workspace move' ? 'workspace.move' : 'workspace.copy',
        status: 'completed',
        actor: 'origin/cli',
        target: toRel,
        summary: `${route === 'workspace move' ? 'Moved' : 'Copied'} workspace path ${fromRel} to ${toRel}.`,
        severity: 'info',
      })
      return createActionResult(`${route === 'workspace move' ? 'Moved' : 'Copied'} workspace path ${fromRel} to ${toRel}.`, {
        affectedIds: [fromRel, toRel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'workspace delete') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const rel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
      if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
      if (rel === workspaceFilePath) return context.error({ code: 'INVALID_OPERATION', message: 'Origin/Memory.md cannot be deleted through workspace delete.' })
      const abs = noteWorkspaceAbs(context, rel)
      const note = managedNoteByPath(state, rel)
      const artifact = managedArtifactByPath(state, rel)
      await removePath(abs)
      if (note) {
        await deleteNoteLike(state, context, note, 'origin/cli')
      } else if (artifact) {
        state.memory.artifacts = state.memory.artifacts.filter((item) => item.path !== rel)
        delete artifactHistoryMap(state)[rel]
      }
      const activity = addActivity(state, {
        kind: 'workspace.delete',
        status: 'completed',
        actor: 'origin/cli',
        target: rel,
        summary: `Deleted workspace path ${rel}.`,
        severity: 'warn',
      })
      return createActionResult(`Deleted workspace path ${rel}.`, {
        affectedIds: [rel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'workspace history' || route === 'workspace revision list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const rel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
    if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
    const note = managedNoteByPath(state, rel)
    const artifact = managedArtifactByPath(state, rel)
    let revisions: any[] = []
    if (note) revisions = note.revisions.map((revision) => noteRevisionOutput(revision))
    else if (artifact) revisions = (artifactHistoryMap(state)[rel] ?? []).map((revision) => revisionOutput(rel, revision))
    else revisions = state.workspace.revisions.filter((revision) => revision.path === rel).map((revision) => revisionOutput(rel, revision as any))
    return createListResult(revisions, { total: revisions.length, summary: 'Workspace revisions.' })
  }

  if (route === 'workspace revision get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const revisionId = String(extractRouteArgs(context)['revision-id'])
    const revision = state.workspace.revisions.find((item) => item.id === revisionId)
    if (!revision) return context.error({ code: 'NOT_FOUND', message: `Unknown workspace revision: ${revisionId}` })
    return revisionOutput(revision.path, revision as any)
  }

  if (route === 'workspace revision diff') {
    const state = (await context.runtime.store.load()) as ManagedState
    const revisionId = String(extractRouteArgs(context)['revision-id'])
    const revision = state.workspace.revisions.find((item) => item.id === revisionId)
    if (!revision) return context.error({ code: 'NOT_FOUND', message: `Unknown workspace revision: ${revisionId}` })
    const againstId = extractRouteOptions(context).against ? String(extractRouteOptions(context).against) : undefined
    const against = againstId ? state.workspace.revisions.find((item) => item.id === againstId) : state.workspace.revisions.at(-2)
    return createRevisionDiff(against?.content, revision.content, ['content'])
  }

  if (route === 'workspace reindex') {
    return context.runtime.store.mutate((state: ManagedState) => {
      state.workspace.indexStatus = `Reindexed at ${now()}.`
      const activity = addActivity(state, {
        kind: 'workspace.reindex',
        status: 'completed',
        actor: 'origin/cli',
        target: workspaceRoot(context),
        summary: 'Reindexed the workspace.',
        severity: 'info',
      })
      return createActionResult('Reindexed the workspace.', {
        affectedIds: [workspaceRoot(context)],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'workspace bridge scan' || route === 'workspace bridge import' || route === 'workspace bridge export' || route === 'workspace bridge reconcile') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      let imported = 0
      if (route === 'workspace bridge scan' || route === 'workspace bridge import' || route === 'workspace bridge reconcile') {
        imported = await syncManagedWorkspaceImports(state, context)
        if (route === 'workspace bridge scan' && imported > 0) {
          for (const note of state.notes.notes.filter((item) => !item.archived)) {
            const abs = noteWorkspaceAbs(context, note.path)
            const content = await readText(abs)
            if (content !== undefined && content !== note.content) {
              const conflictId = nextId(state, 'conf')
              state.workspace.conflicts.unshift({
                id: conflictId,
                kind: 'bridge-note',
                path: note.path,
                summary: conflictSummaryForPath(note.path, 'Filesystem change detected.'),
                actors: ['origin/bridge', 'origin/cli'],
                revisions: [
                  {
                    id: nextId(state, 'crev'),
                    source: 'local-head',
                    label: 'local-head',
                    actor: 'origin/cli',
                    at: note.updatedAt,
                    summary: 'Current managed note content.',
                    diff: createRevisionDiff(undefined, note.content),
                  },
                  {
                    id: nextId(state, 'crev'),
                    source: 'filesystem',
                    label: 'filesystem',
                    actor: 'origin/bridge',
                    at: now(),
                    summary: 'Filesystem content detected during scan.',
                    diff: createRevisionDiff(note.content, content),
                  },
                ],
                candidates: [
                  { id: 'local-head', label: 'local-head', summary: 'Keep the current managed content.', revisionId: note.revisions.at(-1)?.id },
                  { id: 'filesystem', label: 'filesystem', summary: 'Adopt the content from disk.', revisionId: note.revisions.at(-1)?.id },
                ],
              })
            }
          }
        }
      }
      if (route === 'workspace bridge export' || route === 'workspace bridge reconcile') {
        await context.runtime.store.save(state)
      }
      state.workspace.bridgeStatus = `Bridge ${route.split(' ').at(-1)} completed at ${now()}.`
      state.workspace.bridgeJobs.unshift({
        id: nextId(state, 'bridge'),
        status: 'completed',
        summary: `Workspace bridge ${route.split(' ').at(-1)} completed. Imported ${imported} change(s).`,
      })
      const activity = addActivity(state, {
        kind: `workspace.bridge.${route.split(' ').at(-1)}`,
        status: 'completed',
        actor: 'origin/cli',
        target: workspaceRoot(context),
        summary: `Workspace bridge ${route.split(' ').at(-1)} completed.`,
        severity: 'info',
      })
      return createActionResult(`Workspace bridge ${route.split(' ').at(-1)} completed.`, {
        affectedIds: [workspaceRoot(context)],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'workspace bridge status') {
    const state = (await context.runtime.store.load()) as ManagedState
    return {
      root: workspaceRoot(context),
      vault: vaultRoot(context),
      summary: `Bridge status is ${state.workspace.bridgeStatus}.`,
      ['index-status']: state.workspace.indexStatus,
      ['bridge-status']: state.workspace.bridgeStatus,
    }
  }

  if (route === 'workspace bridge reconcile') {
    // handled above
  }

  if (route === 'workspace conflict list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const limit = Number(extractRouteOptions(context).limit ?? 20)
    const items = takeLimit(state.workspace.conflicts.map(workspaceConflictOutput), limit)
    return createListResult(items, { total: items.length, summary: 'Workspace conflicts.' })
  }

  if (route === 'workspace conflict get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const conflict = state.workspace.conflicts.find((item) => item.id === String(extractRouteArgs(context)['conflict-id']))
    if (!conflict) return context.error({ code: 'NOT_FOUND', message: `Unknown workspace conflict: ${String(extractRouteArgs(context)['conflict-id'])}` })
    return {
      ...workspaceConflictOutput(conflict),
      revisions: conflict.revisions,
      candidates: workspaceConflictCandidates(conflict),
    }
  }

  if (route === 'workspace conflict resolve') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const conflictId = String(extractRouteArgs(context)['conflict-id'])
      const conflict = state.workspace.conflicts.find((item) => item.id === conflictId)
      if (!conflict) return context.error({ code: 'NOT_FOUND', message: `Unknown workspace conflict: ${conflictId}` })
      if (!conflict.path) return context.error({ code: 'INVALID_STATE', message: `Workspace conflict ${conflictId} is missing a path.` })
      const resolution = String(extractRouteOptions(context).resolution)
      const candidateId = extractRouteOptions(context)['candidate-id'] ? String(extractRouteOptions(context)['candidate-id']) : undefined
      const candidate = candidateId ? conflict.candidates.find((item) => item.id === candidateId) : undefined
      const targetPath = conflict.path
      if (resolution === 'select' && candidate?.revisionId) {
        await restoreManagedPath(state, context, targetPath, candidate.revisionId, 'origin/cli', `Resolved workspace conflict ${conflictId} by selecting ${candidate.id}.`)
      } else if (resolution !== 'select') {
        const content = String(extractRouteOptions(context).content ?? '')
        if (targetPath === workspaceFilePath) {
          await updateMemoryMarkdown(state, content, `Resolved workspace conflict ${conflictId}.`)
        } else {
          const note = managedNoteByPath(state, targetPath)
          if (note) await writeManagedNote(state, context, note, content, `Resolved workspace conflict ${conflictId}.`, 'origin/cli')
          else {
            await writeFile(noteWorkspaceAbs(context, targetPath), content, 'utf8')
            pushWorkspaceRevision(state, targetPath, 'origin/cli', `Resolved workspace conflict ${conflictId}.`, content)
          }
        }
      }
      state.workspace.conflicts = state.workspace.conflicts.filter((item) => item.id !== conflictId)
      const activity = addActivity(state, {
        kind: 'workspace.conflict.resolve',
        status: 'completed',
        actor: 'origin/cli',
        target: conflictId,
        summary: `Resolved workspace conflict ${conflictId}.`,
        severity: 'info',
      })
      return createActionResult(`Resolved workspace conflict ${conflictId}.`, {
        affectedIds: [conflictId, targetPath],
        conflictId,
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  return context.error({ code: 'NOT_FOUND', message: `Unhandled workspace command: ${context.route}` })
}

async function handleNote(context: RouteContext) {
  const route = routeKey(context)
  if (route === 'note list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const options = extractRouteOptions(context)
    const query = options.query ? String(options.query) : undefined
    const folder = options.folder ? toWorkspaceRel(context, String(options.folder)) : undefined
    const limit = Number(options.limit ?? 20)
    const notes = state.notes.notes
      .filter((note) => !note.archived)
      .filter((note) => (folder ? note.path.startsWith(folder) : true))
      .filter((note) => (query ? includesQuery(note.title, query) || includesQuery(note.content, query) || includesQuery(note.path, query) : true))
      .sort((left, right) => cmpDateDescending(left.updatedAt, right.updatedAt))
      .slice(0, limit)
      .map(noteSummary)
    return createListResult(notes, { total: notes.length, summary: 'Managed notes.' })
  }

  if (route === 'note get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
    if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
    return noteOutput(note)
  }

  if (route === 'note get-by-path') {
    const state = (await context.runtime.store.load()) as ManagedState
    const rel = toWorkspaceRel(context, String(extractRouteArgs(context).path))
    if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(extractRouteArgs(context).path)}` })
    const note = managedNoteByPath(state, rel)
    if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note path: ${rel}` })
    return noteOutput(note)
  }

  if (route === 'note create') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const options = extractRouteOptions(context)
      const rel = toWorkspaceRel(context, String(options.path))
      if (rel === undefined) return context.error({ code: 'INVALID_INPUT', message: `Path must be inside the workspace root: ${String(options.path)}` })
      const title = options.title ? String(options.title) : undefined
      const content = String(options.content ?? '')
      const note = (await noteCreateLike(state, context, rel, title, content, 'origin/cli')) as any
      const activity = addActivity(state, {
        kind: 'note.create',
        status: 'completed',
        actor: 'origin/cli',
        target: rel,
        summary: `Created note ${rel}.`,
        severity: 'info',
      })
      return createActionResult(`Created note ${rel}.`, {
        affectedIds: [note.id, rel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'note update') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
      if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
      const options = extractRouteOptions(context)
      const mode = String(options.mode)
      const content = String(options.content ?? '')
      if (mode === 'replace') {
        await writeManagedNote(state, context, note, content, 'Updated note.', 'origin/cli')
      } else if (mode === 'append') {
        await writeManagedNote(state, context, note, `${note.content}${note.content.endsWith('\n') ? '' : '\n'}${content}`, 'Appended to note.', 'origin/cli')
      } else {
        await writeManagedNote(state, context, note, applyPatchLike(note.content, content), 'Patched note.', 'origin/cli')
      }
      const activity = addActivity(state, {
        kind: 'note.update',
        status: 'completed',
        actor: 'origin/cli',
        target: note.path,
        summary: `Updated note ${note.path}.`,
        severity: 'info',
      })
      return createActionResult(`Updated note ${note.path}.`, {
        affectedIds: [note.id, note.path],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'note move' || route === 'note rename') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
      if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
      const fromRel = note.path
      const toRel = route === 'note move' ? toWorkspaceRel(context, String(extractRouteOptions(context).path)) : toWorkspaceRel(context, join(dirname(note.path), String(extractRouteOptions(context).name)))
      if (toRel === undefined) return context.error({ code: 'INVALID_INPUT', message: 'Destination must be inside the workspace root.' })
      const fromAbs = noteWorkspaceAbs(context, fromRel)
      const toAbs = noteWorkspaceAbs(context, toRel)
      await movePath(fromAbs, toAbs)
      note.path = toRel
      note.title = noteTitleFromContent(note.content, toRel)
      await createManagedNoteArtifactLink(state, toRel, note.title, true)
      state.memory.artifacts = state.memory.artifacts.filter((artifact) => artifact.path !== fromRel)
      pushWorkspaceRevision(state, toRel, 'origin/cli', `Moved note from ${fromRel} to ${toRel}.`, note.content)
      const activity = addActivity(state, {
        kind: 'note.move',
        status: 'completed',
        actor: 'origin/cli',
        target: toRel,
        summary: `Moved note ${fromRel} to ${toRel}.`,
        severity: 'info',
      })
      return createActionResult(`Moved note ${fromRel} to ${toRel}.`, {
        affectedIds: [note.id, fromRel, toRel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'note delete') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
      if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
      await deleteNoteLike(state, context, note, 'origin/cli')
      const activity = addActivity(state, {
        kind: 'note.delete',
        status: 'completed',
        actor: 'origin/cli',
        target: note.path,
        summary: `Deleted note ${note.path}.`,
        severity: 'warn',
      })
      return createActionResult(`Deleted note ${note.path}.`, {
        affectedIds: [note.id, note.path],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'note search') {
    const state = (await context.runtime.store.load()) as ManagedState
    const query = String(extractRouteOptions(context).query)
    const limit = Number(extractRouteOptions(context).limit ?? 20)
    const hits = state.notes.notes
      .filter((note) => !note.archived)
      .map((note) => noteToSearchHit(note, query))
      .filter(Boolean)
      .sort((left, right) => (right?.score ?? 0) - (left?.score ?? 0))
    return createListResult(takeLimit(hits as any[], limit), { total: hits.length, summary: `Found ${hits.length} note hit(s) for "${query}".` })
  }

  if (route === 'note related') {
    const state = (await context.runtime.store.load()) as ManagedState
    const entity = String(extractRouteArgs(context).entity)
    const relatedIds = new Set(
      state.entityLinks
        .filter((link) => link.from === entity || link.to === entity)
        .flatMap((link) => [link.from, link.to]),
    )
    const notes = state.notes.notes.filter((note) => relatedIds.has(note.id) || relatedIds.has(note.path) || includesQuery(note.content, entity) || includesQuery(note.title, entity))
    return createListResult(notes.map(noteSummary), { total: notes.length, summary: `Related notes for ${entity}.` })
  }

  if (route === 'note backlinks') {
    const state = (await context.runtime.store.load()) as ManagedState
    const noteId = String(extractRouteArgs(context)['note-id'])
    const note = managedNoteById(state, noteId)
    if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${noteId}` })
    const notes = state.notes.notes.filter((item) => item.id !== noteId && (state.entityLinks.some((link) => link.to === noteId && link.from === item.id) || includesQuery(item.content, note.title) || includesQuery(item.content, note.path)))
    return createListResult(notes.map(noteSummary), { total: notes.length, summary: `Backlink notes for ${noteId}.` })
  }

  if (route === 'note history') {
    const state = (await context.runtime.store.load()) as ManagedState
    const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
    if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
    const items = selectWindow(note.history, extractRouteOptions(context).since as string | undefined, extractRouteOptions(context).until as string | undefined)
    return createListResult(items, { total: items.length, summary: 'Note history entries.' })
  }

  if (route === 'note revision list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
    if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
    const items = note.revisions.map(noteRevisionOutput)
    return createListResult(items, { total: items.length, summary: 'Note revisions.' })
  }

  if (route === 'note revision get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const revision = state.notes.notes.flatMap((note) => note.revisions).find((item) => item.id === String(extractRouteArgs(context)['revision-id']))
    if (!revision) return context.error({ code: 'NOT_FOUND', message: `Unknown note revision: ${String(extractRouteArgs(context)['revision-id'])}` })
    return noteRevisionOutput(revision)
  }

  if (route === 'note revision diff') {
    const state = (await context.runtime.store.load()) as ManagedState
    const revisionId = String(extractRouteArgs(context)['revision-id'])
    const target = state.notes.notes.flatMap((note) => note.revisions).find((item) => item.id === revisionId)
    if (!target) return context.error({ code: 'NOT_FOUND', message: `Unknown note revision: ${revisionId}` })
    const all = state.notes.notes.flatMap((note) => note.revisions)
    const againstId = extractRouteOptions(context).against ? String(extractRouteOptions(context).against) : undefined
    const against = againstId ? all.find((item) => item.id === againstId) : all.at(-2)
    return createRevisionDiff(against?.content, target.content, ['content'])
  }

  if (route === 'note restore') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
      if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
      const revisionId = String(extractRouteArgs(context)['revision-id'])
      const revision = note.revisions.find((item) => item.id === revisionId)
      if (!revision?.content) return context.error({ code: 'NOT_FOUND', message: `Unknown note revision: ${revisionId}` })
      await writeManagedNote(state, context, note, revision.content, `Restored note to revision ${revisionId}.`, 'origin/cli')
      const activity = addActivity(state, {
        kind: 'note.restore',
        status: 'completed',
        actor: 'origin/cli',
        target: note.path,
        summary: `Restored note ${note.path} to revision ${revisionId}.`,
        severity: 'info',
      })
      return createActionResult(`Restored note ${note.path} to revision ${revisionId}.`, {
        affectedIds: [note.id, revisionId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'note conflict list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const limit = Number(extractRouteOptions(context).limit ?? 20)
    const items = takeLimit(state.notes.conflicts.map(noteConflictOutput), limit)
    return createListResult(items, { total: items.length, summary: 'Note conflicts.' })
  }

  if (route === 'note conflict get') {
    const state = (await context.runtime.store.load()) as ManagedState
    const conflict = state.notes.conflicts.find((item) => item.id === String(extractRouteArgs(context)['conflict-id']))
    if (!conflict) return context.error({ code: 'NOT_FOUND', message: `Unknown note conflict: ${String(extractRouteArgs(context)['conflict-id'])}` })
    return {
      ...noteConflictOutput(conflict),
      revisions: conflict.revisions,
      candidates: noteConflictCandidates(conflict),
    }
  }

  if (route === 'note conflict resolve') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const conflictId = String(extractRouteArgs(context)['conflict-id'])
      const conflict = state.notes.conflicts.find((item) => item.id === conflictId)
      if (!conflict) return context.error({ code: 'NOT_FOUND', message: `Unknown note conflict: ${conflictId}` })
      const resolution = String(extractRouteOptions(context).resolution)
      const candidateId = extractRouteOptions(context)['candidate-id'] ? String(extractRouteOptions(context)['candidate-id']) : undefined
      const candidate = candidateId ? conflict.candidates.find((item) => item.id === candidateId) : undefined
      const note = managedNoteById(state, conflict.noteId ?? '')
      if (resolution === 'select' && candidate?.revisionId && note) {
        const revision = note.revisions.find((item) => item.id === candidate.revisionId)
        if (revision?.content) await writeManagedNote(state, context, note, revision.content, `Resolved note conflict ${conflictId} by selecting ${candidate.id}.`, 'origin/cli')
      } else if (resolution !== 'select' && note) {
        const content = String(extractRouteOptions(context).content ?? '')
        await writeManagedNote(state, context, note, content, `Resolved note conflict ${conflictId}.`, 'origin/cli')
      }
      state.notes.conflicts = state.notes.conflicts.filter((item) => item.id !== conflictId)
      const activity = addActivity(state, {
        kind: 'note.conflict.resolve',
        status: 'completed',
        actor: 'origin/cli',
        target: conflict.noteId ?? conflictId,
        summary: `Resolved note conflict ${conflictId}.`,
        severity: 'info',
      })
      return createActionResult(`Resolved note conflict ${conflictId}.`, {
        affectedIds: [conflictId, conflict.noteId ?? conflictId],
        conflictId,
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'note attachment list') {
    const state = (await context.runtime.store.load()) as ManagedState
    const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
    if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
    return createListResult(note.attachments.map(noteAttachmentOutput), { total: note.attachments.length, summary: 'Note attachments.' })
  }

  if (route === 'note attachment add') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
      if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
      const source = String(extractRouteOptions(context).path)
      const sourceAbs = isAbsolute(source) ? source : resolve(process.cwd(), source)
      const sourceStats = await safeStat(sourceAbs)
      if (!sourceStats) return context.error({ code: 'NOT_FOUND', message: `Unknown attachment source: ${source}` })
      const insideVault = insideRoot(workspaceRoot(context), sourceAbs)
      const destRel = insideVault ? relative(workspaceRoot(context), sourceAbs).split(sep).join('/') : `Attachments/${note.id}/${basename(sourceAbs)}`
      const destAbs = noteWorkspaceAbs(context, destRel)
      if (!insideVault) await copyRecursive(sourceAbs, destAbs)
      const existingIndex = note.attachments.findIndex((attachment) => attachment.path === destRel)
      const previousAttachment = existingIndex >= 0 ? note.attachments[existingIndex] : undefined
      const attachment = {
        id: previousAttachment?.id ?? nextId(state, 'att'),
        name: basename(sourceAbs),
        path: destRel,
        contentType: mimeTypeFromPath(sourceAbs),
        size: sourceStats.size,
      }
      if (existingIndex >= 0) note.attachments[existingIndex] = attachment
      else note.attachments.push(attachment)
      const activity = addActivity(state, {
        kind: 'note.attachment.add',
        status: 'completed',
        actor: 'origin/cli',
        target: note.id,
        summary: `Attached ${destRel} to note ${note.id}.`,
        severity: 'info',
      })
      return createActionResult(`Attached ${destRel} to note ${note.id}.`, {
        affectedIds: [note.id, attachment.id, destRel],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'note attachment remove') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const note = managedNoteById(state, String(extractRouteArgs(context)['note-id']))
      if (!note) return context.error({ code: 'NOT_FOUND', message: `Unknown note: ${String(extractRouteArgs(context)['note-id'])}` })
      const attachmentId = String(extractRouteArgs(context)['attachment-id'])
      const index = note.attachments.findIndex((attachment) => attachment.id === attachmentId)
      if (index === -1) return context.error({ code: 'NOT_FOUND', message: `Unknown note attachment: ${attachmentId}` })
      const [attachment] = note.attachments.splice(index, 1)
      if (!attachment) return context.error({ code: 'NOT_FOUND', message: `Unknown note attachment: ${attachmentId}` })
      if (attachment.path.startsWith('Attachments/')) {
        await removePath(noteWorkspaceAbs(context, attachment.path))
      }
      const activity = addActivity(state, {
        kind: 'note.attachment.remove',
        status: 'completed',
        actor: 'origin/cli',
        target: note.id,
        summary: `Removed attachment ${attachmentId} from note ${note.id}.`,
        severity: 'info',
      })
      return createActionResult(`Removed attachment ${attachmentId} from note ${note.id}.`, {
        affectedIds: [note.id, attachmentId],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  return context.error({ code: 'NOT_FOUND', message: `Unhandled note command: ${context.route}` })
}

async function handleFile(context: RouteContext) {
  const route = routeKey(context)
  if (route === 'file list') {
    const base = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
    const depth = Number(extractRouteOptions(context).depth ?? 1)
    const entries = await collectTreeEntries(base, '', depth)
    const items = toFileEntryList(entries)
    return createListResult(items, { total: items.length, summary: 'Filesystem entries.' })
  }

  if (route === 'file stat') {
    const abs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
    const stats = await safeStat(abs)
    if (!stats) return context.error({ code: 'NOT_FOUND', message: `Unknown file path: ${abs}` })
    return fileEntryOutput(abs, stats.isDirectory() ? 'folder' : stats.isSymbolicLink() ? 'symlink' : 'file', stats.size, stats.mtime.toISOString())
  }

  if (route === 'file read') {
    const abs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
    const stats = await safeStat(abs)
    if (!stats) return context.error({ code: 'NOT_FOUND', message: `Unknown file path: ${abs}` })
    const encoding = String(extractRouteOptions(context).encoding ?? 'utf8')
    const content = encoding === 'base64' ? await readBinaryBase64(abs) : encoding === 'binary' ? await readBinaryBase64(abs) : await readText(abs)
    if (content === undefined) return context.error({ code: 'NOT_FOUND', message: `Unable to read file: ${abs}` })
    return {
      path: abs,
      encoding,
      content,
    }
  }

  if (route === 'file write') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const abs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
      const encoding = String(extractRouteOptions(context).encoding ?? 'utf8') as 'utf8' | 'base64'
      const content = String(extractRouteOptions(context).content ?? '')
      const rel = insideRoot(workspaceRoot(context), abs) ? relative(workspaceRoot(context), abs).split(sep).join('/') : undefined
      if (rel === workspaceFilePath) {
        await updateMemoryMarkdown(state, encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content, `Wrote ${workspaceFilePath}.`)
      } else if (rel !== undefined) {
        const note = managedNoteByPath(state, rel)
        if (note) {
          await writeManagedNote(state, context, note, encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content, `Wrote note ${rel}.`, 'origin/cli')
        } else {
          const artifact = managedArtifactByPath(state, rel)
          if (artifact && artifact.kind !== 'folder') {
            await writeMemoryArtifactContent(state, context, artifact, encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content, `Wrote artifact ${rel}.`)
          } else {
            await writeBinary(abs, content, encoding)
          }
        }
      } else {
        await writeBinary(abs, content, encoding)
      }
      const activity = addActivity(state, {
        kind: 'file.write',
        status: 'completed',
        actor: 'origin/cli',
        target: abs,
        summary: `Wrote file ${abs}.`,
        severity: 'info',
      })
      return createActionResult(`Wrote file ${abs}.`, {
        affectedIds: [abs],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'file patch') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const abs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
      const patch = String(extractRouteOptions(context).patch ?? '')
      const rel = insideRoot(workspaceRoot(context), abs) ? relative(workspaceRoot(context), abs).split(sep).join('/') : undefined
      const previous = await readText(abs)
      const next = applyPatchLike(previous ?? '', patch)
      if (rel === workspaceFilePath) {
        await updateMemoryMarkdown(state, next, `Patched ${workspaceFilePath}.`)
      } else if (rel !== undefined) {
        const note = managedNoteByPath(state, rel)
        if (note) {
          await writeManagedNote(state, context, note, next, `Patched note ${rel}.`, 'origin/cli')
        } else {
          const artifact = managedArtifactByPath(state, rel)
          if (artifact && artifact.kind !== 'folder') {
            await writeMemoryArtifactContent(state, context, artifact, next, `Patched artifact ${rel}.`)
          } else {
            await writeBinary(abs, next, 'utf8')
          }
        }
      } else {
        await writeBinary(abs, next, 'utf8')
      }
      const activity = addActivity(state, {
        kind: 'file.patch',
        status: 'completed',
        actor: 'origin/cli',
        target: abs,
        summary: `Patched file ${abs}.`,
        severity: 'info',
      })
      return createActionResult(`Patched file ${abs}.`, {
        affectedIds: [abs],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'file mkdir') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const abs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
      await ensureDir(abs)
      const activity = addActivity(state, {
        kind: 'file.mkdir',
        status: 'completed',
        actor: 'origin/cli',
        target: abs,
        summary: `Created directory ${abs}.`,
        severity: 'info',
      })
      return createActionResult(`Created directory ${abs}.`, {
        affectedIds: [abs],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'file move' || route === 'file copy') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const fromAbs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
      const toAbs = toWorkspaceAbs(context, String(extractRouteOptions(context).to))
      const fromRel = insideRoot(workspaceRoot(context), fromAbs) ? relative(workspaceRoot(context), fromAbs).split(sep).join('/') : undefined
      const toRel = insideRoot(workspaceRoot(context), toAbs) ? relative(workspaceRoot(context), toAbs).split(sep).join('/') : undefined
      if (fromRel === workspaceFilePath || toRel === workspaceFilePath) return context.error({ code: 'INVALID_OPERATION', message: 'Origin/Memory.md is managed by memory commands.' })
      if (route === 'file move') await movePath(fromAbs, toAbs)
      else await copyRecursive(fromAbs, toAbs)
      if (fromRel !== undefined && toRel !== undefined) {
        const note = managedNoteByPath(state, fromRel)
        if (note) {
          if (route === 'file move') {
            note.path = toRel
            note.title = noteTitleFromContent(note.content, toRel)
          } else {
          const copy: any = {
            ...note,
            id: nextId(state, 'note'),
            path: toRel,
              title: noteTitleFromContent(note.content, toRel),
              revisions: [],
              history: [],
            }
            const revisionId = nextId(state, 'rev')
            copy.revisions = recordRevision(copy.revisions, {
              id: revisionId,
              actor: 'origin/cli',
              at: now(),
              summary: `Copied from ${fromRel}.`,
              diff: createRevisionDiff(undefined, copy.content),
              content: copy.content,
            })
            copy.history.push(createHistoryEntry(state, 'origin/cli', `Copied from ${fromRel}.`, revisionId))
            state.notes.notes.unshift(copy)
          }
          await createManagedNoteArtifactLink(state, toRel, note.title, true)
        } else if (managedArtifactByPath(state, fromRel)) {
          const artifact = managedArtifactByPath(state, fromRel)
          if (artifact && route === 'file move') {
            artifact.path = toRel
            const history = artifactHistoryMap(state)
            history[toRel] = history[fromRel] ?? []
            delete history[fromRel]
          } else if (artifact) {
            state.memory.artifacts.unshift({ ...artifact, path: toRel })
            const history = artifactHistoryMap(state)
            history[toRel] = (history[fromRel] ?? []).map((revision) => ({ ...revision, id: nextId(state, 'rev') }))
          }
        }
      }
      const activity = addActivity(state, {
        kind: route === 'file move' ? 'file.move' : 'file.copy',
        status: 'completed',
        actor: 'origin/cli',
        target: toAbs,
        summary: `${route === 'file move' ? 'Moved' : 'Copied'} file ${fromAbs} to ${toAbs}.`,
        severity: 'info',
      })
      return createActionResult(`${route === 'file move' ? 'Moved' : 'Copied'} file ${fromAbs} to ${toAbs}.`, {
        affectedIds: [fromAbs, toAbs],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'file delete') {
    return context.runtime.store.mutate(async (state: ManagedState) => {
      const abs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
      const rel = insideRoot(workspaceRoot(context), abs) ? relative(workspaceRoot(context), abs).split(sep).join('/') : undefined
      if (rel === workspaceFilePath) return context.error({ code: 'INVALID_OPERATION', message: 'Origin/Memory.md is managed by memory commands.' })
      await removePath(abs)
      if (rel !== undefined) {
        const note = managedNoteByPath(state, rel)
        if (note) await deleteNoteLike(state, context, note, 'origin/cli')
        else state.memory.artifacts = state.memory.artifacts.filter((artifact) => artifact.path !== rel)
        delete artifactHistoryMap(state)[rel]
      }
      const activity = addActivity(state, {
        kind: 'file.delete',
        status: 'completed',
        actor: 'origin/cli',
        target: abs,
        summary: `Deleted file ${abs}.`,
        severity: 'warn',
      })
      return createActionResult(`Deleted file ${abs}.`, {
        affectedIds: [abs],
        activityIds: actionIdFromActivity(activity),
      })
    })
  }

  if (route === 'file search') {
    const options = extractRouteOptions(context)
    const base = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
    const results = await searchHostPaths(base, String(options.query), Boolean(options.content ?? true), Number(options.limit ?? 20))
    return createListResult(results, { total: results.length, summary: `Found ${results.length} file search hit(s).` })
  }

  if (route === 'file glob') {
    const options = extractRouteOptions(context)
    const base = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
    const matches = await globEntries(base, String(options.pattern), Number(options.limit ?? 100))
    const items = toFileEntryList(matches)
    return createListResult(items, { total: items.length, summary: 'Glob matches.' })
  }

  if (route === 'file tail') {
    const abs = toWorkspaceAbs(context, String(extractRouteArgs(context).path))
    const lines = Number(extractRouteOptions(context).lines ?? 100)
    const content = (await readText(abs)) ?? ''
    const tail = content.split(/\r?\n/).slice(Math.max(0, content.split(/\r?\n/).length - lines)).join('\n')
    return {
      path: abs,
      encoding: 'utf8',
      content: tail,
    }
  }

  return context.error({ code: 'NOT_FOUND', message: `Unhandled file command: ${context.route}` })
}

function contentForArtifactPath(state: ManagedState, pathValue: string) {
  const note = managedNoteByPath(state, pathValue)
  if (note) return note.content
  const artifact = managedArtifactByPath(state, pathValue)
  if (!artifact) return undefined
  return artifact.kind === 'note' ? managedNoteByPath(state, pathValue)?.content : undefined
}

addRoute('chat list', handleChat)
addRoute('chat create', handleChat)
addRoute('chat get', handleChat)
addRoute('chat send', handleChat)
addRoute('chat rename', handleChat)
addRoute('chat archive', handleChat)
addRoute('chat delete', handleChat)
addRoute('chat outbox', handleChat)

addRoute('memory get', handleMemory)
addRoute('memory update', handleMemory)
addRoute('memory add', handleMemory)
addRoute('memory search', handleMemory)
addRoute('memory related', handleMemory)
addRoute('memory history', handleMemory)
addRoute('memory revision list', handleMemory)
addRoute('memory revision get', handleMemory)
addRoute('memory revision diff', handleMemory)
addRoute('memory restore', handleMemory)
addRoute('memory validate', handleMemory)
addRoute('memory artifact list', handleMemory)
addRoute('memory artifact get', handleMemory)
addRoute('memory artifact search', handleMemory)
addRoute('memory artifact create', handleMemory)
addRoute('memory artifact update', handleMemory)
addRoute('memory artifact move', handleMemory)
addRoute('memory artifact delete', handleMemory)
addRoute('memory artifact link', handleMemory)
addRoute('memory artifact unlink', handleMemory)
addRoute('memory artifact history', handleMemory)
addRoute('memory artifact restore', handleMemory)

addRoute('workspace status', handleWorkspace)
addRoute('workspace tree', handleWorkspace)
addRoute('workspace recent', handleWorkspace)
addRoute('workspace search', handleWorkspace)
addRoute('workspace resolve', handleWorkspace)
addRoute('workspace stat', handleWorkspace)
addRoute('workspace read', handleWorkspace)
addRoute('workspace write', handleWorkspace)
addRoute('workspace patch', handleWorkspace)
addRoute('workspace mkdir', handleWorkspace)
addRoute('workspace move', handleWorkspace)
addRoute('workspace copy', handleWorkspace)
addRoute('workspace delete', handleWorkspace)
addRoute('workspace history', handleWorkspace)
addRoute('workspace revision list', handleWorkspace)
addRoute('workspace revision get', handleWorkspace)
addRoute('workspace revision diff', handleWorkspace)
addRoute('workspace reindex', handleWorkspace)
addRoute('workspace bridge status', handleWorkspace)
addRoute('workspace bridge scan', handleWorkspace)
addRoute('workspace bridge import', handleWorkspace)
addRoute('workspace bridge export', handleWorkspace)
addRoute('workspace bridge reconcile', handleWorkspace)
addRoute('workspace conflict list', handleWorkspace)
addRoute('workspace conflict get', handleWorkspace)
addRoute('workspace conflict resolve', handleWorkspace)

addRoute('note list', handleNote)
addRoute('note get', handleNote)
addRoute('note get-by-path', handleNote)
addRoute('note create', handleNote)
addRoute('note update', handleNote)
addRoute('note move', handleNote)
addRoute('note rename', handleNote)
addRoute('note delete', handleNote)
addRoute('note search', handleNote)
addRoute('note related', handleNote)
addRoute('note backlinks', handleNote)
addRoute('note history', handleNote)
addRoute('note revision list', handleNote)
addRoute('note revision get', handleNote)
addRoute('note revision diff', handleNote)
addRoute('note restore', handleNote)
addRoute('note conflict list', handleNote)
addRoute('note conflict get', handleNote)
addRoute('note conflict resolve', handleNote)
addRoute('note attachment list', handleNote)
addRoute('note attachment add', handleNote)
addRoute('note attachment remove', handleNote)

addRoute('file list', handleFile)
addRoute('file stat', handleFile)
addRoute('file read', handleFile)
addRoute('file write', handleFile)
addRoute('file patch', handleFile)
addRoute('file mkdir', handleFile)
addRoute('file move', handleFile)
addRoute('file copy', handleFile)
addRoute('file delete', handleFile)
addRoute('file search', handleFile)
addRoute('file glob', handleFile)
addRoute('file tail', handleFile)

export const chatMemoryWorkspaceNoteFileHandlers = defineHandlers(routes as any)
