import {
  type DraftStatus,
  type FailureCode,
  type OperationStatus,
  type ReasonCode,
  type RunStatus,
  type RunTriggerType,
  terminal_draft_statuses,
  terminal_operation_statuses,
  terminal_run_statuses,
} from "./contract"
import {
  RuntimeIllegalTransitionError,
  RuntimeMissingFailureCodeError,
  RuntimeMissingReasonCodeError,
} from "./error"

function edge<T extends string>(from: T, to: T) {
  return { from, to }
}

export const run_legal_edges = [
  edge("queued", "running"),
  edge("queued", "canceled"),
  edge("running", "validating"),
  edge("running", "failed"),
  edge("running", "canceled"),
  edge("validating", "ready_for_integration"),
  edge("validating", "completed_no_change"),
  edge("validating", "failed"),
  edge("validating", "canceled"),
  edge("ready_for_integration", "integrating"),
  edge("ready_for_integration", "canceled"),
  edge("integrating", "reconciling"),
  edge("integrating", "completed"),
  edge("integrating", "failed"),
  edge("integrating", "cancel_requested"),
  edge("reconciling", "integrating"),
  edge("reconciling", "failed"),
  edge("reconciling", "cancel_requested"),
  edge("cancel_requested", "completed"),
  edge("cancel_requested", "canceled"),
  edge("cancel_requested", "failed"),
] as const

export const operation_legal_edges = [edge("completed", "reverted")] as const

export const draft_legal_edges = [
  edge("pending", "approved"),
  edge("pending", "auto_approved"),
  edge("pending", "blocked"),
  edge("pending", "rejected"),
  edge("approved", "sent"),
  edge("approved", "failed"),
  edge("approved", "blocked"),
  edge("approved", "pending"),
  edge("auto_approved", "sent"),
  edge("auto_approved", "failed"),
  edge("auto_approved", "blocked"),
  edge("auto_approved", "pending"),
  edge("blocked", "pending"),
  edge("blocked", "rejected"),
  edge("blocked", "failed"),
] as const

function legal<T extends string>(edges: readonly { from: T; to: T }[]) {
  return new Set(edges.map((item) => `${item.from}->${item.to}`))
}

const run_legal = legal(run_legal_edges)
const operation_legal = legal(operation_legal_edges)
const draft_legal = legal(draft_legal_edges)

function scheduler(trigger_type: RunTriggerType) {
  return trigger_type === "cron" || trigger_type === "signal"
}

function fail(entity: "run" | "operation" | "draft", from: string, to: string) {
  throw new RuntimeIllegalTransitionError({
    entity,
    from,
    to,
    code: "illegal_transition",
  })
}

export function validate_run_create(input: { status: RunStatus; trigger_type: RunTriggerType; reason_code?: ReasonCode | null }) {
  if (input.status === "queued") return
  if (input.status === "skipped") {
    if (!scheduler(input.trigger_type)) fail("run", "create", input.status)
    if (!input.reason_code) {
      throw new RuntimeMissingReasonCodeError({
        status: input.status,
        code: "reason_code_required",
      })
    }
    return
  }
  fail("run", "create", input.status)
}

export function validate_run_transition(input: {
  from: RunStatus
  to: RunStatus
  reason_code?: ReasonCode | null
  failure_code?: FailureCode | null
}) {
  if (terminal_run_statuses.has(input.from)) fail("run", input.from, input.to)
  if (!run_legal.has(`${input.from}->${input.to}`)) fail("run", input.from, input.to)
  if (input.to === "failed" && !input.failure_code) {
    throw new RuntimeMissingFailureCodeError({
      status: input.to,
      code: "failure_code_required",
    })
  }
  if (input.to === "skipped" && !input.reason_code) {
    throw new RuntimeMissingReasonCodeError({
      status: input.to,
      code: "reason_code_required",
    })
  }
}

export function validate_operation_create(status: OperationStatus) {
  if (status === "completed") return
  fail("operation", "create", status)
}

export function validate_operation_transition(input: { from: OperationStatus; to: OperationStatus }) {
  if (terminal_operation_statuses.has(input.from)) fail("operation", input.from, input.to)
  if (operation_legal.has(`${input.from}->${input.to}`)) return
  fail("operation", input.from, input.to)
}

export function validate_draft_create(status: DraftStatus) {
  if (status === "pending") return
  fail("draft", "create", status)
}

export function validate_draft_transition(input: { from: DraftStatus; to: DraftStatus }) {
  if (terminal_draft_statuses.has(input.from)) fail("draft", input.from, input.to)
  if (draft_legal.has(`${input.from}->${input.to}`)) return
  fail("draft", input.from, input.to)
}
