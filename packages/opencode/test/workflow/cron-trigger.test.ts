import { describe, expect, test } from "bun:test"
import { WorkflowCron } from "../../src/workflow/cron"

describe("workflow cron evaluation", () => {
  test("records skipped spring-forward slots with dst_gap_skipped", () => {
    const result = WorkflowCron.evaluate({
      cron: "30 2 * * *",
      timezone: "America/New_York",
      cursor_at: Date.parse("2026-03-08T06:00:00.000Z"),
      now: Date.parse("2026-03-08T07:05:00.000Z"),
    })

    expect(result.execute).toBeNull()
    expect(result.skipped).toEqual([
      {
        kind: "skip",
        reason_code: "dst_gap_skipped",
        slot_local: "2026-03-08T02:30[America/New_York]",
        slot_utc: null,
      },
    ])
  })

  test("evaluates duplicated fall-back local times by distinct utc boundaries", () => {
    const result = WorkflowCron.evaluate({
      cron: "30 1 * * *",
      timezone: "America/New_York",
      cursor_at: Date.parse("2026-11-01T05:00:00.000Z"),
      now: Date.parse("2026-11-01T06:30:00.000Z"),
    })

    expect(result.execute).toEqual({
      kind: "run",
      slot_local: "2026-11-01T01:30-05:00[America/New_York]",
      slot_utc: Date.parse("2026-11-01T06:30:00.000Z"),
    })
    expect(result.skipped).toEqual([
      {
        kind: "skip",
        reason_code: "cron_missed_slot",
        slot_local: "2026-11-01T01:30-04:00[America/New_York]",
        slot_utc: Date.parse("2026-11-01T05:30:00.000Z"),
      },
    ])
  })
})
