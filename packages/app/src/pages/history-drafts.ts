import type { HistoryDraft, HistoryDraftCreateInput, HistoryDraftUpdateInput } from "./history-data"
import type { DraftScope } from "./history-state"

export type DraftEditor = {
  run_id: string
  source_kind: "user" | "system"
  adapter_id: string
  integration_id: string
  action_id: string
  target: string
  payload_schema_version: string
  payload_json: string
}

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.keys(value)
    .toSorted((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`
}

const text = (value: string) => value.trim()

const integer = (value: string) => {
  const parsed = Number.parseInt(text(value), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) return
  return parsed
}

export const payloadText = (value: Record<string, unknown>) => JSON.stringify(value, null, 2)

export const createDraftEditor = (draft?: HistoryDraft): DraftEditor => ({
  run_id: draft?.run_id ?? "",
  source_kind: draft?.source_kind ?? "user",
  adapter_id: draft?.adapter_id ?? "test",
  integration_id: draft?.integration_id ?? "test/default",
  action_id: draft?.action_id ?? "message.send",
  target: draft?.target ?? "channel://general",
  payload_schema_version: `${draft?.payload_schema_version ?? 1}`,
  payload_json: payloadText(draft?.payload_json ?? { text: "" }),
})

export const parseDraftPayload = (value: string): Result<Record<string, unknown>> => {
  const raw = text(value)
  if (!raw) {
    return {
      ok: false,
      error: "Payload JSON is required.",
    }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: "Payload JSON must be a JSON object.",
      }
    }
    return {
      ok: true,
      value: parsed as Record<string, unknown>,
    }
  } catch {
    return {
      ok: false,
      error: "Payload JSON must be valid JSON.",
    }
  }
}

const validate = (input: DraftEditor) => {
  const payload = parseDraftPayload(input.payload_json)
  if (!payload.ok) return payload

  const payload_schema_version = integer(input.payload_schema_version)
  if (!payload_schema_version) {
    return {
      ok: false,
      error: "Payload schema version must be a positive integer.",
    } satisfies Result<never>
  }

  const source_kind = input.source_kind === "system" ? "system" : "user"
  const adapter_id = text(input.adapter_id)
  const integration_id = text(input.integration_id)
  const action_id = text(input.action_id)
  const target = text(input.target)

  if (!adapter_id || !integration_id || !action_id || !target) {
    return {
      ok: false,
      error: "Adapter, integration, action, and target are required.",
    } satisfies Result<never>
  }

  return {
    ok: true,
    value: {
      source_kind,
      adapter_id,
      integration_id,
      action_id,
      target,
      payload_json: payload.value,
      payload_schema_version,
    },
  } satisfies Result<{
    source_kind: DraftEditor["source_kind"]
    adapter_id: string
    integration_id: string
    action_id: string
    target: string
    payload_json: Record<string, unknown>
    payload_schema_version: number
  }>
}

export const draftCreateInput = (input: DraftEditor): Result<HistoryDraftCreateInput> => {
  const base = validate(input)
  if (!base.ok) return base

  return {
    ok: true,
    value: {
      ...base.value,
      run_id: text(input.run_id) || null,
      actor_type: "user",
    },
  }
}

export const draftUpdateInput = (_draft: HistoryDraft, input: DraftEditor): Result<HistoryDraftUpdateInput> => {
  const base = validate(input)
  if (!base.ok) return base

  return {
    ok: true,
    value: {
      ...base.value,
      actor_type: "user",
    },
  }
}

export const hasMaterialChanges = (draft: HistoryDraft, input: DraftEditor) => {
  const payload = parseDraftPayload(input.payload_json)
  const nextPayload = payload.ok ? stable(payload.value) : text(input.payload_json)

  if (draft.source_kind !== input.source_kind) return true
  if (text(draft.adapter_id) !== text(input.adapter_id)) return true
  if (text(draft.integration_id) !== text(input.integration_id)) return true
  if (text(draft.action_id) !== text(input.action_id)) return true
  if (text(draft.target) !== text(input.target)) return true
  return stable(draft.payload_json) !== nextPayload
}

export const scopeFromDraftStatus = (status: string): DraftScope => {
  if (status === "sent" || status === "rejected" || status === "failed") return "processed"
  return "pending"
}

export const draftCanEdit = (status: string) => status !== "sent" && status !== "rejected" && status !== "failed"

export const draftNeedsApproval = (status: string) => status !== "approved" && status !== "auto_approved"

export const draftReasonCodes = (draft: Pick<HistoryDraft, "block_reason_code" | "decision_reason_code" | "dispatch">) =>
  [
    ...new Set(
      [draft.block_reason_code, draft.decision_reason_code, draft.dispatch?.block_reason_code].filter(
        (value): value is string => !!value,
      ),
    ),
  ]

export const draftRemediation = (draft: Pick<HistoryDraft, "block_reason_code" | "decision_reason_code" | "dispatch">) => {
  const codes = draftReasonCodes(draft)
  if (codes.includes("workspace_policy_blocked")) {
    return "Outbound dispatch is limited to Origin workspaces. Move the action into the protected Origin workspace, then retry."
  }
  if (codes.includes("material_edit_invalidation")) {
    return "Approval was cleared after a material edit. Review the payload and approve again before sending."
  }
  if (codes.includes("auth_unhealthy")) {
    return "Restore the integration auth state before retrying this draft."
  }
  if (codes.includes("integration_disabled")) {
    return "Re-enable the integration before retrying this draft."
  }
  if (codes.includes("target_not_allowed")) {
    return "Choose a target allowed by the adapter and integration before retrying."
  }
  if (codes.includes("schema_invalid") || codes.includes("schema_version_unsupported")) {
    return "Update the action payload to match the registered adapter schema."
  }
}
