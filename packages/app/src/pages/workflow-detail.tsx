import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { loadWorkflowDetail } from "./graph-detail-data"
import { WorkflowGraph } from "./workflow-graph"

const stamp = (value: number | null) => {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Failed to load workflow detail."
}

export default function WorkflowDetailPage() {
  const sdk = useSDK()
  const server = useServer()
  const params = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const tab = createMemo(() => {
    const value = search.tab
    if (value === "runs" || value === "resources") return value
    return "design"
  })

  const input = createMemo(() => ({
    baseUrl: sdk.url,
    directory: sdk.directory,
    workflow_id: params.workflowId ?? "",
    auth: auth(),
  }))

  const [detail, controls] = createResource(input, loadWorkflowDetail)

  return (
    <div data-page="workflow-detail" class="size-full overflow-y-auto">
      <div class="mx-auto max-w-6xl p-6 space-y-6">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <Show when={detail()?.item}>
              {(item) => (
                <>
                  <div class="flex items-center gap-2">
                    <h1 class="text-18-medium text-text-strong">{item().workflow?.name ?? item().id}</h1>
                    <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                      {item().runnable ? "Runnable" : "Non-runnable"}
                    </span>
                  </div>
                  <p class="text-12-mono text-text-weak break-all">{item().file}</p>
                  <Show when={detail()?.revision_head}>
                    {(revision) => (
                      <p class="text-12-regular text-text-weak">
                        Revision {revision().id.slice(0, 8)} • {revision().content_hash.slice(0, 12)}
                      </p>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </div>
          <Button variant="ghost" onClick={() => controls.refetch()}>
            Refresh
          </Button>
        </div>

        <Switch>
          <Match when={detail.loading}>
            <div class="rounded-xl border border-border-weak-base p-4 text-13-regular">Loading workflow detail...</div>
          </Match>
          <Match when={detail.error}>
            <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
              {errorMessage(detail.error)}
            </div>
          </Match>
          <Match when={detail()}>
            {(value) => (
              <>
                <Tabs value={tab()} class="space-y-4">
                  <Tabs.List>
                    <Tabs.Trigger
                      value="design"
                      data-component="workflow-detail-tab"
                      data-tab="design"
                      onClick={() => setSearch({ tab: "design" })}
                    >
                      Design
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="runs"
                      data-component="workflow-detail-tab"
                      data-tab="runs"
                      onClick={() => setSearch({ tab: "runs" })}
                    >
                      Runs
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="resources"
                      data-component="workflow-detail-tab"
                      data-tab="resources"
                      onClick={() => setSearch({ tab: "resources" })}
                    >
                      Resources
                    </Tabs.Trigger>
                  </Tabs.List>

                  <Tabs.Content value="design" class="space-y-4">
                    <Show
                      when={value().item.workflow}
                      fallback={
                        <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-text-weak">
                          No live graph is available because the workflow definition did not parse cleanly.
                        </div>
                      }
                    >
                      {(workflow) => (
                        <section class="rounded-xl border border-border-weak-base bg-background-base p-4">
                          <div class="pb-4">
                            <div class="text-14-medium text-text-strong">{workflow().name}</div>
                            <Show when={workflow().description}>
                              {(description) => <div class="text-13-regular text-text-weak">{description()}</div>}
                            </Show>
                          </div>
                          <WorkflowGraph steps={workflow().steps} />
                        </section>
                      )}
                    </Show>

                    <Show when={value().item.errors.length > 0}>
                      <section class="rounded-xl border border-border-weak-base bg-background-base p-4">
                        <div class="pb-3 text-14-medium text-text-strong">Validation</div>
                        <div class="space-y-2">
                          <For each={value().item.errors}>
                            {(issue) => (
                              <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                <div class="text-12-mono text-text-strong">{issue.code}</div>
                                <div class="text-12-mono text-text-weak">{issue.path}</div>
                                <div class="text-12-regular text-text-strong">{issue.message}</div>
                              </div>
                            )}
                          </For>
                        </div>
                      </section>
                    </Show>
                  </Tabs.Content>

                  <Tabs.Content value="runs" class="space-y-3">
                    <Show
                      when={value().runs.length > 0}
                      fallback={
                        <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-text-weak">
                          No runs have been captured for this workflow yet.
                        </div>
                      }
                    >
                      <For each={value().runs}>
                        {(run) => (
                          <section
                            data-component="workflow-detail-run-row"
                            data-run-id={run.id}
                            class="rounded-xl border border-border-weak-base bg-background-base p-4"
                          >
                            <div class="flex items-start justify-between gap-4">
                              <div class="space-y-1">
                                <div class="text-14-medium text-text-strong">{run.id}</div>
                                <div class="text-12-regular text-text-weak">
                                  {run.status} • {run.workspace_id} • {stamp(run.created_at)}
                                </div>
                                <div class="text-12-regular text-text-weak">
                                  started: {stamp(run.started_at)} • finished: {stamp(run.finished_at)}
                                </div>
                              </div>
                              <Button variant="ghost" onClick={() => navigate(`/${params.dir}/runs/${run.id}`)}>
                                Open Run
                              </Button>
                            </div>
                          </section>
                        )}
                      </For>
                    </Show>
                  </Tabs.Content>

                  <Tabs.Content value="resources" class="space-y-3">
                    <Show
                      when={value().resources.length > 0}
                      fallback={
                        <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-text-weak">
                          This workflow does not declare resources.
                        </div>
                      }
                    >
                      <For each={value().resources}>
                        {(resource) => (
                          <section
                            data-component="workflow-detail-resource-row"
                            data-resource-id={resource.id}
                            class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-3"
                          >
                            <div class="flex items-start justify-between gap-3">
                              <div class="space-y-1">
                                <div class="flex items-center gap-2">
                                  <span class="rounded-md border border-border-weak-base px-2 py-0.5 text-11-medium uppercase tracking-[0.12em] text-text-weak">
                                    {resource.source}
                                  </span>
                                  <span class="text-14-medium text-text-strong">{resource.id}</span>
                                </div>
                                <div class="text-12-regular text-text-weak">
                                  {resource.kind} • {"path" in resource ? resource.path : resource.item_id}
                                </div>
                                <div class="text-12-regular text-text-weak">
                                  Used by: {resource.used_by.length ? resource.used_by.join(", ") : "none"}
                                </div>
                              </div>
                              <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                                {resource.errors.length ? `${resource.errors.length} issue(s)` : "valid"}
                              </span>
                            </div>

                            <Show when={resource.errors.length > 0}>
                              <div class="space-y-2">
                                <For each={resource.errors}>
                                  {(issue) => (
                                    <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                      <div class="text-12-mono text-text-strong">{issue.code}</div>
                                      <div class="text-12-mono text-text-weak">{issue.path}</div>
                                      <div class="text-12-regular text-text-strong">{issue.message}</div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </section>
                        )}
                      </For>
                    </Show>
                  </Tabs.Content>
                </Tabs>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
