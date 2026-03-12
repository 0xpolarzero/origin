import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { TextField } from "@opencode-ai/ui/text-field"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { copyLibrary, deleteLibrary, loadLibraryDetail, loadLibraryHistory, saveLibrary } from "./library-data"

const tabs = new Set(["content", "used", "history"])

const stamp = (value: number | null) => (value ? new Date(value).toLocaleString() : "-")

const msg = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return "Failed to load library detail."
}

const kind = (value?: string) => {
  if (value === "prompt_template") return "Prompt template"
  if (value === "script") return "Script"
  if (value === "query") return "Query"
  return "Unknown"
}

export default function LibraryDetailPage() {
  const sdk = useSDK()
  const server = useServer()
  const navigate = useNavigate()
  const params = useParams()
  const [search, setSearch] = useSearchParams()
  const [txt, setTxt] = createSignal("")
  const [rev, setRev] = createSignal("")
  const [copy, setCopy] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [copying, setCopying] = createSignal(false)
  const [removing, setRemoving] = createSignal(false)
  const [err, setErr] = createSignal("")
  const [ok, setOk] = createSignal("")

  const auth = createMemo(() => {
    const http = server.current?.http
    if (!http?.password) return
    return `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
  })

  const tab = createMemo(() => {
    const value = typeof search.tab === "string" ? search.tab : search.tab?.[0]
    return value && tabs.has(value) ? value : "content"
  })
  const changeTab = (next: string) => {
    if (!tabs.has(next)) return
    setSearch({ tab: next })
  }

  const args = createMemo(() => ({
    baseUrl: sdk.url,
    directory: sdk.directory,
    item_id: params.itemId ?? "",
    auth: auth(),
  }))

  const [detail, ctl] = createResource(args, loadLibraryDetail)
  const [hist, hctl] = createResource(
    createMemo(() => {
      const id = detail()?.item.id
      if (!id) return
      return {
        baseUrl: sdk.url,
        directory: sdk.directory,
        item_id: id,
        auth: auth(),
      }
    }),
    loadLibraryHistory,
  )

  const more = async () => {
    const item = detail()?.item
    const page = hist()
    if (!item || !page?.next_cursor) return
    try {
      const next = await loadLibraryHistory({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        item_id: item.id,
        cursor: page.next_cursor,
      })
      hctl.mutate({
        endpoint: page.endpoint,
        items: [...page.items, ...next.items],
        next_cursor: next.next_cursor,
      })
    } catch (error) {
      setErr(msg(error))
    }
  }

  createEffect(() => {
    const value = detail()
    const next = value?.revision_head?.id ?? value?.item.id
    if (!value || !next || rev() === next) return
    setRev(next)
    setTxt(value.canonical_text)
    setCopy(value.used_by[0]?.workflow_id ?? "")
    setErr("")
    setOk("")
  })

  const dirty = createMemo(() => txt() !== (detail()?.canonical_text ?? ""))
  const blocked = createMemo(() => (detail()?.used_by.length ?? 0) > 0)

  const save = async () => {
    const item = detail()?.item
    if (!item) return
    setBusy(true)
    setErr("")
    setOk("")
    try {
      const next = await saveLibrary({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        item_id: item.id,
        text: txt(),
      })
      ctl.mutate(next)
      await hctl.refetch()
      setTxt(next.canonical_text)
      setRev(next.revision_head?.id ?? next.item.id)
      setOk("Saved canonical shared resource.")
    } catch (error) {
      setErr(msg(error))
    } finally {
      setBusy(false)
    }
  }

  const copyTo = async () => {
    const item = detail()?.item
    if (!item) return
    if (item.kind === "query") {
      setErr("Query library items cannot be copied into graph workflows.")
      setSearch({ tab: "content" })
      return
    }
    if (!copy().trim()) {
      setErr("Select a workflow before creating a local copy.")
      setSearch({ tab: "used" })
      return
    }
    setCopying(true)
    setErr("")
    setOk("")
    try {
      const next = await copyLibrary({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        item_id: item.id,
        workflow_id: copy().trim(),
      })
      setOk(
        next.resources.length > 0
          ? `Created ${next.resources.length} workflow-local resource copy for ${next.workflow_id}.`
          : `Created workflow-local copy for ${next.workflow_id}.`,
      )
    } catch (error) {
      setErr(msg(error))
    } finally {
      setCopying(false)
    }
  }

  const remove = async () => {
    const item = detail()?.item
    if (!item) return
    if (blocked()) {
      setErr("Remove workflow references or create workflow-local copies before deleting this shared item.")
      setSearch({ tab: "used" })
      return
    }
    setRemoving(true)
    setErr("")
    setOk("")
    try {
      const next = await deleteLibrary({
        baseUrl: sdk.url,
        directory: sdk.directory,
        auth: auth(),
        item_id: item.id,
      })
      if (!next.deleted) throw new Error("Shared resource was not deleted.")
      navigate(`/${params.dir}/library`)
    } catch (error) {
      setErr(msg(error))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div data-page="library-detail" class="size-full overflow-y-auto">
      <div class="mx-auto max-w-7xl p-6 space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-1">
            <Show when={detail()?.item}>
              {(item) => (
                <>
                  <div class="flex flex-wrap items-center gap-2">
                    <h1 class="text-18-medium text-text-strong">{item().name}</h1>
                    <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                      {kind(item().kind)}
                    </span>
                    <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-medium text-text-weak">
                      shared
                    </span>
                  </div>
                  <div class="text-12-mono text-text-weak break-all">{item().file}</div>
                  <Show when={detail()?.revision_head}>
                    {(head) => (
                      <div class="text-12-regular text-text-weak">
                        Revision {head().id.slice(0, 8)} • {head().content_hash.slice(0, 12)}
                      </div>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => ctl.refetch()}>
              Refresh
            </Button>
            <Button variant="ghost" data-action="library-delete" onClick={() => void remove()} disabled={removing()}>
              {removing() ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>

        <Show when={blocked()}>
          <div
            data-component="library-delete-block"
            class="rounded-xl border border-border-weak-base bg-background-base p-4 text-13-regular text-text-weak"
          >
            Deletion is blocked while workflows still reference this shared resource. Create workflow-local copies or remove the
            shared references first.
          </div>
        </Show>

        <Show when={err()}>
          {(value) => (
            <div class="rounded-xl border border-border-weak-base bg-background-base p-4 text-13-regular text-icon-critical-base">
              {value()}
            </div>
          )}
        </Show>

        <Show when={ok()}>
          {(value) => (
            <div class="rounded-xl border border-border-weak-base bg-background-base p-4 text-13-regular text-icon-success-base">
              {value()}
            </div>
          )}
        </Show>

        <Switch>
          <Match when={detail.loading}>
            <div class="rounded-xl border border-border-weak-base p-4 text-13-regular">Loading library detail...</div>
          </Match>
          <Match when={detail.error}>
            <div class="rounded-xl border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
              {msg(detail.error)}
            </div>
          </Match>
          <Match when={detail()}>
            {(value) => (
              <Tabs value={tab()} onChange={changeTab} class="space-y-4">
                <Tabs.List class="flex flex-wrap gap-2">
                  <Tabs.Trigger value="content" onClick={() => setSearch({ tab: "content" })}>
                    Content
                  </Tabs.Trigger>
                  <Tabs.Trigger value="used" onClick={() => setSearch({ tab: "used" })}>
                    Used By
                  </Tabs.Trigger>
                  <Tabs.Trigger value="history" onClick={() => setSearch({ tab: "history" })}>
                    History
                  </Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="content" class="space-y-4">
                  <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
                    <div class="grid gap-3 md:grid-cols-3">
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Kind</div>
                        <div class="pt-1 text-13-medium text-text-strong">{kind(value().item.kind)}</div>
                      </div>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Used by</div>
                        <div class="pt-1 text-13-medium text-text-strong">
                          {value().used_by.length > 0 ? `${value().used_by.length} workflow(s)` : "Unused"}
                        </div>
                      </div>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Last edited</div>
                        <div class="pt-1 text-13-medium text-text-strong">{stamp(value().item.last_edited_at)}</div>
                      </div>
                    </div>

                    <Show when={value().item.resource?.links.length}>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-12-medium text-text-weak">Links</div>
                        <div class="pt-2 flex flex-wrap gap-2">
                          <For each={value().item.resource?.links ?? []}>
                            {(item) => (
                              <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                                {item}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <Show when={value().item.errors.length > 0}>
                      <div class="rounded-lg border border-border-weak-base bg-background-base p-3 space-y-3">
                        <div class="text-12-regular text-icon-critical-base">
                          Validation issues are currently blocking safe shared reuse.
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
                              <For each={value().item.errors}>
                                {(issue) => (
                                  <tr class="border-t border-border-weak-base">
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

                    <div class="space-y-3">
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div class="text-14-medium text-text-strong">Canonical content</div>
                          <div class="text-12-regular text-text-weak">Editing writes directly back to the shared library file.</div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                          <Button variant="ghost" onClick={() => setTxt(value().canonical_text)} disabled={!dirty() || busy()}>
                            Discard
                          </Button>
                          <Button data-action="library-save" onClick={() => void save()} disabled={!dirty() || busy()}>
                            {busy() ? "Saving..." : "Save shared item"}
                          </Button>
                        </div>
                      </div>

                      <TextField
                        multiline
                        data-component="library-editor"
                        label="YAML"
                        class="min-h-96 font-mono text-xs"
                        value={txt()}
                        onChange={setTxt}
                      />
                    </div>
                  </section>
                </Tabs.Content>

                <Tabs.Content value="used" class="space-y-4">
                  <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
                    <div>
                      <div class="text-14-medium text-text-strong">Workflow usage</div>
                      <div class="text-12-regular text-text-weak">
                        Review impacted workflows before editing or deleting the shared resource.
                      </div>
                    </div>

                    <Show
                      when={value().used_by.length > 0}
                      fallback={
                        <div class="rounded-lg border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
                          No workflows currently reference this shared resource.
                        </div>
                      }
                    >
                      <div class="space-y-3">
                        <For each={value().used_by}>
                          {(item) => (
                            <section
                              data-component="library-used-row"
                              data-workflow-id={item.workflow_id}
                              class="rounded-lg border border-border-weak-base bg-background-base p-3 space-y-3"
                            >
                              <div class="space-y-1">
                                <div class="text-14-medium text-text-strong">{item.name}</div>
                                <div class="text-12-mono text-text-weak break-all">{item.file}</div>
                              </div>
                              <div class="flex flex-wrap gap-2">
                                <Button
                                  variant="ghost"
                                  onClick={() => navigate(`/${params.dir}/workflows/${encodeURIComponent(item.workflow_id)}`)}
                                >
                                  Open workflow
                                </Button>
                                <Button
                                  size="small"
                                  variant={copy() === item.workflow_id ? "secondary" : "ghost"}
                                  onClick={() => setCopy(item.workflow_id)}
                                >
                                  Use for local copy
                                </Button>
                              </div>
                            </section>
                          )}
                        </For>
                      </div>
                    </Show>

                    <div class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-4">
                      <div>
                        <div class="text-14-medium text-text-strong">Create workflow-local copy</div>
                        <div class="text-12-regular text-text-weak">
                          Replace a shared reference in one workflow with a local resource copy before making workflow-specific edits.
                        </div>
                      </div>

                      <TextField
                        label="Workflow id"
                        value={copy()}
                        placeholder={value().used_by[0]?.workflow_id ?? "workflow.release-review"}
                        onChange={setCopy}
                      />

                      <div class="flex flex-wrap gap-2">
                        <Button data-action="library-copy" onClick={() => void copyTo()} disabled={copying()}>
                          {copying() ? "Creating..." : "Create local copy"}
                        </Button>
                        <Show when={copy().trim()}>
                          <Button
                            variant="ghost"
                            onClick={() => navigate(`/${params.dir}/workflows/${encodeURIComponent(copy().trim())}`)}
                          >
                            Open selected workflow
                          </Button>
                        </Show>
                      </div>
                    </div>
                  </section>
                </Tabs.Content>

                <Tabs.Content value="history" class="space-y-4">
                  <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
                    <div>
                      <div class="text-14-medium text-text-strong">Revision history</div>
                      <div class="text-12-regular text-text-weak">
                        Compare revision checkpoints and inspect the canonical diff for shared item edits.
                      </div>
                      <Show when={hist()?.endpoint}>
                        {(next) => (
                          <div class="pt-2 text-12-mono text-text-weak">
                            source: <span>{next()}</span>
                          </div>
                        )}
                      </Show>
                    </div>

                    <Switch>
                      <Match when={hist.loading}>
                        <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">Loading history...</div>
                      </Match>
                      <Match when={hist.error}>
                        <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
                          {msg(hist.error)}
                        </div>
                      </Match>
                      <Match when={(hist()?.items.length ?? 0) === 0}>
                        <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-text-weak">
                          No revision history was returned.
                        </div>
                      </Match>
                      <Match when={true}>
                        <div class="space-y-3">
                          <For each={hist()?.items ?? []}>
                            {(item) => (
                              <section
                                data-component="library-history-row"
                                data-revision-id={item.revision.id}
                                class="rounded-lg border border-border-weak-base bg-background-base p-4 space-y-3"
                              >
                                <div class="flex flex-wrap items-start justify-between gap-3">
                                  <div class="space-y-1">
                                    <div class="text-14-medium text-text-strong">{item.revision.id}</div>
                                    <div class="text-12-regular text-text-weak">
                                      {stamp(item.revision.created_at)} • {item.revision.content_hash.slice(0, 12)}
                                    </div>
                                  </div>
                                  <Show when={item.previous_revision}>
                                    {(prev) => (
                                      <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                                        previous {prev().id.slice(0, 8)}
                                      </span>
                                    )}
                                  </Show>
                                </div>

                                <div class="rounded-lg border border-border-weak-base px-3 py-2">
                                  <div class="text-12-medium text-text-weak">Diff</div>
                                  <pre class="pt-2 whitespace-pre-wrap break-all text-12-mono text-text-strong">{item.diff}</pre>
                                </div>
                              </section>
                            )}
                          </For>

                          <Show when={hist()?.next_cursor}>
                            {(next) => (
                              <Button variant="ghost" onClick={() => void more()}>
                                Load More
                              </Button>
                            )}
                          </Show>
                        </div>
                      </Match>
                    </Switch>
                  </section>
                </Tabs.Content>
              </Tabs>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
