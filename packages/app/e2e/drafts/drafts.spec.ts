import { test, expect } from "../fixtures"
import { seedProjects } from "../actions"
import { dirSlug, serverUrl } from "../utils"
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
  const match = rows.find(
    (item): item is { id: string; config?: { directory?: string } } =>
      !!item && typeof item === "object" && "id" in item && (item as { config?: { directory?: string } }).config?.directory === directory,
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

test("origin drafts support create, edit invalidation, approve, and send through the history UI", async ({ page }) => {
  const directory = await createOriginProject()
  const workspace = await workspaceID(directory)
  await seedPage(page, directory)
  await gotoDrafts(page, directory, workspace)

  await page.locator('[data-component="history-draft-create-toggle"]').click()
  const create = page.locator('[data-component="history-draft-create-form"]')
  await expect(create).toBeVisible()
  await create.getByLabel("Payload JSON").fill('{\n  "text": "origin draft"\n}')
  await create.getByRole("button", { name: "Create Draft" }).click()

  const row = page.locator('[data-component="history-draft-row"]').filter({ hasText: "origin draft" })
  await expect(row).toBeVisible()
  await expect(row.locator('[data-component="history-draft-status"]')).toHaveText("pending")
  await expect(row.locator('[data-component="history-draft-send-hint"]')).toContainText("Approve first")

  await row.locator('[data-component="history-draft-action-approve"]').click()
  await expect(row.locator('[data-component="history-draft-status"]')).toHaveText("approved")

  await row.locator('[data-component="history-draft-action-edit"]').click()
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
  await expect(sent).toContainText(/test\.message:\d+/)
  await expect(page.locator('[data-component="history-draft-scope-trigger"][data-scope="processed"]')).toHaveAttribute(
    "aria-selected",
    "true",
  )
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
  await gotoDrafts(page, directory, workspace)

  await page.locator('[data-component="history-draft-create-toggle"]').click()
  const create = page.locator('[data-component="history-draft-create-form"]')
  await expect(create).toBeVisible()
  await create.getByLabel("Payload JSON").fill('{\n  "text": "reject draft"\n}')
  await create.getByRole("button", { name: "Create Draft" }).click()

  const row = page.locator('[data-component="history-draft-row"]').filter({ hasText: "reject draft" })
  await expect(row).toBeVisible()

  await row.locator('[data-component="history-draft-action-approve"]').click()
  await expect(row.locator('[data-component="history-draft-status"]')).toHaveText("approved")

  await row.locator('[data-component="history-draft-action-reject"]').click()

  const rejected = page.locator('[data-component="history-draft-row"]').filter({ hasText: "reject draft" })
  await expect(rejected).toBeVisible()
  await expect(rejected).toHaveAttribute("data-status", "rejected")
  await expect(page.locator('[data-component="history-draft-scope-trigger"][data-scope="processed"]')).toHaveAttribute(
    "aria-selected",
    "true",
  )
})
