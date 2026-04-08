import { describe, expect, test } from 'bun:test'

import { OriginFeature } from '../../../docs/features.ts'

import {
  assertCliFeatureBehavior,
  collectLeafRoutes,
  normalizeCliFeature,
} from './support/behavior-scenarios.ts'

const cliFeatures = Object.values(OriginFeature).filter(
  (feature): feature is OriginFeature =>
    feature.startsWith('cli.') && !feature.startsWith('cli.root.'),
)

describe('CLI leaf surface', () => {
  test('docs/features.ts matches the full mounted non-root CLI leaf route surface', () => {
    const documented = cliFeatures.map(normalizeCliFeature).toSorted()
    const mounted = collectLeafRoutes()

    expect(documented).toEqual(mounted)
    expect(documented.length).toBeGreaterThan(0)
  })

  for (const feature of cliFeatures) {
    test(feature, () => {
      assertCliFeatureBehavior(feature)
    })
  }
})
