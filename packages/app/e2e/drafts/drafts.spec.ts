import { test, expect } from "../fixtures"
import { seedProjects } from "../actions"
import { createSdk, dirSlug, serverUrl } from "../utils"
import type { Route } from "@playwright/test"
import { execSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

async function seedPage(page: Parameters<typeof seedProjects>[0], directory: string) {
  await seedProjects(page, { directory })
  await page.addInitScript(() => {
    localStorage.setItem(
      "origin.global.dat:model",
      JSON.stringify({
        recent: [{ providerID: "opencode", modelID: "big-pickle" }],
        user: [],
        variant: {},
      }),
    )
  })
}

async function workspaceID(directory: string) {
  const listed = await fetch(`${serverUrl}/experimental/workspace?directory=${encodeURIComponent(directory)}`).then((response) =>
    response.json(),
  )
  const rows = Array.isArray(listed) ? listed : []
  const matches = rows.filter(
    (item): item is { id: string; config?: { directory?: string } } =>
      !!item && typeof item === "object" && "id" in item && (item as { config?: { directory?: string } }).config?.directory === directory,
  )

  await Promise.all(
    matches.map((item) =>
      fetch(`${serverUrl}/experimental/workspace/${item.id}?directory=${encodeURIComponent(directory)}`, {
        method: "DELETE",
      }).catch(() => undefined),
    ),
  )

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

async function createOriginProject() {
  const home = process.env.OPENCODE_TEST_HOME
  if (!home) throw new Error("OPENCODE_TEST_HOME is required for local drafts e2e")

  const directory = path.join(home, "Documents", "origin")
  await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, "README.md"), "# origin drafts e2e\n")

  execSync("git init", { cwd: directory, stdio: "ignore" })
  execSync("git add -A", { cwd: directory, stdio: "ignore" })
  execSync('git -c user.name="e2e" -c user.email="e2e@example.com" commit -m "init" --allow-empty', {
    cwd: directory,
    stdio: "ignore",
  })

  return directory
}

async function gotoDrafts(page: Parameters<typeof test>[0]["page"], directory: string, workspace: string) {
  await page.goto(`/${dirSlug(directory)}/history?tab=drafts&scope=pending&workspace=${encodeURIComponent(workspace)}`)
  await expect(page.locator('[data-page="history"]')).toBeVisible()
  await expect(page.locator('[data-component="history-tab-trigger"][data-tab="drafts"]')).toBeVisible()
}

function row(page: Parameters<typeof test>[0]["page"], text: string) {
  return page.locator('[data-component="history-draft-row"]').filter({ hasText: text }).first()
}

function data<T>(value: T | undefined, label: string) {
  if (!value) throw new Error(`missing ${label}`)
  return value
}

test("origin drafts support create, edit invalidation, approve, and send through the history UI", async ({ page }) => {
  const directory = await createOriginProject()
  const workspace = await workspaceID(directory)
  await seedPage(page, directory)
  const draftID = "018f3c19-89f7-7b87-b72f-0ef4f34a53d2"
  let current: null | {
    id: string
    run_id: string
    workspace_id: string
    status: string
    source_kind: string
    adapter_id: string
    integration_id: string
    action_id: string
    target: string
    payload_json: { text: string }
    payload_schema_version: number
    preview_text: string
    material_hash: string
    block_reason_code: string | null
    policy_id: string
    policy_version: string
    decision_id: string
    decision_reason_code: string
    created_at: number
    updated_at: number
    dispatch:
      | null
      | {
          id: string
          state: string
          idempotency_key: string
          remote_reference: string | null
          block_reason_code: string | null
        }
  } = null

  const history = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    const scope = url.searchParams.get("scope")
    const processed = current && (current.status === "sent" || current.status === "rejected" || current.status === "failed")
    const items = !current ? [] : scope === "processed" ? (processed ? [current] : []) : processed ? [] : [current]

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        next_cursor: null,
      }),
    })
  }

  const create = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      id: draftID,
      run_id: "018f3c19-89f7-7b87-b72f-0ef4f34a53d1",
      workspace_id: workspace,
      status: "pending",
      source_kind: "user",
      adapter_id: "test",
      integration_id: "test/default",
      action_id: "message.send",
      target: "channel://general",
      payload_json: {
        text: "origin draft",
      },
      payload_schema_version: 1,
      preview_text: "Message channel://general: origin draft",
      material_hash: "hash-origin-draft",
      block_reason_code: null,
      policy_id: "policy/outbound-default",
      policy_version: "14",
      decision_id: "decision-origin-draft",
      decision_reason_code: "policy_allow",
      created_at: 1,
      updated_at: 2,
      dispatch: null,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const update = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...data(current, "draft before edit"),
      status: "pending",
      payload_json: {
        text: "origin draft edited",
      },
      preview_text: "Message channel://general: origin draft edited",
      material_hash: "hash-origin-draft-edited",
      block_reason_code: "material_edit_invalidation",
      updated_at: data(current, "draft before edit").updated_at + 1,
      dispatch: null,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const approve = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...data(current, "draft before approve"),
      status: "approved",
      block_reason_code: null,
      updated_at: data(current, "draft before approve").updated_at + 1,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const send = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...data(current, "draft before send"),
      status: "sent",
      updated_at: data(current, "draft before send").updated_at + 1,
      dispatch: {
        id: "dispatch-origin-draft-1",
        state: "finalized",
        idempotency_key: "dispatch:origin-draft",
        remote_reference: "test.message:10",
        block_reason_code: null,
      },
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const draftRoute = new RegExp(`/workflow/drafts/${draftID}(?:\\?.*)?$`)
  const approveRoute = new RegExp(`/workflow/drafts/${draftID}/approve(?:\\?.*)?$`)
  const sendRoute = new RegExp(`/workflow/drafts/${draftID}/send(?:\\?.*)?$`)

  await page.route("**/workflow/history/drafts*", history)
  await page.route(/\/workflow\/drafts(?:\?.*)?$/, create)
  await page.route(draftRoute, update)
  await page.route(approveRoute, approve)
  await page.route(sendRoute, send)

  try {
    await gotoDrafts(page, directory, workspace)

    await page.locator('[data-component="history-draft-create-toggle"]').click()
    const createForm = page.locator('[data-component="history-draft-create-form"]')
    await expect(createForm).toBeVisible()
    await createForm.getByLabel("Payload JSON").fill('{\n  "text": "origin draft"\n}')
    await createForm.getByRole("button", { name: "Create Draft" }).click()

    const draft = page.locator('[data-component="history-draft-row"]').filter({ hasText: "origin draft" })
    await expect(draft).toBeVisible()
    await expect(draft.locator('[data-component="history-draft-status"]')).toHaveText("pending")
    await expect(draft.locator('[data-component="history-draft-send-hint"]')).toContainText("Approve first")

    await draft.locator('[data-component="history-draft-action-approve"]').click()
    await expect(draft.locator('[data-component="history-draft-status"]')).toHaveText("approved")

    await draft.locator('[data-component="history-draft-action-edit"]').click()
    const edit = page.locator('[data-component="history-draft-edit-form"]')
    await expect(edit).toBeVisible()
    await edit.getByLabel("Payload JSON").fill('{\n  "text": "origin draft edited"\n}')
    await expect(edit.locator('[data-component="history-draft-material-warning"]')).toContainText("clear approval")
    await edit.getByRole("button", { name: "Save Changes" }).click()

    const updated = page.locator('[data-component="history-draft-row"]').filter({ hasText: "origin draft edited" })
    await expect(updated).toBeVisible()
    await expect(updated.locator('[data-component="history-draft-status"]')).toHaveText("pending")
    await expect(updated.locator('[data-component="history-draft-reason"][data-code="material_edit_invalidation"]')).toBeVisible()

    await updated.locator('[data-component="history-draft-action-approve"]').click()
    await expect(updated.locator('[data-component="history-draft-status"]')).toHaveText("approved")

    await updated.locator('[data-component="history-draft-action-send"]').click()

    const sent = page.locator('[data-component="history-draft-row"]').filter({ hasText: "origin draft edited" })
    await expect(sent).toBeVisible()
    await expect(sent).toHaveAttribute("data-status", "sent")
    await expect(sent).toContainText("finalized")
    await expect(sent).toContainText("dispatch:origin-draft")
    await expect(page.locator('[data-component="history-draft-scope-trigger"][data-scope="processed"]')).toHaveAttribute(
      "aria-selected",
      "true",
    )
  } finally {
    if (page.isClosed()) return
    await page.unroute("**/workflow/history/drafts*", history)
    await page.unroute(/\/workflow\/drafts(?:\?.*)?$/, create)
    await page.unroute(draftRoute, update)
    await page.unroute(approveRoute, approve)
    await page.unroute(sendRoute, send)
  }
})

test("standard workspaces surface the outbound block reason and remediation", async ({ page, withProject }) => {
  await withProject(async ({ directory, slug }) => {
    const workspace = await workspaceID(directory)
    await page.goto(`/${slug}/history?tab=drafts&scope=pending&workspace=${encodeURIComponent(workspace)}`)
    await expect(page.locator('[data-page="history"]')).toBeVisible()

    await page.locator('[data-component="history-draft-create-toggle"]').click()
    const create = page.locator('[data-component="history-draft-create-form"]')
    await create.getByLabel("Payload JSON").fill('{\n  "text": "blocked draft"\n}')
    await create.getByRole("button", { name: "Create Draft" }).click()

    const row = page.locator('[data-component="history-draft-row"]').filter({ hasText: "blocked draft" })
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute("data-status", "blocked")
    await expect(row.locator('[data-component="history-draft-reason"][data-code="workspace_policy_blocked"]')).toBeVisible()
    await expect(row.locator('[data-component="history-draft-remediation"]')).toContainText("Origin workspaces")
  })
})

test("origin drafts support reject and move into processed history", async ({ page }) => {
  const directory = await createOriginProject()
  const workspace = await workspaceID(directory)
  await seedPage(page, directory)
  const draftID = "018f3c19-89f7-7b87-b72f-0ef4f34a53d0"
  let current: null | {
    id: string
    run_id: string
    workspace_id: string
    status: string
    source_kind: string
    adapter_id: string
    integration_id: string
    action_id: string
    target: string
    payload_json: { text: string }
    payload_schema_version: number
    preview_text: string
    material_hash: string
    block_reason_code: string | null
    policy_id: string
    policy_version: string
    decision_id: string
    decision_reason_code: string
    created_at: number
    updated_at: number
    dispatch: null
  } = null

  const history = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    const scope = url.searchParams.get("scope")
    const processed = current?.status === "rejected"
    const items = !current ? [] : scope === "processed" ? (processed ? [current] : []) : processed ? [] : [current]

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        next_cursor: null,
      }),
    })
  }

  const create = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      id: draftID,
      run_id: "018f3c19-89f7-7b87-b72f-0ef4f34a53cf",
      workspace_id: workspace,
      status: "pending",
      source_kind: "user",
      adapter_id: "test",
      integration_id: "test/default",
      action_id: "message.send",
      target: "channel://general",
      payload_json: {
        text: "reject draft",
      },
      payload_schema_version: 1,
      preview_text: "Message channel://general: reject draft",
      material_hash: "hash-reject-draft",
      block_reason_code: null,
      policy_id: "policy/outbound-default",
      policy_version: "14",
      decision_id: "decision-reject-draft",
      decision_reason_code: "policy_allow",
      created_at: 10,
      updated_at: 11,
      dispatch: null,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const approve = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...data(current, "draft before approve"),
      status: "approved",
      updated_at: data(current, "draft before approve").updated_at + 1,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const reject = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...data(current, "draft before reject"),
      status: "rejected",
      updated_at: data(current, "draft before reject").updated_at + 1,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const approveRoute = new RegExp(`/workflow/drafts/${draftID}/approve(?:\\?.*)?$`)
  const rejectRoute = new RegExp(`/workflow/drafts/${draftID}/reject(?:\\?.*)?$`)

  await page.route("**/workflow/history/drafts*", history)
  await page.route(/\/workflow\/drafts(?:\?.*)?$/, create)
  await page.route(approveRoute, approve)
  await page.route(rejectRoute, reject)

  try {
    await gotoDrafts(page, directory, workspace)

    await page.locator('[data-component="history-draft-create-toggle"]').click()
    const createForm = page.locator('[data-component="history-draft-create-form"]')
    await expect(createForm).toBeVisible()
    await createForm.getByLabel("Payload JSON").fill('{\n  "text": "reject draft"\n}')
    await createForm.getByRole("button", { name: "Create Draft" }).click()

    const draft = page.locator('[data-component="history-draft-row"]').filter({ hasText: "reject draft" })
    await expect(draft).toBeVisible()

    await draft.locator('[data-component="history-draft-action-approve"]').click()
    await expect(draft.locator('[data-component="history-draft-status"]')).toHaveText("approved")

    await draft.locator('[data-component="history-draft-action-reject"]').click()

    const rejected = page.locator('[data-component="history-draft-row"]').filter({ hasText: "reject draft" })
    await expect(rejected).toBeVisible()
    await expect(rejected).toHaveAttribute("data-status", "rejected")
    await expect(page.locator('[data-component="history-draft-scope-trigger"][data-scope="processed"]')).toHaveAttribute(
      "aria-selected",
      "true",
    )
  } finally {
    if (page.isClosed()) return
    await page.unroute("**/workflow/history/drafts*", history)
    await page.unroute(/\/workflow\/drafts(?:\?.*)?$/, create)
    await page.unroute(approveRoute, approve)
    await page.unroute(rejectRoute, reject)
  }
})

test("origin auto-approved drafts send without explicit approval", async ({ page }) => {
  const directory = await createOriginProject()
  const workspace = await workspaceID(directory)
  await seedPage(page, directory)
  const draftID = "018f3c19-89f7-7b87-b72f-0ef4f34a53d6"
  let current = {
    id: draftID,
    run_id: "018f3c19-89f7-7b87-b72f-0ef4f34a53d5",
    workspace_id: workspace,
    status: "auto_approved",
    source_kind: "system",
    adapter_id: "test",
    integration_id: "test/default",
    action_id: "message.send",
    target: "channel://general",
    payload_json: {
      text: "auto approved draft",
    },
    payload_schema_version: 1,
    preview_text: "Message channel://general: auto approved draft",
    material_hash: "hash-auto-approved",
    block_reason_code: null,
    policy_id: "policy/outbound-default",
    policy_version: "14",
    decision_id: "decision-auto-approved",
    decision_reason_code: "policy_allow",
    created_at: 20,
    updated_at: 21,
    dispatch: null,
  }

  const drafts = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [current],
        next_cursor: null,
      }),
    })
  }

  const send = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...current,
      status: "sent",
      updated_at: current.updated_at + 1,
      dispatch: {
        id: "dispatch-auto-approved-1",
        state: "finalized",
        idempotency_key: "dispatch:auto-approved",
        remote_reference: "test.message:11",
        block_reason_code: null,
      },
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const sendRoute = new RegExp(`/workflow/drafts/${draftID}/send(?:\\?.*)?$`)

  await page.route("**/workflow/history/drafts*", drafts)
  await page.route(sendRoute, send)

  try {
    await gotoDrafts(page, directory, workspace)

    const draft = row(page, "auto approved draft")
    await expect(draft).toBeVisible()
    await expect(draft).toHaveAttribute("data-status", "auto_approved")
    await expect(draft.locator('[data-component="history-draft-action-approve"]')).toBeDisabled()
    await expect(draft.locator('[data-component="history-draft-send-hint"]')).toHaveCount(0)

    await draft.locator('[data-component="history-draft-action-send"]').click()

    await expect(draft).toHaveAttribute("data-status", "sent")
    await expect(draft).toContainText("dispatch-auto-approved-1")
    await expect(draft).toContainText("dispatch:auto-approved")
    await expect(draft).toContainText("test.message:11")
  } finally {
    if (page.isClosed()) return
    await page.unroute("**/workflow/history/drafts*", drafts)
    await page.unroute(sendRoute, send)
  }
})

test("origin sent drafts reject further send attempts", async ({ page }) => {
  const directory = await createOriginProject()
  const workspace = await workspaceID(directory)
  await seedPage(page, directory)
  const current = {
    id: "018f3c19-89f7-7b87-b72f-0ef4f34a53d4",
    run_id: "018f3c19-89f7-7b87-b72f-0ef4f34a53d3",
    workspace_id: workspace,
    status: "sent",
    source_kind: "system",
    adapter_id: "test",
    integration_id: "test/default",
    action_id: "message.send",
    target: "channel://general",
    payload_json: {
      text: "already sent draft",
    },
    payload_schema_version: 1,
    preview_text: "Message channel://general: already sent draft",
    material_hash: "hash-already-sent",
    block_reason_code: null,
    policy_id: "policy/outbound-default",
    policy_version: "14",
    decision_id: "decision-already-sent",
    decision_reason_code: "policy_allow",
    created_at: 30,
    updated_at: 31,
    dispatch: {
      id: "dispatch-sent-1",
      state: "finalized",
      idempotency_key: "dispatch:already-sent",
      remote_reference: "test.message:12",
      block_reason_code: null,
    },
  }

  const drafts = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [current],
        next_cursor: null,
      }),
    })
  }

  await page.route("**/workflow/history/drafts*", drafts)

  try {
    await gotoDrafts(page, directory, workspace)

    const draft = row(page, "already sent draft")
    await expect(draft).toBeVisible()
    await expect(draft).toHaveAttribute("data-status", "sent")
    const send = draft.locator('[data-component="history-draft-action-send"]')
    const count = await send.count()
    if (count > 0) await expect(send).toBeDisabled()
    await expect(draft).toContainText("dispatch-sent-1")
    await expect(draft).toContainText("dispatch:already-sent")
  } finally {
    if (page.isClosed()) return
    await page.unroute("**/workflow/history/drafts*", drafts)
  }
})

test("origin blocked drafts can be fixed, re-approved, and sent with a new dispatch attempt", async ({ page }) => {
  const directory = await createOriginProject()
  const workspace = await workspaceID(directory)
  await seedPage(page, directory)
  const draftID = "018f3c19-89f7-7b87-b72f-0ef4f34a53d7"
  let current = {
    id: draftID,
    run_id: "018f3c19-89f7-7b87-b72f-0ef4f34a53d8",
    workspace_id: workspace,
    status: "blocked",
    source_kind: "user",
    adapter_id: "test",
    integration_id: "test/default",
    action_id: "message.send",
    target: "channel://alerts",
    payload_json: {
      text: "blocked then fixed",
    },
    payload_schema_version: 1,
    preview_text: "Message channel://alerts: blocked then fixed",
    material_hash: "hash-blocked",
    block_reason_code: "target_not_allowed",
    policy_id: "policy/outbound-default",
    policy_version: "14",
    decision_id: "decision-blocked",
    decision_reason_code: "target_not_allowed",
    created_at: 10,
    updated_at: 11,
    dispatch: {
      id: "dispatch-blocked-1",
      state: "blocked",
      idempotency_key: "dispatch:draft-blocked-fixed",
      remote_reference: null,
      block_reason_code: "target_not_allowed",
    },
  }

  const drafts = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [current],
        next_cursor: null,
      }),
    })
  }

  const update = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...current,
      status: "pending",
      target: "channel://general",
      preview_text: "Message channel://general: blocked then fixed",
      material_hash: "hash-fixed",
      block_reason_code: "material_edit_invalidation",
      decision_reason_code: "policy_allow",
      updated_at: current.updated_at + 1,
      dispatch: null,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const approve = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...current,
      status: "approved",
      block_reason_code: null,
      decision_reason_code: "policy_allow",
      updated_at: current.updated_at + 1,
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const send = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverUrl) {
      await route.continue()
      return
    }

    current = {
      ...current,
      status: "sent",
      block_reason_code: null,
      updated_at: current.updated_at + 1,
      dispatch: {
        id: "dispatch-blocked-2",
        state: "finalized",
        idempotency_key: "dispatch:draft-blocked-fixed",
        remote_reference: "test.message:22",
        block_reason_code: null,
      },
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(current),
    })
  }

  const updateRoute = new RegExp(`/workflow/drafts/${draftID}(?:\\?.*)?$`)
  const approveRoute = new RegExp(`/workflow/drafts/${draftID}/approve(?:\\?.*)?$`)
  const sendRoute = new RegExp(`/workflow/drafts/${draftID}/send(?:\\?.*)?$`)

  await page.route("**/workflow/history/drafts*", drafts)
  await page.route(updateRoute, update)
  await page.route(approveRoute, approve)
  await page.route(sendRoute, send)

  try {
    await gotoDrafts(page, directory, workspace)

    const draft = row(page, "blocked then fixed")
    await expect(draft).toBeVisible()
    await expect(draft).toHaveAttribute("data-status", "blocked")
    await expect(draft.locator('[data-component="history-draft-reason"][data-code="target_not_allowed"]')).toBeVisible()

    await draft.locator('[data-component="history-draft-action-edit"]').click()

    const edit = page.locator('[data-component="history-draft-edit-form"]')
    await expect(edit).toBeVisible()
    await edit.getByLabel("Target").fill("channel://general")
    await edit.getByRole("button", { name: "Save Changes" }).click()

    await expect(draft).toHaveAttribute("data-status", "pending")
    await expect(draft.locator('[data-component="history-draft-reason"][data-code="material_edit_invalidation"]')).toBeVisible()
    await expect(draft).toContainText("No dispatch attempt yet.")

    await draft.locator('[data-component="history-draft-action-approve"]').click()
    await expect(draft).toHaveAttribute("data-status", "approved")

    await draft.locator('[data-component="history-draft-action-send"]').click()
    await expect(draft).toHaveAttribute("data-status", "sent")
    await expect(draft).toContainText("dispatch-blocked-2")
    await expect(draft).toContainText("dispatch:draft-blocked-fixed")
    await expect(draft).toContainText("test.message:22")
  } finally {
    if (page.isClosed()) return
    await page.unroute("**/workflow/history/drafts*", drafts)
    await page.unroute(updateRoute, update)
    await page.unroute(approveRoute, approve)
    await page.unroute(sendRoute, send)
  }
})

test("origin draft create rejects adapter action schema mismatches with schema_invalid", async () => {
  const directory = await createOriginProject()
  const workspace = await workspaceID(directory)
  const sdk = createSdk(directory)
  const result = await sdk.workflow.drafts.create(
    {
      directory,
      workspace,
      source_kind: "user",
      integration_id: "test/default",
      adapter_id: "test",
      action_id: "issue.create",
      target: "repo://origin/issues",
      payload_json: {
        text: "wrong payload",
      },
      payload_schema_version: 1,
      actor_type: "user",
    },
    {
      throwOnError: false,
    },
  )

  expect(result.response.status).toBe(400)
  expect(result.error).toMatchObject({
    name: "RuntimeOutboundValidationError",
    data: {
      code: "schema_invalid",
    },
  })
})
