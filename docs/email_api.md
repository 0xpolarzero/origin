# Origin Email API

## Status

- Working draft
- Scope: v1 email domain
- Linked from: [prd.md](./prd.md)

## Purpose

This document defines the full v1 API surface for Origin email.

Email is a first-class agent workflow domain, but the external mail provider remains canonical.
Origin should connect directly to the agent mailbox through the provider API and manage it as a real inbox.

Forwarded user email is not a separate mode. It should appear as normal mail in the agent inbox, optionally with lightweight provenance metadata when Origin can infer it.

## Design Principles

- The agent mailbox is a real working inbox, not only a forwarding sink
- The provider mailbox is canonical
- Origin should not build a full offline mirrored mailbox
- Origin may keep selective caches and lightweight operational metadata only
- The user can continue using their normal mail client when they want direct mailbox access
- The agent should be able to act directly, not simulate or dry-run by default
- The email API should be simple enough to expose cleanly through `incur`
- Important actions should emit activity events
- Notifications for the user should happen through Origin in-app surfaces and push, not via extra email or Telegram notifications

## Non-Goals For V1

- A first-party offline mailbox mirror
- A full replacement for the user’s mail client
- A custom mail provider
- A full contact-management system inside Origin
- Complex mail workflows that are not needed for triage and follow-up

## Common Conventions

### Provider scope

The initial provider target is the Google mailbox that belongs to the agent.

The API should still be phrased in a provider-compatible way where possible, because the mailbox is the system of record.

### Local-first boundary

Email is not fully local-first in the same way as notes, tasks, or calendar items.

Origin should keep enough local state to:

- show recent mail quickly
- resume work after interruptions
- preserve triage state and operational metadata
- support search and follow-up

but it should not attempt to duplicate the full mailbox into offline state.

### Object identity

Every email-domain object should have:

- `id`
- `createdAt`
- `updatedAt`
- `createdByActor`
- `updatedByActor`

When useful, provider identifiers should also be stored:

- `providerAccountId`
- `providerThreadId`
- `providerMessageId`
- `providerDraftId`
- `providerLabelId`

### Actor identity

Actor identifiers should follow the same general pattern as the planning domain:

- `user:<peer-id>`
- `agent:<peer-id>:<agent-name>`
- `sync:<provider>`
- `external:<peer-id>:filesystem`

## Object Model

## `EmailAccount`

Represents a connected mailbox account that Origin can operate on.

### Fields

- `id`
- `provider`
- `emailAddress`
- `displayName`
- `status`
- `scope`
- `syncCursor`
- `defaultFromAddress`
- `createdAt`
- `updatedAt`

### Notes

- The account is connected directly to the provider API
- The account is the working inbox for the agent
- Multiple accounts are not a v1 goal, but the model should not hardcode a single mailbox in case the product later needs more than one

## `EmailThread`

Represents a mail thread as Origin sees it.

### Fields

- `id`
- `providerAccountId`
- `providerThreadId`
- `subject`
- `participantAddresses[]`
- `latestMessageAt`
- `messageCount`
- `unreadCount`
- `labels[]`
- `triageState`
- `followUpAt`
- `importance`
- `pinnedAt`
- `archivedAt`
- `lastSyncedAt`
- `provenance`
- `createdAt`
- `updatedAt`

### Notes

- A thread is the primary object for triage
- A thread may have local triage metadata even when the provider source remains canonical
- The thread cache can be partial and should be evictable

## `EmailMessage`

Represents a message in a thread.

### Fields

- `id`
- `providerAccountId`
- `providerThreadId`
- `providerMessageId`
- `threadId`
- `from`
- `to[]`
- `cc[]`
- `bcc[]`
- `subject`
- `sentAt`
- `snippet`
- `bodyRef`
- `isUnread`
- `isStarred`
- `labels[]`
- `attachments[]`
- `provenance`
- `createdAt`
- `updatedAt`

### Notes

- `bodyRef` may point to cached full body content or a fetched-on-demand blob
- Not every message body must be cached locally
- Attachments are handled as blobs or cached references when needed

## `EmailDraft`

Represents a draft or outgoing composition under Origin control.

### Fields

- `id`
- `providerAccountId`
- `providerThreadId`
- `inReplyToMessageId`
- `to[]`
- `cc[]`
- `bcc[]`
- `subject`
- `body`
- `attachments[]`
- `status`
- `providerDraftId`
- `createdAt`
- `updatedAt`

### Notes

- Drafts are optional and transient unless the provider requires persistence
- The direct-action posture means most user-visible operations should be send/reply oriented rather than draft-heavy

## `EmailTriageRecord`

Represents lightweight operational metadata that Origin keeps for a thread.

### Fields

- `id`
- `threadId`
- `triageState`
- `priority`
- `followUpAt`
- `linkedTaskId`
- `notesMd`
- `lastAgentActionAt`
- `lastHumanActionAt`
- `createdAt`
- `updatedAt`

### Triage states

- `new`
- `needs_reply`
- `waiting_on_them`
- `waiting_on_us`
- `done`
- `archived`

### Notes

- This is intentionally lightweight
- It does not replace the provider mailbox
- It gives the agent a stable place to track follow-up and triage without duplicating the entire inbox

## `EmailAttachment`

Represents a message attachment.

### Fields

- `id`
- `providerAttachmentId`
- `filename`
- `mimeType`
- `sizeBytes`
- `blobRef`
- `createdAt`

### Notes

- Attachments may be cached on demand
- Large or infrequently used attachments should remain fetchable rather than aggressively mirrored

## `EmailProvenance`

Represents lightweight source metadata for a message.

### Fields

- `isForwarded`
- `forwardedByUser`
- `forwardedFromAddress`
- `forwardedAt`
- `originalProviderMessageId`
- `originalThreadHint`

### Notes

- Provenance is optional
- Forwarded user email is still just a normal message in the agent inbox
- Provenance exists so the agent can remember where a message came from when that helps triage or explanation

## `EmailSyncCursor`

Represents the provider sync position for an account.

### Fields

- `id`
- `providerAccountId`
- `cursor`
- `lastSyncAt`
- `lastSuccessfulSyncAt`
- `syncState`
- `error`
- `createdAt`
- `updatedAt`

## Read / Query Surface

The email API should support at least the following read operations.

### Account reads

- list connected email accounts
- fetch a single account
- inspect sync state and last sync time

### Thread reads

- list threads
- search threads
- fetch a thread with its messages
- fetch recent threads
- fetch unread threads
- fetch triage-needed threads
- fetch threads by sender, label, date range, or full-text query

### Message reads

- fetch a single message
- fetch message body
- fetch attachments
- fetch recent messages for a thread

### Operational reads

- fetch triage records
- fetch pending outbound actions
- fetch sync status
- fetch activity events related to email

## Mutation / Action Surface

The email API should support at least the following mutations.

### Mail actions

- send a new message
- reply to a thread
- reply-all to a thread
- forward a message
- save or update a draft when needed

### Triage actions

- mark read
- mark unread
- archive
- unarchive
- star
- unstar
- apply or remove labels
- set triage state
- set follow-up time
- link to a planning task
- add or update internal triage notes

### Sync actions

- resync an account
- refresh a thread
- invalidate and rebuild local cache for a thread or account when needed

### Notes

- Mutations should be idempotent where practical
- Send/reply actions should use stable idempotency keys so retries do not duplicate mail
- The agent should not need a simulation-only path for normal usage

## Cache And Sync Strategy

- Provider data remains canonical
- Origin keeps a selective local thread/message cache for fast access and resilience
- The cache should prefer recent headers, snippets, triage state, and only the bodies that matter
- Full bodies should be fetched on demand when not already cached
- Attachments should be cached selectively
- Sync should be cursor-based and provider-driven
- If the cursor becomes invalid, Origin should be able to fall back to a broader resync of the account
- The local email state should be treated as an evictable projection, not a durable mailbox replica

## Activity Events

Origin should emit activity events for important email actions and mailbox state changes.

Examples:

- `email.sync.started`
- `email.sync.completed`
- `email.sync.failed`
- `email.thread.fetched`
- `email.message.received`
- `email.message.forwarded`
- `email.reply.sent`
- `email.label.updated`
- `email.thread.archived`
- `email.triage.state.changed`
- `email.followup.scheduled`

Each event should include:

- actor
- account id
- thread id when relevant
- message id when relevant
- provider correlation identifiers when available
- outcome status
- error details when relevant

## Failure And Retry Semantics

- Network failures should be retryable
- Provider rate limits should back off and retry later
- If a send/reply outcome is unknown, Origin should resolve by checking provider state before retrying blindly
- Sync failures should not destroy local triage metadata
- If provider auth is revoked, the account should enter a degraded state and surface a clear recovery path

## Provider Constraints

The API shape should respect the provider rather than pretending email is fully local-first.

Important constraints:

- Thread/message identifiers come from the provider
- Search and label semantics should map to the provider model where possible
- Not every mailbox action is portable across providers
- Gmail is the initial practical target, even if the abstract model stays provider-compatible
- Forwarded mail should be treated as ordinary inbox content, not as a special mailbox type

## CLI Shape

The email API should be straightforward to expose through the CLI.

Recommended conceptual verbs:

- `email.accounts.*`
- `email.threads.*`
- `email.messages.*`
- `email.drafts.*`
- `email.triage.*`
- `email.sync.*`

The exact command names can be adjusted later, but the underlying model should stay stable.

## Relationship To Origin Planning

Email is a provider-canonical domain, but it should still be able to drive Origin planning.

Examples:

- email thread needs reply -> create or link to a task
- email needs follow-up on a date -> set `followUpAt`
- email response is blocked by another task -> link the thread to a task

The email API should not define the planning model itself, but it should expose the hooks needed for that cross-domain workflow.

## Open Questions

None currently.

If the provider implementation introduces a constraint that materially changes the API shape, that should be captured during implementation review rather than guessed here.
