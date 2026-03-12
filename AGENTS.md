- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev` and it is the integration base for fork work.
- Track upstream changes from `upstream/dev` as read-only input only.
- Never commit directly on `upstream/dev` and never target it as the base branch for fork feature work.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Repo Context (Read First)

- Start with [docs/specs/00.project-direction.md](/Users/polarzero/code/projects/origin/docs/specs/00.project-direction.md) for the fork's current direction and scope boundaries.
- Follow [docs/specs/GUIDE.md](/Users/polarzero/code/projects/origin/docs/specs/GUIDE.md) for the required phase `.spec`/`.log` workflow.
- Keep work scoped to native desktop goals unless a phase spec explicitly expands scope.
- Treat `docs/specs/00.project-direction.md` as a living baseline: when a phase changes direction or scope boundaries, update it in the same phase/PR.
- Direction-change triggers include new defaults, guardrails, namespace boundaries, startup behavior, import policy boundaries, or product naming rules.
- Keep `docs/specs/00.project-direction.md` concise and direction-only: summarize stable outcomes and link phases; keep implementation detail in phase `.spec`/`.log`.

## Fork Sync (On Demand)

- Only load [docs/sync-fork/GUIDE.md](/Users/polarzero/code/projects/origin/docs/sync-fork/GUIDE.md) when the task explicitly asks to sync this fork with upstream.
- Do not load `docs/sync-fork/GUIDE.md` for unrelated implementation tasks.

## Child Agents

- Use child agents as much as possible when relevant to preserve the current agent's context; offload independent, bounded sidecar work so the parent agent stays focused on the critical path and keeps tight, task-relevant context because context fills quickly.
- Do not pass the `model` field to `spawn_agent`. Let child agents inherit the current agent's model automatically.
- Prefer spawning child agents for independent, bounded sidecar work that can run in parallel.
- Do not delegate the immediate blocking step on the critical path.
- Do not spawn child agents for trivial tasks, single-file edits, or work that depends on tight shared context.

## Commits

- Use Conventional Commits format: `<type>(<scope>): <description>` (scope optional).
- Keep commit messages concise and technical.
- Do not use emojis in commit title or body.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
