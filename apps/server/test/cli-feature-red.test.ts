import { describe, expect, test } from 'bun:test'
import { Cli } from 'incur'

import { OriginFeature } from '../../../docs/features.ts'
import specOrigin from '../src/cli/spec.ts'

import {
  collectLeafRoutes,
  normalizeCliFeature,
  scenarioAssertions,
  scenarioForCliFeature,
} from './support/red-scenarios.ts'

type ContractEntry = Record<string, any> & {
  _group?: boolean
  commands?: Map<string, ContractEntry>
}

const cliFeatures = Object.values(OriginFeature).filter(
  (feature): feature is OriginFeature =>
    feature.startsWith('cli.') && !feature.startsWith('cli.root.'),
)

function getCommandMap(cli: unknown) {
  const commands = Cli.toCommands.get(cli as any)
  if (!commands) throw new Error('Unable to load Origin CLI command map.')
  return commands as Map<string, ContractEntry>
}

describe('Origin CLI feature red suite', () => {
  test('non-root cli features still cover the full mounted leaf route surface', () => {
    const normalizedRoutes = cliFeatures.map(normalizeCliFeature).toSorted()
    const mountedRoutes = collectLeafRoutes()

    expect(normalizedRoutes).toEqual(mountedRoutes)
    expect([...getCommandMap(specOrigin).keys()].length).toBeGreaterThan(0)
  })

  for (const feature of cliFeatures) {
    test(feature, () => {
      const scenario = scenarioForCliFeature(feature)
      const assertion = scenarioAssertions[scenario]

      expect(assertion, `Missing behavioral scenario for ${feature}`).toBeDefined()
      assertion()
    })
  }
})
