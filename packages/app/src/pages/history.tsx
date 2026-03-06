import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch as SolidSwitch } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { Persist, persisted } from "@/utils/persist"
import { loadHistoryOperations, loadHistoryRuns } from "./history-data"
import { applyDebugToggle, counters, duplicate, focusFromQuery, parseHistoryQuery, resolveDebug, type HistoryTab } from "./history-state"

const message = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Failed to load history."
}

const stamp = (value: number) => new Date(value).toLocaleString()

export default function History() {
  const sdk = useSDK()
  const server = useServer()
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const initial = parseHistoryQuery(location.search)

  const [prefs, setPrefs] = persisted(Persist.workspace(sdk.directory, "history.page"), createStore({ debug: false }))

  const [tab, setTab] = createSignal<HistoryTab>(initial.tab ?? (initial.operation_id ? "operations" : "runs"))
  const [debugOverride, setDebugOverride] = createSignal<boolean | undefined>(initial.debug)
  const [includeUser, setIncludeUser] = createSignal(false)
  const [focus, setFocus] = createSignal(focusFromQuery(initial))
  const [eventDetail, setEventDetail] = createSignal<string | undefined>()

  const [runsState, setRunsState] = createStore({
    items: [] as Awaited<ReturnType<typeof loadHistoryRuns>>["items"],
    next_cursor: null as string | null,
    endpoint: "",
    loading: false,
    loadingMore: false,
    error: "",
  })

  const [operationsState, setOperationsState] = createStore({
    items: [] as Awaited<ReturnType<typeof loadHistoryOperations>>["items"],
    next_cursor: null as string | null,
    endpoint: "",
    loading: false,
    loadingMore: false,
    error: "",
  })

  const [runsRefresh, setRunsRefresh] = createSignal(0)
  const [operationsRefresh, setOperationsRefresh] = createSignal(0)

  const workspace = createMemo(() => {
    const value = new URLSearchParams(location.search).get("workspace")
    if (!value) return
    const next = value.trim()
    if (!next) return
    return next
  })

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const showDebug = createMemo(() =>
    resolveDebug({
      persisted: prefs.debug,
      override: debugOverride(),
    }),
  )

  const count = createMemo(() => counters(runsState.items))

  const query = (input: { tab: HistoryTab; run_id?: string; operation_id?: string }) => {
    const value = new URLSearchParams(location.search)
    value.set("tab", input.tab)
    if (input.run_id) {
      value.set("run_id", input.run_id)
    }
    if (!input.run_id) {
      value.delete("run_id")
    }
    if (input.operation_id) {
      value.set("operation_id", input.operation_id)
    }
    if (!input.operation_id) {
      value.delete("operation_id")
    }
    const next = value.toString()
    navigate(`${location.pathname}${next ? `?${next}` : ""}`, { replace: true })
  }

  let runsID = 0
  const loadRuns = async (cursor?: string) => {
    const append = !!cursor
    const id = ++runsID

    if (append) setRunsState("loadingMore", true)
    if (!append) setRunsState("loading", true)

    const result = await loadHistoryRuns({
      baseUrl: sdk.url,
      directory: sdk.directory,
      auth: auth(),
      workspace: workspace(),
      include_debug: showDebug(),
      cursor,
    }).catch((error) => error)

    if (id !== runsID) return

    if (result instanceof Error) {
      setRunsState("error", message(result))
      if (append) setRunsState("loadingMore", false)
      if (!append) setRunsState("loading", false)
      return
    }

    setRunsState("error", "")
    setRunsState("endpoint", result.endpoint)
    setRunsState("next_cursor", result.next_cursor)

    if (append) {
      setRunsState("items", (items) => [...items, ...result.items])
      setRunsState("loadingMore", false)
      return
    }

    setRunsState("items", result.items)
    setRunsState("loading", false)
  }

  let operationsID = 0
  const loadOperations = async (cursor?: string) => {
    const append = !!cursor
    const id = ++operationsID

    if (append) setOperationsState("loadingMore", true)
    if (!append) setOperationsState("loading", true)

    const result = await loadHistoryOperations({
      baseUrl: sdk.url,
      directory: sdk.directory,
      auth: auth(),
      workspace: workspace(),
      include_debug: showDebug(),
      include_user: includeUser(),
      cursor,
    }).catch((error) => error)

    if (id !== operationsID) return

    if (result instanceof Error) {
      setOperationsState("error", message(result))
      if (append) setOperationsState("loadingMore", false)
      if (!append) setOperationsState("loading", false)
      return
    }

    setOperationsState("error", "")
    setOperationsState("endpoint", result.endpoint)
    setOperationsState("next_cursor", result.next_cursor)

    if (append) {
      setOperationsState("items", (items) => [...items, ...result.items])
      setOperationsState("loadingMore", false)
      return
    }

    setOperationsState("items", result.items)
    setOperationsState("loading", false)
  }

  const refreshRunsList = () => {
    setRunsState("items", [])
    setRunsState("next_cursor", null)
    setRunsState("loadingMore", false)
    setRunsState("error", "")
    setEventDetail(undefined)
    void loadRuns()
  }

  const refreshOperationsList = () => {
    setOperationsState("items", [])
    setOperationsState("next_cursor", null)
    setOperationsState("loadingMore", false)
    setOperationsState("error", "")
    void loadOperations()
  }

  createEffect(() => {
    if (tab() !== "runs") return
    showDebug()
    runsRefresh()
    workspace()
    refreshRunsList()
  })

  createEffect(() => {
    if (tab() !== "operations") return
    showDebug()
    includeUser()
    operationsRefresh()
    workspace()
    refreshOperationsList()
  })

  createEffect(() => {
    const target = focus()
    if (!target) return
    if (target.tab !== tab()) return

    const selector =
      target.tab === "runs"
        ? `[data-component=\"history-run-row\"][data-id=\"${target.id}\"]`
        : `[data-component=\"history-operation-row\"][data-id=\"${target.id}\"]`

    queueMicrotask(() => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return
      element.scrollIntoView({ block: "center" })
    })
  })

  const openOperation = (operation_id: string) => {
    setTab("operations")
    setFocus({ tab: "operations", id: operation_id })
    query({ tab: "operations", operation_id })
  }

  const openRun = (run_id: string) => {
    setTab("runs")
    setFocus({ tab: "runs", id: run_id })
    query({ tab: "runs", run_id })
  }

  const toggleDebug = (next: boolean) => {
    const result = applyDebugToggle({
      persisted: prefs.debug,
      override: debugOverride(),
      next,
    })

    setPrefs("debug", result.persisted)
    setDebugOverride(result.override)
  }

  return (
    <div data-page="history" class="size-full overflow-y-auto">
      <div class="mx-auto max-w-6xl p-6 flex flex-col gap-4">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <h1 class="text-16-medium text-text-strong">History</h1>
            <p class="text-13-regular text-text-weak">Runs and operations are listed with deterministic history ordering.</p>
            <Show when={tab() === "runs" && runsState.endpoint}>
              <p class="text-12-mono text-text-weak">source: <span>{runsState.endpoint}</span></p>
            </Show>
            <Show when={tab() === "operations" && operationsState.endpoint}>
              <p class="text-12-mono text-text-weak">source: <span>{operationsState.endpoint}</span></p>
            </Show>
          </div>
          <Button
            variant="ghost"
            data-component="history-refresh"
            onClick={() => {
              if (tab() === "runs") {
                setRunsRefresh((value) => value + 1)
                return
              }
              setOperationsRefresh((value) => value + 1)
            }}
          >
            Refresh
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-4 rounded-lg border border-border-weak-base bg-background-base px-4 py-3">
          <label class="flex items-center gap-2 text-13-regular text-text-strong" data-component="history-debug-toggle">
            <span>Show Debug Sessions</span>
            <Switch checked={showDebug()} onChange={toggleDebug} />
          </label>

          <Show when={tab() === "operations"}>
            <label class="flex items-center gap-2 text-13-regular text-text-strong" data-component="history-include-user-toggle">
              <span>Include User Edits</span>
              <Switch checked={includeUser()} onChange={setIncludeUser} />
            </label>
          </Show>

          <Show when={tab() === "runs"}>
            <div class="text-12-regular text-text-weak flex items-center gap-3">
              <span>
                Executions: <strong data-component="history-counter-runs" class="text-text-strong">{count().runs}</strong>
              </span>
              <span>
                Duplicate events: <strong data-component="history-counter-duplicates" class="text-text-strong">{count().duplicates}</strong>
              </span>
            </div>
          </Show>
        </div>

        <Tabs value={tab()}>
          <Tabs.List>
            <Tabs.Trigger
              value="runs"
              data-component="history-tab-trigger"
              data-tab="runs"
              onClick={() => {
                setTab("runs")
                setFocus(undefined)
                query({ tab: "runs" })
              }}
            >
              Runs
            </Tabs.Trigger>
            <Tabs.Trigger
              value="operations"
              data-component="history-tab-trigger"
              data-tab="operations"
              onClick={() => {
                setTab("operations")
                setFocus(undefined)
                query({ tab: "operations" })
              }}
            >
              Operations
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="runs" class="pt-4">
            <SolidSwitch>
              <Match when={runsState.loading}>
                <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">Loading run history...</div>
              </Match>
              <Match when={runsState.error}>
                <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
                  {runsState.error}
                </div>
              </Match>
              <Match when={runsState.items.length === 0}>
                <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">No run history was returned.</div>
              </Match>
              <Match when={true}>
                <div class="space-y-3">
                  <For each={runsState.items}>
                    {(item) => {
                      const isDuplicate = () => duplicate(item)
                      const focused = () => focus()?.tab === "runs" && focus()?.id === item.id

                      return (
                        <section
                          data-component="history-run-row"
                          data-id={item.id}
                          data-duplicate={isDuplicate() ? "true" : "false"}
                          data-focused={focused() ? "true" : "false"}
                          class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-3"
                          classList={{
                            "ring-1 ring-icon-info-base": focused(),
                            "bg-surface-warning-base/10": isDuplicate(),
                          }}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="space-y-1 min-w-0">
                              <p class="text-14-medium text-text-strong break-all">{item.id}</p>
                              <p class="text-12-regular text-text-weak">
                                {item.status} • {item.trigger_type} • {stamp(item.created_at)}
                              </p>
                            </div>
                            <Show when={item.workflow_id}>
                              <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                                {item.workflow_id}
                              </span>
                            </Show>
                          </div>

                          <div class="flex flex-wrap items-center gap-2">
                            <Show when={isDuplicate()}>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setFocus({ tab: "runs", id: item.id })
                                  if (eventDetail() === item.id) {
                                    setEventDetail(undefined)
                                    return
                                  }
                                  setEventDetail(item.id)
                                }}
                              >
                                {eventDetail() === item.id ? "Hide Event Details" : "Open Event Details"}
                              </Button>
                            </Show>

                            <Show when={!isDuplicate() && item.session_id}>
                              {(session_id) => (
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    navigate(`/${params.dir}/session/${session_id()}`)
                                  }}
                                >
                                  Open Run Session
                                </Button>
                              )}
                            </Show>

                            <Button
                              variant="ghost"
                              data-component="history-open-operation"
                              disabled={!item.operation_exists || !item.operation_id}
                              onClick={() => {
                                if (!item.operation_id) return
                                openOperation(item.operation_id)
                              }}
                            >
                              Open Operation
                            </Button>
                            <Show when={!item.operation_exists || !item.operation_id}>
                              <span
                                data-component="history-link-missing"
                                class="text-12-regular text-text-weak rounded-md border border-border-weak-base px-2 py-1"
                              >
                                Operation link missing
                              </span>
                            </Show>
                          </div>

                          <Show when={isDuplicate() && eventDetail() === item.id}>
                            <div class="rounded-md border border-border-weak-base bg-background-base p-3 text-12-regular text-text-strong">
                              <p>Duplicate event row (non-execution).</p>
                              <p class="text-text-weak">reason_code: {item.reason_code ?? "-"}</p>
                              <p class="text-text-weak">failure_code: {item.failure_code ?? "-"}</p>
                            </div>
                          </Show>
                        </section>
                      )
                    }}
                  </For>

                  <Show when={runsState.next_cursor}>
                    {(cursor) => (
                      <Button
                        variant="ghost"
                        data-component="history-load-more"
                        data-tab="runs"
                        onClick={() => {
                          if (runsState.loadingMore) return
                          void loadRuns(cursor())
                        }}
                      >
                        {runsState.loadingMore ? "Loading..." : "Load More"}
                      </Button>
                    )}
                  </Show>
                </div>
              </Match>
            </SolidSwitch>
          </Tabs.Content>

          <Tabs.Content value="operations" class="pt-4">
            <SolidSwitch>
              <Match when={operationsState.loading}>
                <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">Loading operation history...</div>
              </Match>
              <Match when={operationsState.error}>
                <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
                  {operationsState.error}
                </div>
              </Match>
              <Match when={operationsState.items.length === 0}>
                <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">No operation history was returned.</div>
              </Match>
              <Match when={true}>
                <div class="space-y-3">
                  <For each={operationsState.items}>
                    {(item) => {
                      const focused = () => focus()?.tab === "operations" && focus()?.id === item.id
                      return (
                        <section
                          data-component="history-operation-row"
                          data-id={item.id}
                          data-focused={focused() ? "true" : "false"}
                          class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-3"
                          classList={{
                            "ring-1 ring-icon-info-base": focused(),
                          }}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="space-y-1 min-w-0">
                              <p class="text-14-medium text-text-strong break-all">{item.id}</p>
                              <p class="text-12-regular text-text-weak">
                                {item.status} • {item.trigger_type} • {stamp(item.created_at)}
                              </p>
                            </div>
                            <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                              {item.provenance}
                            </span>
                          </div>

                          <div class="flex flex-wrap items-center gap-2">
                            <Button
                              variant="ghost"
                              data-component="history-open-run"
                              disabled={!item.run_exists}
                              onClick={() => {
                                if (!item.run_exists) return
                                openRun(item.run_id)
                              }}
                            >
                              Open Run
                            </Button>
                            <Show when={!item.run_exists}>
                              <span
                                data-component="history-link-missing"
                                class="text-12-regular text-text-weak rounded-md border border-border-weak-base px-2 py-1"
                              >
                                Run link missing
                              </span>
                            </Show>
                          </div>
                        </section>
                      )
                    }}
                  </For>

                  <Show when={operationsState.next_cursor}>
                    {(cursor) => (
                      <Button
                        variant="ghost"
                        data-component="history-load-more"
                        data-tab="operations"
                        onClick={() => {
                          if (operationsState.loadingMore) return
                          void loadOperations(cursor())
                        }}
                      >
                        {operationsState.loadingMore ? "Loading..." : "Load More"}
                      </Button>
                    )}
                  </Show>
                </div>
              </Match>
            </SolidSwitch>
          </Tabs.Content>
        </Tabs>
      </div>
    </div>
  )
}
