import { RuntimeWorkflowValidationError } from "@/runtime/error"
import z from "zod"
import { WorkflowValidation } from "./validate"

const input = z
  .object({
    directory: z.string(),
    workflow_id: z.string().min(1),
  })
  .strict()

export namespace WorkflowRunGate {
  export const Input = input

  export async function validate(value: z.input<typeof Input>) {
    const parsed = Input.parse(value)
    const report = await WorkflowValidation.validate({
      directory: parsed.directory,
    })

    const matches = report.workflows.filter((item) => item.id === parsed.workflow_id)
    if (matches.length === 0) {
      throw new RuntimeWorkflowValidationError({
        workflow_id: parsed.workflow_id,
        code: "workflow_missing",
        path: "$.id",
        message: `workflow not found: ${parsed.workflow_id}`,
        errors: [],
      })
    }

    if (matches.length > 1) {
      throw new RuntimeWorkflowValidationError({
        workflow_id: parsed.workflow_id,
        code: "workflow_id_duplicate",
        path: "$.id",
        message: `workflow id is ambiguous: ${parsed.workflow_id}`,
        errors: matches.flatMap((item) => item.errors),
      })
    }

    const workflow = matches[0]
    if (workflow.workflow && workflow.runnable) {
      return {
        workflow: workflow.workflow,
        report,
      }
    }

    const issue = workflow.errors[0]
    if (!issue) {
      throw new RuntimeWorkflowValidationError({
        workflow_id: parsed.workflow_id,
        code: "workflow_not_runnable",
        path: "$",
        message: `workflow is not runnable: ${parsed.workflow_id}`,
        errors: [],
      })
    }

    throw new RuntimeWorkflowValidationError({
      workflow_id: parsed.workflow_id,
      code: issue.code,
      path: issue.path,
      message: issue.message,
      errors: workflow.errors,
    })
  }
}
