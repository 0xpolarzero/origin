import { test, expect } from "../fixtures"
import type { Route } from "@playwright/test"
import { serverUrl } from "../utils"

const workspace = "wrk_release_gate"

const run = {
  id: "run-release-gate",
  status: "completed",
  trigger_type: "manual",
  workflow_id: "workflow.release",
  workspace_id: workspace,
  session_id: "session-release-gate",
  reason_code: null,
  failure_code: null,
  ready_for_integration_at: null,
  created_at: 500,
  updated_at: 501,
  started_at: 500,
  finished_at: 501,
  operation_id: "op-release-gate",
  operation_exists: true,
  trigger_metadata: null,
  duplicate_event: {
    reason: false,
    failure: false,
  },
  debug: false,
} as const

const operation = {
  id: "op-release-gate",
  run_id: run.id,
  run_exists: true,
  status: "completed",
  trigger_type: "manual",
  workflow_id: run.workflow_id,
  workspace_id: workspace,
  session_id: run.session_id,
  ready_for_integration_at: null,
  changed_paths: ["docs/release.md"],
  created_at: 500,
  updated_at: 501,
  provenance: "app",
} as const

const runDetail = {
  run: {
    id: run.id,
    status: "completed_no_change",
    workflow_id: run.workflow_id,
    workspace_id: workspace,
    session_id: run.session_id,
    reason_code: null,
    failure_code: null,
    created_at: 500,
    started_at: 500,
    finished_at: 501,
    integration_candidate: null,
  },
  snapshot: {
    id: "snap-release-gate",
    workflow_id: run.workflow_id,
    workflow_revision_id: "rev-release-gate",
    workflow_hash: "hash-release-gate",
    workflow_text: "schema_version: 2",
    graph_json: {
      id: run.workflow_id,
      name: "Release workflow",
      description: "Release gate history target",
      steps: [
        {
          id: "done",
          kind: "end",
          title: "Done",
          result: "success",
        },
      ],
    },
    input_json: {},
    input_store_json: {},
    resource_materials_json: {},
  },
  revision: {
    id: "rev-release-gate",
    workflow_id: run.workflow_id,
    content_hash: "hash-release-gate",
    created_at: 500,
  },
  live: {
    current_revision_id: "rev-release-gate",
    has_newer_revision: false,
  },
  nodes: [],
  events: [],
  followup: null,
} as const

function item(
  id: string,
  status: string,
  preview_text: string,
  input: {
    run_id?: string | null
    source_kind?: "user" | "system" | "system_report"
    action_id?: string
    target?: string
    block_reason_code?: string | null
    policy_id?: string | null
    policy_version?: string | null
    decision_id?: string | null
    decision_reason_code?: string | null
    dispatch?: {
      id: string
      state: string
      idempotency_key: string
      remote_reference: string | null
      block_reason_code: string | null
    } | null
  } = {},
) {
  return {
    id,
    run_id: input.run_id ?? run.id,
    workspace_id: workspace,
    status,
    source_kind: input.source_kind ?? "user",
    adapter_id: "test",
    integration_id: "test/default",
    action_id: input.action_id ?? "message.send",
    target: input.target ?? "channel://release",
    payload_json: {
      text: preview_text,
    },
    payload_schema_version: 1,
    preview_text,
    material_hash: `hash-${id}`,
    block_reason_code: input.block_reason_code ?? null,
    policy_id: input.policy_id ?? "policy/outbound-default",
    policy_version: input.policy_version ?? "14",
    decision_id: input.decision_id ?? `decision-${id}`,
    decision_reason_code: input.decision_reason_code ?? "policy_allow",
    created_at: 500,
    updated_at: 501,
    dispatch: input.dispatch ?? null,
  }
}

const drafts = {
  pending: item("draft-release-pending", "pending", "Release mail waiting for approval"),
  auto: item("draft-release-auto", "auto_approved", "Pager alert already auto-approved", {
    source_kind: "system",
    target: "channel://ops",
  }),
  sent: item("draft-release-sent", "sent", "Release notice delivered", {
    dispatch: {
      id: "dispatch-release-sent",
      state: "finalized",
      idempotency_key: "dispatch:draft-release-sent",
      remote_reference: "slack:msg:release-001",
      block_reason_code: null,
    },
  }),
  rejected: item("draft-release-rejected", "rejected", "Hold outbound follow-up until sign-off"),
  denied: item("draft-policy-default-deny", "blocked", "Policy evaluation failed before auto-approval", {
    source_kind: "system",
    action_id: "issue.create",
    target: "tracker://release",
    block_reason_code: "policy_evaluation_failed",
    decision_id: "decision-default-deny",
    decision_reason_code: "policy_evaluation_failed",
  }),
} as const

async function respond(route: Route, body: unknown) {
  if (new URL(route.request().url()).origin !== serverUrl) {
    await route.continue()
    return
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

async function reminders(route: Route) {
  await respond(route, {
    generated_at: 500,
    items: [],
  })
}

test("one run can surface multiple drafts with independent lifecycle outcomes", async ({ page, withProject }) => {
  await withProject(async (project) => {
    const history = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.origin !== serverUrl) {
        await route.continue()
        return
      }

      const scope = url.searchParams.get("scope")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items:
            scope === "processed"
              ? [drafts.sent, drafts.rejected]
              : [drafts.pending, drafts.auto],
          next_cursor: null,
        }),
      })
    }

    await page.route("**/workflow/debug/reminders", reminders)
    await page.route("**/workflow/history/drafts*", history)

    try {
      await page.goto(`/${project.slug}/history?tab=drafts&scope=pending&workspace=${encodeURIComponent(workspace)}`)
      await expect(page.locator('[data-page="history"]')).toBeVisible()

      const pending = page.locator('[data-component="history-draft-row"][data-id="draft-release-pending"]')
      await expect(pending).toBeVisible()
      await expect(pending).toContainText(run.id)
      await expect(pending).toHaveAttribute("data-status", "pending")
      await expect(pending.locator('[data-component="history-draft-action-send"]')).toBeDisabled()
      await expect(pending.locator('[data-component="history-draft-send-hint"]')).toContainText("Approve first")

      const auto = page.locator('[data-component="history-draft-row"][data-id="draft-release-auto"]')
      await expect(auto).toBeVisible()
      await expect(auto).toContainText(run.id)
      await expect(auto).toHaveAttribute("data-status", "auto_approved")
      await expect(auto.locator('[data-component="history-draft-action-send"]')).toBeEnabled()
      await expect(auto.locator('[data-component="history-draft-send-hint"]')).toHaveCount(0)

      await page.locator('[data-component="history-draft-scope-trigger"][data-scope="processed"]').click()
      await expect(page.locator('[data-component="history-draft-scope-trigger"][data-scope="processed"]')).toHaveAttribute(
        "aria-selected",
        "true",
      )

      const sent = page.locator('[data-component="history-draft-row"][data-id="draft-release-sent"]')
      await expect(sent).toBeVisible()
      await expect(sent).toContainText(run.id)
      await expect(sent).toHaveAttribute("data-status", "sent")
      await expect(sent.locator('[data-component="history-draft-dispatch"]')).toContainText("dispatch-release-sent")
      await expect(sent.locator('[data-component="history-draft-dispatch"]')).toContainText("slack:msg:release-001")

      const rejected = page.locator('[data-component="history-draft-row"][data-id="draft-release-rejected"]')
      await expect(rejected).toBeVisible()
      await expect(rejected).toContainText(run.id)
      await expect(rejected).toHaveAttribute("data-status", "rejected")
      await expect(rejected).toContainText("No dispatch attempt yet.")
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/drafts*", history)
    }
  })
})

test("policy evaluation failure surfaces a default-deny blocked draft", async ({ page, withProject }) => {
  await withProject(async (project) => {
    const history = async (route: Route) => {
      await respond(route, {
        items: [drafts.denied],
        next_cursor: null,
      })
    }

    await page.route("**/workflow/debug/reminders", reminders)
    await page.route("**/workflow/history/drafts*", history)

    try {
      await page.goto(`/${project.slug}/history?tab=drafts&scope=pending&workspace=${encodeURIComponent(workspace)}`)
      await expect(page.locator('[data-page="history"]')).toBeVisible()

      const denied = page.locator('[data-component="history-draft-row"][data-id="draft-policy-default-deny"]')
      await expect(denied).toBeVisible()
      await expect(denied).toHaveAttribute("data-status", "blocked")
      await expect(denied.locator('[data-component="history-draft-reason"][data-code="policy_evaluation_failed"]')).toBeVisible()
      await expect(denied.locator('[data-component="history-draft-remediation"]')).toHaveCount(0)
      await expect(denied.locator('[data-component="history-draft-action-send"]')).toBeDisabled()
      await expect(denied).toContainText("policy/outbound-default")
      await expect(denied).toContainText("decision-default-deny")
      await expect(denied).toContainText("policy_evaluation_failed")
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/drafts*", history)
    }
  })
})

test("JJ history deep links remain stable across reload recovery", async ({ page, withProject }) => {
  await withProject(async (project) => {
    const runs = async (route: Route) => {
      await respond(route, {
        items: [run],
        next_cursor: null,
        hidden_debug_count: 0,
      })
    }

    const operations = async (route: Route) => {
      await respond(route, {
        items: [operation],
        next_cursor: null,
      })
    }

    const detail = async (route: Route) => {
      await respond(route, runDetail)
    }

    await page.route("**/workflow/debug/reminders", reminders)
    await page.route("**/workflow/history/runs*", runs)
    await page.route("**/workflow/history/operations*", operations)
    await page.route(`**/workflow/runs/${run.id}/detail`, detail)

    try {
      await page.goto(
        `/${project.slug}/history?tab=operations&operation_id=${operation.id}&workspace=${encodeURIComponent(workspace)}`,
      )
      await expect(page.locator('[data-page="history"]')).toBeVisible()

      const row = page.locator(`[data-component="history-operation-row"][data-id="${operation.id}"]`)
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute("data-focused", "true")

      await page.reload()
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute("data-focused", "true")

      await row.getByRole("button", { name: "Open Run" }).click()
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`))
      await expect(page.locator('[data-page="run-detail"]')).toBeVisible()

      await page.reload()
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`))
      await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/runs*", runs)
      await page.unroute("**/workflow/history/operations*", operations)
      await page.unroute(`**/workflow/runs/${run.id}/detail`, detail)
    }
  })
})

test("outbound draft deep links keep dispatch metadata after reload", async ({ page, withProject }) => {
  await withProject(async (project) => {
    const history = async (route: Route) => {
      await respond(route, {
        items: [drafts.sent],
        next_cursor: null,
      })
    }

    await page.route("**/workflow/debug/reminders", reminders)
    await page.route("**/workflow/history/drafts*", history)

    try {
      await page.goto(
        `/${project.slug}/history?tab=drafts&scope=processed&draft_id=${drafts.sent.id}&workspace=${encodeURIComponent(workspace)}`,
      )
      await expect(page.locator('[data-page="history"]')).toBeVisible()
      await expect(page.locator('[data-component="history-draft-scope-trigger"][data-scope="processed"]')).toHaveAttribute(
        "aria-selected",
        "true",
      )

      const row = page.locator(`[data-component="history-draft-row"][data-id="${drafts.sent.id}"]`)
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute("data-focused", "true")
      await expect(row.locator('[data-component="history-draft-dispatch"]')).toContainText("dispatch-release-sent")
      await expect(row.locator('[data-component="history-draft-dispatch"]')).toContainText("dispatch:draft-release-sent")
      await expect(row.locator('[data-component="history-draft-dispatch"]')).toContainText("slack:msg:release-001")

      await page.reload()
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute("data-focused", "true")
      await expect(row.locator('[data-component="history-draft-dispatch"]')).toContainText("dispatch-release-sent")
      await expect(row.locator('[data-component="history-draft-dispatch"]')).toContainText("dispatch:draft-release-sent")
      await expect(row.locator('[data-component="history-draft-dispatch"]')).toContainText("slack:msg:release-001")
    } finally {
      if (page.isClosed()) return
      await page.unroute("**/workflow/debug/reminders", reminders)
      await page.unroute("**/workflow/history/drafts*", history)
    }
  })
})
