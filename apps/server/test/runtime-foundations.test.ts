import { describe, test } from 'bun:test'

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
  assertPlanningBridgeSelectionIsExplicit,
  assertPlanningTaskCalendarLinksStaySymmetric,
  assertReservedMemoryPathStaysReserved,
  assertRecurringTasksCannotAttachToGoogleTasks,
  assertRootEnvOverrides,
  assertSqliteStorageContract,
  assertTelegramSecureRefContract,
  assertWorkspaceAndMemoryNeedExplicitBootstrap,
} from './support/behavior-scenarios.ts'

describe('Runtime foundations', () => {
  test('fresh setup remains incomplete and requires onboarding', () => {
    assertFreshSetupRequiresOnboarding()
  })

  test('status, context, and activity stay unseeded on a fresh profile', () => {
    assertFreshStatusContextStayUnseeded()
  })

  test('planning and chat objects start empty instead of demo-populated', () => {
    assertFreshPlanningState()
    assertFreshChatState()
  })

  test('provider domains start unconfigured and unselected', () => {
    assertFreshEmailProviderState()
    assertFreshGithubProviderState()
    assertFreshTelegramProviderState()
  })

  test('github remains unusable until an installation grant is explicitly selected', () => {
    assertGithubGrantSelectionStaysExplicit()
  })

  test('telegram setup requires a secure handoff instead of pretending validation already happened', () => {
    assertTelegramSecureRefContract()
  })

  test('workspace and memory stay unattached until explicit bootstrap', () => {
    assertWorkspaceAndMemoryNeedExplicitBootstrap()
  })

  test('Origin/Memory.md remains reserved after bootstrap flows exist', () => {
    assertReservedMemoryPathStaysReserved()
  })

  test('attaching a populated vault requires explicit reconcile flow', () => {
    assertNonEmptyVaultRequiresReconcile()
  })

  test('planning task and calendar-item links stay symmetric', () => {
    assertPlanningTaskCalendarLinksStaySymmetric()
  })

  test('planning bridges require selected surfaces and reject recurring task mirrors to Google Tasks', () => {
    assertPlanningBridgeSelectionIsExplicit()
    assertRecurringTasksCannotAttachToGoogleTasks()
  })

  test('automation, notifications, and sync surfaces start empty', () => {
    assertFreshAutomationState()
    assertFreshNotificationState()
    assertFreshSyncState()
  })

  test('disabled automations reject manual runs', () => {
    assertDisabledAutomationRejectsManualRun()
  })

  test('runtime selection honors env overrides and reports sqlite storage', () => {
    assertRootEnvOverrides()
    assertSqliteStorageContract()
  })
})
