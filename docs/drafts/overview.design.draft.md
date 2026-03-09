# origin Design Overview

origin is a native desktop app for turning AI into a personal operations system for local work. Its center of gravity is not just automation, but a main `origin` workspace where a quick thought can become the right kind of action: a task, a calendar item, an integration-backed flow, a note, or a reusable workflow. The goal is to make AI feel like an understandable local operator, not an opaque chat box.

## What origin Is

origin has two product modes that should feel like one system.

The first is the main `origin` workspace, stored in `~/Documents/origin` by default. This is the personal control surface: quick entry, tasks, calendar, integrations, recurring jobs, signals, notes, reusable resources, and activity history. A user should be able to drop in a thought like "remind me to answer this tomorrow", "watch GitHub issues with this label", or "every morning summarize my agenda", and the app should determine what to create or update.

The second is any other local workspace the user opens. Those workspaces are for acting on real files and projects with the same agent/runtime foundation: sessions, reusable scripts and prompts, workflows, runs, changes, and history. In that sense, the `origin` workspace is the personal operations hub, while other workspaces are focused execution environments.

## What Makes origin Different

- Entry-first interaction. The fastest path starts with a quick entry, not with choosing a feature first. The agent should interpret a thought and route it into the right system surface: task, calendar, workflow, note, or integration action.
- A real personal workspace. The main `origin` workspace is meant to be a first-class product surface, not just a hidden default folder. It is where tasks, calendar views, recurring jobs, signals, integrations, and agent-authored personal operations live together.
- Workflow-first automation where structure matters. When work becomes repeatable or multi-step, origin turns it into a reusable workflow that can be inspected, edited, and eventually operated as a graph instead of buried inside a chat.
- Real local source of truth. Workflows and supporting resources live on disk in the workspace. AI edits, direct graph edits, and manual file edits all converge on the same files instead of creating hidden app-only state.
- Reusable knowledge and resources. Scripts, prompts, queries, and library items can move from one-off helpers into reusable building blocks that power both personal operations and project work.
- Safe local execution. Runs happen in isolated workspaces, changes are tracked, and integration back into the main workspace is queued and recovery-aware rather than optimistic and invisible.
- Outbound actions by draft. If an agent wants to send a message, create an issue, or perform another external write, origin turns that action into a reviewable draft with policy checks and explicit send control.
- Clear history and reversibility. Runs, operations, drafts, and activity are visible objects. Debug and reconciliation stay hidden by default, but when needed they can be surfaced, inspected, and escalated through structured system reports.

## Core Experience

The intended experience starts from capture. A user enters something once, in plain language, and origin figures out the right level of structure. Some entries should stay simple and become tasks, calendar items, or notes. Some should connect to integrations or signals. Some should become recurring jobs. Some should grow into reusable workflows.

That is why workflows matter, but they are not the whole product. They are the structured automation layer inside a broader personal operations app. In the finished system, the `origin` workspace gives users a daily control plane for what they need to track, react to, and delegate, while other workspaces let the same runtime operate directly on local projects and files.

## Current Product Baseline

Today's app already exposes the protected global-workspace model and the global entry session flow, plus session-based agent work, provider and model settings, explicit OpenCode import for provider auth and model visibility, separate `Workflows` and `Library` views for validation status, and a `History` surface for runs, operations, and outbound drafts. Manual runs, queued integration, draft review/send controls, cron and signal-triggered execution, debug reporting, and the security/governance guardrails are part of the implemented platform foundation.

The larger personal-operations surface for the main `origin` workspace, especially tasks, calendar, richer integration views, and a more opinionated quick-entry experience that routes thoughts into those systems, is part of the intended product direction but not yet fully expressed in the current app shell. The biggest workflow-specific next step is to move automation from a validation-and-runtime foundation into the full graph-first model: dedicated workflow pages, dedicated run pages, immutable run snapshots, richer reusable resources, AI-first workflow building, and rerun-from-here execution.
