import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import z from "zod"
import { errors } from "../error"
import { Instance } from "@/project/instance"
import { validation_report, workflow_item } from "@/workflow/contract"
import { WorkflowManualRun } from "@/workflow/manual-run"
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
    )
    .post(
      "/run/start",
      describeRoute({
        summary: "Start manual workflow run",
        description: "Create and start a manual workflow run with linked session and run workspace.",
        operationId: "workflow.run.start",
        responses: {
          200: {
            description: "Manual run started",
            content: {
              "application/json": {
                schema: resolver(WorkflowManualRun.Info),
              },
            },
          },
          ...errors(400, 409),
        },
      }),
      validator("json", WorkflowManualRun.StartInput),
      async (c) => {
        const body = c.req.valid("json")
        const run = await WorkflowManualRun.start(body)
        return c.json(run)
      },
    )
    .get(
      "/run/:run_id",
      describeRoute({
        summary: "Get workflow run",
        description: "Return the current state of a manual workflow run.",
        operationId: "workflow.run.get",
        responses: {
          200: {
            description: "Workflow run state",
            content: {
              "application/json": {
                schema: resolver(WorkflowManualRun.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WorkflowManualRun.ControlInput),
      validator("query", z.object({})),
      async (c) => {
        const params = c.req.valid("param")
        return c.json(WorkflowManualRun.get(params))
      },
    )
    .post(
      "/run/:run_id/cancel",
      describeRoute({
        summary: "Cancel workflow run",
        description: "Request cancellation for an active manual workflow run.",
        operationId: "workflow.run.cancel",
        responses: {
          200: {
            description: "Workflow run canceled",
            content: {
              "application/json": {
                schema: resolver(WorkflowManualRun.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", WorkflowManualRun.ControlInput),
      async (c) => {
        const params = c.req.valid("param")
        return c.json(WorkflowManualRun.cancel(params))
      },
    ),
)
