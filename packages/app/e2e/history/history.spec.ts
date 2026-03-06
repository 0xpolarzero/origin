import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const runsRows = {
  main: {
    id: "run-main",
    status: "completed",
    trigger_type: "manual",
    workflow_id: "workflow.daily",
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
    trigger_metadata: null,
    duplicate_event: {
      reason: false,
      failure: false,
    },
    debug: false,
  },
  duplicate: {
    id: "run-dup",
    status: "skipped",
    trigger_type: "signal",
    workflow_id: "workflow.daily",
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
      dedupe_key: "evt_1",
    },
    duplicate_event: {
      reason: true,
      failure: false,
    },
    debug: false,
  },
  skipped: {
    id: "run-skip",
    status: "skipped",
    trigger_type: "cron",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: null,
    reason_code: "cron_missed_slot",
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 180,
    updated_at: 180,
    started_at: null,
    finished_at: 180,
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
    debug: false,
  },
  missing: {
    id: "run-missing",
    status: "completed",
    trigger_type: "manual",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: null,
    reason_code: null,
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 100,
    updated_at: 100,
    started_at: 100,
    finished_at: 101,
    operation_id: null,
    operation_exists: false,
    trigger_metadata: null,
    duplicate_event: {
      reason: false,
      failure: false,
    },
    debug: false,
  },
  debug: {
    id: "run-debug",
    status: "completed",
    trigger_type: "debug",
    workflow_id: "workflow.debug",
    workspace_id: "wrk_1",
    session_id: null,
    reason_code: null,
    failure_code: null,
    ready_for_integration_at: null,
    created_at: 500,
    updated_at: 500,
    started_at: 500,
    finished_at: 501,
    operation_id: "op-debug",
    operation_exists: true,
    trigger_metadata: null,
    duplicate_event: {
      reason: false,
      failure: false,
    },
    debug: true,
  },
} as const

const operationsRows = {
  main: {
    id: "op-main",
    run_id: "run-main",
    run_exists: true,
    status: "completed",
    trigger_type: "manual",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: "session-main",
    ready_for_integration_at: null,
    changed_paths: ["README.md"],
    created_at: 300,
    updated_at: 300,
    provenance: "app",
  },
  user: {
    id: "op-user",
    run_id: "run-main",
    run_exists: true,
    status: "completed",
    trigger_type: "manual",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: null,
    ready_for_integration_at: null,
    changed_paths: ["CHANGELOG.md"],
    created_at: 250,
    updated_at: 250,
    provenance: "user",
  },
  missing: {
    id: "op-missing",
    run_id: "run-gone",
    run_exists: false,
    status: "completed",
    trigger_type: "manual",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: null,
    ready_for_integration_at: null,
    changed_paths: ["lost.txt"],
    created_at: 150,
    updated_at: 150,
    provenance: "app",
  },
  tail: {
    id: "op-tail",
    run_id: "run-main",
    run_exists: true,
    status: "completed",
    trigger_type: "manual",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: null,
    ready_for_integration_at: null,
    changed_paths: ["tail.txt"],
    created_at: 50,
    updated_at: 50,
    provenance: "app",
  },
  debug: {
    id: "op-debug",
    run_id: "run-debug",
    run_exists: true,
    status: "completed",
    trigger_type: "debug",
    workflow_id: "workflow.debug",
    workspace_id: "wrk_1",
    session_id: null,
    ready_for_integration_at: null,
    changed_paths: ["debug.log"],
    created_at: 500,
    updated_at: 500,
    provenance: "app",
  },
} as const

test("history tabs, filtering, cross-links, duplicate events, and missing links", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const includeDebug = url.searchParams.get("include_debug") === "true"
      const cursor = url.searchParams.get("cursor")

      if (cursor === "300:run-main") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [runsRows.duplicate, runsRows.skipped, runsRows.missing],
            next_cursor: null,
            hidden_debug_count: includeDebug ? 0 : 1,
          }),
        })
        return
      }

      const pageRows = includeDebug ? [runsRows.debug, runsRows.main] : [runsRows.main]
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: pageRows,
          next_cursor: "300:run-main",
          hidden_debug_count: includeDebug ? 0 : 1,
        }),
      })
    }

    const operations = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const includeDebug = url.searchParams.get("include_debug") === "true"
      const includeUser = url.searchParams.get("include_user") === "true"
      const cursor = url.searchParams.get("cursor")

      if (cursor === "150:op-missing") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [operationsRows.tail],
            next_cursor: null,
          }),
        })
        return
      }

      const base = [operationsRows.main, operationsRows.missing]
      const withUser = includeUser ? [operationsRows.main, operationsRows.user, operationsRows.missing] : base
      const rows = includeDebug ? [operationsRows.debug, ...withUser] : withUser

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: rows,
          next_cursor: "150:op-missing",
        }),
      })
    }

    await page.route("**/workflow/history/runs*", runs)
    await page.route("**/workflow/history/operations*", operations)

    try {
      await page.goto(`/${slug}/history`)

      const mainRun = page.locator('[data-component="history-run-row"][data-id="run-main"]')
      await expect(mainRun).toBeVisible()
      await expect(page.locator('[data-component="history-counter-runs"]')).toHaveText("1")
      await expect(page.locator('[data-component="history-counter-duplicates"]')).toHaveText("0")
      await expect(page.locator('[data-component="history-hidden-debug-count"]')).toContainText("1")

      await page.getByRole("button", { name: "Load More" }).click()
      const duplicate = page.locator('[data-component="history-run-row"][data-id="run-dup"]')
      await expect(duplicate).toBeVisible()
      await expect(duplicate).toHaveAttribute("data-duplicate", "true")

      await duplicate.getByRole("button", { name: "Open Event Details" }).click()
      await expect(duplicate).toContainText("Ignored duplicate signal.")
      await expect(duplicate).toContainText("signal: incoming")
      await expect(duplicate.getByRole("button", { name: "Open Run Session" })).toHaveCount(0)
      await expect(duplicate).toContainText("No operation expected")

      const skipped = page.locator('[data-component="history-run-row"][data-id="run-skip"]')
      await expect(skipped).toBeVisible()
      await skipped.getByRole("button", { name: "Open Event Details" }).click()
      await expect(skipped).toContainText("Missed cron slot.")
      await expect(skipped).toContainText("slot_local: 2026-03-08T02:30[America/New_York]")
      await expect(skipped).toContainText("No operation expected")

      await expect(page.locator('[data-component="history-counter-runs"]')).toHaveText("2")
      await expect(page.locator('[data-component="history-counter-duplicates"]')).toHaveText("1")

      const missingRun = page.locator('[data-component="history-run-row"][data-id="run-missing"]')
      await expect(missingRun.locator('[data-component="history-link-missing"]')).toHaveText("Operation link missing")
      await expect(missingRun.getByRole("button", { name: "Open Operation" })).toBeDisabled()

      await mainRun.getByRole("button", { name: "Open Operation" }).click()
      await expect(page.locator('[data-component="history-operation-row"][data-id="op-main"]')).toBeVisible()
      await expect(page.locator('[data-component="history-operation-row"][data-id="op-main"]')).toHaveAttribute(
        "data-focused",
        "true",
      )

      await expect(page.locator('[data-component="history-operation-row"][data-id="op-user"]')).toHaveCount(0)

      const includeUserToggle = page.locator('[data-component="history-include-user-toggle"]')
      await includeUserToggle.click()
      await expect(page.locator('[data-component="history-operation-row"][data-id="op-user"]')).toBeVisible()
      await page.getByRole("button", { name: "Refresh" }).click()
      const operationsRowsList = page.locator('[data-component="history-operation-row"]')
      await expect(operationsRowsList.nth(0)).toHaveAttribute("data-id", "op-main")
      await page.getByRole("button", { name: "Load More" }).click()
      await expect(page.locator('[data-component="history-operation-row"][data-id="op-tail"]')).toBeVisible()

      const missingOperation = page.locator('[data-component="history-operation-row"][data-id="op-missing"]')
      await expect(missingOperation.locator('[data-component="history-link-missing"]')).toHaveText("Run link missing")
      await expect(missingOperation.getByRole("button", { name: "Open Run" })).toBeDisabled()

      await page
        .locator('[data-component="history-operation-row"][data-id="op-main"]')
        .getByRole("button", { name: "Open Run" })
        .click()
      await expect(page).toHaveURL(new RegExp(`/history\\?tab=runs&run_id=run-main$`))
      await expect(page.locator('[data-component="history-run-row"][data-id="run-main"]')).toBeVisible()
      await expect(page.locator('[data-component="history-run-row"][data-id="run-main"]')).toHaveAttribute(
        "data-focused",
        "true",
      )

      await page.getByRole("button", { name: "Refresh" }).click()
      const rows = page.locator('[data-component="history-run-row"]')
      await expect(rows.nth(0)).toHaveAttribute("data-id", "run-main")
      await expect(rows).toHaveCount(1)
      await page.getByRole("button", { name: "Load More" }).click()
      await expect(rows).toHaveCount(4)
      await expect(rows.nth(0)).toHaveAttribute("data-id", "run-main")
      await expect(rows.nth(1)).toHaveAttribute("data-id", "run-dup")
      await expect(rows.nth(2)).toHaveAttribute("data-id", "run-skip")
      await expect(rows.nth(3)).toHaveAttribute("data-id", "run-missing")
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/history/runs*", runs)
      await page.unroute("**/workflow/history/operations*", operations)
    }
  })
})

test("history debug deep-link focus and debug precedence are deterministic", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const includeDebug = url.searchParams.get("include_debug") === "true"
      const rows = includeDebug ? [runsRows.debug, runsRows.main] : [runsRows.main]

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: rows,
          next_cursor: null,
          hidden_debug_count: includeDebug ? 0 : 1,
        }),
      })
    }

    await page.route("**/workflow/history/runs*", runs)

    try {
      await page.goto(`/${slug}/history`)
      const debugSwitch = page.locator('[data-component="history-debug-toggle"]')

      await expect(page.locator('[data-component="history-run-row"][data-id="run-debug"]')).toHaveCount(0)
      await expect(page.locator('[data-component="history-hidden-debug-count"]')).toContainText("1")

      await debugSwitch.click()
      await expect(page.locator('[data-component="history-run-row"][data-id="run-debug"]')).toBeVisible()
      await expect(page.locator('[data-component="history-hidden-debug-count"]')).toHaveCount(0)

      await page.goto(`/${slug}/history?tab=runs&debug=0&run_id=run-main`)
      await expect(page.locator('[data-component="history-run-row"][data-id="run-debug"]')).toHaveCount(0)
      await expect(page.locator('[data-component="history-hidden-debug-count"]')).toContainText("1")
      await expect(page.locator('[data-component="history-run-row"][data-id="run-main"]')).toHaveAttribute(
        "data-focused",
        "true",
      )

      await page.goto(`/${slug}/history`)
      await expect(page.locator('[data-component="history-run-row"][data-id="run-debug"]')).toBeVisible()

      await page.goto(`/${slug}/history?tab=runs&debug=1&run_id=run-debug`)
      await expect(page.locator('[data-component="history-run-row"][data-id="run-debug"]')).toBeVisible()
      await expect(page.locator('[data-component="history-run-row"][data-id="run-debug"]')).toHaveAttribute(
        "data-focused",
        "true",
      )
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/history/runs*", runs)
    }
  })
})

test("history shows backend errors for both tabs without crashing", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "runs unavailable",
      })
    }

    const operations = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "operations unavailable",
      })
    }

    await page.route("**/workflow/history/runs*", runs)
    await page.route("**/workflow/history/operations*", operations)

    try {
      await page.goto(`/${slug}/history`)
      await expect(page.getByRole("heading", { name: "History" })).toBeVisible()
      await expect(page.getByText("runs unavailable")).toBeVisible()

      await page.locator('[data-component="history-tab-trigger"][data-tab="operations"]').click()
      await expect(page.getByText("operations unavailable")).toBeVisible()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/history/runs*", runs)
      await page.unroute("**/workflow/history/operations*", operations)
    }
  })
})

test("history recovers from load-more failures without crashing", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const cursor = url.searchParams.get("cursor")
      if (cursor) {
        await route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: "runs page two failed",
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [runsRows.main],
          next_cursor: "300:run-main",
        }),
      })
    }

    const operations = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const cursor = url.searchParams.get("cursor")
      if (cursor) {
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "operations page two failed",
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [operationsRows.main],
          next_cursor: "300:op-main",
        }),
      })
    }

    await page.route("**/workflow/history/runs*", runs)
    await page.route("**/workflow/history/operations*", operations)

    try {
      await page.goto(`/${slug}/history`)
      await expect(page.locator('[data-component="history-run-row"][data-id="run-main"]')).toBeVisible()

      await page.getByRole("button", { name: "Load More" }).click()
      await expect(page.getByText("runs page two failed")).toBeVisible()
      await expect(page.getByRole("heading", { name: "History" })).toBeVisible()
      await page.getByRole("button", { name: "Refresh" }).click()
      await expect(page.locator('[data-component="history-run-row"][data-id="run-main"]')).toBeVisible()

      await page.locator('[data-component="history-tab-trigger"][data-tab="operations"]').click()
      await expect(page.locator('[data-component="history-operation-row"][data-id="op-main"]')).toBeVisible()

      await page.getByRole("button", { name: "Load More" }).click()
      await expect(page.getByText("operations page two failed")).toBeVisible()
      await page.getByRole("button", { name: "Refresh" }).click()
      await expect(page.locator('[data-component="history-operation-row"][data-id="op-main"]')).toBeVisible()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/history/runs*", runs)
      await page.unroute("**/workflow/history/operations*", operations)
    }
  })
})
