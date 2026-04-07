import type { HandlerMap } from '../cli/types.ts'

import { automationActivityEntityNotificationSyncHandlers } from './automation-activity-entity-notification-sync.ts'
import { chatMemoryWorkspaceNoteFileHandlers } from './chat-memory-workspace-note-file.ts'
import { planningEmailGithubTelegramHandlers } from './planning-email-github-telegram.ts'
import { statusContextSearchIdentityIntegrationSetupHandlers } from './status-context-search-identity-integration-setup.ts'

export const handlers = {
  ...statusContextSearchIdentityIntegrationSetupHandlers,
  ...chatMemoryWorkspaceNoteFileHandlers,
  ...planningEmailGithubTelegramHandlers,
  ...automationActivityEntityNotificationSyncHandlers,
} satisfies Partial<HandlerMap>
