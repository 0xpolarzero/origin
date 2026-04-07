# Origin GitHub API

## Status

- Working draft
- Scope: v1 GitHub integration surface
- Linked from: [prd.md](./prd.md)

## Purpose

This document defines the v1 API surface for Origin's GitHub integration.

The GitHub integration is used for:

- follow-up on repositories, issues, and pull requests
- monitoring activity on selected repos
- reading discussion state and review state
- taking direct actions on behalf of the agent account

GitHub remains canonical. Origin keeps only selective caches and operational metadata, not a full offline mirror.

## Design Principles

- GitHub is an external-service domain, not a first-party offline mirror
- Origin should keep the working set small and purposeful
- The agent should act directly rather than defaulting to simulation or dry-runs
- The API should fit the CLI-first model cleanly
- Follow-up should center on issues, pull requests, comments, labels, reviewers, and repository tracking
- Notifications and activity awareness should be derived from GitHub objects and selective polling/caching, not from a full mirrored inbox
- The integration should remain useful even if the user only wants to track a handful of repos closely

## Auth Model

Origin connects the pre-created agent GitHub account through GitHub's authorization flow.

In v1, the resulting credential is a GitHub App user access token obtained through OAuth. OAuth alone is not enough for usable access: repo and organization access come from installing the GitHub App on the selected repositories or organizations, and those installation grants are required setup state. The token acts on behalf of the connected account and is constrained by both the user grant and app permissions.

Setup validation should confirm both the OAuth grant and the installation-grant records before the account is considered usable.

An installation grant is the local Origin record for a specific GitHub App installation on a user or organization account. It is the scope anchor for repo access checks and should capture the installation identity, the owning account, and the repository access shape that Origin derived from that grant.

Important implications from GitHub's docs:

- GitHub App user access tokens are OAuth tokens that act on behalf of a user and are limited by both the user and app permissions.
- Fine-grained permissions apply endpoint-by-endpoint.
- GitHub's notifications REST endpoints only support classic personal access tokens, so v1 should not depend on the notifications inbox API.
- Repository watch/subscription endpoints are also constrained and are not a good foundation for the v1 auth model.

Practical consequence:

- v1 should use the connected account token for normal repo, issue, PR, comment, review, and search operations
- v1 should track followed repositories locally rather than depending on GitHub's watch subscription endpoints as the core follow mechanism
- repo access checks should follow the selected GitHub App installation-grant records, not a separate Origin-owned permission system
- installation-grant scope means the repo/org access exposed by a selected GitHub App installation, not a separate Origin ACL

## Local State

GitHub state inside Origin should be selective and derived.

### Stored locally

- connected account metadata
- selected GitHub App installation-grant records and the derived accessible repo/org scope
- repo follow targets and derived tracked repositories
- local follow targets across repositories, issues, and pull requests
- server-side cursors / last-seen markers for polling
- cached issue snapshots exposed as read models
- cached pull request snapshots exposed as read models
- cached comment and review snapshots for followed items as read models
- lightweight search results as read models
- queued outbound GitHub actions as server outbox records
- activity-event records for meaningful GitHub operations

### Not stored locally

- a full offline copy of GitHub
- a complete mirror of repository contents
- a complete mirrored notifications inbox
- broad historical copies of all repo traffic by default

### Minimum offline/client contract (v1)

GitHub remains provider-canonical, but Origin guarantees the following minimum client-visible/offline surface for the tracked working set:

- Replicated overlay durability: all `GitHubFollowTarget` objects and related `ExternalActionIntent` records are fully available offline on every synced client.
- Scope visibility floor: the last successful snapshot of selected installation grants and derived actionable repo coverage remains client-visible offline.
- Repository snapshot floor: at least metadata for the most recent 100 tracked repositories (or all tracked repositories when fewer than 100) remains offline-visible from the last sync.
- Issue/PR snapshot floor: for each tracked repository, at least the most recent 50 cached issue/PR snapshots touched in the last 30 days remain offline-visible, including title/state/labels/assignees/review-decision summaries.
- Discussion snapshot floor: for each cached issue/PR snapshot, at least the most recent 20 comments/reviews remain offline-visible as cached summaries/snippets.
- Outbound intent floor: offline GitHub mutations are durably captured as replicated intent plus server outbox linkage and replay once the provider execution home regains connectivity and valid grant scope.

Outside these minimums, colder provider-derived snapshots may be evicted and re-fetched from GitHub.

## Core Objects

### `GitHubInstallationGrant`

Represents a discovered GitHub App installation grant that Origin may select for the working set.

Suggested fields:

- `id`
- `installationId`
- `accountType`
- `accountLogin`
- `repositorySelection`
- `selected`
- `selectedRepositories[]`
- `accessibleRepositories[]`
- `permissions`
- `status`
- `lastRefreshedAt`
- `lastValidatedAt`
- `selectionUpdatedAt`
- `revokedAt`
- `createdAt`
- `updatedAt`

Normative model:

- OAuth completion discovers candidate installation grants, but does not select them automatically.
- The operator explicitly selects which discovered grants Origin should rely on for the current repo/org working set.
- `selectedRepositories[]` is optional narrowing metadata inside a selected installation when GitHub exposes broader installation scope than Origin needs.
- `accessibleRepositories[]` is the current derived repository coverage Origin believes is actionable through that grant, using stable `owner/name` refs.
- A repository is actionable only when at least one selected, non-revoked grant currently covers it.
- If a selected grant later stops covering a repository, Origin keeps the local repository metadata and follow targets, but marks the repository out of scope and blocks provider refresh and write actions for it until grants are refreshed or reselected.
- Deselecting the last usable grant leaves GitHub connected but incomplete for repo actions until a valid grant is selected again.
- Unselected discovered grants are inspectable, but they do not authorize provider reads or writes for the working set.

### Grant Lifecycle And Repo Eligibility

Canonical v1 lifecycle:

1. complete GitHub OAuth for the connected agent account
2. discover installation grants from GitHub
3. persist the operator-selected grants plus any repository narrowing
4. derive actionable repository coverage from the selected grants
5. refresh or revalidate grants when repo access changes, GitHub scope shrinks, or a grant is revoked

Required behavior:

- onboarding is not complete for GitHub until both OAuth and installation-grant selection are valid
- local repo tracking may exist before a matching grant is selected, but provider-backed repo reads and writes must remain blocked until scope is valid
- if scope later shrinks, Origin preserves the local repo/follow objects, marks the affected repo as out of provider scope, and stops direct GitHub actions until the operator refreshes or changes grant selection
- validation should explain which selected grants are active, which are revoked or stale, and which repositories currently fall outside actionable scope

Operational ownership under the shared provider ingress model:

- GitHub pollers and outbound GitHub actions run only on the provider execution home.
- Selected `GitHubInstallationGrant` records and any `selectedRepositories[]` narrowing tell that one machine which repositories it may read or write.
- `GitHubFollowTarget` objects narrow local attention and poll scope inside that server-side working set; they do not turn other peers into provider workers.

Required grant-management surface:

- onboarding: `setup provider github grant refresh|list|select|deselect`
- runtime: `github account grant list|get|refresh|select|deselect`

### `GitHubRepository`

Represents a repository Origin is aware of.

Suggested fields:

- `id`
- `owner`
- `name`
- `fullName`
- `htmlUrl`
- `description`
- `private`
- `defaultBranch`
- `archived`
- `fork`
- `topics[]`
- `tracked`
- `trackingMode`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

`tracked` is derived from the local repo-kind follow target state, not a second source of truth.

### `GitHubFollowTarget`

Represents a local Origin follow target for follow-up.

Suggested fields:

- `id`
- `repositoryId`
- `kind`
  - `repo`
  - `issue`
  - `pr`
- `targetRef`
  - omitted for `repo`
  - issue or PR ref for `issue` / `pr`
- `enabled`
- `pinned`
- `reason`
- `dismissedAt`
- `dismissedByActor`
- `dismissedThroughCursor`
- `lastRefreshedAt`
- `createdAt`
- `updatedAt`

Normative model:

- Follow targets live in Origin and define the local follow-up working set.
- Repo-kind follow targets define the canonical repository working set.
- Repo follow targets define poll scope for the integration and local attention, but server pollers own the repository cursor state.
- Issue and PR follow targets narrow local attention within that working set.
- Issue and PR targets may reference or inherit the repo-level polling scope rather than creating a second repo cursor.
- These follow targets do not map to GitHub's native watch / subscription state.
- `dismissedThroughCursor` is the durable attention watermark for `dismiss`; `dismiss` stores the current repository refresh cursor for the target's repository as that watermark.
- A dismissed target remains queryable in Origin and does not lose links, pinning, or follow membership; dismissal only suppresses attention-oriented surfacing.
- Repo-kind targets resurface after a later refresh for that repository advances beyond `dismissedThroughCursor` and observes any newer GitHub provider change in that repository.
- Issue and PR targets resurface only after a later refresh advances beyond `dismissedThroughCursor` and observes newer provider change for that same issue or PR ref.
- Updating or re-enabling an existing dismissed target clears `dismissedAt`, `dismissedByActor`, and `dismissedThroughCursor`.

### `GitHubIssueSnapshot`

Represents a cached issue and its discussion state.

Suggested fields:

- `id`
- `repositoryId`
- `number`
- `title`
- `bodyMd`
- `state`
- `locked`
- `labels[]`
- `assignees[]`
- `milestone`
- `author`
- `comments[]`
- `updatedAtRemote`
- `lastSeenAt`
- `source`

### `GitHubPullRequestSnapshot`

Represents a cached pull request and its review state.

Suggested fields:

- `id`
- `repositoryId`
- `number`
- `title`
- `bodyMd`
- `state`
- `draft`
- `headRef`
- `baseRef`
- `mergeableState`
- `reviewDecision`
- `labels[]`
- `requestedReviewers[]`
- `reviews[]`
- `comments[]`
- `updatedAtRemote`
- `lastSeenAt`
- `source`

### `GitHubAction`

Represents an outbound GitHub mutation queued or executed by Origin.

Suggested fields:

- `id`
- `actionType`
- `repositoryId`
- `targetId`
- `payload`
- `status`
- `attemptCount`
- `dedupeKey`
- `queuedAt`
- `attemptedAt`
- `succeededAt`
- `failedAt`
- `lastError`
- `createdAt`
- `updatedAt`

GitHub actions are server-side outbox records derived from user or agent intent, not replicated provider state.
`dedupeKey` is the stable origin-side identity for a logical mutation. Retries must reuse it so one intent cannot materialize twice.

### `GitHubCursor`

Represents a server-owned sync cursor for a repository follow target or repository-scoped query.

Suggested fields:

- `id`
- `scope`
- `cursor`
- `etag`
- `lastSeenAt`
- `updatedAt`

## Read / Query Surface

The CLI and app should be able to read:

- tracked repositories
- repositories by owner/name
- repository metadata
- issues in a repository
- issues assigned to the connected account
- issues authored by the connected account
- issues matching labels/state/query
- pull requests in a repository
- pull requests requested of the connected account
- pull requests authored by the connected account
- pull request review state and requested reviewers
- issue and pull request comments
- pull request reviews and review comments
- repository stars / bookmarked repos if the user chooses to track those
- local follow-up queues and cached snapshots

Recommended query categories:

- `github account grant list`
- `github account grant get`
- `repo list`
- `repo get`
- `repo search`
- `issue list`
- `issue get`
- `issue comments`
- `pr list`
- `pr get`
- `pr comments`
- `pr reviews`
- `review requests`

## Mutation Surface

The integration should support direct actions that matter for follow-up.

### Repository tracking

- add a repository to the local follow list
- remove a repository from the local follow list
- optionally star / unstar a repository as a bookmarking action

### Issues

- create issue
- edit issue title/body/state
- add/remove labels
- add/remove assignees
- lock/unlock issue
- comment on issue
- close/reopen issue

### Pull requests

- edit PR title/body/state where allowed
- comment on PR
- comment on PR review threads where allowed
- request reviewers
- submit a review
- approve / request changes / comment
- merge PR when allowed
- close/reopen PR when allowed

### Local workflow actions

- create or update a local follow target for a repo, issue, or PR
- suppress or resolve local follow-target attention after review
- link a GitHub object to an Origin task or note
- queue a GitHub action for retry if it fails transiently

`dismiss` suppresses the current attention state for the follow target until newer matching activity arrives past the stored cursor. It stores the current repository refresh cursor as `dismissedThroughCursor`, does not remove the follow target, and does not create a separate persistent follow-up-item object.

## Cache Strategy

Origin should cache only what it needs for follow-up.

Recommended cache policy:

- cache tracked repository metadata
- cache issue and PR snapshots for followed repos
- cache comments and review state for active threads
- cache only selected bodies, diffs, and snippets as needed
- cache cursors and ETags for incremental refresh
- evict cold data aggressively
- The shared polling / cursor / cache / activity-event model is defined in [provider_ingress_api.md](./provider_ingress_api.md)

Polling / refresh strategy:

- refresh on demand when the user opens a repo, issue, or PR
- refresh tracked repos periodically in the background on the server
- refresh active threads more frequently than cold repositories
- use `updated_at` / cursor-based incremental refresh where the endpoint supports it

Origin should not depend on GitHub's notifications inbox API in v1 because that API only supports classic personal access tokens.

## Activity Events

For provider-backed reactive automations, the canonical trigger surface is the ingress-emitted GitHub event family defined in [provider_ingress_api.md](./provider_ingress_api.md).

That canonical ingress family is:

- generic ingress lifecycle: `provider.ingress.started`, `provider.ingress.completed`, `provider.ingress.failed`
- issue changes: `github.issue.created`, `github.issue.updated`, `github.issue.commented`, `github.issue.closed`, `github.issue.reopened`
- pull-request changes: `github.pr.created`, `github.pr.updated`, `github.pr.commented`, `github.pr.review_requested`, `github.pr.review_submitted`, `github.pr.merged`, `github.pr.closed`, `github.pr.reopened`

Repo tracking changes, local follow-target dismiss or resurface state changes, and outbound write outcomes may still appear in GitHub-domain activity, but they are Origin-owned overlay or outbox events rather than alternate provider-ingress trigger kinds for the same upstream GitHub change.

The activity log should record:

- repo tracking added / removed
- repo starred / unstarred
- issue opened / edited / commented / closed / reopened
- PR opened / edited / commented / reviewed / merged / closed / reopened
- review requested / submitted / approved / changes requested
- sync refreshes
- transient failures and retries

Each activity event should include:

- actor identity
- timestamp
- target repository / issue / PR
- action type
- outcome status
- error details when relevant

Refresh bookkeeping may be coalesced internally, but visible activity should preserve object-family granularity. Repo tracking changes, issue changes, PR changes, review requests, review submissions, comment changes, and follow-dismiss or resurface state changes should not collapse into one generic `updated` event.

## Failure / Retry Semantics

GitHub actions should be retried when the failure is transient and the action is safe to repeat.

Retryable failures:

- network timeouts
- 5xx responses
- temporary rate limiting
- brief auth refresh failures

Non-retryable failures:

- permission denied
- repository not found
- resource conflict that requires a new user decision
- invalid request payload

Recommended behavior:

- queue write actions into Origin's server-side outbox before dispatch
- retry with backoff for transient failures
- surface failures in the activity log
- preserve the outbound action record until it is clearly resolved or intentionally abandoned
- if a target repository is outside the currently selected grant scope, fail fast with a clear scope error rather than attempting the provider action

## Provider Constraints

Important GitHub constraints that shape this API:

- GitHub's REST API is versioned and each endpoint documents supported token types and permissions
- Many issue / PR / comment / review endpoints work with fine-grained access tokens or GitHub App user access tokens
- GitHub App user access tokens are OAuth-style user tokens and act on behalf of the user, limited by both the user and app permissions
- GitHub notifications REST endpoints only support classic personal access tokens
- Repository subscription / watch endpoints are not supported by the token types we want to rely on for v1
- Star endpoints can be used as a lightweight bookmark/follow-style action if needed

Recommended consequence for v1:

- use the connected account token for repo, issue, PR, and review operations
- use local follow targets plus selective polling/caching for follow-up
- do not make the notifications inbox API a core dependency

Official docs used for these constraints:

- [GitHub REST API](https://docs.github.com/en/rest)
- [Issues API](https://docs.github.com/en/rest/issues)
- [Pull requests API](https://docs.github.com/en/rest/pulls/pulls)
- [Pull request reviews API](https://docs.github.com/en/rest/pulls/reviews)
- [Notifications API](https://docs.github.com/en/rest/activity/notifications)
- [Watching API](https://docs.github.com/en/rest/activity/watching)
- [Authenticating with a GitHub App on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user)
- [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)

## CLI Shape

The CLI should expose GitHub capabilities in a small number of composable verbs:

- `setup provider github grant ...`
- `github account ...`
- `github repo ...`
- `github follow ...`
- `github issue ...`
- `github pr ...`
- `github refresh ...`
- `github cache ...`
- `github review ...`
- `github search ...`

The underlying implementation should map these verbs to the smallest stable set of API operations needed for follow-up.

## Relationship To Origin Planning

GitHub objects should be linkable to Origin tasks and notes.

Examples:

- an issue can link to a task
- a PR can link to a note
- a repository follow target can link to an automation or follow-up rule

That linkage should live in Origin, not inside GitHub.

## Open Product Questions

None at this stage.
