# Agent Guide: Phase Specs and Logs

This guide defines how agents should document work in `docs/` so every phase is consistent and easy to audit.

## Purpose

Use this flow when a human discusses a feature/change with an agent and asks to produce a PRD/spec for a phase.

The workflow is intentionally split:

1. Planning phase: human + planning agent co-author the spec.
2. Implementation phase: a separate implementation agent executes the spec.
3. Completion phase: the implementation agent produces the phase log.

For each phase, agents produce two documents:

1. A spec (plan before implementation)
2. A log (facts after implementation)

## Critical Spec Authoring Rules

These rules apply when a human asks an agent to generate a spec.

- Push back on anything unclear, contradictory, or underspecified.
- Ask clarifying questions until scope, constraints, and success conditions are explicit.
- Do not write a "ready to implement" spec from vague assumptions.
- If an assumption is unavoidable, mark it explicitly in `## Baseline Assumptions` and call out the risk.
- Treat ambiguity as a blocker, not as permission to guess.
- Do not finalize the spec until unresolved ambiguities are clarified or explicitly accepted as written assumptions.

## Naming Convention

Use zero-padded phase numbers and a shared slug.

- Spec: `NN.<slug>.spec.md`
- Log: `NN.<slug>.log.md`

Examples:

- `01.native-app-pruning.spec.md`
- `01.native-app-pruning.log.md`

Rules:

- `NN` starts at `01` and increments by 1 per new phase.
- `<slug>` is short, lowercase, and hyphenated.
- Spec and log files for the same phase must use the exact same `NN` and `<slug>`.

## File Lifecycle

1. Human and planning agent create the spec first.
2. Implementation agent reads the spec and implements the phase according to it.
3. Implementation agent creates the log with timestamp, commands, changed files, deviations from spec, and validation results.

Handoff rule:

- The implementation agent must treat `NN.<slug>.spec.md` as the source of truth for scope, validation, and acceptance criteria.
- At the end of implementation, producing `NN.<slug>.log.md` is mandatory.

## Required Spec Structure

Each `NN.<slug>.spec.md` must include these sections in this order:

1. `# NN Spec: <Title>`
2. `## Goal`
3. `## Why This Phase Exists`
4. `## In Scope`
5. `## Out of Scope`
6. `## Baseline Assumptions`
7. `## Required Keep Set` (if pruning/selection applies)
8. `## Deletion Candidates` (if pruning applies)
9. `## Evidence Anchors` (files or references that justify assumptions)
10. `## Agent Execution Plan` (step-by-step)
11. `## Acceptance Criteria`
12. `## Risk Register`

Notes:

- Keep wording specific and testable.
- Include concrete commands in plan/validation sections when possible.
- If a section does not apply, keep the heading and write `Not applicable` with a short reason.
- `## Acceptance Criteria` is the most important section for implementation correctness.

## Validation and Acceptance Quality Bar

Validation and acceptance criteria must be bullet-proof. This is the primary mechanism to verify implementation quality.

- Every acceptance criterion must be objective, binary, and reproducible.
- Every validation item should include:
  - exact command/check to run
  - expected output or observable result
  - explicit pass/fail condition
- Cover functional correctness, regressions, and critical risks from the spec.
- If a criterion is not measurable, rewrite it until it is measurable.
- The implementation agent should be able to determine "done" from this section alone.

## Required Log Structure

Each `NN.<slug>.log.md` must include:

1. `# NN Execution Log`
2. Timestamp (UTC ISO-8601)
3. Branch
4. `## Commands Run`
5. `## Files Removed` (or `None`)
6. `## Files Edited` (or `None`)
7. `## Deviations from Spec` (or `None`)
8. `## Validation`
9. `## Open Risks`

Validation format:

- One line per check with `PASS` or `FAIL`.
- For failures, include exact reason/blocker.

## Updating Existing Docs

When changing naming conventions or phase structure:

- Rename existing files to this convention.
- Update internal links/references to renamed files.
- Preserve historical facts; only adjust wording/headers where needed for consistency.

## Agent Operating Rules

- Do not mix planning and log facts in one section.
- Keep commands and outcomes factual; do not hide failed steps.
- If you are generating a spec, challenge unclear requirements immediately and resolve them before finalizing.
- If implementation differs from plan, capture that in `## Deviations from Spec` in the log.
- Prefer additive updates over rewriting history.
- If you are the implementation agent, do not finish the task without creating/updating the phase log file.

## Quick Start Template

Use this checklist for a new phase:

- Pick next phase number `NN`.
- Define slug `<slug>`.
- Interrogate unclear requirements first; finalize nothing until scope and success criteria are explicit.
- Create `docs/NN.<slug>.spec.md` with required sections.
- Implement work.
- Create `docs/NN.<slug>.log.md` with required log facts.
- Update `docs/README.md` phase list.
