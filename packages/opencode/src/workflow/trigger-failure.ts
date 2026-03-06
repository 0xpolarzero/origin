import { RuntimeManagedEndpointError, RuntimeOutboundValidationError, RuntimeWorkflowValidationError } from "@/runtime/error"

export type TriggerFailureCode =
  | "integration_transport_error"
  | "transient_runtime_error"
  | "integration_timeout"
  | "validation_error"
  | "schema_error"
  | "policy_blocked"
  | "workspace_policy_blocked"

const retryable_codes = new Set<TriggerFailureCode>([
  "integration_transport_error",
  "transient_runtime_error",
  "integration_timeout",
])

const non_retryable_codes = new Set<TriggerFailureCode>([
  "validation_error",
  "schema_error",
  "policy_blocked",
  "workspace_policy_blocked",
])

function code(error: unknown) {
  if (!error || typeof error !== "object") return
  const value = error as { data?: { code?: string }; code?: string; name?: string }
  return value.data?.code ?? value.code ?? value.name
}

function timeout(error: unknown) {
  const value = code(error)
  return value === "TimeoutError" || value === "AbortError"
}

export namespace WorkflowTriggerFailure {
  export function classify(error: unknown): TriggerFailureCode {
    if (error instanceof RuntimeWorkflowValidationError) {
      if (error.data.code === "schema_invalid" || error.data.code === "schema_version_unsupported") {
        return "schema_error"
      }
      return "validation_error"
    }

    if (error instanceof RuntimeOutboundValidationError) {
      if (error.data.code === "policy_blocked") return "policy_blocked"
      if (error.data.code === "workspace_policy_blocked") return "workspace_policy_blocked"
      if (error.data.code === "schema_invalid" || error.data.code === "schema_version_unsupported") {
        return "schema_error"
      }
      return "validation_error"
    }

    if (error instanceof RuntimeManagedEndpointError) {
      return "validation_error"
    }

    if (timeout(error)) return "integration_timeout"

    const value = code(error)
    if (value && retryable_codes.has(value as never)) return value as TriggerFailureCode
    if (value && non_retryable_codes.has(value as never)) return value as TriggerFailureCode
    return "transient_runtime_error"
  }

  export function retryable(code: TriggerFailureCode) {
    return retryable_codes.has(code)
  }

  export function reason(code: TriggerFailureCode) {
    if (retryable_codes.has(code)) return "retry_exhausted" as const
    return "non_retryable" as const
  }
}
