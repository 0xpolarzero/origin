import { describe, test } from 'bun:test'

import {
  assertCliDiscoveryContract,
  assertFreshAutomationAndNotificationState,
  assertFreshOnboardingState,
  assertFreshPlanningAndChatState,
  assertFreshProviderState,
  assertFreshStatusAndContextState,
  assertFreshSyncState,
  assertFreshWorkspaceAndMemoryState,
  assertRootEnvSelection,
} from './support/red-scenarios.ts'

describe('Origin docs-backed runtime scenarios', () => {
  test('root discovery is a real CLI behavior', () => {
    assertCliDiscoveryContract()
  })

  test('fresh runtime still requires onboarding instead of reporting ready state', () => {
    assertFreshOnboardingState()
  })

  test('fresh status and context should not be synthesized from demo seed data', () => {
    assertFreshStatusAndContextState()
  })

  test('fresh planning and chat domains should start empty', () => {
    assertFreshPlanningAndChatState()
  })

  test('provider domains should start unconfigured and unselected', () => {
    assertFreshProviderState()
  })

  test('workspace attach and memory bootstrap should require explicit setup and reconcile', () => {
    assertFreshWorkspaceAndMemoryState()
  })

  test('automation, notifications, and sync surfaces should start empty', () => {
    assertFreshAutomationAndNotificationState()
    assertFreshSyncState()
  })

  test('root env overrides should influence runtime state and paths', () => {
    assertRootEnvSelection()
  })
})
