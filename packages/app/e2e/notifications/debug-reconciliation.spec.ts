import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const run = {
  id: "run-debug",
  status: "reconciling",
  trigger_type: "debug",
  workflow_id: "workflow.debug",
  workspace_id: "wrk_1",
  session_id: "session-debug",
  reason_code: null,
  failure_code: null,
  ready_for_integration_at: null,
  created_at: 500,
  updated_at: 500,
  started_at: 500,
  finished_at: null,
  operation_id: "op-debug",
  operation_exists: true,
  trigger_metadata: null,
  duplicate_event: {
    reason: false,
    failure: false,
  },
  debug: true,
} as const

const reminder = {
  run_id: "run-debug",
  session_id: "session-debug",
  workspace_id: "wrk_1",
  workflow_id: "workflow.debug",
  status: "reconciling",
  trigger_type: "debug",
  started_at: 500,
  threshold_ms: 900_000,
  cadence_ms: 600_000,
  hard_stop_ms: 2_700_000,
  threshold_at: 900_500,
  hard_stop_at: 2_700_500,
  next_notification_at: 900_500,
  last_notification_at: null,
  last_keep_running_at: null,
  elapsed_ms: 900_000,
  remaining_ms: 1_800_000,
  notify: true,
} as const

const reportDraft = {
  id: "draft-report-1",
  run_id: "run-debug",
  workspace_id: "wrk_1",
  status: "pending",
  source_kind: "system_report",
  adapter_id: "system",
  integration_id: "system/default",
  action_id: "report.dispatch",
  target: "system://developers",
  payload_json: {
    metadata: {
      run_id: "run-debug",
    },
  },
  payload_schema_version: 1,
  preview_text: "Debug report for run-debug",
  material_hash: "hash-report",
  block_reason_code: null,
  policy_id: "policy/outbound-default",
  policy_version: "12",
  decision_id: "decision-report",
  decision_reason_code: "policy_allow",
  created_at: 600,
  updated_at: 601,
  dispatch: null,
} as const

test("debug reminder can open a hidden debug session with focus", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const reminders = async (route: Route) => {
      if (new URL(route.request().url()).origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: 123,
          items: [reminder],
        }),
      })
    }

    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const includeDebug = url.searchParams.get("include_debug") === "true"
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: includeDebug ? [run] : [],
          next_cursor: null,
          hidden_debug_count: includeDebug ? 0 : 1,
        }),
      })
    }

    await page.route("**/workflow/debug/reminders", reminders)
    await page.route("**/workflow/history/runs*", runs)

    try {
      await page.goto(`/${slug}/history`)

      await expect(page.locator('[data-component="history-hidden-debug-count"]')).toContainText("1")

      const toast = page.locator('[data-component="toast"]').last()
      await expect(toast).toContainText("Debug session still reconciling")
      await expect(toast).toContainText("workflow.debug has 30m until automatic stop.")

      await toast.getByRole("button", { name: "Open debug session" }).click()

      await expect(page).toHaveURL(/\/history\?tab=runs&debug=1&run_id=run-debug&workspace=wrk_1$/)
      const row = page.locator('[data-component="history-run-row"][data-id="run-debug"]')
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute("data-focused", "true")
      await expect(row.locator('[data-component="history-run-debug"]')).toContainText("Debug")
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/runs*", runs)
    }
  })
})

test("debug reminder keep running posts the scoped control request and dismisses the toast", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    let keepCount = 0

    const reminders = async (route: Route) => {
      if (new URL(route.request().url()).origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: 123,
          items: [reminder],
        }),
      })
    }

    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const includeDebug = url.searchParams.get("include_debug") === "true"
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: includeDebug ? [run] : [],
          next_cursor: null,
          hidden_debug_count: includeDebug ? 0 : 1,
        }),
      })
    }

    const keepRunning = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      keepCount += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...reminder,
          notify: false,
          last_keep_running_at: 901_000,
        }),
      })
    }

    await page.route("**/workflow/debug/reminders", reminders)
    await page.route("**/workflow/history/runs*", runs)
    await page.route("**/workflow/debug/run/run-debug/keep-running*", keepRunning)

    try {
      await page.goto(`/${slug}/history`)

      const toast = page.locator('[data-component="toast"]').last()
      await expect(toast).toContainText("Debug session still reconciling")
      await toast.getByRole("button", { name: "Keep running" }).click()

      await expect.poll(() => keepCount).toBe(1)
      await expect(page.locator('[data-component="toast"]')).toHaveCount(0)
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/runs*", runs)
      await page.unroute("**/workflow/debug/run/run-debug/keep-running*", keepRunning)
    }
  })
})

test("debug reminder stop and report requires consent and creates a metadata-only system report draft", async ({
  page,
  withProject,
}) => {
  await withProject(async ({ slug }) => {
    let reportBody: unknown

    const reminders = async (route: Route) => {
      if (new URL(route.request().url()).origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: 123,
          items: [reminder],
        }),
      })
    }

    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const includeDebug = url.searchParams.get("include_debug") === "true"
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: includeDebug ? [run] : [],
          next_cursor: null,
          hidden_debug_count: includeDebug ? 0 : 1,
        }),
      })
    }

    const debugRoute = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      if (url.pathname.endsWith("/report-preview")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            run_id: "run-debug",
            session_id: "session-debug",
            workspace_id: "wrk_1",
            workflow_id: "workflow.debug",
            status: "reconciling",
            trigger_type: "debug",
            target: "system://developers",
            targets: ["system://developers"],
            fields: [
              {
                id: "metadata",
                title: "Runtime metadata",
                required: true,
                selected: true,
                preview: "{\n  \"status\": \"cancel_requested\"\n}",
              },
              {
                id: "prompt",
                title: "Prompt transcript",
                required: false,
                selected: false,
                preview: "Prompt sample",
              },
              {
                id: "files",
                title: "Changed files",
                required: false,
                selected: false,
                preview: "README.md",
              },
            ],
          }),
        })
        return
      }

      if (!url.pathname.endsWith("/report")) {
        await route.continue()
        return
      }

      reportBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run_status: "cancel_requested",
          draft: reportDraft,
        }),
      })
    }

    const drafts = async (route: Route) => {
      if (new URL(route.request().url()).origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [reportDraft],
          next_cursor: null,
        }),
      })
    }

    await page.route("**/workflow/debug/reminders", reminders)
    await page.route("**/workflow/history/runs*", runs)
    await page.route("**/workflow/debug/run/run-debug/*", debugRoute)
    await page.route("**/workflow/history/drafts*", drafts)

    try {
      await page.goto(`/${slug}/history`)

      const toast = page.locator('[data-component="toast"]').last()
      await expect(toast).toContainText("Debug session still reconciling")
      await toast.getByRole("button", { name: "Stop and report" }).click()

      const dialog = page.locator('[data-component="debug-report-dialog"]')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText("Metadata is always included")
      const fields = dialog.locator('[data-component="debug-report-field"]')
      await expect(fields).toHaveCount(2)
      await expect(fields.nth(0).locator("input")).not.toBeChecked()
      await expect(fields.nth(1).locator("input")).not.toBeChecked()

      const submit = dialog.locator('[data-component="debug-report-submit"]')
      await expect(submit).toBeDisabled()
      await dialog.locator('[data-component="debug-report-consent"]').check()
      await expect(submit).toBeEnabled()
      await submit.click()

      await expect(page).toHaveURL(/\/history\?tab=drafts&scope=pending&draft_id=draft-report-1&workspace=wrk_1$/)
      expect(reportBody).toEqual({
        consent: true,
        target: "system://developers",
        include_prompt: false,
        include_files: false,
      })

      const row = page.locator('[data-component="history-draft-row"][data-id="draft-report-1"]')
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute("data-focused", "true")
      await expect(row.locator('[data-component="history-draft-source"]')).toContainText("System Report")
      await expect(row.locator('[data-component="history-draft-action-edit"]')).toBeDisabled()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/runs*", runs)
      await page.unroute("**/workflow/debug/run/run-debug/*", debugRoute)
      await page.unroute("**/workflow/history/drafts*", drafts)
    }
  })
})
