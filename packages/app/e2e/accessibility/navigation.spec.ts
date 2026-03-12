import fs from "node:fs/promises"
import path from "node:path"
import type { Route } from "@playwright/test"
import { expect, test } from "../fixtures"
import { openSidebar } from "../actions"
import { serverUrl } from "../utils"

async function write(dir: string, id: string) {
  const root = path.join(dir, ".origin", "workflows")
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    path.join(root, `${id}.yaml`),
    [
      "schema_version: 2",
      `id: ${id}`,
      "name: Accessibility workflow",
      "description: Exercise keyboard navigation across workflow tabs",
      "trigger:",
      "  type: manual",
      "steps:",
      "  - id: ask",
      "    kind: agent_request",
      "    title: Ask reviewer",
      "    prompt:",
      "      source: inline",
      "      text: Summarize the release status.",
      "  - id: done",
      "    kind: end",
      "    title: Done",
      "    result: success",
    ].join("\n"),
    "utf8",
  )
}

const item = {
  item: {
    id: "workflow.daily",
    file: ".origin/workflows/workflow.daily.yaml",
    runnable: true,
    errors: [],
    workflow: {
      id: "workflow.daily",
      name: "Daily workflow",
      description: "Run panel keyboard target",
      trigger: {
        type: "manual",
      },
      inputs: [],
      resources: [],
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
  },
  revision_head: {
    id: "rev_2",
    workflow_id: "workflow.daily",
    content_hash: "hash_2",
    created_at: 4,
  },
  resources: [],
  runs: [],
} as const

const run = {
  run: {
    id: "run_1",
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
    graph_json: item.item.workflow,
    input_json: {},
    input_store_json: {},
    resource_materials_json: {},
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
      step: item.item.workflow.steps[0],
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
              run_id: "run_1",
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
      step: item.item.workflow.steps[1],
      attempts: [],
    },
  ],
  events: [],
  followup: {
    link: {
      session_id: "sess_followup",
      role: "run_followup",
      visibility: "visible",
      run_id: "run_1",
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

const lib = {
  item: {
    id: "prompt.shared",
    file: ".origin/library/prompt.shared.yaml",
    runnable: true,
    errors: [],
    used_by: ["workflow.daily"],
    last_edited_at: 123,
    resource: {
      schema_version: 1,
      id: "prompt.shared",
      name: "Shared prompt",
      kind: "prompt_template",
      template: "Draft the release summary.",
      links: [],
    },
  },
  revision_head: {
    id: "lib_rev_1",
    item_id: "prompt.shared",
    file: ".origin/library/prompt.shared.yaml",
    content_hash: "hash",
    canonical_text: "name: Shared prompt",
    created_at: 1,
    updated_at: 1,
  },
  canonical_text: "name: Shared prompt",
  used_by: [
    {
      workflow_id: "workflow.daily",
      name: "Daily workflow",
      file: ".origin/workflows/workflow.daily.yaml",
    },
  ],
} as const

const hist = {
  items: [
    {
      revision: {
        id: "lib_rev_1",
        item_id: "prompt.shared",
        file: ".origin/library/prompt.shared.yaml",
        content_hash: "hash",
        canonical_text: "name: Shared prompt",
        created_at: 1,
        updated_at: 1,
      },
      previous_revision: null,
      diff: "+name: Shared prompt",
    },
  ],
  next_cursor: null,
} as const

const empty = {
  items: [],
  next_cursor: null,
  hidden_debug_count: 0,
} as const

const historyRuns = {
  items: [
    {
      id: "run_1",
      status: "ready_for_integration",
      trigger_type: "manual",
      workflow_id: "workflow.daily",
      workspace_id: "wrk_1",
      session_id: "sess_followup",
      reason_code: null,
      failure_code: null,
      ready_for_integration_at: 3,
      created_at: 1,
      updated_at: 3,
      started_at: 2,
      finished_at: 3,
      operation_id: "op_1",
      operation_exists: true,
      trigger_metadata: null,
      duplicate_event: {
        reason: false,
        failure: false,
      },
      debug: false,
    },
  ],
  next_cursor: null,
  hidden_debug_count: 0,
} as const

test("desktop destinations and settings dialog are keyboard operable", async ({ page, gotoSession, slug }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await gotoSession()
  await openSidebar(page)

  const nav = page.locator('[data-component="sidebar-nav-desktop"]')
  const ses = nav.getByRole("button", { name: "Sessions" }).first()
  const flows = nav.getByRole("button", { name: "Workflows" }).first()
  const libs = nav.getByRole("button", { name: "Library" }).first()
  const runs = nav.getByRole("button", { name: "Runs" }).first()
  const hist = nav.getByRole("button", { name: "History" }).first()

  await expect(ses).toBeVisible()
  await expect(flows).toBeVisible()
  await expect(libs).toBeVisible()
  await expect(runs).toBeVisible()
  await expect(hist).toBeVisible()

  await ses.click()
  await expect(ses).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(flows).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(ses).toBeFocused()

  await page.keyboard.press("Tab")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/${slug}/workflows$`))
  await expect(flows).toHaveAttribute("aria-current", "page")

  await libs.press("Space")
  await expect(page).toHaveURL(new RegExp(`/${slug}/library$`))
  await expect(libs).toHaveAttribute("aria-current", "page")

  await runs.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/${slug}/runs$`))
  await expect(runs).toHaveAttribute("aria-current", "page")

  await hist.press("Space")
  await expect(page).toHaveURL(new RegExp(`/${slug}/history$`))
  await expect(hist).toHaveAttribute("aria-current", "page")

  await ses.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
  await expect(ses).toHaveAttribute("aria-current", "page")

  const btn = page.getByRole("button", { name: "Settings" }).first()
  await btn.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Tab")
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
    .toBe(true)

  await page.keyboard.press("Escape")
  await expect(dialog).not.toBeVisible()
  await expect(btn).toBeFocused()
})

test("mobile drawer exposes the same destination set", async ({ page, gotoSession, slug }) => {
  await page.setViewportSize({ width: 900, height: 800 })

  await gotoSession()

  await page.getByRole("button", { name: "Toggle menu" }).first().click()
  const nav = page.locator('[data-component="sidebar-nav-mobile"]')

  await expect(nav).toBeVisible()
  await expect(nav.getByRole("button", { name: "Sessions" }).first()).toBeVisible()
  await expect(nav.getByRole("button", { name: "Workflows" }).first()).toBeVisible()
  await expect(nav.getByRole("button", { name: "Library" }).first()).toBeVisible()
  await expect(nav.getByRole("button", { name: "Runs" }).first()).toBeVisible()
  await expect(nav.getByRole("button", { name: "History" }).first()).toBeVisible()

  const btn = nav.getByRole("button", { name: "Workflows" }).first()
  await btn.focus()
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(new RegExp(`/${slug}/workflows$`))
  await expect(btn).toHaveAttribute("aria-current", "page")
})

test("workflow graphs, history rows, and run tabs respond to keyboard navigation", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await withProject(async ({ directory, slug }) => {
    const id = `workflow.a11y.${Date.now().toString(16)}`
    await write(directory, id)

    const route = async (next: Route) => {
      const url = new URL(next.request().url())
      if (url.origin !== serverUrl) {
        await next.continue()
        return
      }

      if (url.pathname === "/workflow/runs/run_1/detail") {
        await next.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(run),
        })
        return
      }

      if (url.pathname === "/workflow/workflows/workflow.daily/detail") {
        await next.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(item),
        })
        return
      }

      if (url.pathname === "/workflow/history/runs") {
        await next.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(historyRuns),
        })
        return
      }

      if (url.pathname === "/workflow/history/operations" || url.pathname === "/workflow/history/edits") {
        await next.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(empty),
        })
        return
      }

      if (url.pathname === "/workflow/history/drafts") {
        await next.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [],
            next_cursor: null,
          }),
        })
        return
      }

      await next.continue()
    }

    await page.route("**/workflow/**", route)
    try {
      await page.goto(`/${slug}/workflows/${id}?tab=design`)
      const design = page.locator('[data-component="workflow-detail-tab"][data-tab="design"]')
      await design.focus()
      await page.keyboard.press("ArrowRight")
      await expect(page).toHaveURL(new RegExp(`/${slug}/workflows/${id}\\?tab=authoring$`))
      const node = page.locator('[data-component="graph-node"][data-node-id="ask"]')
      await node.focus()
      await page.keyboard.press("Enter")
      await expect(page.locator('[data-component="workflow-node-panel"]')).toHaveAttribute("data-node-id", "ask")

      await page.goto(`/${slug}/history`)
      const runs = page.locator('[data-component="history-tab-trigger"][data-tab="runs"]')
      await runs.focus()
      await page.keyboard.press("ArrowRight")
      await expect(page).toHaveURL(new RegExp(`/${slug}/history\\?tab=operations$`))

      await page.goto(`/${slug}/history?tab=runs`)
      const open = page.locator('[data-component="history-run-row"][data-id="run_1"]').getByRole("button", {
        name: "Open Run",
      })
      await open.focus()
      await page.keyboard.press("Enter")
      await expect(page).toHaveURL(new RegExp(`/${slug}/runs/run_1$`))

      await page.goto(`/${slug}/runs/run_1?node=ask`)
      const sum = page.locator('[data-component="run-node-panel-trigger"][data-panel="summary"]')
      await expect(page.locator('[data-component="run-node-panel"]')).toHaveAttribute("data-node-id", "ask")
      await sum.focus()
      await page.keyboard.press("ArrowRight")
      await expect(page).toHaveURL(new RegExp(`/${slug}/runs/run_1\\?node=ask&panel=transcript&attempt=1$`))
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/**", route)
    }
  })
})

test("library detail tabs respond to arrow-key selection", async ({ page, slug }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  const route = async (next: Route) => {
    const url = new URL(next.request().url())
    if (url.origin !== serverUrl) {
      await next.continue()
      return
    }

    if (url.pathname === "/library/items/prompt.shared") {
      await next.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(lib),
      })
      return
    }

    if (url.pathname === "/library/items/prompt.shared/history") {
      await next.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(hist),
      })
      return
    }

    await next.continue()
  }

  await page.route("**/library/**", route)
  try {
    await page.goto(`/${slug}/library/prompt.shared`)
    const view = page.locator('[data-page="library-detail"]')
    await expect(view).toBeVisible()
    const content = view.getByRole("tab", { name: "Content" })
    await content.focus()
    await page.keyboard.press("ArrowRight")
    await expect(page).toHaveURL(new RegExp(`/${slug}/library/prompt\\.shared\\?tab=used$`))
    await page.keyboard.press("ArrowRight")
    await expect(page).toHaveURL(new RegExp(`/${slug}/library/prompt\\.shared\\?tab=history$`))
  } finally {
    if (page.isClosed()) return
    await page.unroute("**/library/**", route)
  }
})
