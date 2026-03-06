# Future Design Notes (Deferred Scope)

## Purpose

This document tracks intentionally deferred product requirements that remain out of scope even after the graph-first workflow redesign. These notes are design input for future phase specs.

## Status

- Status: Deferred
- Date: 2026-03-06
- Related baseline:
  - [PRD.agentic-workflows-and-automation.md](/Users/polarzero/code/projects/origin/docs/drafts/PRD.agentic-workflows-and-automation.md)
  - [DESIGN.graph-first-workflows-and-runtime.md](/Users/polarzero/code/projects/origin/docs/drafts/DESIGN.graph-first-workflows-and-runtime.md)
  - [15.graph-first-workflow-orchestration.spec.md](/Users/polarzero/code/projects/origin/docs/specs/15.graph-first-workflow-orchestration.spec.md)

## 1) Sandboxing for Agent Execution

## Why This Matters

Workflow automation and integrations increase the blast radius of file access, command execution, and data exfiltration. Sandboxing remains necessary, but it is intentionally not part of the v1 graph-first workflow revamp.

## Future Requirements

1. Define sandbox profiles by run context:
   - manual chat
   - workflow builder session
   - workflow edit session
   - workflow manual trigger
   - cron/signal trigger
   - debug/reconciliation session
2. Restrict filesystem access by workspace boundary and explicit allowlists.
3. Restrict network access with integration-aware allowlists.
4. Make permission behavior visible to users in settings and run metadata.
5. Provide deterministic enforcement tests for sandbox boundaries.

## 2) Workflow Pause/Input Nodes

## Why This Matters

Some workflows will eventually need structured user decisions mid-run. The product should not fake this as an ordinary chat message or silently choose defaults.

## Future Requirements

1. Define a first-class pause/input node contract.
2. Link each request to workflow, run, node, and any relevant session artifact.
3. Support structured user choices, not free-form text only.
4. Define timeout and fallback behavior explicitly.
5. Add notification and inbox UX for pending input requests.

## 3) Advanced Workflow Graph Scope

## Why This Matters

The v1 graph-first model is intentionally constrained. More expressive orchestration features should not be added casually because they change runtime guarantees and UI complexity.

## Future Requirements

1. Subworkflows.
2. Runtime-generated nodes or topology.
3. Visual rule-builder authoring for conditions.
4. User-authored explicit join nodes or advanced merge policies.
5. More powerful structured inputs than the initial typed-form set.

## 4) Input Request UX Surface

## Future Requirements

1. Add an inbox-style surface for pending input requests.
2. Provide quick actions from notification and from inbox.
3. Allow opening the linked workflow/run surface or linked session before deciding.
4. Track request lifecycle states:
   - pending
   - answered
   - timed_out
   - canceled
5. Keep historical visibility for resolved requests.

## 5) Integration Policy Expansion

## Why This Matters

The Drafts and policy model already defines safe outbound behavior, but policy authoring and simulation will need stronger product surfaces once workflows become more powerful.

## Future Requirements

1. Per-integration policy editor for action classes and destination constraints.
2. Policy simulation or dry-run checks.
3. Policy audit logs and change history.
4. Safer defaults for new integrations.

## 6) Advanced Run Observability

## Why This Matters

The v1 design recommends deriving most run frames on read and persisting milestone snapshots only if needed. That is the correct default for now, but more granular observability may become necessary for advanced debugging later.

## Future Requirements

1. Decide whether full frame persistence is necessary beyond milestone frames.
2. Define retention and pruning policy for bulky raw logs, artifacts, and transcripts.
3. Add explicit export surfaces for advanced run-debug bundles.

## Constraint

These items are intentionally out of scope for the current workflow revamp and must not be implemented until a numbered phase spec is approved under [GUIDE.md](/Users/polarzero/code/projects/origin/docs/specs/GUIDE.md).
