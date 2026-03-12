import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

test("workflows view renders non-runnable validation rows from backend list contract", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const workflows = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "wf-invalid",
              kind: "workflow",
              name: "daily",
              path: ".origin/workflows/daily.yaml",
              runnable: false,
              errors: [
                {
                  code: "workflow.missing_ref",
                  path: "steps[0].uses",
                  message: "Missing library resource",
                },
              ],
            },
            {
              id: "wf-valid",
              kind: "workflow",
              name: "weekly",
              path: ".origin/workflows/weekly.yaml",
              runnable: true,
              errors: [],
            },
          ],
        }),
      })
    }

    await page.route("**/workflow*", workflows)
    try {
      await page.goto(`/${slug}/workflows`)

      const invalid = page.locator('[data-component="validation-resource-row"][data-id="wf-invalid"]')
      await expect(invalid).toBeVisible()
      await expect(invalid).toHaveAttribute("data-runnable", "false")
      await expect(invalid.locator('[data-component="validation-state"]')).toHaveText("Non-runnable")

      const invalidError = invalid.locator('[data-component="validation-error-row"]').first()
      await expect(invalidError).toBeVisible()
      await expect(invalidError).toContainText("workflow.missing_ref")
      await expect(invalidError).toContainText("steps[0].uses")
      await expect(invalidError).toContainText("Missing library resource")

      const valid = page.locator('[data-component="validation-resource-row"][data-id="wf-valid"]')
      await expect(valid).toBeVisible()
      await expect(valid).toHaveAttribute("data-runnable", "true")
      await expect(valid.locator('[data-component="validation-state"]')).toHaveText("Runnable")
    } finally {
      await page.unroute("**/workflow*", workflows)
    }
  })
})

test("library view renders non-runnable validation rows from backend list contract", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const libraries = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "lib-invalid",
            file: ".origin/library/summary-template.yaml",
            resource: {
              schema_version: 1,
              id: "lib-invalid",
              name: "summary-template",
              kind: "prompt_template",
              template: "Summarize {{input}}",
              links: [],
            },
            runnable: false,
            used_by: [],
            last_edited_at: null,
            errors: [
              {
                code: "library.kind_invalid",
                path: "kind",
                message: "Unsupported library kind for workspace type",
              },
            ],
          },
          {
            id: "lib-valid",
            file: ".origin/library/fetch-open-items.yaml",
            resource: {
              schema_version: 1,
              id: "lib-valid",
              name: "fetch-open-items",
              kind: "query",
              query: "SELECT * FROM open_items",
              links: [],
            },
            runnable: true,
            used_by: [],
            last_edited_at: null,
            errors: [],
          },
        ]),
      })
    }

    await page.route("**/library*", libraries)
    try {
      await page.goto(`/${slug}/library`)

      const invalid = page.locator('[data-component="library-row"][data-id="lib-invalid"]')
      await expect(invalid).toBeVisible()
      await expect(invalid).toHaveAttribute("data-runnable", "false")
      await expect(invalid).toContainText("Non-runnable")

      await expect(invalid).toContainText("library.kind_invalid")
      await expect(invalid).toContainText("kind")
      await expect(invalid).toContainText("Unsupported library kind for workspace type")

      const valid = page.locator('[data-component="library-row"][data-id="lib-valid"]')
      await expect(valid).toBeVisible()
      await expect(valid).toHaveAttribute("data-runnable", "true")
      await expect(valid).toContainText("Runnable")
    } finally {
      await page.unroute("**/library*", libraries)
    }
  })
})
