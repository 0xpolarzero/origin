import path from "node:path"
import {
  type LibraryItem,
  type LibraryResource,
  type ValidationIssue,
  type ValidationReport,
  type Workflow,
  type WorkflowItem,
  library_resource_schema,
  workflow_schema,
  workspace_type,
} from "./contract"
import { RuntimeWorkspaceType } from "@/runtime/workspace-type"

function key(value: ValidationIssue) {
  return `${value.path}\u0000${value.code}\u0000${value.message}`
}

function sort_errors(value: ValidationIssue[]) {
  return value.toSorted((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    if (a.code !== b.code) return a.code.localeCompare(b.code)
    return a.message.localeCompare(b.message)
  })
}

function push(list: ValidationIssue[], value: ValidationIssue) {
  const exists = list.some((item) => key(item) === key(value))
  if (exists) return
  list.push(value)
}

function json_path(input: readonly PropertyKey[]) {
  if (!input.length) return "$"
  return input.reduce<string>((acc, item) => {
    if (typeof item === "number") return `${acc}[${item}]`
    if (typeof item === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) return `${acc}.${item}`
    return `${acc}[${JSON.stringify(String(item))}]`
  }, "$")
}

function zod_issue(pathname: readonly PropertyKey[], message: string): ValidationIssue {
  if (pathname[0] === "schema_version") {
    return {
      code: "schema_version_unsupported",
      path: json_path(pathname),
      message: "schema_version must be 1",
    }
  }
  return {
    code: "schema_invalid",
    path: json_path(pathname),
    message,
  }
}

function ref(file: string, directory: string) {
  const relative = path.relative(directory, file)
  return relative.split(path.sep).join(path.posix.sep)
}

async function scan(directory: string, patterns: string[]) {
  const all = await Promise.all(
    patterns.map(async (pattern) => {
      const glob = new Bun.Glob(pattern)
      const values: string[] = []
      for await (const file of glob.scan({ cwd: directory, absolute: true, dot: true })) {
        values.push(file)
      }
      return values
    }),
  )
  return all.flat().toSorted((a, b) => a.localeCompare(b))
}

function parse_yaml(value: string) {
  try {
    return {
      value: Bun.YAML.parse(value),
      error: undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      value: undefined,
      error: {
        code: "yaml_parse_error" as const,
        path: "$",
        message,
      },
    }
  }
}

function id_from(file: string, doc: unknown) {
  if (doc && typeof doc === "object" && "id" in doc && typeof doc.id === "string" && doc.id.length) {
    return doc.id
  }
  return path.basename(file, path.extname(file))
}

async function read_workflows(directory: string) {
  const files = await scan(directory, [".origin/workflows/*.yaml", ".origin/workflows/*.yml"])
  const result: WorkflowItem[] = []

  for (const file of files) {
    const text = await Bun.file(file).text()
    const loaded = parse_yaml(text)
    if (loaded.error) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, undefined),
        workflow: undefined,
        errors: [loaded.error],
        runnable: false,
      })
      continue
    }

    const parsed = workflow_schema.safeParse(loaded.value)
    if (!parsed.success) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, loaded.value),
        workflow: undefined,
        errors: sort_errors(parsed.error.issues.map((item) => zod_issue(item.path, item.message))),
        runnable: false,
      })
      continue
    }

    result.push({
      file: ref(file, directory),
      id: parsed.data.id,
      workflow: parsed.data,
      errors: [],
      runnable: true,
    })
  }

  return result
}

async function read_library(directory: string) {
  const files = await scan(directory, [".origin/library/*.yaml", ".origin/library/*.yml"])
  const result: LibraryItem[] = []

  for (const file of files) {
    const text = await Bun.file(file).text()
    const loaded = parse_yaml(text)
    if (loaded.error) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, undefined),
        resource: undefined,
        errors: [loaded.error],
        runnable: false,
      })
      continue
    }

    const parsed = library_resource_schema.safeParse(loaded.value)
    if (!parsed.success) {
      result.push({
        file: ref(file, directory),
        id: id_from(file, loaded.value),
        resource: undefined,
        errors: sort_errors(parsed.error.issues.map((item) => zod_issue(item.path, item.message))),
        runnable: false,
      })
      continue
    }

    result.push({
      file: ref(file, directory),
      id: parsed.data.id,
      resource: parsed.data,
      errors: [],
      runnable: true,
    })
  }

  return result
}

function link_path(link: string) {
  const normalized = path.posix
    .normalize(link.replaceAll("\\", "/"))
    .replace(/^\/+/, "")

  if (!normalized || normalized === ".") return
  if (normalized.startsWith("../") || normalized === "..") return
  return normalized
}

async function check_link(
  directory: string,
  links: string[],
  pointer: (index: number) => string,
  errors: ValidationIssue[],
) {
  const root = path.join(directory, ".origin", "knowledge-base")

  await Promise.all(
    links.map(async (link, index) => {
      const normalized = link_path(link)
      if (!normalized) {
        push(errors, {
          code: "reference_broken_link",
          path: pointer(index),
          message: "knowledge-base link must stay within .origin/knowledge-base",
        })
        return
      }
      const target = path.join(root, normalized)
      const exists = await Bun.file(target).exists()
      if (exists) return
      push(errors, {
        code: "reference_broken_link",
        path: pointer(index),
        message: `knowledge-base link not found: ${normalized}`,
      })
    }),
  )
}

function match_index(values: LibraryItem[]) {
  const out = new Map<string, LibraryItem[]>()
  values.forEach((item) => {
    if (!item.resource) return
    const list = out.get(item.resource.id) ?? []
    list.push(item)
    out.set(item.resource.id, list)
  })
  return out
}

function workflow_index(values: WorkflowItem[]) {
  const out = new Map<string, WorkflowItem[]>()
  values.forEach((item) => {
    if (!item.workflow) return
    const list = out.get(item.workflow.id) ?? []
    list.push(item)
    out.set(item.workflow.id, list)
  })
  return out
}

function enforce_library_capability(item: LibraryItem, type: "origin" | "standard") {
  if (!item.resource) return
  if (type === "origin") return
  if (item.resource.kind !== "query") return
  push(item.errors, {
    code: "workspace_capability_blocked",
    path: "$.kind",
    message: "query resources are not supported in standard workspaces",
  })
}

function enforce_workflow_capability(item: WorkflowItem, type: "origin" | "standard") {
  if (!item.workflow) return
  if (type === "origin") return
  if (item.workflow.trigger.type === "signal") {
    push(item.errors, {
      code: "workspace_capability_blocked",
      path: "$.trigger.type",
      message: "signal trigger is not supported in standard workspaces",
    })
  }

  item.workflow.resources.forEach((value, index) => {
    if (value.kind !== "query") return
    push(item.errors, {
      code: "workspace_capability_blocked",
      path: `$.resources[${index}].kind`,
      message: "query resources are not supported in standard workspaces",
    })
  })
}

async function validate_library(directory: string, values: LibraryItem[], type: "origin" | "standard") {
  const index = match_index(values)

  for (const item of values) {
    enforce_library_capability(item, type)
    if (!item.resource) {
      item.errors = sort_errors(item.errors)
      item.runnable = item.errors.length === 0
      continue
    }

    const duplicate = index.get(item.resource.id) ?? []
    if (duplicate.length > 1) {
      push(item.errors, {
        code: "resource_id_duplicate",
        path: "$.id",
        message: `duplicate library resource id: ${item.resource.id}`,
      })
    }

    await check_link(directory, item.resource.links, (index) => `$.links[${index}]`, item.errors)
    item.errors = sort_errors(item.errors)
    item.runnable = item.errors.length === 0
  }

  return index
}

async function validate_workflows(
  directory: string,
  values: WorkflowItem[],
  index: Map<string, LibraryItem[]>,
  type: "origin" | "standard",
) {
  const workflows = workflow_index(values)
  for (const item of values) {
    enforce_workflow_capability(item, type)
    if (!item.workflow) {
      item.errors = sort_errors(item.errors)
      item.runnable = item.errors.length === 0
      continue
    }

    const duplicate = workflows.get(item.workflow.id) ?? []
    if (duplicate.length > 1) {
      push(item.errors, {
        code: "workflow_id_duplicate",
        path: "$.id",
        message: `duplicate workflow id: ${item.workflow.id}`,
      })
    }

    await check_link(directory, item.workflow.links, (index) => `$.links[${index}]`, item.errors)

    item.workflow.resources.forEach((value, index_value) => {
      const matches = index.get(value.id)
      if (!matches || matches.length === 0) {
        push(item.errors, {
          code: "resource_missing",
          path: `$.resources[${index_value}].id`,
          message: `library resource not found: ${value.id}`,
        })
        return
      }

      if (matches.length > 1) {
        push(item.errors, {
          code: "resource_id_duplicate",
          path: `$.resources[${index_value}].id`,
          message: `library resource id is ambiguous: ${value.id}`,
        })
        return
      }

      const match = matches[0]
      const resource = match.resource
      if (!resource) {
        push(item.errors, {
          code: "resource_missing",
          path: `$.resources[${index_value}].id`,
          message: `library resource not found: ${value.id}`,
        })
        return
      }

      if (resource.kind !== value.kind) {
        push(item.errors, {
          code: "resource_kind_mismatch",
          path: `$.resources[${index_value}].kind`,
          message: `expected ${value.kind}, found ${resource.kind}`,
        })
        return
      }

      if (!match.runnable) {
        push(item.errors, {
          code: "resource_not_runnable",
          path: `$.resources[${index_value}].id`,
          message: `resource is not runnable: ${value.id}`,
        })
      }
    })

    item.errors = sort_errors(item.errors)
    item.runnable = item.errors.length === 0
  }
}

export namespace WorkflowValidation {
  export const Input = workspace_type.optional()

  export async function validate(input: { directory: string; workspace_type?: "origin" | "standard" }) {
    const type = Input.parse(input.workspace_type) ?? (await RuntimeWorkspaceType.detect(input.directory))
    const [workflows, library] = await Promise.all([read_workflows(input.directory), read_library(input.directory)])
    const index = await validate_library(input.directory, library, type)
    await validate_workflows(input.directory, workflows, index, type)

    const report: ValidationReport = {
      workspace_type: type,
      workflows: workflows
        .toSorted((a, b) => {
          if (a.id !== b.id) return a.id.localeCompare(b.id)
          return a.file.localeCompare(b.file)
        })
        .map((item) => ({
          ...item,
          errors: sort_errors(item.errors),
          runnable: item.errors.length === 0,
        })),
      library: library
        .toSorted((a, b) => {
          if (a.id !== b.id) return a.id.localeCompare(b.id)
          return a.file.localeCompare(b.file)
        })
        .map((item) => ({
          ...item,
          errors: sort_errors(item.errors),
          runnable: item.errors.length === 0,
        })),
    }

    return report
  }

  export function workflow(report: ValidationReport, id: string) {
    return report.workflows.find((item) => item.id === id)
  }

  export function library(report: ValidationReport, id: string) {
    return report.library.find((item) => item.id === id)
  }

  export function resources(report: ValidationReport) {
    const out = new Map<string, LibraryResource>()
    report.library.forEach((item) => {
      if (!item.resource || !item.runnable) return
      if (out.has(item.resource.id)) return
      out.set(item.resource.id, item.resource)
    })
    return out
  }

  export function definitions(report: ValidationReport) {
    const out = new Map<string, Workflow>()
    report.workflows.forEach((item) => {
      if (!item.workflow || !item.runnable) return
      if (out.has(item.workflow.id)) return
      out.set(item.workflow.id, item.workflow)
    })
    return out
  }
}
