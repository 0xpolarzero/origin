import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { errors } from "../error"
import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { library_item } from "@/workflow/contract"
import { LibraryAuthoring } from "@/workflow/library-authoring"
import { WorkflowKnowledge } from "@/workflow/knowledge"
import { WorkflowValidation } from "@/workflow/validate"
import { lazy } from "@/util/lazy"

const library_with_usage = library_item
  .extend({
    used_by: z.array(z.string()),
    last_edited_at: z.number().nullable(),
  })
  .strict()

const list_input = z
  .object({})
  .passthrough()

const item_param = z
  .object({
    item_id: z.string().min(1),
  })
  .strict()

const history_query = z
  .object({
    cursor: z.string().regex(/^\d+:[0-9a-f-]+$/i).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .passthrough()

const import_input = WorkflowKnowledge.Input.omit({
  directory: true,
})

const LibraryKnowledgeImportedEvent = BusEvent.define(
  "library.knowledge.imported",
  z
    .object({
      status: WorkflowKnowledge.Result.shape.status,
      requested_path: z.string(),
      resolved_path: z.string().nullable(),
      collision: z.boolean(),
      notification: WorkflowKnowledge.Result.shape.notification.optional(),
    })
    .strict(),
)

export const LibraryRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get library validation",
        description: "Load library resources and include workflow usage links.",
        operationId: "library.list",
        responses: {
          200: {
            description: "Library validation",
            content: {
              "application/json": {
                schema: resolver(z.array(library_with_usage)),
              },
            },
          },
        },
      }),
      validator("query", list_input),
      async (c) => {
        c.req.valid("query")
        return c.json(await LibraryAuthoring.list())
      },
    )
    .post(
      "/knowledge/import",
      describeRoute({
        summary: "Import knowledge-base file",
        description: "Apply deterministic collision policy for knowledge-base imports.",
        operationId: "library.knowledge.import",
        responses: {
          200: {
            description: "Knowledge-base import outcome",
            content: {
              "application/json": {
                schema: resolver(WorkflowKnowledge.Result),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", import_input),
      async (c) => {
        const body = c.req.valid("json")
        const value = await WorkflowKnowledge.import_file({
          directory: Instance.directory,
          path: body.path,
          content: body.content,
          mode: body.mode,
          action: body.action,
        })
        if (value.notification) {
          await Bus.publish(LibraryKnowledgeImportedEvent, {
            status: value.status,
            requested_path: value.requested_path,
            resolved_path: value.resolved_path,
            collision: value.collision,
            notification: value.notification,
          })
        }
        return c.json(value)
      },
    )
    .get(
      "/items/:item_id",
      describeRoute({
        summary: "Get library item detail",
        description: "Load canonical library item content, usage links, and revision head for the detail surface.",
        operationId: "library.item.detail",
        responses: {
          200: {
            description: "Library item detail",
            content: {
              "application/json": {
                schema: resolver(LibraryAuthoring.Detail),
              },
            },
          },
          ...errors(404, 409),
        },
      }),
      validator("param", item_param),
      validator("query", z.object({})),
      async (c) => {
        const params = c.req.valid("param")
        c.req.valid("query")
        const report = await WorkflowValidation.validate({
          directory: Instance.directory,
        })
        const matches = report.library.filter((item) => item.id === params.item_id)
        if (matches.length === 0) {
          throw new HTTPException(404, {
            message: `Library item not found: ${params.item_id}`,
          })
        }
        if (matches.length > 1) {
          throw new HTTPException(409, {
            message: `Library item id is ambiguous: ${params.item_id}`,
          })
        }
        return c.json(await LibraryAuthoring.detail_for(report, matches[0]))
      },
    )
    .get(
      "/items/:item_id/history",
      describeRoute({
        summary: "Get library item history",
        description: "Return library revision history with diff-first review metadata.",
        operationId: "library.item.history",
        responses: {
          200: {
            description: "Library item history",
            content: {
              "application/json": {
                schema: resolver(LibraryAuthoring.HistoryPage),
              },
            },
          },
          ...errors(404, 409),
        },
      }),
      validator("param", item_param),
      validator("query", history_query),
      async (c) => {
        const params = c.req.valid("param")
        const query = c.req.valid("query")
        const report = await WorkflowValidation.validate({
          directory: Instance.directory,
        })
        const matches = report.library.filter((item) => item.id === params.item_id)
        if (matches.length === 0) {
          throw new HTTPException(404, {
            message: `Library item not found: ${params.item_id}`,
          })
        }
        if (matches.length > 1) {
          throw new HTTPException(409, {
            message: `Library item id is ambiguous: ${params.item_id}`,
          })
        }
        return c.json(await LibraryAuthoring.history(matches[0], query.cursor, query.limit))
      },
    )
    .put(
      "/items/:item_id",
      describeRoute({
        summary: "Save library item",
        description: "Write raw canonical library YAML back to disk and return refreshed detail metadata.",
        operationId: "library.item.save",
        responses: {
          200: {
            description: "Library item detail",
            content: {
              "application/json": {
                schema: resolver(LibraryAuthoring.Detail),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", item_param),
      validator("json", LibraryAuthoring.SaveInput),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const report = await WorkflowValidation.validate({
          directory: Instance.directory,
        })
        const matches = report.library.filter((item) => item.id === params.item_id)
        if (matches.length === 0) {
          throw new HTTPException(404, {
            message: `Library item not found: ${params.item_id}`,
          })
        }
        if (matches.length > 1) {
          throw new HTTPException(409, {
            message: `Library item id is ambiguous: ${params.item_id}`,
          })
        }
        return c.json(await LibraryAuthoring.save(matches[0], body))
      },
    )
    .post(
      "/items/:item_id/copy",
      describeRoute({
        summary: "Create workflow-local copy",
        description: "Replace shared library references inside a workflow with local resource copies.",
        operationId: "library.item.copy",
        responses: {
          200: {
            description: "Copy result",
            content: {
              "application/json": {
                schema: resolver(LibraryAuthoring.CopyResult),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", item_param),
      validator("json", LibraryAuthoring.CopyInput),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const report = await WorkflowValidation.validate({
          directory: Instance.directory,
        })
        const matches = report.library.filter((item) => item.id === params.item_id)
        if (matches.length === 0) {
          throw new HTTPException(404, {
            message: `Library item not found: ${params.item_id}`,
          })
        }
        if (matches.length > 1) {
          throw new HTTPException(409, {
            message: `Library item id is ambiguous: ${params.item_id}`,
          })
        }
        try {
          return c.json(await LibraryAuthoring.copy(matches[0], body))
        } catch (error) {
          throw new HTTPException(409, {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    .delete(
      "/items/:item_id",
      describeRoute({
        summary: "Delete library item",
        description: "Delete a shared library file when no workflows still depend on it.",
        operationId: "library.item.delete",
        responses: {
          200: {
            description: "Delete result",
            content: {
              "application/json": {
                schema: resolver(LibraryAuthoring.RemoveResult),
              },
            },
          },
          ...errors(404, 409),
        },
      }),
      validator("param", item_param),
      validator("query", z.object({})),
      async (c) => {
        const params = c.req.valid("param")
        c.req.valid("query")
        const report = await WorkflowValidation.validate({
          directory: Instance.directory,
        })
        const matches = report.library.filter((item) => item.id === params.item_id)
        if (matches.length === 0) {
          throw new HTTPException(404, {
            message: `Library item not found: ${params.item_id}`,
          })
        }
        if (matches.length > 1) {
          throw new HTTPException(409, {
            message: `Library item id is ambiguous: ${params.item_id}`,
          })
        }
        try {
          return c.json(await LibraryAuthoring.remove(matches[0]))
        } catch (error) {
          throw new HTTPException(409, {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
)
