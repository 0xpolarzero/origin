# PRD: Origin Graph-First Workflows and Automation

## Document Status

- Status: Draft for product and implementation alignment
- Date: 2026-03-06
- Product: `origin` native desktop app
- Audience: Product, design, engineering
- Execution note: this PRD is product direction input. Implementation must still be planned and executed through numbered phase specs and logs in [GUIDE.md](/Users/polarzero/code/projects/origin/docs/specs/GUIDE.md).

## Summary

Origin should stop treating workflows as "a prompt that creates a session and happens to run some automation." A workflow should instead be a graph-first automation program with reusable local resources, reusable shared library items, explicit execution structure, and inspectable run history.

The authoring entrypoint should be AI-first. Users should usually start by describing the workflow they want to an agent. That agent should create and refine the workflow definition, supporting workflow-local resources, and shared library resources as needed. The primary editing surface should then be the workflow graph itself, with direct node editing and scoped AI editing available from the graph.

The execution entrypoint should be snapshot-first. Each run should execute one immutable fully resolved workflow snapshot and render the same workflow graph the user authored, but with live and historical results overlaid. Sessions remain valuable, but only as linked artifacts inside this model: builder chats, scoped node-edit chats, node execution transcripts, and run follow-up chats.

## Problem Statement

Origin's current workflow direction is still too session-first. The existing execution model assumes one top-level run session, the main history surfaces are centered on runs and operations rather than on the workflow graph, and the product does not yet distinguish clearly between:

- the workflow definition a user authored
- the in-progress edits an agent makes while refining it
- the exact immutable version that a run actually executed

That produces the wrong mental model for real workflows. Users need to reason about scripts, agent requests, branches, loops, reusable resources, outputs, and retries as parts of one executable graph. A single session thread is not a sufficient container for that.

This becomes more problematic as workflows become more capable:

- one workflow may need multiple agent requests, not one main chat
- multiple steps may run in parallel and touch overlapping files
- one run may need retries, reconciliation, and partial reruns from a failed point
- users need to inspect old runs against the exact graph that actually executed, even after the workflow changes later

Without a graph-first model, Origin risks turning "workflow automation" into a collection of opaque chat sessions with weak explainability and poor reuse.

## Why This Matters

Users want automation they can trust and understand.

They want to:

- describe a workflow once and reuse it safely
- inspect the structure of a workflow without reading a long chat transcript
- click into any step and understand what code ran, what an agent was asked, and what happened
- rerun only the failed portion of a workflow without losing the rest of the run context
- reuse scripts, prompts, and queries across workflows without giving up local edits
- understand the difference between the current workflow definition and the version that ran yesterday

If Origin gets this right, workflows become a durable product surface rather than a thin wrapper around chat.

## Inherited Platform Constraints

This PRD does not replace the broader direction already established in earlier phases. The following remain true:

- Origin remains desktop-first and local-first.
- Runtime state remains database-backed.
- File mutations remain JJ-tracked and restorable through the app's existing runtime model.
- Outbound effects still route through the Draft and Dispatcher model.
- Signals and integrations remain Origin-workspace capabilities, not standard-workspace capabilities.
- The app can remain session-first overall outside the dedicated Workflows and Runs surfaces.

## Product Principles

1. Workflow-first, not session-first. The workflow graph is the primary unit of automation.
2. AI-first authoring. The default way to build workflows is by talking to an agent with the right scoped context.
3. One source of truth. The workflow file on disk is canonical. Graph editing, AI editing, and manual file editing all operate on the same underlying definition.
4. Snapshot integrity. Every run executes one immutable fully resolved snapshot.
5. Sessions as artifacts. Sessions are linked tools for authoring, execution detail, and follow-up, not the workflow container.
6. Reuse without rigidity. Workflows may use local resources or shared library items, and AI may promote useful local resources into the shared library.
7. Auditability without clutter. History should stay sparse and readable at the top level, with rich nested detail on demand.
8. Desktop guardrails remain. Nothing in this workflow revamp expands Origin into cloud, multi-user, or web-first scope.

## Goals

1. Make workflows graph-first in both authoring and execution.
2. Make AI the primary in-app workflow authoring and refinement path.
3. Preserve manual file editing and direct graph editing as first-class escape hatches.
4. Reuse the current session UI and runtime systems where they fit, especially for agent transcripts and detailed node inspection.
5. Support immutable run snapshots, deterministic reruns, and deterministic parallel-branch reconciliation.
6. Keep global history coherent by adding workflow-native history rather than replacing runs, operations, and drafts.
7. Let workflows create and reuse shared library items freely, while making impact and usage visible.

## Non-Goals

1. Replacing the entire app shell with workflows as the default home surface.
2. Cloud-hosted or multi-user workflow execution.
3. Subworkflows, runtime-generated graph topology, or open-ended dynamic orchestration in v1.
4. Interactive approval/input pause nodes in v1.
5. Full sandboxing in this phase.
6. A separate draft/publish model for workflow definitions in v1.

## Target Users

### Primary

- Individuals using Origin as a local personal operations app.
- Users who want the power of automation but do not want to author everything manually.

### Secondary

- Power users who will inspect run history deeply, edit workflow files directly, and curate reusable scripts, prompts, and queries.

## Scope by Workspace Type

### Origin Workspace

Origin workspaces support the full workflow model, including:

- manual workflows
- cron and signal workflows when those trigger phases are implemented
- integrations and outbound drafts
- reusable shared library items

### Standard Workspace

Standard workspaces keep the graph-first workflow model, but remain constrained by the earlier capability rules:

- no integrations
- no signal triggers
- no outbound drafts
- no capability expansion beyond earlier approved phases

## Core Product Model

### Workflow

A workflow is a graph-first YAML definition stored on disk. It orchestrates code execution, agent requests, branching, looping, validation, integration drafting, and reusable resources.

### Workflow Revision

An immutable saved authored state of a workflow. A workflow has one live revision at a time.

### Workflow Edit Session

A session linked to exactly one workflow for authoring or refinement. One workflow edit session may create multiple checkpoints and may publish multiple live revisions over time.

### Checkpoint

A session-local recovery and compare point inside one workflow edit session. Checkpoints are not top-level history rows in v1.

### Workflow-Local Resource

A script, prompt, query, or other supporting artifact owned by a single workflow and stored alongside the workflow definition as sibling files.

### Shared Library Item

A reusable library resource available to multiple workflows, with `used by` visibility and its own history.

### Run Snapshot

The immutable fully resolved execution input for a run. It freezes the workflow revision, workflow-local resources, exact shared-library content, and the run input together.

### Run

One execution of one snapshot plus one input.

### Run Node

One executable graph item instance inside a run. Nodes include user-authored steps and system steps such as reconcile.

### Session Artifact

A linked session used for one specific role inside the workflow model:

- `builder`
- `node_edit`
- `execution_node`
- `run_followup`

### Operation

The existing runtime record for file-change effects remains. Operations should be attributable to specific run nodes when possible.

### Draft

The existing outbound proposal record remains. Drafts should also be attributable to specific run nodes when possible.

## Workflow Authoring Experience

### AI-First Builder

The default way to create a workflow should be:

1. User chooses `Build workflow with AI`.
2. Origin opens a workflow builder surface with chat and a live graph.
3. The agent gathers relevant workflow and library context lazily.
4. The agent creates or edits the workflow file and supporting resources.
5. The graph updates after each applied save/checkpoint.

This is not a separate toy builder. It should create the real workflow definition and real resources on disk.

### Graph-Primary Editing

The workflow page should be graph-primary, not chat-primary. Chat is docked into the workflow page and supports continued refinement, but the graph remains the main authoring surface.

Users should be able to:

- click a node and inspect its details
- edit node configuration directly
- add, delete, and reconnect nodes for basic structural edits
- ask AI to modify a node or the whole workflow
- keep working in the original builder session or open new scoped edit sessions

### AI and Manual Editing Should Converge

Manual file edits, direct graph edits, and AI edits must all converge on the same canonical workflow file and related resource files. Origin must not create separate hidden workflow states depending on how the user edited.

Workflow edit sessions are intent-scoped to one workflow, not sandboxed to workflow files. They may still touch other workspace files, and workflow edit history should surface those broader effects explicitly.

### Save Model

In v1, `save == live`. There is no separate draft/publish concept for workflow definitions.

Workflow edit sessions may still create internal checkpoints, but future runs use the latest saved live revision.

### Runs Start From Live Revisions in V1

In v1, runs should start from live revisions only. Checkpoints are for recovery, comparison, and nested history inside the workflow edit session. They are not alternate runnable drafts in v1.

## Resource Model

### Local and Shared Resources

Nodes may reference either:

- workflow-local resources
- shared library items

The default behavior should be pragmatic:

- AI should inspect relevant shared library items before creating new resources.
- AI may create workflow-local resources when reuse is not obvious.
- AI may promote local resources into the shared library when reuse looks likely.
- Shared library items remain live dependencies for future runs.
- Old runs remain frozen because the run snapshot stores exact shared-library content.

### Shared Resource Editing

When a user edits a shared resource from a workflow node, Origin should surface `used by` and offer:

- edit the shared item
- create a workflow-local copy

AI may directly edit shared library items when it judges that a shared change is the correct outcome, but those edits must be explicit in history and library item detail views.

## Execution Experience

### First-Class V1 Node Types

V1 workflow graphs should support:

- script/code execution
- agent request
- condition/branch
- parallel block
- loop block
- validation/end
- integration draft/send action where allowed by existing outbound rules

V1 should not support interactive approval/input pause nodes, subworkflows, or runtime-generated nodes.

### Same Graph for Design and Run

The run page should render the same graph structure as the design page, but with runtime results overlaid:

- status
- outputs
- logs
- transcripts
- artifacts
- timings
- retries
- failures
- skipped paths

Unreached or skipped paths should remain visible but dimmed with reasons such as `not taken`, `upstream failed`, or `downstream invalidated`.

### Rerun Behavior

V1 rerun actions should be:

- `Rerun workflow`
- `Rerun from here`

`Rerun from here` means:

- create a new run
- reuse the same workflow snapshot and same input
- keep valid upstream results
- invalidate downstream dependents
- recompute from the selected failed node or block forward

### Parallel Mutation Model

Parallel branches may both mutate files, including overlapping files. Prompt guidance alone is not sufficient for correctness.

The runtime model should instead be:

- each parallel branch starts from the same base snapshot
- each branch executes in isolation
- an implicit join happens at the end of the block
- one reconcile pass runs on merge conflict
- if reconcile fails, the block fails deterministically

Reconcile should appear as a visible system node in the run graph.

### Inputs

Manual runs should support typed inputs in v1. The initial set should stay simple:

- text
- long text
- number
- boolean
- select
- file/path pick

## Sessions and Visibility

Sessions remain valuable, but not as the workflow container.

Recommended session roles:

- `builder`
- `node_edit`
- `execution_node`
- `run_followup`

Visibility should be role-based, not derived from `parent_id`.

- `builder` and `node_edit` sessions are workflow-local by default.
- `execution_node` sessions are run-local by default and open from node detail.
- `run_followup` is persistent per run and opens from the run page.
- Power users may still open any linked session in the normal session view.

## Navigation and History

### Primary Surfaces

The app may remain session-first overall, but workflows need dedicated graph-first surfaces:

- `/:dir/workflows/:workflowId`
- `/:dir/runs/:runId`
- `/:dir/library/:itemId`

### Workflow Page

Workflow detail should default to `Design` and include:

- `Design`
- `Runs`
- `Edit History`
- `Resources`

### Run Page

Run detail should default to graph + summary. Node detail should open in a side panel and be deep-linkable by URL.

### History

Global history should keep:

- `Runs`
- `Operations`
- `Drafts`

And add:

- `Workflow Edits`

Workflow edit history should be one top-level row per workflow edit session, with checkpoints nested inside the detail view for that session.

## Notifications

Long-running or completed workflow execution notifications should deep-link to the workflow or run surface, not to hidden execution sessions.

## Safety and Invariants

1. The workflow file on disk is canonical.
2. Every run executes one immutable fully resolved snapshot.
3. Past runs never silently adopt later workflow edits or later shared-library edits.
4. Workflow runs do not rewrite workflow definitions or library items by default.
5. `save == live` in v1 for workflow definitions.
6. One workflow edit session may publish multiple live revisions over time.
7. History stays sparse at the top level and detailed on drill-down.
8. The app continues to reuse existing session, runtime, draft, and JJ foundations where they still fit.

## Success Measures

This direction succeeds when:

- users can create and refine workflows primarily through the graph-first workflow surface instead of ad hoc chat-only flows
- users can inspect a run without needing one main session transcript to understand it
- rerun and recovery behavior is understandable at the graph level
- shared-library reuse grows without making library ownership opaque
- workflow edit history remains readable even when AI creates multiple internal checkpoints

## Deferred Scope

The following are intentionally deferred after this PRD:

- interactive approval/input pause nodes
- subworkflows
- runtime-generated graph topology
- full visual rule-builder authoring for conditions
- full sandboxing and permission profiles

Deferred details remain tracked in [FUTURE_DESIGN_NOTES.md](/Users/polarzero/code/projects/origin/docs/drafts/FUTURE_DESIGN_NOTES.md).
