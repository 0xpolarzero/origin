import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from 'bun:test'
import { Cli } from 'incur'

import { OriginFeature } from '../../../../docs/features.ts'
import specOrigin from '../../src/cli/spec.ts'

type ContractEntry = Record<string, any> & {
  _group?: boolean
  commands?: Map<string, ContractEntry>
}

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type JsonSchema = {
  type?: string
  required?: string[]
  properties?: Record<string, JsonSchema>
  enum?: string[]
  const?: string
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  items?: JsonSchema
  minimum?: number
}

const originBin = fileURLToPath(new URL('../../bin/origin', import.meta.url))
const serverRoot = fileURLToPath(new URL('../..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))

function getCommandMap(cli: unknown) {
  const commands = Cli.toCommands.get(cli as any)
  if (!commands) throw new Error('Unable to load Origin CLI command map.')
  return commands as Map<string, ContractEntry>
}

function isGroup(entry: ContractEntry) {
  return Boolean(entry?._group && entry.commands instanceof Map)
}

export function collectLeafRoutes() {
  const routes: string[] = []

  function walk(commands: Map<string, ContractEntry>, prefix: string[] = []) {
    for (const [name, entry] of commands) {
      const next = [...prefix, name]
      if (isGroup(entry)) {
        walk(entry.commands!, next)
        continue
      }
      routes.push(next.join(' '))
    }
  }

  walk(getCommandMap(specOrigin))
  return routes.toSorted()
}

export function normalizeCliFeature(feature: string) {
  if (!feature.startsWith('cli.')) throw new Error(`Not a CLI feature: ${feature}`)
  return feature.slice('cli.'.length).replace(/\./g, ' ')
}

function nestedCommandConfig(
  route: string[],
  payload: { args?: Record<string, unknown>; options?: Record<string, unknown> },
) {
  let node: Record<string, unknown> = {}
  if (payload.args && Object.keys(payload.args).length > 0) node.args = payload.args
  if (payload.options && Object.keys(payload.options).length > 0) node.options = payload.options

  for (let index = route.length - 1; index >= 0; index -= 1) {
    node = {
      commands: {
        [route[index]!]: node,
      },
    }
  }

  return node
}

function detectRouteTokens(argv: string[]) {
  const tokens: string[] = []
  let commands = getCommandMap(specOrigin)

  for (const token of argv) {
    if (token.startsWith('--')) break
    const entry = commands.get(token)
    if (!entry) break
    tokens.push(token)
    if (!isGroup(entry)) break
    commands = entry.commands!
  }

  return tokens
}

function writeConfig(
  route: string[],
  payload: { args?: Record<string, unknown>; options?: Record<string, unknown> },
  home: string,
) {
  const path = join(home, `.origin-red-config-${route.join('-')}.json`)
  writeFileSync(path, JSON.stringify(nestedCommandConfig(route, payload), null, 2))
  return path
}

function positionalArgValues(args: Record<string, unknown> | undefined) {
  const values: string[] = []

  for (const value of Object.values(args ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) values.push(String(item))
      continue
    }

    if (value !== undefined) {
      values.push(typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
  }

  return values
}

export function withHome<T>(callback: (home: string) => T) {
  const home = mkdtempSync(join(os.tmpdir(), 'origin-red-'))

  try {
    return callback(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function runOrigin(
  args: string[],
  options: {
    config?: { args?: Record<string, unknown>; options?: Record<string, unknown> }
    env?: Record<string, string | undefined>
    home: string
  },
): CommandResult {
  let extraArgs = [...args]

  if (options.config) {
    const route = detectRouteTokens(args)
    const trailing = args.slice(route.length)
    const positionalArgs = positionalArgValues(options.config.args)

    extraArgs = [...route, ...positionalArgs, ...trailing]

    if (options.config.options && Object.keys(options.config.options).length > 0) {
      const configPath = writeConfig(
        route,
        { options: options.config.options },
        options.home,
      )
      extraArgs.push('--config', configPath)
    }
  }

  try {
    return {
      exitCode: 0,
      stdout: execFileSync(originBin, extraArgs, {
        cwd: serverRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: options.home,
          ...options.env,
        },
        maxBuffer: 10 * 1024 * 1024,
      }),
      stderr: '',
    }
  } catch (error) {
    const failure = error as Error & {
      status?: number
      stdout?: Buffer | string
      stderr?: Buffer | string
    }

    return {
      exitCode: failure.status ?? 1,
      stdout: failure.stdout?.toString() ?? '',
      stderr: failure.stderr?.toString() ?? '',
    }
  }
}

function commandEntry(route: string[]) {
  let commands = getCommandMap(specOrigin)
  let entry: ContractEntry | undefined

  for (const token of route) {
    entry = commands.get(token)
    if (!entry) throw new Error(`Unknown Origin CLI route: ${route.join(' ')}`)
    if (isGroup(entry)) {
      commands = entry.commands!
    }
  }

  if (!entry || isGroup(entry)) {
    throw new Error(`Origin CLI route is not a leaf command: ${route.join(' ')}`)
  }
  return entry
}

function routeJsonSchemas(route: string[]) {
  const entry = commandEntry(route)
  return {
    args: entry.args?.toJSONSchema?.() as JsonSchema | undefined,
    options: entry.options?.toJSONSchema?.() as JsonSchema | undefined,
  }
}

const FIRST_PARTY_DOMAINS = new Set([
  'automation',
  'chat',
  'file',
  'memory',
  'note',
  'planning',
  'workspace',
])

const PROVIDER_DOMAINS = new Set(['email', 'github', 'telegram'])
const ONBOARDING_DOMAINS = new Set(['identity', 'integration', 'setup'])

const SEED_MARKERS: Record<string, string[]> = {
  activity: ['Initialized Origin CLI demo state.'],
  automation: ['Daily Telegram summary'],
  chat: ['Daily operator session'],
  email: ['agent@example.com', 'assistant@example.com'],
  github: ['origin/origin', 'gh_grant_'],
  planning: ['Implement full Origin CLI runtime', 'Triage mailbox follow-ups', 'Origin CLI'],
  setup: ['Setup is complete.'],
  status: ['Ready', 'provider overlays'],
  sync: ['2 replica peer(s)', '1 provider job(s)', 'bridge status: In sync.'],
  telegram: ['Daily summary with mention tracking enabled.', 'tg_chat_0001'],
  workspace: [
    'Origin CLI brief',
    'Inbox capture',
    '2 managed note(s) and 3 artifact(s).',
  ],
}

const FRESH_QUERY_TOKENS = new Set([
  'actors',
  'agenda',
  'aliases',
  'attention',
  'backlog',
  'blockers',
  'board',
  'channels',
  'checks',
  'comments',
  'context',
  'day',
  'deliveries',
  'devices',
  'doctor',
  'due',
  'errors',
  'events',
  'export',
  'failures',
  'files',
  'get',
  'headers',
  'history',
  'inbox',
  'inputs',
  'jobs',
  'kinds',
  'labels',
  'list',
  'next',
  'now',
  'outbox',
  'overdue',
  'overview',
  'paths',
  'pending',
  'peers',
  'phases',
  'project',
  'queue',
  'queues',
  'query',
  'raw',
  'read',
  'recent',
  'related',
  'relevant',
  'resolve',
  'reviews',
  'runtime',
  'search',
  'services',
  'show',
  'similar',
  'sources',
  'stats',
  'status',
  'storage',
  'summary',
  'summarize',
  'tail',
  'timeline',
  'today',
  'trace',
  'tree',
  'unread',
  'upcoming',
  'validate',
  'week',
  'window',
])

function routeFromFeature(feature: OriginFeature) {
  return String(feature).slice('cli.'.length).replace(/\./g, ' ').split(' ')
}

function routeDomain(route: string[]) {
  return route[0]!
}

function routeSecond(route: string[]) {
  return route[1] ?? ''
}

function routeLast(route: string[]) {
  return route.at(-1) ?? ''
}

function routeStartsWith(route: string[], prefix: string) {
  return route.join(' ').startsWith(prefix)
}

function normalizeOutput(stdout: string, stderr: string) {
  return `${stdout}\n${stderr}`.replace(/\s+/g, ' ').trim()
}

function parseJson(stdout: string) {
  return JSON.parse(stdout) as Record<string, any>
}

function runJson(
  route: string[],
  options: {
    config?: { args?: Record<string, unknown>; options?: Record<string, unknown> }
    env?: Record<string, string | undefined>
    home: string
  },
) {
  const result = runOrigin([...route, '--format', 'json'], options)
  expect(
    result.exitCode,
    `Expected ${route.join(' ')} to succeed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  ).toBe(0)
  return parseJson(result.stdout)
}

function requiredFieldNames(schema?: JsonSchema) {
  return new Set(schema?.required ?? [])
}

function routeNeedsIdentity(route: string[]) {
  const schemas = routeJsonSchemas(route)
  const required = [
    ...requiredFieldNames(schemas.args as JsonSchema),
    ...requiredFieldNames(schemas.options as JsonSchema),
  ]

  return required.some(
    (name) =>
      name === 'id' ||
      name.endsWith('-id') ||
      name.endsWith('Id') ||
      name === 'path' ||
      name === 'repo',
  )
}

function chooseUnionSchema(options: JsonSchema[], path: string[]) {
  const manual = options.find((option) => option.properties?.type?.const === 'manual')
  if (path.at(-1) === 'trigger' && manual) return manual
  return options[0]!
}

function sampleString(route: string[], path: string[], home: string) {
  const key = path.at(-1) ?? ''
  const full = route.join(' ')

  if (key === 'repo') return 'openai/origin-test'
  if (key === 'token-ref') return 'secure-ref/red-suite'
  if (key === 'cron') return '0 9 * * *'
  if (key === 'timezone' || key === 'due-timezone') return 'Europe/Paris'
  if (key === 'start-date') return '2026-04-08'
  if (key === 'end-date') return '2026-04-30'
  if (key === 'end-date-exclusive') return '2026-04-09'
  if (key === 'start-at') return '2026-04-09T09:00:00+02:00'
  if (key === 'end-at') return '2026-04-09T10:00:00+02:00'
  if (key === 'due-from') return '2026-04-09T09:00:00+02:00'
  if (key === 'due-at') return '2026-04-09T10:00:00+02:00'
  if (key === 'rule') return 'FREQ=WEEKLY;BYDAY=MO'
  if (key === 'subject') return 'RED Subject'
  if (key === 'body') return 'RED body'
  if (key === 'description-md') return 'RED description'
  if (key === 'summary') return 'RED summary'
  if (key === 'query') return 'RED'
  if (key === 'command') return 'context now'
  if (key === 'title') {
    if (full.startsWith('planning task')) return 'RED Task'
    if (full.startsWith('planning calendar-item')) return 'RED Event'
    if (full.startsWith('note ')) return 'RED Note'
    if (full.startsWith('chat ')) return 'RED Chat'
    return 'RED Title'
  }
  if (key === 'name') {
    if (full.startsWith('planning project')) return 'RED Project'
    if (full.startsWith('planning label')) return 'RED Label'
    if (full.startsWith('automation ')) return 'RED Automation'
    return 'RED Name'
  }
  if (key === 'slug') return 'red-suite'
  if (key === 'content') {
    if (full.startsWith('note ')) return '# RED Note\n'
    if (full.startsWith('workspace ')) return 'RED workspace content'
    if (full.startsWith('file ')) return 'RED file content'
    if (full.startsWith('memory ')) return 'RED memory fact'
    return 'RED content'
  }
  if (key === 'path') {
    if (full.startsWith('note ')) return 'Docs/Red.md'
    if (full.startsWith('workspace ')) return 'RED/fixture.txt'
    if (full.startsWith('memory artifact')) return 'Artifacts/red.json'
    if (full.startsWith('file ')) return join(home, 'red-files', 'fixture.txt')
    return join(home, 'red-path')
  }
  if (key === 'id' || key.endsWith('-id') || key.endsWith('Id')) {
    if (key.includes('task')) return 'tsk_red_missing'
    if (key.includes('project')) return 'prj_red_missing'
    if (key.includes('label')) return 'lbl_red_missing'
    if (key.includes('calendar')) return 'cal_red_missing'
    if (key.includes('note')) return 'note_red_missing'
    if (key.includes('chat')) return 'chat_red_missing'
    if (key.includes('automation')) return 'auto_red_missing'
    if (key.includes('grant')) return 'gh_grant_red_missing'
    if (routeDomain(route) === 'email') return 'mail_red_missing'
    if (routeDomain(route) === 'github') return 'gh_red_missing'
    if (routeDomain(route) === 'telegram') return 'tg_red_missing'
    return 'red_missing_id'
  }
  if (key === 'to' || key === 'from' || key === 'cc' || key === 'bcc') {
    return 'user@example.com'
  }

  return `red-${key || 'value'}`
}

function sampleFromSchema(
  schema: JsonSchema | undefined,
  route: string[],
  path: string[],
  home: string,
): unknown {
  if (!schema) return undefined
  if (schema.const !== undefined) return schema.const
  if (schema.enum?.length) return schema.enum[0]
  if (schema.oneOf?.length) {
    return sampleFromSchema(chooseUnionSchema(schema.oneOf, path), route, path, home)
  }
  if (schema.anyOf?.length) {
    return sampleFromSchema(chooseUnionSchema(schema.anyOf, path), route, path, home)
  }

  switch (schema.type) {
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const key of schema.required ?? []) {
        const value = sampleFromSchema(schema.properties?.[key], route, [...path, key], home)
        if (value !== undefined) result[key] = value
      }
      return result
    }
    case 'array':
      return [sampleFromSchema(schema.items, route, [...path, '0'], home)]
    case 'boolean':
      return true
    case 'number':
    case 'integer':
      return schema.minimum ?? 1
    case 'string':
    default:
      return sampleString(route, path, home)
  }
}

function buildConfig(route: string[], home: string) {
  const schemas = routeJsonSchemas(route)
  const args =
    (sampleFromSchema(
      schemas.args as JsonSchema | undefined,
      route,
      ['args'],
      home,
    ) as Record<string, unknown> | undefined) ?? {}
  const options =
    (sampleFromSchema(
      schemas.options as JsonSchema | undefined,
      route,
      ['options'],
      home,
    ) as Record<string, unknown> | undefined) ?? {}

  if (route.join(' ') === 'automation create') {
    options.name = 'RED Automation'
    options.trigger = { type: 'manual' }
    options.actions = [{ type: 'command', command: 'context now' }]
  }

  return { args, options }
}

function isIdentityKey(key: string) {
  return (
    key === 'id' ||
    key.endsWith('-id') ||
    key.endsWith('Id') ||
    key === 'path' ||
    key === 'repo'
  )
}

function collectIdentityValues(config: {
  args?: Record<string, unknown>
  options?: Record<string, unknown>
}) {
  const values = new Set<string>()

  function visit(value: unknown, key?: string) {
    if (typeof value === 'string') {
      if (key && isIdentityKey(key)) values.add(value)
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, key)
      return
    }

    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, childKey)
      }
    }
  }

  visit(config.args ?? {})
  visit(config.options ?? {})
  return [...values]
}

function assertNoSeedLeak(route: string[], output: string) {
  for (const marker of SEED_MARKERS[routeDomain(route)] ?? []) {
    expect(
      output,
      `Expected ${route.join(' ')} not to leak seeded runtime marker ${marker}`,
    ).not.toContain(marker)
  }
}

function expectNoHarnessArtifact(route: string[], output: string) {
  const lower = output.toLowerCase()

  expect(
    lower,
    `Expected ${route.join(' ')} to fail for runtime behavior, not harness validation or opaque object stringification.`,
  ).not.toContain('validation_error')
  expect(lower).not.toContain('unknown flag')
  expect(lower).not.toContain('invalid input')
  expect(lower).not.toContain('invalid_type')
  expect(lower).not.toContain('[object object]')
}

function expectFreshQueryJson(route: string[], json: Record<string, any>) {
  const full = route.join(' ')

  if (Array.isArray(json.items)) {
    expect(json.items.length, `Expected ${full} to start empty on a fresh home.`).toBe(0)
  }

  if (typeof json.total === 'number') {
    expect(json.total).toBe(0)
  }

  if (full === 'status show') {
    expect(json.setup).not.toBe('Ready')
    expect(
      (json.integrations ?? []).filter((entry: any) => entry.status === 'connected'),
    ).toHaveLength(0)
  }

  if (full === 'status doctor') {
    expect(String(json.status).toLowerCase()).not.toBe('pass')
    expect(JSON.stringify(json).toLowerCase()).not.toContain('all status checks passed')
  }

  if (full === 'setup status') {
    expect(json.status).not.toBe('ready')
  }

  if (full === 'identity status') {
    expect(json.status).not.toBe('complete')
  }

  if (full === 'context now') {
    expect((json.entities ?? []).length).toBe(0)
    expect(String(json.summary).toLowerCase()).not.toContain('demo')
    expect(String(json.summary).toLowerCase()).not.toContain('bootstrap')
  }

  if (routeDomain(route) === 'activity') {
    expect(JSON.stringify(json)).not.toContain('system.bootstrap')
  }

  if (full === 'email account status' || full === 'github account status') {
    expect(String(json.status ?? json.summary ?? '').toLowerCase()).not.toContain('connected')
  }

  if (
    full === 'email account validate' ||
    full === 'github account validate' ||
    full === 'telegram connection validate'
  ) {
    expect(String(json.status ?? '').toLowerCase()).not.toBe('pass')
  }

  if (full === 'telegram connection status') {
    expect(String(json.status).toLowerCase()).toBe('unconfigured')
  }

  if (full === 'memory get') {
    throw new Error('memory get should stay unavailable on a fresh home before explicit bootstrap')
  }
}

function expectBlockingFailure(
  route: string[],
  config: { args?: Record<string, unknown>; options?: Record<string, unknown> },
  output: string,
) {
  const lower = output.toLowerCase()
  const configurationFirst =
    PROVIDER_DOMAINS.has(routeDomain(route)) ||
    routeStartsWith(route, 'planning google-calendar ') ||
    routeStartsWith(route, 'planning google-tasks ') ||
    ONBOARDING_DOMAINS.has(routeDomain(route))

  expectNoHarnessArtifact(route, output)

  if (routeNeedsIdentity(route) && !configurationFirst) {
    const identifiers = collectIdentityValues(config)

    expect(
      identifiers.length,
      `Expected ${route.join(' ')} to include a missing object reference in the generated config.`,
    ).toBeGreaterThan(0)
    expect(
      identifiers.some((identifier) => output.includes(identifier)),
      `Expected ${route.join(' ')} failure to mention the missing object ref.\noutput:\n${output}`,
    ).toBe(true)
    expect(
      lower,
      `Expected ${route.join(' ')} to fail because the referenced object or path does not exist.`,
    ).toMatch(/not[_ -]?found|missing|unknown [a-z0-9 _-]*(id|path|repo)/)
    return
  }

  expect(
    lower,
    `Expected ${route.join(' ')} to fail for a configuration, setup, confirmation, or disabled-state reason.`,
  ).toMatch(/not configured|unconfigured|pending|blocked|requires|confirm|disabled|invalid|expected/)
}

function isCreateLikeRoute(route: string[]) {
  if (!FIRST_PARTY_DOMAINS.has(routeDomain(route))) return false
  const full = route.join(' ')
  return full === 'memory add' || ['add', 'create', 'mkdir', 'write'].includes(routeLast(route))
}

function isFreshQueryRoute(route: string[]) {
  if (routeNeedsIdentity(route)) return false

  if (
    routeDomain(route) === 'planning' &&
    [
      'agenda',
      'backlog',
      'board',
      'inbox',
      'overdue',
      'recurring',
      'today',
      'upcoming',
      'week',
      'window',
    ].includes(routeSecond(route))
  ) {
    return true
  }

  return FRESH_QUERY_TOKENS.has(routeLast(route)) || FRESH_QUERY_TOKENS.has(routeSecond(route))
}

function relatedQueryRoute(route: string[]) {
  const full = route.join(' ')
  if (full === 'planning project create') return ['planning', 'project', 'list']
  if (full === 'planning label create') return ['planning', 'label', 'list']
  if (full === 'planning task create') return ['planning', 'task', 'list']
  if (full === 'planning calendar-item create') return ['planning', 'calendar-item', 'list']
  if (full === 'chat create') return ['chat', 'list']
  if (full === 'note create') return ['note', 'list']
  if (full === 'memory artifact create') return ['memory', 'artifact', 'list']
  if (full === 'memory add') return ['memory', 'get']
  if (full === 'automation create') return ['automation', 'list']
  if (full === 'file write') return ['file', 'read']
  if (full === 'workspace write') return ['workspace', 'read']
  return null
}

function expectedCreateMarker(route: string[]) {
  const full = route.join(' ')
  if (full === 'planning project create') return 'RED Project'
  if (full === 'planning label create') return 'RED Label'
  if (full === 'planning task create') return 'RED Task'
  if (full === 'planning calendar-item create') return 'RED Event'
  if (full === 'chat create') return 'RED Chat'
  if (full === 'note create') return 'RED Note'
  if (full === 'memory artifact create') return 'red.json'
  if (full === 'memory add') return 'RED memory fact'
  if (full === 'automation create') return 'RED Automation'
  if (full === 'file write') return 'RED file content'
  if (full === 'workspace write') return 'RED workspace content'
  return 'RED'
}

type BehaviorClass =
  | 'fresh-query'
  | 'first-party-create-readback'
  | 'provider-config-gate'
  | 'onboarding-gate'
  | 'mutation-requires-existing-object'
  | 'cross-object-consistency'

type ScenarioConfig = {
  args?: Record<string, unknown>
  options?: Record<string, unknown>
}

const ROUTE_CLASS_OVERRIDES: Record<string, BehaviorClass> = {
  'activity get': 'mutation-requires-existing-object',
  'activity related': 'mutation-requires-existing-object',
  'activity trace': 'mutation-requires-existing-object',
  'memory add': 'onboarding-gate',
  'memory artifact create': 'onboarding-gate',
  'memory artifact delete': 'onboarding-gate',
  'memory artifact get': 'onboarding-gate',
  'memory artifact history': 'onboarding-gate',
  'memory artifact link': 'cross-object-consistency',
  'memory artifact move': 'onboarding-gate',
  'memory artifact restore': 'onboarding-gate',
  'memory artifact search': 'onboarding-gate',
  'memory artifact unlink': 'cross-object-consistency',
  'memory artifact update': 'onboarding-gate',
  'memory get': 'onboarding-gate',
  'note attachment add': 'cross-object-consistency',
  'note attachment remove': 'cross-object-consistency',
  'planning calendar-item task link': 'cross-object-consistency',
  'planning calendar-item task unlink': 'cross-object-consistency',
  'planning task note link': 'cross-object-consistency',
  'planning task note unlink': 'cross-object-consistency',
  'planning task schedule clear': 'cross-object-consistency',
  'planning task schedule set': 'cross-object-consistency',
  'setup vault init': 'cross-object-consistency',
  'setup vault reconcile apply': 'cross-object-consistency',
  'setup vault reconcile get': 'cross-object-consistency',
  'telegram connection configure': 'onboarding-gate',
  'telegram connection set-token': 'onboarding-gate',
}

const QUERY_VERBS = new Set([
  'actors',
  'agenda',
  'aliases',
  'attention',
  'backlog',
  'blockers',
  'board',
  'channels',
  'checks',
  'comments',
  'context',
  'day',
  'deliveries',
  'devices',
  'doctor',
  'due',
  'errors',
  'events',
  'export',
  'failures',
  'files',
  'get',
  'headers',
  'history',
  'inbox',
  'inputs',
  'jobs',
  'kinds',
  'labels',
  'list',
  'next',
  'now',
  'outbox',
  'overdue',
  'overview',
  'paths',
  'pending',
  'peers',
  'phases',
  'project',
  'queue',
  'queues',
  'query',
  'raw',
  'read',
  'recent',
  'related',
  'relevant',
  'resolve',
  'reviews',
  'runtime',
  'search',
  'services',
  'show',
  'similar',
  'sources',
  'stats',
  'status',
  'storage',
  'summary',
  'summarize',
  'tail',
  'timeline',
  'today',
  'trace',
  'tree',
  'unread',
  'upcoming',
  'validate',
  'week',
  'window',
])

const CREATE_VERBS = new Set(['add', 'create', 'mkdir', 'write'])
const MUTATION_EXISTING_VERBS = new Set([
  'ack',
  'archive',
  'backfill',
  'cancel',
  'clear',
  'close',
  'confirm',
  'delete',
  'disable',
  'deselect',
  'enable',
  'forward',
  'merge',
  'move',
  'pause',
  'pin',
  'read',
  'remove',
  'reopen',
  'reply',
  'reply-all',
  'repair',
  'resolve',
  'restore',
  'retry',
  'revoke',
  'run',
  'select',
  'send',
  'set',
  'skip-next',
  'snooze',
  'spam',
  'star',
  'submit',
  'trash',
  'unarchive',
  'unpin',
  'unread',
  'unspam',
  'unstar',
  'update',
  'unlock',
  'unlink',
])

function routeKey(route: string[]) {
  return route.join(' ')
}

function featureToRoute(feature: OriginFeature) {
  return String(feature).slice('cli.'.length).replace(/\./g, ' ').split(' ')
}

function syntheticId(route: string[], suffix = 'missing') {
  const domain = routeDomain(route)
  const second = routeSecond(route)

  if (domain === 'activity') return `act_red_${suffix}`
  if (domain === 'automation') return `auto_red_${suffix}`
  if (domain === 'chat') return `chat_red_${suffix}`
  if (domain === 'email') {
    if (second === 'account') return `mail_account_red_${suffix}`
    if (second === 'draft') return `draft_red_${suffix}`
    if (second === 'message') return `mail_msg_red_${suffix}`
    if (second === 'outbox') return `mail_outbox_red_${suffix}`
    if (second === 'thread') return `mail_thread_red_${suffix}`
    return `mail_red_${suffix}`
  }
  if (domain === 'github') {
    if (second === 'account') return `gh_account_red_${suffix}`
    if (second === 'follow') return `gh_follow_red_${suffix}`
    if (second === 'issue') return `gh_issue_red_${suffix}`
    if (second === 'outbox') return `gh_outbox_red_${suffix}`
    if (second === 'pr') return `gh_pr_red_${suffix}`
    if (second === 'review') return `gh_review_red_${suffix}`
    if (second === 'repo') return `gh_repo_red_${suffix}`
    return `gh_red_${suffix}`
  }
  if (domain === 'identity') return `identity_red_${suffix}`
  if (domain === 'integration') return `integration_red_${suffix}`
  if (domain === 'memory') return `memory_red_${suffix}`
  if (domain === 'note') return `note_red_${suffix}`
  if (domain === 'notification') return `notification_red_${suffix}`
  if (domain === 'planning') {
    if (second === 'calendar-item') return `cal_red_${suffix}`
    if (second === 'google-calendar') return `gcal_red_${suffix}`
    if (second === 'google-tasks') return `gtask_red_${suffix}`
    if (second === 'label') return `label_red_${suffix}`
    if (second === 'project') return `project_red_${suffix}`
    if (second === 'task') return `task_red_${suffix}`
    return `plan_red_${suffix}`
  }
  if (domain === 'search') return `search_red_${suffix}`
  if (domain === 'setup') return `setup_red_${suffix}`
  if (domain === 'sync') return `sync_red_${suffix}`
  if (domain === 'telegram') {
    if (second === 'chat') return `tg_chat_red_${suffix}`
    if (second === 'connection') return `tg_conn_red_${suffix}`
    if (second === 'group') return `tg_group_red_${suffix}`
    if (second === 'mention') return `tg_mention_red_${suffix}`
    if (second === 'message') return `tg_message_red_${suffix}`
    if (second === 'outbox') return `tg_outbox_red_${suffix}`
    if (second === 'summary') return `tg_summary_red_${suffix}`
    return `tg_red_${suffix}`
  }
  if (domain === 'workspace') return `workspace_red_${suffix}`
  if (domain === 'file') return `file_red_${suffix}`
  return `red_${suffix}`
}

function syntheticPath(route: string[], home: string) {
  const full = routeKey(route)
  if (full.startsWith('note ')) return 'Docs/Red.md'
  if (full.startsWith('workspace ')) return 'RED/fixture.txt'
  if (full.startsWith('memory artifact')) return 'Artifacts/red.json'
  if (full.startsWith('file ')) return join(home, 'red-files', 'fixture.txt')
  return join(home, 'red-path')
}

function syntheticQuery(route: string[]) {
  const key = routeKey(route)
  if (key.startsWith('search ')) return 'RED'
  if (key.startsWith('activity ')) return 'RED'
  if (key.startsWith('context ')) return 'RED'
  if (key.startsWith('status ')) return 'RED'
  return 'RED'
}

function scenarioArgsForRoute(route: string[], home: string) {
  const full = routeKey(route)
  const domain = routeDomain(route)
  const second = routeSecond(route)
  const verb = routeLast(route)

  if (domain === 'activity' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'activity') }
  }
  if (domain === 'automation' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'automation') }
  }
  if (domain === 'chat' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'chat') }
  }
  if (domain === 'email' && second === 'thread' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'thread') }
  }
  if (domain === 'email' && second === 'message' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'message') }
  }
  if (domain === 'github' && second === 'issue' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'issue') }
  }
  if (domain === 'github' && second === 'pr' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'pr') }
  }
  if (domain === 'github' && second === 'review' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'review') }
  }
  if (domain === 'identity' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'identity') }
  }
  if (domain === 'integration' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'integration') }
  }
  if (domain === 'notification' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'notification') }
  }
  if (domain === 'planning' && second === 'calendar-item' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'calendar') }
  }
  if (domain === 'planning' && second === 'project' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'project') }
  }
  if (domain === 'planning' && second === 'task' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'task') }
  }
  if (domain === 'planning' && second === 'label' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'label') }
  }
  if (domain === 'planning' && (second === 'google-calendar' || second === 'google-tasks')) {
    return { id: syntheticId(route, second === 'google-calendar' ? 'calendar' : 'task') }
  }
  if (domain === 'sync' && second === 'intent' && verb !== 'list') {
    return { id: syntheticId(route, 'sync') }
  }
  if (domain === 'sync' && second === 'outbox' && verb !== 'list') {
    return { id: syntheticId(route, 'sync') }
  }
  if (domain === 'telegram' && second === 'chat' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'chat') }
  }
  if (domain === 'telegram' && second === 'group' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { id: syntheticId(route, 'group') }
  }
  if (domain === 'workspace' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { path: syntheticPath(route, home) }
  }
  if (domain === 'file' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { path: syntheticPath(route, home) }
  }
  if (domain === 'note' && MUTATION_EXISTING_VERBS.has(verb)) {
    return { path: 'Docs/Red.md' }
  }
  if (domain === 'search' || domain === 'status' || domain === 'context') {
    return { query: syntheticQuery(route) }
  }
  if (domain === 'setup' && second === 'provider' && route[2] === 'github' && route[3] === 'grant') {
    return { id: syntheticId(route, 'grant') }
  }
  if (domain === 'setup' && second === 'vault' && verb === 'reconcile') {
    return { id: syntheticId(route, 'reconcile') }
  }

  if (full === 'chat archive' || full === 'chat delete' || full === 'chat get' || full === 'chat rename' || full === 'chat send') {
    return { id: syntheticId(route, 'chat'), status: 'active', summary: 'RED summary' }
  }

  if (full === 'email send' || full === 'email reply' || full === 'email reply-all' || full === 'email forward') {
    return { id: syntheticId(route, 'thread') }
  }

  if (full === 'github issue comment' || full === 'github pr comment' || full === 'github issue update' || full === 'github pr update') {
    return { repo: 'openai/origin-test', id: syntheticId(route, second === 'issue' ? 'issue' : 'pr') }
  }

  return {}
}

function scenarioConfigForRoute(route: string[], home: string): ScenarioConfig {
  const full = routeKey(route)

  switch (full) {
    case 'automation create':
      return {
        options: {
          actions: [{ command: 'context now', type: 'command' }],
          name: 'RED Automation',
          trigger: { type: 'manual' },
        },
      }
    case 'chat create':
      return { options: { title: 'RED Chat' } }
    case 'file mkdir':
      return { options: { path: syntheticPath(route, home) } }
    case 'file write':
      return { options: { content: 'RED file content', path: syntheticPath(route, home) } }
    case 'memory add':
      return { options: { content: 'RED memory fact' } }
    case 'memory artifact create':
      return { options: { kind: 'note', path: 'Artifacts/red.json', summary: 'RED summary' } }
    case 'note create':
      return { options: { content: '# RED Note\n', path: 'Docs/Red.md' } }
    case 'planning calendar-item create':
      return {
        options: {
          'end-at': '2026-04-09T10:00:00+02:00',
          'start-at': '2026-04-09T09:00:00+02:00',
          timezone: 'Europe/Paris',
          title: 'RED Event',
        },
      }
    case 'planning label create':
      return { options: { name: 'RED Label' } }
    case 'planning project create':
      return { options: { name: 'RED Project' } }
    case 'planning task create':
      return { options: { title: 'RED Task' } }
    case 'planning task recurrence set':
      return { options: { 'start-date': '2026-04-08', rule: 'FREQ=WEEKLY;BYDAY=MO' } }
    case 'planning task schedule set':
      return {
        options: {
          'end-at': '2026-04-09T10:00:00+02:00',
          'start-at': '2026-04-09T09:00:00+02:00',
          timezone: 'Europe/Paris',
        },
      }
    case 'setup provider github oauth-complete':
    case 'setup provider google oauth-complete':
      return { options: { 'code-ref': 'secure-ref/red-code' } }
    case 'setup provider telegram configure':
      return { options: { 'expected-privacy-mode': 'enabled', 'group-ids': ['tg_chat_1'] } }
    case 'setup provider telegram token-set':
      return { options: { 'token-ref': 'secure-ref/red-suite' } }
    case 'setup vault init':
      return { options: { path: join(home, 'existing-vault') } }
    case 'setup vault memory-bootstrap':
      return { options: { content: '# Operator facts\n' } }
    case 'email send':
      return { options: { body: 'RED body', subject: 'RED Subject', to: 'user@example.com' } }
    case 'email draft create':
      return { options: { body: 'RED body', subject: 'RED Subject', to: 'user@example.com' } }
    case 'github issue create':
      return { options: { body: 'RED body', repo: 'openai/origin-test', title: 'RED Issue' } }
    case 'github pr open':
      return {
        options: {
          base: 'main',
          body: 'RED body',
          head: 'red/head',
          repo: 'openai/origin-test',
          title: 'RED PR',
        },
      }
    case 'github issue comment':
      return { options: { body: 'RED comment', repo: 'openai/origin-test' } }
    case 'github pr comment':
      return { options: { body: 'RED comment', repo: 'openai/origin-test' } }
    case 'telegram message send':
      return { options: { 'chat-id': 'tg_chat_red_missing', text: 'RED message' } }
    case 'planning task due set':
      return {
        options: {
          'due-at': '2026-04-09T10:00:00+02:00',
          timezone: 'Europe/Paris',
        },
      }
    case 'planning calendar-item recurrence set':
      return { options: { 'start-date': '2026-04-08', rule: 'FREQ=WEEKLY;BYDAY=MO' } }
  }

  if (full.startsWith('search ')) {
    return { options: { query: 'RED' } }
  }

  if (full.startsWith('planning google-calendar ')) {
    return { options: { 'surface-id': 'gcal_red_missing' } }
  }

  if (full.startsWith('planning google-tasks ')) {
    return { options: { 'surface-id': 'gtask_red_missing' } }
  }

  if (full === 'activity get' || full === 'activity related' || full === 'activity trace') {
    return { options: { id: syntheticId(route, 'activity') } }
  }

  if (full === 'chat archive' || full === 'chat delete' || full === 'chat get' || full === 'chat rename' || full === 'chat send') {
    return { options: { id: syntheticId(route, 'chat'), status: 'active', summary: 'RED summary' } }
  }

  if (full === 'email reply' || full === 'email reply-all' || full === 'email forward') {
    return { options: { id: syntheticId(route, 'thread') } }
  }

  if (full === 'github issue update' || full === 'github pr update' || full === 'github issue comment' || full === 'github pr comment') {
    return { options: { id: syntheticId(route, full.includes('issue') ? 'issue' : 'pr'), repo: 'openai/origin-test' } }
  }

  return { args: scenarioArgsForRoute(route, home) }
}

function routeBehavior(route: string[]): BehaviorClass {
  const full = routeKey(route)
  const override = ROUTE_CLASS_OVERRIDES[full]
  if (override) return override

  const domain = routeDomain(route)
  const second = routeSecond(route)
  const verb = routeLast(route)

  if (domain === 'activity') {
    return QUERY_VERBS.has(verb) ? 'fresh-query' : 'mutation-requires-existing-object'
  }

  if (domain === 'context' || domain === 'status' || domain === 'search') {
    return 'fresh-query'
  }

  if (domain === 'sync') {
    if (second === 'intent' || second === 'outbox' || second === 'conflict') {
      return verb === 'list' ? 'fresh-query' : 'mutation-requires-existing-object'
    }
    return 'fresh-query'
  }

  if (ONBOARDING_DOMAINS.has(domain)) {
    return 'onboarding-gate'
  }

  if (domain === 'memory') {
    return 'onboarding-gate'
  }

  if (domain === 'planning' && (second === 'google-calendar' || second === 'google-tasks')) {
    return 'provider-config-gate'
  }

  if (PROVIDER_DOMAINS.has(domain)) {
    if (QUERY_VERBS.has(verb) || verb === 'list') return 'fresh-query'
    return 'provider-config-gate'
  }

  if (FIRST_PARTY_DOMAINS.has(domain)) {
    if (CREATE_VERBS.has(verb)) return 'first-party-create-readback'
    if (QUERY_VERBS.has(verb)) return 'fresh-query'
    if (MUTATION_EXISTING_VERBS.has(verb)) return 'mutation-requires-existing-object'
    return 'fresh-query'
  }

  return 'fresh-query'
}

function normalizeRouteForGate(route: string[]) {
  const behavior = routeBehavior(route)
  if (behavior === 'provider-config-gate' || behavior === 'onboarding-gate') {
    return behavior
  }
  return behavior
}

function expectRouteFailure(route: string[], output: string) {
  expectNoHarnessArtifact(route, output)
  expect(output.toLowerCase()).toMatch(/not configured|unconfigured|pending|blocked|requires|confirm|disabled|invalid|expected|missing|not[_ -]?found|unknown [a-z0-9 _-]*(id|path|repo)/)
}

function assertFreshQueryBehavior(route: string[]) {
  withHome((home) => {
    const config = buildConfig(route, home)
    const result = runOrigin([...route, '--format', 'json'], {
      home,
      config,
    })
    const output = normalizeOutput(result.stdout, result.stderr)
    assertNoSeedLeak(route, output)
    expectNoHarnessArtifact(route, output)

    if (result.exitCode !== 0) {
      expectBlockingFailure(route, config, output)
      return
    }

    expectFreshQueryJson(route, parseJson(result.stdout))
  })
}

function assertCreateBehavior(route: string[]) {
  withHome((home) => {
    const config = buildConfig(route, home)
    const create = runOrigin([...route, '--format', 'json'], {
      home,
      config,
    })
    expect(
      create.exitCode,
      `${route.join(' ')} should create a real object on a fresh home.`,
    ).toBe(0)

    const related = relatedQueryRoute(route)
    if (!related) throw new Error(`Missing related query route for ${route.join(' ')}`)

    const followUp = runOrigin([...related, '--format', 'json'], {
      home,
      config: buildConfig(related, home),
    })
    expect(followUp.exitCode).toBe(0)

    const output = normalizeOutput(followUp.stdout, followUp.stderr)
    assertNoSeedLeak(route, output)
    expect(output).toContain(expectedCreateMarker(route))

    const json = parseJson(followUp.stdout)
    if (Array.isArray(json.items)) expect(json.items.length).toBe(1)
    if (typeof json.total === 'number') expect(json.total).toBe(1)
  })
}

function assertOnboardingMutationBehavior(route: string[]) {
  withHome((home) => {
    const config = buildConfig(route, home)
    const result = runOrigin([...route, '--format', 'json'], {
      home,
      config,
    })
    const output = normalizeOutput(result.stdout, result.stderr)
    assertNoSeedLeak(route, output)
    expectNoHarnessArtifact(route, output)

    if (result.exitCode !== 0) {
      expectBlockingFailure(route, config, output)
    }

    const setup = runOrigin(['setup', 'status', '--format', 'json'], { home })
    const setupJson = parseJson(setup.stdout)
    expect(setupJson.status).not.toBe('ready')

    const status = runOrigin(['status', 'show', '--format', 'json'], { home })
    const statusJson = parseJson(status.stdout)
    expect(statusJson.setup).not.toBe('Ready')
    expect(
      (statusJson.integrations ?? []).filter((entry: any) => entry.status === 'connected'),
    ).toHaveLength(0)
  })
}

function assertBlockingMutationBehavior(route: string[]) {
  withHome((home) => {
    const config = buildConfig(route, home)
    const result = runOrigin([...route, '--format', 'json'], {
      home,
      config,
    })
    const output = normalizeOutput(result.stdout, result.stderr)

    expect(
      result.exitCode,
      `${route.join(' ')} should not fabricate success for missing state.`,
    ).not.toBe(0)
    assertNoSeedLeak(route, output)
    expectBlockingFailure(route, config, output)
  })
}

export function assertCliFeatureBehavior(feature: OriginFeature) {
  const route = routeFromFeature(feature)

  if (ONBOARDING_DOMAINS.has(routeDomain(route))) {
    if (isFreshQueryRoute(route)) {
      assertFreshQueryBehavior(route)
      return
    }
    assertOnboardingMutationBehavior(route)
    return
  }

  if (PROVIDER_DOMAINS.has(routeDomain(route))) {
    if (isFreshQueryRoute(route)) {
      assertFreshQueryBehavior(route)
      return
    }
    assertBlockingMutationBehavior(route)
    return
  }

  if (isCreateLikeRoute(route)) {
    assertCreateBehavior(route)
    return
  }

  if (isFreshQueryRoute(route)) {
    assertFreshQueryBehavior(route)
    return
  }

  assertBlockingMutationBehavior(route)
}

export function assertRootDiscoveryContract() {
  withHome((home) => {
    const help = runOrigin(['--help'], { home })
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain('Usage: origin <command>')
    expect(help.stdout).toContain('--llms, --llms-full')
    expect(help.stdout).toContain('--schema')
    expect(help.stdout).toContain('--config')

    const llms = runOrigin(['--llms'], { home })
    expect(llms.exitCode).toBe(0)
    expect(llms.stdout).toContain('# origin')
    expect(llms.stdout).toContain('| `origin status show` |')
    expect(llms.stdout).toContain('| `origin workspace status` |')

    const llmsFull = runOrigin(['--llms-full'], { home })
    expect(llmsFull.exitCode).toBe(0)
    expect(llmsFull.stdout).toContain('### origin status show')
    expect(llmsFull.stdout).toContain('### origin workspace status')
    expect(llmsFull.stdout).toContain('#### Output')

    const schema = runOrigin(['status', 'show', '--schema'], { home })
    expect(schema.exitCode).toBe(0)
    expect(schema.stdout).toContain('setup:')
    expect(schema.stdout).toContain('integrations:')

    const skills = runOrigin(['skills', 'add', '--help'], { home })
    expect(skills.exitCode).toBe(0)
    expect(skills.stdout).toContain('Usage: origin skills add [options]')

    const mcp = runOrigin(['mcp', 'add', '--help'], { home })
    expect(mcp.exitCode).toBe(0)
    expect(mcp.stdout).toContain('Usage: origin mcp add [options]')
  })
}

export function assertRootEnvOverrides() {
  withHome((home) => {
    const env = {
      ORIGIN_API_URL: 'https://origin.example.test',
      ORIGIN_INSTANCE: 'vps',
      ORIGIN_PROFILE: 'alpha',
    }

    const paths = runJson(['status', 'paths'], { home, env })
    expect(String(paths.state)).toContain('/.origin/alpha/')
    expect(String(paths.workspace)).toContain('/.origin/alpha/workspace')
    expect(String(paths.vault)).toContain('/.origin/alpha/workspace')

    const runtime = runJson(['status', 'runtime'], { home, env })
    expect(runtime.mode).toBe('vps')
    expect(runtime.profile).toBe('alpha')
    expect(runtime['api-url']).toBe('https://origin.example.test')
  })
}

export function assertSqliteStorageContract() {
  withHome((home) => {
    const paths = runJson(['status', 'paths'], { home })
    const storage = runJson(['status', 'storage'], { home })

    expect(String(paths.sqlite)).toContain('.sqlite')
    expect(String(storage.sqlite)).toContain('.sqlite')
    expect(String(storage.sqlite)).not.toContain('state.json')
  })
}

export function assertFreshSetupRequiresOnboarding() {
  withHome((home) => {
    const setup = runJson(['setup', 'status'], { home })
    expect(setup.status).not.toBe('ready')
    expect(String(setup.summary).toLowerCase()).not.toContain('complete')
    expect(Array.isArray(setup.phases)).toBe(true)
    expect(setup.phases.length).toBeGreaterThanOrEqual(10)
    expect(setup.phases.some((phase: Record<string, any>) => phase.status !== 'complete')).toBe(true)

    const identity = runJson(['identity', 'status'], { home })
    expect(identity.status).not.toBe('complete')

    const integrations = runJson(['integration', 'list'], { home })
    expect(
      (integrations.items ?? []).some(
        (integration: Record<string, any>) => integration.status === 'connected',
      ),
    ).toBe(false)
  })
}

export function assertFreshStatusContextStayUnseeded() {
  withHome((home) => {
    const status = runJson(['status', 'show'], { home })
    expect(String(status.setup).toLowerCase()).not.toContain('ready')
    expect(JSON.stringify(status)).not.toContain('provider overlays')

    const context = runJson(['context', 'now'], { home })
    expect((context.entities ?? []).length).toBe(0)
    expect(String(context.summary).toLowerCase()).not.toContain('demo')
    expect(String(context.summary).toLowerCase()).not.toContain('bootstrap')

    const activity = runJson(['activity', 'list'], { home })
    expect(Number(activity.total ?? activity.items?.length ?? 0)).toBe(0)
  })
}

export function assertFreshPlanningState() {
  withHome((home) => {
    expect(Number(runJson(['planning', 'project', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['planning', 'label', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['planning', 'task', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['planning', 'calendar-item', 'list'], { home }).total ?? 0)).toBe(0)
  })
}

export function assertFreshChatState() {
  withHome((home) => {
    expect(Number(runJson(['chat', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['chat', 'outbox'], { home }).total ?? 0)).toBe(0)
  })
}

export function assertFreshEmailProviderState() {
  withHome((home) => {
    expect(Number(runJson(['email', 'account', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['email', 'thread', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['email', 'draft', 'list'], { home }).total ?? 0)).toBe(0)

    const send = runOrigin(
      ['email', 'send', '--to', 'user@example.com', '--subject', 'Hi', '--body', 'Test', '--format', 'json'],
      { home },
    )
    expect(send.exitCode).not.toBe(0)
  })
}

export function assertFreshGithubProviderState() {
  withHome((home) => {
    expect(Number(runJson(['github', 'repo', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['github', 'follow', 'list'], { home }).total ?? 0)).toBe(0)
  })
}

export function assertGithubGrantSelectionStaysExplicit() {
  withHome((home) => {
    expect(Number(runJson(['setup', 'provider', 'github', 'grant', 'list'], { home }).total ?? 0)).toBe(0)

    const validate = runJson(['github', 'account', 'validate'], { home })
    expect(validate.status).not.toBe('pass')

    const oauth = runOrigin(
      ['setup', 'provider', 'github', 'oauth-complete', '--code-ref', 'secure_ref', '--format', 'json'],
      { home },
    )
    expect(oauth.exitCode).toBe(0)

    const setup = runJson(['setup', 'status'], { home })
    expect(setup.status).not.toBe('ready')

    const permissions = runJson(['github', 'account', 'permissions'], { home })
    expect((permissions.granted ?? []).length).toBe(0)
  })
}

export function assertFreshTelegramProviderState() {
  withHome((home) => {
    const status = runJson(['telegram', 'connection', 'status'], { home })
    expect(status.status).toBe('unconfigured')
    expect(Number(runJson(['telegram', 'chat', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['telegram', 'group', 'list'], { home }).total ?? 0)).toBe(0)
  })
}

export function assertTelegramSecureRefContract() {
  withHome((home) => {
    const status = runJson(['telegram', 'connection', 'status'], { home })
    expect(status.status).not.toBe('valid')

    const configure = runOrigin(
      [
        'setup',
        'provider',
        'telegram',
        'configure',
        '--expected-privacy-mode',
        'enabled',
        '--group-ids',
        'tg_chat_1',
        '--format',
        'json',
      ],
      { home },
    )
    expect(configure.exitCode).not.toBe(0)
  })
}

export function assertWorkspaceAndMemoryNeedExplicitBootstrap() {
  withHome((home) => {
    const workspace = runJson(['workspace', 'status'], { home })
    expect(String(workspace.summary).toLowerCase()).not.toContain('managed note')
    expect(String(workspace['bridge-status'] ?? '').toLowerCase()).not.toContain('in sync')

    const memory = runOrigin(['memory', 'get', '--format', 'json'], { home })
    expect(memory.exitCode).not.toBe(0)
  })

  withHome((home) => {
    const bootstrap = runOrigin(
      ['setup', 'vault', 'memory-bootstrap', '--content', '# Operator facts\n', '--format', 'json'],
      { home },
    )
    expect(bootstrap.exitCode).toBe(0)

    const memory = runJson(['memory', 'get'], { home })
    expect(String(memory.path ?? memory.id ?? '')).toContain('Origin/Memory.md')
    expect(JSON.stringify(memory)).toContain('Operator facts')
  })
}

export function assertNonEmptyVaultRequiresReconcile() {
  withHome((home) => {
    const target = join(home, 'existing-vault')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'Keep.md'), '# Existing note\n')

    const init = runOrigin(['setup', 'vault', 'init', '--path', target, '--format', 'json'], {
      home,
    })
    expect(init.exitCode).toBe(0)
    const json = parseJson(init.stdout)
    expect(String(json.summary).toLowerCase()).toContain('reconcile')
  })
}

export function assertReservedMemoryPathStaysReserved() {
  withHome((home) => {
    const note = runOrigin(
      ['note', 'create', '--path', 'Origin/Memory.md', '--content', '# duplicate', '--format', 'json'],
      { home },
    )
    expect(note.exitCode).not.toBe(0)
    expectNoHarnessArtifact(['note', 'create'], `${note.stdout}\n${note.stderr}`)
    expect(`${note.stdout}\n${note.stderr}`).toContain('Origin/Memory.md')

    const artifact = runOrigin(
      [
        'memory',
        'artifact',
        'create',
        '--kind',
        'note',
        '--path',
        'Origin/Memory.md',
        '--summary',
        'duplicate',
        '--format',
        'json',
      ],
      { home },
    )
    expect(artifact.exitCode).not.toBe(0)
    expectNoHarnessArtifact(['memory', 'artifact', 'create'], `${artifact.stdout}\n${artifact.stderr}`)
    expect(`${artifact.stdout}\n${artifact.stderr}`).toContain('Origin/Memory.md')
  })
}

export function assertPlanningBridgeSelectionIsExplicit() {
  withHome((home) => {
    const calendar = runOrigin(['planning', 'google-calendar', 'reconcile', '--format', 'json'], {
      home,
    })
    expect(calendar.exitCode).not.toBe(0)

    const tasks = runOrigin(['planning', 'google-tasks', 'reconcile', '--format', 'json'], {
      home,
    })
    expect(tasks.exitCode).not.toBe(0)
  })
}

export function assertPlanningTaskCalendarLinksStaySymmetric() {
  withHome((home) => {
    const taskCreate = runOrigin(['planning', 'task', 'create', '--format', 'json'], {
      home,
      config: {
        options: {
          title: 'Linked task',
        },
      },
    })
    expect(taskCreate.exitCode).toBe(0)
    const taskId = createdId(taskCreate, 'tsk_')

    const itemCreate = runOrigin(['planning', 'calendar-item', 'create', '--format', 'json'], {
      home,
      config: {
        options: {
          title: 'Linked event',
          ['start-at']: '2026-04-09T09:00:00+02:00',
          ['end-at']: '2026-04-09T10:00:00+02:00',
          timezone: 'Europe/Paris',
          ['task-id']: [taskId],
        },
      },
    })
    expect(itemCreate.exitCode).toBe(0)
    const calendarItemId = createdId(itemCreate, 'cal_')

    const calendarItem = runJson(['planning', 'calendar-item', 'get', calendarItemId], { home })
    expect(calendarItem['task-ids'] ?? []).toContain(taskId)

    const task = runJson(['planning', 'task', 'get', taskId], { home })
    expect(task['calendar-item-ids'] ?? []).toContain(calendarItemId)
  })
}

function createdId(result: CommandResult, prefix: string) {
  const json = parseJson(result.stdout)
  const id = (json['affected-ids'] ?? []).find((value: string) => value.startsWith(prefix))
  if (!id) throw new Error(`Missing affected id with prefix ${prefix}`)
  return id as string
}

export function assertRecurringTasksCannotAttachToGoogleTasks() {
  withHome((home) => {
    const create = runOrigin(['planning', 'task', 'create', '--format', 'json'], {
      home,
      config: {
        options: {
          title: 'Recurring task',
        },
      },
    })
    expect(create.exitCode).toBe(0)
    const taskId = createdId(create, 'tsk_')

    const recurrence = runOrigin(
      ['planning', 'task', 'recurrence', 'set', taskId, '--format', 'json'],
      {
        home,
        config: {
          options: {
            rule: 'FREQ=WEEKLY;BYDAY=MO',
            ['start-date']: '2026-04-08',
          },
        },
      },
    )
    expect(recurrence.exitCode).toBe(0)

    runOrigin(['planning', 'google-tasks', 'surface', 'select', 'gtl_red', '--format', 'json'], {
      home,
    })

    const attach = runOrigin(
      ['planning', 'google-tasks', 'attach', taskId, '--format', 'json'],
      {
        home,
        config: {
          options: {
            ['task-list-id']: 'gtl_red',
            mode: 'mirror',
          },
        },
      },
    )
    expect(attach.exitCode).not.toBe(0)
    expect(`${attach.stdout}\n${attach.stderr}`.toLowerCase()).toContain('recurr')
  })
}

export function assertFreshAutomationState() {
  withHome((home) => {
    expect(Number(runJson(['automation', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['automation', 'runs', 'list'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['automation', 'queue'], { home }).total ?? 0)).toBe(0)
  })
}

export function assertDisabledAutomationRejectsManualRun() {
  withHome((home) => {
    const create = runOrigin(['automation', 'create', '--format', 'json'], {
      home,
      config: {
        options: {
          name: 'RED automation',
          trigger: { type: 'manual' },
          actions: [{ type: 'command', command: 'context now' }],
        },
      },
    })
    expect(create.exitCode).toBe(0)
    const automationId = createdId(create, 'auto_')

    const disable = runOrigin(['automation', 'disable', automationId, '--format', 'json'], {
      home,
    })
    expect(disable.exitCode).toBe(0)

    const manualRun = runOrigin(['automation', 'run', automationId, '--format', 'json'], {
      home,
    })
    expect(manualRun.exitCode).not.toBe(0)
    expectNoHarnessArtifact(['automation', 'run'], `${manualRun.stdout}\n${manualRun.stderr}`)
    expect(`${manualRun.stdout}\n${manualRun.stderr}`.toLowerCase()).toContain('disabled')
  })
}

export function assertFreshNotificationState() {
  withHome((home) => {
    expect(Number(runJson(['notification', 'devices'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['notification', 'deliveries'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['notification', 'unread'], { home }).total ?? 0)).toBe(0)
  })
}

export function assertFreshSyncState() {
  withHome((home) => {
    expect(Number(runJson(['sync', 'replica', 'peers'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['sync', 'provider', 'jobs'], { home }).total ?? 0)).toBe(0)
    expect(Number(runJson(['sync', 'intent', 'list'], { home }).total ?? 0)).toBe(0)
  })
}

export function assertPlatformTargetsExist() {
  const hasMacClient =
    existsSync(join(repoRoot, 'apps', 'apple')) ||
    existsSync(join(repoRoot, 'apps', 'macos'))
  const hasIPhoneClient =
    existsSync(join(repoRoot, 'apps', 'apple')) ||
    existsSync(join(repoRoot, 'apps', 'iphone'))

  expect(hasMacClient).toBe(true)
  expect(hasIPhoneClient).toBe(true)
}

export function assertOpsArtifactsExist() {
  expect(existsSync(join(repoRoot, 'ops', 'systemd', 'origin.service'))).toBe(true)
  expect(existsSync(join(repoRoot, 'ops', 'deploy', 'update.sh'))).toBe(true)
}
