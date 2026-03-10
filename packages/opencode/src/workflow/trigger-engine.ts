import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Instance } from "@/project/instance"
import { RuntimeSignalIngressError } from "@/runtime/error"
import { RuntimeWorkspaceType } from "@/runtime/workspace-type"
import { Scheduler } from "@/scheduler"
import z from "zod"

const POLL_MS = 30_000

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

type Seams = {
  now?: () => number
  timezone?: () => string
  notify?: (input: { outcome: string; count: number; message: string }) => void
  run?: (input: {
    workflow_id: string
    trigger_id: string
    trigger_type: "cron" | "signal"
    trigger_metadata_json?: Record<string, unknown> | null
  }) => Promise<unknown>
}

let override: Seams | undefined

function seams() {
  if (override) return override
  return {}
}

async function workspace_required() {
  if (WorkspaceContext.workspaceID) return WorkspaceContext.workspaceID
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
    seams().now?.()
  }

  export async function signal(value: {
    signal: z.input<typeof SignalParam>["signal"]
    body: z.input<typeof SignalBody>
  }) {
    SignalParam.parse({ signal: value.signal })
    SignalBody.parse(value.body)
    await workspace_required()

    const current = await RuntimeWorkspaceType.detect(Instance.directory)
    if (current !== "origin") {
      return SignalResponse.parse({
        accepted: false,
        duplicate: false,
        reason: "workspace_policy_blocked",
        run_ids: [],
      })
    }

    return SignalResponse.parse({
      accepted: false,
      duplicate: false,
      reason: "signal_unregistered",
      run_ids: [],
    })
  }
}
