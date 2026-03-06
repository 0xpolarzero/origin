import { GlobalBus } from "@/bus/global"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeAudit } from "@/runtime/audit"
import { RuntimeRun } from "@/runtime/run"
import { RuntimeSignalIngressError } from "@/runtime/error"
import { RuntimeWorkspaceType } from "@/runtime/workspace-type"
import { RuntimeWorkflowSignalDedupe } from "@/runtime/workflow-signal-dedupe"
import { RuntimeWorkflowTrigger } from "@/runtime/workflow-trigger"
import { Database } from "@/storage/db"
import { WorkflowAutoRun } from "@/workflow/manual-run"
import { Scheduler } from "@/scheduler"
import { WorkflowTriggerEvent } from "./trigger-event"
import { WorkflowCron } from "./cron"
import { WorkflowTriggerHash } from "./trigger-hash"
import { WorkflowValidation } from "./validate"
import z from "zod"

const POLL_MS = 30_000
const SKIP_CAP = 100

const signal_param = z
  .object({
    signal: z.string().min(1),
  })
  .strict()

const signal_body = z
  .object({
    event_time: z.number().int().positive(),
    provider_event_id: z.string().min(1).optional(),
    payload_json: z.record(z.string(), z.unknown()),
    source: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const signal_response = z
  .object({
    accepted: z.boolean(),
    duplicate: z.boolean().default(false),
    reason: z.enum(["signal_unregistered", "before_enablement_boundary", "workspace_policy_blocked"]).nullable().default(null),
    run_ids: z.array(z.string()).default([]),
  })
  .strict()

type SignalWorkflow = {
  id: string
  name: string
  instructions: string
  signal: string
}

type CronWorkflow = {
  id: string
  name: string
  instructions: string
  cron: string
}

type Seams = {
  now?: () => number
  timezone?: () => string
  run?: (input: z.input<typeof WorkflowAutoRun.StartInput>) => Promise<z.output<typeof WorkflowAutoRun.Info>>
  notify?: (input: z.infer<typeof WorkflowTriggerEvent.Outcome.properties>) => void
}

let override: Seams | undefined
let running = false

function seams() {
  if (override) return override
  return {}
}

function boundary(value: number) {
  return Math.floor(value / 60_000) * 60_000
}

function timezone() {
  const zone = seams().timezone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  if (zone) return zone
  return "UTC"
}

function trigger_metadata(input: Record<string, unknown>) {
  return input
}

function notify(input: z.infer<typeof WorkflowTriggerEvent.Outcome.properties>) {
  seams().notify?.(input)
  GlobalBus.emit("event", {
    directory: Instance.directory,
    payload: {
      type: WorkflowTriggerEvent.Outcome.type,
      properties: input,
    },
  })
  RuntimeAudit.write({
    event_type: "workflow.trigger.outcome",
    actor_type: "system",
    workspace_id: input.workspace_id,
    run_id: input.run_ids[0] ?? null,
    event_payload: input,
  })
}

function run(input: z.input<typeof WorkflowAutoRun.StartInput>) {
  const start = seams().run ?? ((value: z.input<typeof WorkflowAutoRun.StartInput>) => WorkflowAutoRun.start(value))
  return start(input)
}

function message(input: { trigger_type: "cron" | "signal"; outcome: "run_started" | "skipped" | "duplicate"; count?: number }) {
  if (input.trigger_type === "signal" && input.outcome === "duplicate") return "Ignored duplicate signal"
  if (input.trigger_type === "signal" && input.outcome === "run_started") return "Started signal-triggered workflow run"
  if (input.trigger_type === "cron" && input.outcome === "run_started") return "Started scheduled workflow run"
  if (input.trigger_type === "cron" && (input.count ?? 1) > 1) {
    return `Skipped ${input.count} missed cron slots`
  }
  return "Skipped missed cron slot"
}

function skips(input: readonly WorkflowCron.Skip[]) {
  if (input.length <= SKIP_CAP) {
    return {
      detailed: [...input],
      overflow: [] as WorkflowCron.Skip[],
    }
  }

  return {
    detailed: input.slice(0, SKIP_CAP - 1),
    overflow: input.slice(SKIP_CAP - 1),
  }
}

function workflow_key(workflow_id: string, trigger_type: "cron" | "signal") {
  return `${workflow_id}\u0000${trigger_type}`
}

async function sync_workspace(input: { workspace_id: string; directory: string; now: number }) {
  const report = await WorkflowValidation.validate({
    directory: input.directory,
  })

  const cron = report.workflows
    .flatMap((item) => {
      if (!item.workflow || !item.runnable) return []
      if (item.workflow.trigger.type !== "cron") return []
      return [
        {
          id: item.workflow.id,
          name: item.workflow.name,
          instructions: item.workflow.instructions,
          cron: item.workflow.trigger.cron,
        } satisfies CronWorkflow,
      ]
    })

  const signal = report.workflows
    .flatMap((item) => {
      if (!item.workflow || !item.runnable) return []
      if (item.workflow.trigger.type !== "signal") return []
      return [
        {
          id: item.workflow.id,
          name: item.workflow.name,
          instructions: item.workflow.instructions,
          signal: item.workflow.trigger.signal,
        } satisfies SignalWorkflow,
      ]
    })

  const first = Math.max(0, boundary(input.now) - 60_000)
  const rows = [
    ...cron.map((item) =>
      RuntimeWorkflowTrigger.upsert({
        workspace_id: input.workspace_id,
        workflow_id: item.id,
        trigger_type: "cron",
        trigger_value: item.cron,
        timezone: timezone(),
        enabled_at: input.now,
        cursor_at: first,
      }),
    ),
    ...signal.map((item) =>
      RuntimeWorkflowTrigger.upsert({
        workspace_id: input.workspace_id,
        workflow_id: item.id,
        trigger_type: "signal",
        trigger_value: item.signal,
        enabled_at: input.now,
      }),
    ),
  ]

  RuntimeWorkflowTrigger.prune({
    workspace_id: input.workspace_id,
    keep: rows.map((item) => ({
      workflow_id: item.workflow_id,
      trigger_type: item.trigger_type,
    })),
  })

  return {
    report,
    rows: new Map(rows.map((item) => [workflow_key(item.workflow_id, item.trigger_type), item])),
    cron,
    signal,
  }
}

async function process_cron(input: {
  workspace_id: string
  now: number
  cron: CronWorkflow[]
  rows: Map<string, ReturnType<typeof RuntimeWorkflowTrigger.upsert>>
}) {
  for (const workflow of input.cron) {
    const row = input.rows.get(workflow_key(workflow.id, "cron"))
    if (!row) continue

    const result = WorkflowCron.evaluate({
      cron: workflow.cron,
      timezone: row.timezone ?? timezone(),
      cursor_at: row.cursor_at ?? Math.max(0, boundary(input.now) - 60_000),
      now: input.now,
    })

    if (result.execute) {
      const started = await run({
        workflow: {
          id: workflow.id,
          name: workflow.name,
          instructions: workflow.instructions,
        },
        trigger_type: "cron",
        trigger_id: `cron:${result.execute.slot_utc}`,
        trigger_metadata_json: trigger_metadata({
          source: "cron",
          slot_local: result.execute.slot_local,
          slot_utc: result.execute.slot_utc,
          summary: false,
        }),
      })
      notify({
        workspace_id: input.workspace_id,
        workflow_id: workflow.id,
        trigger_type: "cron",
        outcome: "run_started",
        reason_code: null,
        message: message({
          trigger_type: "cron",
          outcome: "run_started",
        }),
        count: 1,
        run_ids: [started.id],
      })
    }

    const split = skips(result.skipped)
    const detailed = split.detailed
    const overflow = split.overflow
    detailed.forEach((item) => {
      RuntimeRun.create({
        status: "skipped",
        trigger_type: "cron",
        workflow_id: workflow.id,
        workspace_id: input.workspace_id,
        reason_code: item.reason_code,
        trigger_metadata_json: trigger_metadata({
          source: "cron",
          slot_local: item.slot_local,
          slot_utc: item.slot_utc,
          summary: false,
        }),
      })
    })

    if (overflow.length > 0) {
      RuntimeRun.create({
        status: "skipped",
        trigger_type: "cron",
        workflow_id: workflow.id,
        workspace_id: input.workspace_id,
        reason_code: "cron_missed_slot",
        trigger_metadata_json: trigger_metadata({
          source: "cron",
          summary: true,
          skipped_count: overflow.length,
          first_slot_local: overflow[0]?.slot_local ?? null,
          last_slot_local: overflow.at(-1)?.slot_local ?? null,
          reason_counts: {
            cron_missed_slot: overflow.filter((item) => item.reason_code === "cron_missed_slot").length,
            dst_gap_skipped: overflow.filter((item) => item.reason_code === "dst_gap_skipped").length,
          },
        }),
      })
    }

    if (result.skipped.length > 0) {
      notify({
        workspace_id: input.workspace_id,
        workflow_id: workflow.id,
        trigger_type: "cron",
        outcome: "skipped",
        reason_code: "cron_missed_slot",
        message: message({
          trigger_type: "cron",
          outcome: "skipped",
          count: result.skipped.length,
        }),
        count: result.skipped.length,
        run_ids: [],
      })
    }

    RuntimeWorkflowTrigger.advance({
      id: row.id,
      cursor_at: result.cursor_at,
    })
  }
}

async function signal_workspace() {
  const workspace_id = WorkspaceContext.workspaceID
  if (workspace_id) return workspace_id
  throw new RuntimeSignalIngressError({
    code: "signal_workspace_required",
    message: "signal ingress requires a workspace id",
  })
}

export namespace WorkflowTriggerEngine {
  export const SignalParam = signal_param
  export const SignalBody = signal_body
  export const SignalResponse = signal_response

  export const Testing = {
    set(input?: Seams) {
      override = input
    },
    reset() {
      override = undefined
      running = false
    },
  }

  export function init() {
    Scheduler.register({
      id: "workflow.trigger.engine",
      interval: POLL_MS,
      scope: "global",
      run: async () => {
        await tick()
      },
    })
  }

  export async function tick() {
    if (running) return
    running = true
    try {
      const now = seams().now?.() ?? Date.now()
      const workspaces = Database.use((db) => db.select().from(WorkspaceTable).all())
      for (const workspace of workspaces) {
        await Instance.provide({
          directory: workspace.config.directory,
          init: InstanceBootstrap,
          fn: async () => {
            await WorkspaceContext.provide({
              workspaceID: workspace.id,
              fn: async () => {
                const synced = await sync_workspace({
                  workspace_id: workspace.id,
                  directory: workspace.config.directory,
                  now,
                })
                await process_cron({
                  workspace_id: workspace.id,
                  now,
                  cron: synced.cron,
                  rows: synced.rows,
                })
              },
            })
          },
        })
      }
    } finally {
      running = false
    }
  }

  export async function signal(value: {
    signal: z.input<typeof SignalParam>["signal"]
    body: z.input<typeof SignalBody>
  }) {
    const workspace_id = await signal_workspace()
    const body = SignalBody.parse(value.body)
    const current = await RuntimeWorkspaceType.detect(Instance.directory)
    if (current !== "origin") {
      return SignalResponse.parse({
        accepted: false,
        duplicate: false,
        reason: "workspace_policy_blocked",
        run_ids: [],
      })
    }

    const synced = await sync_workspace({
      workspace_id,
      directory: Instance.directory,
      now: seams().now?.() ?? Date.now(),
    })
    const matches = synced.signal.filter((item) => item.signal === value.signal)
    if (matches.length === 0) {
      return SignalResponse.parse({
        accepted: false,
        duplicate: false,
        reason: "signal_unregistered",
        run_ids: [],
      })
    }

    const run_ids: string[] = []
    let duplicate = false
    let boundary = false

    for (const workflow of matches) {
      const row = synced.rows.get(workflow_key(workflow.id, "signal"))
      if (!row) continue
      if (body.event_time <= row.enabled_at) {
        boundary = true
        continue
      }

      const dedupe_key =
        body.provider_event_id ??
        WorkflowTriggerHash.fallback({
          signal: value.signal,
          event_time: body.event_time,
          payload_json: body.payload_json,
          source: body.source,
        })

      const claim = RuntimeWorkflowSignalDedupe.claim({
        trigger_id: row.id,
        workspace_id,
        workflow_id: workflow.id,
        dedupe_key,
        provider_event_id: body.provider_event_id ?? null,
        fallback_hash: body.provider_event_id ? null : dedupe_key,
        event_time: body.event_time,
        payload_json: body.payload_json,
        source_json: body.source ?? null,
      })

      if (claim.duplicate) {
        duplicate = true
        const item = RuntimeRun.create({
          status: "skipped",
          trigger_type: "signal",
          workflow_id: workflow.id,
          workspace_id,
          reason_code: "duplicate_event",
          trigger_metadata_json: trigger_metadata({
            source: "signal",
            signal: value.signal,
            event_time: body.event_time,
            provider_event_id: body.provider_event_id ?? null,
            dedupe_key,
            first_run_id: claim.row.first_run_id,
          }),
        })
        notify({
          workspace_id,
          workflow_id: workflow.id,
          trigger_type: "signal",
          outcome: "duplicate",
          reason_code: "duplicate_event",
          message: message({
            trigger_type: "signal",
            outcome: "duplicate",
          }),
          count: 1,
          run_ids: [item.id],
        })
        continue
      }

      try {
        const started = await run({
          workflow: {
            id: workflow.id,
            name: workflow.name,
            instructions: workflow.instructions,
          },
          trigger_type: "signal",
          trigger_id: `signal:${dedupe_key}`,
          trigger_metadata_json: trigger_metadata({
            source: "signal",
            signal: value.signal,
            event_time: body.event_time,
            provider_event_id: body.provider_event_id ?? null,
            dedupe_key,
            hash_version: body.provider_event_id ? null : WorkflowTriggerHash.Version,
          }),
        })
        RuntimeWorkflowSignalDedupe.link({
          id: claim.row.id,
          first_run_id: started.id,
        })
        run_ids.push(started.id)
        notify({
          workspace_id,
          workflow_id: workflow.id,
          trigger_type: "signal",
          outcome: "run_started",
          reason_code: null,
          message: message({
            trigger_type: "signal",
            outcome: "run_started",
          }),
          count: 1,
          run_ids: [started.id],
        })
      } catch (error) {
        RuntimeWorkflowSignalDedupe.release({
          id: claim.row.id,
        })
        throw error
      }
    }

    if (run_ids.length === 0 && !duplicate && boundary) {
      return SignalResponse.parse({
        accepted: false,
        duplicate: false,
        reason: "before_enablement_boundary",
        run_ids: [],
      })
    }

    return SignalResponse.parse({
      accepted: run_ids.length > 0 || duplicate,
      duplicate,
      reason: null,
      run_ids,
    })
  }
}
