# Origin Onboarding

## Status

- Working draft
- Last updated: 2026-04-06
- Scope: v1 setup and account linking flow
- Linked from: [prd.md](../prd.md)

## Purpose

This document defines the v1 onboarding flow for Origin.

The onboarding flow should:

- keep the product single-owner and minimal
- connect the user to a working agent setup quickly
- set up the agent's Google account, GitHub account, and Telegram bot
- collect the user's own identity handles
- configure Gmail, Google Calendar, and Google Tasks access
- configure Telegram group participation and bot privacy settings
- set up the managed vault and `Origin/Memory.md`
- set up in-app and push notifications
- set up either local mode or a single Hetzner-compatible Linux VPS running Origin like its own machine

## Onboarding Principles

- Favor a short number of meaningful phases over a long wizard with unnecessary branching.
- Ask for the user's identity information early so Origin can recognize the user across services.
- Assume the agent Google and GitHub accounts already exist; connect them through OAuth.
- Assume the Telegram bot already exists; connect it through token entry.
- Do not assume automated creation of external provider accounts.
- Keep the setup path functional even if the user begins locally and later moves to VPS mode.
- In `vps` mode, bring up the authoritative server before provider linking becomes authoritative.
- In `vps` mode, collect only non-secret setup inputs until that server exists.
- Provider OAuth, token storage, and server-owned pollers/cursors happen on the authoritative server.
- Persist only what is needed to complete setup, recover it, and operate the system afterward.

## Phase 1: Start Mode

The user chooses one of two setup modes:

- `local`
- `vps`

### Required user input

- setup mode
- server host choice if VPS mode is selected

### Persistence

- chosen mode
- any host connection details needed to continue setup

### Success criteria

- Origin knows whether it is setting up local mode or a remote server deployment.
- The rest of the flow can branch accordingly.
- If the user chose `vps`, Origin knows provider linking must wait until the server is deployed.

## Phase 2: User Identity

Origin asks for the user's own identity handles so it can identify them across services and use them as persistent context.

### Required user input

- display name
- email address or addresses the user considers primary
- GitHub username
- Telegram handle or Telegram identity details if relevant
- any other service handles the user wants Origin to recognize

### Persistence

- user identity handles
- any contact metadata needed for recognition across services
- links between the user identity and future notes/memory entries

### Success criteria

- Origin can refer to the user consistently across chats, memory, email, GitHub, and Telegram.
- The user sees that Origin knows which accounts belong to them.

## Phase 3: Agent Identity

Origin sets up the identities the agent will use.

### Required user input

- agent display name
- agent Google account email or OAuth target
- agent GitHub account email or OAuth target
- Telegram bot username plus an operator-only secure handoff for the bot token
- any initial account naming or handle preferences

### Persistence

- agent account references
- OAuth connection metadata
- Telegram bot credential handle or encrypted credential reference

### Success criteria

- Origin has the expected agent Google identity recorded.
- Origin has the expected agent GitHub identity recorded.
- Origin has the expected Telegram bot identity and secure token handoff reference recorded.
- Later provider-link steps can validate the returned principals against these expected identities.

## Phase 4: Provider Linking

Origin walks the user through provider-specific connection steps.

In `local` mode, this phase runs immediately.

In `vps` mode, the inputs for this phase may be gathered earlier, but the actual provider links are created only after Phase 9 has deployed the authoritative server.

### Google

- Use OAuth where available.
- Connect the pre-created agent Google account.
- Complete OAuth through a secure callback or operator-only secure handoff that yields a stored connection reference rather than exposing raw token material to the agent CLI.
- In `vps` mode, complete OAuth and store the resulting tokens on the authoritative server after deployment, not during pre-server setup.
- Verify that the returned Google principal matches the pre-collected expected agent Google identity and fail linking on mismatch.
- Request the minimum scopes required for:
  - Gmail inbox access for the agent mailbox
  - Google Calendar read/write
  - Google Tasks read/write

### GitHub

- Use OAuth where available.
- Connect the pre-created agent GitHub account.
- Complete OAuth through a secure callback or operator-only secure handoff that yields a stored connection reference rather than exposing raw token material to the agent CLI.
- In `vps` mode, complete OAuth and store the resulting tokens on the authoritative server after deployment, not during pre-server setup.
- Verify that the returned GitHub principal matches the pre-collected expected agent GitHub identity and fail linking on mismatch.
- Request the minimum scopes required for:
  - follow-up workflows
  - repository observation
  - issue and pull request interaction if needed

### Telegram

- Link the pre-created Telegram bot through an operator-only secure handoff or secure credential reference, not by passing the raw token through the normal agent CLI surface.
- Configure the bot for group participation.
- Configure the bot for the maximum access model Telegram allows for v1, including privacy mode settings required to receive group messages.
- In `vps` mode, store the bot token and create server-owned pollers only after the authoritative server exists.

### Required user input

- OAuth approval for Google
- OAuth approval for GitHub
- secure operator handoff or credential reference for the Telegram bot token
- confirmation of Telegram bot group/privacy configuration

### Persistence

- provider connection records
- encrypted token material or secure token references
- provider-specific scope grants
- Telegram bot configuration state

### Success criteria

- Google is connected and usable by Origin.
- GitHub is connected and usable by Origin.
- Telegram bot is connected and usable by Origin in groups.
- No provider link is accepted if the returned Google or GitHub principal does not match the expected pre-collected agent identity.

### Failure / recovery

- If OAuth fails, the user retries the provider flow.
- If OAuth completes against the wrong Google or GitHub account, Origin rejects the link, reports the mismatch, and asks the user to retry with the expected agent account or correct the expected identity first.
- If a secure token handoff is invalid, Origin reports the failure and re-prompts for the secure credential handoff.
- If a required scope is missing, Origin restarts the corresponding provider authorization flow.

## Phase 5: Email / Calendar / Tasks Access

Origin configures the agent mailbox and planning surfaces.

### Email

- The agent mailbox is a real working inbox connected directly through the provider API.
- Forwarded user emails are normal messages inside that inbox.
- Origin should configure the inbox so the user can forward messages to it if they want that workflow.

### Calendar and Tasks

- Grant access to Google Calendar and Google Tasks.
- Configure the calendars/task lists that Origin should watch or manage as attached bridge surfaces.
- Each attached calendar or task list should run through the shared ingress model with server-owned pollers and saved cursors or sync markers.
- Establish which shared calendars belong to the agent workflow.
- Selected calendars and task lists are setup/configuration state, not ad hoc item-level attachments.

### Required user input

- confirmation of which mailbox/calendar/task surfaces Origin should manage
- forwarding address or forwarding rules if the user wants email forwarding
- which calendars and task lists to sync

### Persistence

- mailbox connection state
- calendar/task bridge attachment configuration
- shared calendar and task-list identifiers
- server-owned poller and cursor state for attached bridge surfaces
- forwarding configuration references if used

### Success criteria

- Origin can read/write the agent mailbox.
- Origin can sync the selected attached calendars.
- Origin can sync the selected attached task lists.
- Forwarded user emails land in the same agent mailbox as ordinary messages.
- In `vps` mode, the selected calendars and task lists are configured on the deployed server, not only in local preflight state.

## Phase 6: Telegram Group Setup

Origin configures the Telegram bot for group use.

### Required user input

- groups the bot should be added to
- confirmation that privacy mode and other bot settings are configured as needed

### Persistence

- group membership references
- bot configuration flags
- any setup notes about visibility or permission constraints

### Success criteria

- The bot is usable inside the selected groups.
- The bot can receive the group traffic needed for summaries and participation.

### Failure / recovery

- If group permissions are insufficient, Origin explains the missing settings and asks the user to adjust the group or bot configuration.

## Phase 7: Workspace, Vault, And Memory

Origin attaches the managed workspace root, initializes or adopts the vault at that same root, and ensures the agent memory file exists.

### Required user input

- confirmation of the managed workspace root / attach path
- any preferred initial folder names
- any initial memory facts or preferences the user wants stored immediately

### First attach behavior

- If the target path does not exist, Origin creates the managed workspace root and bootstraps `Origin/Memory.md` there.
- If the target path exists and is empty, Origin adopts it as the managed workspace root and bootstraps `Origin/Memory.md`.
- If the target path exists and is non-empty, Origin inspects and adopts the existing contents first.
- A non-empty target path must be imported or adopted before Origin exports managed files into it.
- Origin must never silently overwrite existing files, including an existing `Origin/Memory.md`, during first attach.
- In v1, the vault is the workspace root; there is no separate vault subtree path.

### Persistence

- managed workspace root
- `Origin/Memory.md`
- initial note/file structure

### Success criteria

- The managed workspace root is attached and writable.
- The vault exists at the workspace root and is writable.
- `Origin/Memory.md` exists and is visible in the app.
- The agent can read and update memory through the memory protocol.

## Phase 8: Notifications

Origin enables in-app and push notifications.

### Required user input

- iPhone push notification permission
- macOS notification permission if applicable
- any initial notification preferences

### Persistence

- device notification tokens
- notification preferences
- any per-channel enablement state

### Success criteria

- Origin can deliver in-app notifications.
- Origin can deliver push notifications.

## Phase 9: VPS Deployment

If the user selected `vps`, Origin completes the server deployment.

This deployment step happens before Phases 4 through 6 become authoritative in `vps` mode.

### Required user input

- Hetzner-compatible VPS host details
- SSH access or equivalent server access method
- any hostname or DNS details
- confirmation that Origin should run directly on the host machine

### Persistence

- server host reference
- deployment target metadata
- service configuration
- host path references for Origin-managed files

### Success criteria

- Origin is running on the VPS as a normal host service.
- The server can access its managed files and the host filesystem it is allowed to use.
- The setup matches the bare-metal / systemd-first service model.
- Provider linking and server-owned pollers now become authoritative on the deployed server.

### Failure / recovery

- If deployment fails, Origin should preserve the partial configuration and report the step that failed.
- The user should be able to rerun the failed deployment phase without losing earlier successful setup state.

## Phase 10: Validation

Origin validates the connected system end-to-end.

### Checks

- agent Google account can authenticate
- agent GitHub account can authenticate
- Telegram bot can operate in groups
- email inbox can be read and written
- selected calendars and tasks sync correctly
- memory file exists and is editable
- notifications are working
- VPS deployment is healthy if applicable

### Success criteria

- Origin can operate across the configured integrations.
- The user reaches a usable initial state without hidden setup gaps.

## Minimal Persistence Model

During onboarding, Origin should persist:

- user identity handles
- agent account connection records
- OAuth scopes and token references
- Telegram bot token reference
- selected calendars, tasks, and mailbox configuration
- vault and memory file location
- notification preferences and tokens
- VPS deployment metadata if applicable
- If the user later moves from local to VPS mode, replicated app state syncs to the VPS, while secrets and provider operational state are re-established there instead of opaque-migrated.

## Implementation Notes

- Onboarding should be resumable.
- Each phase should have a clear completion marker.
- Failed phases should preserve whatever was already configured.
- The app should clearly surface what still needs to be done.
- Onboarding should not assume any provider account creation automation.
- Onboarding should not introduce Google Drive setup.
- Onboarding should not require a second app account system inside Origin itself.
