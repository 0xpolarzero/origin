import type { EventWorkflowTriggerOutcome } from "@opencode-ai/sdk/v2"

type NotificationBase = {
  directory?: string
  session?: string
  metadata?: unknown
  time: number
  viewed: boolean
}

export type TriggerOutcomeNotification = NotificationBase & {
  type: "trigger-outcome"
  trigger_type: EventWorkflowTriggerOutcome["properties"]["trigger_type"]
  outcome: EventWorkflowTriggerOutcome["properties"]["outcome"]
  workflow_id: string
  reason_code: string | null
  count: number
  run_ids: string[]
  message: string
}

export type WorkflowRunOutcomeEvent = {
  type: "workflow.run.outcome"
  properties: {
    workspace_id: string
    workflow_id: string
    run_id: string
    outcome: "completed" | "failed" | "canceled"
    status: string
    reason_code?: string | null
    failure_code?: string | null
  }
}

export type RunOutcomeNotification = NotificationBase & {
  type: "run-outcome"
  workflow_id: string
  run_id: string
  outcome: "completed" | "failed" | "canceled"
  status: string
  reason_code: string | null
  failure_code: string | null
}

export function triggerOutcomeNotification(input: {
  directory: string
  currentDirectory?: string
  event: EventWorkflowTriggerOutcome
  time: number
}): TriggerOutcomeNotification | undefined {
  if (input.event.properties.outcome === "run_started") return

  return {
    directory: input.directory,
    time: input.time,
    viewed: input.currentDirectory === input.directory,
    type: "trigger-outcome",
    trigger_type: input.event.properties.trigger_type,
    outcome: input.event.properties.outcome,
    workflow_id: input.event.properties.workflow_id,
    reason_code: input.event.properties.reason_code ?? null,
    count: input.event.properties.count ?? 1,
    run_ids: input.event.properties.run_ids ?? [],
    message: input.event.properties.message,
  }
}

export function runOutcomeNotification(input: {
  directory: string
  currentDirectory?: string
  event: WorkflowRunOutcomeEvent
  time: number
}) {
  return {
    directory: input.directory,
    time: input.time,
    viewed: input.currentDirectory === input.directory,
    type: "run-outcome",
    workflow_id: input.event.properties.workflow_id,
    run_id: input.event.properties.run_id,
    outcome: input.event.properties.outcome,
    status: input.event.properties.status,
    reason_code: input.event.properties.reason_code ?? null,
    failure_code: input.event.properties.failure_code ?? null,
  } satisfies RunOutcomeNotification
}
