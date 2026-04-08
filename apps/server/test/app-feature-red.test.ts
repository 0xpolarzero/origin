import { describe, expect, test } from 'bun:test'

import { OriginFeature } from '../../../docs/features.ts'

import {
  scenarioAssertions,
  scenarioForAppFeature,
} from './support/red-scenarios.ts'

const appFeatures = Object.values(OriginFeature).filter(
  (feature): feature is OriginFeature => feature.startsWith('app.'),
)

describe('Origin app feature RED suite', () => {
  test('every app feature resolves to a docs-backed behavioral scenario', () => {
    const scenarios = appFeatures.map((feature) => scenarioForAppFeature(feature))

    expect(scenarios).toHaveLength(appFeatures.length)
    expect(new Set(scenarios).size).toBeGreaterThan(1)
  })

  for (const feature of appFeatures) {
    test(feature, () => {
      const scenario = scenarioForAppFeature(feature)
      const assertion = scenarioAssertions[scenario]

      expect(assertion, `Missing behavioral scenario for ${feature}`).toBeDefined()
      assertion()
    })
  }
})
