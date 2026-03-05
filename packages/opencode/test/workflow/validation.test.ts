import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkflowValidation } from "../../src/workflow/validate"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

describe("workflow validation", () => {
  test("AC-01: valid workflow and library YAML parse into runnable normalized output", async () => {
    await using dir = await tmpdir({ git: true })

    await write(dir.path, ".origin/knowledge-base/guide.md", "hello")

    await write(
      dir.path,
      ".origin/library/users-query.yaml",
      [
        "schema_version: 1",
        "id: users_lookup",
        "kind: query",
        "query: |",
        "  select * from users",
        "links:",
        "  - guide.md",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/library/report-script.yaml",
      [
        "schema_version: 1",
        "id: build_report",
        "kind: script",
        "script: |",
        "  echo report",
        "links:",
        "  - guide.md",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/library/report-template.yaml",
      [
        "schema_version: 1",
        "id: report_template",
        "kind: prompt_template",
        "template: |",
        "  Summarize {{input}}",
        "links:",
        "  - guide.md",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/nightly.yaml",
      [
        "schema_version: 1",
        "id: nightly_report",
        "name: Nightly report",
        "trigger:",
        "  type: manual",
        "instructions: Generate nightly report",
        "resources:",
        "  - id: users_lookup",
        "    kind: query",
        "  - id: build_report",
        "    kind: script",
        "  - id: report_template",
        "    kind: prompt_template",
        "links:",
        "  - guide.md",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })

    expect(report.workspace_type).toBe("origin")
    expect(report.workflows.length).toBe(1)
    expect(report.library.length).toBe(3)
    expect(report.workflows[0].runnable).toBe(true)
    expect(report.workflows[0].errors).toEqual([])
    expect(report.workflows[0].workflow?.id).toBe("nightly_report")
    expect(report.workflows[0].workflow?.resources.map((item) => item.id)).toEqual([
      "users_lookup",
      "build_report",
      "report_template",
    ])
    expect(report.library.every((item) => item.runnable)).toBe(true)
  })

  test("AC-02: invalid YAML/schema are deterministic and non-runnable", async () => {
    await using dir = await tmpdir({ git: true })

    await write(dir.path, ".origin/workflows/broken.yaml", "schema_version: [1")
    await write(
      dir.path,
      ".origin/library/bad.yaml",
      [
        "schema_version: 1",
        "id: bad_resource",
        "script: echo hi",
      ].join("\n"),
    )

    const first = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const second = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })

    expect(second).toEqual(first)
    expect(first.workflows[0].runnable).toBe(false)
    expect(first.library[0].runnable).toBe(false)
    expect(first.workflows[0].errors[0].code).toBe("yaml_parse_error")
    expect(first.library[0].errors.some((item) => item.code === "schema_invalid")).toBe(true)
  })

  test("AC-03: non-origin capability constraints are enforced", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/library/query.yaml",
      [
        "schema_version: 1",
        "id: users_lookup",
        "kind: query",
        "query: select 1",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/signal.yaml",
      [
        "schema_version: 1",
        "id: signal_run",
        "name: Signal run",
        "trigger:",
        "  type: signal",
        "  signal: incoming-webhook",
        "instructions: Run",
        "resources:",
        "  - id: users_lookup",
        "    kind: query",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "standard" })
    const workflow = report.workflows[0]
    const library = report.library[0]

    expect(library.runnable).toBe(false)
    expect(workflow.runnable).toBe(false)
    expect(library.errors.some((item) => item.code === "workspace_capability_blocked" && item.path === "$.kind")).toBe(true)
    expect(
      workflow.errors.some(
        (item) => item.code === "workspace_capability_blocked" && item.path === "$.trigger.type",
      ),
    ).toBe(true)
    expect(
      workflow.errors.some(
        (item) => item.code === "workspace_capability_blocked" && item.path === "$.resources[0].kind",
      ),
    ).toBe(true)
  })

  test("defaults to standard workspace outside ~/Documents/origin", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/library/query.yaml",
      [
        "schema_version: 1",
        "id: users_lookup",
        "kind: query",
        "query: select 1",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path })
    expect(report.workspace_type).toBe("standard")
    expect(report.library[0]?.errors.some((item) => item.code === "workspace_capability_blocked")).toBe(true)
  })

  test("AC-04: reference integrity catches missing resource, wrong kind, broken links", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/library/template.yaml",
      [
        "schema_version: 1",
        "id: report_template",
        "kind: prompt_template",
        "template: hello",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/refs.yaml",
      [
        "schema_version: 1",
        "id: validate_refs",
        "name: Validate refs",
        "trigger:",
        "  type: manual",
        "instructions: Validate refs",
        "resources:",
        "  - id: missing_query",
        "    kind: query",
        "  - id: report_template",
        "    kind: script",
        "links:",
        "  - missing.md",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const workflow = report.workflows[0]

    expect(workflow.runnable).toBe(false)
    expect(
      workflow.errors.some(
        (item) => item.code === "resource_missing" && item.path === "$.resources[0].id",
      ),
    ).toBe(true)
    expect(
      workflow.errors.some(
        (item) => item.code === "resource_kind_mismatch" && item.path === "$.resources[1].kind",
      ),
    ).toBe(true)
    expect(
      workflow.errors.some(
        (item) => item.code === "reference_broken_link" && item.path === "$.links[0]",
      ),
    ).toBe(true)
  })

  test("duplicate workflow ids are non-runnable with deterministic error code", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/one.yaml",
      [
        "schema_version: 1",
        "id: duplicate",
        "name: One",
        "trigger:",
        "  type: manual",
        "instructions: one",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/two.yaml",
      [
        "schema_version: 1",
        "id: duplicate",
        "name: Two",
        "trigger:",
        "  type: manual",
        "instructions: two",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    expect(report.workflows).toHaveLength(2)
    expect(report.workflows.every((item) => item.runnable === false)).toBe(true)
    expect(
      report.workflows.every((item) =>
        item.errors.some((error) => error.code === "workflow_id_duplicate" && error.path === "$.id"),
      ),
    ).toBe(true)
  })
})
