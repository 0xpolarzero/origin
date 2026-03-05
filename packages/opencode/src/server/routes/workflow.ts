import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import z from "zod"
import { errors } from "../error"
import { Instance } from "@/project/instance"
import { validation_report, workflow_item } from "@/workflow/contract"
import { WorkflowRunGate } from "@/workflow/run-gate"
import { WorkflowValidation } from "@/workflow/validate"
import { lazy } from "@/util/lazy"

const run_validate = z
  .object({
    workflow_id: z.string().min(1),
  })
  .strict()

export const WorkflowRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Validate workflows and library",
        description: "Load workflow and library YAML definitions and return deterministic validation state.",
        operationId: "workflow.validate",
        responses: {
          200: {
            description: "Validation report",
            content: {
              "application/json": {
                schema: resolver(validation_report),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({}),
      ),
      async (c) => {
        const value = await WorkflowValidation.validate({
          directory: Instance.directory,
        })
        return c.json(value)
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get workflow validation",
        description: "Return a single workflow validation item by id.",
        operationId: "workflow.get",
        responses: {
          200: {
            description: "Workflow validation",
            content: {
              "application/json": {
                schema: resolver(workflow_item.nullable()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string().min(1),
        }),
      ),
      validator(
        "query",
        z.object({}),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const report = await WorkflowValidation.validate({
          directory: Instance.directory,
        })
        return c.json(WorkflowValidation.workflow(report, params.id) ?? null)
      },
    )
    .post(
      "/run/validate",
      describeRoute({
        summary: "Validate workflow run entrypoint",
        description: "Reject non-runnable workflows deterministically before run creation starts.",
        operationId: "workflow.run.validate",
        responses: {
          200: {
            description: "Workflow is runnable",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      ok: z.literal(true),
                      workflow_id: z.string(),
                    })
                    .strict(),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", run_validate),
      async (c) => {
        const body = c.req.valid("json")
        await WorkflowRunGate.validate({
          directory: Instance.directory,
          workflow_id: body.workflow_id,
        })
        return c.json({
          ok: true as const,
          workflow_id: body.workflow_id,
        })
      },
    ),
)
