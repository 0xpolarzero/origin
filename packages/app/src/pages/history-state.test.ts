import { describe, expect, test } from "bun:test"
import { applyDebugToggle, counters, duplicate, focusFromQuery, parseHistoryQuery, resolveDebug } from "./history-state"

describe("history-state", () => {
  test("parseHistoryQuery parses tab, debug, and focus ids", () => {
    const parsed = parseHistoryQuery("?tab=operations&debug=1&operation_id=op-1")

    expect(parsed).toEqual({
      tab: "operations",
      debug: true,
      run_id: undefined,
      operation_id: "op-1",
    })

    const next = parseHistoryQuery("?tab=runs&debug=false&run_id=run-1")
    expect(next.debug).toBe(false)
    expect(next.run_id).toBe("run-1")
  })

  test("parseHistoryQuery ignores unsupported tab/debug values", () => {
    const parsed = parseHistoryQuery("?tab=unknown&debug=wat&run_id=run-1")
    expect(parsed).toEqual({
      tab: undefined,
      debug: undefined,
      run_id: "run-1",
      operation_id: undefined,
    })
  })

  test("focusFromQuery prioritizes operation target over run target", () => {
    const parsed = parseHistoryQuery("?run_id=run-1&operation_id=op-1")
    expect(focusFromQuery(parsed)).toEqual({
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
        duplicate_event: {
          reason: false,
          failure: false,
        },
      },
      {
        duplicate_event: {
          reason: true,
          failure: false,
        },
      },
      {
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
