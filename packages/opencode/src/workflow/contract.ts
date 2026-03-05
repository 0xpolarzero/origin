import { validation_code } from "@/runtime/contract"
import z from "zod"

export const workspace_type = z.enum(["origin", "standard"])

export const resource_kind = z.enum(["query", "script", "prompt_template"])

export const reference = z
  .object({
    id: z.string().min(1),
    kind: resource_kind,
  })
  .strict()

export const workflow_trigger = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("manual"),
    })
    .strict(),
  z
    .object({
      type: z.literal("cron"),
      cron: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("signal"),
      signal: z.string().min(1),
    })
    .strict(),
])

export const workflow_schema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    trigger: workflow_trigger,
    instructions: z.string().min(1),
    resources: z.array(reference).default([]),
    links: z.array(z.string().min(1)).default([]),
  })
  .strict()

export const query_resource_schema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    kind: z.literal("query"),
    query: z.string().min(1),
    links: z.array(z.string().min(1)).default([]),
  })
  .strict()

export const script_resource_schema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    kind: z.literal("script"),
    script: z.string().min(1),
    links: z.array(z.string().min(1)).default([]),
  })
  .strict()

export const prompt_template_resource_schema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    kind: z.literal("prompt_template"),
    template: z.string().min(1),
    links: z.array(z.string().min(1)).default([]),
  })
  .strict()

export const library_resource_schema = z.discriminatedUnion("kind", [
  query_resource_schema,
  script_resource_schema,
  prompt_template_resource_schema,
])

export const validation_issue = z
  .object({
    code: validation_code,
    path: z.string(),
    message: z.string(),
  })
  .strict()

export const workflow_item = z
  .object({
    file: z.string(),
    id: z.string(),
    workflow: workflow_schema.optional(),
    errors: z.array(validation_issue),
    runnable: z.boolean(),
  })
  .strict()

export const library_item = z
  .object({
    file: z.string(),
    id: z.string(),
    resource: library_resource_schema.optional(),
    errors: z.array(validation_issue),
    runnable: z.boolean(),
  })
  .strict()

export const validation_report = z
  .object({
    workspace_type,
    workflows: z.array(workflow_item),
    library: z.array(library_item),
  })
  .strict()

export type WorkspaceType = z.infer<typeof workspace_type>
export type ResourceKind = z.infer<typeof resource_kind>
export type Workflow = z.infer<typeof workflow_schema>
export type LibraryResource = z.infer<typeof library_resource_schema>
export type ValidationIssue = z.infer<typeof validation_issue>
export type WorkflowItem = z.infer<typeof workflow_item>
export type LibraryItem = z.infer<typeof library_item>
export type ValidationReport = z.infer<typeof validation_report>
