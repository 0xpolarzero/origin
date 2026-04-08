import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

type JsonRecord = Record<string, any>

export type RedScenarioId =
  | 'cli-discovery-contract'
  | 'root-env-selection'
  | 'fresh-onboarding'
  | 'fresh-status-context'
  | 'fresh-planning-chat'
  | 'fresh-provider-state'
  | 'fresh-workspace-memory'
  | 'fresh-automation-notifications'
  | 'fresh-sync-state'
  | 'apple-clients'
  | 'ops-artifacts'

const originBin = fileURLToPath(new URL('../../bin/origin', import.meta.url))
const serverRoot = fileURLToPath(new URL('../..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const cache = new Map<string, unknown>()

function runOrigin(
  args: string[],
  home: string,
  extraEnv: Record<string, string | undefined> = {},
) {
  try {
    return {
      exitCode: 0,
      stdout: execFileSync(originBin, args, {
        cwd: serverRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          ORIGIN_PROFILE: 'red',
          ...extraEnv,
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

function withFreshHome<T>(
  callback: (home: string) => T,
  prepare?: (home: string) => void,
) {
  const home = mkdtempSync(join(os.tmpdir(), 'origin-red-'))

  try {
    prepare?.(home)
    return callback(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function cached<T>(key: string, load: () => T): T {
  const existing = cache.get(key)
  if (existing !== undefined) return existing as T
  const value = load()
  cache.set(key, value)
  return value
}

function runFreshText(
  key: string,
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
  prepare?: (home: string) => void,
) {
  return cached(key, () =>
    withFreshHome(
      (home) => runOrigin(args, home, extraEnv),
      prepare,
    ),
  ) as { exitCode: number; stdout: string; stderr: string }
}

function runFreshJson<T extends JsonRecord>(
  key: string,
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
  prepare?: (home: string) => void,
) {
  return cached(key, () => {
    const result = withFreshHome(
      (home) => runOrigin([...args, '--format', 'json'], home, extraEnv),
      prepare,
    )

    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed (${args.join(' ')}): ${result.stdout}${result.stderr}`,
      )
    }

    return JSON.parse(result.stdout) as T
  }) as T
}

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
  if (!feature.startsWith('cli.')) {
    throw new Error(`Not a CLI feature: ${feature}`)
  }

  return feature.slice('cli.'.length).replace(/\./g, ' ')
}

function freshSetupStatus() {
  return runFreshJson<{
    mode: string
    phases: Array<{ key: string; status: string }>
    status: string
    summary: string
  }>('fresh-setup-status', ['setup', 'status'])
}

function freshStatusShow() {
  return runFreshJson<{
    mode: string
    summary: string
    setup: string
    integrations: Array<{ key: string; status: string }>
  }>('fresh-status-show', ['status', 'show'])
}

function freshIdentityStatus() {
  return runFreshJson<{ status: string; summary: string }>(
    'fresh-identity-status',
    ['identity', 'status'],
  )
}

function freshContextNow() {
  return runFreshJson<{
    summary: string
    entities: Array<{ id: string; kind: string; title: string }>
    highlights?: string[]
  }>('fresh-context-now', ['context', 'now'])
}

function freshPlanningProjects() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-planning-projects',
    ['planning', 'project', 'list'],
  )
}

function freshPlanningTasks() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-planning-tasks',
    ['planning', 'task', 'list'],
  )
}

function freshChatList() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-chat-list',
    ['chat', 'list'],
  )
}

function freshIntegrationList() {
  return runFreshJson<{
    items: Array<{ key: string; status: string }>
    total?: number
  }>('fresh-integration-list', ['integration', 'list'])
}

function freshEmailAccounts() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-email-account-list',
    ['email', 'account', 'list'],
  )
}

function freshGithubGrants() {
  return runFreshJson<{
    items: Array<{ id: string; selected?: boolean; status?: string }>
    total?: number
  }>('fresh-github-grant-list', ['github', 'account', 'grant', 'list'])
}

function freshTelegramChats() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-telegram-chat-list',
    ['telegram', 'chat', 'list'],
  )
}

function freshWorkspaceStatus() {
  return runFreshJson<{
    root?: string
    summary: string
    ['index-status']?: string
    ['bridge-status']?: string
  }>('fresh-workspace-status', ['workspace', 'status'])
}

function freshMemoryProbe() {
  return cached('fresh-memory-probe', () =>
    withFreshHome((home) => {
      const result = runOrigin(['setup', 'status', '--format', 'json'], home)
      if (result.exitCode !== 0) {
        throw new Error(`Failed to probe memory bootstrap: ${result.stdout}${result.stderr}`)
      }

      const path = join(home, '.origin', 'red', 'workspace', 'Origin', 'Memory.md')
      return {
        exists: existsSync(path),
        path,
      }
    }),
  ) as { exists: boolean; path: string }
}

function nonEmptyVaultInit() {
  return cached('non-empty-vault-init', () =>
    withFreshHome((home) => {
      const target = join(home, 'existing-vault')
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'Keep.md'), '# Existing note\n', 'utf8')

      const result = runOrigin(
        ['setup', 'vault', 'init', '--path', target, '--format', 'json'],
        home,
      )

      if (result.exitCode !== 0) {
        throw new Error(`Non-empty vault init failed: ${result.stdout}${result.stderr}`)
      }

      return JSON.parse(result.stdout) as { summary: string; ['reconcile-id']?: string }
    }),
  ) as { summary: string; ['reconcile-id']?: string }
}

function freshAutomationList() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-automation-list',
    ['automation', 'list'],
  )
}

function freshNotificationDevices() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-notification-devices',
    ['notification', 'devices'],
  )
}

function freshNotificationDeliveries() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-notification-deliveries',
    ['notification', 'deliveries'],
  )
}

function freshSyncPeers() {
  return runFreshJson<{ items: Array<{ id: string }>; total?: number }>(
    'fresh-sync-peers',
    ['sync', 'replica', 'peers'],
  )
}

function freshSyncIntents() {
  return runFreshJson<{
    items: Array<{ id: string; ['outbox-refs']?: string[] }>
    total?: number
  }>('fresh-sync-intents', ['sync', 'intent', 'list'])
}

function rootHelp() {
  return runFreshText('root-help', ['--help']).stdout
}

function rootLlms() {
  return runFreshText('root-llms', ['--llms']).stdout
}

function rootPathsWithProfile() {
  return runFreshJson<{
    state: string
    workspace: string
    vault: string
  }>('root-profile-paths', ['status', 'paths'], {
    ORIGIN_PROFILE: 'alpha',
  })
}

function rootStatusWithVps() {
  return runFreshJson<{ mode: string }>('root-instance-status', ['status', 'show'], {
    ORIGIN_INSTANCE: 'vps',
  })
}

function rootRuntimeWithApiUrl() {
  return runFreshJson<{ ['api-url']?: string }>(
    'root-api-url-runtime',
    ['status', 'runtime'],
    {
      ORIGIN_API_URL: 'https://origin.example.test',
    },
  )
}

export function assertCliDiscoveryContract() {
  const help = rootHelp()
  expect(help).toContain('Usage: origin <command>')
  expect(help).toContain('--llms, --llms-full')

  const llms = rootLlms()
  expect(llms).toContain('# origin')
  expect(llms).toContain('| `origin status show` |')
}

export function assertRootEnvSelection() {
  const paths = rootPathsWithProfile()
  expect(paths.state).toContain('/.origin/alpha/')
  expect(paths.workspace).toContain('/.origin/alpha/workspace')
  expect(paths.vault).toContain('/.origin/alpha/workspace')

  const status = rootStatusWithVps()
  expect(status.mode).toBe('vps')

  const runtime = rootRuntimeWithApiUrl()
  expect(runtime['api-url']).toBe('https://origin.example.test')
}

export function assertFreshOnboardingState() {
  const setup = freshSetupStatus()
  expect(setup.status).toBe('pending')
  expect(setup.phases).toHaveLength(9)

  const identity = freshIdentityStatus()
  expect(identity.status).not.toBe('complete')

  const status = freshStatusShow()
  expect(status.setup).not.toBe('Ready')
}

export function assertFreshStatusAndContextState() {
  const status = freshStatusShow()
  expect(status.setup).not.toBe('Ready')
  expect(status.integrations.filter((integration) => integration.status === 'connected')).toHaveLength(0)

  const context = freshContextNow()
  expect(context.summary.toLowerCase()).not.toContain('demo')
  expect(context.entities).toHaveLength(0)
}

export function assertFreshPlanningAndChatState() {
  const projects = freshPlanningProjects()
  expect(projects.total ?? projects.items.length).toBe(0)

  const tasks = freshPlanningTasks()
  expect(tasks.total ?? tasks.items.length).toBe(0)

  const chats = freshChatList()
  expect(chats.total ?? chats.items.length).toBe(0)
}

export function assertFreshProviderState() {
  const integrations = freshIntegrationList()
  expect(integrations.items.filter((integration) => integration.status === 'connected')).toHaveLength(0)

  const emailAccounts = freshEmailAccounts()
  expect(emailAccounts.total ?? emailAccounts.items.length).toBe(0)

  const githubGrants = freshGithubGrants()
  expect(githubGrants.total ?? githubGrants.items.length).toBe(0)

  const telegramChats = freshTelegramChats()
  expect(telegramChats.total ?? telegramChats.items.length).toBe(0)
}

export function assertFreshWorkspaceAndMemoryState() {
  const workspace = freshWorkspaceStatus()
  expect(workspace.summary.toLowerCase()).not.toContain('2 managed note')
  expect(workspace['index-status']).not.toBe('Fresh')
  expect(workspace['bridge-status']).not.toBe('In sync')

  const memory = freshMemoryProbe()
  expect(memory.exists).toBe(false)

  const init = nonEmptyVaultInit()
  expect(init['reconcile-id']).toEqual(expect.any(String))
  expect(init.summary.toLowerCase()).not.toContain('initialized workspace')
}

export function assertFreshAutomationAndNotificationState() {
  const automations = freshAutomationList()
  expect(automations.total ?? automations.items.length).toBe(0)

  const devices = freshNotificationDevices()
  expect(devices.total ?? devices.items.length).toBe(0)

  const deliveries = freshNotificationDeliveries()
  expect(deliveries.total ?? deliveries.items.length).toBe(0)
}

export function assertFreshSyncState() {
  const peers = freshSyncPeers()
  expect(peers.total ?? peers.items.length).toBe(0)

  const intents = freshSyncIntents()
  expect(intents.total ?? intents.items.length).toBe(0)

  for (const intent of intents.items) {
    expect(intent.id).not.toBe(intent['outbox-refs']?.[0])
  }
}

export function assertAppleClientScaffolding() {
  const hasMacClient =
    existsSync(join(repoRoot, 'apps', 'apple')) ||
    existsSync(join(repoRoot, 'apps', 'macos'))
  const hasIPhoneClient =
    existsSync(join(repoRoot, 'apps', 'apple')) ||
    existsSync(join(repoRoot, 'apps', 'iphone'))

  expect(hasMacClient).toBe(true)
  expect(hasIPhoneClient).toBe(true)
}

export function assertOpsArtifactsPresent() {
  expect(existsSync(join(repoRoot, 'ops', 'systemd', 'origin.service'))).toBe(true)
  expect(existsSync(join(repoRoot, 'ops', 'deploy', 'update.sh'))).toBe(true)
}

export const scenarioAssertions: Record<RedScenarioId, () => void> = {
  'cli-discovery-contract': assertCliDiscoveryContract,
  'root-env-selection': assertRootEnvSelection,
  'fresh-onboarding': assertFreshOnboardingState,
  'fresh-status-context': assertFreshStatusAndContextState,
  'fresh-planning-chat': assertFreshPlanningAndChatState,
  'fresh-provider-state': assertFreshProviderState,
  'fresh-workspace-memory': assertFreshWorkspaceAndMemoryState,
  'fresh-automation-notifications': assertFreshAutomationAndNotificationState,
  'fresh-sync-state': assertFreshSyncState,
  'apple-clients': assertAppleClientScaffolding,
  'ops-artifacts': assertOpsArtifactsPresent,
}

export function scenarioForAppFeature(feature: OriginFeature): RedScenarioId {
  const value = String(feature)

  if (value.startsWith('app.product.') || value.startsWith('app.interface.')) {
    return 'fresh-status-context'
  }

  if (value.startsWith('app.platform.')) return 'apple-clients'
  if (value.startsWith('app.deployment.') || value.startsWith('app.server.')) {
    return 'root-env-selection'
  }

  if (
    value.startsWith('app.security.') ||
    value.startsWith('app.onboarding.') ||
    value.startsWith('app.identity.')
  ) {
    return 'fresh-onboarding'
  }

  if (value === OriginFeature.AppArchitectureCliFirstCapabilityContract) {
    return 'cli-discovery-contract'
  }

  if (
    value.startsWith('app.workspace.') ||
    value.startsWith('app.memory.')
  ) {
    return 'fresh-workspace-memory'
  }

  if (
    value.startsWith('app.planning.')
  ) {
    return 'fresh-planning-chat'
  }

  if (
    value.startsWith('app.email.') ||
    value.startsWith('app.github.') ||
    value.startsWith('app.telegram.')
  ) {
    return 'fresh-provider-state'
  }

  if (
    value.startsWith('app.automation.') ||
    value.startsWith('app.notifications.')
  ) {
    return 'fresh-automation-notifications'
  }

  if (value.startsWith('app.sync.')) return 'fresh-sync-state'
  if (value.startsWith('app.ops.')) return 'ops-artifacts'

  if (value.startsWith('app.architecture.')) {
    if (
      value.includes('context-retrieval') ||
      value.includes('structured-search') ||
      value.includes('semantic-search')
    ) {
      return 'fresh-status-context'
    }

    if (
      value.includes('provider-') ||
      value.includes('external-action-intents') ||
      value.includes('activity-event-stream') ||
      value.includes('job-runner') ||
      value.includes('cron-scheduling') ||
      value.includes('in-app-notifications') ||
      value.includes('push-notifications')
    ) {
      return value.includes('notifications')
        ? 'fresh-automation-notifications'
        : 'fresh-sync-state'
    }

    return 'fresh-sync-state'
  }

  throw new Error(`No app-feature scenario mapping for ${feature}`)
}

export function scenarioForCliFeature(feature: OriginFeature): RedScenarioId {
  const route = normalizeCliFeature(String(feature))
  const domain = route.split(' ')[0]

  switch (domain) {
    case 'status':
    case 'context':
    case 'search':
    case 'entity':
      return 'fresh-status-context'
    case 'setup':
    case 'identity':
    case 'integration':
      return 'fresh-onboarding'
    case 'chat':
    case 'planning':
      return 'fresh-planning-chat'
    case 'email':
    case 'github':
    case 'telegram':
      return 'fresh-provider-state'
    case 'memory':
    case 'note':
    case 'workspace':
    case 'file':
      return 'fresh-workspace-memory'
    case 'automation':
    case 'activity':
    case 'notification':
      return 'fresh-automation-notifications'
    case 'sync':
      return 'fresh-sync-state'
    default:
      throw new Error(`No CLI-feature scenario mapping for ${feature}`)
  }
}
