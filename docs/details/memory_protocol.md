# Origin Memory Protocol

## Status

- Working draft
- Last updated: 2026-04-06
- Purpose: define how agents should use memory in Origin without requiring rigid schemas

## Goal

Origin should systematize memory behavior, not prematurely systematize memory schemas.

Origin has a managed workspace root. That root is scoped to the active Origin peer/instance rather than being a profile-global path. In v1, that workspace root is also the markdown vault that participates in the replicated note model.

The agent should know how to:

- decide what deserves durable memory
- keep memory concise and useful
- create supporting files or datasets when a topic becomes large or recurrent
- link those supporting artifacts from memory
- avoid turning transient context into noisy persistent state

## Core Model

Origin memory has three layers:

1. Raw working context
- chats
- notes
- tasks, calendar items, projects, labels
- selectively cached external context

2. Curated memory index
- `Origin/Memory.md`
- this is the canonical memory object in v1
- it should stay high-signal and relatively concise
- it lives inside the managed workspace root and is part of the replicated note model

3. Supporting memory artifacts
- files, folders, or datasets created when needed
- referenced from `Origin/Memory.md`
- format chosen pragmatically by the agent
- may live either as replicated markdown notes, replicated managed note attachments, or as ordinary local workspace artifacts, depending on whether Origin explicitly manages them as replicated state

A replicated managed note attachment is a file that Origin has explicitly attached to a managed note or explicitly imported as note-managed supporting content inside the managed workspace root.

An ordinary local workspace artifact is any file, folder, or dataset inside the managed workspace root that Origin has not explicitly imported into the managed note set.

`Origin/Memory.md` is not meant to contain every remembered detail.
It is the durable index and operating memory for the agent.

## Protocol Principles

- Memory should store durable, useful context, not everything the agent sees.
- Memory should be curated, not a dump.
- Schemas should emerge only when the information actually needs structure.
- Supporting artifacts are allowed and encouraged when they improve maintenance, retrieval, or clarity.
- The agent should prefer updating existing memory structures over creating duplicates.
- Transient one-off output should stay in chat unless there is a clear reason to persist it.
- The user must be able to inspect and edit memory directly.
- The replication boundary must stay explicit: links from memory do not by themselves make an artifact part of replicated managed state.

## What Belongs In `Origin/Memory.md`

- stable user preferences
- standing instructions
- durable identity facts
- recurring patterns the agent should remember
- important long-lived context
- links to supporting files or datasets
- short summaries of maintained memory structures

Examples:

- preferred meeting habits
- recurring travel constraints
- known important people or groups
- persistent project context
- how the user likes the agent to behave

## What Should Not Go In `Origin/Memory.md`

- ephemeral observations
- raw copies of long emails or chats
- one-off answers that are unlikely to matter later
- large tables or datasets
- verbose logs
- secrets that should stay in the secrets store

## Supporting Files And Datasets

When a memory topic becomes recurrent, large, or structurally useful, the agent may create a supporting artifact and link it from `Origin/Memory.md`.

This is intentionally flexible. Possible artifacts include:

- ordinary markdown notes
- folders of related notes
- markdown tables
- JSON files
- CSV files
- other simple local file formats

The protocol does not define fixed schemas for all of these upfront.
The agent should choose the simplest structure that serves the task.

## Replication Boundary

- `Origin/Memory.md`, markdown notes in the managed workspace root, and note attachments inside that root are part of Origin's replicated note model.
- Once a workspace is attached, markdown files that live in the managed workspace root are managed notes, not generic local artifacts.
- Replicated note attachments only become replicated through an explicit attachment or import flow; mere presence in the workspace root does not make a file replicated.
- Referencing a file from `Origin/Memory.md` or linking to it from another note does not by itself promote that file into replicated managed state.
- Linked JSON files, CSV files, folders, and other non-markdown workspace artifacts are local workspace artifacts by default, even when they live inside the managed workspace root and `Origin/Memory.md` references them.
- A linked local workspace artifact becomes replicated managed state only if Origin explicitly imports it into the managed note set or re-materializes it from managed state.
- Agents should treat links as references first and should not assume that every referenced artifact syncs across peers.

## Example: People Memory

Origin should not need a first-class `people` object in v1.

However, if the agent repeatedly interacts with or reasons about the same people, it should recognize that this deserves durable structure.

In that case the agent may:

- add a concise summary and reference in `Origin/Memory.md`
- create and maintain a supporting people dataset or folder
- update that artifact as new interactions happen

The exact structure is not fixed upfront. It may start as:

- a single markdown note
- a folder of person notes
- a structured dataset if the information becomes large enough

## When To Persist Something

Persist information when it is likely to matter again.

Strong signals for persistence:

- it affects future behavior
- it is a recurring preference or rule
- it helps identify people, places, or projects over time
- it is useful beyond the current chat
- it would be costly or annoying to rediscover repeatedly

Weak signals for persistence:

- it was only useful to answer one question
- it is easy to recompute or refetch
- it is incidental detail with no expected future value

## Agent Behavior Contract

Agents operating in Origin should follow these rules:

1. Read `Origin/Memory.md` when memory is relevant.
2. Keep `Origin/Memory.md` concise and high-signal.
3. Update existing memory entries before creating new overlapping ones.
4. Create supporting artifacts when a topic becomes recurrent, large, or easier to manage with structure.
5. Link supporting artifacts from `Origin/Memory.md`.
6. Prefer simple file formats first.
7. Leave one-off content in chat unless persistence is clearly justified.
8. Do not store raw secrets in memory files.
9. Organize memory artifacts in whatever folders make sense for the evolving workspace.
10. Make the replication boundary explicit when creating or linking artifacts: markdown notes and note attachments in the managed workspace root replicate; other linked workspace artifacts do not unless Origin explicitly manages them as replicated state.

## Prompt Contract

The system prompt for Origin agents should explicitly teach:

- where `Origin/Memory.md` lives
- that in v1 the managed workspace root itself is the replicated markdown vault
- that it is the curated durable memory index
- that supporting files and datasets may be created and maintained
- that schemas are not fixed upfront
- which linked artifacts are replicated managed state versus local workspace artifacts
- that the agent should keep memory useful, concise, and maintained over time

## User Control

- The app should expose `Origin/Memory.md` directly for viewing and editing.
- Supporting memory artifacts should be visible like other files in the managed workspace.
- User edits to `Origin/Memory.md` and other markdown notes in the managed workspace root are authoritative inputs like any other vault edit.
- Edits to linked local workspace artifacts remain local unless Origin explicitly imports or re-materializes them into replicated managed state.
- If a peer moves from local to VPS, linked local workspace artifacts stay on the original host unless they are explicitly imported or re-materialized for the VPS peer.

## Relationship To Retrieval

- Memory is not the whole retrieval system.
- Retrieval should still draw from notes, chats, planning state, and selective external context.
- `Origin/Memory.md` is the curated durable index within that broader retrieval model.
- Replicated markdown notes and note attachments in the managed workspace root are part of the durable managed layer.
- Linked local workspace artifacts may still be useful retrieval inputs, but they are not part of the replicated managed layer unless Origin explicitly imports or re-materializes them.
