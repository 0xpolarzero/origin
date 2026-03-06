import { Instance } from "@/project/instance"
import { Lock } from "@/util/lock"
import { RuntimeAudit } from "./audit"
import { RuntimeDispatchAttempt } from "./dispatch-attempt"
import { RuntimeDraft } from "./draft"
import {
  RuntimeAuditPayloadError,
  RuntimeDispatchProvenanceError,
  RuntimeManagedEndpointError,
  RuntimeOutboundValidationError,
  RuntimePolicyLineageError,
} from "./error"
import { RuntimeOutboundIntegration } from "./outbound-integration"
import { RuntimeWorkspaceType } from "./workspace-type"
import {
  draft_source_kind,
  draft_status,
  dispatch_attempt_state,
  type ActorType,
  type BlockReasonCode,
} from "./contract"
import { create_uuid_v7, uuid_v7 } from "./uuid"
import z from "zod"

const POLICY = {
  id: "policy/outbound-default",
  version: "10",
} as const

const message_payload = z
  .object({
    text: z.string().min(1),
  })
  .strict()

const issue_payload = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1).optional(),
  })
  .strict()

const report_payload = z
  .object({
    report_type: z.literal("debug_reconciliation"),
    metadata: z
      .object({
        generated_at: z.number().int().positive(),
        reminder: z
          .object({
            threshold_ms: z.number().int().positive(),
            cadence_ms: z.number().int().positive(),
            hard_stop_ms: z.number().int().positive(),
          })
          .strict(),
        run: z
          .object({
            id: z.string().min(1),
            workspace_id: z.string().min(1),
            session_id: z.string().nullable(),
            workflow_id: z.string().nullable(),
            status: z.string().min(1),
            trigger_type: z.string().min(1),
            created_at: z.number().int().positive(),
            updated_at: z.number().int().positive(),
            started_at: z.number().int().nullable(),
            ready_for_integration_at: z.number().int().nullable(),
            reason_code: z.string().nullable(),
            failure_code: z.string().nullable(),
            cleanup_failed: z.boolean(),
            changed_paths: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    prompt: z
      .object({
        format: z.literal("markdown"),
        truncated: z.boolean(),
        content: z.string().min(1),
      })
      .strict()
      .optional(),
    files: z
      .object({
        truncated: z.boolean(),
        items: z.array(
          z
            .object({
              path: z.string().min(1),
              exists: z.boolean(),
              truncated: z.boolean(),
              content: z.string().optional(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict()

const registered_action_id = z.enum(["message.send", "issue.create", "report.dispatch"])

const create_input = z.object({
  id: uuid_v7.optional(),
  run_id: uuid_v7.nullable().optional(),
  workspace_id: z.string().min(1),
  source_kind: draft_source_kind,
  integration_id: z.string().min(1),
  adapter_id: z.string().min(1),
  action_id: z.string().min(1),
  target: z.string().min(1),
  payload_json: z.record(z.string(), z.unknown()),
  payload_schema_version: z.number().int().positive(),
  auto_approve: z.boolean().default(false),
  actor_type: z.enum(["system", "user"]).default("system"),
})

const update_input = z.object({
  id: uuid_v7,
  source_kind: draft_source_kind.optional(),
  integration_id: z.string().min(1).optional(),
  adapter_id: z.string().min(1).optional(),
  action_id: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  payload_json: z.record(z.string(), z.unknown()).optional(),
  payload_schema_version: z.number().int().positive().optional(),
  actor_type: z.enum(["system", "user"]).default("user"),
})

const control_input = z.object({
  id: uuid_v7,
  actor_type: z.enum(["system", "user"]).default("user"),
})

const test_send_input = z.object({
  workspace_id: z.string().min(1),
  integration_id: z.string().min(1),
  adapter_id: z.string().min(1).optional(),
  draft_id: uuid_v7.optional(),
  dispatch_attempt_id: uuid_v7.optional(),
  action_id: z.string().min(1),
  target: z.string().min(1),
  payload_json: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().min(1),
})

const view = z
  .object({
    id: uuid_v7,
    run_id: uuid_v7.nullable(),
    workspace_id: z.string(),
    status: draft_status,
    source_kind: draft_source_kind,
    adapter_id: z.string(),
    integration_id: z.string(),
    action_id: z.string(),
    target: z.string(),
    payload_json: z.record(z.string(), z.unknown()),
    payload_schema_version: z.number().int().positive(),
    preview_text: z.string(),
    material_hash: z.string(),
    block_reason_code: z.string().nullable(),
    policy_id: z.string().nullable(),
    policy_version: z.string().nullable(),
    decision_id: z.string().nullable(),
    decision_reason_code: z.string().nullable(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    dispatch: z
      .object({
        id: uuid_v7,
        state: dispatch_attempt_state,
        idempotency_key: z.string(),
        remote_reference: z.string().nullable(),
        block_reason_code: z.string().nullable(),
      })
      .nullable(),
  })
  .strict()

type Action = {
  adapter_id: "test" | "system"
  action_id: z.infer<typeof registered_action_id>
  payload_schema_version: 1
  payload: typeof message_payload | typeof issue_payload | typeof report_payload
  targets: readonly string[]
  preview: (input: { target: string; payload_json: Record<string, unknown> }) => string
  endpoint: "test.message" | "test.issue" | "system.report"
}

type PolicyDecision = {
  outcome: "allow" | "deny" | "blocked"
  action: string
  reason_code: string
  policy_id: string
  policy_version: string
  decision_id: string
}

type Prepared = {
  action: Action
  payload_json: Record<string, unknown>
  preview_text: string
  material_hash: string
}

type TestWrite = {
  endpoint: string
  action_id: string
  target: string
  payload_json: Record<string, unknown>
  idempotency_key: string
  draft_id: string
  dispatch_attempt_id: string
  remote_reference: string
}

type Seams = {
  fail_policy_action?: string
  crash_after_remote_accepted?: boolean
  drop_policy_lineage_for?: ("policy.decision" | "dispatch.attempt" | "dispatch.result")[]
  drop_dispatch_provenance_for?: ("dispatch.attempt" | "dispatch.result")[]
}

const actions = [
  {
    adapter_id: "test",
    action_id: "message.send",
    payload_schema_version: 1,
    payload: message_payload,
    targets: ["channel://general", "channel://alerts"] as const,
    preview: ({ target, payload_json }) => `Message ${target}: ${String(payload_json.text ?? "")}`,
    endpoint: "test.message",
  },
  {
    adapter_id: "test",
    action_id: "issue.create",
    payload_schema_version: 1,
    payload: issue_payload,
    targets: ["repo://origin/issues", "repo://origin/bugs"] as const,
    preview: ({ target, payload_json }) => `Issue ${target}: ${String(payload_json.title ?? "")}`,
    endpoint: "test.issue",
  },
  {
    adapter_id: "system",
    action_id: "report.dispatch",
    payload_schema_version: 1,
    payload: report_payload,
    targets: ["system://developers"] as const,
    preview: ({ target, payload_json }) => {
      const row = payload_json as { metadata?: { run?: { id?: unknown } } }
      const run_id = typeof row.metadata?.run?.id === "string" ? row.metadata.run.id : "unknown"
      return `Debug report ${run_id} -> ${target}`
    },
    endpoint: "system.report",
  },
] satisfies Action[]

const test_targets = actions.filter((item) => item.adapter_id === "test").flatMap((item) => [...item.targets])
const system_targets = actions.filter((item) => item.adapter_id === "system").flatMap((item) => [...item.targets])

let override: Seams | undefined

const state = Instance.state(() => ({
  writes: [] as TestWrite[],
  accepted: new Map<string, TestWrite>(),
}))

function seams() {
  if (override) return override
  return {}
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.keys(value)
    .toSorted((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`
}

function material_hash(input: {
  source_kind: z.infer<typeof draft_source_kind>
  adapter_id: string
  integration_id: string
  action_id: string
  target: string
  payload_json: Record<string, unknown>
}) {
  const text = stable({
    source_kind: input.source_kind,
    adapter_id: input.adapter_id,
    integration_id: input.integration_id,
    action_id: input.action_id,
    target: input.target,
    payload_json: input.payload_json,
  })
  return new Bun.CryptoHasher("sha256").update(text).digest("hex")
}

function lookup(adapter_id: string, action_name: string, payload_schema_version: number) {
  const match = actions.find((item) => item.adapter_id === adapter_id && item.action_id === action_name)
  if (!match) {
    throw new RuntimeOutboundValidationError({
      code: "adapter_action_unregistered",
      message: `unregistered outbound action: ${adapter_id}/${action_name}`,
      field: "action_id",
    })
  }
  if (match.payload_schema_version !== payload_schema_version) {
    throw new RuntimeOutboundValidationError({
      code: "schema_version_unsupported",
      message: `unsupported payload schema version: ${payload_schema_version}`,
      field: "payload_schema_version",
    })
  }
  return match
}

function prepare(input: {
  source_kind: z.infer<typeof draft_source_kind>
  adapter_id: string
  integration_id: string
  action_id: string
  target: string
  payload_json: Record<string, unknown>
  payload_schema_version: number
}) {
  const action = lookup(input.adapter_id, input.action_id, input.payload_schema_version)
  const result = action.payload.safeParse(input.payload_json)
  if (!result.success) {
    throw new RuntimeOutboundValidationError({
      code: "schema_invalid",
      message: result.error.message,
      field: "payload_json",
    })
  }
  const payload_json = result.data
  return {
    action,
    payload_json,
    preview_text: action.preview({
      target: input.target,
      payload_json,
    }),
    material_hash: material_hash({
      source_kind: input.source_kind,
      adapter_id: input.adapter_id,
      integration_id: input.integration_id,
      action_id: input.action_id,
      target: input.target,
      payload_json,
    }),
  } satisfies Prepared
}

function material_changed(
  current: ReturnType<typeof RuntimeDraft.get>,
  next: {
    source_kind: z.infer<typeof draft_source_kind>
    adapter_id: string
    integration_id: string
    action_id: string
    target: string
    payload_json: Record<string, unknown>
  },
) {
  if (current.source_kind !== next.source_kind) return true
  if (current.adapter_id !== next.adapter_id) return true
  if (current.integration_id !== next.integration_id) return true
  if (current.action_id !== next.action_id) return true
  if (current.target !== next.target) return true
  return stable(current.payload_json) !== stable(next.payload_json)
}

function lineage(reason_code: string) {
  return {
    policy_id: POLICY.id,
    policy_version: POLICY.version,
    decision_id: create_uuid_v7(),
    decision_reason_code: reason_code,
  }
}

function blocked_decision(action: string, reason_code: string) {
  return {
    ...lineage(reason_code),
    action,
    outcome: "blocked",
    reason_code,
  } satisfies PolicyDecision
}

function persisted_decision(input: { draft: ReturnType<typeof RuntimeDraft.get>; action: string }) {
  return {
    policy_id: input.draft.policy_id ?? POLICY.id,
    policy_version: input.draft.policy_version ?? POLICY.version,
    decision_id: input.draft.decision_id ?? create_uuid_v7(),
    action: input.action,
    outcome: "allow",
    reason_code: input.draft.decision_reason_code ?? "policy_allow",
  } satisfies PolicyDecision
}

async function decide(input: {
  workspace_id: string
  source_kind: z.infer<typeof draft_source_kind>
  action: string
}) {
  if (seams().fail_policy_action === input.action) {
    throw new Error(`policy failure for ${input.action}`)
  }

  const base = {
    action: input.action,
    ...lineage("policy_blocked"),
  }
  const workspace_type = await RuntimeWorkspaceType.detect(Instance.directory)
  if (workspace_type !== "origin") {
    return {
      ...lineage("workspace_policy_blocked"),
      action: input.action,
      outcome: "blocked",
      reason_code: "workspace_policy_blocked",
    } satisfies PolicyDecision
  }

  if (input.action === "draft.auto_approve") {
    if (input.source_kind === "system") {
      return {
        ...lineage("policy_allow"),
        action: input.action,
        outcome: "allow",
        reason_code: "policy_allow",
      } satisfies PolicyDecision
    }
    return {
      ...base,
      outcome: "deny",
      reason_code: "policy_blocked",
    } satisfies PolicyDecision
  }

  if (input.action === "draft.create" || input.action === "draft.approve" || input.action === "draft.dispatch") {
    return {
      ...lineage("policy_allow"),
      action: input.action,
      outcome: "allow",
      reason_code: "policy_allow",
    } satisfies PolicyDecision
  }

  return {
    ...base,
    outcome: "deny",
    reason_code: "policy_blocked",
  } satisfies PolicyDecision
}

async function integration_for(input: { workspace_id: string; integration_id: string; adapter_id: string }) {
  const current = RuntimeOutboundIntegration.get({
    workspace_id: input.workspace_id,
    id: input.integration_id,
  })
  if (current) {
    if (current.adapter_id === input.adapter_id) return current
    return
  }

  if (input.adapter_id === "test" && input.integration_id === "test/default") {
    return RuntimeOutboundIntegration.put({
      id: input.integration_id,
      workspace_id: input.workspace_id,
      adapter_id: "test",
      enabled: true,
      auth_state: "healthy",
      allowed_targets: test_targets,
    })
  }

  if (input.adapter_id === "system" && input.integration_id === "system/default") {
    return RuntimeOutboundIntegration.put({
      id: input.integration_id,
      workspace_id: input.workspace_id,
      adapter_id: "system",
      enabled: true,
      auth_state: "healthy",
      allowed_targets: system_targets,
    })
  }
}

async function gate(input: {
  workspace_id: string
  integration_id: string
  adapter_id: string
  target: string
  action: Action
}) {
  const workspace_type = await RuntimeWorkspaceType.detect(Instance.directory)
  if (workspace_type !== "origin") return "workspace_policy_blocked" satisfies BlockReasonCode

  const integration = await integration_for({
    workspace_id: input.workspace_id,
    integration_id: input.integration_id,
    adapter_id: input.adapter_id,
  })
  if (!integration) return "integration_missing" satisfies BlockReasonCode
  if (!integration.enabled) return "integration_disabled" satisfies BlockReasonCode
  if (integration.auth_state !== "healthy") return "auth_unhealthy" satisfies BlockReasonCode
  if (!input.action.targets.includes(input.target)) return "target_not_allowed" satisfies BlockReasonCode
  if (!integration.allowed_targets.includes(input.target)) return "target_not_allowed" satisfies BlockReasonCode
  return
}

function present(id: string) {
  const draft = RuntimeDraft.get({ id })
  const dispatch = RuntimeDispatchAttempt.byDraft({
    draft_id: id,
  })
  return view.parse({
    ...draft,
    dispatch: dispatch
      ? {
          id: dispatch.id,
          state: dispatch.state,
          idempotency_key: dispatch.idempotency_key,
          remote_reference: dispatch.remote_reference,
          block_reason_code: dispatch.block_reason_code,
        }
      : null,
  })
}

function audit_policy(input: {
  draft_id?: string
  workspace_id: string
  adapter_id?: string
  integration_id?: string
  action_id?: string
  actor_type: ActorType
  decision: PolicyDecision
  destination?: string
}) {
  const event_type = "policy.decision" as const
  const drop = seams().drop_policy_lineage_for?.includes(event_type) ?? false
  RuntimeAudit.write({
    event_type,
    actor_type: input.actor_type,
    workspace_id: input.workspace_id,
    draft_id: input.draft_id ?? null,
    adapter_id: input.adapter_id ?? null,
    integration_id: input.integration_id ?? null,
    action_id: input.action_id ?? null,
    policy_id: drop ? null : input.decision.policy_id,
    policy_version: drop ? null : input.decision.policy_version,
    decision_id: drop ? null : input.decision.decision_id,
    decision_reason_code: drop ? null : input.decision.reason_code,
    event_payload: {
      outcome: input.decision.outcome,
      action: input.decision.action,
      destination: input.destination,
    },
  })
}

function audit_dispatch_attempt(input: {
  draft_id: string
  workspace_id: string
  adapter_id: string
  integration_id: string
  action_id: string
  dispatch_attempt_id: string
  idempotency_key: string
  actor_type: ActorType
  action: string
  destination: string
  decision: PolicyDecision
}) {
  const event_type = "dispatch.attempt" as const
  const drop_lineage = seams().drop_policy_lineage_for?.includes(event_type) ?? false
  const drop_provenance = seams().drop_dispatch_provenance_for?.includes(event_type) ?? false
  RuntimeAudit.write({
    event_type,
    actor_type: input.actor_type,
    workspace_id: input.workspace_id,
    draft_id: drop_provenance ? null : input.draft_id,
    adapter_id: drop_provenance ? null : input.adapter_id,
    integration_id: drop_provenance ? null : input.integration_id,
    action_id: drop_provenance ? null : input.action_id,
    dispatch_attempt_id: drop_provenance ? null : input.dispatch_attempt_id,
    policy_id: drop_lineage ? null : input.decision.policy_id,
    policy_version: drop_lineage ? null : input.decision.policy_version,
    decision_id: drop_lineage ? null : input.decision.decision_id,
    decision_reason_code: drop_lineage ? null : input.decision.reason_code,
    event_payload: {
      action: input.action,
      destination: input.destination,
      idempotency_key: input.idempotency_key,
    },
  })
}

function audit_dispatch_result(input: {
  draft_id: string
  workspace_id: string
  adapter_id: string
  integration_id: string
  action_id: string
  dispatch_attempt_id: string
  actor_type: ActorType
  outcome: "sent" | "failed" | "blocked"
  remote_reference?: string
  failure_code?: string
  decision: PolicyDecision
}) {
  const event_type = "dispatch.result" as const
  const drop_lineage = seams().drop_policy_lineage_for?.includes(event_type) ?? false
  const drop_provenance = seams().drop_dispatch_provenance_for?.includes(event_type) ?? false
  RuntimeAudit.write({
    event_type,
    actor_type: input.actor_type,
    workspace_id: input.workspace_id,
    draft_id: drop_provenance ? null : input.draft_id,
    adapter_id: drop_provenance ? null : input.adapter_id,
    integration_id: drop_provenance ? null : input.integration_id,
    action_id: drop_provenance ? null : input.action_id,
    dispatch_attempt_id: drop_provenance ? null : input.dispatch_attempt_id,
    policy_id: drop_lineage ? null : input.decision.policy_id,
    policy_version: drop_lineage ? null : input.decision.policy_version,
    decision_id: drop_lineage ? null : input.decision.decision_id,
    decision_reason_code: drop_lineage ? null : input.decision.reason_code,
    event_payload: {
      outcome: input.outcome,
      remote_reference: input.remote_reference,
      failure_code: input.failure_code,
    },
  })
}

function managed_guard(input: {
  workspace_id: string
  integration_id: string
  adapter_id?: string
  draft_id?: string
  dispatch_attempt_id?: string
  action_id?: string
  target?: string
  payload_json?: Record<string, unknown>
}) {
  if (!input.draft_id || !input.dispatch_attempt_id) {
    throw new RuntimeManagedEndpointError({
      code: "managed_endpoint_rejected",
      message: "managed outbound calls require draft and dispatch attempt context",
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }

  const draft = RuntimeDraft.get({
    id: input.draft_id,
  })
  const attempt = RuntimeDispatchAttempt.get({
    id: input.dispatch_attempt_id,
  })
  if (attempt.draft_id !== draft.id) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "dispatch attempt does not belong to draft",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (draft.workspace_id !== input.workspace_id) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "workspace binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (draft.integration_id !== input.integration_id) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "integration binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (attempt.workspace_id !== draft.workspace_id || attempt.workspace_id !== input.workspace_id) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "dispatch attempt workspace binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (attempt.integration_id !== draft.integration_id) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "dispatch attempt integration binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (draft.status !== "approved" && draft.status !== "auto_approved") {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "draft is not approved for dispatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (input.adapter_id && draft.adapter_id !== input.adapter_id) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "adapter binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (input.action_id && draft.action_id !== input.action_id) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "action binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (input.target && draft.target !== input.target) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "target binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  const prepared = prepare({
    source_kind: draft.source_kind,
    adapter_id: draft.adapter_id,
    integration_id: draft.integration_id,
    action_id: draft.action_id,
    target: draft.target,
    payload_json: draft.payload_json,
    payload_schema_version: draft.payload_schema_version,
  })
  if (!prepared.action.targets.some((target) => target === draft.target)) {
    throw new RuntimeOutboundValidationError({
      code: "target_not_allowed",
      message: `target ${draft.target} is outside the managed endpoint inventory`,
      field: "target",
    })
  }
  if (input.payload_json && stable(prepared.payload_json) !== stable(input.payload_json)) {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "payload binding mismatch",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  if (attempt.state !== "dispatching") {
    throw new RuntimeManagedEndpointError({
      code: "dispatch_context_mismatch",
      message: "dispatch attempt is not dispatching",
      draft_id: input.draft_id,
      dispatch_attempt_id: input.dispatch_attempt_id,
      integration_id: input.integration_id,
      workspace_id: input.workspace_id,
    })
  }
  return { draft, attempt, prepared }
}

function audit_block_reason(error: unknown) {
  if (error instanceof RuntimePolicyLineageError) return error.data.code
  if (error instanceof RuntimeDispatchProvenanceError) return error.data.code
  if (error instanceof RuntimeAuditPayloadError) return error.data.code
}

async function test_send(input: z.infer<typeof test_send_input>, options: { audit: boolean } = { audit: true }) {
  const parsed = test_send_input.parse(input)
  let guarded: ReturnType<typeof managed_guard> | undefined

  try {
    guarded = managed_guard({
      workspace_id: parsed.workspace_id,
      integration_id: parsed.integration_id,
      adapter_id: parsed.adapter_id,
      draft_id: parsed.draft_id,
      dispatch_attempt_id: parsed.dispatch_attempt_id,
      action_id: parsed.action_id,
      target: parsed.target,
      payload_json: parsed.payload_json,
    })
    const gate_reason = await gate({
      workspace_id: guarded.draft.workspace_id,
      integration_id: guarded.draft.integration_id,
      adapter_id: guarded.draft.adapter_id,
      target: guarded.draft.target,
      action: guarded.prepared.action,
    })
    if (gate_reason) {
      throw new RuntimeOutboundValidationError({
        code: gate_reason,
        message: `managed outbound call blocked by ${gate_reason}`,
        field: gate_reason === "target_not_allowed" ? "target" : "integration_id",
      })
    }
  } catch (error) {
    if (!(error instanceof RuntimeManagedEndpointError) && !(error instanceof RuntimeOutboundValidationError)) throw error
    if (options.audit) {
      const reason_code = error.data.code
      const decision = blocked_decision("draft.dispatch", reason_code)
      audit_policy({
        draft_id: guarded?.draft.id ?? parsed.draft_id,
        workspace_id: parsed.workspace_id,
        adapter_id: guarded?.draft.adapter_id ?? parsed.adapter_id,
        integration_id: guarded?.draft.integration_id ?? parsed.integration_id,
        action_id: guarded?.draft.action_id ?? parsed.action_id,
        actor_type: "system",
        decision,
        destination: parsed.target,
      })
    }
    throw error
  }

  const accepted = state().accepted.get(parsed.idempotency_key)
  if (accepted) {
    return {
      remote_reference: accepted.remote_reference,
      duplicate: true,
    }
  }

  const draft = guarded!.draft
  const attempt = guarded!.attempt
  const prepared = guarded!.prepared
  const next: TestWrite = {
    endpoint: prepared.action.endpoint,
    action_id: draft.action_id,
    target: draft.target,
    payload_json: prepared.payload_json,
    idempotency_key: parsed.idempotency_key,
    draft_id: draft.id,
    dispatch_attempt_id: attempt.id,
    remote_reference: `${prepared.action.endpoint}:${state().writes.length + 1}`,
  }
  state().writes.push(next)
  state().accepted.set(parsed.idempotency_key, next)
  return {
    remote_reference: next.remote_reference,
    duplicate: false,
  }
}

function block(input: {
  id: string
  actor_type: ActorType
  reason_code: BlockReasonCode
  policy?: PolicyDecision
}) {
  const current = RuntimeDraft.get({
    id: input.id,
  })
  if (current.status !== "blocked") {
    RuntimeDraft.transition({
      id: input.id,
      to: "blocked",
      block_reason_code: input.reason_code,
      actor_type: input.actor_type,
      policy_id: input.policy?.policy_id,
      policy_version: input.policy?.policy_version,
      decision_id: input.policy?.decision_id,
      decision_reason_code: input.policy?.reason_code,
    })
    return
  }

  RuntimeDraft.update({
    id: input.id,
    block_reason_code: input.reason_code,
    policy_id: input.policy?.policy_id,
    policy_version: input.policy?.policy_version,
    decision_id: input.policy?.decision_id,
    decision_reason_code: input.policy?.reason_code,
  })
}

export namespace RuntimeOutbound {
  export const CreateInput = create_input
  export const UpdateInput = update_input
  export const ControlInput = control_input
  export const View = view

  export function get(input: z.input<typeof control_input>) {
    return present(ControlInput.parse(input).id)
  }

  export async function create(input: z.input<typeof CreateInput>) {
    const parsed = CreateInput.parse(input)
    const prepared = prepare(parsed)
    const gate_reason = await gate({
      workspace_id: parsed.workspace_id,
      integration_id: parsed.integration_id,
      adapter_id: parsed.adapter_id,
      target: parsed.target,
      action: prepared.action,
    })

    let decision: PolicyDecision
    try {
      decision = await decide({
        workspace_id: parsed.workspace_id,
        source_kind: parsed.source_kind,
        action: parsed.auto_approve ? "draft.auto_approve" : "draft.create",
      })
    } catch {
      decision = {
        ...lineage("policy_evaluation_failed"),
        action: parsed.auto_approve ? "draft.auto_approve" : "draft.create",
        outcome: "blocked",
        reason_code: "policy_evaluation_failed",
      }
    }

    const status = (() => {
      if (gate_reason) return "blocked" as const
      if (decision.outcome === "blocked") return "blocked" as const
      if (parsed.auto_approve && decision.outcome === "allow") return "auto_approved" as const
      return "pending" as const
    })()
    const block_reason_code = gate_reason ?? (status === "blocked" ? (decision.reason_code as BlockReasonCode) : null)

    const draft = RuntimeDraft.create({
      id: parsed.id,
      run_id: parsed.run_id,
      workspace_id: parsed.workspace_id,
      status: "pending",
      source_kind: parsed.source_kind,
      adapter_id: parsed.adapter_id,
      integration_id: parsed.integration_id,
      action_id: parsed.action_id,
      target: parsed.target,
      payload_json: prepared.payload_json,
      payload_schema_version: parsed.payload_schema_version,
      preview_text: prepared.preview_text,
      material_hash: prepared.material_hash,
      block_reason_code,
      actor_type: parsed.actor_type,
      policy_id: decision.policy_id,
      policy_version: decision.policy_version,
      decision_id: decision.decision_id,
      decision_reason_code: decision.reason_code,
    })

    if (status === "auto_approved") {
      RuntimeDraft.transition({
        id: draft.id,
        to: "auto_approved",
        block_reason_code: null,
        actor_type: parsed.actor_type,
        policy_id: decision.policy_id,
        policy_version: decision.policy_version,
        decision_id: decision.decision_id,
        decision_reason_code: decision.reason_code,
      })
    }

    if (status === "blocked") {
      RuntimeDraft.transition({
        id: draft.id,
        to: "blocked",
        block_reason_code,
        actor_type: parsed.actor_type,
        policy_id: decision.policy_id,
        policy_version: decision.policy_version,
        decision_id: decision.decision_id,
        decision_reason_code: decision.reason_code,
      })
    }

    audit_policy({
      draft_id: draft.id,
      workspace_id: draft.workspace_id,
      adapter_id: draft.adapter_id,
      integration_id: draft.integration_id,
      action_id: draft.action_id,
      actor_type: parsed.actor_type,
      decision,
      destination: draft.target,
    })

    return present(draft.id)
  }

  export async function update(input: z.input<typeof UpdateInput>) {
    const parsed = UpdateInput.parse(input)
    const current = RuntimeDraft.get({
      id: parsed.id,
    })
    if (parsed.source_kind === "system_report") {
      throw new RuntimeOutboundValidationError({
        code: "policy_blocked",
        message: "system report drafts must be created through the debug report flow",
      })
    }
    if (current.source_kind === "system_report") {
      throw new RuntimeOutboundValidationError({
        code: "policy_blocked",
        message: "system report drafts are immutable",
      })
    }
    if (current.status === "sent" || current.status === "rejected" || current.status === "failed") {
      throw new RuntimeOutboundValidationError({
        code: "policy_blocked",
        message: `draft ${current.status} is immutable`,
      })
    }

    const next = {
      source_kind: parsed.source_kind ?? current.source_kind,
      adapter_id: parsed.adapter_id ?? current.adapter_id,
      integration_id: parsed.integration_id ?? current.integration_id,
      action_id: parsed.action_id ?? current.action_id,
      target: parsed.target ?? current.target,
      payload_json: parsed.payload_json ?? current.payload_json,
      payload_schema_version: parsed.payload_schema_version ?? current.payload_schema_version,
    }
    const prepared = prepare(next)
    const changed = material_changed(current, next)
    const gate_reason = await gate({
      workspace_id: current.workspace_id,
      integration_id: next.integration_id,
      adapter_id: next.adapter_id,
      target: next.target,
      action: prepared.action,
    })

    RuntimeDraft.update({
      id: current.id,
      source_kind: next.source_kind,
      adapter_id: next.adapter_id,
      integration_id: next.integration_id,
      action_id: next.action_id,
      target: next.target,
      payload_json: prepared.payload_json,
      payload_schema_version: next.payload_schema_version,
      preview_text: prepared.preview_text,
      material_hash: prepared.material_hash,
      block_reason_code: gate_reason ?? null,
    })

    if (gate_reason) {
      block({
        id: current.id,
        actor_type: parsed.actor_type,
        reason_code: gate_reason,
      })
      return present(current.id)
    }

    if (current.status === "blocked") {
      const attempt = RuntimeDispatchAttempt.byDraft({
        draft_id: current.id,
      })
      if (attempt?.state === "blocked") RuntimeDispatchAttempt.remove({ id: attempt.id })
      RuntimeDraft.transition({
        id: current.id,
        to: "pending",
        block_reason_code: null,
        actor_type: parsed.actor_type,
      })
      return present(current.id)
    }

    if (changed && (current.status === "approved" || current.status === "auto_approved")) {
      RuntimeDraft.transition({
        id: current.id,
        to: "pending",
        block_reason_code: "material_edit_invalidation",
        actor_type: parsed.actor_type,
      })
      return present(current.id)
    }

    return present(current.id)
  }

  export async function approve(input: z.input<typeof ControlInput>) {
    const parsed = ControlInput.parse(input)
    const current = RuntimeDraft.get({
      id: parsed.id,
    })
    if (current.status === "approved" || current.status === "auto_approved") return present(current.id)

    const prepared = prepare({
      source_kind: current.source_kind,
      adapter_id: current.adapter_id,
      integration_id: current.integration_id,
      action_id: current.action_id,
      target: current.target,
      payload_json: current.payload_json,
      payload_schema_version: current.payload_schema_version,
    })
    const gate_reason = await gate({
      workspace_id: current.workspace_id,
      integration_id: current.integration_id,
      adapter_id: current.adapter_id,
      target: current.target,
      action: prepared.action,
    })
    if (gate_reason) {
      block({
        id: current.id,
        actor_type: parsed.actor_type,
        reason_code: gate_reason,
      })
      return present(current.id)
    }

    let decision: PolicyDecision
    try {
      decision = await decide({
        workspace_id: current.workspace_id,
        source_kind: current.source_kind,
        action: "draft.approve",
      })
    } catch {
      decision = {
        ...lineage("policy_evaluation_failed"),
        action: "draft.approve",
        outcome: "blocked",
        reason_code: "policy_evaluation_failed",
      }
    }

    audit_policy({
      draft_id: current.id,
      workspace_id: current.workspace_id,
      adapter_id: current.adapter_id,
      integration_id: current.integration_id,
      action_id: current.action_id,
      actor_type: parsed.actor_type,
      decision,
      destination: current.target,
    })

    if (decision.outcome !== "allow") {
      block({
        id: current.id,
        actor_type: parsed.actor_type,
        reason_code: decision.reason_code as BlockReasonCode,
        policy: decision,
      })
      return present(current.id)
    }

    if (current.status === "blocked") {
      const attempt = RuntimeDispatchAttempt.byDraft({
        draft_id: current.id,
      })
      if (attempt?.state === "blocked") RuntimeDispatchAttempt.remove({ id: attempt.id })
      RuntimeDraft.transition({
        id: current.id,
        to: "pending",
        block_reason_code: null,
        actor_type: parsed.actor_type,
      })
    }

    RuntimeDraft.transition({
      id: current.id,
      to: "approved",
      block_reason_code: null,
      actor_type: parsed.actor_type,
      policy_id: decision.policy_id,
      policy_version: decision.policy_version,
      decision_id: decision.decision_id,
      decision_reason_code: decision.reason_code,
    })
    return present(current.id)
  }

  export function reject(input: z.input<typeof ControlInput>) {
    const parsed = ControlInput.parse(input)
    const current = RuntimeDraft.get({
      id: parsed.id,
    })
    if (current.status === "rejected") return present(current.id)
    RuntimeDraft.transition({
      id: current.id,
      to: "rejected",
      actor_type: parsed.actor_type,
    })
    return present(current.id)
  }

  export async function send(input: z.input<typeof ControlInput>) {
    const parsed = ControlInput.parse(input)
    await using _ = await Lock.write(`dispatch:${parsed.id}`)
    const current = RuntimeDraft.get({
      id: parsed.id,
    })
    if (current.status === "sent") return present(current.id)

    const existing = RuntimeDispatchAttempt.byDraft({
      draft_id: current.id,
    })
    if (existing?.state === "finalized") {
      RuntimeDraft.transition({
        id: current.id,
        to: "sent",
        block_reason_code: null,
        actor_type: parsed.actor_type,
        policy_id: current.policy_id,
        policy_version: current.policy_version,
        decision_id: current.decision_id,
        decision_reason_code: current.decision_reason_code,
      })
      return present(current.id)
    }

    if (existing?.state === "remote_accepted") {
      const decision = persisted_decision({
        draft: current,
        action: "draft.dispatch",
      })
      RuntimeDispatchAttempt.transition({
        id: existing.id,
        to: "finalized",
        remote_reference: existing.remote_reference,
      })
      RuntimeDraft.transition({
        id: current.id,
        to: "sent",
        block_reason_code: null,
        actor_type: parsed.actor_type,
        policy_id: decision.policy_id,
        policy_version: decision.policy_version,
        decision_id: decision.decision_id,
        decision_reason_code: decision.reason_code,
      })
      audit_dispatch_result({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        dispatch_attempt_id: existing.id,
        actor_type: parsed.actor_type,
        outcome: "sent",
        remote_reference: existing.remote_reference ?? undefined,
        decision,
      })
      return present(current.id)
    }

    if (current.status !== "approved" && current.status !== "auto_approved") {
      throw new RuntimeOutboundValidationError({
        code: "policy_blocked",
        message: "send now requires an approved draft",
      })
    }

    let attempt = existing
    if (attempt?.state === "blocked") {
      RuntimeDispatchAttempt.remove({
        id: attempt.id,
      })
      attempt = undefined
    }
    if (!attempt) {
      attempt = RuntimeDispatchAttempt.create({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        integration_id: current.integration_id,
        idempotency_key: `dispatch:${current.id}`,
      })
    }

    let prepared: Prepared
    try {
      prepared = prepare({
        source_kind: current.source_kind,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        target: current.target,
        payload_json: current.payload_json,
        payload_schema_version: current.payload_schema_version,
      })
    } catch (error) {
      if (!(error instanceof RuntimeOutboundValidationError)) throw error
      const decision = blocked_decision("draft.dispatch", error.data.code)
      block({
        id: current.id,
        actor_type: parsed.actor_type,
        reason_code: error.data.code,
        policy: decision,
      })
      RuntimeDispatchAttempt.transition({
        id: attempt.id,
        to: "blocked",
        block_reason_code: error.data.code,
      })
      audit_dispatch_result({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        dispatch_attempt_id: attempt.id,
        actor_type: parsed.actor_type,
        outcome: "blocked",
        failure_code: error.data.code,
        decision,
      })
      return present(current.id)
    }
    const gate_reason = await gate({
      workspace_id: current.workspace_id,
      integration_id: current.integration_id,
      adapter_id: current.adapter_id,
      target: current.target,
      action: prepared.action,
    })
    if (gate_reason) {
      const decision = blocked_decision("draft.dispatch", gate_reason)
      if (attempt.state === "created" || attempt.state === "dispatching") {
        RuntimeDispatchAttempt.transition({
          id: attempt.id,
          to: "blocked",
          block_reason_code: gate_reason,
        })
      }
      block({
        id: current.id,
        actor_type: parsed.actor_type,
        reason_code: gate_reason,
        policy: decision,
      })
      audit_dispatch_result({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        dispatch_attempt_id: attempt.id,
        actor_type: parsed.actor_type,
        outcome: "blocked",
        failure_code: gate_reason,
        decision,
      })
      return present(current.id)
    }

    let decision: PolicyDecision
    try {
      decision = await decide({
        workspace_id: current.workspace_id,
        source_kind: current.source_kind,
        action: "draft.dispatch",
      })
    } catch {
      decision = {
        ...lineage("policy_evaluation_failed"),
        action: "draft.dispatch",
        outcome: "blocked",
        reason_code: "policy_evaluation_failed",
      }
    }

    try {
      audit_policy({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        actor_type: parsed.actor_type,
        decision,
        destination: current.target,
      })
    } catch (error) {
      const reason_code = audit_block_reason(error)
      if (!reason_code) throw error
      if (attempt.state === "created" || attempt.state === "dispatching") {
        RuntimeDispatchAttempt.transition({
          id: attempt.id,
          to: "blocked",
          block_reason_code: reason_code,
        })
      }
      const blocked = blocked_decision("draft.dispatch", reason_code)
      block({
        id: current.id,
        actor_type: parsed.actor_type,
        reason_code,
        policy: blocked,
      })
      return present(current.id)
    }

    if (decision.outcome !== "allow") {
      if (attempt.state === "created" || attempt.state === "dispatching") {
        RuntimeDispatchAttempt.transition({
          id: attempt.id,
          to: "blocked",
          block_reason_code: decision.reason_code as BlockReasonCode,
        })
      }
      block({
        id: current.id,
        actor_type: parsed.actor_type,
        reason_code: decision.reason_code as BlockReasonCode,
        policy: decision,
      })
      audit_dispatch_result({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        dispatch_attempt_id: attempt.id,
        actor_type: parsed.actor_type,
        outcome: "blocked",
        failure_code: decision.reason_code,
        decision,
      })
      return present(current.id)
    }

    const dispatching =
      attempt.state === "created"
        ? RuntimeDispatchAttempt.transition({
            id: attempt.id,
            to: "dispatching",
            block_reason_code: null,
          })
        : attempt

    if (attempt.state === "created") {
      try {
        audit_dispatch_attempt({
          draft_id: current.id,
          workspace_id: current.workspace_id,
          adapter_id: current.adapter_id,
          integration_id: current.integration_id,
          action_id: current.action_id,
          dispatch_attempt_id: attempt.id,
          idempotency_key: attempt.idempotency_key,
          actor_type: parsed.actor_type,
          action: current.action_id,
          destination: current.target,
          decision,
        })
      } catch (error) {
        const reason_code = audit_block_reason(error)
        if (!reason_code) throw error
        RuntimeDispatchAttempt.transition({
          id: attempt.id,
          to: "blocked",
          block_reason_code: reason_code,
        })
        const blocked = blocked_decision("draft.dispatch", reason_code)
        block({
          id: current.id,
          actor_type: parsed.actor_type,
          reason_code,
          policy: blocked,
        })
        return present(current.id)
      }
    }

    try {
      const result = await test_send(
        {
          workspace_id: current.workspace_id,
          integration_id: current.integration_id,
          adapter_id: current.adapter_id,
          draft_id: current.id,
          dispatch_attempt_id: dispatching.id,
          action_id: current.action_id,
          target: current.target,
          payload_json: current.payload_json,
          idempotency_key: attempt.idempotency_key,
        },
        { audit: false },
      )
      const accepted = RuntimeDispatchAttempt.transition({
        id: attempt.id,
        to: "remote_accepted",
        remote_reference: result.remote_reference,
        block_reason_code: null,
      })
      if (seams().crash_after_remote_accepted) {
        throw new Error("crash_after_remote_accepted")
      }
      RuntimeDispatchAttempt.transition({
        id: attempt.id,
        to: "finalized",
        remote_reference: accepted.remote_reference,
        block_reason_code: null,
      })
      RuntimeDraft.transition({
        id: current.id,
        to: "sent",
        block_reason_code: null,
        actor_type: parsed.actor_type,
        policy_id: decision.policy_id,
        policy_version: decision.policy_version,
        decision_id: decision.decision_id,
        decision_reason_code: decision.reason_code,
      })
      audit_dispatch_result({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        dispatch_attempt_id: attempt.id,
        actor_type: parsed.actor_type,
        outcome: "sent",
        remote_reference: accepted.remote_reference ?? undefined,
        decision,
      })
    } catch (error) {
      if (error instanceof RuntimeManagedEndpointError || error instanceof RuntimeOutboundValidationError) {
        const reason_code = error.data.code
        const blocked = blocked_decision("draft.dispatch", reason_code)
        RuntimeDispatchAttempt.transition({
          id: attempt.id,
          to: "blocked",
          block_reason_code: reason_code,
        })
        block({
          id: current.id,
          actor_type: parsed.actor_type,
          reason_code,
          policy: blocked,
        })
        audit_dispatch_result({
          draft_id: current.id,
          workspace_id: current.workspace_id,
          adapter_id: current.adapter_id,
          integration_id: current.integration_id,
          action_id: current.action_id,
          dispatch_attempt_id: attempt.id,
          actor_type: parsed.actor_type,
          outcome: "blocked",
          failure_code: reason_code,
          decision: blocked,
        })
        return present(current.id)
      }

      if (error instanceof Error && error.message === "crash_after_remote_accepted") {
        throw error
      }

      RuntimeDispatchAttempt.transition({
        id: attempt.id,
        to: "failed",
      })
      RuntimeDraft.transition({
        id: current.id,
        to: "failed",
        actor_type: parsed.actor_type,
      })
      audit_dispatch_result({
        draft_id: current.id,
        workspace_id: current.workspace_id,
        adapter_id: current.adapter_id,
        integration_id: current.integration_id,
        action_id: current.action_id,
        dispatch_attempt_id: attempt.id,
        actor_type: parsed.actor_type,
        outcome: "failed",
        failure_code: "dispatch_failed",
        decision,
      })
      throw error
    }

    return present(current.id)
  }

  export namespace Testing {
    export function reset() {
      override = undefined
      try {
        const current = state()
        current.writes.length = 0
        current.accepted.clear()
      } catch {}
    }

    export function set(input: Seams) {
      override = input
    }

    export function writes() {
      return [...state().writes]
    }

    export function send(input: z.input<typeof test_send_input>) {
      return test_send(test_send_input.parse(input), { audit: true })
    }
  }
}
