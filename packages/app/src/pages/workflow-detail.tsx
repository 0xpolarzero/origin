import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch as Toggle } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { TextField } from "@opencode-ai/ui/text-field"
import { createEffect, createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import {
  copyWorkflow,
  hideWorkflow,
  loadWorkflowDetail,
  loadWorkflowHistory,
  loadRunDetail,
  openWorkflowSession,
  rerunWorkflowRun,
  saveWorkflow,
  startWorkflowRun,
  type GraphScalar,
  type GraphStep,
  type GraphManualInput,
  type GraphWorkflowSchema,
  validateWorkflowRun,
} from "./graph-detail-data"
import { WorkflowGraph } from "./workflow-graph"

const stamp = (value: number | null) => {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2)

const tabs = new Set(["design", "authoring", "run", "history", "runs", "resources"])

const queryText = (value: string | string[] | undefined) => (typeof value === "string" ? value : value?.[0])

const clone = <T,>(value: T): T => structuredClone(value)

const scalarText = (value: GraphScalar) => {
  if (value === null) return "null"
  return `${value}`
}

const parseScalar = (value: string): GraphScalar => {
  const raw = value.trim()
  if (!raw || raw === "null") return null
  if (raw === "true") return true
  if (raw === "false") return false
  const num = Number(raw)
  if (Number.isFinite(num) && `${num}` === raw) return num
  return value
}

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Failed to load workflow detail."
}

const findAll = (steps: GraphStep[]): GraphStep[] =>
  steps.flatMap((step) =>
    step.kind === "condition" ? [step, ...findAll(step.then ?? []), ...findAll(step.else ?? [])] : [step],
  )

const patchStep = (steps: GraphStep[], id: string, fn: (step: GraphStep) => GraphStep): GraphStep[] =>
  steps.map((step) => {
    if (step.id === id) return fn(step)
    if (step.kind !== "condition") return step
    return {
      ...step,
      then: patchStep(step.then ?? [], id, fn),
      else: patchStep(step.else ?? [], id, fn),
    }
  })

const editLabel = (value: string) => {
  if (value === "graph_edit") return "Graph edit"
  if (value === "node_edit") return "Node edit"
  if (value === "duplicate") return "Duplicate"
  if (value === "hide") return "Hidden"
  return "Builder"
}

const seeded = (items: GraphManualInput[], seed?: Record<string, unknown>) =>
  items.reduce(
    (acc, item) => {
      const value = seed?.[item.key]
      if (value !== undefined) {
        acc[item.key] = value
        return acc
      }
      if (item.default !== undefined) {
        acc[item.key] = item.default
        return acc
      }
      if (item.type === "boolean") acc[item.key] = false
      return acc
    },
    {} as Record<string, unknown>,
  )

const option = (item: GraphManualInput, value: unknown) =>
  item.options?.find((row) => Object.is(row.value, value)) ??
  item.options?.find((row) => Object.is(row.value, item.default))

const collect = (items: GraphManualInput[], vals: Record<string, unknown>) =>
  items.reduce(
    (acc, item) => {
      if (acc.err) return acc
      const value = vals[item.key]
      if (item.type === "boolean") {
        if (value !== undefined || item.required || item.default !== undefined) acc.values[item.key] = value === true
        return acc
      }
      if (item.type === "select") {
        if (value === undefined || value === null || value === "") {
          if (item.required) acc.err = `${item.label} is required.`
          return acc
        }
        acc.values[item.key] = value
        return acc
      }
      const text = typeof value === "string" ? value : value === undefined || value === null ? "" : `${value}`
      if (!text.trim()) {
        if (item.required) acc.err = `${item.label} is required.`
        return acc
      }
      if (item.type === "number") {
        const next = Number(text)
        if (!Number.isFinite(next)) {
          acc.err = `${item.label} must be a number.`
          return acc
        }
        acc.values[item.key] = next
        return acc
      }
      acc.values[item.key] = text
      return acc
    },
    { values: {} as Record<string, unknown>, err: "" },
  )

export default function WorkflowDetailPage() {
  const sdk = useSDK()
  const server = useServer()
  const params = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()

  const [state, setState] = createStore({
    rev: "",
    wf: undefined as GraphWorkflowSchema | undefined,
    note: "",
    dirty: false,
    saving: false,
    err: "",
    ok: "",
    ses_err: "",
    ses_busy: "" as "" | "builder" | "node_edit",
  })
  const [ops, setOps] = createStore({
    busy: "" as "" | "copy" | "hide" | "validate",
    err: "",
    ok: "",
  })
  const [run, setRun] = createStore({
    key: "",
    vals: {} as Record<string, unknown>,
    validated: false,
    validating: false,
    starting: false,
    err: "",
    ok: "",
  })

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const tab = createMemo(() => {
    const value = queryText(search.tab)
    return value && tabs.has(value) ? value : "design"
  })
  const changeTab = (next: string) => {
    if (!tabs.has(next)) return
    setSearch({ tab: next })
  }

  const node = createMemo(() => queryText(search.node) ?? "")
  const prefill_id = createMemo(() => queryText(search.prefill_run) ?? "")

  const args = createMemo(() => ({
    baseUrl: sdk.url,
    directory: sdk.directory,
    workflow_id: params.workflowId ?? "",
    auth: auth(),
  }))

  const [detail, ctl] = createResource(args, loadWorkflowDetail)
  const [prefill] = createResource(
    createMemo(() => {
      const run_id = prefill_id()
      if (!run_id) return
      return {
        baseUrl: sdk.url,
        directory: sdk.directory,
        run_id,
        auth: auth(),
      }
    }),
    loadRunDetail,
  )
  const [hist, hctl] = createResource(
    createMemo(() => {
      const id = detail()?.item.id
      if (!id) return
      return {
        baseUrl: sdk.url,
        directory: sdk.directory,
        workflow_id: id,
        auth: auth(),
      }
    }),
    loadWorkflowHistory,
  )

  createEffect(() => {
    const value = detail()
    const wf = value?.item.workflow
    const rev = value?.revision_head?.id ?? `${value?.item.id ?? ""}:${value?.item.file ?? ""}`
    if (!wf || !rev) return
    if (state.rev === rev) return
    setState({
      rev,
      wf: clone(wf),
      note: "",
      dirty: false,
      saving: false,
      err: "",
      ok: "",
      ses_err: "",
      ses_busy: "",
    })
  })

  createEffect(() => {
    const wf = detail()?.item.workflow
    if (!wf) return
    if (prefill_id() && !prefill() && !prefill.error) return
    const key = `${detail()?.revision_head?.id ?? detail()?.item.file ?? detail()?.item.id}:${prefill_id()}:${prefill()?.run.id ?? ""}`
    if (run.key === key) return
    setRun({
      key,
      vals: seeded(wf.inputs, (prefill()?.snapshot.input_json as Record<string, unknown> | undefined) ?? undefined),
      validated: false,
      validating: false,
      starting: false,
      err: "",
      ok: prefill()?.run.id ? `Prefilled inputs from run ${prefill()!.run.id}.` : "",
    })
  })

  const picked = createMemo(() => {
    const id = node()
    const wf = state.wf
    if (!id || !wf) return
    return findAll(wf.steps).find((step) => step.id === id)
  })

  const nodeStates = createMemo(() =>
    Object.fromEntries(
      findAll(state.wf?.steps ?? []).map((step) => [
        step.id,
        {
          status: step.id === node() ? "editing" : "",
          skip_reason_code: null,
        },
      ]),
    ),
  )

  const put = (fn: (wf: GraphWorkflowSchema) => GraphWorkflowSchema) => {
    if (!state.wf) return
    setState("wf", fn(state.wf))
    setState("dirty", true)
    setState("ok", "")
  }

  const pick = (id: string) => setSearch({ tab: "authoring", node: id })

  const openRole = async (role: "builder" | "node_edit") => {
    const workflow_id = detail()?.item.id
    if (!workflow_id) return
    if (role === "node_edit" && !picked()) return

    setState("ses_err", "")
    setState("ses_busy", role)

    try {
      const out = await openWorkflowSession({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        workflow_id,
        role,
        node_id: role === "node_edit" ? picked()?.id : undefined,
      })
      navigate(`/${params.dir}/session/${out.session_id}`)
    } catch (err) {
      setState("ses_err", errorMessage(err))
    } finally {
      setState("ses_busy", "")
    }
  }

  const reset = () => {
    const wf = detail()?.item.workflow
    if (!wf) return
    setState("wf", clone(wf))
    setState("note", "")
    setState("dirty", false)
    setState("err", "")
    setState("ok", "")
  }

  const save = async () => {
    const wf = state.wf
    const workflow_id = detail()?.item.id
    if (!wf || !workflow_id) return

    setState("saving", true)
    setState("err", "")
    setState("ok", "")

    try {
      const next = await saveWorkflow({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        workflow_id,
        workflow: wf,
        file: detail()?.item.file,
        note: state.note.trim() || null,
        node_id: picked()?.id ?? null,
      })
      ctl.mutate(next)
      await hctl.refetch()
      setState("wf", next.item.workflow ? clone(next.item.workflow) : wf)
      setState("rev", next.revision_head?.id ?? state.rev)
      setState("note", "")
      setState("dirty", false)
      setState("ok", "Saved canonical workflow files.")
    } catch (err) {
      setState("err", errorMessage(err))
    } finally {
      setState("saving", false)
    }
  }

  const setField = (key: string, value: unknown) => {
    setRun("vals", key, value)
    setRun("validated", false)
    setRun("err", "")
    setRun("ok", "")
  }

  const check = () => {
    const items = detail()?.item.workflow?.inputs ?? []
    return collect(items, run.vals)
  }

  const validateRun = async () => {
    const workflow_id = detail()?.item.id
    if (!workflow_id) return false
    const next = check()
    if (next.err) {
      setRun("err", next.err)
      setRun("ok", "")
      setRun("validated", false)
      return false
    }

    setRun("validating", true)
    setRun("err", "")
    setRun("ok", "")

    try {
      const value = await validateWorkflowRun({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        workflow_id,
      })
      setRun("validated", true)
      setRun("ok", `Workflow validated in workspace ${value.workspace_id}. Review inputs and start when ready.`)
      return true
    } catch (err) {
      setRun("validated", false)
      setRun("err", errorMessage(err))
      return false
    } finally {
      setRun("validating", false)
    }
  }

  const startRun = async () => {
    const workflow_id = detail()?.item.id
    if (!workflow_id) return
    if (!run.validated) {
      await validateRun()
      return
    }
    const next = check()
    if (next.err) {
      setRun("err", next.err)
      return
    }

    setRun("starting", true)
    setRun("err", "")

    try {
      const value = await startWorkflowRun({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        workflow_id,
        inputs: next.values,
      })
      navigate(`/${params.dir}/runs/${value.id}`)
    } catch (err) {
      setRun("err", errorMessage(err))
    } finally {
      setRun("starting", false)
    }
  }

  const act = async (kind: "copy" | "hide" | "validate") => {
    const workflow_id = detail()?.item.id
    if (!workflow_id) return
    setOps({
      busy: kind,
      err: "",
      ok: "",
    })

    try {
      if (kind === "copy") {
        const value = await copyWorkflow({
          baseUrl: sdk.url,
          directory: sdk.directory,
          auth: auth(),
          workflow_id,
        })
        navigate(`/${params.dir}/workflows/${value.workflow_id}?tab=authoring`)
        return
      }
      if (kind === "hide") {
        await hideWorkflow({
          baseUrl: sdk.url,
          directory: sdk.directory,
          auth: auth(),
          workflow_id,
        })
        navigate(`/${params.dir}/workflows`)
        return
      }
      const value = await ctl.refetch()
      setOps("ok", value?.item.runnable ? "Workflow definition is runnable." : `Workflow has ${value?.item.errors.length ?? 0} issue(s).`)
    } catch (err) {
      setOps("err", errorMessage(err))
    } finally {
      setOps("busy", "")
    }
  }

  return (
    <div data-page="workflow-detail" class="size-full overflow-y-auto">
      <div class="mx-auto max-w-7xl p-6 space-y-6">
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
          <div class="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setSearch({ tab: "run", prefill_run: undefined })}>
              Run Workflow
            </Button>
            <Button variant="ghost" onClick={() => void act("validate")} disabled={ops.busy !== ""}>
              {ops.busy === "validate" ? "Validating..." : "Validate"}
            </Button>
            <Button variant="ghost" onClick={() => void act("copy")} disabled={ops.busy !== ""}>
              {ops.busy === "copy" ? "Duplicating..." : "Duplicate"}
            </Button>
            <Button variant="ghost" onClick={() => void act("hide")} disabled={ops.busy !== ""}>
              {ops.busy === "hide" ? "Hiding..." : "Hide"}
            </Button>
            <Button
              variant="ghost"
              data-action="open-builder-session"
              onClick={() => {
                void openRole("builder")
              }}
              disabled={state.ses_busy === "builder"}
            >
              {state.ses_busy === "builder" ? "Opening builder..." : "Open Builder Session"}
            </Button>
            <Button variant="ghost" onClick={() => ctl.refetch()}>
              Refresh
            </Button>
          </div>
        </div>

        <Show when={ops.err}>
          {(value) => (
            <div class="rounded-xl border border-border-weak-base bg-background-base p-4 text-13-regular text-icon-critical-base">
              {value()}
            </div>
          )}
        </Show>
        <Show when={ops.ok}>
          {(value) => (
            <div class="rounded-xl border border-border-weak-base bg-background-base p-4 text-13-regular text-icon-success-base">
              {value()}
            </div>
          )}
        </Show>

        <Show when={detail()?.item.errors.length}>
          <div class="rounded-xl border border-border-weak-base bg-background-base p-4 text-13-regular text-icon-critical-base">
            Validation issues are currently blocking runnable workflow operations. Authoring and history remain available so the
            canonical definition can be repaired.
          </div>
        </Show>

        <Show when={state.ses_err}>
          {(value) => (
            <div class="rounded-xl border border-border-weak-base bg-background-base p-4 text-13-regular text-icon-critical-base">
              {value()}
            </div>
          )}
        </Show>

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
              <Tabs value={tab()} onChange={changeTab} class="space-y-4">
                <Tabs.List class="flex flex-wrap gap-2">
                  <Tabs.Trigger value="design" data-component="workflow-detail-tab" data-tab="design" onClick={() => setSearch({ tab: "design" })}>
                    Design
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    value="authoring"
                    data-component="workflow-detail-tab"
                    data-tab="authoring"
                    onClick={() => setSearch({ tab: "authoring", node: node() || undefined })}
                  >
                    Authoring
                  </Tabs.Trigger>
                  <Tabs.Trigger value="run" data-component="workflow-detail-tab" data-tab="run" onClick={() => setSearch({ tab: "run" })}>
                    Run
                  </Tabs.Trigger>
                  <Tabs.Trigger value="history" data-component="workflow-detail-tab" data-tab="history" onClick={() => setSearch({ tab: "history" })}>
                    Edit History
                  </Tabs.Trigger>
                  <Tabs.Trigger value="runs" data-component="workflow-detail-tab" data-tab="runs" onClick={() => setSearch({ tab: "runs" })}>
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

                <Tabs.Content value="authoring" class="space-y-4">
                  <Show
                    when={state.wf}
                    fallback={
                      <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-3">
                        <div class="text-14-medium text-text-strong">Authoring blocked</div>
                        <div class="text-13-regular text-text-weak">
                          Canonical workflow data is unavailable because the current definition did not parse into an editable graph.
                        </div>
                        <div class="flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              void openRole("builder")
                            }}
                          >
                            Continue in Builder Session
                          </Button>
                          <Button variant="ghost" onClick={() => setSearch({ tab: "history" })}>
                            Review edit history
                          </Button>
                        </div>
                      </section>
                    }
                  >
                    {(wf) => (
                      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
                        <div class="space-y-6">
                          <section data-component="workflow-authoring" class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div class="text-14-medium text-text-strong">Canonical workflow data</div>
                                <div class="text-12-regular text-text-weak">
                                  Saves write directly back to {value().item.file} and append workflow edit history.
                                </div>
                              </div>
                              <div class="flex flex-wrap gap-2">
                                <Button variant="ghost" onClick={reset} disabled={!state.dirty || state.saving}>
                                  Discard
                                </Button>
                                <Button data-action="save-workflow" onClick={() => void save()} disabled={!state.dirty || state.saving}>
                                  {state.saving ? "Saving..." : "Save workflow"}
                                </Button>
                              </div>
                            </div>

                            <div class="grid gap-4 md:grid-cols-2">
                              <TextField
                                label="Workflow name"
                                value={wf().name}
                                onChange={(next) =>
                                  put((item) => ({
                                    ...item,
                                    name: next,
                                  }))
                                }
                              />
                              <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                <div class="text-12-medium text-text-strong">Trigger</div>
                                <div class="pt-1 font-mono">{wf().trigger.type}</div>
                              </div>
                            </div>

                            <TextField
                              multiline
                              label="Description"
                              value={wf().description ?? ""}
                              class="min-h-24"
                              onChange={(next) =>
                                put((item) => ({
                                  ...item,
                                  description: next.trim() ? next : undefined,
                                }))
                              }
                            />

                            <TextField
                              label="Save note"
                              value={state.note}
                              placeholder="Optional note for edit history"
                              onChange={(next) => setState("note", next)}
                            />

                            <Show when={state.err}>
                              {(msg) => (
                                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-icon-critical-base">
                                  {msg()}
                                </div>
                              )}
                            </Show>
                            <Show when={state.ok}>
                              {(msg) => (
                                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-icon-success-base">
                                  {msg()}
                                </div>
                              )}
                            </Show>
                          </section>

                          <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
                            <div class="flex items-center justify-between gap-3">
                              <div>
                                <div class="text-14-medium text-text-strong">Editable graph</div>
                                <div class="text-12-regular text-text-weak">
                                  Select a node to edit supported canonical fields or open a dedicated node-edit session.
                                </div>
                              </div>
                              <Show when={picked()}>
                                {(step) => (
                                  <Button variant="ghost" onClick={() => setSearch({ tab: "authoring", node: undefined })}>
                                    Close node
                                  </Button>
                                )}
                              </Show>
                            </div>
                            <WorkflowGraph steps={wf().steps} selected={node()} nodes={nodeStates()} onSelect={(step) => pick(step.id)} />
                          </section>
                        </div>

                        <section
                          data-component="workflow-node-panel"
                          data-node-id={picked()?.id ?? ""}
                          class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4 xl:sticky xl:top-6 xl:self-start"
                        >
                          <Show
                            when={picked()}
                            fallback={
                              <div class="space-y-2">
                                <div class="text-14-medium text-text-strong">Node editor</div>
                                <div class="text-13-regular text-text-weak">
                                  Pick a graph node to edit its title, inline prompt or script, condition fields, or end result.
                                </div>
                                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                  Builder sessions remain available for broader AI-guided authoring changes.
                                </div>
                              </div>
                            }
                          >
                            {(step) => (
                              <>
                                <div class="space-y-1">
                                  <div class="flex items-center gap-2">
                                    <span class="rounded-md border border-border-weak-base px-2 py-0.5 text-11-medium uppercase tracking-[0.12em] text-text-weak">
                                      {step().kind}
                                    </span>
                                    <span class="text-12-mono text-text-weak">{step().id}</span>
                                  </div>
                                  <div class="text-15-medium text-text-strong">{step().title}</div>
                                </div>

                                <div class="flex flex-wrap gap-2">
                                  <Button
                                    variant="ghost"
                                    data-action="open-node-session"
                                    onClick={() => {
                                      void openRole("node_edit")
                                    }}
                                    disabled={state.ses_busy === "node_edit"}
                                  >
                                    {state.ses_busy === "node_edit" ? "Opening node editor..." : "Open Node Edit Session"}
                                  </Button>
                                </div>

                                <TextField
                                  label="Node title"
                                  value={step().title}
                                  onChange={(next) =>
                                    put((item) => ({
                                      ...item,
                                      steps: patchStep(item.steps, step().id, (node) => ({
                                        ...node,
                                        title: next,
                                      })),
                                    }))
                                  }
                                />

                                <Show when={step().kind === "agent_request"}>
                                  <div class="space-y-3">
                                    <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                      Prompt source: {step().prompt?.source ?? "-"}
                                    </div>
                                    <Show
                                      when={step().prompt?.source === "inline"}
                                      fallback={
                                        <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                          Resource-backed prompts are edited through the node-edit or builder session flow. Resource:{" "}
                                          <span class="font-mono">{step().prompt?.resource_id ?? "-"}</span>
                                        </div>
                                      }
                                    >
                                      <TextField
                                        multiline
                                        label="Inline prompt"
                                        value={step().prompt?.text ?? ""}
                                        class="min-h-32"
                                        onChange={(next) =>
                                          put((item) => ({
                                            ...item,
                                            steps: patchStep(item.steps, step().id, (node) => ({
                                              ...node,
                                              prompt: {
                                                source: "inline",
                                                text: next,
                                              },
                                            })),
                                          }))
                                        }
                                      />
                                    </Show>
                                    <Show when={step().output}>
                                      {(output) => (
                                        <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                          <div class="text-12-medium text-text-weak">Output contract</div>
                                          <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                                            {pretty(output())}
                                          </pre>
                                        </div>
                                      )}
                                    </Show>
                                  </div>
                                </Show>

                                <Show when={step().kind === "script"}>
                                  <div class="space-y-3">
                                    <TextField
                                      label="Working directory"
                                      value={step().cwd ?? ""}
                                      placeholder="Optional"
                                      onChange={(next) =>
                                        put((item) => ({
                                          ...item,
                                          steps: patchStep(item.steps, step().id, (node) => ({
                                            ...node,
                                            cwd: next.trim() ? next : undefined,
                                          })),
                                        }))
                                      }
                                    />
                                    <Show
                                      when={step().script?.source === "inline"}
                                      fallback={
                                        <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                          Resource-backed scripts are edited through the node-edit or builder session flow. Resource:{" "}
                                          <span class="font-mono">{step().script?.resource_id ?? "-"}</span>
                                        </div>
                                      }
                                    >
                                      <TextField
                                        multiline
                                        label="Inline script"
                                        value={step().script?.text ?? ""}
                                        class="min-h-32 font-mono text-xs"
                                        onChange={(next) =>
                                          put((item) => ({
                                            ...item,
                                            steps: patchStep(item.steps, step().id, (node) => ({
                                              ...node,
                                              script: {
                                                source: "inline",
                                                text: next,
                                              },
                                            })),
                                          }))
                                        }
                                      />
                                    </Show>
                                  </div>
                                </Show>

                                <Show when={step().kind === "condition" && step().when}>
                                  {(when) => (
                                    <div class="space-y-3">
                                      <TextField
                                        label="Reference"
                                        value={when().ref}
                                        onChange={(next) =>
                                          put((item) => ({
                                            ...item,
                                            steps: patchStep(item.steps, step().id, (node) => ({
                                              ...node,
                                              when: {
                                                ref: next,
                                                op: node.when?.op ?? "equals",
                                                value: node.when?.value ?? null,
                                              },
                                            })),
                                          }))
                                        }
                                      />
                                      <div class="flex flex-wrap gap-2">
                                        <Button
                                          size="small"
                                          variant={when().op === "equals" ? "secondary" : "ghost"}
                                          onClick={() =>
                                            put((item) => ({
                                              ...item,
                                              steps: patchStep(item.steps, step().id, (node) => ({
                                                ...node,
                                                when: {
                                                  ref: node.when?.ref ?? "",
                                                  op: "equals",
                                                  value: node.when?.value ?? null,
                                                },
                                              })),
                                            }))
                                          }
                                        >
                                          equals
                                        </Button>
                                        <Button
                                          size="small"
                                          variant={when().op === "not_equals" ? "secondary" : "ghost"}
                                          onClick={() =>
                                            put((item) => ({
                                              ...item,
                                              steps: patchStep(item.steps, step().id, (node) => ({
                                                ...node,
                                                when: {
                                                  ref: node.when?.ref ?? "",
                                                  op: "not_equals",
                                                  value: node.when?.value ?? null,
                                                },
                                              })),
                                            }))
                                          }
                                        >
                                          not_equals
                                        </Button>
                                      </div>
                                      <TextField
                                        label="Value"
                                        value={scalarText(when().value)}
                                        onChange={(next) =>
                                          put((item) => ({
                                            ...item,
                                            steps: patchStep(item.steps, step().id, (node) => ({
                                              ...node,
                                              when: {
                                                ref: node.when?.ref ?? "",
                                                op: node.when?.op ?? "equals",
                                                value: parseScalar(next),
                                              },
                                            })),
                                          }))
                                        }
                                      />
                                    </div>
                                  )}
                                </Show>

                                <Show when={step().kind === "end"}>
                                  <div class="space-y-2">
                                    <div class="text-12-medium text-text-weak">Result</div>
                                    <div class="flex flex-wrap gap-2">
                                      <For each={["success", "failure", "noop"] as const}>
                                        {(value) => (
                                          <Button
                                            size="small"
                                            variant={step().result === value ? "secondary" : "ghost"}
                                            onClick={() =>
                                              put((item) => ({
                                                ...item,
                                                steps: patchStep(item.steps, step().id, (node) => ({
                                                  ...node,
                                                  result: value,
                                                })),
                                              }))
                                            }
                                          >
                                            {value}
                                          </Button>
                                        )}
                                      </For>
                                    </div>
                                  </div>
                                </Show>
                              </>
                            )}
                          </Show>
                        </section>
                      </div>
                    )}
                  </Show>
                </Tabs.Content>

                <Tabs.Content value="run" class="space-y-4">
                  <Show
                    when={value().item.workflow}
                    fallback={
                      <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-3">
                        <div class="text-14-medium text-text-strong">Run blocked</div>
                        <div class="text-13-regular text-text-weak">
                          This workflow cannot be started because the current definition did not parse into a runnable graph.
                        </div>
                        <Button variant="ghost" onClick={() => setSearch({ tab: "authoring" })}>
                          Open authoring
                        </Button>
                      </section>
                    }
                  >
                    {(wf) => (
                      <section data-component="workflow-run-form" class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div class="space-y-1">
                            <div class="text-14-medium text-text-strong">Manual run</div>
                            <div class="text-12-regular text-text-weak">
                              Trigger: {wf().trigger.type}. Validate inputs first, then start a new run from the current canonical workflow files.
                            </div>
                            <Show when={prefill_id()}>
                              {(run_id) => <div class="text-12-mono text-text-weak">prefill run: {run_id()}</div>}
                            </Show>
                          </div>
                          <div class="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setRun({
                                  vals: seeded(wf().inputs),
                                  validated: false,
                                  err: "",
                                  ok: "",
                                })
                              }
                            >
                              Reset Inputs
                            </Button>
                            <Button variant="ghost" onClick={() => setSearch({ tab: "run", prefill_run: undefined })}>
                              Clear Prefill
                            </Button>
                          </div>
                        </div>

                        <Show when={!value().item.runnable}>
                          <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-icon-critical-base">
                            Run start is blocked until validation issues are resolved. Open authoring to repair the workflow.
                          </div>
                        </Show>
                        <Show when={prefill.error}>
                          <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-icon-critical-base">
                            {errorMessage(prefill.error)}
                          </div>
                        </Show>
                        <Show when={run.err}>
                          {(msg) => (
                            <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-icon-critical-base">
                              {msg()}
                            </div>
                          )}
                        </Show>
                        <Show when={run.ok}>
                          {(msg) => (
                            <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-icon-success-base">
                              {msg()}
                            </div>
                          )}
                        </Show>

                        <Show
                          when={wf().inputs.length > 0}
                          fallback={
                            <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                              This workflow does not declare manual inputs.
                            </div>
                          }
                        >
                          <div class="grid gap-4 md:grid-cols-2">
                            <For each={wf().inputs}>
                              {(item) => (
                                <div data-component="workflow-run-input" data-key={item.key} class="space-y-2">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <div class="text-13-medium text-text-strong">{item.label}</div>
                                    <span class="rounded-md border border-border-weak-base px-2 py-0.5 text-11-medium uppercase tracking-[0.12em] text-text-weak">
                                      {item.type}
                                    </span>
                                    <span class="text-12-regular text-text-weak">{item.required ? "required" : "optional"}</span>
                                  </div>

                                  <Show when={item.type === "text"}>
                                    <TextField
                                      value={typeof run.vals[item.key] === "string" ? (run.vals[item.key] as string) : ""}
                                      placeholder={item.default === undefined ? undefined : `${item.default}`}
                                      onChange={(next) => setField(item.key, next)}
                                    />
                                  </Show>
                                  <Show when={item.type === "long_text"}>
                                    <TextField
                                      multiline
                                      class="min-h-28"
                                      value={typeof run.vals[item.key] === "string" ? (run.vals[item.key] as string) : ""}
                                      placeholder={item.default === undefined ? undefined : `${item.default}`}
                                      onChange={(next) => setField(item.key, next)}
                                    />
                                  </Show>
                                  <Show when={item.type === "number"}>
                                    <TextField
                                      value={
                                        typeof run.vals[item.key] === "number"
                                          ? `${run.vals[item.key]}`
                                          : typeof run.vals[item.key] === "string"
                                            ? (run.vals[item.key] as string)
                                            : ""
                                      }
                                      placeholder={typeof item.default === "number" ? `${item.default}` : undefined}
                                      onChange={(next) => setField(item.key, next)}
                                    />
                                  </Show>
                                  <Show when={item.type === "boolean"}>
                                    <label class="flex items-center justify-between rounded-lg border border-border-weak-base px-3 py-2">
                                      <span class="text-13-regular text-text-strong">Enabled</span>
                                      <Toggle checked={run.vals[item.key] === true} onChange={(next) => setField(item.key, next)} />
                                    </label>
                                  </Show>
                                  <Show when={item.type === "select"}>
                                    <Select
                                      options={item.options ?? []}
                                      current={option(item, run.vals[item.key])}
                                      label={(row) => row.label}
                                      value={(row) => `${row.value}`}
                                      onSelect={(row) => setField(item.key, row?.value)}
                                      triggerVariant="settings"
                                    />
                                  </Show>
                                  <Show when={item.type === "path"}>
                                    <TextField
                                      value={typeof run.vals[item.key] === "string" ? (run.vals[item.key] as string) : ""}
                                      placeholder={item.mode === "directory" ? "/path/to/dir" : "/path/to/file"}
                                      onChange={(next) => setField(item.key, next)}
                                    />
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>

                        <div class="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="ghost"
                            data-action="workflow-validate-run"
                            onClick={() => {
                              void validateRun()
                            }}
                            disabled={run.validating || run.starting || !value().item.runnable}
                          >
                            {run.validating ? "Validating..." : "Validate Inputs"}
                          </Button>
                          <Button
                            data-action="workflow-start-run"
                            onClick={() => {
                              void startRun()
                            }}
                            disabled={run.starting || run.validating || !value().item.runnable}
                          >
                            {run.starting ? "Starting..." : "Start Workflow"}
                          </Button>
                        </div>
                      </section>
                    )}
                  </Show>
                </Tabs.Content>

                <Tabs.Content value="history" class="space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div class="text-14-medium text-text-strong">Workflow edit history</div>
                      <div class="text-12-regular text-text-weak">
                        Builder, node-edit, and graph-save checkpoints are listed newest first with diffs and linked sessions.
                      </div>
                    </div>
                    <Button variant="ghost" onClick={() => hctl.refetch()}>
                      Refresh history
                    </Button>
                  </div>

                  <Switch>
                    <Match when={hist.loading}>
                      <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-text-weak">
                        Loading workflow edit history...
                      </div>
                    </Match>
                    <Match when={hist.error}>
                      <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
                        {errorMessage(hist.error)}
                      </div>
                    </Match>
                    <Match when={(hist()?.items.length ?? 0) === 0}>
                      <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-text-weak">
                        No workflow edit history has been captured yet.
                      </div>
                    </Match>
                    <Match when={true}>
                      <div class="space-y-4">
                        <For each={hist()?.items ?? []}>
                          {(item) => (
                            <section
                              data-component="workflow-history-row"
                              data-edit-id={item.edit.id}
                              class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4"
                            >
                              <div class="flex flex-wrap items-start justify-between gap-3">
                                <div class="space-y-1">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                                      {editLabel(item.edit.action)}
                                    </span>
                                    <span class="text-12-mono text-text-weak">{item.revision.id.slice(0, 8)}</span>
                                  </div>
                                  <div class="text-12-regular text-text-weak">{stamp(item.edit.created_at)}</div>
                                  <Show when={item.edit.note}>
                                    {(note) => <div class="text-13-regular text-text-strong">{note()}</div>}
                                  </Show>
                                  <Show when={item.edit.node_id}>
                                    {(node_id) => <div class="text-12-mono text-text-weak">node: {node_id()}</div>}
                                  </Show>
                                </div>
                                <div class="flex flex-wrap gap-2">
                                  <Show when={item.session?.id}>
                                    {(session_id) => (
                                      <Button variant="ghost" onClick={() => navigate(`/${params.dir}/session/${session_id()}`)}>
                                        Open session
                                      </Button>
                                    )}
                                  </Show>
                                  <Button variant="ghost" onClick={() => setSearch({ tab: "authoring" })}>
                                    Open authoring
                                  </Button>
                                </div>
                              </div>

                              <div class="grid gap-4 lg:grid-cols-2">
                                <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                  <div class="text-12-medium text-text-weak">Revision</div>
                                  <div class="pt-2 text-12-mono text-text-strong break-all">{item.revision.file}</div>
                                  <div class="pt-1 text-12-regular text-text-weak">{item.revision.content_hash.slice(0, 16)}</div>
                                </div>
                                <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                  <div class="text-12-medium text-text-weak">Linked session</div>
                                  <div class="pt-2 text-12-regular text-text-strong">{item.session?.title ?? "No linked session"}</div>
                                  <div class="pt-1 text-12-mono text-text-weak break-all">{item.session?.id ?? "-"}</div>
                                </div>
                              </div>

                              <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                <div class="text-12-medium text-text-weak">Diff</div>
                                <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">{item.diff}</pre>
                              </div>
                            </section>
                          )}
                        </For>
                      </div>
                    </Match>
                  </Switch>
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
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
