import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { dirSlug, serverUrl } from "../utils"

const run = {
  id: "run-security",
  status: "reconciling",
  trigger_type: "debug",
  workflow_id: "workflow.debug",
  workspace_id: "wrk_security",
  session_id: "session-security",
  reason_code: null,
  failure_code: null,
  ready_for_integration_at: null,
  created_at: 500,
  updated_at: 500,
  started_at: 500,
  finished_at: null,
  operation_id: "op-security",
  operation_exists: true,
  trigger_metadata: null,
  duplicate_event: {
    reason: false,
    failure: false,
  },
  debug: true,
} as const

const reminder = {
  run_id: "run-security",
  session_id: "session-security",
  workspace_id: "wrk_security",
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
  id: "draft-security-report",
  run_id: "run-security",
  workspace_id: "wrk_security",
  status: "pending",
  source_kind: "system_report",
  adapter_id: "system",
  integration_id: "system/default",
  action_id: "report.dispatch",
  target: "system://developers",
  payload_json: {
    metadata: {
      run_id: "run-security",
    },
  },
  payload_schema_version: 1,
  preview_text: "Debug report for run-security",
  material_hash: "hash-security",
  block_reason_code: null,
  policy_id: "policy/outbound-default",
  policy_version: "13",
  decision_id: "decision-security",
  decision_reason_code: "policy_allow",
  created_at: 600,
  updated_at: 601,
  dispatch: null,
} as const

async function workspaceID(directory: string) {
  const listed = await fetch(`${serverUrl}/experimental/workspace?directory=${encodeURIComponent(directory)}`).then((response) =>
    response.json(),
  )
  const rows = Array.isArray(listed) ? listed : []
  const match = rows.find(
    (item): item is { id: string; directory?: string; config?: { directory?: string } } =>
      !!item &&
      typeof item === "object" &&
      "id" in item &&
      ((item as { directory?: string }).directory === directory ||
        (item as { config?: { directory?: string } }).config?.directory === directory),
  )
  if (match) return match.id

  const id = `wrk_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`
  const created = await fetch(`${serverUrl}/experimental/workspace/${id}?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: null,
      config: {
        type: "worktree",
        directory,
      },
    }),
  }).then((response) => response.json())

  if (!created || typeof created !== "object" || !("id" in created) || typeof created.id !== "string") {
    throw new Error(`failed to create workspace for ${directory}`)
  }
  return created.id
}

test("standard workspaces keep outbound attempts hard-blocked with remediation", async ({ page, withProject }) => {
  await withProject(async ({ directory, slug }) => {
    const workspace = await workspaceID(directory)
    await page.goto(`/${slug}/history?tab=drafts&scope=pending&workspace=${encodeURIComponent(workspace)}`)
    await expect(page.locator('[data-page="history"]')).toBeVisible()

    await page.locator('[data-component="history-draft-create-toggle"]').click()
    const create = page.locator('[data-component="history-draft-create-form"]')
    await create.getByLabel("Payload JSON").fill('{\n  "text": "blocked by workspace policy"\n}')
    await create.getByRole("button", { name: "Create Draft" }).click()

    const row = page.locator('[data-component="history-draft-row"]').filter({ hasText: "blocked by workspace policy" })
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute("data-status", "blocked")
    await expect(row.locator('[data-component="history-draft-reason"][data-code="workspace_policy_blocked"]')).toBeVisible()
    await expect(row.locator('[data-component="history-draft-remediation"]')).toContainText("Origin workspaces")
  })
})

test("system report flow requires consent and only submits allowlisted fields to the developers target", async ({
  page,
  withProject,
}) => {
  await withProject(async ({ directory }) => {
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
            run_id: run.id,
            session_id: run.session_id,
            workspace_id: run.workspace_id,
            workflow_id: run.workflow_id,
            status: run.status,
            trigger_type: run.trigger_type,
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
    await page.route("**/workflow/debug/run/run-security/*", debugRoute)
    await page.route("**/workflow/history/drafts*", drafts)

    try {
      const slug = dirSlug(directory)
      await page.goto(`/${slug}/history`)

      const toast = page.locator('[data-component="toast"]').last()
      await expect(toast).toContainText("Debug session still reconciling")
      await toast.getByRole("button", { name: "Stop and report" }).click()

      const dialog = page.locator('[data-component="debug-report-dialog"]')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText("Metadata is always included")

      const submit = dialog.locator('[data-component="debug-report-submit"]')
      await expect(submit).toBeDisabled()
      await dialog.locator('[data-component="debug-report-consent"]').check()
      await expect(submit).toBeEnabled()
      await submit.click()

      expect(reportBody).toEqual({
        consent: true,
        target: "system://developers",
        include_prompt: false,
        include_files: false,
      })

      const row = page.locator('[data-component="history-draft-row"][data-id="draft-security-report"]')
      await expect(row).toBeVisible()
      await expect(row.locator('[data-component="history-draft-source"]')).toContainText("System Report")
      await expect(row.locator('[data-component="history-draft-action-edit"]')).toBeDisabled()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/runs*", runs)
      await page.unroute("**/workflow/debug/run/run-security/*", debugRoute)
      await page.unroute("**/workflow/history/drafts*", drafts)
    }
  })
})
