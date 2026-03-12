import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test, expect } from "../fixtures"
import { openSidebar } from "../actions"
import { promptSelector } from "../selectors"
import { createSdk, serverUrl } from "../utils"

async function writeWorkflow(directory: string, workflowID: string) {
  const root = path.join(directory, ".origin", "workflows")
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    path.join(root, `${workflowID}.yaml`),
    [
      "schema_version: 2",
      `id: ${workflowID}`,
      "name: Release snapshot check",
      "description: Capture frozen manual inputs with a deterministic script node",
      "trigger:",
      "  type: manual",
      "inputs:",
      "  - key: release_tag",
      "    type: text",
      "    label: Release tag",
      "    required: true",
      "  - key: notes",
      "    type: long_text",
      "    label: Notes",
      "    required: true",
      "  - key: count",
      "    type: number",
      "    label: Count",
      "    required: true",
      "  - key: flag",
      "    type: boolean",
      "    label: Flag",
      "    required: true",
      "  - key: choice",
      "    type: select",
      "    label: Choice",
      "    required: true",
      "    default: alpha",
      "    options:",
      "      - label: Alpha",
      "        value: alpha",
      "  - key: asset",
      "    type: path",
      "    label: Asset",
      "    required: true",
      "    mode: file",
      "steps:",
      "  - id: capture",
      "    kind: script",
      "    title: Capture snapshot inputs",
      "    script:",
      "      source: inline",
      "      text: |",
      '        echo "release=$ORIGIN_INPUT_RELEASE_TAG"',
      '        echo "notes=$ORIGIN_INPUT_NOTES"',
      '        echo "count=$ORIGIN_INPUT_COUNT"',
      '        echo "flag=$ORIGIN_INPUT_FLAG"',
      '        echo "choice=$ORIGIN_INPUT_CHOICE"',
      '        echo "asset=$(cat "$ORIGIN_INPUT_ASSET")"',
      "  - id: done",
      "    kind: end",
      "    title: Done",
      "    result: success",
    ].join("\n"),
    "utf8",
  )
}

async function writeAgentWorkflow(directory: string, workflowID: string) {
  const root = path.join(directory, ".origin", "workflows")
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    path.join(root, `${workflowID}.yaml`),
    [
      "schema_version: 2",
      `id: ${workflowID}`,
      "name: Release transcript follow-up",
      "description: Exercise a real agent_request transcript and run follow-up session",
      "trigger:",
      "  type: manual",
      "steps:",
      "  - id: ask",
      "    kind: agent_request",
      "    title: Ask release reviewer",
      "    prompt:",
      "      source: inline",
      "      text: Summarize release blockers for this run.",
      "  - id: done",
      "    kind: end",
      "    title: Done",
      "    result: success",
    ].join("\n"),
    "utf8",
  )
}

async function waitForRun(input: {
  sdk: ReturnType<typeof createSdk>
  directory: string
  workspace: string
  run_id: string
  statuses: string[]
}) {
  const timeout = Date.now() + 60_000
  let last = "unknown"
  while (Date.now() < timeout) {
    const value = await input.sdk.workflow.run
      .get({
        directory: input.directory,
        workspace: input.workspace,
        run_id: input.run_id,
      })
      .then((result) => result.data)
    last = value.status
    if (input.statuses.includes(value.status)) return value
    if (["completed", "completed_no_change", "ready_for_integration", "failed", "canceled", "skipped"].includes(value.status)) {
      throw new Error(`run ${input.run_id} reached unexpected terminal status ${value.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for run ${input.run_id} to reach ${input.statuses.join(", ")} (last status: ${last})`)
}

async function workspaceID(directory: string) {
  const listed = await fetch(`${serverUrl}/experimental/workspace?directory=${encodeURIComponent(directory)}`).then((response) =>
    response.json(),
  )
  const rows = Array.isArray(listed) ? listed : []
  const match = rows.find(
    (item): item is { id: string; directory?: string; config?: { directory?: string } } =>
      !!item &&
      typeof item === "object" &&
      "id" in item &&
      ((item as { directory?: string }).directory === directory ||
        (item as { config?: { directory?: string } }).config?.directory === directory),
  )
  if (match) return match.id

  const id = `wrk_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`
  const created = await fetch(`${serverUrl}/experimental/workspace/${id}?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: "main",
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

async function createRun(input: {
  directory: string
  workflowID: string
}) {
  const sdk = createSdk(input.directory)
  const workspace = await workspaceID(input.directory)
  const asset_dir = await fs.mkdtemp(path.join(os.tmpdir(), "origin-phase15-asset-"))
  const asset = path.join(asset_dir, "release.txt")
  await fs.writeFile(asset, "before-run", "utf8")
  await writeWorkflow(input.directory, input.workflowID)

  const validation = await sdk.workflow.run.validate({
    directory: input.directory,
    workspace,
    workflow_id: input.workflowID,
  })
  expect(validation.data.ok).toBe(true)

  const started = await sdk.workflow.run.start({
    directory: input.directory,
    workspace,
    workflow_id: input.workflowID,
    trigger_id: `e2e_${Date.now()}`,
    inputs: {
      release_tag: "v1.2.3",
      notes: "line one\nline two",
      count: 42,
      flag: true,
      choice: "alpha",
      asset,
    },
  })

  await fs.writeFile(asset, "after-start", "utf8")
  const done = await waitForRun({
    sdk,
    directory: input.directory,
    workspace,
    run_id: started.data.id,
    statuses: ["completed_no_change"],
  })

  return {
    workspace,
    asset,
    run_id: done.id,
  }
}

async function createAgentRun(input: {
  directory: string
  workflowID: string
}) {
  const sdk = createSdk(input.directory)
  const workspace = await workspaceID(input.directory)
  await writeAgentWorkflow(input.directory, input.workflowID)

  const validation = await sdk.workflow.run.validate({
    directory: input.directory,
    workspace,
    workflow_id: input.workflowID,
  })
  expect(validation.data.ok).toBe(true)

  const started = await sdk.workflow.run.start({
    directory: input.directory,
    workspace,
    workflow_id: input.workflowID,
    trigger_id: `e2e_${Date.now()}`,
  })
  const done = await waitForRun({
    sdk,
    directory: input.directory,
    workspace,
    run_id: started.data.id,
    statuses: ["completed_no_change"],
  })

  return {
    workspace,
    run_id: done.id,
  }
}

async function waitForSessionText(input: {
  sdk: ReturnType<typeof createSdk>
  sessionID: string
  texts: string[]
}) {
  const timeout = Date.now() + 30_000
  let last = ""
  while (Date.now() < timeout) {
    const messages = await input.sdk.session.messages({
      sessionID: input.sessionID,
      limit: 20,
    })
    last = JSON.stringify(messages.data ?? [])
    const text = (messages.data ?? [])
      .flatMap((message) => message.parts)
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
    if (input.texts.every((item) => text.includes(item))) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for session ${input.sessionID} texts: ${input.texts.join(", ")}\nlast=${last}`)
}

test("workflow detail runs tab opens a real script-only run detail page", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await withProject(async ({ directory, slug }) => {
    const workflowID = `workflow.phase15.${Date.now().toString(16)}`
    const run = await createRun({
      directory,
      workflowID,
    })

    await page.goto(`/${slug}/workflows/${workflowID}?tab=runs`)

    await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()
    const row = page.locator(`[data-component="workflow-detail-run-row"][data-run-id="${run.run_id}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText("completed_no_change")

    await row.getByRole("button", { name: "Open Run" }).click()

    await expect(page).toHaveURL(new RegExp(`/runs/${run.run_id}$`))
    await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
    await expect(page.locator('[data-component="workflow-graph"]')).toBeVisible()
    await expect(page.locator('[data-component="graph-node"][data-node-id="capture"]')).toBeVisible()
  })
})

test("workflow index supports the blank workflow creation entrypoint", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await withProject(async ({ directory, slug }) => {
    await page.goto(`/${slug}/workflows`)
    await expect(page.locator('[data-page="workflows"]')).toBeVisible()

    await page.getByRole("button", { name: "New workflow" }).click()
    await expect(page.locator('[data-component="workflow-build-form"][data-mode="blank"]')).toBeVisible()

    await page.getByLabel("Workflow name").fill("Blank authoring flow")
    await page.getByLabel("Starter prompt").fill("Prepare a starter release workflow.")
    await page.getByRole("button", { name: "Create workflow" }).click()

    await expect(page).toHaveURL(/\/workflows\/[^/?]+\?tab=authoring$/)
    const workflowID = page.url().match(/\/workflows\/([^/?]+)\?tab=authoring$/)?.[1]
    if (!workflowID) throw new Error(`missing workflow id in ${page.url()}`)

    const file = path.join(directory, ".origin", "workflows", `${workflowID}.yaml`)
    await expect(fs.readFile(file, "utf8")).resolves.toContain("Blank authoring flow")
    await expect(fs.readFile(file, "utf8")).resolves.toContain("Prepare a starter release workflow.")
  })
})

test("workflow index builds workflows and workflow detail run tab starts and reruns real runs", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await withProject(async ({ directory, slug }) => {
    const asset_dir = await fs.mkdtemp(path.join(os.tmpdir(), "origin-phase16-run-"))
    const asset = path.join(asset_dir, "release.txt")
    await fs.writeFile(asset, "from-ui", "utf8")
    const workflowID = `workflow.phase16.${Date.now().toString(16)}`

    try {
      await page.goto(`/${slug}/workflows`)
      await expect(page.locator('[data-page="workflows"]')).toBeVisible()

      await page.getByRole("button", { name: "Build workflow with AI" }).click()
      await page.getByLabel("Workflow name").fill("UI build flow")
      await page.getByLabel("Builder prompt").fill("Inspect release notes and summarize the result.")
      await page.getByRole("button", { name: "Build workflow", exact: true }).click()

      await expect(page).toHaveURL(new RegExp(`/workflows/ui-build-flow\\?tab=authoring$`))
      await expect(fs.readFile(path.join(directory, ".origin", "workflows", "ui-build-flow.yaml"), "utf8")).resolves.toContain(
        "UI build flow",
      )

      await page.goto(`/${slug}/workflows`)
      const built = page.locator('[data-component="validation-resource-row"][data-id="ui-build-flow"]')
      await expect(built).toBeVisible()
      await built.getByRole("button", { name: "Duplicate" }).click()
      await expect(page).toHaveURL(/\/workflows\/ui-build-flow-copy\?tab=authoring$/)

      await page.goto(`/${slug}/workflows`)
      await built.getByRole("button", { name: "Hide" }).click()
      await expect(built).toHaveCount(0)

      await writeWorkflow(directory, workflowID)
      await page.goto(`/${slug}/workflows/${workflowID}?tab=run`)

      await expect(page.locator('[data-component="workflow-run-form"]')).toBeVisible()
      await page.locator('[data-component="workflow-run-input"][data-key="release_tag"] input').fill("v1.2.3")
      await page.locator('[data-component="workflow-run-input"][data-key="notes"] textarea').fill("line one\nline two")
      await page.locator('[data-component="workflow-run-input"][data-key="count"] input').fill("42")
      await page.locator('[data-component="workflow-run-input"][data-key="asset"] input').fill(asset)

      await page.getByRole("button", { name: "Validate Inputs" }).click()
      await expect(page.getByText(/Workflow validated in workspace/)).toBeVisible()

      await page.getByRole("button", { name: "Start Workflow" }).click()
      await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
      await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText('"type": "boolean"')
      await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText(asset)
      await expect(page.locator('[data-component="run-event-row"]').first()).toBeVisible()

      const first = page.url().match(/\/runs\/([^/?]+)/)?.[1]
      if (!first) throw new Error(`missing run id in ${page.url()}`)

      await page.getByRole("button", { name: "Rerun Workflow" }).click()
      await expect
        .poll(() => page.url().match(/\/runs\/([^/?]+)/)?.[1] ?? "", { timeout: 30_000 })
        .not.toBe(first)

      const second = page.url().match(/\/runs\/([^/?]+)/)?.[1]
      if (!second) throw new Error(`missing rerun id in ${page.url()}`)

      await page.getByRole("button", { name: "Edit Rerun Inputs" }).click()
      await expect(page).toHaveURL(new RegExp(`/workflows/${workflowID}\\?tab=run&prefill_run=${second}$`))
      await expect(page.locator('[data-component="workflow-run-input"][data-key="release_tag"] input')).toHaveValue("v1.2.3")
      await expect(page.locator('[data-component="workflow-run-input"][data-key="notes"] textarea')).toHaveValue("line one\nline two")
      await expect(page.locator('[data-component="workflow-run-input"][data-key="count"] input')).toHaveValue("42")
      const assetInput = page.locator('[data-component="workflow-run-input"][data-key="asset"] input')
      await expect
        .poll(() => assetInput.inputValue(), { timeout: 10_000 })
        .toContain("/.origin/runs/materials/")
      const stored = await assetInput.inputValue()
      expect(stored).not.toBe(asset)
      expect(stored).toContain("/.origin/runs/materials/")
      await expect(fs.readFile(stored, "utf8")).resolves.toBe("from-ui")
    } finally {
      await fs.rm(asset_dir, { recursive: true, force: true })
    }
  })
})

test("workflow authoring saves canonical files, survives reload, and hidden edit sessions stay out of the sidebar", async ({
  page,
  withProject,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await withProject(async ({ directory, slug }) => {
    const workflowID = `workflow.phase16.edit.${Date.now().toString(16)}`
    await writeAgentWorkflow(directory, workflowID)

    await page.goto(`/${slug}/workflows/${workflowID}?tab=authoring`)

    await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()
    await expect(page.locator('[data-component="workflow-authoring"]')).toBeVisible()

    await page.getByLabel("Workflow name").fill("Edited transcript workflow")
    await page.getByLabel("Description").fill("Updated through browser authoring")
    await page.getByLabel("Save note").fill("Refine authoring copy")

    await page.locator('[data-component="graph-node"][data-node-id="ask"]').click()
    await expect(page.locator('[data-component="workflow-node-panel"]')).toHaveAttribute("data-node-id", "ask")

    await page.getByLabel("Node title").fill("Ask release owner")
    await page.getByLabel("Inline prompt").fill("Summarize blockers and note the release owner.")

    await page.getByRole("button", { name: "Save workflow" }).click()
    const file = path.join(directory, ".origin", "workflows", `${workflowID}.yaml`)
    await expect
      .poll(async () => (await fs.readFile(file, "utf8")).includes("name: Edited transcript workflow"), { timeout: 30_000 })
      .toBe(true)
    const text = await fs.readFile(file, "utf8")
    expect(text).toContain("name: Edited transcript workflow")
    expect(text).toContain("description: Updated through browser authoring")

    await page.reload()
    await expect(page.locator('[data-page="workflow-detail"]')).toBeVisible()
    await expect(page.getByLabel("Workflow name")).toHaveValue("Edited transcript workflow")
    await page.locator('[data-component="graph-node"][data-node-id="ask"]').click()
    await expect(page.locator('[data-component="workflow-node-panel"]')).toHaveAttribute("data-node-id", "ask")
    await expect(page.getByLabel("Node title")).toHaveValue("Ask release owner")
    await expect(page.getByLabel("Inline prompt")).toHaveValue("Summarize blockers and note the release owner.")

    await page.getByRole("button", { name: "Open Builder Session" }).click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/session/[^/?]+$`))
    await expect(page.locator(promptSelector)).toBeVisible()

    const builder = page.url().match(/\/session\/([^/?]+)/)?.[1]
    if (!builder) throw new Error(`missing builder session in ${page.url()}`)

    await openSidebar(page)
    await expect(page.locator(`[data-session-id="${builder}"]`)).toHaveCount(0)

    await page.goto(`/${slug}/workflows/${workflowID}?tab=authoring&node=ask`)
    await expect(page.locator('[data-component="workflow-node-panel"]')).toHaveAttribute("data-node-id", "ask")

    await page.getByRole("button", { name: "Open Node Edit Session" }).click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/session/[^/?]+$`))
    await expect(page.locator(promptSelector)).toBeVisible()

    const node = page.url().match(/\/session\/([^/?]+)/)?.[1]
    if (!node) throw new Error(`missing node edit session in ${page.url()}`)

    await openSidebar(page)
    await expect(page.locator(`[data-session-id="${node}"]`)).toHaveCount(0)
  })
})

test("history opens a real run detail page with frozen manual-input snapshot data", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await withProject(async ({ directory, slug }) => {
    const workflowID = `workflow.phase15.${Date.now().toString(16)}`
    const run = await createRun({
      directory,
      workflowID,
    })

    await page.goto(`/${slug}/history?tab=runs&workspace=${encodeURIComponent(run.workspace)}`)

    await expect(page.locator('[data-page="history"]')).toBeVisible()
    const row = page.locator(`[data-component="history-run-row"][data-id="${run.run_id}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(workflowID)

    await row.getByRole("button", { name: "Open Run" }).click()

    await expect(page).toHaveURL(new RegExp(`/runs/${run.run_id}$`))
    await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
    await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText('"original_path"')
    await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText(run.asset)
    await expect(page.locator('[data-component="run-detail-input-store"]')).toContainText('"snapshot_path"')

    await page.locator('[data-component="graph-node"][data-node-id="capture"]').click()
    await expect(page.locator('[data-component="run-node-panel"]')).toHaveAttribute("data-node-id", "capture")

    await page.locator('[data-component="run-node-panel-trigger"][data-panel="logs"]').click()
    await expect(page).toHaveURL(new RegExp(`/runs/${run.run_id}\\?node=capture&panel=logs&attempt=0$`))
    await expect(page.getByText("release=v1.2.3")).toBeVisible()
    await expect(page.getByText("notes=line one")).toBeVisible()
    await expect(page.getByText("count=42")).toBeVisible()
    await expect(page.getByText("flag=true")).toBeVisible()
    await expect(page.getByText("choice=alpha")).toBeVisible()
    await expect(fs.readFile(run.asset, "utf8")).resolves.toBe("after-start")

    await page.locator('[data-component="run-node-panel-trigger"][data-panel="artifacts"]').click()
    await expect(page.getByText('"changed_paths": []')).toBeVisible()
  })
})

test("run detail continues agent transcripts into the run follow-up session", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  await withProject(async ({ directory, slug }) => {
    const workflowID = `workflow.phase15.agent.${Date.now().toString(16)}`
    const sdk = createSdk(directory)
    const run = await createAgentRun({
      directory,
      workflowID,
    })

    await page.goto(`/${slug}/runs/${run.run_id}`)

    await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
    await expect(page.getByRole("button", { name: "Open Follow-up" })).toBeVisible()

    await page.locator('[data-component="graph-node"][data-node-id="ask"]').click()
    await expect(page.locator('[data-component="run-node-panel"]')).toHaveAttribute("data-node-id", "ask")

    await page.locator('[data-component="run-node-panel-trigger"][data-panel="transcript"]').click()
    await expect(page).toHaveURL(new RegExp(`/runs/${run.run_id}\\?node=ask&panel=transcript(&attempt=\\d+)?$`))
    await expect(page.getByText("Summarize release blockers for this run.")).toBeVisible()

    await page.getByRole("button", { name: "Continue from Here" }).click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/session/[^/?]+$`))
    const followup = page.url().match(/\/session\/([^/?]+)/)?.[1]
    if (!followup) throw new Error(`missing follow-up session in ${page.url()}`)
    await expect(page.locator(promptSelector)).toBeVisible()
    await expect(page.getByRole("heading", { name: "Workflow: Release transcript follow-up" })).toBeVisible()
    await waitForSessionText({
      sdk,
      sessionID: followup,
      texts: [`Continue from workflow ${workflowID}.`],
    })

    await page.goto(`/${slug}/runs/${run.run_id}?node=ask&panel=transcript`)
    await expect(page.locator('[data-page="run-detail"]')).toBeVisible()

    await page.getByRole("button", { name: "Open Follow-up" }).click()
    await expect(page).toHaveURL(new RegExp(`/session/${followup}$`))
  })
})
