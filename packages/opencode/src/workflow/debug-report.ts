import path from "node:path"
import z from "zod"
import { terminal_run_statuses } from "@/runtime/contract"
import { RuntimeIllegalTransitionError, RuntimeOutboundValidationError } from "@/runtime/error"
import { RuntimeOutbound } from "@/runtime/outbound"
import { RuntimeReconciliation } from "@/runtime/reconciliation"
import { RuntimeRun } from "@/runtime/run"
import { uuid_v7 } from "@/runtime/uuid"
import { Session } from "@/session"
import { formatTranscript } from "@/cli/cmd/tui/util/transcript"

const max_prompt_length = 12_000
const max_file_count = 10
const max_file_length = 4_000
const targets = ["system://developers"] as const

const field_id = z.enum(["metadata", "prompt", "files"])

const preview_field = z
  .object({
    id: field_id,
    title: z.string(),
    required: z.boolean(),
    selected: z.boolean(),
    preview: z.string(),
  })
  .strict()

const preview_view = z
  .object({
    run_id: uuid_v7,
    session_id: z.string().nullable(),
    workspace_id: z.string(),
    workflow_id: z.string().nullable(),
    status: z.string(),
    trigger_type: z.string(),
    target: z.string(),
    targets: z.array(z.string()),
    fields: z.array(preview_field),
  })
  .strict()

const create_input = z
  .object({
    target: z.string().min(1).default(targets[0]),
    include_prompt: z.boolean().default(false),
    include_files: z.boolean().default(false),
    consent: z.literal(true),
  })
  .strict()

const create_result = z
  .object({
    run_status: z.string(),
    draft: RuntimeOutbound.View,
  })
  .strict()

function run(run_id: string) {
  return RuntimeRun.get({ id: run_id })
}

function validate_target(target: string) {
  if (targets.includes(target as (typeof targets)[number])) return target
  throw new RuntimeOutboundValidationError({
    code: "target_not_allowed",
    message: `report target is not allowlisted: ${target}`,
    field: "target",
  })
}

function metadata(row: ReturnType<typeof RuntimeRun.get>) {
  return {
    report_type: "debug_reconciliation" as const,
    metadata: {
      generated_at: Date.now(),
      reminder: {
        threshold_ms: RuntimeReconciliation.threshold_ms,
        cadence_ms: RuntimeReconciliation.cadence_ms,
        hard_stop_ms: RuntimeReconciliation.hard_stop_ms,
      },
      run: {
        id: row.id,
        workspace_id: row.workspace_id,
        session_id: row.session_id,
        workflow_id: row.workflow_id,
        status: row.status,
        trigger_type: row.trigger_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
        started_at: row.started_at,
        ready_for_integration_at: row.ready_for_integration_at,
        reason_code: row.reason_code,
        failure_code: row.failure_code,
        cleanup_failed: row.cleanup_failed,
        changed_paths: row.integration_candidate_changed_paths ?? [],
      },
    },
  }
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
    }
  }

  return {
    text: `${value.slice(0, limit)}\n\n...[truncated]`,
    truncated: true,
  }
}

function stop(run_id: string) {
  while (true) {
    const row = run(run_id)
    if (row.status === "cancel_requested") return row
    if (terminal_run_statuses.has(row.status)) return row

    try {
      return RuntimeRun.transition({
        id: row.id,
        to: row.status === "integrating" || row.status === "reconciling" ? "cancel_requested" : "canceled",
        reason_code: row.status === "integrating" || row.status === "reconciling" ? "cancel_requested_after_integration_started" : undefined,
        actor_type: "user",
      })
    } catch (error) {
      if (!(error instanceof RuntimeIllegalTransitionError)) throw error
    }
  }
}

async function prompt(row: ReturnType<typeof RuntimeRun.get>) {
  if (!row.session_id) return
  const session = await Session.get(row.session_id)
  if (!session) return
  const messages = await Session.messages({
    sessionID: row.session_id,
    limit: 100,
  })
  const value = truncate(
    formatTranscript(
      {
        id: session.id,
        title: session.title,
        time: {
          created: session.time.created,
          updated: session.time.updated,
        },
      },
      messages.map((item) => ({
        info: item.info as never,
        parts: item.parts as never,
      })),
      {
        thinking: false,
        toolDetails: false,
        assistantMetadata: false,
      },
    ),
    max_prompt_length,
  )

  return {
    format: "markdown" as const,
    truncated: value.truncated,
    content: value.text,
  }
}

async function files(row: ReturnType<typeof RuntimeRun.get>) {
  const ids = row.integration_candidate_changed_paths ?? []
  const allow = new Set(ids)
  if (row.session_id) {
    const diffs = await Session.diff(row.session_id).catch(() => [])
    const page = diffs.filter((item) => !allow.size || allow.has(item.file)).slice(0, max_file_count)
    if (page.length > 0) {
      return {
        truncated: diffs.length > max_file_count || page.some((item) => item.after.length > max_file_length),
        items: page.map((item) => {
          const value = truncate(item.after, max_file_length)
          return {
            path: item.file,
            exists: item.status !== "deleted",
            truncated: value.truncated,
            content: value.text || undefined,
          }
        }),
      }
    }
  }

  const root = row.run_workspace_directory
  const base = root ? path.resolve(root) : undefined
  const list = await Promise.all(
    ids.slice(0, max_file_count).map(async (name) => {
      if (!root || !base) {
        return {
          path: name,
          exists: false,
          truncated: false,
        }
      }

      const target = path.resolve(root, name)
      if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
        return {
          path: name,
          exists: false,
          truncated: false,
        }
      }

      const file = Bun.file(target)
      const exists = await file.exists()
      if (!exists) {
        return {
          path: name,
          exists: false,
          truncated: false,
        }
      }

      const text = await file.text().catch(() => "")
      const value = truncate(text, max_file_length)
      return {
        path: name,
        exists: true,
        truncated: value.truncated,
        content: value.text,
      }
    }),
  )

  return {
    truncated: ids.length > max_file_count || list.some((item) => item.truncated),
    items: list,
  }
}

async function fields(row: ReturnType<typeof RuntimeRun.get>) {
  const base = metadata(row)
  const prompt_field = await prompt(row)
  const file_field = await files(row)

  return [
    {
      id: "metadata" as const,
      title: "Runtime metadata",
      required: true,
      selected: true,
      preview: JSON.stringify(base, null, 2),
    },
    {
      id: "prompt" as const,
      title: "Prompt transcript",
      required: false,
      selected: false,
      preview: prompt_field?.content ?? "No linked session transcript is available.",
    },
    {
      id: "files" as const,
      title: "Changed files",
      required: false,
      selected: false,
      preview: JSON.stringify(file_field, null, 2),
    },
  ] satisfies z.output<typeof preview_field>[]
}

export namespace WorkflowDebugReport {
  export const Preview = preview_view
  export const CreateInput = create_input
  export const CreateResult = create_result

  export async function preview(run_id: string) {
    const row = run(run_id)

    return preview_view.parse({
      run_id: row.id,
      session_id: row.session_id,
      workspace_id: row.workspace_id,
      workflow_id: row.workflow_id,
      status: row.status,
      trigger_type: row.trigger_type,
      target: targets[0],
      targets: [...targets],
      fields: await fields(row),
    })
  }

  export async function create(run_id: string, input: z.input<typeof CreateInput>) {
    const row = run(run_id)
    const value = create_input.parse(input)
    const target = validate_target(value.target)
    const prompt_value = value.include_prompt ? await prompt(row) : undefined
    const file_value = value.include_files ? await files(row) : undefined
    const canceled = stop(row.id)
    const payload_json = {
      ...metadata(canceled),
      ...(prompt_value ? { prompt: prompt_value } : {}),
      ...(file_value ? { files: file_value } : {}),
    }

    const draft = await RuntimeOutbound.create({
      run_id: row.id,
      workspace_id: row.workspace_id,
      source_kind: "system_report",
      integration_id: "system/default",
      adapter_id: "system",
      action_id: "report.dispatch",
      target,
      payload_json,
      payload_schema_version: 1,
      actor_type: "user",
    })

    return create_result.parse({
      run_status: canceled.status,
      draft,
    })
  }
}
