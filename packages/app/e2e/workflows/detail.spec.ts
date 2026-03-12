import type { Route } from "@playwright/test"
import { expect, test } from "../fixtures"
import { serverUrl } from "../utils"

const blocked = {
  item: {
    id: "workflow.blocked",
    file: ".origin/workflows/workflow.blocked.yaml",
    runnable: false,
    errors: [
      {
        code: "workflow_not_runnable",
        path: "$",
        message: "workflow contains validation errors",
      },
    ],
    workflow: {
      id: "workflow.blocked",
      name: "Blocked workflow",
      description: "Used for blocked run-state coverage",
      trigger: {
        type: "manual",
      },
      inputs: [
        {
          key: "topic",
          type: "text",
          label: "Topic",
          required: true,
        },
      ],
      resources: [],
      steps: [
        {
          id: "draft",
          kind: "agent_request",
          title: "Draft",
          prompt: {
            source: "inline",
            text: "Draft the update",
          },
        },
      ],
    },
  },
  revision_head: {
    id: "rev_blocked",
    workflow_id: "workflow.blocked",
    content_hash: "hash_blocked",
    created_at: 1,
  },
  resources: [],
  runs: [],
} as const

const signal = {
  item: {
    ...blocked.item,
    id: "workflow.signal",
    file: ".origin/workflows/workflow.signal.yaml",
    runnable: true,
    errors: [],
    workflow: {
      ...blocked.item.workflow,
      id: "workflow.signal",
      name: "Signal workflow",
      description: "Used for trigger visibility coverage",
      trigger: {
        type: "signal",
        signal: "incoming",
      },
    },
  },
  revision_head: {
    ...blocked.revision_head,
    workflow_id: "workflow.signal",
  },
  resources: [],
  runs: [],
} as const

test("workflow run tab renders explicit blocked state for non-runnable workflows", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const route = async (input: Route) => {
      const url = new URL(input.request().url())
      if (url.origin !== serverUrl) {
        await input.continue()
        return
      }

      await input.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(blocked),
      })
    }

    await page.route("**/workflow/workflows/workflow.blocked/detail*", route)

    try {
      await page.goto(`/${slug}/workflows/workflow.blocked?tab=run`)

      await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()
      await expect(page.locator('[data-component="workflow-run-form"]')).toBeVisible()
      await expect(page.getByText("Run start is blocked until validation issues are resolved.")).toBeVisible()
      await expect(page.getByRole("button", { name: "Validate Inputs" })).toBeDisabled()
      await expect(page.getByRole("button", { name: "Start Workflow" })).toBeDisabled()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/workflows/workflow.blocked/detail*", route)
    }
  })
})

test("workflow run tab surfaces signal trigger state for runnable workflows", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const route = async (input: Route) => {
      const url = new URL(input.request().url())
      if (url.origin !== serverUrl) {
        await input.continue()
        return
      }

      await input.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(signal),
      })
    }

    await page.route("**/workflow/workflows/workflow.signal/detail*", route)

    try {
      await page.goto(`/${slug}/workflows/workflow.signal?tab=run`)

      await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()
      await expect(page.locator('[data-component="workflow-run-form"]')).toBeVisible()
      await expect(page.getByText("Trigger: signal. Validate inputs first, then start a new run from the current canonical workflow files.")).toBeVisible()
      await expect(page.getByRole("button", { name: "Validate Inputs" })).toBeEnabled()
      await expect(page.getByRole("button", { name: "Start Workflow" })).toBeEnabled()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/workflows/workflow.signal/detail*", route)
    }
  })
})
