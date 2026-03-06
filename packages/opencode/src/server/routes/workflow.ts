import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import z from "zod"
import { errors } from "../error"
import { Instance } from "@/project/instance"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { validation_report, workflow_item } from "@/workflow/contract"
import { WorkflowManualRun } from "@/workflow/manual-run"
import { WorkflowRunGate } from "@/workflow/run-gate"
import { WorkflowValidation } from "@/workflow/validate"
import { lazy } from "@/util/lazy"
import { RuntimeHistory } from "@/runtime/history"

const run_validate = z
  .object({
    workflow_id: z.string().min(1),
  })
  .strict()

const query_boolean = z
  .preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]),
  )
  .transform((value) => {
    if (typeof value === "boolean") return value
    return value === "true" || value === "1"
  })

const history_query = z
  .object({
    cursor: z.string().regex(/^\d+:[0-9a-f-]+$/i).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    include_debug: query_boolean.optional(),
  })

const operation_history_query = history_query
  .extend({
    include_user: query_boolean.optional(),
  })

export const WorkflowRoutes = lazy(() =>
  new Hono()
    .get(
      "/history/runs",
      describeRoute({
        summary: "List workflow runs history",
        description: "List run history with deterministic sorting, cursor pagination, and safe operation-link metadata.",
        operationId: "workflow.history.runs",
        responses: {
          200: {
            description: "Run history page",
            content: {
              "application/json": {
                schema: resolver(RuntimeHistory.RunPage),
              },
            },
          },
        },
      }),
      validator("query", history_query),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          RuntimeHistory.runs({
            workspace_id: WorkspaceContext.workspaceID,
            cursor: query.cursor,
            limit: query.limit,
            include_debug: query.include_debug,
          }),
        )
      },
    )
    .get(
      "/history/operations",
      describeRoute({
        summary: "List workflow operations history",
        description:
          "List operations history with deterministic sorting, cursor pagination, provenance metadata, and safe run-link metadata.",
        operationId: "workflow.history.operations",
        responses: {
          200: {
            description: "Operation history page",
            content: {
              "application/json": {
                schema: resolver(RuntimeHistory.OperationPage),
              },
            },
          },
        },
      }),
      validator("query", operation_history_query),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          RuntimeHistory.operations({
            workspace_id: WorkspaceContext.workspaceID,
            cursor: query.cursor,
            limit: query.limit,
            include_debug: query.include_debug,
            include_user: query.include_user,
          }),
        )
      },
    )
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
