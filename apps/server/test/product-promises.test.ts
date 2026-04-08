import { describe, expect, test } from 'bun:test'

import { OriginFeature } from '../../../docs/features.ts'

import {
  assertDisabledAutomationRejectsManualRun,
  assertFreshAutomationState,
  assertFreshChatState,
  assertFreshEmailProviderState,
  assertFreshGithubProviderState,
  assertFreshNotificationState,
  assertFreshPlanningState,
  assertFreshSetupRequiresOnboarding,
  assertFreshStatusContextStayUnseeded,
  assertFreshSyncState,
  assertFreshTelegramProviderState,
  assertGithubGrantSelectionStaysExplicit,
  assertNonEmptyVaultRequiresReconcile,
  assertOpsArtifactsExist,
  assertPlanningBridgeSelectionIsExplicit,
  assertPlanningTaskCalendarLinksStaySymmetric,
  assertPlatformTargetsExist,
  assertReservedMemoryPathStaysReserved,
  assertRecurringTasksCannotAttachToGoogleTasks,
  assertRootDiscoveryContract,
  assertRootEnvOverrides,
  assertSqliteStorageContract,
  assertTelegramSecureRefContract,
  assertWorkspaceAndMemoryNeedExplicitBootstrap,
} from './support/behavior-scenarios.ts'

const appFeatures = Object.values(OriginFeature).filter(
  (feature): feature is OriginFeature => feature.startsWith('app.'),
)

type AppGroupId =
  | 'product-interface'
  | 'platform-clients'
  | 'deployment-runtime'
  | 'onboarding-identity'
  | 'workspace-memory'
  | 'planning-core'
  | 'planning-bridges'
  | 'email-provider'
  | 'github-provider'
  | 'telegram-provider'
  | 'automation-notifications'
  | 'sync-provider-execution'
  | 'ops'

const groupAssertions: Record<AppGroupId, Array<() => void>> = {
  'product-interface': [
    assertRootDiscoveryContract,
    assertFreshStatusContextStayUnseeded,
    assertFreshChatState,
  ],
  'platform-clients': [assertPlatformTargetsExist],
  'deployment-runtime': [assertRootEnvOverrides, assertSqliteStorageContract],
  'onboarding-identity': [
    assertFreshSetupRequiresOnboarding,
    assertGithubGrantSelectionStaysExplicit,
    assertTelegramSecureRefContract,
  ],
  'workspace-memory': [
    assertWorkspaceAndMemoryNeedExplicitBootstrap,
    assertNonEmptyVaultRequiresReconcile,
    assertReservedMemoryPathStaysReserved,
  ],
  'planning-core': [
    assertFreshPlanningState,
    assertPlanningTaskCalendarLinksStaySymmetric,
  ],
  'planning-bridges': [
    assertPlanningBridgeSelectionIsExplicit,
    assertRecurringTasksCannotAttachToGoogleTasks,
  ],
  'email-provider': [assertFreshEmailProviderState],
  'github-provider': [assertFreshGithubProviderState, assertGithubGrantSelectionStaysExplicit],
  'telegram-provider': [assertFreshTelegramProviderState, assertTelegramSecureRefContract],
  'automation-notifications': [
    assertFreshAutomationState,
    assertDisabledAutomationRejectsManualRun,
    assertFreshNotificationState,
  ],
  'sync-provider-execution': [
    assertFreshStatusContextStayUnseeded,
    assertFreshSyncState,
  ],
  ops: [assertOpsArtifactsExist],
}

function groupForAppFeature(feature: OriginFeature): AppGroupId {
  const value = String(feature)

  if (
    value.startsWith('app.product.') ||
    value.startsWith('app.interface.') ||
    value === OriginFeature.AppArchitectureCliFirstCapabilityContract ||
    value === OriginFeature.AppArchitectureContextRetrieval ||
    value === OriginFeature.AppArchitectureStructuredSearch ||
    value === OriginFeature.AppArchitectureSemanticSearch
  ) {
    return 'product-interface'
  }

  if (value.startsWith('app.platform.')) return 'platform-clients'

  if (
    value.startsWith('app.deployment.') ||
    value.startsWith('app.server.') ||
    value === OriginFeature.AppArchitectureSqliteOperationalDatabase
  ) {
    return 'deployment-runtime'
  }

  if (
    value.startsWith('app.security.') ||
    value.startsWith('app.onboarding.') ||
    value.startsWith('app.identity.')
  ) {
    return 'onboarding-identity'
  }

  if (
    value.startsWith('app.workspace.') ||
    value.startsWith('app.memory.') ||
    value === OriginFeature.AppArchitectureBlobArtifactStorage
  ) {
    return 'workspace-memory'
  }

  if (value.startsWith('app.planning.google-')) return 'planning-bridges'
  if (value.startsWith('app.planning.')) return 'planning-core'
  if (value.startsWith('app.email.')) return 'email-provider'
  if (value.startsWith('app.github.')) return 'github-provider'
  if (value.startsWith('app.telegram.')) return 'telegram-provider'

  if (
    value.startsWith('app.automation.') ||
    value.startsWith('app.notifications.') ||
    value === OriginFeature.AppArchitectureInAppNotifications ||
    value === OriginFeature.AppArchitecturePushNotifications
  ) {
    return 'automation-notifications'
  }

  if (value.startsWith('app.sync.')) return 'sync-provider-execution'
  if (value.startsWith('app.ops.')) return 'ops'
  if (value.startsWith('app.architecture.')) return 'sync-provider-execution'

  throw new Error(`No product promise group for ${feature}`)
}

describe('Product promises from docs/', () => {
  test('every app feature resolves to exactly one docs-backed behavior group', () => {
    const groups = appFeatures.map(groupForAppFeature)

    expect(groups).toHaveLength(appFeatures.length)
    expect(new Set(groups)).toEqual(new Set(Object.keys(groupAssertions)))
  })

  for (const feature of appFeatures) {
    test(feature, () => {
      const group = groupForAppFeature(feature)
      expect(groupAssertions[group].length).toBeGreaterThan(0)
    })
  }

  for (const [group, assertions] of Object.entries(groupAssertions)) {
    test(`group ${group} asserts documented behavior`, () => {
      for (const assertBehavior of assertions) {
        assertBehavior()
      }
    })
  }
})
