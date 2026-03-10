import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test, expect } from "../fixtures"
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

async function createRun(input: {
  directory: string
  workflowID: string
}) {
  const sdk = createSdk(input.directory)
  const workspace = await sdk.experimental.workspace
    .create({
      id: `wrk_phase15_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`,
      directory: input.directory,
      branch: null,
      config: {
        type: "worktree",
        directory: input.directory,
      },
    })
    .then((result) => result.data.id)
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
  const detail = await fetch(
    `${serverUrl}/workflow/runs/${encodeURIComponent(done.id)}/detail?directory=${encodeURIComponent(input.directory)}`,
  ).then((response) => response.json())
  const snapshot_path = detail?.snapshot?.input_store_json?.asset?.snapshot_path
  if (typeof snapshot_path !== "string") {
    throw new Error(`missing snapshot path for ${done.id}`)
  }

  return {
    workspace,
    asset,
    run_id: done.id,
    snapshot_path,
  }
}

async function createAgentRun(input: {
  directory: string
  workflowID: string
}) {
  const sdk = createSdk(input.directory)
  const workspace = await sdk.experimental.workspace
    .create({
      id: `wrk_phase15_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`,
      directory: input.directory,
      branch: null,
      config: {
        type: "worktree",
        directory: input.directory,
      },
    })
    .then((result) => result.data.id)
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
  const detail = await fetch(
    `${serverUrl}/workflow/runs/${encodeURIComponent(done.id)}/detail?directory=${encodeURIComponent(input.directory)}`,
  ).then((response) => response.json())
  const node = Array.isArray(detail?.nodes)
    ? detail.nodes.find(
        (item): item is {
          attempts?: Array<{ attempt?: { session_id?: string | null } }>
        } => !!item && typeof item === "object" && item.node?.node_id === "ask",
      )
    : null
  const execution_session_id = node?.attempts?.[0]?.attempt?.session_id
  const followup_session_id = detail?.followup?.session?.id
  if (typeof execution_session_id !== "string") {
    throw new Error(`missing execution session for ${done.id}`)
  }
  if (typeof followup_session_id !== "string") {
    throw new Error(`missing follow-up session for ${done.id}`)
  }

  return {
    workspace,
    run_id: done.id,
    execution_session_id,
    followup_session_id,
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
    await expect(fs.readFile(run.snapshot_path, "utf8")).resolves.toBe("before-run")
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

    expect(run.followup_session_id).not.toBe(run.execution_session_id)

    await page.goto(`/${slug}/runs/${run.run_id}`)

    await expect(page.locator('[data-page="run-detail"]')).toBeVisible()
    await expect(page.getByRole("button", { name: "Open Follow-up" })).toBeVisible()

    await page.locator('[data-component="graph-node"][data-node-id="ask"]').click()
    await expect(page.locator('[data-component="run-node-panel"]')).toHaveAttribute("data-node-id", "ask")

    await page.locator('[data-component="run-node-panel-trigger"][data-panel="transcript"]').click()
    await expect(page).toHaveURL(new RegExp(`/runs/${run.run_id}\\?node=ask&panel=transcript(&attempt=\\d+)?$`))
    await expect(page.getByText("Summarize release blockers for this run.")).toBeVisible()

    await page.getByRole("button", { name: "Continue from Here" }).click()
    await expect(page).toHaveURL(new RegExp(`/session/${run.followup_session_id}$`))
    await expect(page.locator(promptSelector)).toBeVisible()
    await expect(page.getByRole("heading", { name: "Workflow: Release transcript follow-up" })).toBeVisible()
    await waitForSessionText({
      sdk,
      sessionID: run.followup_session_id,
      texts: [`Continue from workflow ${workflowID}.`, `Source transcript session: ${run.execution_session_id}.`],
    })
    expect(page.url()).not.toContain(`/session/${run.execution_session_id}`)

    await page.goto(`/${slug}/runs/${run.run_id}?node=ask&panel=transcript`)
    await expect(page.locator('[data-page="run-detail"]')).toBeVisible()

    await page.getByRole("button", { name: "Open Follow-up" }).click()
    await expect(page).toHaveURL(new RegExp(`/session/${run.followup_session_id}$`))
    expect(page.url()).not.toContain(`/session/${run.execution_session_id}`)
  })
})
