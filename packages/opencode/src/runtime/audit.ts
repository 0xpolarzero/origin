import { Database } from "@/storage/db"
import z from "zod"
import { AuditEventTable } from "./runtime.sql"
import {
  actor_type,
  draft_status,
  event_type,
  integration_attempt_state,
  operation_status,
  policy_event_types,
  run_status,
  type EventType,
} from "./contract"
import { RuntimeAuditPayloadError, RuntimePolicyLineageError } from "./error"
import { create_uuid_v7, uuid_v7 } from "./uuid"

const run_transition_payload = z
  .object({
    from: z.union([z.literal("create"), run_status]),
    to: run_status,
  })
  .strict()

const operation_transition_payload = z
  .object({
    from: z.union([z.literal("create"), operation_status]),
    to: operation_status,
  })
  .strict()

const integration_attempt_payload = z
  .object({
    from: z.union([z.literal("create"), integration_attempt_state]),
    to: integration_attempt_state,
    replay_index: z.number().int().nonnegative(),
  })
  .strict()

const reconciliation_watchdog_payload = z
  .object({
    event: z.enum(["notification", "keep_running", "hard_stop"]),
    elapsed_ms: z.number().int().nonnegative(),
    threshold_ms: z.number().int().positive(),
    hard_stop_ms: z.number().int().positive(),
  })
  .strict()

const draft_transition_payload = z
  .object({
    from: z.union([z.literal("create"), draft_status]),
    to: draft_status,
  })
  .strict()

const policy_decision_payload = z
  .object({
    outcome: z.enum(["allow", "deny", "blocked"]),
    action: z.string(),
    destination: z.string().optional(),
  })
  .strict()

const dispatch_attempt_payload = z
  .object({
    action: z.string(),
    destination: z.string(),
    idempotency_key: z.string(),
  })
  .strict()

const dispatch_result_payload = z
  .object({
    outcome: z.enum(["sent", "failed", "blocked"]),
    remote_id: z.string().optional(),
    failure_code: z.string().optional(),
  })
  .strict()

const security_setting_changed_payload = z
  .object({
    setting: z.string(),
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .strict()

const payload_schema = {
  "run.transitioned": run_transition_payload,
  "operation.transitioned": operation_transition_payload,
  "integration_attempt.transitioned": integration_attempt_payload,
  "reconciliation.watchdog": reconciliation_watchdog_payload,
  "draft.transitioned": draft_transition_payload,
  "policy.decision": policy_decision_payload,
  "dispatch.attempt": dispatch_attempt_payload,
  "dispatch.result": dispatch_result_payload,
  "security.setting_changed": security_setting_changed_payload,
} satisfies Record<EventType, z.ZodType>

const policy_events = new Set<string>(policy_event_types)

const write_input = z.object({
  id: uuid_v7.optional(),
  event_type,
  actor_type,
  occurred_at: z.number().int().positive().optional(),
  workspace_id: z.string(),
  session_id: z.string().nullable().optional(),
  run_id: uuid_v7.nullable().optional(),
  operation_id: uuid_v7.nullable().optional(),
  draft_id: uuid_v7.nullable().optional(),
  integration_id: z.string().nullable().optional(),
  integration_attempt_id: uuid_v7.nullable().optional(),
  policy_id: z.string().nullable().optional(),
  policy_version: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  decision_reason_code: z.string().nullable().optional(),
  event_payload: z.unknown(),
})

function secret(path: string) {
  return /(token|secret|password|api[_-]?key|private[_-]?key|credential|authorization)/i.test(path)
}

function scan(event_type: EventType, value: unknown, path: string[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(event_type, item, [...path, index.toString()]))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, item] of Object.entries(value)) {
    const next = [...path, key]
    if (secret(key) || secret(next.join("."))) {
      throw new RuntimeAuditPayloadError({
        event_type,
        code: "audit_payload_rejected",
        message: `secret-like field "${next.join(".")}" is not allowed in audit payload`,
      })
    }
    scan(event_type, item, next)
  }
}

function parse_payload(input: z.infer<typeof write_input>) {
  const schema = payload_schema[input.event_type]
  const result = schema.safeParse(input.event_payload)
  if (!result.success) {
    throw new RuntimeAuditPayloadError({
      event_type: input.event_type,
      code: "audit_payload_rejected",
      message: result.error.message,
    })
  }
  scan(input.event_type, result.data)
  return result.data
}

function validate_policy_lineage(input: z.infer<typeof write_input>) {
  if (!policy_events.has(input.event_type)) return
  for (const field of ["policy_id", "policy_version", "decision_id", "decision_reason_code"] as const) {
    if (input[field]) continue
    throw new RuntimePolicyLineageError({
      event_type: input.event_type,
      field,
      code: "policy_lineage_required",
    })
  }
}

function insert(db: Database.TxOrDb, input: z.infer<typeof write_input>) {
  validate_policy_lineage(input)
  const event_payload = parse_payload(input)
  return db
    .insert(AuditEventTable)
    .values({
      id: create_uuid_v7(input.id),
      event_type: input.event_type,
      actor_type: input.actor_type,
      occurred_at: input.occurred_at ?? Date.now(),
      workspace_id: input.workspace_id,
      session_id: input.session_id ?? null,
      run_id: input.run_id ?? null,
      operation_id: input.operation_id ?? null,
      draft_id: input.draft_id ?? null,
      integration_id: input.integration_id ?? null,
      integration_attempt_id: input.integration_attempt_id ?? null,
      policy_id: input.policy_id ?? null,
      policy_version: input.policy_version ?? null,
      decision_id: input.decision_id ?? null,
      decision_reason_code: input.decision_reason_code ?? null,
      event_payload,
    })
    .returning()
    .get()
}

export namespace RuntimeAudit {
  export const WriteInput = write_input
  export type WriteInput = z.input<typeof WriteInput>

  export function write(input: WriteInput, tx?: Database.TxOrDb) {
    const parsed = WriteInput.parse(input)
    if (tx) return insert(tx, parsed)
    return Database.use((db) => insert(db, parsed))
  }
}
