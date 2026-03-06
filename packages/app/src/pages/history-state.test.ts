import { describe, expect, test } from "bun:test"
import { applyDebugToggle, counters, duplicate, focusFromQuery, parseHistoryQuery, resolveDebug } from "./history-state"

describe("history-state", () => {
  test("parseHistoryQuery parses tabs, scope, debug, and focus ids", () => {
    const parsed = parseHistoryQuery("?tab=operations&debug=1&operation_id=op-1")

    expect(parsed).toEqual({
      tab: "operations",
      scope: undefined,
      debug: true,
      run_id: undefined,
      operation_id: "op-1",
      draft_id: undefined,
    })

    const next = parseHistoryQuery("?tab=runs&debug=false&run_id=run-1")
    expect(next.debug).toBe(false)
    expect(next.run_id).toBe("run-1")

    const draft = parseHistoryQuery("?tab=drafts&scope=processed&draft_id=draft-1")
    expect(draft).toEqual({
      tab: "drafts",
      scope: "processed",
      debug: undefined,
      run_id: undefined,
      operation_id: undefined,
      draft_id: "draft-1",
    })
  })

  test("parseHistoryQuery ignores unsupported tab/scope/debug values", () => {
    const parsed = parseHistoryQuery("?tab=unknown&scope=done&debug=wat&run_id=run-1")
    expect(parsed).toEqual({
      tab: undefined,
      scope: undefined,
      debug: undefined,
      run_id: "run-1",
      operation_id: undefined,
      draft_id: undefined,
    })
  })

  test("focusFromQuery prioritizes draft target over operation and run targets", () => {
    const parsed = parseHistoryQuery("?run_id=run-1&operation_id=op-1&draft_id=draft-1")
    expect(focusFromQuery(parsed)).toEqual({
      tab: "drafts",
      id: "draft-1",
    })

    expect(focusFromQuery(parseHistoryQuery("?run_id=run-1&operation_id=op-1"))).toEqual({
      tab: "operations",
      id: "op-1",
    })
  })

  test("resolveDebug and applyDebugToggle enforce persisted versus override precedence", () => {
    expect(resolveDebug({ persisted: false, override: undefined })).toBe(false)
    expect(resolveDebug({ persisted: false, override: true })).toBe(true)

    expect(
      applyDebugToggle({
        persisted: false,
        override: undefined,
        next: true,
      }),
    ).toEqual({
      persisted: true,
      override: undefined,
    })

    expect(
      applyDebugToggle({
        persisted: false,
        override: true,
        next: false,
      }),
    ).toEqual({
      persisted: false,
      override: false,
    })
  })

  test("duplicate and counters exclude duplicate rows from execution totals", () => {
    const rows = [
      {
        status: "completed",
        duplicate_event: {
          reason: false,
          failure: false,
        },
      },
      {
        status: "skipped",
        duplicate_event: {
          reason: true,
          failure: false,
        },
      },
      {
        status: "skipped",
        duplicate_event: {
          reason: false,
          failure: false,
        },
      },
      {
        status: "skipped",
        duplicate_event: {
          reason: false,
          failure: true,
        },
      },
    ]

    expect(duplicate(rows[1]!)).toBe(true)
    expect(counters(rows)).toEqual({
      runs: 1,
      duplicates: 2,
    })
  })
})
