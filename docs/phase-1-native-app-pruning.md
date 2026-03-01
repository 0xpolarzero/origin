# Phase 1 Spec: Native App-Only Repository Pruning

## Goal

Reduce this fork to the minimum code needed to develop, build, and run the native desktop app.

## Why This Phase Exists

This fork is focused on a native app product, not opencode's full cloud/web/platform footprint. Keeping only required code reduces maintenance cost, CI noise, dependency surface, and agent context size.

## In Scope

- Identify what is required for native desktop runtime and development.
- Remove non-required packages and top-level directories.
- Update workspace and scripts so install and desktop development still work.
- Validate app startup and build after pruning.
- Document all decisions and commands run.

## Out of Scope

- Refactoring app behavior or features.
- Performance tuning.
- Rewriting architecture.
- Release automation redesign beyond what is necessary to keep local development healthy.

## Baseline Assumptions

- Default branch is `dev`.
- Diffs should use `dev` or `origin/dev` as base.
- `packages/desktop` is the native shell.
- `packages/opencode` provides the sidecar binary required by desktop local mode.
- `packages/app` + `packages/ui` are required for desktop UI rendering.

## Required Keep Set

Keep these directories/packages:

- `packages/desktop`
- `packages/app`
- `packages/ui`
- `packages/opencode`
- `packages/sdk/js`
- `packages/util`
- `packages/plugin`
- `packages/script`
- `patches/`
- root config/build essentials:
  - `package.json`
  - `bun.lock`
  - `bunfig.toml`
  - `tsconfig.json`
  - `install`
  - `turbo.json` (unless fully replaced)

## Deletion Candidates (Native App Not Required)

Delete these unless a later phase explicitly needs them:

- `infra/`
- `github/`
- `nix/`
- `script/` (top-level script folder, not `packages/script`)
- `sdks/vscode/`
- `packages/web/`
- `packages/docs/`
- `packages/storybook/`
- `packages/containers/`
- `packages/slack/`
- `packages/extensions/`
- `packages/identity/`
- `packages/function/`
- `packages/console/`
- `packages/enterprise/`

## Evidence Anchors for Keep Set

Use these references when validating assumptions:

- Desktop depends on app/ui: `packages/desktop/package.json`
- Desktop Tauri sidecar config: `packages/desktop/src-tauri/tauri.conf.json`
- Desktop predev/build sidecar wiring: `packages/desktop/scripts/predev.ts`
- Desktop runtime sidecar usage: `packages/desktop/src-tauri/src/lib.rs`
- App workspace dependencies: `packages/app/package.json`

## Agent Execution Plan

## Step 1: Snapshot Current State

- Record current branch and status.
- Capture package/workspace inventory.
- Save a short pre-prune note in this file under "Decision Update".

Suggested commands:

```bash
git branch --show-current
git status --short
ls -1 packages
cat package.json
```

## Step 2: Prune Workspace Declarations

- Edit root `package.json` workspaces to include only required packages.
- Remove scripts that directly call removed directories.
- Keep `dev:desktop`, desktop build, and root `typecheck` paths working.

Expected output:

- Root workspace list contains only keep-set packages.
- Root scripts do not reference deleted directories.

## Step 3: Delete Non-Required Directories

- Remove deletion candidates in one commit-sized batch.
- Do not delete any keep-set paths.

Suggested commands:

```bash
rm -rf infra github nix script sdks/vscode
rm -rf packages/web packages/docs packages/storybook packages/containers
rm -rf packages/slack packages/extensions packages/identity
rm -rf packages/function packages/console packages/enterprise
```

## Step 4: Fix Broken References

- Search for references to removed paths in:
  - root scripts
  - turbo pipeline config
  - CI configs
  - package scripts inside keep-set packages
- Remove or replace only what is required for local native development.

Suggested commands:

```bash
rg "packages/(web|docs|storybook|containers|slack|extensions|identity|function|console|enterprise)|sdks/vscode|infra|github|nix|script/"
rg "workspace" package.json turbo.json
```

## Step 5: Validate

Run from repository root unless noted:

```bash
bun install
bun run dev:desktop
```

Optional additional checks:

```bash
bun --cwd packages/desktop run build
bun --cwd packages/app run build
bun --cwd packages/opencode run build
```

If tests are run, do not run from root because root test script is guarded.

## Step 6: Document Outcomes

Update this file with:

- exact deletions
- required follow-up fixes
- validation results
- open risks

Also create a short execution log at:

- `docs/phase-1-execution-log.md`
- include:
  - timestamp
  - commands run
  - files removed
  - files edited
  - validation pass/fail

## Acceptance Criteria

- `bun install` succeeds after pruning.
- Desktop development startup works (`bun run dev:desktop`).
- No remaining workspace entries reference deleted packages.
- No required desktop runtime dependency was removed.
- Documentation reflects final keep/delete decisions.

## Risk Register

- Sidecar breakage if `packages/opencode` wiring is altered.
- Hidden script dependency on removed cloud packages.
- CI failures from obsolete workflows still referencing deleted paths.
- Lockfile drift after workspace shrink.

## Rollback

- Restore from git commit before pruning.
- Re-add deleted directories from `dev` selectively if validation fails.
- Re-run validation commands before continuing.

## Decision Update

### 2026-03-01

- Established native app-only keep set and deletion candidate list.
- Chose staged pruning with validation gates to avoid breaking sidecar runtime.
- Pruned root workspaces to native keep set only:
  - `packages/desktop`
  - `packages/app`
  - `packages/ui`
  - `packages/opencode`
  - `packages/sdk/js`
  - `packages/util`
  - `packages/plugin`
  - `packages/script`
- Deleted candidate directories:
  - `infra/`
  - `github/`
  - `nix/`
  - `script/` (top-level)
  - `sdks/vscode/`
  - `packages/web/`
  - `packages/docs/`
  - `packages/storybook/`
  - `packages/containers/`
  - `packages/slack/`
  - `packages/extensions/`
  - `packages/identity/`
  - `packages/function/`
  - `packages/console/`
  - `packages/enterprise/`
- Validation outcomes:
  - `bun install`: pass (required escalated run in this environment due tempdir sandbox restriction).
  - `bun run --cwd packages/app build`: pass.
  - `bun run --cwd packages/desktop build`: pass.
  - `bun run --cwd packages/opencode build`: fail (network fetch to `https://models.dev/api.json` refused in this environment).
  - `bun run dev:desktop`: fail for same `packages/opencode` predev network fetch.
- Open risk:
  - Desktop dev startup currently depends on `packages/opencode` build-time network access to `models.dev` from this environment.
