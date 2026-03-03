# Sync Fork Guide

## Purpose

Use this guide to sync this fork with upstream `opencode` while keeping fork-specific desktop scope changes.

## Branch and Remote Model

- `origin/dev`: canonical integration branch for this fork.
- `dev`: local working copy of `origin/dev`.
- `upstream/dev`: read-only tracking branch for `anomalyco/opencode`.
- `feature/*`: feature branches created from `dev`.
- `sync/*`: temporary branches used only for upstream sync work.

Rules:

- Do not commit on `upstream/dev`.
- Do not rebase `dev` onto `upstream/dev`.
- Merge upstream updates into a `sync/*` branch first, validate, then fast-forward `dev`.

## One-Time Remote Setup

Run only if `upstream` is missing:

```bash
git remote add upstream git@github.com:anomalyco/opencode.git
```

Verify:

```bash
git remote -v
```

## If You Already Have Local Unpushed Commits on `dev`

Move those commits off `dev` before sync:

```bash
git switch dev
git switch -c feature/<topic>
```

Reset local `dev` back to remote state:

```bash
git switch dev
git fetch origin
git switch -C dev origin/dev
```

## Standard Sync Procedure

1. Ensure working tree is clean.

```bash
git status --short
```

2. Fetch latest refs.

```bash
git fetch --all --prune
```

3. Create a sync branch from current `dev`.

```bash
git switch dev
git pull --ff-only origin dev
git switch -c sync/upstream-<YYYY-MM-DD>
```

4. Merge upstream changes.

```bash
git merge --no-ff upstream/dev
```

5. Resolve conflicts.

For files deleted in this fork but modified upstream, keep deletion:

```bash
git rm <path>
```

For files that must stay, resolve content conflicts and stage:

```bash
git add <path>
```

6. Run validation relevant to touched packages.

Notes:

- Do not run tests from repo root.
- Run tests from package directories (for example `packages/opencode` or `packages/app`).

7. Finalize merge commit if needed.

```bash
git commit
```

8. Fast-forward `dev` to validated sync result.

```bash
git switch dev
git merge --ff-only sync/upstream-<YYYY-MM-DD>
git push origin dev
```

9. Clean up temporary branch.

```bash
git branch -d sync/upstream-<YYYY-MM-DD>
```

## Conflict Handling Policy

- Preserve fork scope boundaries from [docs/specs/00.project-direction.md](/Users/polarzero/code/projects/origin/docs/specs/00.project-direction.md).
- If upstream reintroduces removed non-desktop surface, keep it removed unless an approved phase spec says otherwise.
- If an upstream change is useful but conflicts with deleted areas, prefer targeted cherry-picks over restoring large removed subsystems.

## Optional Quality-of-Life Setup

Enable Git conflict resolution reuse:

```bash
git config rerere.enabled true
```

## Agent Invocation Contract

When asked to "follow sync-fork guide to sync to remote", execute the `Standard Sync Procedure` end-to-end and report:

- upstream commit merged
- conflicts and how each was resolved
- validation commands and outcomes
- resulting `dev` commit pushed to `origin`
