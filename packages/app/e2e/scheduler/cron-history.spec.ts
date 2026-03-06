import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const rows = [
  {
    id: "run-main",
    status: "completed",
    trigger_type: "cron",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: "session-main",
    reason_code: null,
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 400,
    updated_at: 400,
    started_at: 400,
    finished_at: 401,
    operation_id: "op-main",
    operation_exists: true,
    trigger_metadata: {
      source: "cron",
      slot_local: "2026-11-01T01:30-05:00[America/New_York]",
      slot_utc: 1793514600000,
    },
    duplicate_event: {
      reason: false,
      failure: false,
    },
  },
  {
    id: "run-gap",
    status: "skipped",
    trigger_type: "cron",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: null,
    reason_code: "dst_gap_skipped",
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 300,
    updated_at: 300,
    started_at: null,
    finished_at: 300,
    operation_id: null,
    operation_exists: false,
    trigger_metadata: {
      source: "cron",
      slot_local: "2026-03-08T02:30[America/New_York]",
      slot_utc: null,
      summary: false,
    },
    duplicate_event: {
      reason: false,
      failure: false,
    },
  },
  {
    id: "run-summary",
    status: "skipped",
    trigger_type: "cron",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: null,
    reason_code: "cron_missed_slot",
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 200,
    updated_at: 200,
    started_at: null,
    finished_at: 200,
    operation_id: null,
    operation_exists: false,
    trigger_metadata: {
      source: "cron",
      summary: true,
      skipped_count: 27,
      first_slot_local: "2026-11-01T01:30-04:00[America/New_York]",
      last_slot_local: "2026-11-02T01:30-05:00[America/New_York]",
    },
    duplicate_event: {
      reason: false,
      failure: false,
    },
  },
] as const

function empty() {
  return JSON.stringify({
    items: [],
    next_cursor: null,
  })
}

test("scheduler history renders skipped cron detail rows and coalesced summaries deterministically", async ({
  page,
  withProject,
}) => {
  await withProject(async ({ slug }) => {
    const history = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      if (url.pathname.endsWith("/workflow/history/runs")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: rows,
            next_cursor: null,
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: empty(),
      })
    }

    await page.route("**/workflow/history/**", history)

    try {
      await page.goto(`/${slug}/history`)

      await expect(page.locator('[data-component="history-counter-runs"]')).toHaveText("1")
      await expect(page.locator('[data-component="history-counter-duplicates"]')).toHaveText("0")

      const gap = page.locator('[data-component="history-run-row"][data-id="run-gap"]')
      await expect(gap).toBeVisible()
      await expect(gap).toHaveAttribute("data-skipped", "true")
      await gap.getByRole("button", { name: "Open Event Details" }).click()
      await expect(gap).toContainText("Skipped cron slot during DST forward jump.")
      await expect(gap).toContainText("slot_local: 2026-03-08T02:30[America/New_York]")
      await expect(gap).toContainText("slot_utc: -")
      await expect(gap).toContainText("No operation expected")

      const summary = page.locator('[data-component="history-run-row"][data-id="run-summary"]')
      await expect(summary).toBeVisible()
      await summary.getByRole("button", { name: "Open Event Details" }).click()
      await expect(summary).toContainText("Skipped 27 additional missed cron slots.")
      await expect(summary).toContainText("first_slot_local: 2026-11-01T01:30-04:00[America/New_York]")
      await expect(summary).toContainText("last_slot_local: 2026-11-02T01:30-05:00[America/New_York]")
      await expect(summary).toContainText("reason_code: cron_missed_slot")
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/history/**", history)
    }
  })
})
