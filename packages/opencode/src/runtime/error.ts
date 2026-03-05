import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { validation_code } from "./contract"

export const RuntimeIllegalTransitionError = NamedError.create(
  "RuntimeIllegalTransitionError",
  z.object({
    entity: z.enum(["run", "operation", "draft", "integration_attempt"]),
    from: z.string(),
    to: z.string(),
    code: z.literal("illegal_transition"),
  }),
)

export const RuntimeMissingReasonCodeError = NamedError.create(
  "RuntimeMissingReasonCodeError",
  z.object({
    status: z.string(),
    code: z.literal("reason_code_required"),
  }),
)

export const RuntimeMissingFailureCodeError = NamedError.create(
  "RuntimeMissingFailureCodeError",
  z.object({
    status: z.string(),
    code: z.literal("failure_code_required"),
  }),
)

export const RuntimeImmutableFieldError = NamedError.create(
  "RuntimeImmutableFieldError",
  z.object({
    field: z.string(),
    code: z.literal("immutable_field"),
  }),
)

export const RuntimePolicyLineageError = NamedError.create(
  "RuntimePolicyLineageError",
  z.object({
    event_type: z.string(),
    field: z.string(),
    code: z.literal("policy_lineage_required"),
  }),
)

export const RuntimeAuditPayloadError = NamedError.create(
  "RuntimeAuditPayloadError",
  z.object({
    event_type: z.string(),
    message: z.string(),
    code: z.literal("audit_payload_rejected"),
  }),
)

export const RuntimeWorkspaceMismatchError = NamedError.create(
  "RuntimeWorkspaceMismatchError",
  z.object({
    entity: z.enum(["operation", "draft", "integration_attempt"]),
    run_id: z.string(),
    run_workspace_id: z.string(),
    workspace_id: z.string(),
    code: z.literal("workspace_mismatch"),
  }),
)

export const RuntimeWorkflowValidationError = NamedError.create(
  "RuntimeWorkflowValidationError",
  z.object({
    workflow_id: z.string(),
    code: validation_code,
    path: z.string(),
    message: z.string(),
    errors: z
      .array(
        z.object({
          code: validation_code,
          path: z.string(),
          message: z.string(),
        }),
      )
      .default([]),
  }),
)
