import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const workflowID = "workflow.daily"
const runID = "run_1"

const runDetail = {
  run: {
    id: runID,
    status: "ready_for_integration",
    workflow_id: workflowID,
    workspace_id: "wrk_1",
    session_id: "sess_followup",
    reason_code: null,
    failure_code: null,
    created_at: 1,
    started_at: 2,
    finished_at: 3,
    integration_candidate: {
      changed_paths: ["src/app.tsx"],
    },
  },
  snapshot: {
    id: "snap_1",
    workflow_id: workflowID,
    workflow_revision_id: "rev_1",
    workflow_hash: "hash_1",
    workflow_text: "schema_version: 2",
    graph_json: {
      id: workflowID,
      name: "Daily workflow",
      description: "Runs every morning",
      steps: [
        {
          id: "ask",
          kind: "agent_request",
          title: "Ask reviewer",
          prompt: {
            source: "inline",
            text: "Summarize changes",
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
    input_json: {
      topic: "release",
    },
    input_store_json: {
      topic: "release",
    },
    resource_materials_json: {
      "prompt.summary": "Summarize changes",
    },
  },
  revision: {
    id: "rev_1",
    workflow_id: workflowID,
    content_hash: "hash_1",
    created_at: 1,
  },
  live: {
    current_revision_id: "rev_1",
    has_newer_revision: false,
  },
  nodes: [
    {
      node: {
        id: "row_ask",
        node_id: "ask",
        kind: "agent_request",
        title: "Ask reviewer",
        status: "completed",
        skip_reason_code: null,
        output_json: {
          summary: "done",
        },
        error_json: null,
        attempt_count: 1,
      },
      step: {
        id: "ask",
        kind: "agent_request",
        title: "Ask reviewer",
        prompt: {
          source: "inline",
          text: "Summarize changes",
        },
      },
      attempts: [],
    },
  ],
  events: [
    {
      sequence: 1,
      event_type: "node.started",
      payload_json: {
        node_id: "ask",
      },
      run_node_id: "row_ask",
      run_attempt_id: null,
    },
  ],
  followup: {
    link: {
      session_id: "sess_followup",
      role: "run_followup",
      visibility: "visible",
      run_id: runID,
      run_node_id: null,
      run_attempt_id: null,
      readonly: false,
    },
    session: {
      id: "sess_followup",
      title: "Run follow-up",
      directory: "/tmp/demo",
    },
  },
} as const

test("workflow detail renders design runs resources and opens run detail", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const workflow = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      if (url.pathname === `/workflow/workflows/${workflowID}/detail`) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: {
              id: workflowID,
              file: ".origin/workflows/daily.yaml",
              runnable: true,
              errors: [],
              workflow: {
                id: workflowID,
                name: "Daily workflow",
                description: "Runs every morning",
                steps: runDetail.snapshot.graph_json.steps,
                resources: [{ id: "prompt.summary" }],
              },
            },
            revision_head: {
              id: "rev_1",
              workflow_id: workflowID,
              content_hash: "hash_1",
              created_at: 1,
            },
            resources: [
              {
                id: "prompt.summary",
                source: "library",
                kind: "prompt_template",
                item_id: "lib.prompt.summary",
                used_by: ["ask"],
                errors: [],
              },
            ],
            runs: [
              {
                id: runID,
                status: "ready_for_integration",
                workflow_id: workflowID,
                workspace_id: "wrk_1",
                created_at: 1,
                started_at: 2,
                finished_at: 3,
                reason_code: null,
                failure_code: null,
              },
            ],
          }),
        })
        return
      }

      if (url.pathname === `/workflow/runs/${runID}/detail`) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(runDetail),
        })
        return
      }

      await route.continue()
    }

    await page.route("**/workflow/**", workflow)
    try {
      await page.goto(`/${slug}/workflows/${workflowID}`)

      await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()
      await expect(page.locator('[data-component="workflow-graph"]')).toBeVisible()
      await expect(page.locator('[data-component="graph-node"][data-node-id="ask"]')).toBeVisible()

      await page.getByRole("tab", { name: "Resources" }).click()
      const resource = page.locator('[data-component="workflow-detail-resource-row"][data-resource-id="prompt.summary"]')
      await expect(resource).toBeVisible()
      await expect(resource).toContainText("lib.prompt.summary")
      await expect(resource).toContainText("Used by: ask")

      await page.getByRole("tab", { name: "Runs" }).click()
      const row = page.locator(`[data-component="workflow-detail-run-row"][data-run-id="${runID}"]`)
      await expect(row).toBeVisible()
      await row.getByRole("button", { name: "Open Run" }).click()

      await expect(page).toHaveURL(new RegExp(`/runs/${runID}$`))
      await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
      await expect(page.locator('[data-component="workflow-graph"]')).toBeVisible()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/**", workflow)
    }
  })
})
