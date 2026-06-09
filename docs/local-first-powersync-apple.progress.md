# Local-First PowerSync Apple Progress

This document tracks implementation slices. The first four slices are the only active plan. Later slices stay TODO until slices 1-4 are complete and reviewed.

## Slice 1: Foundation

Goal: prove the empty product shell, local dev loop, backend, database, PowerSync, and native app launch. The coding agent must be able to launch, operate, inspect, and debug the app end-to-end without hidden manual steps.

Slice 1 stack decisions:

- [x] Use Bun as JavaScript package manager and backend runtime.
- [x] Use Kysely for backend database access.
- [x] Use Kysely migrations.
- [x] Use Effect Schema for backend validation.
- [x] Use a checked-in Xcode project for the native app.
- [x] Use Swift Package Manager for native dependencies.
- [x] Use Docker Compose for local Postgres and self-hosted PowerSync.
- [x] Use a Makefile as the top-level command surface.
- [x] Use `bun test` for backend tests.
- [x] Use XCTest for native tests.
- [x] Use structured JSON logs with correlation IDs.
- [x] Use `xcodebuild` + XCTest UI tests for e2e.
- [x] Use iPhone 13 Pro with the latest installed iOS 18 simulator runtime as the default e2e destination.
- [x] Do not auto-install Xcode simulator runtimes; validate and print fix instructions instead.
- [x] Do not add CI in Slice 1.

- [ ] Create empty iOS/macOS app shell.
- [ ] Create backend shell with health endpoint.
- [ ] Add local Postgres setup.
- [ ] Add self-hosted PowerSync local config.
- [ ] Seed one dev user.
- [ ] Seed one dev device.
- [ ] Connect native app to backend health endpoint.
- [ ] Connect native app to PowerSync.
- [ ] Show backend status in native diagnostics UI.
- [ ] Show PowerSync status in native diagnostics UI.
- [ ] Add one-command setup.
- [ ] Add `make doctor` to validate Xcode, `xcode-select`, iPhone 13 Pro simulator, and iOS 18 runtime.
- [ ] Make simulator/runtime validation fail with exact manual install instructions when missing.
- [ ] Add one-command reset.
- [ ] Add one-command dev boot.
- [ ] Add test command.
- [ ] Add typecheck/lint command if applicable.
- [ ] Add basic backend integration test.
- [ ] Add simulator launch/review instructions.
- [ ] Add agent-run e2e command that boots backend/sync dependencies and launches the native app.
- [ ] Add agent-readable logs for backend, PowerSync, and native app events.
- [ ] Add correlation IDs across native requests, backend commands, and sync events.
- [ ] Add diagnostics screen with backend URL, user ID, device ID, sync status, last sync time, and last error.
- [ ] Add documented log locations and commands for tailing logs.
- [ ] Add documented reset path for database, PowerSync state, and simulator/app state.
- [ ] Add full e2e test flow that the agent can run after launch.
- [ ] E2E flow boots services, launches the native app, drives the UI, verifies backend health, verifies PowerSync connectivity, reads diagnostics, and checks logs.

Review bar:

- [ ] A reviewer can clone, set up, reset, run tests, launch the app, and see healthy backend/sync status.
- [ ] The coding agent can run the full app e2e flow, inspect logs, reset state, and debug failures with full local context.
- [ ] E2E failures produce actionable logs rather than silent app/backend/sync states.
- [ ] No notes, AI, providers, files, Automerge, or extra feature logic is included.

## Slice 2: Notes

Goal: prove the full app architecture once using notes only.

- [ ] Add notes schema.
- [ ] Add note command-intent shape.
- [ ] Add PowerSync sync definition for notes.
- [ ] Add `op_log` support needed for notes.
- [ ] Add `create_note` command.
- [ ] Add `rename_note` command.
- [ ] Add `archive_note` command.
- [ ] Add optional `restore_note` command if needed for review UX.
- [ ] Implement PowerSync upload mapping from note command-intents to backend commands.
- [ ] Implement notes list UI.
- [ ] Implement note detail UI.
- [ ] Show queued, accepted, and rejected note states.
- [ ] Support offline note create/edit/archive.
- [ ] Add one intentional rejection/conflict case.
- [ ] Add notes seed data.
- [ ] Add backend integration tests for note commands.
- [ ] Add native/manual review script for online and offline notes flows.

Review bar:

- [ ] A reviewer can create, rename, and archive notes online.
- [ ] A reviewer can create, rename, and archive notes offline, reconnect, and see accepted state.
- [ ] A reviewer can understand sync and command status from the UI.
- [ ] No AI, providers, files, or Automerge rich body logic is included.

## Slice 3: AI Notes Chat

Goal: add Better Agent and polish AI chat against notes only.

- [ ] Add Better Agent backend harness.
- [ ] Add AI run persistence.
- [ ] Add AI message transcript persistence.
- [ ] Add AI tool-call summary persistence.
- [ ] Add native chat UI.
- [ ] Add streaming assistant responses.
- [ ] Add `search_notes` tool.
- [ ] Add `read_note` tool.
- [ ] Add `create_note` AI tool.
- [ ] Add `rename_note` AI tool.
- [ ] Add `archive_note` AI tool.
- [ ] Show tool-call summaries in transcript.
- [ ] Add AI action history UI.
- [ ] Add revert UI for AI note actions.
- [ ] Apply AI note actions through the normal command service path.
- [ ] Revert AI note actions through normal command-intent and command service path.
- [ ] Add AI harness tests for allowed tools.
- [ ] Add tests that unavailable tools cannot be called.
- [ ] Add native/manual review script for chat, direct note action, history, and revert flows.

Review bar:

- [ ] A reviewer can chat with AI about notes.
- [ ] A reviewer can see what tools were used.
- [ ] A reviewer can see AI note actions in history.
- [ ] A reviewer can revert AI note actions.
- [ ] AI note actions use the same notes command path as user actions.
- [ ] No provider tools, tasks, files, or Automerge rich body logic is included.

## Slice 4: Rich Note Body

Goal: add rich note bodies without changing the proven notes architecture.

- [ ] Add Automerge body storage tables.
- [ ] Add body snapshot storage.
- [ ] Add body change-row storage.
- [ ] Add `update_note_body` command.
- [ ] Add `compact_note_body` command.
- [ ] Add `rebuild_note_body_search_text` command.
- [ ] Add native TextKit editor wrapper for iOS.
- [ ] Add native TextKit editor wrapper for macOS.
- [ ] Add adapter between native attributed text operations and Automerge rich-text changes.
- [ ] Sync body snapshots and changes through PowerSync.
- [ ] Extract plain text from accepted Automerge document.
- [ ] Sync extracted text for local search.
- [ ] Keep attachments as file references, not embedded Automerge binary data.
- [ ] Add compaction threshold.
- [ ] Add rich body tests for edit, sync, rebuild, and compaction.
- [ ] Add native/manual review script for rich note editing across devices/simulators.

Review bar:

- [ ] A reviewer can edit a rich note body and see it persist.
- [ ] A reviewer can sync rich note body changes through PowerSync.
- [ ] A reviewer can search extracted rich body text.
- [ ] Rich body logic stays scoped to note bodies only.

## Later Slices

Do not start these until slices 1-4 are complete and reviewed.

- [ ] Tasks: TODO after slices 1-4.
- [ ] Files: TODO after slices 1-4.
- [ ] Provider drafts: TODO after slices 1-4.
- [ ] Search polish: TODO after slices 1-4.
- [ ] Calendar/email metadata: TODO after slices 1-4.
- [ ] Lifecycle and diagnostics polish: TODO after slices 1-4.
