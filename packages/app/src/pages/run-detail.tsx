import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { batch, createMemo, createResource, For, Match, Show, Switch } from "solid-js"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { loadRunDetail, rerunWorkflowRun } from "./graph-detail-data"
import { WorkflowGraph } from "./workflow-graph"

const stamp = (value: number | null) => {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2)

const panels = new Set(["summary", "transcript", "logs", "artifacts", "attempts"])
const queryText = (value: string | string[] | undefined) => (typeof value === "string" ? value : value?.[0])

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Failed to load run detail."
}

function TranscriptPanel(props: {
  sessionID: string
  openSession: () => void
  continueFromHere: () => void
}) {
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()

  const [transcript] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const [session, messages] = await Promise.all([
        sdk.client.session.get({ sessionID }).then((value) => value.data),
        sdk.client.session.messages({ sessionID, limit: 200 }).then((value) => value.data ?? []),
      ])
      const ordered = messages.map((item) => item.info).sort((a, b) => a.id.localeCompare(b.id))
      batch(() => {
        sync.set("message", sessionID, ordered)
        messages.forEach((item) => {
          sync.set("part", item.info.id, item.parts)
        })
      })
      return {
        title: session?.title ?? sessionID,
        ids: ordered.map((item) => item.id),
      }
    },
  )

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="text-13-regular text-text-weak">{transcript()?.title ?? props.sessionID}</div>
        <div class="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={props.openSession}>
            Open Session
          </Button>
          <Button variant="ghost" onClick={props.continueFromHere}>
            Continue from Here
          </Button>
        </div>
      </div>

      <Switch>
        <Match when={transcript.loading}>
          <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-text-weak">
            Loading transcript...
          </div>
        </Match>
        <Match when={transcript.error}>
          <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
            {errorMessage(transcript.error)}
          </div>
        </Match>
        <Match when={(transcript()?.ids.length ?? 0) === 0}>
          <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-text-weak">
            No transcript messages were returned for this attempt.
          </div>
        </Match>
        <Match when={true}>
          <div class="space-y-4">
            <For each={transcript()?.ids ?? []}>
              {(messageID) => (
                <SessionTurn
                  sessionID={props.sessionID}
                  messageID={messageID}
                  active={false}
                  queued={false}
                  status={undefined}
                  showReasoningSummaries={settings.general.showReasoningSummaries()}
                  shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
                  editToolDefaultOpen={settings.general.editToolPartsExpanded()}
                  classes={{
                    root: "min-w-0 w-full relative",
                    content: "flex flex-col justify-between !overflow-visible",
                    container: "w-full",
                  }}
                />
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </div>
  )
}

export default function RunDetailPage() {
  const sdk = useSDK()
  const server = useServer()
  const params = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [ops, setOps] = createStore({
    busy: "" as "" | "run" | "node",
    err: "",
  })

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const input = createMemo(() => ({
    baseUrl: sdk.url,
    directory: sdk.directory,
    run_id: params.runId ?? "",
    auth: auth(),
  }))

  const [detail, controls] = createResource(input, loadRunDetail)

  const panel = createMemo(() => {
    const value = queryText(search.panel)
    return value && panels.has(value) ? value : "summary"
  })
  const selectedNode = createMemo(() => {
    const node_id = queryText(search.node)
    if (!node_id) return
    return detail()?.nodes.find((item) => item.node.node_id === node_id)
  })
  const selectedAttempt = createMemo(() => {
    const node = selectedNode()
    if (!node) return
    const raw = Number(queryText(search.attempt))
    if (Number.isInteger(raw)) {
      const match = node.attempts.find((item) => item.attempt.attempt_index === raw)
      if (match) return match
    }
    return node.attempts.at(-1)
  })

  const nodeStates = createMemo(() =>
    Object.fromEntries(
      (detail()?.nodes ?? []).map((item) => [
        item.node.node_id,
        {
          status: item.node.status,
          skip_reason_code: item.node.skip_reason_code,
        },
      ]),
    ),
  )

  const selectNode = (node_id: string) => {
    const match = detail()?.nodes.find((item) => item.node.node_id === node_id)
    const latest = match?.attempts.at(-1)
    setSearch({
      node: node_id,
      panel: "summary",
      attempt: latest ? `${latest.attempt.attempt_index}` : undefined,
    })
  }

  const setPanel = (next: string) => {
    if (!selectedNode()) return
    setSearch({
      node: selectedNode()!.node.node_id,
      panel: next,
      attempt: selectedAttempt() ? `${selectedAttempt()!.attempt.attempt_index}` : undefined,
    })
  }

  const openTranscriptSession = () => {
    const sessionID = selectedAttempt()?.session?.session?.id ?? selectedAttempt()?.attempt.session_id
    if (!sessionID) return
    navigate(`/${params.dir}/session/${sessionID}`)
  }

  const continueFromHere = async () => {
    const sessionID = selectedAttempt()?.attempt.session_id
    if (!sessionID) return
    const result = await sdk.client.session.fork({ sessionID })
    if (!result.data) return
    navigate(`/${params.dir}/session/${result.data.id}`)
  }

  const openWorkflow = () => {
    const workflow_id = detail()?.run.workflow_id
    if (!workflow_id) return
    navigate(`/${params.dir}/workflows/${workflow_id}`)
  }

  const editRerun = () => {
    const workflow_id = detail()?.run.workflow_id
    const run_id = detail()?.run.id
    if (!workflow_id || !run_id) return
    navigate(`/${params.dir}/workflows/${workflow_id}?tab=run&prefill_run=${encodeURIComponent(run_id)}`)
  }

  const openHistory = (tab: "operations" | "drafts") => {
    const run_id = detail()?.run.id
    const workspace_id = detail()?.run.workspace_id
    if (!run_id || !workspace_id) return
    navigate(`/${params.dir}/history?tab=${tab}&run_id=${encodeURIComponent(run_id)}&workspace=${encodeURIComponent(workspace_id)}`)
  }

  const rerun = async () => {
    const run_id = detail()?.run.id
    if (!run_id) return
    setOps({
      busy: "run",
      err: "",
    })

    try {
      const value = await rerunWorkflowRun({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        run_id,
      })
      navigate(`/${params.dir}/runs/${value.id}`)
    } catch (err) {
      setOps("err", errorMessage(err))
    } finally {
      setOps("busy", "")
    }
  }

  const rerunFrom = async () => {
    const run_id = detail()?.run.id
    const node_id = selectedNode()?.node.node_id
    if (!run_id || !node_id) return
    setOps({
      busy: "node",
      err: "",
    })

    try {
      const value = await rerunWorkflowRun({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        run_id,
        node_id,
      })
      navigate(`/${params.dir}/runs/${value.id}`)
    } catch (err) {
      setOps("err", errorMessage(err))
    } finally {
      setOps("busy", "")
    }
  }

  return (
    <div data-page="run-detail" class="size-full overflow-y-auto">
      <div class="mx-auto max-w-7xl p-6 space-y-6">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <Show when={detail()}>
              {(value) => (
                <>
                  <div class="flex items-center gap-2">
                    <h1 class="text-18-medium text-text-strong">{value().snapshot.graph_json.name}</h1>
                    <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                      {value().run.status}
                    </span>
                  </div>
                  <div class="text-12-mono text-text-weak break-all">{value().run.id}</div>
                  <div class="text-12-regular text-text-weak">
                    created: {stamp(value().run.created_at)} • started: {stamp(value().run.started_at)} • finished:{" "}
                    {stamp(value().run.finished_at)}
                  </div>
                </>
              )}
            </Show>
          </div>
          <div class="flex flex-wrap gap-2">
            <Show when={detail()?.run.workflow_id}>
              <Button variant="ghost" onClick={openWorkflow}>
                Open Workflow
              </Button>
            </Show>
            <Button variant="ghost" onClick={editRerun}>
              Edit Rerun Inputs
            </Button>
            <Button variant="ghost" onClick={() => openHistory("operations")}>
              View Operations
            </Button>
            <Button variant="ghost" onClick={() => openHistory("drafts")}>
              View Drafts
            </Button>
            <Button variant="ghost" onClick={() => void rerun()} disabled={ops.busy !== ""}>
              {ops.busy === "run" ? "Rerunning..." : "Rerun Workflow"}
            </Button>
            <Show when={detail()?.followup?.session?.id}>
              {(sessionID) => (
                <Button variant="ghost" onClick={() => navigate(`/${params.dir}/session/${sessionID()}`)}>
                  Open Follow-up
                </Button>
              )}
            </Show>
            <Button variant="ghost" onClick={() => controls.refetch()}>
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

        <Switch>
          <Match when={detail.loading}>
            <div class="rounded-xl border border-border-weak-base p-4 text-13-regular">Loading run detail...</div>
          </Match>
          <Match when={detail.error}>
            <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
              {errorMessage(detail.error)}
            </div>
          </Match>
          <Match when={detail()}>
            {(value) => (
              <div class="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
                <div class="space-y-6">
                  <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                        workflow {value().snapshot.workflow_id}
                      </span>
                      <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                        revision {value().revision.id.slice(0, 8)}
                      </span>
                      <Show when={value().live.has_newer_revision}>
                        <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-icon-warning-base">
                          newer revision available
                        </span>
                      </Show>
                    </div>
                    <div class="grid gap-3 md:grid-cols-2">
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-12-medium text-text-weak">Inputs</div>
                        <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                          {pretty(value().snapshot.input_json)}
                        </pre>
                      </div>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-12-medium text-text-weak">Resource Materials</div>
                        <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                          {pretty(value().snapshot.resource_materials_json)}
                        </pre>
                      </div>
                    </div>
                    <div class="rounded-lg border border-border-weak-base px-3 py-2" data-component="run-detail-input-store">
                      <div class="text-12-medium text-text-weak">Input Snapshot Store</div>
                      <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                        {pretty(value().snapshot.input_store_json)}
                      </pre>
                    </div>
                    <Show when={value().run.integration_candidate?.changed_paths.length}>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-12-medium text-text-weak">Integration Candidate</div>
                        <div class="pt-2 text-12-regular text-text-strong">
                          {value().run.integration_candidate?.changed_paths.join(", ")}
                        </div>
                      </div>
                    </Show>
                  </section>

                  <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="text-14-medium text-text-strong">Snapshot Graph</div>
                        <div class="text-12-regular text-text-weak">
                          Select a node to inspect attempts, transcript, logs, and artifacts.
                        </div>
                      </div>
                      <Show when={selectedNode()}>
                        {(node) => (
                          <Button variant="ghost" onClick={() => setSearch({ node: undefined, panel: undefined, attempt: undefined })}>
                            Close Node
                          </Button>
                        )}
                      </Show>
                    </div>
                    <WorkflowGraph
                      steps={value().snapshot.graph_json.steps}
                      selected={selectedNode()?.node.node_id}
                      nodes={nodeStates()}
                      onSelect={(step) => selectNode(step.id)}
                    />
                  </section>

                  <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-3">
                    <div>
                      <div class="text-14-medium text-text-strong">Event Stream</div>
                      <div class="text-12-regular text-text-weak">
                        Runtime events remain inspectable and can focus the matching run node when available.
                      </div>
                    </div>
                    <Show
                      when={value().events.length > 0}
                      fallback={
                        <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                          No events were captured for this run.
                        </div>
                      }
                    >
                      <For each={value().events}>
                        {(event) => (
                          <button
                            type="button"
                            data-component="run-event-row"
                            data-sequence={event.sequence}
                            class="w-full rounded-lg border border-border-weak-base px-3 py-2 text-left"
                            onClick={() => {
                              if (!event.run_node_id) return
                              const node = value().nodes.find((item) => item.node.id === event.run_node_id)
                              if (!node) return
                              selectNode(node.node.node_id)
                            }}
                          >
                            <div class="text-13-medium text-text-strong">
                              #{event.sequence} {event.event_type}
                            </div>
                            <div class="pt-1 text-12-regular text-text-weak">
                              node {event.run_node_id ?? "-"} • attempt {event.run_attempt_id ?? "-"}
                            </div>
                            <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                              {pretty(event.payload_json)}
                            </pre>
                          </button>
                        )}
                      </For>
                    </Show>
                  </section>
                </div>

                <section
                  data-component="run-node-panel"
                  data-node-id={selectedNode()?.node.node_id ?? ""}
                  class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4 xl:sticky xl:top-6 xl:self-start"
                >
                  <Show
                    when={selectedNode()}
                    fallback={
                      <div class="space-y-2">
                        <div class="text-14-medium text-text-strong">Run Summary</div>
                        <div class="text-13-regular text-text-weak">
                          The right panel becomes node-specific once you select a step in the snapshot graph.
                        </div>
                        <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                          Events captured: {value().events.length}
                        </div>
                      </div>
                    }
                  >
                    {(node) => (
                      <>
                        <div class="space-y-1">
                          <div class="flex items-center gap-2">
                            <span class="rounded-md border border-border-weak-base px-2 py-0.5 text-11-medium uppercase tracking-[0.12em] text-text-weak">
                              {node().node.kind}
                            </span>
                            <span class="text-12-mono text-text-weak">{node().node.node_id}</span>
                          </div>
                          <div class="text-15-medium text-text-strong">{node().node.title}</div>
                          <div class="text-12-regular text-text-weak">
                            {node().node.status}
                            <Show when={node().node.skip_reason_code}>
                              {(reason) => <> • {reason()}</>}
                            </Show>
                          </div>
                        </div>

                        <Show when={detail()?.run.workflow_id}>
                          {(workflow_id) => (
                            <div class="flex flex-wrap gap-2">
                              <Button
                                variant="ghost"
                                onClick={() => navigate(`/${params.dir}/workflows/${workflow_id()}?tab=authoring&node=${node().node.node_id}`)}
                              >
                                Edit Node
                              </Button>
                              <Show when={node().node.status !== "skipped"}>
                                <Button variant="ghost" onClick={() => void rerunFrom()} disabled={ops.busy !== ""}>
                                  {ops.busy === "node" ? "Rerunning..." : "Rerun from Here"}
                                </Button>
                              </Show>
                            </div>
                          )}
                        </Show>

                        <Tabs value={panel()} onChange={setPanel} class="space-y-4">
                          <Tabs.List class="flex flex-wrap gap-2">
                            <For each={["summary", "transcript", "logs", "artifacts", "attempts"]}>
                              {(item) => (
                                <Tabs.Trigger
                                  value={item}
                                  data-component="run-node-panel-trigger"
                                  data-panel={item}
                                  onClick={() => setPanel(item)}
                                >
                                  {item}
                                </Tabs.Trigger>
                              )}
                            </For>
                          </Tabs.List>

                          <Tabs.Content value="summary" class="space-y-3">
                            <div class="rounded-lg border border-border-weak-base px-3 py-2">
                              <div class="text-12-medium text-text-weak">Definition</div>
                              <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                                {pretty(node().step)}
                              </pre>
                            </div>
                            <div class="rounded-lg border border-border-weak-base px-3 py-2">
                              <div class="text-12-medium text-text-weak">Node Output</div>
                              <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                                {pretty(node().node.output_json)}
                              </pre>
                            </div>
                            <Show when={node().node.error_json}>
                              <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                <div class="text-12-medium text-text-weak">Node Error</div>
                                <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                                  {pretty(node().node.error_json)}
                                </pre>
                              </div>
                            </Show>
                          </Tabs.Content>

                          <Tabs.Content value="transcript" class="space-y-3">
                            <Show
                              when={selectedAttempt()?.attempt.session_id}
                              fallback={
                                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                  No transcript session was linked for the selected attempt.
                                </div>
                              }
                            >
                              {(sessionID) => (
                                <TranscriptPanel
                                  sessionID={sessionID()}
                                  openSession={openTranscriptSession}
                                  continueFromHere={() => {
                                    void continueFromHere()
                                  }}
                                />
                              )}
                            </Show>
                          </Tabs.Content>

                          <Tabs.Content value="logs" class="space-y-3">
                            <Show
                              when={selectedAttempt()?.attempt.output_json}
                              fallback={
                                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                  No logs were persisted for this attempt.
                                </div>
                              }
                            >
                              {(output) => (
                                <>
                                  <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                    <div class="text-12-medium text-text-weak">stdout</div>
                                    <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                                      {String(output().stdout ?? "")}
                                    </pre>
                                  </div>
                                  <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                    <div class="text-12-medium text-text-weak">stderr</div>
                                    <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                                      {String(output().stderr ?? "")}
                                    </pre>
                                  </div>
                                </>
                              )}
                            </Show>
                          </Tabs.Content>

                          <Tabs.Content value="artifacts" class="space-y-3">
                            <Show
                              when={selectedAttempt()?.attempt.output_json}
                              fallback={
                                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                  No attempt artifacts were persisted for this node.
                                </div>
                              }
                            >
                              {(output) => (
                                <>
                                  <Show when={Array.isArray(output().changed_paths)}>
                                    <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                      <div class="text-12-medium text-text-weak">Changed Paths</div>
                                      <div class="pt-2 text-12-regular text-text-strong">
                                        {(output().changed_paths as string[]).join(", ") || "none"}
                                      </div>
                                    </div>
                                  </Show>
                                  <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                    <div class="text-12-medium text-text-weak">Attempt Output</div>
                                    <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">
                                      {pretty(output())}
                                    </pre>
                                  </div>
                                </>
                              )}
                            </Show>
                          </Tabs.Content>

                          <Tabs.Content value="attempts" class="space-y-3">
                            <Show
                              when={node().attempts.length > 0}
                              fallback={
                                <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                                  This node has not created attempts.
                                </div>
                              }
                            >
                              <For each={node().attempts}>
                                {(attempt) => (
                                  <button
                                    type="button"
                                    data-component="run-node-attempt-row"
                                    data-attempt={attempt.attempt.attempt_index}
                                    class="w-full rounded-lg border border-border-weak-base px-3 py-2 text-left"
                                    classList={{
                                      "ring-1 ring-icon-info-base":
                                        selectedAttempt()?.attempt.id === attempt.attempt.id,
                                    }}
                                    onClick={() =>
                                      setSearch({
                                        node: node().node.node_id,
                                        panel: "attempts",
                                        attempt: `${attempt.attempt.attempt_index}`,
                                      })
                                    }
                                  >
                                    <div class="flex items-start justify-between gap-3">
                                      <div>
                                        <div class="text-13-medium text-text-strong">
                                          Attempt {attempt.attempt.attempt_index}
                                        </div>
                                        <div class="text-12-regular text-text-weak">
                                          {attempt.attempt.status} • started {stamp(attempt.attempt.started_at)}
                                        </div>
                                      </div>
                                      <Show when={attempt.session?.link.role}>
                                        {(role) => (
                                          <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                                            {role()}
                                          </span>
                                        )}
                                      </Show>
                                    </div>
                                  </button>
                                )}
                              </For>
                            </Show>
                          </Tabs.Content>
                        </Tabs>
                      </>
                    )}
                  </Show>
                </section>
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
