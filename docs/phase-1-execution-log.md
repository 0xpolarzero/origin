# Phase 1 Execution Log

- Timestamp (UTC): `2026-03-01T17:24:32Z`
- Branch: `dev`

## Commands Run

```bash
git branch --show-current
git status --short
ls -1 packages
cat package.json
cat turbo.json
rm -rf infra github nix script sdks/vscode
rm -rf packages/web packages/docs packages/storybook packages/containers
rm -rf packages/slack packages/extensions packages/identity
rm -rf packages/function packages/console packages/enterprise
rg -n "packages/(web|docs|storybook|containers|slack|extensions|identity|function|console|enterprise)|sdks/vscode|(^|[^a-zA-Z])infra(/|$)|(^|[^a-zA-Z])github(/|$)|(^|[^a-zA-Z])nix(/|$)|(^|[^a-zA-Z])script/" package.json turbo.json bunfig.toml tsconfig.json
rg -n "packages/(web|docs|storybook|containers|slack|extensions|identity|function|console|enterprise)|sdks/vscode|(^|[^a-zA-Z])infra(/|$)|(^|[^a-zA-Z])github(/|$)|(^|[^a-zA-Z])nix(/|$)|(^|[^a-zA-Z])script/" packages/desktop packages/app packages/ui packages/opencode packages/sdk/js packages/util packages/plugin packages/script
bun install
bun run --cwd packages/opencode build
bun run --cwd packages/app build
bun run --cwd packages/desktop build
bun run dev:desktop
```

## Files Removed (Directory Roots)

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

## Files Edited

- `package.json` (workspace pruning)
- `bun.lock` (install/lockfile update after workspace changes)
- `docs/phase-1-native-app-pruning.md` (decision/outcome update)
- `docs/phase-1-execution-log.md` (this log)

## Validation

- `bun install`: `PASS` (ran with escalation due sandbox tempdir restriction)
- `bun run --cwd packages/app build`: `PASS`
- `bun run --cwd packages/desktop build`: `PASS`
- `bun run --cwd packages/opencode build`: `FAIL`
  - Reason: network access to `https://models.dev/api.json` was refused in this environment.
- `bun run dev:desktop`: `FAIL`
  - Reason: desktop predev calls `packages/opencode` build and fails on the same `models.dev` network fetch.

## Open Risks

- Desktop local startup is currently coupled to external `models.dev` reachability during `packages/opencode` build.
