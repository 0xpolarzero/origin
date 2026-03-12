import { rm } from "node:fs/promises"
import path from "node:path"
import { createPatch } from "diff"
import { Instance } from "@/project/instance"
import { RuntimeLibraryRevision } from "@/runtime/library-revision"
import { NotFoundError } from "@/storage/db"
import { library_item, library_resource_schema, type LibraryItem, type WorkflowItem } from "./contract"
import { WorkflowAuthoring } from "./authoring"
import { WorkflowValidation } from "./validate"
import z from "zod"

const usage = z
  .object({
    workflow_id: z.string(),
    name: z.string(),
    file: z.string(),
  })
  .strict()

const summary = library_item
  .extend({
    used_by: z.array(z.string()),
    last_edited_at: z.number().nullable(),
  })
  .strict()

const detail = z
  .object({
    item: summary,
    revision_head: RuntimeLibraryRevision.View.nullable(),
    canonical_text: z.string(),
    used_by: z.array(usage),
  })
  .strict()

const save_input = z
  .object({
    text: z.string(),
  })
  .strict()

const copy_input = z
  .object({
    workflow_id: z.string().min(1),
  })
  .strict()

const copy_result = z
  .object({
    workflow_id: z.string(),
    resources: z.array(
      z
        .object({
          id: z.string(),
          path: z.string(),
        })
        .strict(),
    ),
  })
  .strict()

const remove_result = z
  .object({
    deleted: z.literal(true),
  })
  .strict()

const history_item = z
  .object({
    revision: RuntimeLibraryRevision.View,
    previous_revision: RuntimeLibraryRevision.View.nullable(),
    diff: z.string(),
  })
  .strict()

const history_page = z
  .object({
    items: z.array(history_item),
    next_cursor: z.string().nullable(),
  })
  .strict()

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function body(item: z.infer<typeof library_resource_schema>) {
  if (item.kind === "query") throw new Error("Query library items cannot be copied into graph workflows.")
  const raw = item.kind === "script" ? item.script : item.template
  return raw.endsWith("\n") ? raw : `${raw}\n`
}

function suffix(item: z.infer<typeof library_resource_schema>) {
  if (item.kind === "script") return ".sh"
  if (item.kind === "prompt_template") return ".txt"
  throw new Error("Query library items cannot be copied into graph workflows.")
}

function patch(
  current: z.output<typeof RuntimeLibraryRevision.View>,
  prev: z.output<typeof RuntimeLibraryRevision.View> | null,
) {
  return createPatch(current.file, prev?.canonical_text ?? "", current.canonical_text, "previous", "current")
}

function refs(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, item_id: string) {
  return report.workflows
    .filter((item) => item.workflow?.resources.some((resource) => resource.source === "library" && resource.item_id === item_id))
    .map((item) =>
      usage.parse({
        workflow_id: item.id,
        name: item.workflow?.name ?? item.id,
        file: item.file,
      }),
    )
    .toSorted((a, b) => a.workflow_id.localeCompare(b.workflow_id))
}

function row(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, item: LibraryItem) {
  return summary.parse({
    ...item,
    used_by: refs(report, item.id).map((value) => value.workflow_id),
    last_edited_at:
      RuntimeLibraryRevision.head({
        project_id: Instance.project.id,
        item_id: item.id,
      })?.created_at ?? null,
  })
}

function file(item: LibraryItem) {
  return path.join(Instance.directory, item.file)
}

async function load(item: LibraryItem) {
  return Bun.file(file(item)).text()
}

function pick(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, file: string) {
  const item = report.library.find((row) => row.file === file)
  if (!item) throw new NotFoundError({ message: `Library item not found: ${file}` })
  return item
}

function workflow(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, workflow_id: string) {
  const item = report.workflows.find((row) => row.id === workflow_id)
  if (!item) throw new NotFoundError({ message: `Workflow not found: ${workflow_id}` })
  if (!item.workflow) throw new Error(`Workflow is not editable: ${workflow_id}`)
  return item as WorkflowItem & { workflow: NonNullable<WorkflowItem["workflow"]> }
}

export namespace LibraryAuthoring {
  export const Summary = summary
  export const Detail = detail
  export const SaveInput = save_input
  export const CopyInput = copy_input
  export const CopyResult = copy_result
  export const RemoveResult = remove_result
  export const HistoryItem = history_item
  export const HistoryPage = history_page

  export async function list() {
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    return z.array(summary).parse(report.library.map((item) => row(report, item)))
  }

  export async function detail_for(report: Awaited<ReturnType<typeof WorkflowValidation.validate>>, item: LibraryItem) {
    const canonical_text = await load(item)
    const revision_head = RuntimeLibraryRevision.observe({
      project_id: Instance.project.id,
      item_id: item.id,
      file: item.file,
      canonical_text,
    })

    return detail.parse({
      item: row(report, item),
      revision_head,
      canonical_text,
      used_by: refs(report, item.id),
    })
  }

  export async function save(item: LibraryItem, input: z.input<typeof SaveInput>) {
    const value = SaveInput.parse(input)
    await Bun.write(file(item), value.text.endsWith("\n") ? value.text : `${value.text}\n`)
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    return detail_for(report, pick(report, item.file))
  }

  export async function history(item: LibraryItem, cursor?: string, limit?: number) {
    const canonical_text = await load(item)
    RuntimeLibraryRevision.observe({
      project_id: Instance.project.id,
      item_id: item.id,
      file: item.file,
      canonical_text,
    })
    const page = RuntimeLibraryRevision.list({
      project_id: Instance.project.id,
      item_id: item.id,
      cursor,
      limit,
    })

    return history_page.parse({
      items: page.items.map((revision, idx) => {
        const previous_revision =
          idx < page.items.length - 1 ? page.items[idx + 1] ?? null : revision.id === page.items.at(-1)?.id ? null : null
        return {
          revision,
          previous_revision,
          diff: patch(revision, previous_revision),
        }
      }),
      next_cursor: page.next_cursor,
    })
  }

  export async function copy(item: LibraryItem, input: z.input<typeof CopyInput>) {
    const value = CopyInput.parse(input)
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    const next = workflow(report, value.workflow_id)
    const resource = item.resource
    if (!resource) throw new Error(`Library item is not valid: ${item.id}`)
    if (resource.kind === "query") throw new Error(`Library item kind cannot be copied locally: ${resource.kind}`)

    const writes: Record<string, string> = {}
    const copied: Array<{ id: string; path: string }> = []
    const resources = next.workflow.resources.map((row) => {
      if (row.source !== "library" || row.item_id !== item.id) return row
      const rel = `resources/${slug(row.id) || row.id}${suffix(resource)}`
      writes[rel] = body(resource)
      copied.push({
        id: row.id,
        path: rel,
      })
      return {
        id: row.id,
        source: "local" as const,
        kind: resource.kind,
        path: rel,
      }
    })

    if (copied.length === 0) {
      throw new Error(`Workflow does not use library item: ${item.id}`)
    }

    await WorkflowAuthoring.save({
      workflow: {
        ...next.workflow,
        resources,
      },
      resources: writes,
      action: "graph_edit",
      note: `Created local copy from ${item.id}`,
    })

    return copy_result.parse({
      workflow_id: next.id,
      resources: copied,
    })
  }

  export async function remove(item: LibraryItem) {
    const report = await WorkflowValidation.validate({
      directory: Instance.directory,
    })
    const links = refs(report, item.id)
    if (links.length > 0) {
      throw new Error(`Library item is still used by: ${links.map((item) => item.workflow_id).join(", ")}`)
    }
    await rm(file(item), { force: true })
    return remove_result.parse({
      deleted: true,
    })
  }
}
