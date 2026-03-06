import { describe, expect, test } from "bun:test"
import {
  createDraftEditor,
  draftCreateInput,
  draftRemediation,
  draftReasonCodes,
  draftUpdateInput,
  hasMaterialChanges,
  scopeFromDraftStatus,
  type DraftEditor,
} from "./history-drafts"
import type { HistoryDraft } from "./history-data"

const draft = (status = "approved"): HistoryDraft => ({
  id: "draft_1",
  run_id: "run_1",
  workspace_id: "wrk_1",
  status,
  source_kind: "user",
  adapter_id: "test",
  integration_id: "test/default",
  action_id: "message.send",
  target: "channel://general",
  payload_json: {
    text: "hello",
    meta: {
      a: 1,
      b: 2,
    },
  },
  payload_schema_version: 1,
  preview_text: "Message channel://general: hello",
  material_hash: "hash",
  block_reason_code: null,
  policy_id: "policy/outbound-default",
  policy_version: "10",
  decision_id: "decision_1",
  decision_reason_code: "policy_allow",
  created_at: 10,
  updated_at: 11,
  dispatch: null,
})

describe("history-drafts", () => {
  test("createDraftEditor seeds deterministic defaults for new drafts", () => {
    expect(createDraftEditor()).toEqual({
      run_id: "",
      source_kind: "user",
      adapter_id: "test",
      integration_id: "test/default",
      action_id: "message.send",
      target: "channel://general",
      payload_schema_version: "1",
      payload_json: JSON.stringify({ text: "" }, null, 2),
    })
  })

  test("draftCreateInput trims fields and builds a user request", () => {
    const input: DraftEditor = {
      run_id: " run_1 ",
      source_kind: "user",
      adapter_id: " test ",
      integration_id: " test/default ",
      action_id: " message.send ",
      target: " channel://general ",
      payload_schema_version: " 1 ",
      payload_json: '{ "text": "hello" }',
    }

    expect(draftCreateInput(input)).toEqual({
      ok: true,
      value: {
        run_id: "run_1",
        source_kind: "user",
        adapter_id: "test",
        integration_id: "test/default",
        action_id: "message.send",
        target: "channel://general",
        payload_schema_version: 1,
        payload_json: { text: "hello" },
        actor_type: "user",
      },
    })
  })

  test("draftUpdateInput rejects invalid payload json", () => {
    const result = draftUpdateInput(draft(), {
      ...createDraftEditor(draft()),
      payload_json: "{",
    })

    expect(result).toEqual({
      ok: false,
      error: "Payload JSON must be valid JSON.",
    })
  })

  test("hasMaterialChanges ignores json key order but detects payload updates", () => {
    const base = draft()

    expect(
      hasMaterialChanges(base, {
        ...createDraftEditor(base),
        payload_json: JSON.stringify({
          meta: {
            b: 2,
            a: 1,
          },
          text: "hello",
        }),
      }),
    ).toBe(false)

    expect(
      hasMaterialChanges(base, {
        ...createDraftEditor(base),
        payload_json: JSON.stringify({
          text: "updated",
          meta: {
            a: 1,
            b: 2,
          },
        }),
      }),
    ).toBe(true)
  })

  test("scopeFromDraftStatus and remediation cover pending, processed, and blocked hints", () => {
    expect(scopeFromDraftStatus("approved")).toBe("pending")
    expect(scopeFromDraftStatus("sent")).toBe("processed")

    const blocked = {
      ...draft("blocked"),
      block_reason_code: "workspace_policy_blocked",
      decision_reason_code: "workspace_policy_blocked",
      dispatch: {
        id: "dispatch_1",
        state: "blocked",
        idempotency_key: "dispatch:draft_1",
        remote_reference: null,
        block_reason_code: "workspace_policy_blocked",
      },
    }

    expect(draftReasonCodes(blocked)).toEqual(["workspace_policy_blocked"])
    expect(draftRemediation(blocked)).toBe(
      "Outbound dispatch is limited to Origin workspaces. Move the action into the protected Origin workspace, then retry.",
    )
  })
})
