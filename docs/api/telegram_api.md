# Origin Telegram API

## Status

- Working draft
- Scope: v1 Telegram bot integration
- Linked from: [prd.md](./prd.md)

## Purpose

This document defines the v1 API surface for Origin's Telegram integration.

The integration is bot-based, not a Telegram user account. Telegram remains the canonical system of record. Origin keeps only selective local caches and operational metadata needed for summaries, participation, and agent workflows.

## Design Principles

- The integration uses a Telegram bot created for the agent.
- The bot must be able to participate in groups.
- Origin should target the maximum Telegram bot access model Telegram supports, while respecting bot-only platform limits.
- Telegram is canonical; Origin is not a full offline mirror.
- The system should keep only selective caches, recent message windows, and workflow metadata as needed.
- The bot integration should be direct-action by default, not simulation-first.
- Telegram is not a notification transport for Origin in v1; user notifications remain in-app and push.
- The CLI should be the primary operational surface.

## Non-Goals For V1

- Telegram user-account automation
- A full offline synchronized Telegram mailbox
- A general-purpose Telegram client replacement
- Arbitrary bot-to-bot interaction beyond what Telegram itself allows

## Platform Constraints That Shape The API

- A bot is not a normal Telegram user account.
- The bot must be configured via a bot token obtained from BotFather.
- Group participation depends on the bot being invited to the group.
- Privacy mode is operator-managed outside Origin; Origin only validates and records the observed state, it does not mutate BotFather configuration itself.
- With privacy mode disabled, the bot can receive all group messages except messages sent by other bots, subject to Telegram platform rules.
- In v1, the steady-state tracked-group contract assumes privacy mode `disabled`. If observed privacy mode is `enabled`, Origin may keep groups registered for recovery, but it must not treat them as fully enabled for summaries, ambient observation, or participation that depends on ordinary group traffic.
- The bot cannot behave as a human user account and cannot inherit user-account capabilities.
- Telegram API rate limits and platform permissions must be respected.

## Local State Model

Origin may keep the following Telegram-related local state:

- `TelegramBotConnection`
- `TelegramChatRef`
- `TelegramGroupSubscription`
- `TelegramRecentMessageCache`
- `TelegramOutgoingAction`
- `TelegramSummaryJobRecord`
- `TelegramActivityEvent`

This state is metadata and cache, not a full mirrored copy of Telegram.
New chats discovered by polling may create lightweight `TelegramChatRef` discovery state only; they do not become actively tracked, summarized, or fully cached until the user explicitly registers the group.
`TelegramBotConnection` and `TelegramRecentMessageCache` are operational read models.
`TelegramGroupSubscription` is the replicated overlay for tracked group policy and membership state.
`TelegramOutgoingAction` is the server outbox for Telegram mutations.

### Minimum offline/client contract (v1)

Telegram remains provider-canonical, but Origin guarantees the following minimum client-visible/offline surface for configured bot domains:

- Replicated overlay durability: all `TelegramGroupSubscription` objects and related `ExternalActionIntent` records are fully available offline on every synced client.
- Connection/status floor: the last successful `TelegramBotConnection` validation snapshot and tracked `TelegramChatRef` metadata remain client-visible offline.
- Tracked-message floor: for each enabled group subscription, at least the most recent 200 cached messages or 72 hours of message history (whichever is smaller) remains offline-visible after a successful sync.
- Mention/summarization floor: mention flags, summary policy, and the latest 30 `TelegramSummaryJobRecord` entries per tracked group remain offline-visible.
- Outbound intent floor: offline send/reply/policy-change requests are durably captured as replicated intent/overlay updates and replay from the authoritative server when connectivity and authority are valid.

Outside these minimums, recent-message cache windows are evictable and may require best-effort provider rehydration.

## Shared Types

### `TelegramConnectionStatus`

- `unconfigured`
- `valid`
- `invalid`
- `revoked`

### `TelegramPrivacyMode`

- `enabled`
- `disabled`

### `TelegramParticipationMode`

- `observe`
- `participate`

### `TelegramGroupSubscriptionState`

- `enabled`
- `disabled`

### `TelegramChatKind`

- `direct_message`
- `group`
- `supergroup`
- `channel`

### `TelegramSenderKind`

- `user`
- `bot`
- `channel`
- `unknown`

### `TelegramOutgoingActionKind`

- `send_message`
- `reply_message`
- `edit_message`
- `delete_message`
- `post_summary`

### `TelegramOutgoingActionStatus`

- `queued`
- `sending`
- `sent`
- `failed`
- `canceled`

### `TelegramSummaryTriggerKind`

- `manual`
- `scheduled`
- `mention`
- `agent_decision`

### `TelegramSummaryJobStatus`

- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

## Core Objects

### `TelegramBotConnection`

Represents the configured bot identity and its link to Telegram.

Fields:

- `id`
- `botUsername`
- `botDisplayName`
- `botTokenSecretRef`
- `status: TelegramConnectionStatus`
- `privacyMode: TelegramPrivacyMode`
- `allowedChatIds[]`
- `defaultParticipationMode: TelegramParticipationMode`
- `defaultSummaryLookbackMinutes`
- `createdAt`
- `updatedAt`
- `lastValidatedAt`
- `revokedAt`

`defaultParticipationMode` controls only the default interactive behavior for enabled groups.
`defaultSummaryLookbackMinutes` is a connection-level fallback for new or unset group summary policies; it seeds group policy but does not override an explicit group value.
Summary policy and subscription enablement are separate group-level settings.
`allowedChatIds[]` is an operational allowlist derived from group subscriptions and bot membership, not the source of truth.

Authority-scope rule under the shared provider ingress contract:

- Telegram authority scope is per `TelegramBotConnection`, keyed by the connected bot identity.
- `allowedChatIds[]`, `TelegramChatRef.tracked`, and `TelegramGroupSubscription` narrow which chats Origin tracks or acts on inside that bot scope, but they do not create separate authority scopes or redefine `accountSetScope`.

`botTokenSecretRef` is the canonical persisted credential reference for the Telegram bot token.
The token value itself is never stored or echoed as raw plaintext in replicated Telegram domain objects.
The CLI mutation contract is secure-ref only:

- `telegram connection set-token --token-ref <secure-handoff-ref>`

Raw bot token strings are **not** accepted on the normal agent CLI surface.
The secure handoff may come directly from an operator-only handoff channel or from a pre-provisioned credential reference flow; either way, the mutation stores/updates `botTokenSecretRef` and the runtime resolves the secret material out-of-band.

### `TelegramChatRef`

Represents a Telegram chat that Origin cares about.

Fields:

- `id`
- `telegramChatId`
- `kind: TelegramChatKind`
- `title`
- `username`
- `memberCount`
- `isGroup`
- `isSupergroup`
- `isChannel`
- `isDirectMessage`
- `botIsMember`
- `botPermissions`
- `tracked`
- `createdAt`
- `updatedAt`

`TelegramChatRef` is discovery and read-model state. `tracked` is derived from the canonical group subscription state; it does not authorize tracking by itself.

### `TelegramGroupSubscription`

Represents Origin's tracked-group overlay and policy for a Telegram group.
This is the canonical Origin tracking object for groups and the replicated overlay for provider-facing group state.

Fields:

- `id`
- `chatRefId`
- `subscriptionState: TelegramGroupSubscriptionState`
- `participationMode: TelegramParticipationMode`
- `summaryEnabled`
- `summaryLookbackMinutes`
- `mentionTrackingEnabled`
- `messageCacheEnabled`
- `createdAt`
- `updatedAt`
- `disabledAt`

Normative model:

- `subscriptionState` controls whether the group is actively tracked by Origin.
- `participationMode` applies only when `subscriptionState=enabled` and controls interactive bot behavior.
- `summaryEnabled` is independent of `participationMode` and controls whether summary workflows may run or post for the group.
- `summaryLookbackMinutes` is the canonical per-group summary lookback window in minutes. It is context for summary generation, not a posting cadence or scheduler.
- Automatic summary scheduling is owned by Automation objects. Telegram group policy only gates whether those automations may run or post for the group and provides the default lookback window they should use.
- If `summaryLookbackMinutes` is unset, the bot connection's `defaultSummaryLookbackMinutes` can be used as the fallback seed when the subscription is created or repaired.
- `messageCacheEnabled` controls proactive warming or retention above the mandatory offline/client floor; it does not disable that minimum floor for enabled groups after a successful sync.
- `disabledAt` records when the subscription was last disabled; it is not a separate mode.
- A discovered chat only becomes actively tracked after an explicit group registration creates or updates this subscription.
- If the connected bot validates with privacy mode `enabled`, the subscription remains visible for recovery but is treated as disabled/degraded for tracked-group workflows until privacy mode is corrected.
- If the bot loses membership or the permissions needed for the requested mode, Origin must mark the subscription disabled, refresh the chat ref, and surface the loss as a validation / recovery problem until the operator restores access and re-registers or re-enables the group.

### `TelegramRecentMessageCache`

Represents a selective cache window for recent messages and updates.

Fields:

- `id`
- `chatRefId`
- `messageId`
- `senderId`
- `senderKind: TelegramSenderKind`
- `sentAt`
- `textPreview`
- `hasMedia`
- `replyToMessageId`
- `forwardedFrom`
- `cachedAt`
- `expiresAt`

### `TelegramOutgoingAction`

Represents an outbound message or other bot action waiting to be applied.

Fields:

- `id`
- `kind: TelegramOutgoingActionKind`
- `chatRefId`
- `replyToMessageId`
- `payload`
- `status: TelegramOutgoingActionStatus`
- `dedupeKey`
- `queuedAt`
- `attemptedAt`
- `succeededAt`
- `failedAt`
- `lastError`

### `TelegramSummaryJobRecord`

Represents a read-model record for a summary or participation workflow owned by automation or an explicit operator request.

Fields:

- `id`
- `chatRefId`
- `triggerKind: TelegramSummaryTriggerKind`
- `windowStart`
- `windowEnd`
- `status: TelegramSummaryJobStatus`
- `outputMessageId`
- `queuedAt`
- `completedAt`
- `failedAt`
- `lastError`

Automatic summaries are automation-owned. This record projects the resulting execution state for Telegram; it is not a second canonical workflow object.
`triggerKind = "scheduled"` means a generic Automation schedule triggered the run. `triggerKind = "mention"` means an automation or explicit agent rule triggered the run from a mention-related ingress event. `triggerKind = "agent_decision"` means the agent chose to summarize without a standing schedule.
`windowStart` and `windowEnd` are the evaluated lookback window for the specific run. They come from the active group policy or explicit operator request at scheduling time and do not replace `TelegramGroupSubscription.summaryLookbackMinutes`.

## Read / Query Surface

Origin should expose a Telegram query surface that is useful to the agent and the app without implying a full mirror.

### Connection and status

- get bot connection
- validate bot token
- list configured Telegram chats
- list group subscriptions
- list recent Telegram activity events

### Chat and group reads

- get a chat by Telegram chat id
- list chats the bot is a member of
- get recent messages for a tracked chat
- fetch a specific message by chat and message id
- fetch recent updates relevant to a tracked chat
- list unread mentions or groups whose summary policy and automations indicate a summary may be useful

### Search and retrieval

- search within cached recent messages
- search within a specific tracked group window
- retrieve message threads from cached conversation context

Search should be limited to what Origin has cached or can reasonably fetch on demand. It should not pretend to provide global Telegram search across the entire platform.

## Mutation / Action Surface

### Connection management

- set bot token via secure handoff ref or credential reference (`telegram connection set-token --token-ref <secure-handoff-ref>`)
- validate bot token
- revoke bot token
- update bot display metadata
- record or update the privacy-mode expectation Origin should validate
- configure default participation settings

`set-token` input contract is strict:

- required input: `token-ref` (opaque secure handoff / credential reference)
- forbidden input on normal agent CLI: raw bot token strings
- successful mutation effect: update `TelegramBotConnection.botTokenSecretRef`

### Group participation

- register a group after the bot is invited
- enable a group subscription
- disable a group subscription
- set group participation mode
- set group summary policy
- set group mention tracking policy
- set group cache policy

Enable / disable is a subscription-state change.
Participation mode and summary policy are separate settings on an enabled group.

### Message actions

- send a message to a chat or group
- reply to a specific message
- edit a message previously sent by the bot
- delete a message previously sent by the bot where permitted
- post a summary into a group when explicitly requested by the user or produced by an agent workflow

### Bot configuration actions

- set command list / bot hints where useful
- refresh bot metadata from Telegram
- re-scan tracked chats after membership changes

### Cache actions

- refresh recent message cache for a chat
- expire old cached windows
- rehydrate a recent cached chat window from Telegram when the bot can still read that recent history and the provider still exposes it

## Sync / Cache Strategy

- Telegram remains the source of truth.
- Origin stores bot identity, chat refs, recent message windows, and outbound actions as server-side operational state and read models derived from Telegram ingress.
- `TelegramGroupSubscription` is the replicated Origin overlay for tracked-group policy and lifecycle state.
- Origin stores recent message windows as a selective, recent, bounded cache for agent workflow speed and short-lived robustness.
- Chat refs and group policy are expected to survive cache eviction or repair.
- Recent message caches are evictable and are not a durable history store.
- Rehydration is best-effort for reachable recent history only; it can refill a bounded window after eviction, but it does not guarantee reconstruction of all prior messages or inaccessible state.
- Local clients should read Telegram state through the server or from the server-synced local state, not by talking to Telegram directly.
- Automatic summary schedules live in generic Automation objects; Telegram stores only per-group policy, recent context, and projected summary-job records.
- The shared polling / cursor / cache / activity-event model is defined in [provider_ingress_api.md](./provider_ingress_api.md)

## Group Model

Telegram group participation is first-class.

Origin models each tracked group on separate axes:

- subscription state: `enabled` or `disabled`
- participation mode: `observe` or `participate`
- summary policy: enabled or disabled
- summary lookback: per-group override or bot-level default seed; scheduling remains Automation-owned

These axes must not be collapsed into one overloaded mode field.

Membership and permission loss follow a strict lifecycle:

- if the bot is removed from a group or loses the permissions required for the tracked mode, the subscription is disabled
- disabled subscriptions remain visible for recovery, but they do not generate summaries or outbound participation actions until access is restored
- a re-scan or explicit re-registration can re-enable the subscription once the bot is invited back and permissions are valid again

Origin should support:

- being invited into groups
- tracking group membership
- reading group messages when the bot is configured to receive them
- summarizing group activity
- responding inside groups when explicitly requested or when the agent chooses to participate

The bot must be able to operate with the maximum access model Telegram allows for bots, subject to:

- invitation-based membership
- privacy mode behavior
- Telegram rate limits
- Telegram's prohibition on acting like a normal user account

## Activity Events

For provider-backed reactive automations, the canonical trigger surface is the ingress-emitted Telegram event family defined in [provider_ingress_api.md](./provider_ingress_api.md).

That canonical ingress family is:

- generic ingress lifecycle: `provider.ingress.started`, `provider.ingress.completed`, `provider.ingress.failed`
- tracked-chat message changes: `telegram.message.received`, `telegram.message.mentioned`

Canonical Telegram summary lifecycle activity kinds in v1 are `telegram.summary.generated` and `telegram.summary.posted`. They are Telegram-domain first-party activity emitted from `TelegramSummaryJobRecord` lifecycle, not provider-ingress message events, and they carry `sourceScope.chatId` plus `attributes.summaryTriggerKind`.

Bot validation, group subscription changes, participation-policy changes, summary-job records, and outbound action outcomes may still appear in Telegram-domain activity, but they are not alternate provider-backed trigger kinds for the same Telegram message.

The Telegram integration must emit activity events for:

- bot token connected
- bot token revoked
- bot validation succeeded or failed
- group invited / group linked
- group subscription enabled or disabled
- group participation mode changed
- group summary policy changed
- privacy mode changed
- message received
- message sent
- message edit succeeded or failed
- message delete succeeded or failed
- summary generated
- summary posted
- cache refreshed
- cache expired
- Telegram API error
- rate limit encountered

Each activity event should include:

- actor identity
- timestamp
- chat or group context
- action kind
- outcome
- error details if relevant

## Failure And Retry Semantics

- Outbound Telegram actions should be queued and retried when transient failures occur.
- Retries should be idempotent where possible.
- Bot token failures should surface immediately as a connection-status problem.
- If Telegram rejects an action because of permissions, membership, or privacy-mode constraints, Origin should surface that clearly in the activity log and user-facing error state.
- Rate-limited actions should back off and retry according to Telegram's limits.
- Message updates should dedupe by Telegram update id or another stable dedupe key.

## CLI-Oriented Capabilities

The integration should expose a small, composable CLI surface such as:

- `telegram connection status`
- `telegram connection set-token --token-ref <secure-handoff-ref>`
- `telegram connection configure`
- `telegram chat list`
- `telegram chat get`
- `telegram chat refresh`
- `telegram group register`
- `telegram group enable`
- `telegram group disable`
- `telegram group policy summary-set`
- `telegram summary run`
- `telegram message send`
- `telegram message reply`
- `telegram summary list`

Canonical token-handoff contract for the CLI surface:

- `telegram connection set-token` accepts `token-ref` only.
- Raw bot tokens are not valid input on the normal agent CLI surface.
- The command writes/updates `TelegramBotConnection.botTokenSecretRef`; secret resolution happens through secure handoff infrastructure.
- Onboarding must produce that `token-ref` through operator-only secure handoff (or equivalent secure credential reference) before this mutation runs.

The exact command names can vary, but the model should be structured around the actions above.

## Open Implementation Notes

- Keep cached content selective and recent.
- Keep provenance metadata lightweight.
- Prefer explicit group registration and policy over silent auto-tracking.
- Do not build a Telegram user-account abstraction.
- Do not turn Telegram into a notification transport for Origin.
