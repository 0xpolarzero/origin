import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "@/context/server"
import { createDebugReport, loadDebugReportPreview, type HistoryDebugReportField } from "@/pages/history-data"

const message = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Request failed."
}

export function DialogDebugReport(props: { directory: string; runID: string; workspaceID: string }) {
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const [consent, setConsent] = createSignal(false)
  const [includePrompt, setIncludePrompt] = createSignal(false)
  const [includeFiles, setIncludeFiles] = createSignal(false)
  const [state, setState] = createStore({
    loading: true,
    saving: false,
    error: "",
    preview: undefined as Awaited<ReturnType<typeof loadDebugReportPreview>> | undefined,
  })

  const baseUrl = createMemo(() => server.current?.http.url)
  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const load = async () => {
    const url = baseUrl()
    if (!url) {
      setState("loading", false)
      setState("error", "Server connection is unavailable.")
      return
    }

    setState("loading", true)
    setState("error", "")
    const result = await loadDebugReportPreview({
      baseUrl: url,
      directory: props.directory,
      auth: auth(),
      workspace: props.workspaceID,
      run_id: props.runID,
    }).catch((error) => error)

    setState("loading", false)

    if (result instanceof Error) {
      setState("error", message(result))
      return
    }

    setState("preview", result)
  }

  const submit = async () => {
    const preview = state.preview
    const url = baseUrl()
    if (!preview || !url || !consent() || state.saving) return

    setState("saving", true)
    setState("error", "")
    const result = await createDebugReport({
      baseUrl: url,
      directory: props.directory,
      auth: auth(),
      workspace: props.workspaceID,
      run_id: props.runID,
      body: {
        consent: true,
        target: preview.target,
        include_prompt: includePrompt(),
        include_files: includeFiles(),
      },
    }).catch((error) => error)

    setState("saving", false)

    if (result instanceof Error) {
      const description = message(result)
      setState("error", description)
      showToast({
        title: "Stop and Report",
        description,
      })
      return
    }

    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: "Report Draft Created",
      description: result.draft.id,
    })
    navigate(
      `/${base64Encode(props.directory)}/history?tab=drafts&scope=pending&draft_id=${encodeURIComponent(result.draft.id)}&workspace=${encodeURIComponent(props.workspaceID)}`,
    )
  }

  const optional = createMemo(() =>
    (state.preview?.fields ?? []).filter((item) => item.id === "prompt" || item.id === "files"),
  )

  const checked = (field: HistoryDebugReportField) => {
    if (field.id === "metadata") return true
    if (field.id === "prompt") return includePrompt()
    return includeFiles()
  }

  const setChecked = (field: HistoryDebugReportField, next: boolean) => {
    if (field.id === "prompt") {
      setIncludePrompt(next)
      return
    }
    if (field.id === "files") setIncludeFiles(next)
  }

  onMount(() => {
    void load()
  })

  return (
    <Dialog title="Stop and Report" class="w-full max-w-[760px] mx-auto">
      <div data-component="debug-report-dialog" class="space-y-4">
        <p class="text-13-regular text-text-weak">
          Stop this debug reconciliation run and create a reviewable draft for developers. Metadata is always included;
          prompt and file data require explicit opt-in.
        </p>

        <Show when={state.loading}>
          <div class="rounded-md border border-border-weak-base bg-background-base p-3 text-12-regular text-text-weak">
            Loading report preview...
          </div>
        </Show>

        <Show when={state.error}>
          {(value) => (
            <div class="rounded-md border border-border-weak-base bg-background-base p-3 text-12-regular text-icon-critical-base">
              {value()}
            </div>
          )}
        </Show>

        <Show when={state.preview}>
          {(preview) => (
            <>
              <div class="rounded-md border border-border-weak-base bg-background-base p-3 space-y-1">
                <p class="text-11-medium uppercase tracking-[0.08em] text-text-weak">Target</p>
                <p class="text-12-regular text-text-strong break-all">{preview().target}</p>
              </div>

              <div class="rounded-md border border-border-weak-base bg-background-base p-3 space-y-2">
                <div class="flex items-start gap-3">
                  <input type="checkbox" checked disabled />
                  <div class="space-y-1">
                    <p class="text-12-medium text-text-strong">Runtime metadata</p>
                    <p class="text-12-regular text-text-weak">Always included.</p>
                  </div>
                </div>
                <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words text-12-mono text-text-strong">
                  {preview().fields.find((item) => item.id === "metadata")?.preview ?? ""}
                </pre>
              </div>

              <For each={optional()}>
                {(field) => (
                  <div data-component="debug-report-field" data-id={field.id} class="rounded-md border border-border-weak-base bg-background-base p-3 space-y-2">
                    <label class="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checked(field)}
                        onChange={(event) => setChecked(field, event.currentTarget.checked)}
                      />
                      <div class="space-y-1">
                        <p class="text-12-medium text-text-strong">{field.title}</p>
                        <p class="text-12-regular text-text-weak">
                          {field.id === "prompt" ? "Off by default." : "Off by default."}
                        </p>
                      </div>
                    </label>
                    <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words text-12-mono text-text-strong">
                      {field.preview}
                    </pre>
                  </div>
                )}
              </For>

              <label class="flex items-start gap-3 rounded-md border border-border-weak-base bg-background-base p-3">
                <input
                  data-component="debug-report-consent"
                  type="checkbox"
                  checked={consent()}
                  onChange={(event) => setConsent(event.currentTarget.checked)}
                />
                <span class="text-12-regular text-text-strong">
                  I understand this creates a draft containing the selected report data for developer review.
                </span>
              </label>
            </>
          )}
        </Show>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()} disabled={state.saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            data-component="debug-report-submit"
            disabled={state.loading || state.saving || !state.preview || !consent()}
            onClick={() => void submit()}
          >
            {state.saving ? "Creating..." : "Create Report Draft"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
