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

Origin connects the pre-created agent GitHub account through the GitHub authorization flow.

The integration should use a user-authorized token type that can act on behalf of the connected account.

Important implications from GitHub's docs:

- GitHub App user access tokens are OAuth tokens that act on behalf of a user and are limited by both the user and app permissions.
- Fine-grained permissions apply endpoint-by-endpoint.
- GitHub's notifications REST endpoints only support classic personal access tokens, so v1 should not depend on the notifications inbox API.
- Repository watch/subscription endpoints are also constrained and are not a good foundation for the v1 auth model.

Practical consequence:

- v1 should use the connected account token for normal repo, issue, PR, comment, review, and search operations
- v1 should track followed repositories locally rather than depending on GitHub's watch subscription endpoints as the core follow mechanism

## Local State

GitHub state inside Origin should be selective and derived.

### Stored locally

- connected account metadata
- tracked repositories
- repo follow configuration
- local cursors / last-seen markers
- cached issue snapshots
- cached pull request snapshots
- cached comment and review snapshots for watched items
- lightweight search results
- queued outbound GitHub actions
- activity-event records for meaningful GitHub operations

### Not stored locally

- a full offline copy of GitHub
- a complete mirror of repository contents
- a complete mirrored notifications inbox
- broad historical copies of all repo traffic by default

## Core Objects

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

### `GitHubFollowTarget`

Represents a repository the user wants Origin to watch for follow-up.

Suggested fields:

- `id`
- `repositoryId`
- `mode`
  - `issues`
  - `pull_requests`
  - `all_activity`
- `enabled`
- `pinned`
- `lastCursor`
- `lastSyncAt`
- `createdAt`
- `updatedAt`

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
- `lastError`
- `createdAt`
- `updatedAt`

### `GitHubCursor`

Represents a local sync cursor for a repository or query.

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

- mark a repo, issue, or PR as followed
- dismiss or resolve cached follow-up items
- link a GitHub object to an Origin task or note
- queue a GitHub action for retry if it fails transiently

## Cache Strategy

Origin should cache only what it needs for follow-up.

Recommended cache policy:

- cache tracked repository metadata
- cache issue and PR snapshots for followed repos
- cache comments and review state for active threads
- cache only selected bodies, diffs, and snippets as needed
- cache cursors and ETags for incremental refresh
- evict cold data aggressively

Polling / refresh strategy:

- refresh on demand when the user opens a repo, issue, or PR
- refresh tracked repos periodically in the background on the server
- refresh active threads more frequently than cold repositories
- use `updated_at` / cursor-based incremental refresh where the endpoint supports it

Origin should not depend on GitHub's notifications inbox API in v1 because that API only supports classic personal access tokens.

## Activity Events

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

- queue write actions locally before dispatch
- retry with backoff for transient failures
- surface failures in the activity log
- preserve the outbound action record until it is clearly resolved or intentionally abandoned

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

- `github repo ...`
- `github issue ...`
- `github pr ...`
- `github review ...`
- `github watch ...`
- `github search ...`
- `github sync ...`

The underlying implementation should map these verbs to the smallest stable set of API operations needed for follow-up.

## Relationship To Origin Planning

GitHub objects should be linkable to Origin tasks and notes.

Examples:

- an issue can link to a task
- a PR can link to a note
- a repository watch target can link to an automation or follow-up rule

That linkage should live in Origin, not inside GitHub.

## Open Product Questions

None at this stage.
