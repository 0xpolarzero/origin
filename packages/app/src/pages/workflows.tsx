import { Button } from "@opencode-ai/ui/button"
import { createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { loadValidationList, type ValidationIssue, type ValidationItem } from "./workflow-validation"

const fallbackIssue = (item: ValidationItem): ValidationIssue => ({
  code: "validation.unknown",
  path: item.path,
  message: "Non-runnable definition returned without validation details.",
})

const issueRows = (item: ValidationItem) => (item.errors.length > 0 ? item.errors : [fallbackIssue(item)])

const stateLabel = (runnable: boolean) => (runnable ? "Runnable" : "Non-runnable")

const stateClass = (runnable: boolean) =>
  runnable
    ? "border border-border-weak-base bg-background-base text-icon-success-base"
    : "border border-border-weak-base bg-background-base text-icon-critical-base"

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Failed to load workflows."
}

export default function Workflows() {
  const sdk = useSDK()
  const server = useServer()

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const input = createMemo(() => ({
    view: "workflow" as const,
    baseUrl: sdk.url,
    directory: sdk.directory,
    auth: auth(),
  }))

  const [list, controls] = createResource(input, loadValidationList)

  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto max-w-5xl p-6 flex flex-col gap-4">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <h1 class="text-16-medium text-text-strong">Workflows</h1>
            <p class="text-13-regular text-text-weak">
              Definitions are loaded from backend validation contracts and marked runnable or non-runnable.
            </p>
            <Show when={list()?.endpoint}>
              {(value) => (
                <p class="text-12-mono text-text-weak">
                  source: <span>{value()}</span>
                </p>
              )}
            </Show>
          </div>
          <Button variant="ghost" onClick={() => controls.refetch()}>
            Refresh
          </Button>
        </div>

        <Switch>
          <Match when={list.loading}>
            <div data-component="validation-loading" class="rounded-lg border border-border-weak-base p-4 text-13-regular">
              Loading workflow validation...
            </div>
          </Match>
          <Match when={list.error}>
            <div
              data-component="validation-load-error"
              class="rounded-lg border border-border-weak-base p-4 text-13-regular text-icon-critical-base"
            >
              {errorMessage(list.error)}
            </div>
          </Match>
          <Match when={(list()?.items.length ?? 0) === 0}>
            <div data-component="validation-empty" class="rounded-lg border border-border-weak-base p-4 text-13-regular">
              No workflow definitions were returned.
            </div>
          </Match>
          <Match when={true}>
            <div class="space-y-4">
              <For each={list()?.items ?? []}>
                {(item) => (
                  <section
                    data-component="validation-resource-row"
                    data-view="workflow"
                    data-id={item.id}
                    data-runnable={item.runnable ? "true" : "false"}
                    class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-3"
                  >
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <p class="text-14-medium text-text-strong truncate">{item.name}</p>
                        <p class="text-12-regular text-text-weak">{item.kind}</p>
                        <p class="text-12-mono text-text-weak break-all">{item.path}</p>
                      </div>
                      <div
                        data-component="validation-state"
                        data-runnable={item.runnable ? "true" : "false"}
                        class={`shrink-0 rounded-md px-2.5 py-1 text-12-medium ${stateClass(item.runnable)}`}
                      >
                        {stateLabel(item.runnable)}
                      </div>
                    </div>

                    <Show
                      when={!item.runnable}
                      fallback={<p class="text-12-regular text-text-weak">No validation errors.</p>}
                    >
                      <div class="overflow-x-auto rounded-md border border-border-weak-base">
                        <table class="min-w-full text-left">
                          <thead>
                            <tr class="bg-background-base text-12-medium text-text-weak">
                              <th class="px-3 py-2">Code</th>
                              <th class="px-3 py-2">Path</th>
                              <th class="px-3 py-2">Message</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={issueRows(item)}>
                              {(issue) => (
                                <tr
                                  data-component="validation-error-row"
                                  data-code={issue.code}
                                  data-path={issue.path}
                                  class="border-t border-border-weak-base"
                                >
                                  <td class="px-3 py-2 text-12-mono text-text-strong">{issue.code}</td>
                                  <td class="px-3 py-2 text-12-mono text-text-weak">{issue.path}</td>
                                  <td class="px-3 py-2 text-12-regular text-text-strong">{issue.message}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </Show>
                  </section>
                )}
              </For>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
