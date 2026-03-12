import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useNavigate, useParams } from "@solidjs/router"
import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import {
  buildWorkflow,
  copyWorkflow,
  hideWorkflow,
  loadWorkflowPage,
  type GraphWorkflowAction,
  type GraphWorkflowSummary,
} from "./graph-detail-data"

type Mode = "ai" | "blank" | null
type Flt = "all" | "runnable" | "blocked" | "edited"
type Ord = "edit" | "run" | "name"

const stamp = (value: number | null | undefined) => {
  if (!value) return "Never"
  return new Date(value).toLocaleString()
}

const editLabel = (value: GraphWorkflowAction) => {
  if (value === "graph_edit") return "Graph edit"
  if (value === "node_edit") return "Node edit"
  if (value === "duplicate") return "Duplicate"
  if (value === "hide") return "Hidden"
  return "Builder"
}

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

const sortItems = (items: GraphWorkflowSummary[], ord: Ord) =>
  [...items].sort((a, b) => {
    if (ord === "name") return a.name.localeCompare(b.name)
    if (ord === "run") return (b.last_run?.created_at ?? 0) - (a.last_run?.created_at ?? 0) || a.name.localeCompare(b.name)
    return (b.last_edit?.created_at ?? 0) - (a.last_edit?.created_at ?? 0) || a.name.localeCompare(b.name)
  })

export default function Workflows() {
  const sdk = useSDK()
  const server = useServer()
  const navigate = useNavigate()
  const params = useParams()
  const [tick, setTick] = createSignal(0)
  const [q, setQ] = createSignal("")
  const [flt, setFlt] = createSignal<Flt>("all")
  const [ord, setOrd] = createSignal<Ord>("edit")
  const [mode, setMode] = createSignal<Mode>(null)
  const [form, setForm] = createStore({
    name: "",
    prompt: "",
    busy: false,
    err: "",
  })
  const [ops, setOps] = createStore({
    busy: "" as "" | "copy" | "hide" | "validate",
    id: "",
    err: "",
    ok: "",
  })

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const args = createMemo(() => ({
    baseUrl: sdk.url,
    directory: sdk.directory,
    auth: auth(),
    tick: tick(),
  }))

  const [list, ctl] = createResource(args, ({ baseUrl, directory, auth }) =>
    loadWorkflowPage({
      baseUrl,
      directory,
      auth,
    }),
  )

  const rows = createMemo(() => {
    const term = q().trim().toLowerCase()
    const filtered = (list()?.items ?? []).filter((item) => {
      if (flt() === "runnable" && !item.runnable) return false
      if (flt() === "blocked" && item.runnable) return false
      if (flt() === "edited" && !item.last_edit) return false
      if (!term) return true
      return [item.id, item.name, item.description ?? "", item.file, item.trigger_summary].some((part) =>
        part.toLowerCase().includes(term),
      )
    })
    return sortItems(filtered, ord())
  })

  const count = createMemo(() => ({
    total: list()?.items.length ?? 0,
    runnable: (list()?.items ?? []).filter((item) => item.runnable).length,
    blocked: (list()?.items ?? []).filter((item) => !item.runnable).length,
  }))

  const reset = (next: Mode) => {
    setMode(next)
    setForm({
      name: "",
      prompt: "",
      busy: false,
      err: "",
    })
  }

  const submit = async () => {
    const kind = mode()
    const name = form.name.trim()
    const prompt = form.prompt.trim()
    if (kind === "ai" && !prompt) {
      setForm("err", "Describe the workflow you want to build.")
      return
    }
    if (kind === "blank" && !name) {
      setForm("err", "Name the workflow before creating it.")
      return
    }

    setForm("busy", true)
    setForm("err", "")

    try {
      const built = await buildWorkflow({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        name: name || undefined,
        prompt:
          prompt ||
          `Create a starter manual workflow named ${name}. Keep the structure minimal and leave the builder prompt ready for follow-up editing.`,
      })
      reset(null)
      ctl.refetch()
      navigate(`/${params.dir}/workflows/${built.workflow_id}?tab=authoring`)
    } catch (err) {
      setForm("err", errorMessage(err))
    } finally {
      setForm("busy", false)
    }
  }

  const act = async (kind: "copy" | "hide" | "validate", workflow_id: string) => {
    setOps({
      busy: kind,
      id: workflow_id,
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
        ctl.refetch()
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
        ctl.refetch()
        setOps("ok", `Hidden ${workflow_id} from the active workflow index.`)
        return
      }
      const value = await ctl.refetch()
      const item = value?.items.find((row) => row.id === workflow_id)
      if (!item) {
        setOps("ok", `Refreshed workflow index.`)
        return
      }
      setOps("ok", item.runnable ? `${workflow_id} is runnable.` : `${workflow_id} has ${item.errors.length} issue(s).`)
    } catch (err) {
      setOps("err", errorMessage(err))
    } finally {
      setOps("busy", "")
      setOps("id", "")
    }
  }

  return (
    <div data-page="workflows" class="size-full overflow-y-auto">
      <div class="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-1">
            <h1 class="text-16-medium text-text-strong">Workflows</h1>
            <p class="text-13-regular text-text-weak">
              Discover workflow definitions, inspect authoring status, and continue builder work from the canonical workflow set.
            </p>
            <Show when={list()?.endpoint}>
              {(value) => (
                <p class="text-12-mono text-text-weak">
                  source: <span>{value()}</span>
                </p>
              )}
            </Show>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button data-action="build-ai" onClick={() => reset("ai")}>
              Build workflow with AI
            </Button>
            <Button variant="secondary" data-action="new-workflow" onClick={() => reset("blank")}>
              New workflow
            </Button>
            <Button variant="ghost" onClick={() => setTick((value) => value + 1)}>
              Refresh
            </Button>
          </div>
        </div>

        <Show when={ops.err}>
          {(value) => (
            <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2 text-12-regular text-icon-critical-base">
              {value()}
            </div>
          )}
        </Show>
        <Show when={ops.ok}>
          {(value) => (
            <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2 text-12-regular text-icon-success-base">
              {value()}
            </div>
          )}
        </Show>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
            <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Total</div>
            <div class="pt-1 text-20-medium text-text-strong">{count().total}</div>
          </div>
          <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
            <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Runnable</div>
            <div class="pt-1 text-20-medium text-icon-success-base">{count().runnable}</div>
          </div>
          <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
            <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Blocked</div>
            <div class="pt-1 text-20-medium text-icon-critical-base">{count().blocked}</div>
          </div>
        </div>

        <Show when={mode()}>
          {(kind) => (
            <section
              data-component="workflow-build-form"
              data-mode={kind()}
              class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-1">
                  <div class="text-14-medium text-text-strong">
                    {kind() === "ai" ? "Build workflow with AI" : "New workflow"}
                  </div>
                  <div class="text-12-regular text-text-weak">
                    {kind() === "ai"
                      ? "Create a first draft from a builder prompt, then continue in the workflow authoring surface."
                      : "Create a starter manual workflow and keep the prompt ready for later builder refinement."}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => reset(null)} disabled={form.busy}>
                  Cancel
                </Button>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <TextField
                  label="Workflow name"
                  placeholder={kind() === "ai" ? "Optional" : "Release review"}
                  value={form.name}
                  onChange={(value) => setForm("name", value)}
                />
                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                  <div class="text-12-medium text-text-strong">Route</div>
                  <div class="pt-1 font-mono">POST /workflow/workflows/build</div>
                </div>
              </div>

              <TextField
                multiline
                label={kind() === "ai" ? "Builder prompt" : "Starter prompt"}
                placeholder={
                  kind() === "ai"
                    ? "Review release notes, inspect changed files, and prepare a summary draft."
                    : "Optional first instruction for the builder prompt."
                }
                value={form.prompt}
                class="min-h-32"
                onChange={(value) => setForm("prompt", value)}
              />

              <Show when={form.err}>
                {(value) => (
                  <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2 text-12-regular text-icon-critical-base">
                    {value()}
                  </div>
                )}
              </Show>

              <div class="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => reset(null)} disabled={form.busy}>
                  Cancel
                </Button>
                <Button data-action="submit-build" onClick={() => void submit()} disabled={form.busy}>
                  {form.busy ? "Creating..." : kind() === "ai" ? "Build workflow" : "Create workflow"}
                </Button>
              </div>
            </section>
          )}
        </Show>

        <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
          <div class="flex flex-wrap items-end gap-4">
            <div class="min-w-[240px] flex-1">
              <TextField
                label="Search"
                value={q()}
                placeholder="Search by name, id, file, or trigger"
                onChange={setQ}
              />
            </div>

            <div class="flex flex-wrap gap-2">
              <For each={["all", "runnable", "blocked", "edited"] as const}>
                {(item) => (
                  <Button size="small" variant={flt() === item ? "secondary" : "ghost"} onClick={() => setFlt(item)}>
                    {item}
                  </Button>
                )}
              </For>
            </div>

            <div class="flex flex-wrap gap-2">
              <For each={["edit", "run", "name"] as const}>
                {(item) => (
                  <Button size="small" variant={ord() === item ? "secondary" : "ghost"} onClick={() => setOrd(item)}>
                    sort: {item}
                  </Button>
                )}
              </For>
            </div>
          </div>

          <Show when={count().blocked > 0}>
            <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2 text-12-regular text-text-weak">
              Blocked workflows stay visible with their validation issues so authoring and builder follow-up remain explicit.
            </div>
          </Show>
        </section>

        <Switch>
          <Match when={list.loading}>
            <div data-component="validation-loading" class="rounded-lg border border-border-weak-base p-4 text-13-regular">
              Loading workflow index...
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
              No workflows were returned. Start by building one from AI or creating a starter workflow.
            </div>
          </Match>
          <Match when={rows().length === 0}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-text-weak">
              No workflows match the current search and filters.
            </div>
          </Match>
          <Match when={true}>
            <div class="space-y-4">
              <For each={rows()}>
                {(item) => (
                  <section
                    data-component="validation-resource-row"
                    data-view="workflow"
                    data-id={item.id}
                    data-runnable={item.runnable ? "true" : "false"}
                    class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div class="min-w-0 space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="text-14-medium text-text-strong truncate">{item.name}</p>
                          <div
                            data-component="validation-state"
                            data-runnable={item.runnable ? "true" : "false"}
                            class={`shrink-0 rounded-md px-2.5 py-1 text-12-medium ${stateClass(item.runnable)}`}
                          >
                            {stateLabel(item.runnable)}
                          </div>
                        </div>
                        <p class="text-12-regular text-text-weak">{item.description || "No description yet."}</p>
                        <p class="text-12-mono text-text-weak break-all">{item.file}</p>
                      </div>

                      <div class="flex flex-wrap gap-2">
                        <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                          {item.id}
                        </span>
                        <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                          {item.trigger_summary}
                        </span>
                      </div>
                    </div>

                    <div class="grid gap-3 md:grid-cols-3">
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Last run</div>
                        <div class="pt-1 text-13-medium text-text-strong">
                          {item.last_run ? item.last_run.status : "No runs yet"}
                        </div>
                        <div class="pt-1 text-12-regular text-text-weak">{stamp(item.last_run?.created_at)}</div>
                      </div>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Last edit</div>
                        <div class="pt-1 text-13-medium text-text-strong">
                          {item.last_edit ? editLabel(item.last_edit.action) : "No edits yet"}
                        </div>
                        <div class="pt-1 text-12-regular text-text-weak">{stamp(item.last_edit?.created_at)}</div>
                      </div>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Blocked state</div>
                        <div class="pt-1 text-13-medium text-text-strong">
                          {item.runnable ? "Ready for authoring" : `${item.errors.length} validation issue(s)`}
                        </div>
                        <Show when={item.last_edit?.note}>
                          {(value) => <div class="pt-1 text-12-regular text-text-weak">{value()}</div>}
                        </Show>
                      </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => navigate(`/${params.dir}/workflows/${item.id}`)}>
                        Open workflow
                      </Button>
                      <Button variant="ghost" onClick={() => navigate(`/${params.dir}/workflows/${item.id}?tab=authoring`)}>
                        Edit graph
                      </Button>
                      <Button variant="ghost" onClick={() => navigate(`/${params.dir}/workflows/${item.id}?tab=run`)}>
                        Run workflow
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void act("validate", item.id)
                        }}
                        disabled={ops.busy !== "" && ops.id === item.id}
                      >
                        {ops.busy === "validate" && ops.id === item.id ? "Validating..." : "Validate"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void act("copy", item.id)
                        }}
                        disabled={ops.busy !== "" && ops.id === item.id}
                      >
                        {ops.busy === "copy" && ops.id === item.id ? "Duplicating..." : "Duplicate"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void act("hide", item.id)
                        }}
                        disabled={ops.busy !== "" && ops.id === item.id}
                      >
                        {ops.busy === "hide" && ops.id === item.id ? "Hiding..." : "Hide"}
                      </Button>
                      <Button variant="ghost" onClick={() => navigate(`/${params.dir}/workflows/${item.id}?tab=history`)}>
                        View history
                      </Button>
                    </div>

                    <Show
                      when={!item.runnable}
                      fallback={<p class="text-12-regular text-text-weak">No validation issues are blocking this workflow.</p>}
                    >
                      <div class="rounded-lg border border-border-weak-base bg-background-base p-3 space-y-3">
                        <div class="text-12-regular text-icon-critical-base">
                          Blocked from runnable workflow operations until validation issues are resolved.
                        </div>
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
                              <For each={item.errors}>
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
