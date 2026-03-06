import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { errors } from "../error"
import { Instance } from "@/project/instance"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { validation_report, workflow_item } from "@/workflow/contract"
import { WorkflowManualRun } from "@/workflow/manual-run"
import { WorkflowRunGate } from "@/workflow/run-gate"
import { WorkflowTriggerEngine } from "@/workflow/trigger-engine"
import { WorkflowValidation } from "@/workflow/validate"
import { lazy } from "@/util/lazy"
import { RuntimeHistory } from "@/runtime/history"
import { RuntimeOutbound } from "@/runtime/outbound"
import { RuntimeReconciliation } from "@/runtime/reconciliation"
import { RuntimeRun } from "@/runtime/run"
import { WorkflowDebugReport } from "@/workflow/debug-report"

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

const draft_history_query = history_query
  .extend({
    scope: z.enum(["pending", "processed"]).optional(),
  })

const draft_param = z
  .object({
    draft_id: z.string().min(1),
  })
  .strict()

const draft_create = RuntimeOutbound.CreateInput.omit({
  workspace_id: true,
}).refine((value) => value.source_kind !== "system_report", {
  message: "system_report drafts must be created through the debug report flow",
  path: ["source_kind"],
})

const draft_update = RuntimeOutbound.UpdateInput.omit({
  id: true,
})

const draft_control = z
  .object({
    actor_type: z.enum(["system", "user"]).optional(),
  })
  .strict()

function workspace_required() {
  if (WorkspaceContext.workspaceID) return WorkspaceContext.workspaceID
  throw new HTTPException(400, {
    message: "draft routes require a workspace id",
  })
}

function draft_required(draft_id: string) {
  const draft = RuntimeOutbound.get({ id: draft_id })
  if (draft.workspace_id === workspace_required()) return draft
  throw new HTTPException(404, {
    message: `Draft not found: ${draft_id}`,
  })
}

function debug_run_required(run_id: string) {
  const run = RuntimeRun.get({ id: run_id })
  if (run.workspace_id === workspace_required()) return run
  throw new HTTPException(404, {
    message: `Run not found: ${run_id}`,
  })
}

export const WorkflowRoutes = lazy(() =>
  new Hono()
    .post(
      "/signals/:signal",
      describeRoute({
        summary: "Ingest workflow signal",
        description: "Ingest a signal event for runnable signal-triggered workflows in the addressed workspace.",
        operationId: "workflow.signal.ingest",
        responses: {
          200: {
            description: "Signal ingress result",
            content: {
              "application/json": {
                schema: resolver(WorkflowTriggerEngine.SignalResponse),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", WorkflowTriggerEngine.SignalParam),
      validator("json", WorkflowTriggerEngine.SignalBody),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(
          await WorkflowTriggerEngine.signal({
            signal: params.signal,
            body,
          }),
        )
      },
    )
    .get(
      "/debug/reminders",
      describeRoute({
        summary: "Poll reconciliation reminders",
        description: "Return active reconciliation reminders and mark any due reminders as delivered.",
        operationId: "workflow.debug.reminders",
        responses: {
          200: {
            description: "Reminder state",
            content: {
              "application/json": {
                schema: resolver(RuntimeReconciliation.ReminderPage),
              },
            },
          },
        },
      }),
      validator("query", z.object({})),
      async (c) => {
        return c.json(await RuntimeReconciliation.poll())
      },
    )
    .post(
      "/debug/run/:run_id/keep-running",
      describeRoute({
        summary: "Acknowledge a reconciliation reminder",
        description: "Keep a long-running reconciliation active without changing its hard-stop deadline.",
        operationId: "workflow.debug.keep_running",
        responses: {
          200: {
            description: "Reminder updated",
            content: {
              "application/json": {
                schema: resolver(RuntimeReconciliation.ReminderItem),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WorkflowManualRun.ControlInput),
      async (c) => {
        const params = c.req.valid("param")
        const run = debug_run_required(params.run_id)
        const value = RuntimeReconciliation.keepRunning(run.id, {
          actor_type: "user",
        })
        if (value) return c.json(value)
        throw new HTTPException(409, {
          message: "run is not in an active reconciliation state",
        })
      },
    )
    .get(
      "/debug/run/:run_id/report-preview",
      describeRoute({
        summary: "Preview a debug report payload",
        description: "Return the allowlisted field previews for the stop/report flow before user consent.",
        operationId: "workflow.debug.report_preview",
        responses: {
          200: {
            description: "Debug report preview",
            content: {
              "application/json": {
                schema: resolver(WorkflowDebugReport.Preview),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WorkflowManualRun.ControlInput),
      validator("query", z.object({})),
      async (c) => {
        const params = c.req.valid("param")
        const run = debug_run_required(params.run_id)
        if (!RuntimeReconciliation.isActive({ status: run.status })) {
          throw new HTTPException(409, {
            message: "debug reports require an active reconciliation run",
          })
        }
        return c.json(await WorkflowDebugReport.preview(params.run_id))
      },
    )
    .post(
      "/debug/run/:run_id/report",
      describeRoute({
        summary: "Create a system report draft for a reconciliation run",
        description: "Cancel the active reconciliation run and create a first-class system report draft.",
        operationId: "workflow.debug.report_create",
        responses: {
          200: {
            description: "System report draft created",
            content: {
              "application/json": {
                schema: resolver(WorkflowDebugReport.CreateResult),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", WorkflowManualRun.ControlInput),
      validator("json", WorkflowDebugReport.CreateInput),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const run = debug_run_required(params.run_id)
        if (!RuntimeReconciliation.isActive({ status: run.status })) {
          throw new HTTPException(409, {
            message: "debug reports require an active reconciliation run",
          })
        }
        return c.json(await WorkflowDebugReport.create(params.run_id, body))
      },
    )
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
      "/history/drafts",
      describeRoute({
        summary: "List workflow draft history",
        description: "List draft history with Pending/Processed scopes and deterministic pagination.",
        operationId: "workflow.history.drafts",
        responses: {
          200: {
            description: "Draft history page",
            content: {
              "application/json": {
                schema: resolver(RuntimeHistory.DraftPage),
              },
            },
          },
        },
      }),
      validator("query", draft_history_query),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          RuntimeHistory.drafts({
            workspace_id: WorkspaceContext.workspaceID,
            cursor: query.cursor,
            limit: query.limit,
            scope: query.scope,
            include_debug: query.include_debug,
          }),
        )
      },
    )
    .post(
      "/drafts",
      describeRoute({
        summary: "Create workflow draft",
        description: "Create an outbound draft envelope for review, approval, and dispatch.",
        operationId: "workflow.drafts.create",
        responses: {
          200: {
            description: "Draft created",
            content: {
              "application/json": {
                schema: resolver(RuntimeOutbound.View),
              },
            },
          },
          ...errors(400, 409),
        },
      }),
      validator("json", draft_create),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(
          await RuntimeOutbound.create({
            ...body,
            workspace_id: workspace_required(),
          }),
        )
      },
    )
    .get(
      "/drafts/:draft_id",
      describeRoute({
        summary: "Get workflow draft",
        description: "Return the current draft envelope and dispatch state.",
        operationId: "workflow.drafts.get",
        responses: {
          200: {
            description: "Draft detail",
            content: {
              "application/json": {
                schema: resolver(RuntimeOutbound.View),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", draft_param),
      validator("query", z.object({})),
      async (c) => {
        const params = c.req.valid("param")
        return c.json(draft_required(params.draft_id))
      },
    )
    .patch(
      "/drafts/:draft_id",
      describeRoute({
        summary: "Edit workflow draft",
        description: "Edit a workflow draft and re-evaluate its approval/blocking state.",
        operationId: "workflow.drafts.update",
        responses: {
          200: {
            description: "Draft updated",
            content: {
              "application/json": {
                schema: resolver(RuntimeOutbound.View),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", draft_param),
      validator("json", draft_update),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        draft_required(params.draft_id)
        return c.json(
          await RuntimeOutbound.update({
            ...body,
            id: params.draft_id,
          }),
        )
      },
    )
    .post(
      "/drafts/:draft_id/approve",
      describeRoute({
        summary: "Approve workflow draft",
        description: "Mark a draft ready to send without dispatching it.",
        operationId: "workflow.drafts.approve",
        responses: {
          200: {
            description: "Draft approved",
            content: {
              "application/json": {
                schema: resolver(RuntimeOutbound.View),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", draft_param),
      validator("json", draft_control),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        draft_required(params.draft_id)
        return c.json(
          await RuntimeOutbound.approve({
            id: params.draft_id,
            actor_type: body.actor_type,
          }),
        )
      },
    )
    .post(
      "/drafts/:draft_id/reject",
      describeRoute({
        summary: "Reject workflow draft",
        description: "Reject a workflow draft without dispatching it.",
        operationId: "workflow.drafts.reject",
        responses: {
          200: {
            description: "Draft rejected",
            content: {
              "application/json": {
                schema: resolver(RuntimeOutbound.View),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", draft_param),
      validator("json", draft_control),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        draft_required(params.draft_id)
        return c.json(
          RuntimeOutbound.reject({
            id: params.draft_id,
            actor_type: body.actor_type,
          }),
        )
      },
    )
    .post(
      "/drafts/:draft_id/send",
      describeRoute({
        summary: "Send workflow draft",
        description: "Dispatch an approved or auto-approved draft through the centralized outbound dispatcher.",
        operationId: "workflow.drafts.send",
        responses: {
          200: {
            description: "Draft sent or blocked",
            content: {
              "application/json": {
                schema: resolver(RuntimeOutbound.View),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", draft_param),
      validator("json", draft_control),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        draft_required(params.draft_id)
        return c.json(
          await RuntimeOutbound.send({
            id: params.draft_id,
            actor_type: body.actor_type,
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
