import { describe, expect, test } from "bun:test"
import {
  draft_status_values,
  dispatch_attempt_state_values,
  failure_code_values,
  operation_status_values,
  run_attempt_status_values,
  run_node_skip_reason_code_values,
  run_node_status_values,
  reason_code_values,
  run_status_values,
  session_link_role_values,
  session_link_visibility_values,
} from "../../src/runtime/contract"
import { RuntimeIllegalTransitionError, RuntimeMissingFailureCodeError, RuntimeMissingReasonCodeError } from "../../src/runtime/error"
import {
  draft_legal_edges,
  dispatch_attempt_legal_edges,
  operation_legal_edges,
  run_attempt_legal_edges,
  run_node_legal_edges,
  run_legal_edges,
  validate_run_attempt_create,
  validate_run_attempt_transition,
  validate_run_node_create,
  validate_run_node_transition,
  validate_dispatch_attempt_create,
  validate_dispatch_attempt_transition,
  validate_draft_create,
  validate_draft_transition,
  validate_operation_create,
  validate_operation_transition,
  validate_run_create,
  validate_run_transition,
} from "../../src/runtime/state"
import { DispatchAttemptTable, DraftTable, OperationTable, RunAttemptTable, RunNodeTable, RunTable, SessionLinkTable } from "../../src/runtime/runtime.sql"

const expected_run_legal_edges = [
  { from: "queued", to: "running" },
  { from: "queued", to: "canceled" },
  { from: "running", to: "validating" },
  { from: "running", to: "failed" },
  { from: "running", to: "canceled" },
  { from: "validating", to: "ready_for_integration" },
  { from: "validating", to: "completed_no_change" },
  { from: "validating", to: "failed" },
  { from: "validating", to: "canceled" },
  { from: "ready_for_integration", to: "integrating" },
  { from: "ready_for_integration", to: "canceled" },
  { from: "integrating", to: "reconciling" },
  { from: "integrating", to: "completed" },
  { from: "integrating", to: "failed" },
  { from: "integrating", to: "cancel_requested" },
  { from: "reconciling", to: "integrating" },
  { from: "reconciling", to: "failed" },
  { from: "reconciling", to: "cancel_requested" },
  { from: "cancel_requested", to: "completed" },
  { from: "cancel_requested", to: "canceled" },
  { from: "cancel_requested", to: "failed" },
] as const

const expected_operation_legal_edges = [{ from: "completed", to: "reverted" }] as const

const expected_draft_legal_edges = [
  { from: "pending", to: "approved" },
  { from: "pending", to: "auto_approved" },
  { from: "pending", to: "blocked" },
  { from: "pending", to: "rejected" },
  { from: "approved", to: "rejected" },
  { from: "approved", to: "sent" },
  { from: "approved", to: "failed" },
  { from: "approved", to: "blocked" },
  { from: "approved", to: "pending" },
  { from: "auto_approved", to: "rejected" },
  { from: "auto_approved", to: "sent" },
  { from: "auto_approved", to: "failed" },
  { from: "auto_approved", to: "blocked" },
  { from: "auto_approved", to: "pending" },
  { from: "blocked", to: "pending" },
  { from: "blocked", to: "rejected" },
  { from: "blocked", to: "failed" },
] as const

const expected_dispatch_attempt_legal_edges = [
  { from: "created", to: "blocked" },
  { from: "created", to: "dispatching" },
  { from: "dispatching", to: "remote_accepted" },
  { from: "dispatching", to: "failed" },
  { from: "dispatching", to: "blocked" },
  { from: "remote_accepted", to: "finalized" },
] as const

const expected_run_node_legal_edges = [
  { from: "pending", to: "ready" },
  { from: "pending", to: "skipped" },
  { from: "pending", to: "canceled" },
  { from: "ready", to: "running" },
  { from: "ready", to: "skipped" },
  { from: "ready", to: "canceled" },
  { from: "running", to: "succeeded" },
  { from: "running", to: "failed" },
  { from: "running", to: "canceled" },
  { from: "running", to: "ready" },
] as const

const expected_run_attempt_legal_edges = [
  { from: "created", to: "running" },
  { from: "running", to: "succeeded" },
  { from: "running", to: "failed" },
  { from: "running", to: "canceled" },
] as const

function key(from: string, to: string) {
  return `${from}->${to}`
}

describe("runtime.contract.schema-enum-consistency", () => {
  test("run table reuses canonical status/failure/reason enums", () => {
    expect(RunTable.status.enumValues).toEqual([...run_status_values])
    expect(RunTable.failure_code.enumValues).toEqual([...failure_code_values])
    expect(RunTable.reason_code.enumValues).toEqual([...reason_code_values])
  })

  test("operation, draft, and dispatch attempt tables reuse canonical status enums", () => {
    expect(OperationTable.status.enumValues).toEqual([...operation_status_values])
    expect(DraftTable.status.enumValues).toEqual([...draft_status_values])
    expect(DispatchAttemptTable.state.enumValues).toEqual([...dispatch_attempt_state_values])
  })

  test("graph runtime tables reuse canonical node, attempt, and session-link enums", () => {
    expect(RunNodeTable.status.enumValues).toEqual([...run_node_status_values])
    expect(RunNodeTable.skip_reason_code.enumValues).toEqual([...run_node_skip_reason_code_values])
    expect(RunAttemptTable.status.enumValues).toEqual([...run_attempt_status_values])
    expect(SessionLinkTable.role.enumValues).toEqual([...session_link_role_values])
    expect(SessionLinkTable.visibility.enumValues).toEqual([...session_link_visibility_values])
  })
})

describe("runtime.state.run-create", () => {
  test("create -> queued is allowed", () => {
    expect(() => validate_run_create({ status: "queued", trigger_type: "manual" })).not.toThrow()
    expect(() => validate_run_create({ status: "queued", trigger_type: "cron" })).not.toThrow()
  })

  test("create -> skipped requires scheduler trigger and reason_code", () => {
    expect(() =>
      validate_run_create({
        status: "skipped",
        trigger_type: "cron",
        reason_code: "cron_missed_slot",
      }),
    ).not.toThrow()

    expect(() =>
      validate_run_create({
        status: "skipped",
        trigger_type: "signal",
        reason_code: "duplicate_event",
      }),
    ).not.toThrow()

    expect(() =>
      validate_run_create({
        status: "skipped",
        trigger_type: "manual",
        reason_code: "cron_missed_slot",
      }),
    ).toThrow(RuntimeIllegalTransitionError)

    expect(() =>
      validate_run_create({
        status: "skipped",
        trigger_type: "cron",
      }),
    ).toThrow(RuntimeMissingReasonCodeError)
  })
})

describe("runtime.state.run-transition-matrix", () => {
  test("run matrix matches phase spec", () => {
    expect(run_legal_edges).toEqual(expected_run_legal_edges)
  })

  test("all legal run edges are accepted", () => {
    expected_run_legal_edges.forEach((item) => {
      const failure = item.to === "failed" ? "reconciliation_failed" : undefined
      expect(() =>
        validate_run_transition({
          from: item.from,
          to: item.to,
          failure_code: failure,
        }),
      ).not.toThrow()
    })
  })

  test("queued -> skipped is rejected", () => {
    expect(() =>
      validate_run_transition({
        from: "queued",
        to: "skipped",
        reason_code: "cron_missed_slot",
      }),
    ).toThrow(RuntimeIllegalTransitionError)
  })

  test("undocumented run edges are rejected", () => {
    expect(() =>
      validate_run_transition({
        from: "running",
        to: "completed",
      }),
    ).toThrow(RuntimeIllegalTransitionError)
  })

  test("failed terminal transition requires failure_code", () => {
    expect(() =>
      validate_run_transition({
        from: "running",
        to: "failed",
      }),
    ).toThrow(RuntimeMissingFailureCodeError)
  })

  test("all non-legal run edges are rejected", () => {
    const legal = new Set(expected_run_legal_edges.map((item) => key(item.from, item.to)))
    run_status_values.forEach((from) => {
      run_status_values.forEach((to) => {
        if (legal.has(key(from, to))) return
        expect(() =>
          validate_run_transition({
            from,
            to,
            failure_code: "reconciliation_failed",
          }),
        ).toThrow(RuntimeIllegalTransitionError)
      })
    })
  })
})

describe("runtime.state.operation-transition-matrix", () => {
  test("operation matrix matches phase spec", () => {
    expect(operation_legal_edges).toEqual(expected_operation_legal_edges)
  })

  test("operation create rules are enforced", () => {
    expect(() => validate_operation_create("completed")).not.toThrow()
    expect(() => validate_operation_create("reverted")).toThrow(RuntimeIllegalTransitionError)
  })

  test("all legal operation edges are accepted and illegal edges are rejected", () => {
    expected_operation_legal_edges.forEach((item) => {
      expect(() => validate_operation_transition(item)).not.toThrow()
    })

    const legal = new Set(expected_operation_legal_edges.map((item) => key(item.from, item.to)))
    operation_status_values.forEach((from) => {
      operation_status_values.forEach((to) => {
        if (legal.has(key(from, to))) return
        expect(() => validate_operation_transition({ from, to })).toThrow(RuntimeIllegalTransitionError)
      })
    })
  })
})

describe("runtime.state.draft-transition-matrix", () => {
  test("draft matrix matches phase spec", () => {
    expect(draft_legal_edges).toEqual(expected_draft_legal_edges)
  })

  test("draft create rules are enforced", () => {
    expect(() => validate_draft_create("pending")).not.toThrow()
    expect(() => validate_draft_create("approved")).toThrow(RuntimeIllegalTransitionError)
  })

  test("all legal draft edges are accepted and terminal/illegal edges are rejected", () => {
    expected_draft_legal_edges.forEach((item) => {
      expect(() => validate_draft_transition(item)).not.toThrow()
    })

    const legal = new Set(expected_draft_legal_edges.map((item) => key(item.from, item.to)))
    draft_status_values.forEach((from) => {
      draft_status_values.forEach((to) => {
        if (legal.has(key(from, to))) return
        expect(() => validate_draft_transition({ from, to })).toThrow(RuntimeIllegalTransitionError)
      })
    })
  })
})

describe("runtime.state.dispatch-attempt-transition-matrix", () => {
  test("dispatch attempt matrix matches phase spec", () => {
    expect(dispatch_attempt_legal_edges).toEqual(expected_dispatch_attempt_legal_edges)
  })

  test("dispatch attempt create rules are enforced", () => {
    expect(() => validate_dispatch_attempt_create("created")).not.toThrow()
    expect(() => validate_dispatch_attempt_create("dispatching")).toThrow(RuntimeIllegalTransitionError)
  })

  test("all legal dispatch attempt edges are accepted and illegal edges are rejected", () => {
    expected_dispatch_attempt_legal_edges.forEach((item) => {
      expect(() => validate_dispatch_attempt_transition(item)).not.toThrow()
    })

    const legal = new Set(expected_dispatch_attempt_legal_edges.map((item) => key(item.from, item.to)))
    dispatch_attempt_state_values.forEach((from) => {
      dispatch_attempt_state_values.forEach((to) => {
        if (legal.has(key(from, to))) return
        expect(() => validate_dispatch_attempt_transition({ from, to })).toThrow(RuntimeIllegalTransitionError)
      })
    })
  })
})

describe("runtime.state.run-node-transition-matrix", () => {
  test("run node matrix matches phase spec", () => {
    expect(run_node_legal_edges).toEqual(expected_run_node_legal_edges)
  })

  test("run node create rules are enforced", () => {
    expect(() => validate_run_node_create("pending")).not.toThrow()
    expect(() => validate_run_node_create("ready")).toThrow(RuntimeIllegalTransitionError)
  })

  test("all legal run node edges are accepted and illegal edges are rejected", () => {
    expected_run_node_legal_edges.forEach((item) => {
      expect(() => validate_run_node_transition(item)).not.toThrow()
    })

    const legal = new Set(expected_run_node_legal_edges.map((item) => key(item.from, item.to)))
    run_node_status_values.forEach((from) => {
      run_node_status_values.forEach((to) => {
        if (legal.has(key(from, to))) return
        expect(() => validate_run_node_transition({ from, to })).toThrow(RuntimeIllegalTransitionError)
      })
    })
  })
})

describe("runtime.state.run-attempt-transition-matrix", () => {
  test("run attempt matrix matches phase spec", () => {
    expect(run_attempt_legal_edges).toEqual(expected_run_attempt_legal_edges)
  })

  test("run attempt create rules are enforced", () => {
    expect(() => validate_run_attempt_create("created")).not.toThrow()
    expect(() => validate_run_attempt_create("running")).toThrow(RuntimeIllegalTransitionError)
  })

  test("all legal run attempt edges are accepted and illegal edges are rejected", () => {
    expected_run_attempt_legal_edges.forEach((item) => {
      expect(() => validate_run_attempt_transition(item)).not.toThrow()
    })

    const legal = new Set(expected_run_attempt_legal_edges.map((item) => key(item.from, item.to)))
    run_attempt_status_values.forEach((from) => {
      run_attempt_status_values.forEach((to) => {
        if (legal.has(key(from, to))) return
        expect(() => validate_run_attempt_transition({ from, to })).toThrow(RuntimeIllegalTransitionError)
      })
    })
  })
})
