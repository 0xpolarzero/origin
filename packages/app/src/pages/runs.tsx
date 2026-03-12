import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch as SolidSwitch } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { loadHistoryRuns, type HistoryRun } from "./history-data"

const stamp = (value: number | null) => (value ? new Date(value).toLocaleString() : "-")

const text = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return "Failed to load runs."
}

export default function Runs() {
  const sdk = useSDK()
  const server = useServer()
  const navigate = useNavigate()
  const params = useParams()
  const [debug, setDebug] = createSignal(false)
  const [tick, setTick] = createSignal(0)
  const [state, setState] = createStore({
    items: [] as HistoryRun[],
    endpoint: "",
    next: null as string | null,
    hidden: 0,
    loading: true,
    more: false,
    err: "",
  })
  let seq = 0

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const args = createMemo(() => ({
    baseUrl: sdk.url,
    directory: sdk.directory,
    auth: auth(),
    debug: debug(),
    tick: tick(),
  }))

  const openRun = (id: string) => navigate(`/${params.dir}/runs/${id}`)
  const openHistory = (item: HistoryRun) =>
    navigate(`/${params.dir}/history?tab=runs&run_id=${encodeURIComponent(item.id)}&workspace=${encodeURIComponent(item.workspace_id)}`)

  const load = async (cursor?: string, id = seq) => {
    const more = !!cursor
    if (more) setState("more", true)
    if (!more) setState("loading", true)

    try {
      const result = await loadHistoryRuns({
        baseUrl: args().baseUrl,
        directory: args().directory,
        auth: args().auth,
        include_debug: args().debug,
        cursor,
      })

      if (id !== seq) return

      setState("endpoint", result.endpoint)
      setState("next", result.next_cursor)
      setState("hidden", result.hidden_debug_count)
      setState("err", "")

      if (more) {
        setState("items", (items) => [...items, ...result.items])
        setState("more", false)
        return
      }

      setState("items", result.items)
      setState("loading", false)
    } catch (err) {
      if (id !== seq) return
      setState("err", text(err))
      if (more) setState("more", false)
      if (!more) setState("loading", false)
    }
  }

  createEffect(() => {
    args()
    const id = ++seq
    setState("items", [])
    setState("endpoint", "")
    setState("next", null)
    setState("hidden", 0)
    setState("more", false)
    setState("err", "")
    void load(undefined, id)
  })

  return (
    <div data-page="runs" class="size-full overflow-y-auto">
      <div class="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-1">
            <h1 class="text-16-medium text-text-strong">Runs</h1>
            <p class="text-13-regular text-text-weak">Workflow executions for the current workspace.</p>
            <Show when={state.endpoint}>
              {(value) => (
                <p class="text-12-mono text-text-weak">
                  source: <span>{value()}</span>
                </p>
              )}
            </Show>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-2 rounded-lg border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong">
              <span>Show Debug Sessions</span>
              <Switch checked={debug()} onChange={setDebug} />
            </label>
            <Button variant="ghost" onClick={() => navigate(`/${params.dir}/history?tab=runs`)}>
              Open History
            </Button>
            <Button variant="ghost" onClick={() => setTick((value) => value + 1)}>
              Refresh
            </Button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 rounded-lg border border-border-weak-base bg-background-base px-4 py-3 text-12-regular text-text-weak">
          <span>
            Visible runs: <strong class="text-text-strong">{state.items.length}</strong>
          </span>
          <Show when={!debug() && state.hidden > 0}>
            <span data-component="runs-hidden-debug-count">
              Hidden debug sessions: <strong class="text-text-strong">{state.hidden}</strong>
            </span>
          </Show>
        </div>

        <SolidSwitch>
          <Match when={state.loading}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">Loading runs...</div>
          </Match>
          <Match when={state.err}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
              {state.err}
            </div>
          </Match>
          <Match when={state.items.length === 0}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">No runs were returned.</div>
          </Match>
          <Match when={true}>
            <div class="space-y-3">
              <For each={state.items}>
                {(item) => (
                  <section
                    data-component="runs-row"
                    data-id={item.id}
                    data-debug={item.debug ? "true" : "false"}
                    data-status={item.status}
                    class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-3"
                    classList={{ "bg-surface-warning-base/10": item.status === "skipped" }}
                  >
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0 space-y-1">
                        <p class="text-14-medium text-text-strong break-all">{item.id}</p>
                        <p class="text-12-regular text-text-weak">
                          {item.status} • {item.trigger_type} • {stamp(item.created_at)}
                        </p>
                        <p class="text-12-mono text-text-weak break-all">{item.workspace_id}</p>
                      </div>

                      <div class="flex flex-wrap justify-end gap-2">
                        <Show when={item.workflow_id}>
                          {(id) => (
                            <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                              {id()}
                            </span>
                          )}
                        </Show>
                        <Show when={item.debug}>
                          <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                            Debug
                          </span>
                        </Show>
                      </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                      <Show when={item.status !== "skipped"}>
                        <Button variant="ghost" onClick={() => openRun(item.id)}>
                          Open Run
                        </Button>
                      </Show>
                      <Button variant="ghost" onClick={() => openHistory(item)}>
                        Open History
                      </Button>
                      <Show when={item.workflow_id}>
                        {(id) => (
                          <Button variant="ghost" onClick={() => navigate(`/${params.dir}/workflows/${id()}`)}>
                            Open Workflow
                          </Button>
                        )}
                      </Show>
                    </div>
                  </section>
                )}
              </For>

              <Show when={state.next}>
                {(cursor) => (
                  <Button
                    variant="ghost"
                    data-component="runs-load-more"
                    onClick={() => {
                      if (state.more) return
                      void load(cursor(), seq)
                    }}
                  >
                    {state.more ? "Loading..." : "Load More"}
                  </Button>
                )}
              </Show>
            </div>
          </Match>
        </SolidSwitch>
      </div>
    </div>
  )
}
