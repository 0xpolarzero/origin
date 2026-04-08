# AGENTS

## Commits
- Use Conventional Commits.

## Orchestration
- Keep one main orchestrator responsible for strategy, integration, and final decisions.
- Use subagents as short-lived general workers, not persistent role-based agents.
- Give each subagent one bounded action sequence with clear inputs and a clear completion boundary.
- Subagents should return an episode, not a chat summary: durable conclusions, artifacts, verification, and unresolved issues.
- Reuse episodes as inputs to later work instead of passing full histories around.
- Decompose work implicitly and adaptively; avoid rigid task trees, stale plans, and over-decomposition.
- Prefer expressive tools with step-by-step feedback over brittle one-shot scripts or message-only handoffs.
- Parallelize only independent workstreams, then reconcile their episodes in the main thread.

## References
- `docs/references/` contains submodules of the libraries and tools we use heavily.
- Use those submodules as the primary reference for how those libraries and tools work.
- Every important library or tool used by the app should be represented in `docs/references/`.

## Build Order
This app is being built in stages:
1. Build the internal docs in `docs/`.
2. Write all tests for all features.
3. Implement the app code to make the docs and tests pass.
- The user decides when to move from one stage to the next.
