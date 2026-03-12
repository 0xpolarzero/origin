import type { Page, Route } from "@playwright/test"
import { expect, test } from "../fixtures"
import { serverUrl } from "../utils"

const workflow = {
  item: {
    id: "workflow.daily",
    file: ".origin/workflows/workflow.daily.yaml",
    runnable: true,
    errors: [],
    workflow: {
      id: "workflow.daily",
      name: "Daily workflow",
      description: "Deep-link target",
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
            text: "Draft the release notes",
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
    id: "rev-workflow-2",
    workflow_id: "workflow.daily",
    content_hash: "hash-workflow-2",
    created_at: 320,
  },
  resources: [],
  runs: [],
} as const

const workflowHistory = {
  items: [
    {
      edit: {
        id: "edit-main",
        workflow_id: "workflow.daily",
        workflow_revision_id: "rev-workflow-2",
        previous_workflow_revision_id: "rev-workflow-1",
        session_id: "session-builder",
        action: "graph_edit",
        node_id: "draft",
        note: "Rename the draft step",
        created_at: 320,
      },
      revision: {
        id: "rev-workflow-2",
        workflow_id: "workflow.daily",
        file: ".origin/workflows/workflow.daily.yaml",
        content_hash: "hash-workflow-2",
        canonical_text: "name: Daily workflow edited",
        created_at: 320,
      },
      previous_revision: {
        id: "rev-workflow-1",
        workflow_id: "workflow.daily",
        file: ".origin/workflows/workflow.daily.yaml",
        content_hash: "hash-workflow-1",
        canonical_text: "name: Daily workflow",
        created_at: 300,
      },
      diff: [
        "*** .origin/workflows/workflow.daily.yaml",
        "--- previous",
        "+++ current",
        "@@",
        "-name: Daily workflow",
        "+name: Daily workflow edited",
      ].join("\n"),
      session: {
        id: "session-builder",
        title: "Builder: Daily workflow",
        directory: "/tmp/demo",
      },
    },
  ],
  next_cursor: null,
} as const

const run = {
  run: {
    id: "run-main",
    status: "ready_for_integration",
    workflow_id: "workflow.daily",
    workspace_id: "wrk_1",
    session_id: "session-followup",
    reason_code: null,
    failure_code: null,
    created_at: 500,
    started_at: 501,
    finished_at: 502,
    integration_candidate: {
      changed_paths: ["README.md"],
    },
  },
  snapshot: {
    id: "snap-main",
    workflow_id: "workflow.daily",
    workflow_revision_id: "rev-workflow-2",
    workflow_hash: "hash-workflow-2",
    workflow_text: "schema_version: 2",
    graph_json: {
      id: "workflow.daily",
      name: "Daily workflow",
      description: "Deep-link target",
      steps: workflow.item.workflow.steps,
    },
    input_json: {},
    input_store_json: {},
    resource_materials_json: {},
  },
  revision: {
    id: "rev-workflow-2",
    workflow_id: "workflow.daily",
    content_hash: "hash-workflow-2",
    created_at: 320,
  },
  live: {
    current_revision_id: "rev-workflow-2",
    has_newer_revision: false,
  },
  nodes: [
    {
      node: {
        id: "row-draft",
        node_id: "draft",
        kind: "agent_request",
        title: "Draft",
        status: "completed",
        skip_reason_code: null,
        output_json: {
          summary: "done",
        },
        error_json: null,
        attempt_count: 1,
      },
      step: workflow.item.workflow.steps[0],
      attempts: [
        {
          attempt: {
            id: "attempt-main",
            attempt_index: 1,
            status: "completed",
            session_id: "session-exec",
            output_json: {
              stdout: "ok",
              stderr: "",
            },
            error_json: null,
            started_at: 501,
            finished_at: 502,
          },
          session: {
            link: {
              session_id: "session-exec",
              role: "execution_node",
              visibility: "hidden",
              run_id: "run-main",
              run_node_id: "row-draft",
              run_attempt_id: "attempt-main",
              readonly: true,
            },
            session: {
              id: "session-exec",
              title: "Draft execution",
              directory: "/tmp/demo",
            },
          },
        },
      ],
    },
    {
      node: {
        id: "row-done",
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
      step: workflow.item.workflow.steps[1],
      attempts: [],
    },
  ],
  events: [
    {
      sequence: 1,
      event_type: "node.started",
      payload_json: {
        node_id: "draft",
      },
      run_node_id: "row-draft",
      run_attempt_id: null,
    },
  ],
  followup: {
    link: {
      session_id: "session-followup",
      role: "run_followup",
      visibility: "visible",
      run_id: "run-main",
      run_node_id: null,
      run_attempt_id: null,
      readonly: false,
    },
    session: {
      id: "session-followup",
      title: "Run follow-up",
      directory: "/tmp/demo",
    },
  },
} as const

const edits = {
  items: [
    {
      edit: {
        id: "edit-main",
        project_id: "project-1",
        workflow_id: "workflow.daily",
        workflow_revision_id: "rev-workflow-2",
        previous_workflow_revision_id: "rev-workflow-1",
        session_id: "session-builder",
        action: "graph_edit",
        node_id: "draft",
        note: "Rename the draft step",
        created_at: 320,
        updated_at: 321,
      },
      revision: {
        id: "rev-workflow-2",
        project_id: "project-1",
        workflow_id: "workflow.daily",
        file: ".origin/workflows/workflow.daily.yaml",
        content_hash: "hash-workflow-2",
        canonical_text: "name: Daily workflow edited",
        created_at: 320,
        updated_at: 321,
      },
      previous_revision: {
        id: "rev-workflow-1",
        project_id: "project-1",
        workflow_id: "workflow.daily",
        file: ".origin/workflows/workflow.daily.yaml",
        content_hash: "hash-workflow-1",
        canonical_text: "name: Daily workflow",
        created_at: 300,
        updated_at: 300,
      },
      diff: [
        "*** .origin/workflows/workflow.daily.yaml",
        "--- previous",
        "+++ current",
        "@@",
        "-name: Daily workflow",
        "+name: Daily workflow edited",
      ].join("\n"),
      session: {
        id: "session-builder",
        title: "Builder: Daily workflow",
        directory: "/tmp/demo",
      },
    },
  ],
  next_cursor: null,
} as const

const seed = async (page: Page, url: string) => {
  await page.addInitScript((next) => {
    const win = window as Window & {
      __OPENCODE__?: {
        deepLinks?: string[]
      }
    }
    win.__OPENCODE__ = {
      ...(win.__OPENCODE__ ?? {}),
      deepLinks: [next],
    }
  }, url)
}

const wire = async (page: Page) => {
  const api = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
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

    if (url.pathname === "/workflow/workflows/workflow.daily/history") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(workflowHistory),
      })
      return
    }

    if (url.pathname === "/workflow/runs/run-main/detail") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(run),
      })
      return
    }

    if (url.pathname === "/workflow/history/edits") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(edits),
      })
      return
    }

    await route.continue()
  }

  await page.route("**/*", api)
  return async () => {
    if (page.isClosed()) return
    await page.unroute("**/*", api)
  }
}

test("startup deep link opens workflow detail on a durable route", async ({ page, directory, slug }) => {
  await seed(
    page,
    `origin://open-project?directory=${encodeURIComponent(directory)}&target=workflow&workflow_id=workflow.daily`,
  )
  const clear = await wire(page)
  try {
    await page.goto(`/${slug}/session`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/workflows/workflow\\.daily$`))
    await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()
    await expect(page.locator('[data-component="sidebar-destination"][data-view="workflows"]:visible')).toHaveAttribute(
      "aria-current",
      "page",
    )
  } finally {
    await clear()
  }
})

test("startup deep link opens workflow edit history on a durable route", async ({ page, directory, slug }) => {
  await seed(
    page,
    `origin://open-project?directory=${encodeURIComponent(directory)}&target=workflow-edit&workflow_id=workflow.daily&edit_id=edit-main`,
  )
  const clear = await wire(page)
  try {
    await page.goto(`/${slug}/session`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/workflows/workflow\\.daily\\?tab=history&edit_id=edit-main$`))
    await expect(page.locator('[data-component="workflow-history-row"][data-edit-id="edit-main"]')).toBeVisible()
    await expect(page.getByRole("tab", { name: "Edit History" })).toHaveAttribute("aria-selected", "true")
  } finally {
    await clear()
  }
})

test("startup deep link opens run detail on a durable route", async ({ page, directory, slug }) => {
  await seed(page, `origin://open-project?directory=${encodeURIComponent(directory)}&target=run&run_id=run-main`)
  const clear = await wire(page)
  try {
    await page.goto(`/${slug}/session`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/runs/run-main$`))
    await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
    await expect(page.locator('[data-component="sidebar-destination"][data-view="runs"]:visible')).toHaveAttribute(
      "aria-current",
      "page",
    )
  } finally {
    await clear()
  }
})

test("startup deep link opens focused history state on a durable route", async ({ page, directory, slug }) => {
  await seed(
    page,
    `origin://open-project?directory=${encodeURIComponent(directory)}&target=history&edit_id=edit-main&workspace=wrk_1`,
  )
  const clear = await wire(page)
  try {
    await page.goto(`/${slug}/session`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/history\\?tab=edits&edit_id=edit-main&workspace=wrk_1$`))
    await expect(page.locator('[data-page="history"]')).toBeVisible()
    await expect(page.locator('[data-component="history-edit-row"][data-id="edit-main"]')).toHaveAttribute(
      "data-focused",
      "true",
    )
    await expect(page.locator('[data-component="sidebar-destination"][data-view="history"]:visible')).toHaveAttribute(
      "aria-current",
      "page",
    )
  } finally {
    await clear()
  }
})
