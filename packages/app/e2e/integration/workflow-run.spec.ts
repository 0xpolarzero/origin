import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { test, expect } from "../fixtures"
import { createSdk } from "../utils"

async function write_workflow(directory: string, workflow_id: string) {
  const target = path.join(directory, ".origin", "workflows")
  await mkdir(target, { recursive: true })
  await writeFile(
    path.join(target, `${workflow_id}.yaml`),
    ["schema_version: 1", `id: ${workflow_id}`, "name: Workflow", "trigger:", "  type: manual", "instructions: run"].join(
      "\n",
    ),
  )
}

test("workflow run validate succeeds for runnable workflow id", async ({ withProject }) => {
  await withProject(async ({ directory }) => {
    const sdk = createSdk(directory)
    await write_workflow(directory, "basic")

    const result = await sdk.workflow.run
      .validate({
        directory,
        workflow_id: "basic",
      })
      .then((item) => item.data)

    expect(result.ok).toBe(true)
    expect(result.workflow_id).toBe("basic")
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
