import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const runID = "run_1"

const payload = {
  run: {
    id: runID,
    status: "ready_for_integration",
    workflow_id: "workflow.daily",
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
    workflow_id: "workflow.daily",
    workflow_revision_id: "rev_1",
    workflow_hash: "hash_1",
    workflow_text: "schema_version: 2",
    graph_json: {
      id: "workflow.daily",
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
      summary: "Long summary",
      count: 42,
      dry_run: false,
      mode: "stable",
      artifact: "/tmp/origin/.origin/materials/run_1/inputs/artifact/release.txt",
    },
    input_store_json: {
      topic: {
        type: "text",
      },
      summary: {
        type: "long_text",
      },
      count: {
        type: "number",
      },
      dry_run: {
        type: "boolean",
      },
      mode: {
        type: "select",
      },
      artifact: {
        type: "path",
        mode: "file",
        original_path: "/tmp/input/release.txt",
        snapshot_path: "/tmp/origin/.origin/materials/run_1/inputs/artifact/release.txt",
        kind: "file",
        size: 12,
        mtime_ms: 7,
      },
    },
    resource_materials_json: {
      "prompt.summary": "Summarize changes",
    },
  },
  revision: {
    id: "rev_1",
    workflow_id: "workflow.daily",
    content_hash: "hash_1",
    created_at: 1,
  },
  live: {
    current_revision_id: "rev_2",
    has_newer_revision: true,
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
      attempts: [
        {
          attempt: {
            id: "attempt_1",
            attempt_index: 1,
            status: "completed",
            session_id: "sess_exec",
            output_json: {
              stdout: "ok",
              stderr: "",
              changed_paths: ["src/app.tsx"],
            },
            error_json: null,
            started_at: 2,
            finished_at: 3,
          },
          session: {
            link: {
              session_id: "sess_exec",
              role: "execution_node",
              visibility: "hidden",
              run_id: runID,
              run_node_id: "row_ask",
              run_attempt_id: "attempt_1",
              readonly: true,
            },
            session: {
              id: "sess_exec",
              title: "Ask execution",
              directory: "/tmp/demo",
            },
          },
        },
      ],
    },
    {
      node: {
        id: "row_done",
        node_id: "done",
        kind: "end",
        title: "Done",
        status: "completed",
        skip_reason_code: null,
        output_json: {
          result: "success",
        },
        error_json: null,
        attempt_count: 0,
      },
      step: {
        id: "done",
        kind: "end",
        title: "Done",
        result: "success",
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

test("run detail uses URL state for node panels and attempt selection", async ({ page, withProject }) => {
  await withProject(async ({ slug }) => {
    const runs = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      if (url.pathname === `/workflow/runs/${runID}/detail`) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(payload),
        })
        return
      }

      await route.continue()
    }

    await page.route("**/workflow/**", runs)
    try {
      await page.goto(`/${slug}/runs/${runID}?node=ask&panel=attempts&attempt=1`)

      await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
      await expect(page.locator('[data-component="run-node-panel"]')).toHaveAttribute("data-node-id", "ask")
      await expect(page.locator('[data-component="run-node-attempt-row"][data-attempt="1"]')).toBeVisible()
      await expect(page.getByText('"count": 42')).toBeVisible()
      await expect(page.getByText('"dry_run": false')).toBeVisible()
      await expect(page.getByText('"mode": "stable"')).toBeVisible()
      await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText('"type": "boolean"')
      await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText('"snapshot_path"')
      await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText("/tmp/input/release.txt")

      await page.locator('[data-component="run-node-panel-trigger"][data-panel="logs"]').click()
      await expect(page).toHaveURL(new RegExp(`/runs/${runID}\\?node=ask&panel=logs&attempt=1$`))
      await expect(page.getByText("stdout")).toBeVisible()

      await page.locator('[data-component="graph-node"][data-node-id="done"]').click()
      await expect(page.locator('[data-component="run-node-panel"]')).toHaveAttribute("data-node-id", "done")
      await expect(page).toHaveURL(new RegExp(`/runs/${runID}\\?node=done&panel=summary$`))
      await expect(page.getByText("Node Output")).toBeVisible()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/**", runs)
    }
  })
})
