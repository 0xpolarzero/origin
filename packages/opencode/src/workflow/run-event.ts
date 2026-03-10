import { BusEvent } from "@/bus/bus-event"
import { run_status } from "@/runtime/contract"
import z from "zod"

export namespace WorkflowRunEvent {
  export const Outcome = BusEvent.define(
    "workflow.run.outcome",
    z
      .object({
        workspace_id: z.string(),
        workflow_id: z.string(),
        run_id: z.string(),
        outcome: z.enum(["completed", "failed", "canceled"]),
        status: run_status,
        reason_code: z.string().nullable().optional(),
        failure_code: z.string().nullable().optional(),
      })
      .strict(),
  )
}
