import { For, Show } from "solid-js"
import type { GraphStep } from "./graph-detail-data"

type GraphNodeState = {
  status: string
  skip_reason_code: string | null
}

function label(step: GraphStep) {
  if (step.kind === "agent_request") {
    return step.prompt?.source === "resource" ? `Prompt: ${step.prompt.resource_id}` : "Inline prompt"
  }
  if (step.kind === "script") {
    return step.script?.source === "resource" ? `Script: ${step.script.resource_id}` : "Inline script"
  }
  if (step.kind === "condition") {
    return step.when ? `${step.when.ref} ${step.when.op} ${JSON.stringify(step.when.value)}` : "Condition"
  }
  if (step.kind === "end") return `Result: ${step.result ?? "success"}`
  return step.kind
}

export function WorkflowGraph(props: {
  steps: GraphStep[]
  selected?: string
  nodes?: Record<string, GraphNodeState | undefined>
  onSelect?: (step: GraphStep) => void
}) {
  const render = (steps: GraphStep[], branch?: "then" | "else", depth = 0) => (
    <div class="space-y-3">
      <Show when={branch}>
        {(value) => (
          <div
            data-component="graph-branch"
            data-branch={value()}
            class="rounded-md border border-dashed border-border-weak-base px-3 py-2 text-12-medium uppercase tracking-[0.16em] text-text-weak"
            style={{ "margin-left": `${depth * 16}px` }}
          >
            {value()}
          </div>
        )}
      </Show>
      <For each={steps}>
        {(step) => {
          const state = () => props.nodes?.[step.id]
          const dimmed = () => state()?.status === "skipped" && state()?.skip_reason_code === "branch_not_taken"
          return (
            <div class="space-y-3">
              <button
                type="button"
                data-component="graph-node"
                data-node-id={step.id}
                data-kind={step.kind}
                data-status={state()?.status ?? ""}
                data-skip-reason={state()?.skip_reason_code ?? ""}
                class="w-full rounded-xl border border-border-weak-base bg-background-base px-4 py-3 text-left transition hover:border-border-strong-base"
                classList={{
                  "opacity-60": dimmed(),
                  "ring-1 ring-icon-info-base": props.selected === step.id,
                }}
                style={{ "margin-left": `${depth * 16}px` }}
                onClick={() => props.onSelect?.(step)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <div class="flex items-center gap-2">
                      <span class="rounded-md border border-border-weak-base px-2 py-0.5 text-11-medium uppercase tracking-[0.12em] text-text-weak">
                        {step.kind}
                      </span>
                      <span class="text-12-mono text-text-weak">{step.id}</span>
                    </div>
                    <div class="text-14-medium text-text-strong">{step.title}</div>
                    <div class="text-12-regular text-text-weak">{label(step)}</div>
                  </div>
                  <Show when={state()}>
                    {(value) => (
                      <div class="shrink-0 text-right">
                        <div class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-strong">
                          {value().status}
                        </div>
                        <Show when={value().skip_reason_code}>
                          {(reason) => <div class="pt-1 text-11-regular text-text-weak">{reason()}</div>}
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              </button>

              <Show when={step.kind === "condition"}>
                <div class="space-y-3">
                  {render(step.then ?? [], "then", depth + 1)}
                  {render(step.else ?? [], "else", depth + 1)}
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )

  return (
    <div data-component="workflow-graph" class="space-y-3">
      {render(props.steps)}
    </div>
  )
}
