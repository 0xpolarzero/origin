# Repository Instructions

- Use Conventional Commits for commit messages, for example `feat: add search filters` or `fix: handle empty state`.
- Keep changes focused on the requested task.
- Prefer existing project patterns over introducing new conventions.
- Do not add or preserve legacy, backwards-compatibility, migration, compatibility, or schema-bridge code or docs unless the user explicitly asks for it.
- When a design changes, delete obsolete paths rather than keeping fallback behavior, one-off migrations, compatibility aliases, legacy fixtures, or dual-schema support.

## MVP Docs

- `docs/mvp.design.md` is the high-level architecture and product design rationale.
- `docs/mvp.specs.md` is the detailed technical specification and implementation contract.
- `docs/mvp.progress.md` is the slice-by-slice checklist and current implementation plan.

For implementation work, read `docs/mvp.progress.md` first, then `docs/mvp.specs.md`, then `docs/mvp.design.md` when broader context is needed.
