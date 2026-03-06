import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch as SolidSwitch } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { Persist, persisted } from "@/utils/persist"
import {
  approveHistoryDraft,
  createHistoryDraft,
  loadHistoryDrafts,
  loadHistoryOperations,
  loadHistoryRuns,
  rejectHistoryDraft,
  sendHistoryDraft,
  updateHistoryDraft,
  type HistoryDraft,
  type HistoryRun,
} from "./history-data"
import {
  createDraftEditor,
  draftCanEdit,
  draftCanSend,
  draftCreateInput,
  draftNeedsApproval,
  draftReasonCodes,
  draftRemediation,
  draftUpdateInput,
  hasMaterialChanges,
  scopeFromDraftStatus,
  type DraftEditor,
} from "./history-drafts"
import {
  applyDebugToggle,
  counters,
  duplicate,
  focusFromQuery,
  parseHistoryQuery,
  resolveDebug,
  type DraftScope,
  type HistoryTab,
} from "./history-state"

type DraftEditorTextField = Exclude<keyof DraftEditor, "source_kind">

const message = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Failed to load history."
}

const stamp = (value: number) => new Date(value).toLocaleString()
const humanize = (value: string) => value.replace(/_/g, " ")
const prettyJson = (value: Record<string, unknown>) => JSON.stringify(value, null, 2)
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined)
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const draftSourceLabel = (value: HistoryDraft["source_kind"]) => (value === "system_report" ? "system report" : value)

function outcome(item: HistoryRun) {
  if (item.status !== "skipped") return
  if (item.reason_code === "duplicate_event") {
    const meta = item.trigger_metadata ?? {}
    return {
      title: "Ignored duplicate signal.",
      lines: [
        text(meta.signal) ? `signal: ${text(meta.signal)}` : undefined,
        number(meta.event_time) !== undefined ? `event_time: ${number(meta.event_time)}` : undefined,
        text(meta.provider_event_id) ? `provider_event_id: ${text(meta.provider_event_id)}` : undefined,
        text(meta.dedupe_key) ? `dedupe_key: ${text(meta.dedupe_key)}` : undefined,
      ].filter((item): item is string => !!item),
    }
  }

  if (item.trigger_type === "cron") {
    const meta = item.trigger_metadata ?? {}
    if (meta.summary === true) {
      return {
        title: `Skipped ${number(meta.skipped_count) ?? 0} additional missed cron slots.`,
        lines: [
          text(meta.first_slot_local) ? `first_slot_local: ${text(meta.first_slot_local)}` : undefined,
          text(meta.last_slot_local) ? `last_slot_local: ${text(meta.last_slot_local)}` : undefined,
        ].filter((item): item is string => !!item),
      }
    }

    return {
      title: item.reason_code === "dst_gap_skipped" ? "Skipped cron slot during DST forward jump." : "Missed cron slot.",
      lines: [
        text(meta.slot_local) ? `slot_local: ${text(meta.slot_local)}` : undefined,
        meta.slot_utc === null ? "slot_utc: -" : number(meta.slot_utc) !== undefined ? `slot_utc: ${number(meta.slot_utc)}` : undefined,
      ].filter((item): item is string => !!item),
    }
  }

  return {
    title: "Skipped trigger outcome.",
    lines: [],
  }
}

const tone = (value: string) => {
  if (value === "blocked" || value === "failed") {
    return "border border-border-weak-base bg-background-base text-icon-critical-base"
  }
  if (value === "approved" || value === "auto_approved" || value === "sent" || value === "finalized") {
    return "border border-border-weak-base bg-background-base text-icon-success-base"
  }
  if (value === "dispatching" || value === "remote_accepted") {
    return "border border-border-weak-base bg-background-base text-icon-info-base"
  }
  if (value === "rejected") {
    return "border border-border-weak-base bg-background-base text-text-weak"
  }
  return "border border-border-weak-base bg-background-base text-text-strong"
}

function DraftMeta(props: { label: string; value?: string | null }) {
  return (
    <div class="space-y-1">
      <p class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{props.label}</p>
      <p class="text-12-regular text-text-strong break-all">{props.value || "-"}</p>
    </div>
  )
}

function DraftForm(props: {
  mode: "create" | "edit"
  value: DraftEditor
  saving: boolean
  error: string
  invalidating: boolean
  onText: (key: DraftEditorTextField, value: string) => void
  onSourceKind: (value: DraftEditor["source_kind"]) => void
  onCancel: () => void
  onSubmit: (event: SubmitEvent) => void
}) {
  const title = () => (props.mode === "create" ? "New Draft" : "Edit Draft")
  const copy = () =>
    props.mode === "create"
      ? "Review a generic outbound envelope before approval and dispatch."
      : "Edit the material envelope fields for this draft."
  const submit = () => {
    if (props.mode === "create") return props.saving ? "Creating..." : "Create Draft"
    return props.saving ? "Saving..." : "Save Changes"
  }

  return (
    <form
      data-component={props.mode === "create" ? "history-draft-create-form" : "history-draft-edit-form"}
      onSubmit={props.onSubmit}
      class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-4"
    >
      <div class="space-y-1">
        <h2 class="text-14-medium text-text-strong">{title()}</h2>
        <p class="text-12-regular text-text-weak">{copy()}</p>
      </div>

      <div class="space-y-2">
        <p class="text-12-medium text-text-weak">Source Kind</p>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            size="small"
            variant={props.value.source_kind === "user" ? "secondary" : "ghost"}
            onClick={() => props.onSourceKind("user")}
          >
            User
          </Button>
          <Button
            type="button"
            size="small"
            variant={props.value.source_kind === "system" ? "secondary" : "ghost"}
            onClick={() => props.onSourceKind("system")}
          >
            System
          </Button>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <Show when={props.mode === "create"}>
          <TextField
            label="Run ID (optional)"
            value={props.value.run_id}
            placeholder="run_..."
            onChange={(value) => props.onText("run_id", value)}
            class="font-mono text-xs"
          />
        </Show>
        <TextField
          label="Adapter ID"
          value={props.value.adapter_id}
          onChange={(value) => props.onText("adapter_id", value)}
          class="font-mono text-xs"
        />
        <TextField
          label="Integration ID"
          value={props.value.integration_id}
          onChange={(value) => props.onText("integration_id", value)}
          class="font-mono text-xs"
        />
        <TextField
          label="Action ID"
          value={props.value.action_id}
          onChange={(value) => props.onText("action_id", value)}
          class="font-mono text-xs"
        />
        <TextField
          label="Target"
          value={props.value.target}
          onChange={(value) => props.onText("target", value)}
          class="font-mono text-xs"
        />
        <TextField
          label="Payload Schema Version"
          value={props.value.payload_schema_version}
          onChange={(value) => props.onText("payload_schema_version", value)}
          class="font-mono text-xs"
        />
      </div>

      <TextField
        multiline
        label="Payload JSON"
        value={props.value.payload_json}
        onChange={(value) => props.onText("payload_json", value)}
        class="min-h-40 font-mono text-xs"
      />

      <Show when={props.invalidating}>
        <div
          data-component="history-draft-material-warning"
          class="rounded-md border border-border-weak-base bg-background-base p-3 text-12-regular text-icon-critical-base"
        >
          Material changes will clear approval on save.
        </div>
      </Show>

      <p class="text-12-regular text-text-weak">Preview text is recomputed from the adapter payload after save.</p>

      <Show when={props.error}>
        {(value) => (
          <div class="rounded-md border border-border-weak-base bg-background-base p-3 text-12-regular text-icon-critical-base">
            {value()}
          </div>
        )}
      </Show>

      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel} disabled={props.saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={props.saving}>
          {submit()}
        </Button>
      </div>
    </form>
  )
}

export default function History() {
  const sdk = useSDK()
  const server = useServer()
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const initial = parseHistoryQuery(location.search)

  const [prefs, setPrefs] = persisted(Persist.workspace(sdk.directory, "history.page"), createStore({ debug: false }))

  const [tab, setTab] = createSignal<HistoryTab>(initial.tab ?? (initial.draft_id ? "drafts" : initial.operation_id ? "operations" : "runs"))
  const [draftScope, setDraftScope] = createSignal<DraftScope>(initial.scope ?? "pending")
  const [debugOverride, setDebugOverride] = createSignal<boolean | undefined>(initial.debug)
  const [includeUser, setIncludeUser] = createSignal(false)
  const [focus, setFocus] = createSignal(focusFromQuery(initial))
  const [eventDetail, setEventDetail] = createSignal<string | undefined>()

  const [runsState, setRunsState] = createStore({
    items: [] as Awaited<ReturnType<typeof loadHistoryRuns>>["items"],
    next_cursor: null as string | null,
    hidden_debug_count: 0,
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

  const [draftsState, setDraftsState] = createStore({
    items: [] as Awaited<ReturnType<typeof loadHistoryDrafts>>["items"],
    next_cursor: null as string | null,
    endpoint: "",
    loading: false,
    loadingMore: false,
    error: "",
  })

  const [runsRefresh, setRunsRefresh] = createSignal(0)
  const [operationsRefresh, setOperationsRefresh] = createSignal(0)
  const [draftsRefresh, setDraftsRefresh] = createSignal(0)

  const [draftEditor, setDraftEditor] = createStore({
    mode: "closed" as "closed" | "create" | "edit",
    id: "",
    values: createDraftEditor(),
    error: "",
    saving: false,
  })

  const [draftAction, setDraftAction] = createStore({
    id: "",
    kind: "" as "" | "approve" | "reject" | "send",
    loading: false,
  })

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

  const editingDraft = createMemo(() => {
    if (draftEditor.mode !== "edit") return
    return draftsState.items.find((item) => item.id === draftEditor.id)
  })

  const invalidatingEdit = createMemo(() => {
    const item = editingDraft()
    if (!item) return false
    if (item.status !== "approved" && item.status !== "auto_approved") return false
    return hasMaterialChanges(item, draftEditor.values)
  })

  const query = (input: {
    tab: HistoryTab
    scope?: DraftScope
    run_id?: string
    operation_id?: string
    draft_id?: string
  }) => {
    const value = new URLSearchParams(location.search)
    value.set("tab", input.tab)
    if (input.scope) {
      value.set("scope", input.scope)
    }
    if (!input.scope) {
      value.delete("scope")
    }
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
    if (input.draft_id) {
      value.set("draft_id", input.draft_id)
    }
    if (!input.draft_id) {
      value.delete("draft_id")
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
    setRunsState("hidden_debug_count", result.hidden_debug_count)

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

  let draftsID = 0
  const loadDrafts = async (cursor?: string) => {
    const append = !!cursor
    const id = ++draftsID

    if (append) setDraftsState("loadingMore", true)
    if (!append) setDraftsState("loading", true)

    const result = await loadHistoryDrafts({
      baseUrl: sdk.url,
      directory: sdk.directory,
      auth: auth(),
      workspace: workspace(),
      include_debug: showDebug(),
      scope: draftScope(),
      cursor,
    }).catch((error) => error)

    if (id !== draftsID) return

    if (result instanceof Error) {
      setDraftsState("error", message(result))
      if (append) setDraftsState("loadingMore", false)
      if (!append) setDraftsState("loading", false)
      return
    }

    setDraftsState("error", "")
    setDraftsState("endpoint", result.endpoint)
    setDraftsState("next_cursor", result.next_cursor)

    if (append) {
      setDraftsState("items", (items) => [...items, ...result.items])
      setDraftsState("loadingMore", false)
      return
    }

    setDraftsState("items", result.items)
    setDraftsState("loading", false)
  }

  const refreshRunsList = () => {
    setRunsState("items", [])
    setRunsState("next_cursor", null)
    setRunsState("hidden_debug_count", 0)
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

  const refreshDraftsList = () => {
    setDraftsState("items", [])
    setDraftsState("next_cursor", null)
    setDraftsState("loadingMore", false)
    setDraftsState("error", "")
    void loadDrafts()
  }

  const closeDraftEditor = () =>
    setDraftEditor({
      mode: "closed",
      id: "",
      values: createDraftEditor(),
      error: "",
      saving: false,
    })

  const openDraftCreate = () =>
    setDraftEditor({
      mode: "create",
      id: "",
      values: createDraftEditor(),
      error: "",
      saving: false,
    })

  const openDraftEdit = (item: HistoryDraft) =>
    setDraftEditor({
      mode: "edit",
      id: item.id,
      values: createDraftEditor(item),
      error: "",
      saving: false,
    })

  const setDraftText = (key: DraftEditorTextField, value: string) => {
    setDraftEditor("values", key, value)
    if (draftEditor.error) setDraftEditor("error", "")
  }

  const setDraftSourceKind = (value: DraftEditor["source_kind"]) => {
    setDraftEditor("values", "source_kind", value)
    if (draftEditor.error) setDraftEditor("error", "")
  }

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

  const openDraft = (draft_id: string, scope: DraftScope) => {
    setTab("drafts")
    setDraftScope(scope)
    setFocus({ tab: "drafts", id: draft_id })
    query({ tab: "drafts", scope, draft_id })
  }

  const applyDraftResult = (item: HistoryDraft, title: string) => {
    const scope = scopeFromDraftStatus(item.status)
    closeDraftEditor()
    setFocus({ tab: "drafts", id: item.id })
    showToast({
      variant: item.status === "blocked" || item.status === "failed" ? undefined : "success",
      icon: item.status === "blocked" || item.status === "failed" ? undefined : "circle-check",
      title,
      description: `${humanize(item.status)} - ${item.id}`,
    })

    if (draftScope() !== scope) {
      openDraft(item.id, scope)
      return
    }

    query({ tab: "drafts", scope, draft_id: item.id })
    setDraftsRefresh((value) => value + 1)
  }

  const submitDraftCreate = async () => {
    const payload = draftCreateInput(draftEditor.values)
    if (!payload.ok) {
      setDraftEditor("error", payload.error)
      return
    }

    setDraftEditor("saving", true)
    const result = await createHistoryDraft({
      baseUrl: sdk.url,
      directory: sdk.directory,
      auth: auth(),
      workspace: workspace(),
      body: payload.value,
    }).catch((error) => error)

    setDraftEditor("saving", false)

    if (result instanceof Error) {
      setDraftEditor("error", message(result))
      showToast({
        title: "Create Draft",
        description: message(result),
      })
      return
    }

    applyDraftResult(result, "Draft created")
  }

  const submitDraftEdit = async (item: HistoryDraft) => {
    const payload = draftUpdateInput(item, draftEditor.values)
    if (!payload.ok) {
      setDraftEditor("error", payload.error)
      return
    }

    setDraftEditor("saving", true)
    const result = await updateHistoryDraft({
      baseUrl: sdk.url,
      directory: sdk.directory,
      auth: auth(),
      workspace: workspace(),
      draft_id: item.id,
      body: payload.value,
    }).catch((error) => error)

    setDraftEditor("saving", false)

    if (result instanceof Error) {
      setDraftEditor("error", message(result))
      showToast({
        title: "Save Draft",
        description: message(result),
      })
      return
    }

    applyDraftResult(
      result,
      result.block_reason_code === "material_edit_invalidation" ? "Draft updated and approval reset" : "Draft updated",
    )
  }

  const controlDraft = async (item: HistoryDraft, kind: "approve" | "reject" | "send") => {
    setDraftAction({
      id: item.id,
      kind,
      loading: true,
    })

    const action =
      kind === "approve"
        ? approveHistoryDraft
        : kind === "reject"
          ? rejectHistoryDraft
          : sendHistoryDraft

    const result = await action({
      baseUrl: sdk.url,
      directory: sdk.directory,
      auth: auth(),
      workspace: workspace(),
      draft_id: item.id,
      body: {
        actor_type: "user",
      },
    }).catch((error) => error)

    setDraftAction({
      id: "",
      kind: "",
      loading: false,
    })

    if (result instanceof Error) {
      showToast({
        title: `${humanize(kind)} Draft`,
        description: message(result),
      })
      return
    }

    applyDraftResult(
      result,
      `Draft ${kind === "approve" ? "approved" : kind === "reject" ? "rejected" : "sent"}`,
    )
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

  const rowBusy = (id: string) => {
    if (draftEditor.saving && draftEditor.mode === "edit" && draftEditor.id === id) return true
    return draftAction.loading && draftAction.id === id
  }

  const createBusy = () => draftEditor.saving && draftEditor.mode === "create"

  createEffect(() => {
    const next = parseHistoryQuery(location.search)
    setTab(next.tab ?? (next.draft_id ? "drafts" : next.operation_id ? "operations" : "runs"))
    setDraftScope(next.scope ?? "pending")
    setDebugOverride(next.debug)
    setFocus(focusFromQuery(next))
  })

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
    if (tab() !== "drafts") return
    showDebug()
    draftScope()
    draftsRefresh()
    workspace()
    refreshDraftsList()
  })

  createEffect(() => {
    const target = focus()
    if (!target) return
    if (target.tab !== tab()) return

    const selector =
      target.tab === "runs"
        ? `[data-component="history-run-row"][data-id="${target.id}"]`
        : target.tab === "operations"
          ? `[data-component="history-operation-row"][data-id="${target.id}"]`
          : `[data-component="history-draft-row"][data-id="${target.id}"]`

    queueMicrotask(() => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return
      element.scrollIntoView({ block: "center" })
    })
  })

  const draftBody = () => (
    <div class="space-y-4">
      <Show when={draftEditor.mode === "create"}>
        <DraftForm
          mode="create"
          value={draftEditor.values}
          saving={createBusy()}
          error={draftEditor.error}
          invalidating={false}
          onText={setDraftText}
          onSourceKind={setDraftSourceKind}
          onCancel={closeDraftEditor}
          onSubmit={(event) => {
            event.preventDefault()
            void submitDraftCreate()
          }}
        />
      </Show>

      <SolidSwitch>
        <Match when={draftsState.loading}>
          <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">
            {draftScope() === "pending" ? "Loading pending drafts..." : "Loading processed drafts..."}
          </div>
        </Match>
        <Match when={draftsState.error}>
          <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
            {draftsState.error}
          </div>
        </Match>
        <Match when={draftsState.items.length === 0}>
          <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">
            {draftScope() === "pending" ? "No pending drafts were returned." : "No processed drafts were returned."}
          </div>
        </Match>
        <Match when={true}>
          <div class="space-y-3">
            <For each={draftsState.items}>
              {(item) => {
                const focused = () => focus()?.tab === "drafts" && focus()?.id === item.id
                const editing = () => draftEditor.mode === "edit" && draftEditor.id === item.id
                const reasons = () => draftReasonCodes(item)
                const remediation = () => draftRemediation(item)
                const sendBlocked = () => draftNeedsApproval(item.status)

                return (
                  <section
                    data-component="history-draft-row"
                    data-id={item.id}
                    data-status={item.status}
                    data-focused={focused() ? "true" : "false"}
                    class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-4"
                    classList={{
                      "ring-1 ring-icon-info-base": focused(),
                      "bg-surface-warning-base/10": item.status === "blocked" || item.block_reason_code === "material_edit_invalidation",
                    }}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="space-y-1 min-w-0">
                        <p class="text-14-medium text-text-strong break-all">{item.id}</p>
                          <p class="text-12-regular text-text-weak">
                          {humanize(item.status)} • {draftSourceLabel(item.source_kind)} • updated {stamp(item.updated_at)}
                        </p>
                      </div>
                      <div class="flex flex-wrap justify-end gap-2 shrink-0">
                        <span
                          data-component="history-draft-status"
                          class={`rounded-md px-2.5 py-1 text-12-medium ${tone(item.status)}`}
                        >
                          {humanize(item.status)}
                        </span>
                        <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                          {item.adapter_id} / {item.action_id}
                        </span>
                        <Show when={item.source_kind === "system_report"}>
                          <span
                            data-component="history-draft-source"
                            class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak"
                          >
                            System Report
                          </span>
                        </Show>
                      </div>
                    </div>

                    <div class="rounded-md border border-border-weak-base bg-background-base p-3 space-y-2">
                      <p class="text-11-medium uppercase tracking-[0.08em] text-text-weak">Preview</p>
                      <p class="text-12-regular text-text-strong whitespace-pre-wrap break-words">{item.preview_text}</p>
                    </div>

                    <Show when={reasons().length > 0}>
                      <div class="flex flex-wrap gap-2">
                        <For each={reasons()}>
                          {(code) => (
                            <span
                              data-component="history-draft-reason"
                              data-code={code}
                              class={`rounded-md px-2 py-1 text-12-regular ${tone(code)}`}
                            >
                              {code}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={remediation()}>
                      {(value) => (
                        <div
                          data-component="history-draft-remediation"
                          class="rounded-md border border-border-weak-base bg-background-base p-3 text-12-regular text-text-strong"
                        >
                          {value()}
                        </div>
                      )}
                    </Show>

                    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <DraftMeta label="Integration" value={item.integration_id} />
                      <DraftMeta label="Target" value={item.target} />
                      <DraftMeta label="Run ID" value={item.run_id} />
                      <DraftMeta label="Material Hash" value={item.material_hash} />
                      <DraftMeta label="Policy ID" value={item.policy_id} />
                      <DraftMeta label="Policy Version" value={item.policy_version} />
                      <DraftMeta label="Decision ID" value={item.decision_id} />
                      <DraftMeta label="Decision Reason" value={item.decision_reason_code} />
                    </div>

                    <div class="rounded-md border border-border-weak-base bg-background-base p-3 space-y-3">
                      <div class="flex items-center justify-between gap-3">
                        <p class="text-12-medium text-text-strong">Dispatch</p>
                        <Show
                          when={item.dispatch}
                          fallback={<span class="text-12-regular text-text-weak">No dispatch attempt yet.</span>}
                        >
                          {(dispatch) => (
                            <span class={`rounded-md px-2 py-1 text-12-medium ${tone(dispatch().state)}`}>
                              {humanize(dispatch().state)}
                            </span>
                          )}
                        </Show>
                      </div>

                      <Show when={item.dispatch}>
                        {(dispatch) => (
                          <div data-component="history-draft-dispatch" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <DraftMeta label="Attempt ID" value={dispatch().id} />
                            <DraftMeta label="Idempotency Key" value={dispatch().idempotency_key} />
                            <DraftMeta label="Remote Reference" value={dispatch().remote_reference} />
                            <DraftMeta label="Dispatch Reason" value={dispatch().block_reason_code} />
                          </div>
                        )}
                      </Show>
                    </div>

                    <Show when={editing()} fallback={
                      <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            data-component="history-draft-action-approve"
                            disabled={rowBusy(item.id) || item.status === "approved" || item.status === "auto_approved"}
                            onClick={() => void controlDraft(item, "approve")}
                          >
                            Approve
                          </Button>
                          <Show when={draftCanSend(item.status)}>
                            <Button
                              type="button"
                              variant="primary"
                              data-component="history-draft-action-send"
                              disabled={rowBusy(item.id) || sendBlocked()}
                              onClick={() => void controlDraft(item, "send")}
                            >
                              Send Now
                            </Button>
                          </Show>
                          <Button
                            type="button"
                            variant="ghost"
                            data-component="history-draft-action-reject"
                            disabled={rowBusy(item.id) || item.status === "rejected"}
                            onClick={() => void controlDraft(item, "reject")}
                          >
                            Reject
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            data-component="history-draft-action-edit"
                            disabled={!draftCanEdit(item) || rowBusy(item.id)}
                            onClick={() => openDraftEdit(item)}
                          >
                            Edit
                          </Button>
                          <Show when={item.run_id}>
                            {(run_id) => (
                              <Button type="button" variant="ghost" onClick={() => openRun(run_id())}>
                                Open Run
                              </Button>
                            )}
                          </Show>
                        </div>

                        <Show when={draftCanSend(item.status) && sendBlocked()}>
                          <p data-component="history-draft-send-hint" class="text-12-regular text-text-weak">
                            Approve first. Send does not imply approval.
                          </p>
                        </Show>
                      </div>
                    }>
                      <DraftForm
                        mode="edit"
                        value={draftEditor.values}
                        saving={draftEditor.saving}
                        error={draftEditor.error}
                        invalidating={invalidatingEdit()}
                        onText={setDraftText}
                        onSourceKind={setDraftSourceKind}
                        onCancel={closeDraftEditor}
                        onSubmit={(event) => {
                          event.preventDefault()
                          void submitDraftEdit(item)
                        }}
                      />
                    </Show>

                    <div class="rounded-md border border-border-weak-base bg-background-base p-3">
                      <p class="text-11-medium uppercase tracking-[0.08em] text-text-weak mb-2">Payload JSON</p>
                      <pre class="text-12-mono text-text-strong whitespace-pre-wrap break-words">{prettyJson(item.payload_json)}</pre>
                    </div>
                  </section>
                )
              }}
            </For>

            <Show when={draftsState.next_cursor}>
              {(cursor) => (
                <Button
                  variant="ghost"
                  data-component="history-load-more"
                  data-tab="drafts"
                  onClick={() => {
                    if (draftsState.loadingMore) return
                    void loadDrafts(cursor())
                  }}
                >
                  {draftsState.loadingMore ? "Loading..." : "Load More"}
                </Button>
              )}
            </Show>
          </div>
        </Match>
      </SolidSwitch>
    </div>
  )

  return (
    <div data-page="history" class="size-full overflow-y-auto">
      <div class="mx-auto max-w-6xl p-6 flex flex-col gap-4">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <h1 class="text-16-medium text-text-strong">History</h1>
            <p class="text-13-regular text-text-weak">
              Runs, operations, and outbound drafts are listed with deterministic history ordering.
            </p>
            <Show when={tab() === "runs" && runsState.endpoint}>
              <p class="text-12-mono text-text-weak">source: <span>{runsState.endpoint}</span></p>
            </Show>
            <Show when={tab() === "operations" && operationsState.endpoint}>
              <p class="text-12-mono text-text-weak">source: <span>{operationsState.endpoint}</span></p>
            </Show>
            <Show when={tab() === "drafts" && draftsState.endpoint}>
              <p class="text-12-mono text-text-weak">source: <span>{draftsState.endpoint}</span></p>
            </Show>
          </div>

          <div class="flex items-center gap-2">
            <Show when={tab() === "drafts"}>
              <Button
                variant={draftEditor.mode === "create" ? "secondary" : "ghost"}
                data-component="history-draft-create-toggle"
                onClick={() => {
                  if (draftEditor.mode === "create") {
                    closeDraftEditor()
                    return
                  }
                  openDraftCreate()
                }}
              >
                {draftEditor.mode === "create" ? "Cancel Draft" : "New Draft"}
              </Button>
            </Show>

            <Button
              variant="ghost"
              data-component="history-refresh"
              onClick={() => {
                if (tab() === "runs") {
                  setRunsRefresh((value) => value + 1)
                  return
                }
                if (tab() === "operations") {
                  setOperationsRefresh((value) => value + 1)
                  return
                }
                setDraftsRefresh((value) => value + 1)
              }}
            >
              Refresh
            </Button>
          </div>
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
              <Show when={!showDebug() && runsState.hidden_debug_count > 0}>
                <span data-component="history-hidden-debug-count">
                  Hidden debug sessions: <strong class="text-text-strong">{runsState.hidden_debug_count}</strong>
                </span>
              </Show>
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
            <Tabs.Trigger
              value="drafts"
              data-component="history-tab-trigger"
              data-tab="drafts"
              onClick={() => {
                setTab("drafts")
                setFocus(undefined)
                query({ tab: "drafts", scope: draftScope() })
              }}
            >
              Drafts
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
                      const isSkipped = () => item.status === "skipped"
                      const focused = () => focus()?.tab === "runs" && focus()?.id === item.id
                      const detail = () => outcome(item)

                      return (
                        <section
                          data-component="history-run-row"
                          data-id={item.id}
                          data-duplicate={isDuplicate() ? "true" : "false"}
                          data-skipped={isSkipped() ? "true" : "false"}
                          data-focused={focused() ? "true" : "false"}
                          class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-3"
                          classList={{
                            "ring-1 ring-icon-info-base": focused(),
                            "bg-surface-warning-base/10": isSkipped(),
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
                              <div class="flex flex-wrap justify-end gap-2">
                                <Show when={item.debug}>
                                  <span
                                    data-component="history-run-debug"
                                    class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak"
                                  >
                                    Debug
                                  </span>
                                </Show>
                                <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                                  {item.workflow_id}
                                </span>
                              </div>
                            </Show>
                            <Show when={!item.workflow_id && item.debug}>
                              <span
                                data-component="history-run-debug"
                                class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak"
                              >
                                Debug
                              </span>
                            </Show>
                          </div>

                          <div class="flex flex-wrap items-center gap-2">
                            <Show when={isSkipped()}>
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

                            <Show when={!isSkipped() && item.session_id}>
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

                            <Show
                              when={!isSkipped()}
                              fallback={
                                <span class="text-12-regular text-text-weak rounded-md border border-border-weak-base px-2 py-1">
                                  No operation expected
                                </span>
                              }
                            >
                              <>
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
                              </>
                            </Show>
                          </div>

                          <Show when={isSkipped() && eventDetail() === item.id}>
                            <div class="rounded-md border border-border-weak-base bg-background-base p-3 text-12-regular text-text-strong">
                              <p>{detail()?.title}</p>
                              <For each={detail()?.lines ?? []}>
                                {(line) => <p class="text-text-weak">{line}</p>}
                              </For>
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

          <Tabs.Content value="drafts" class="pt-4">
            <Tabs value={draftScope()} variant="pill" data-scope="history-drafts">
              <Tabs.List>
                <Tabs.Trigger
                  value="pending"
                  data-component="history-draft-scope-trigger"
                  data-scope="pending"
                  onClick={() => {
                    setDraftScope("pending")
                    setFocus(undefined)
                    query({ tab: "drafts", scope: "pending" })
                  }}
                >
                  Pending
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="processed"
                  data-component="history-draft-scope-trigger"
                  data-scope="processed"
                  onClick={() => {
                    setDraftScope("processed")
                    setFocus(undefined)
                    query({ tab: "drafts", scope: "processed" })
                  }}
                >
                  Processed
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>

            <div class="pt-4">{draftBody()}</div>
          </Tabs.Content>
        </Tabs>
      </div>
    </div>
  )
}
