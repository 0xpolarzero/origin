import { expect, test } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const list = [
  {
    id: "lib.prompt.summary",
    file: ".origin/library/lib.prompt.summary.yaml",
    runnable: true,
    errors: [],
    used_by: ["workflow.daily"],
    last_edited_at: 500,
    resource: {
      schema_version: 1,
      id: "lib.prompt.summary",
      name: "Summary prompt",
      kind: "prompt_template",
      template: "Summarize the current release",
      links: ["docs/release.md"],
    },
  },
  {
    id: "lib.script.cleanup",
    file: ".origin/library/lib.script.cleanup.yaml",
    runnable: false,
    errors: [
      {
        code: "validation.invalid_script",
        path: "script",
        message: "Script body is empty.",
      },
    ],
    used_by: [],
    last_edited_at: 100,
    resource: {
      schema_version: 1,
      id: "lib.script.cleanup",
      name: "Cleanup script",
      kind: "script",
      script: "",
      links: [],
    },
  },
] as const

const workflow = {
  item: {
    id: "workflow.daily",
    file: ".origin/workflows/workflow.daily.yaml",
    runnable: true,
    errors: [],
    workflow: {
      id: "workflow.daily",
      name: "Daily workflow",
      description: "Linked from library usage.",
      trigger: {
        type: "manual",
      },
      inputs: [],
      resources: [],
      steps: [
        {
          id: "draft",
          kind: "agent_request",
          title: "Draft",
          prompt: {
            source: "inline",
            text: "Draft the summary",
          },
        },
        {
          id: "done",
          kind: "end",
          title: "Done",
          result: "success",
        },
      ],
    },
  },
  revision_head: {
    id: "01958f0f-4cd2-7d59-975d-57fd8d8d42b0",
    workflow_id: "workflow.daily",
    content_hash: "hash_workflow",
    created_at: 9,
  },
  resources: [],
  runs: [],
} as const

test("library index supports search, filters, and detail navigation", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const api = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      if (url.pathname === "/library") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(list),
        })
        return
      }

      if (url.pathname === "/library/items/lib.prompt.summary") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: list[0],
            revision_head: {
              id: "01958f0f-4cd2-7d59-975d-57fd8d8d42b0",
              project_id: "project_1",
              item_id: "lib.prompt.summary",
              file: ".origin/library/lib.prompt.summary.yaml",
              content_hash: "hash_1",
              canonical_text: "name: Summary prompt",
              created_at: 500,
              updated_at: 500,
            },
            canonical_text: "name: Summary prompt",
            used_by: [
              {
                workflow_id: "workflow.daily",
                name: "Daily workflow",
                file: ".origin/workflows/workflow.daily.yaml",
              },
            ],
          }),
        })
        return
      }

      if (url.pathname === "/library/items/lib.prompt.summary/history") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                revision: {
                  id: "01958f0f-4cd2-7d59-975d-57fd8d8d42b0",
                  project_id: "project_1",
                  item_id: "lib.prompt.summary",
                  file: ".origin/library/lib.prompt.summary.yaml",
                  content_hash: "hash_1",
                  canonical_text: "name: Summary prompt",
                  created_at: 500,
                  updated_at: 500,
                },
                previous_revision: null,
                diff: "+name: Summary prompt",
              },
            ],
            next_cursor: null,
          }),
        })
        return
      }

      if (url.pathname === "/workflow/workflows/workflow.daily/detail") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(workflow),
        })
        return
      }

      await route.continue()
    }

    await page.route("**/*", api)

    try {
      await page.goto(`/${slug}/library`)
      await expect(page.locator('[data-page="library"]')).toBeVisible()
      await expect(page.locator('[data-component="library-row"]')).toHaveCount(2)

      await page.getByLabel("Search").fill("summary")
      await expect(page.locator('[data-component="library-row"][data-id="lib.prompt.summary"]')).toBeVisible()
      await expect(page.locator('[data-component="library-row"][data-id="lib.script.cleanup"]')).toHaveCount(0)

      await page.getByRole("button", { name: "used" }).click()
      await expect(page.locator('[data-component="library-row"]')).toHaveCount(1)
      await expect(page.locator('[data-component="library-row"][data-id="lib.prompt.summary"]')).toBeVisible()

      await page.getByRole("button", { name: "Open resource" }).click()
      await expect(page).toHaveURL(new RegExp(`/library/lib\\.prompt\\.summary$`))
      await expect(page.locator('[data-page="library-detail"]')).toBeVisible()
      await expect(page.getByText("Summary prompt")).toBeVisible()

      await page.getByRole("tab", { name: "Used By" }).click()
      await expect(page.locator('[data-component="library-used-row"][data-workflow-id="workflow.daily"]')).toBeVisible()
      await page.getByRole("button", { name: "Open workflow" }).click()
      await expect(page).toHaveURL(new RegExp(`/workflows/workflow\\.daily$`))
      await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()

      await page.goBack()
      await page.getByRole("tab", { name: "History" }).click()
      await expect(page.locator('[data-component="library-history-row"]')).toHaveCount(1)
      await expect(page.getByText("+name: Summary prompt")).toBeVisible()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/*", api)
    }
  })
})

test("library detail edits shared content, creates local copies, and blocks in-use delete", async ({
  page,
  withProject,
}) => {
  await withProject(async ({ slug }) => {
    const state = {
      prompt: {
        item: list[0],
        revision_head: {
          id: "01958f0f-4cd2-7d59-975d-57fd8d8d42b0",
          project_id: "project_1",
          item_id: "lib.prompt.summary",
          file: ".origin/library/lib.prompt.summary.yaml",
          content_hash: "hash_1",
          canonical_text: "name: Summary prompt",
          created_at: 500,
          updated_at: 500,
        },
        canonical_text: "name: Summary prompt",
        used_by: [
          {
            workflow_id: "workflow.daily",
            name: "Daily workflow",
            file: ".origin/workflows/workflow.daily.yaml",
          },
        ],
      },
      unused: {
        item: {
          ...list[1],
          runnable: true,
          errors: [],
        },
        revision_head: {
          id: "01958f0f-4cd2-7d59-975d-57fd8d8d42b1",
          project_id: "project_1",
          item_id: "lib.script.cleanup",
          file: ".origin/library/lib.script.cleanup.yaml",
          content_hash: "hash_2",
          canonical_text: "name: Cleanup script",
          created_at: 100,
          updated_at: 100,
        },
        canonical_text: "name: Cleanup script",
        used_by: [],
      },
    }

    const api = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      if (url.pathname === "/library") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(list),
        })
        return
      }

      if (url.pathname === "/library/items/lib.prompt.summary" && route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(state.prompt),
        })
        return
      }

      if (url.pathname === "/library/items/lib.prompt.summary" && route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { text: string }
        state.prompt = {
          ...state.prompt,
          revision_head: {
            ...state.prompt.revision_head,
            id: "01958f0f-4cd2-7d59-975d-57fd8d8d42b9",
            content_hash: "hash_saved",
            canonical_text: body.text,
            created_at: 700,
            updated_at: 700,
          },
          canonical_text: body.text,
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(state.prompt),
        })
        return
      }

      if (url.pathname === "/library/items/lib.prompt.summary/history") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                revision: state.prompt.revision_head,
                previous_revision: null,
                diff: `+${state.prompt.canonical_text}`,
              },
            ],
            next_cursor: null,
          }),
        })
        return
      }

      if (url.pathname === "/library/items/lib.prompt.summary/copy") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workflow_id: "workflow.daily",
            resources: [
              {
                id: "prompt.summary",
                path: "resources/prompt.summary.txt",
              },
            ],
          }),
        })
        return
      }

      if (url.pathname === "/library/items/lib.script.cleanup" && route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(state.unused),
        })
        return
      }

      if (url.pathname === "/library/items/lib.script.cleanup/history") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [],
            next_cursor: null,
          }),
        })
        return
      }

      if (url.pathname === "/library/items/lib.script.cleanup" && route.request().method() === "DELETE") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            deleted: true,
          }),
        })
        return
      }

      await route.continue()
    }

    await page.route("**/*", api)

    try {
      await page.goto(`/${slug}/library/lib.prompt.summary`)
      await expect(page.locator('[data-page="library-detail"]')).toBeVisible()

      await page.getByLabel("YAML").fill("name: Updated summary prompt")
      await page.getByRole("button", { name: "Save shared item" }).click()
      await expect(page.getByText("Saved canonical shared resource.")).toBeVisible()

      await page.getByRole("tab", { name: "Used By" }).click()
      await page.getByRole("button", { name: "Create local copy" }).click()
      await expect(page.getByText("Created 1 workflow-local resource copy for workflow.daily.")).toBeVisible()

      await page.getByRole("button", { name: "Delete" }).click()
      await expect(page.locator('[data-component="library-delete-block"]')).toBeVisible()
      await expect(
        page.getByText("Remove workflow references or create workflow-local copies before deleting this shared item."),
      ).toBeVisible()

      await page.goto(`/${slug}/library/lib.script.cleanup`)
      await expect(page.locator('[data-page="library-detail"]')).toBeVisible()
      await page.getByRole("button", { name: "Delete" }).click()
      await expect(page).toHaveURL(new RegExp(`/library$`))
      await expect(page.locator('[data-page="library"]')).toBeVisible()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/*", api)
    }
  })
})
