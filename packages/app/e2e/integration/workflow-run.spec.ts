import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test, expect } from "../fixtures"
import { createSdk, serverUrl } from "../utils"

async function workspace_id(directory: string) {
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

async function write_workflow(directory: string, workflow_id: string) {
  const target = path.join(directory, ".origin", "workflows")
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(
    path.join(target, `${workflow_id}.yaml`),
    [
      "schema_version: 2",
      `id: ${workflow_id}`,
      "name: SDK workflow contract",
      "description: Exercise the generated manual-run client against a real graph workflow",
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
      "        sleep 1",
      "        printf 'release=%s\\nnotes=%s\\ncount=%s\\nflag=%s\\nchoice=%s\\nasset=' \"$ORIGIN_INPUT_RELEASE_TAG\" \"$ORIGIN_INPUT_NOTES\" \"$ORIGIN_INPUT_COUNT\" \"$ORIGIN_INPUT_FLAG\" \"$ORIGIN_INPUT_CHOICE\"",
      "        cat \"$ORIGIN_INPUT_ASSET\"",
      "  - id: done",
      "    kind: end",
      "    title: Done",
      "    result: success",
    ].join("\n"),
  )
}

test("generated workflow run client validates, starts, and polls a graph workflow", async ({ withProject }) => {
  await withProject(async ({ directory }) => {
    const sdk = createSdk(directory)
    const workspace = await workspace_id(directory)
    const asset_dir = await fs.mkdtemp(path.join(os.tmpdir(), "origin-sdk-workflow-"))
    const asset = path.join(asset_dir, "release.txt")
    await fs.writeFile(asset, "before-run", "utf8")
    await write_workflow(directory, "basic")

    try {
      const validate = await sdk.workflow.run
        .validate({
          directory,
          workspace,
          workflow_id: "basic",
        })
        .then((item) => item.data)

      expect(validate.ok).toBe(true)
      expect(validate.workflow_id).toBe("basic")

      const started = await sdk.workflow.run
        .start({
          directory,
          workspace,
          workflow_id: "basic",
          trigger_id: "e2e_sdk_contract",
          inputs: {
            release_tag: "v1.2.3",
            notes: "line one\nline two",
            count: 42,
            flag: true,
            choice: "alpha",
            asset,
          },
        })
        .then((item) => item.data)

      expect(started.workflow_id).toBe("basic")
      expect(started.workspace_id).toBe(workspace)
      expect(started.trigger_type).toBe("manual")

      const current = await sdk.workflow.run.get({
        directory,
        workspace,
        run_id: started.id,
      })
      const done = current.data
      expect(done.id).toBe(started.id)
      expect(done.workflow_id).toBe("basic")
      expect(done.workspace_id).toBe(workspace)
      expect(done.trigger_type).toBe("manual")
      expect(["queued", "running", "validating", "completed_no_change", "ready_for_integration", "failed", "canceled"]).toContain(
        done.status,
      )
    } finally {
      await fs.rm(asset_dir, { recursive: true, force: true })
    }
  })
})

test("workflow run start rejects missing workspace context with bad request", async ({ withProject }) => {
  await withProject(async ({ directory }) => {
    const sdk = createSdk(directory)
    await write_workflow(directory, "basic")

    const result = await sdk.workflow.run.start(
      {
        directory,
        workflow_id: "basic",
        trigger_id: "e2e_missing_workspace",
      },
      {
        throwOnError: false,
      },
    )

    expect(result.response.status).toBe(400)
    expect(result.error).toMatchObject({
      name: "RuntimeManualRunWorkspaceRequiredError",
      data: {
        code: "manual_run_workspace_required",
      },
    })
  })
})

test("generated workflow run client surfaces missing workflow_id errors when callers bypass types", async ({ withProject }) => {
  await withProject(async ({ directory }) => {
    const sdk = createSdk(directory)
    const workspace = await workspace_id(directory)
    await write_workflow(directory, "basic")
    const invalid_validate = {
      directory,
      workspace,
    } as unknown as Parameters<typeof sdk.workflow.run.validate>[0]
    const invalid_start = {
      directory,
      workspace,
    } as unknown as Parameters<typeof sdk.workflow.run.start>[0]

    const validate = await sdk.workflow.run.validate(
      invalid_validate,
      {
        throwOnError: false,
      },
    )
    expect(validate.response.status).toBe(400)
    expect(JSON.stringify(validate.error)).toContain("workflow_id")

    const start = await sdk.workflow.run.start(
      invalid_start,
      {
        throwOnError: false,
      },
    )
    expect(start.response.status).toBe(400)
    expect(JSON.stringify(start.error)).toContain("workflow_id")
  })
})
