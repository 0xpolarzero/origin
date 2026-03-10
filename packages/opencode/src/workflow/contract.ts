import { validation_code } from "@/runtime/contract"
import z from "zod"

export const workspace_type = z.enum(["origin", "standard"])

export const library_resource_kind = z.enum(["query", "script", "prompt_template"])
export const workflow_resource_kind = z.enum(["script", "prompt_template"])
export const authored_node_kind = z.enum(["agent_request", "script", "condition", "end"])
export const deferred_node_kind = z.enum(["parallel", "loop", "validation", "draft_action"])
export const condition_operator = z.enum(["equals", "not_equals"])
export const end_result = z.enum(["success", "failure", "noop"])
export const path_input_mode = z.enum(["file", "directory", "either"])
export const input_type = z.enum(["text", "long_text", "number", "boolean", "select", "path"])

const scalar_value = z.union([z.string(), z.number(), z.boolean(), z.null()])
const scalar_type = z.enum(["string", "number", "boolean", "null"])
const input_key = z.string().regex(/^[a-z][a-z0-9_]*$/)

type OutputFieldValue =
  | {
      type: "object"
      required: string[]
      properties: Record<string, OutputFieldValue>
    }
  | {
      type: z.infer<typeof scalar_type>
    }

export const workflow_trigger = z
  .object({
    type: z.literal("manual"),
  })
  .strict()

export const input_option = z
  .object({
    label: z.string().min(1),
    value: scalar_value,
  })
  .strict()

const text_input = z
  .object({
    key: input_key,
    type: z.literal("text"),
    label: z.string().min(1),
    required: z.boolean(),
    default: z.string().optional(),
  })
  .strict()

const long_text_input = z
  .object({
    key: input_key,
    type: z.literal("long_text"),
    label: z.string().min(1),
    required: z.boolean(),
    default: z.string().optional(),
  })
  .strict()

const number_input = z
  .object({
    key: input_key,
    type: z.literal("number"),
    label: z.string().min(1),
    required: z.boolean(),
    default: z.number().finite().optional(),
  })
  .strict()

const boolean_input = z
  .object({
    key: input_key,
    type: z.literal("boolean"),
    label: z.string().min(1),
    required: z.boolean(),
    default: z.boolean().optional(),
  })
  .strict()

const select_input = z
  .object({
    key: input_key,
    type: z.literal("select"),
    label: z.string().min(1),
    required: z.boolean(),
    default: scalar_value.optional(),
    options: z.array(input_option).min(1),
  })
  .strict()

const path_input = z
  .object({
    key: input_key,
    type: z.literal("path"),
    label: z.string().min(1),
    required: z.boolean(),
    default: z.string().min(1).optional(),
    mode: path_input_mode,
  })
  .strict()

export const manual_input = z.discriminatedUnion("type", [
  text_input,
  long_text_input,
  number_input,
  boolean_input,
  select_input,
  path_input,
])

export const workflow_resource = z.discriminatedUnion("source", [
  z
    .object({
      id: z.string().min(1),
      source: z.literal("local"),
      kind: workflow_resource_kind,
      path: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      source: z.literal("library"),
      kind: workflow_resource_kind,
      item_id: z.string().min(1),
    })
    .strict(),
])

export const output_field: z.ZodType<OutputFieldValue> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("object"),
        required: z.array(z.string()).default([]),
        properties: z.record(z.string(), output_field).default({}),
      })
      .strict(),
    z
      .object({
        type: scalar_type,
      })
      .strict(),
  ]),
)

export const output_contract = z
  .object({
    type: z.literal("object"),
    required: z.array(z.string()).default([]),
    properties: z.record(z.string(), output_field).default({}),
  })
  .strict()

export const output_contract_view = z
  .object({
    type: z.literal("object"),
    required: z.array(z.string()).default([]),
    properties: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export const prompt_source = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("inline"),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("resource"),
      resource_id: z.string().min(1),
    })
    .strict(),
])

export const script_source = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("inline"),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("resource"),
      resource_id: z.string().min(1),
    })
    .strict(),
])

export const condition_when = z
  .object({
    ref: z.string().min(1),
    op: condition_operator,
    value: scalar_value,
  })
  .strict()

export type WorkflowStep = z.infer<typeof workflow_step>
export type WorkflowStepView = {
  id: string
  kind: z.infer<typeof authored_node_kind>
  title: string
  prompt?: z.infer<typeof prompt_source>
  output?: z.infer<typeof output_contract_view>
  script?: z.infer<typeof script_source>
  cwd?: string
  when?: z.infer<typeof condition_when>
  then?: WorkflowStepView[]
  else?: WorkflowStepView[]
  result?: z.infer<typeof end_result>
}

export const workflow_step: z.ZodType<{
  id: string
  kind: "agent_request" | "script" | "condition" | "end"
  title: string
  prompt?: z.infer<typeof prompt_source>
  output?: z.infer<typeof output_contract>
  script?: z.infer<typeof script_source>
  cwd?: string
  when?: z.infer<typeof condition_when>
  then?: WorkflowStep[]
  else?: WorkflowStep[]
  result?: z.infer<typeof end_result>
}> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("agent_request"),
        title: z.string().min(1),
        prompt: prompt_source,
        output: output_contract.optional(),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("script"),
        title: z.string().min(1),
        script: script_source,
        cwd: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("condition"),
        title: z.string().min(1),
        when: condition_when,
        then: z.array(workflow_step),
        else: z.array(workflow_step),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("end"),
        title: z.string().min(1),
        result: end_result,
      })
      .strict(),
  ]),
)

export const workflow_schema = z
  .object({
    schema_version: z.literal(2),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    trigger: workflow_trigger,
    inputs: z.array(manual_input).default([]),
    resources: z.array(workflow_resource).default([]),
    steps: z.array(workflow_step).min(1),
  })
  .strict()

export const workflow_step_view = z
  .lazy(() =>
    z.discriminatedUnion("kind", [
      z
        .object({
          id: z.string().min(1),
          kind: z.literal("agent_request"),
          title: z.string().min(1),
          prompt: prompt_source,
          output: output_contract_view.optional(),
        })
        .strict(),
      z
        .object({
          id: z.string().min(1),
          kind: z.literal("script"),
          title: z.string().min(1),
          script: script_source,
          cwd: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          id: z.string().min(1),
          kind: z.literal("condition"),
          title: z.string().min(1),
          when: condition_when,
          then: z.array(workflow_step_view),
          else: z.array(workflow_step_view),
        })
        .strict(),
      z
        .object({
          id: z.string().min(1),
          kind: z.literal("end"),
          title: z.string().min(1),
          result: end_result,
        })
        .strict(),
    ]),
  )
  .meta({ ref: "WorkflowStepView" }) as z.ZodType<WorkflowStepView>

export const workflow_schema_view = z
  .object({
    schema_version: z.literal(2),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    trigger: workflow_trigger,
    inputs: z.array(manual_input).default([]),
    resources: z.array(workflow_resource).default([]),
    steps: z.array(workflow_step_view).min(1),
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

export const workflow_item_view = z
  .object({
    file: z.string(),
    id: z.string(),
    workflow: workflow_schema_view.optional(),
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

export const validation_report_view = z
  .object({
    workspace_type,
    workflows: z.array(workflow_item_view),
    library: z.array(library_item),
  })
  .strict()

export type WorkspaceType = z.infer<typeof workspace_type>
export type LibraryResourceKind = z.infer<typeof library_resource_kind>
export type WorkflowResourceKind = z.infer<typeof workflow_resource_kind>
export type AuthoredNodeKind = z.infer<typeof authored_node_kind>
export type DeferredNodeKind = z.infer<typeof deferred_node_kind>
export type ConditionOperator = z.infer<typeof condition_operator>
export type EndResult = z.infer<typeof end_result>
export type ManualInput = z.infer<typeof manual_input>
export type WorkflowResource = z.infer<typeof workflow_resource>
export type OutputField = z.infer<typeof output_field>
export type OutputContract = z.infer<typeof output_contract>
export type Workflow = z.infer<typeof workflow_schema>
export type LibraryResource = z.infer<typeof library_resource_schema>
export type ValidationIssue = z.infer<typeof validation_issue>
export type WorkflowItem = z.infer<typeof workflow_item>
export type LibraryItem = z.infer<typeof library_item>
export type ValidationReport = z.infer<typeof validation_report>
