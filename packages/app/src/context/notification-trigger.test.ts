import { describe, expect, test } from "bun:test"
import type { EventWorkflowTriggerOutcome } from "@opencode-ai/sdk/v2"
import { runOutcomeNotification, triggerOutcomeNotification, type WorkflowRunOutcomeEvent } from "./notification-workflow"

const event = (
  outcome: EventWorkflowTriggerOutcome["properties"]["outcome"],
): EventWorkflowTriggerOutcome => ({
  type: "workflow.trigger.outcome",
  properties: {
    workspace_id: "wrk_1",
    workflow_id: "workflow.daily",
    trigger_type: "signal",
    outcome,
    reason_code: outcome === "run_started" ? null : "duplicate_event",
    message: outcome === "run_started" ? "Started signal-triggered workflow run" : "Ignored duplicate signal",
    count: 2,
    run_ids: ["run_1", "run_2"],
  },
})

describe("triggerOutcomeNotification", () => {
  test("ignores run-started workflow trigger events", () => {
    expect(
      triggerOutcomeNotification({
        directory: "/tmp/origin",
        currentDirectory: "/tmp/origin",
        event: event("run_started"),
        time: 1,
      }),
    ).toBeUndefined()
  })

  test("maps skipped or duplicate trigger events into viewed project notifications", () => {
    expect(
      triggerOutcomeNotification({
        directory: "/tmp/origin",
        currentDirectory: "/tmp/origin",
        event: event("duplicate"),
        time: 5,
      }),
    ).toEqual({
      directory: "/tmp/origin",
      time: 5,
      viewed: true,
      type: "trigger-outcome",
      trigger_type: "signal",
      outcome: "duplicate",
      workflow_id: "workflow.daily",
      reason_code: "duplicate_event",
      count: 2,
      run_ids: ["run_1", "run_2"],
      message: "Ignored duplicate signal",
    })
  })
})

describe("runOutcomeNotification", () => {
  test("maps terminal workflow run events into project notifications", () => {
    const event: WorkflowRunOutcomeEvent = {
      type: "workflow.run.outcome",
      properties: {
        workspace_id: "wrk_1",
        workflow_id: "workflow.daily",
        run_id: "run_7",
        outcome: "failed",
        status: "failed",
        reason_code: "node_failed",
        failure_code: "agent_error",
      },
    }

    expect(
      runOutcomeNotification({
        directory: "/tmp/origin",
        currentDirectory: "/tmp/other",
        event,
        time: 9,
      }),
    ).toEqual({
      directory: "/tmp/origin",
      time: 9,
      viewed: false,
      type: "run-outcome",
      workflow_id: "workflow.daily",
      run_id: "run_7",
      outcome: "failed",
      status: "failed",
      reason_code: "node_failed",
      failure_code: "agent_error",
    })
  })
})
