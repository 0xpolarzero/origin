import { describe, expect, test } from 'bun:test'

import { OriginFeature } from '../../../docs/features.ts'
import { originRootDefinition } from '../src/cli/spec.ts'

import {
  assertRootDiscoveryContract,
  assertRootEnvOverrides,
  assertSqliteStorageContract,
} from './support/behavior-scenarios.ts'

const rootFeatures = Object.values(OriginFeature).filter(
  (feature): feature is OriginFeature => feature.startsWith('cli.root.'),
)

const rootCoverage = {
  discovery: [
    OriginFeature.CliRootHelp,
    OriginFeature.CliRootLlms,
    OriginFeature.CliRootLlmsFull,
    OriginFeature.CliRootCommandSchemaDiscovery,
    OriginFeature.CliRootSkillsAddDiscovery,
    OriginFeature.CliRootMcpAddDiscovery,
  ],
  configuration: [
    OriginFeature.CliRootConfigFiles,
    OriginFeature.CliRootProfileSelection,
    OriginFeature.CliRootInstanceSelection,
    OriginFeature.CliRootApiUrlOverride,
  ],
  syncSuggestions: [OriginFeature.CliRootSyncSuggestions],
} as const satisfies Record<string, readonly OriginFeature[]>

const documentedRootSuggestions = [
  'show me what matters right now',
  'show my planning today',
  'triage the email inbox',
  'show recent agent activity',
  'find notes related to a topic',
  'diagnose sync problems',
  'check integration health',
  'show blocked tasks',
] as const

describe('Root discovery contract', () => {
  test('covers every cli.root feature in docs/features.ts exactly once', () => {
    const covered = Object.values(rootCoverage)
      .flat()
      .toSorted()

    expect(covered).toEqual([...rootFeatures].toSorted())
    expect(new Set(covered).size).toBe(rootFeatures.length)
  })

  test('root discovery uses the real incur help, llms, schema, skills, and mcp surfaces', () => {
    assertRootDiscoveryContract()
  })

  test('root configuration and env overrides change runtime selection and paths', () => {
    assertRootEnvOverrides()
  })

  test('root status storage reports sqlite-backed runtime paths', () => {
    assertSqliteStorageContract()
  })

  test('root sync suggestions stay aligned with the documented operator prompts', () => {
    expect(originRootDefinition.sync.suggestions).toEqual(documentedRootSuggestions)
  })
})
