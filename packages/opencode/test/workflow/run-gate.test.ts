import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { RuntimeWorkflowValidationError } from "../../src/runtime/error"
import { RunTable } from "../../src/runtime/runtime.sql"
import { Database } from "../../src/storage/db"
import { WorkflowRunGate } from "../../src/workflow/run-gate"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

function run_count() {
  return Database.use((db) => db.select().from(RunTable).all().length)
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("workflow run gate", () => {
  test("AC-07: invalid workflow is rejected deterministically and no run starts", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/invalid.yaml",
      [
        "schema_version: 2",
        "id: broken_run",
        "name: Broken run",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: broken",
        "    kind: script",
        "    title: Broken",
        "    script:",
        "      source: resource",
        "      resource_id: missing_resource",
      ].join("\n"),
    )

    const before = run_count()

    try {
      await WorkflowRunGate.validate({
        directory: dir.path,
        workflow_id: "broken_run",
      })
      throw new Error("expected validation gate to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeWorkflowValidationError)
      const value = error as InstanceType<typeof RuntimeWorkflowValidationError>
      expect(value.data.code).toBe("resource_missing")
      expect(value.data.path).toBe("$.steps[0].script.resource_id")
      expect(value.data.workflow_id).toBe("broken_run")
    }

    const after = run_count()
    expect(after).toBe(before)
  })

  test("returns workflow_missing deterministically", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      WorkflowRunGate.validate({
        directory: dir.path,
        workflow_id: "missing_workflow",
      }),
    ).rejects.toMatchObject({
      data: {
        code: "workflow_missing",
        path: "$.id",
      },
    })
  })

  test("duplicate workflow ids are rejected deterministically", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/one.yaml",
      [
        "schema_version: 2",
        "id: duplicate",
        "name: One",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/two.yaml",
      [
        "schema_version: 2",
        "id: duplicate",
        "name: Two",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    await expect(
      WorkflowRunGate.validate({
        directory: dir.path,
        workflow_id: "duplicate",
      }),
    ).rejects.toMatchObject({
      data: {
        code: "workflow_id_duplicate",
        path: "$.id",
      },
    })
  })
})
