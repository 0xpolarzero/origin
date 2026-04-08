import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { OriginFeature } from '../../../docs/features.ts'
import { originRootDefinition } from '../src/cli/spec.ts'

const originBin = fileURLToPath(new URL('../bin/origin', import.meta.url))
const serverCwd = fileURLToPath(new URL('..', import.meta.url))

type OriginEnv = {
  HOME: string
  ORIGIN_API_URL?: string
  ORIGIN_INSTANCE?: 'local' | 'vps'
  ORIGIN_PROFILE?: string
}

const rootFeatures = Object.values(OriginFeature).filter((feature) => feature.startsWith('cli.root.'))

const rootFeatureCoverage = [
  'cli.root.help',
  'cli.root.llms',
  'cli.root.llms-full',
  'cli.root.command-schema-discovery',
  'cli.root.skills-add-discovery',
  'cli.root.mcp-add-discovery',
  'cli.root.config-files',
  'cli.root.profile-selection',
  'cli.root.instance-selection',
  'cli.root.api-url-override',
  'cli.root.sync-suggestions',
] as const

function sorted(values: readonly string[]) {
  return [...values].toSorted()
}

async function withHome<T>(callback: (home: string) => T | Promise<T>) {
  const home = await mkdtemp(join(os.tmpdir(), 'origin-root-cli-red-'))

  try {
    return await callback(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

function runOrigin(args: string[], home: string, extraEnv: Partial<OriginEnv> = {}) {
  return execFileSync(originBin, args, {
    cwd: serverCwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      ...extraEnv,
    },
    maxBuffer: 10 * 1024 * 1024,
  })
}

function expectContains(output: string, snippets: string[]) {
  for (const snippet of snippets) {
    expect(output, `Expected CLI output to contain ${snippet}`).toContain(snippet)
  }
}

describe('Origin root CLI discovery', () => {
  test('covers every cli.root feature from docs/features.ts', () => {
    expect(sorted(rootFeatureCoverage)).toEqual(sorted(rootFeatures))
  })

  test('help, manifest, schema, and helper discovery are real CLI behaviors', async () => {
    await withHome(async (home) => {
      const help = runOrigin(['--help'], home)
      expectContains(help, [
        'Usage: origin <command>',
        'Integrations:',
        'Global Options:',
        '--config <path>',
        '--no-config',
        '--llms, --llms-full',
        '--mcp',
        '--schema',
      ])

      const llms = runOrigin(['--llms'], home)
      expectContains(llms, [
        '# origin',
        '| Command | Description |',
        '| `origin status show` |',
        '| `origin workspace status` |',
      ])

      const llmsFull = runOrigin(['--llms-full'], home)
      expectContains(llmsFull, [
        '# origin',
        '### origin status show',
        '### origin workspace status',
        '#### Output',
      ])

      const schema = runOrigin(['status', 'show', '--schema'], home)
      expectContains(schema, ['output:', 'mode:', 'blockers:'])

      const skillsHelp = runOrigin(['skills', 'add', '--help'], home)
      expectContains(skillsHelp, ['Usage: origin skills add [options]', '--depth <number>'])

      const mcpHelp = runOrigin(['mcp', 'add', '--help'], home)
      expectContains(mcpHelp, ['Usage: origin mcp add [options]', '--command, -c <string>'])
    })
  })

  test('root env selection is reflected by runtime and workspace commands', async () => {
    await withHome(async (home) => {
      const env = {
        ORIGIN_API_URL: 'https://origin.example.test',
        ORIGIN_INSTANCE: 'vps' as const,
        ORIGIN_PROFILE: 'red',
      }

      const runtime = runOrigin(['status', 'runtime'], home, env)
      expectContains(runtime, [
        'mode: vps',
        'profile: red',
        'api-url: https://origin.example.test',
      ])

      const services = runOrigin(['status', 'services'], home, env)
      expectContains(services, ['runtime,vps,Profile red is active.'])

      const workspace = runOrigin(['workspace', 'status'], home, env)
      expectContains(workspace, [
        '/.origin/red/workspace',
        'summary: Workspace has',
      ])
    })
  })

  test('sync suggestions stay aligned with the documented root discovery prompt', () => {
    expect(originRootDefinition.sync.suggestions).toEqual([
      'show me what matters right now',
      'show my planning today',
      'triage the email inbox',
      'show recent agent activity',
      'find notes related to a topic',
      'diagnose sync problems',
      'check integration health',
      'show blocked tasks',
    ])
  })
})
