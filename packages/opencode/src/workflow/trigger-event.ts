import z from "zod"
import { BusEvent } from "@/bus/bus-event"

export namespace WorkflowTriggerEvent {
  export const Outcome = BusEvent.define(
    "workflow.trigger.outcome",
    z
      .object({
        workspace_id: z.string(),
        workflow_id: z.string(),
        trigger_type: z.enum(["cron", "signal"]),
        outcome: z.enum(["run_started", "skipped", "duplicate"]),
        reason_code: z.string().nullable().optional(),
        message: z.string(),
        count: z.number().int().positive().default(1),
        run_ids: z.array(z.string()).default([]),
      })
      .strict(),
  )
}
