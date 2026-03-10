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
  test("AC-01: valid schema_version 2 workflows are runnable and preserve graph structure", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/library/review-template.yml",
      [
        "schema_version: 1",
        "id: review_template",
        "kind: prompt_template",
        "template: |",
        "  Review {{release_tag}} and decide whether a fix is needed.",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/review_release/scripts/fix.sh",
      [
        "#!/usr/bin/env bash",
        "echo fix",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/review.yml",
      [
        "schema_version: 2",
        "id: review_release",
        "name: Review release",
        "trigger:",
        "  type: manual",
        "inputs:",
        "  - key: release_tag",
        "    type: text",
        "    label: Release tag",
        "    required: true",
        "resources:",
        "  - id: review_prompt",
        "    source: library",
        "    kind: prompt_template",
        "    item_id: review_template",
        "  - id: fix_script",
        "    source: local",
        "    kind: script",
        "    path: scripts/fix.sh",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect release",
        "    prompt:",
        "      source: resource",
        "      resource_id: review_prompt",
        "    output:",
        "      type: object",
        "      required:",
        "        - requires_fix",
        "      properties:",
        "        requires_fix:",
        "          type: boolean",
        "  - id: gate",
        "    kind: condition",
        "    title: Requires fix?",
        "    when:",
        "      ref: steps.inspect.output.requires_fix",
        "      op: equals",
        "      value: true",
        "    then:",
        "      - id: repair",
        "        kind: script",
        "        title: Repair",
        "        script:",
        "          source: resource",
        "          resource_id: fix_script",
        "      - id: failed",
        "        kind: end",
        "        title: Stop",
        "        result: failure",
        "    else:",
        "      - id: done",
        "        kind: end",
        "        title: Done",
        "        result: success",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })

    expect(report.workspace_type).toBe("origin")
    expect(report.library).toHaveLength(1)
    expect(report.workflows).toHaveLength(1)
    expect(report.library[0]?.runnable).toBe(true)
    expect(report.workflows[0]?.runnable).toBe(true)
    expect(report.workflows[0]?.errors).toEqual([])
    expect(report.workflows[0]?.workflow?.steps.map((item) => item.id)).toEqual(["inspect", "gate"])
    expect(report.workflows[0]?.workflow?.resources).toEqual([
      {
        id: "review_prompt",
        source: "library",
        kind: "prompt_template",
        item_id: "review_template",
      },
      {
        id: "fix_script",
        source: "local",
        kind: "script",
        path: "scripts/fix.sh",
      },
    ])
  })

  test("AC-01: legacy schema_version 1 workflows fail with schema_version_unsupported", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/legacy.yaml",
      [
        "schema_version: 1",
        "id: legacy_run",
        "name: Legacy run",
        "trigger:",
        "  type: manual",
        "instructions: old behavior",
      ].join("\n"),
    )

    const first = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const second = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })

    expect(second).toEqual(first)
    expect(first.workflows[0]?.runnable).toBe(false)
    expect(first.workflows[0]?.errors).toEqual([
      {
        code: "schema_version_unsupported",
        path: "$.schema_version",
        message: "schema_version must be 2",
      },
    ])
  })

  test("AC-01: invalid inputs and duplicate keys fail with deterministic input codes", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/input-errors.yaml",
      [
        "schema_version: 2",
        "id: input_errors",
        "name: Input errors",
        "trigger:",
        "  type: manual",
        "inputs:",
        "  - key: mode",
        "    type: select",
        "    label: Mode",
        "    required: true",
        "  - key: branch",
        "    type: text",
        "    label: Branch",
        "    required: true",
        "  - key: branch",
        "    type: text",
        "    label: Duplicate branch",
        "    required: false",
        "steps:",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const workflow = report.workflows[0]

    expect(workflow?.runnable).toBe(false)
    expect(workflow?.errors.some((item) => item.code === "input_shape_invalid" && item.path === "$.inputs[0].options")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "input_key_duplicate" && item.path === "$.inputs[1].key")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "input_key_duplicate" && item.path === "$.inputs[2].key")).toBe(true)
  })

  test("AC-01: undeclared agent_request input placeholders fail with input_ref_invalid", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/library/review-template.yml",
      [
        "schema_version: 1",
        "id: review_template",
        "kind: prompt_template",
        "template: |",
        "  Review {{inputs.release_tag}} and {{inputs.missing_value}}.",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/input-ref.yaml",
      [
        "schema_version: 2",
        "id: input_ref",
        "name: Input refs",
        "trigger:",
        "  type: manual",
        "inputs:",
        "  - key: release_tag",
        "    type: text",
        "    label: Release tag",
        "    required: true",
        "resources:",
        "  - id: review_prompt",
        "    source: library",
        "    kind: prompt_template",
        "    item_id: review_template",
        "steps:",
        "  - id: inline_check",
        "    kind: agent_request",
        "    title: Inline check",
        "    prompt:",
        "      source: inline",
        "      text: Review {{inputs.release_tag}} and {{inputs.branch_name}}.",
        "  - id: resource_check",
        "    kind: agent_request",
        "    title: Resource check",
        "    prompt:",
        "      source: resource",
        "      resource_id: review_prompt",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const workflow = report.workflows[0]

    expect(workflow?.runnable).toBe(false)
    expect(workflow?.errors.some((item) => item.code === "input_ref_invalid" && item.path === "$.steps[0].prompt.text")).toBe(
      true,
    )
    expect(
      workflow?.errors.some((item) => item.code === "input_ref_invalid" && item.path === "$.steps[1].prompt.resource_id"),
    ).toBe(true)
  })

  test("AC-01: local resource boundaries and unsupported resource kinds are deterministic", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/library/report-query.yaml",
      [
        "schema_version: 1",
        "id: report_query",
        "kind: query",
        "query: select 1",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/resource-errors.yaml",
      [
        "schema_version: 2",
        "id: resource_errors",
        "name: Resource errors",
        "trigger:",
        "  type: manual",
        "resources:",
        "  - id: outside",
        "    source: local",
        "    kind: script",
        "    path: ../escape.sh",
        "  - id: missing",
        "    source: local",
        "    kind: script",
        "    path: scripts/missing.sh",
        "  - id: query_ref",
        "    source: library",
        "    kind: query",
        "    item_id: report_query",
        "steps:",
        "  - id: done",
        "    kind: end",
        "    title: Done",
        "    result: success",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const workflow = report.workflows[0]

    expect(workflow?.runnable).toBe(false)
    expect(workflow?.errors.some((item) => item.code === "local_resource_outside_workflow" && item.path === "$.resources[0].path")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "local_resource_missing" && item.path === "$.resources[1].path")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "resource_kind_unsupported" && item.path === "$.resources[2].kind")).toBe(true)
  })

  test("AC-01: script cwd must stay inside the run workspace", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/cwd-errors.yaml",
      [
        "schema_version: 2",
        "id: cwd_errors",
        "name: Cwd errors",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: run",
        "    kind: script",
        "    title: Run",
        "    cwd: ../escape",
        "    script:",
        "      source: inline",
        "      text: echo run",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const workflow = report.workflows[0]

    expect(workflow?.runnable).toBe(false)
    expect(
      workflow?.errors.some(
        (item) =>
          item.code === "schema_invalid" &&
          item.path === "$.steps[0].cwd" &&
          item.message === "cwd must stay inside the run workspace",
      ),
    ).toBe(true)
  })

  test("AC-01: node resource references fail for missing or mismatched workflow resources", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/resource_ref/scripts/run.sh",
      [
        "#!/usr/bin/env bash",
        "echo run",
      ].join("\n"),
    )

    await write(
      dir.path,
      ".origin/workflows/resource-ref.yaml",
      [
        "schema_version: 2",
        "id: resource_ref",
        "name: Resource ref errors",
        "trigger:",
        "  type: manual",
        "resources:",
        "  - id: script_res",
        "    source: local",
        "    kind: script",
        "    path: scripts/run.sh",
        "steps:",
        "  - id: inspect",
        "    kind: agent_request",
        "    title: Inspect",
        "    prompt:",
        "      source: resource",
        "      resource_id: script_res",
        "  - id: shell",
        "    kind: script",
        "    title: Shell",
        "    script:",
        "      source: resource",
        "      resource_id: missing_res",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const workflow = report.workflows[0]

    expect(workflow?.runnable).toBe(false)
    expect(
      workflow?.errors.some(
        (item) => item.code === "resource_kind_mismatch" && item.path === "$.steps[0].prompt.resource_id",
      ),
    ).toBe(true)
    expect(
      workflow?.errors.some(
        (item) => item.code === "resource_missing" && item.path === "$.steps[1].script.resource_id",
      ),
    ).toBe(true)
  })

  test("AC-01: duplicate node ids, deferred node kinds, and invalid condition refs are deterministic", async () => {
    await using dir = await tmpdir({ git: true })

    await write(
      dir.path,
      ".origin/workflows/condition-errors.yaml",
      [
        "schema_version: 2",
        "id: condition_errors",
        "name: Condition errors",
        "trigger:",
        "  type: manual",
        "steps:",
        "  - id: later",
        "    kind: condition",
        "    title: Later",
        "    when:",
        "      ref: steps.after.output.changed_paths",
        "      op: contains",
        "    then:",
        "      - id: repeated",
        "        kind: end",
        "        title: Repeated",
        "        result: success",
        "    else:",
        "      - id: repeated",
        "        kind: end",
        "        title: Repeated",
        "        result: failure",
        "  - id: deferred",
        "    kind: parallel",
        "    title: Deferred",
        "  - id: after",
        "    kind: script",
        "    title: After",
        "    script:",
        "      source: inline",
        "      text: echo after",
      ].join("\n"),
    )

    const report = await WorkflowValidation.validate({ directory: dir.path, workspace_type: "origin" })
    const workflow = report.workflows[0]

    expect(workflow?.runnable).toBe(false)
    expect(workflow?.errors.some((item) => item.code === "node_kind_unsupported" && item.path === "$.steps[1].kind")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "node_id_duplicate" && item.path === "$.steps[0].then[0].id")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "node_id_duplicate" && item.path === "$.steps[0].else[0].id")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "condition_ref_invalid" && item.path === "$.steps[0].when.op")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "condition_ref_invalid" && item.path === "$.steps[0].when.value")).toBe(true)
    expect(workflow?.errors.some((item) => item.code === "condition_ref_invalid" && item.path === "$.steps[0].when.ref")).toBe(true)
  })
})
