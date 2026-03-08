# origin Design Overview

origin is a native desktop app for turning AI into a personal operations system for local work. It gives one place to capture requests, build reusable workflows, run them safely against real files, review what changed, and control any action that would leave the machine. The goal is to make AI automation feel as understandable and inspectable as good engineering tooling, not like an opaque chat transcript.

## What Makes origin Different

- Workflow-first automation. The final product centers workflows, not single chat threads. Users should be able to describe a workflow in plain language, let an agent build it, then inspect and refine it as a graph of scripts, agent steps, conditions, parallel branches, loops, validation, and outbound actions.
- Real local source of truth. Workflows and supporting resources live on disk in the workspace. AI edits, direct graph edits, and manual file edits all converge on the same files instead of creating hidden app-only state.
- Protected home workspace. origin always has a stable global workspace (`~/Documents/origin` by default) that works like an inbox and launch point, while still supporting other local workspaces and projects.
- Reusable knowledge and resources. A workflow can use workflow-local resources or shared library items, so prompts, scripts, and queries can graduate from one-off helpers into reusable building blocks.
- Deterministic execution. Every run should execute an immutable snapshot of the workflow and its resources, making old runs explainable even after the workflow changes later.
- Safe change application. Runs happen in isolated workspaces, their changes are tracked, and integration back into the main workspace is queued and recovery-aware rather than optimistic and invisible.
- Outbound actions by draft, not by surprise. If an agent wants to send a message, create an issue, or perform another external write, origin turns that action into a draft that can be reviewed, edited, approved, and sent through policy checks.
- Clear history and escalation. Runs, operations, and drafts are first-class history objects. Debug and reconciliation activity stays hidden by default, but can be surfaced when needed and escalated into structured system reports.

## Core Experience

The intended experience is simple: start from a thought, not from infrastructure. A user can capture work quickly in the global workspace, refine it into a reusable workflow, run it manually or, in origin workspaces, automatically, and inspect exactly what happened at each stage. Sessions still matter, but as linked artifacts inside the larger system: builder chats, node-level edit sessions, execution transcripts, and follow-up conversations attached to real workflows and real runs.

In the finished app, workflows are graph-first and AI-first at the same time. The graph is the main surface; chat is there to help author and refine it, not to hide it. That gives origin a clear product position: a local desktop control plane for trustworthy AI work.

## Current Product Baseline

Today's app already exposes the protected global-workspace model, session-based agent work, provider and model settings, explicit OpenCode import for provider auth and model visibility, separate `Workflows` and `Library` views for validation status, and a `History` surface for runs, operations, and outbound drafts. Manual runs, queued integration, draft review/send controls, cron and signal-triggered execution, debug reporting, and the security/governance guardrails are part of the implemented platform foundation. Full automation capabilities remain intentionally scoped to origin workspaces; standard workspaces stay narrower.

The biggest approved next step is to move workflows from a validation-and-runtime foundation into the full graph-first product model: dedicated workflow pages, dedicated run pages, immutable run snapshots, richer reusable resources, AI-first workflow building, and rerun-from-here execution. That shift should change the app from "a chat tool with automation features" into "a desktop app for building, operating, and supervising AI workflows."
