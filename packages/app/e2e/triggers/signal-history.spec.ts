import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const rows = [
  {
    id: "run-main",
    status: "completed",
    trigger_type: "signal",
    workflow_id: "workflow.incoming",
    workspace_id: "wrk_1",
    session_id: "session-main",
    reason_code: null,
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 300,
    updated_at: 300,
    started_at: 300,
    finished_at: 301,
    operation_id: "op-main",
    operation_exists: true,
    trigger_metadata: {
      source: "signal",
      signal: "incoming",
    },
    duplicate_event: {
      reason: false,
      failure: false,
    },
  },
  {
    id: "run-dup",
    status: "skipped",
    trigger_type: "signal",
    workflow_id: "workflow.incoming",
    workspace_id: "wrk_1",
    session_id: null,
    reason_code: "duplicate_event",
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 200,
    updated_at: 200,
    started_at: null,
    finished_at: 200,
    operation_id: null,
    operation_exists: false,
    trigger_metadata: {
      source: "signal",
      signal: "incoming",
      provider_event_id: "evt_1",
      dedupe_key: "evt_1",
    },
    duplicate_event: {
      reason: true,
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

test("signal-trigger history renders duplicate-event rows without inflating counters", async ({ page, withProject }) => {
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
      await expect(page.locator('[data-component="history-counter-duplicates"]')).toHaveText("1")

      const duplicate = page.locator('[data-component="history-run-row"][data-id="run-dup"]')
      await expect(duplicate).toBeVisible()
      await expect(duplicate).toHaveAttribute("data-duplicate", "true")
      await expect(duplicate).toHaveAttribute("data-skipped", "true")
      await expect(duplicate.getByText("No operation expected")).toBeVisible()
      await expect(duplicate.getByRole("button", { name: "Open Run Session" })).toHaveCount(0)

      await duplicate.getByRole("button", { name: "Open Event Details" }).click()
      await expect(duplicate).toContainText("Ignored duplicate signal.")
      await expect(duplicate).toContainText("signal: incoming")
      await expect(duplicate).toContainText("provider_event_id: evt_1")
      await expect(duplicate).toContainText("dedupe_key: evt_1")
      await expect(duplicate).toContainText("reason_code: duplicate_event")
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/history/**", history)
    }
  })
})
