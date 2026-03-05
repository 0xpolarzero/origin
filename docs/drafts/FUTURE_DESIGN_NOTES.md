# Future Design Notes (Deferred Scope)

## Purpose

This document tracks intentionally deferred product requirements that are important but out of current implementation scope. These notes are design input for future phase specs.

## Status

- Status: Deferred
- Date: 2026-03-04
- Related baseline: [PRD.agentic-workflows-and-automation.md](/Users/polarzero/code/projects/origin/docs/PRD.agentic-workflows-and-automation.md)

## 1) Sandboxing for Agent Execution

## Why This Matters

Automation and integrations increase risk surface. Sandboxing is required to reduce blast radius for file access, command execution, and data exfiltration.

## Future Requirements

1. Define sandbox profiles by run context:
   - manual chat
   - workflow manual trigger
   - cron/signal trigger
   - debug/reconciliation session
2. Restrict filesystem access by workspace boundary and explicit allowlists.
3. Restrict network access with integration-aware allowlists.
4. Make permission behavior visible to users in settings and run metadata.
5. Provide deterministic enforcement tests for sandbox boundaries.

## 2) Agent-Initiated User Input Requests

## Why This Matters

Some workflows may require missing user decisions or preferences. Automated runs must not deadlock or silently choose unsafe options.

## Future Requirements

1. Define a first-class "Input Request" object with:
   - prompt text
   - context summary
   - expiration policy
   - fallback policy (if any)
2. Add user notification UX for new input requests.
3. Support multi-option choices as structured actions, not free-form text only.
4. Allow agent-provided recommended option with short rationale.
5. Link each request to session, run, and workflow.
6. Define behavior for unattended runs:
   - pause run and wait
   - skip run
   - deterministic fallback (only when allowed by policy)

## 3) Input Request UX Surface

## Future Requirements

1. Add an inbox-style surface for pending input requests.
2. Provide quick actions from notification and from inbox.
3. Allow opening the linked session to discuss before deciding.
4. Track request lifecycle states:
   - pending
   - answered
   - timed_out
   - canceled
5. Keep historical visibility for resolved requests.

## 4) Integration Policy Expansion

## Why This Matters

Current Drafts + policy model defines allowed outbound classes and destinations, but policy authoring UX and enforcement depth should evolve.

## Future Requirements

1. Per-integration policy editor for action classes/destination constraints.
2. Policy simulation or dry-run checks.
3. Policy audit logs and change history.
4. Safer defaults for new integrations.

## 5) Deferred Clarifications to Resolve in Future Specs

1. Exact interaction between sandbox levels and auto-approve policies.
2. Whether some integration actions can bypass drafts under strict policy + sandbox.
3. Required telemetry and privacy boundaries for issue reports.
4. UI terminology for input requests and prompts.

## Constraint

These items are intentionally out of scope for the current phase and must not be implemented until a numbered phase spec is approved under `docs/specs/GUIDE.md`.

