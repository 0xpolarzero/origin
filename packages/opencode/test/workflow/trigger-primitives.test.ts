import { describe, expect, test } from "bun:test"
import { RuntimeOutboundValidationError, RuntimeWorkflowValidationError } from "../../src/runtime/error"
import { WorkflowTriggerFailure } from "../../src/workflow/trigger-failure"
import { WorkflowTriggerHash } from "../../src/workflow/trigger-hash"

describe("workflow trigger hash", () => {
  test("fallback hash is stable when object keys are reordered", () => {
    const first = WorkflowTriggerHash.fallback({
      signal: "incoming",
      event_time: 100,
      payload_json: {
        b: 2,
        a: {
          d: 4,
          c: 3,
        },
      },
      source: {
        z: true,
        y: "value",
      },
    })

    const second = WorkflowTriggerHash.fallback({
      signal: "incoming",
      event_time: 100,
      payload_json: {
        a: {
          c: 3,
          d: 4,
        },
        b: 2,
      },
      source: {
        y: "value",
        z: true,
      },
    })

    expect(first).toBe(second)
    expect(WorkflowTriggerHash.canonical({
      signal: "incoming",
      event_time: 100,
      payload_json: {
        a: 1,
      },
    })).toContain(`"version":"${WorkflowTriggerHash.Version}"`)
  })
})

describe("workflow trigger failure classification", () => {
  test("maps validation and policy failures to canonical classes", () => {
    expect(
      WorkflowTriggerFailure.classify(
        new RuntimeWorkflowValidationError({
          workflow_id: "bad",
          code: "schema_invalid",
          path: "$",
          message: "broken",
          errors: [],
        }),
      ),
    ).toBe("schema_error")

    expect(
      WorkflowTriggerFailure.classify(
        new RuntimeOutboundValidationError({
          code: "policy_blocked",
          message: "blocked",
        }),
      ),
    ).toBe("policy_blocked")
  })

  test("marks only retryable classes as retryable and derives terminal reason codes", () => {
    expect(WorkflowTriggerFailure.retryable("integration_timeout")).toBe(true)
    expect(WorkflowTriggerFailure.reason("integration_timeout")).toBe("retry_exhausted")
    expect(WorkflowTriggerFailure.retryable("validation_error")).toBe(false)
    expect(WorkflowTriggerFailure.reason("validation_error")).toBe("non_retryable")
  })
})
