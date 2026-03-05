import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import z from "zod"
import { errors } from "../error"
import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { library_item } from "@/workflow/contract"
import { WorkflowKnowledge } from "@/workflow/knowledge"
import { WorkflowValidation } from "@/workflow/validate"
import { lazy } from "@/util/lazy"

const library_with_usage = library_item
  .extend({
    used_by: z.array(z.string()),
  })
  .strict()

const list_input = z
  .object({})
  .strict()

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
        const report = await WorkflowValidation.validate({
          directory: Instance.directory,
        })

        const usage = new Map<string, Set<string>>()
        report.workflows.forEach((item) => {
          if (!item.workflow) return
          item.workflow.resources.forEach((resource) => {
            const list = usage.get(resource.id) ?? new Set<string>()
            list.add(item.id)
            usage.set(resource.id, list)
          })
        })

        const values = report.library.map((item) => ({
          ...item,
          used_by: [...(usage.get(item.id) ?? [])].toSorted((a, b) => a.localeCompare(b)),
        }))
        return c.json(values)
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
    ),
)
