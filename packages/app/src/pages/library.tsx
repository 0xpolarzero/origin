import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useNavigate, useParams } from "@solidjs/router"
import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { loadLibraryPage, type LibraryKind, type LibraryRow } from "./library-data"

type Flt = "all" | "runnable" | "blocked" | "used"
type Ord = "edit" | "usage" | "name"

const stamp = (value: number | null) => (value ? new Date(value).toLocaleString() : "Never")

const kind = (value: LibraryKind | "unknown") => {
  if (value === "prompt_template") return "Prompt template"
  if (value === "script") return "Script"
  if (value === "query") return "Query"
  return "Unknown"
}

const state = (value: boolean) => (value ? "Runnable" : "Non-runnable")

const tone = (value: boolean) =>
  value
    ? "border border-border-weak-base bg-background-base text-icon-success-base"
    : "border border-border-weak-base bg-background-base text-icon-critical-base"

const msg = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return "Failed to load library resources."
}

const sort = (items: LibraryRow[], ord: Ord) =>
  [...items].sort((a, b) => {
    if (ord === "name") return a.name.localeCompare(b.name)
    if (ord === "usage") return b.used_by.length - a.used_by.length || a.name.localeCompare(b.name)
    return (b.last_edited_at ?? 0) - (a.last_edited_at ?? 0) || a.name.localeCompare(b.name)
  })

export default function Library() {
  const sdk = useSDK()
  const server = useServer()
  const navigate = useNavigate()
  const params = useParams()
  const [tick, setTick] = createSignal(0)
  const [q, setQ] = createSignal("")
  const [flt, setFlt] = createSignal<Flt>("all")
  const [ord, setOrd] = createSignal<Ord>("edit")

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

  const [list] = createResource(args, ({ baseUrl, directory, auth }) =>
    loadLibraryPage({
      baseUrl,
      directory,
      auth,
    }),
  )

  const rows = createMemo(() => {
    const term = q().trim().toLowerCase()
    const items = (list()?.items ?? []).filter((item) => {
      if (flt() === "runnable" && !item.runnable) return false
      if (flt() === "blocked" && item.runnable) return false
      if (flt() === "used" && item.used_by.length === 0) return false
      if (!term) return true
      return [item.id, item.name, item.file, item.kind, item.used_by.join(" ")].some((part) => part.toLowerCase().includes(term))
    })
    return sort(items, ord())
  })

  const count = createMemo(() => ({
    total: list()?.items.length ?? 0,
    used: (list()?.items ?? []).filter((item) => item.used_by.length > 0).length,
    blocked: (list()?.items ?? []).filter((item) => !item.runnable).length,
  }))

  return (
    <div data-page="library" class="size-full overflow-y-auto">
      <div class="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-1">
            <h1 class="text-16-medium text-text-strong">Library</h1>
            <p class="text-13-regular text-text-weak">
              Shared workflow resources stay discoverable, editable, and traceable without leaving the app.
            </p>
            <Show when={list()?.endpoint}>
              {(value) => (
                <p class="text-12-mono text-text-weak">
                  source: <span>{value()}</span>
                </p>
              )}
            </Show>
          </div>

          <Button variant="ghost" onClick={() => setTick((value) => value + 1)}>
            Refresh
          </Button>
        </div>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
            <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Total</div>
            <div class="pt-1 text-20-medium text-text-strong">{count().total}</div>
          </div>
          <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
            <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Used by workflows</div>
            <div class="pt-1 text-20-medium text-text-strong">{count().used}</div>
          </div>
          <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
            <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Blocked</div>
            <div class="pt-1 text-20-medium text-icon-critical-base">{count().blocked}</div>
          </div>
        </div>

        <section class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4">
          <div class="flex flex-wrap items-end gap-4">
            <div class="min-w-[240px] flex-1">
              <TextField
                label="Search"
                value={q()}
                placeholder="Search by name, id, file, or workflow usage"
                onChange={setQ}
              />
            </div>

            <div class="flex flex-wrap gap-2">
              <For each={["all", "runnable", "blocked", "used"] as const}>
                {(item) => (
                  <Button size="small" variant={flt() === item ? "secondary" : "ghost"} onClick={() => setFlt(item)}>
                    {item}
                  </Button>
                )}
              </For>
            </div>

            <div class="flex flex-wrap gap-2">
              <For each={["edit", "usage", "name"] as const}>
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
              Non-runnable shared resources stay visible so validation issues and remediation remain explicit.
            </div>
          </Show>
        </section>

        <Switch>
          <Match when={list.loading}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">Loading library index...</div>
          </Match>
          <Match when={list.error}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-icon-critical-base">
              {msg(list.error)}
            </div>
          </Match>
          <Match when={(list()?.items.length ?? 0) === 0}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular">
              No shared library resources were returned.
            </div>
          </Match>
          <Match when={rows().length === 0}>
            <div class="rounded-lg border border-border-weak-base p-4 text-13-regular text-text-weak">
              No library resources match the current search and filters.
            </div>
          </Match>
          <Match when={true}>
            <div class="space-y-4">
              <For each={rows()}>
                {(item) => (
                  <section
                    data-component="library-row"
                    data-id={item.id}
                    data-runnable={item.runnable ? "true" : "false"}
                    class="rounded-xl border border-border-weak-base bg-background-base p-4 space-y-4"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div class="min-w-0 space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="text-14-medium text-text-strong truncate">{item.name}</p>
                          <div class={`shrink-0 rounded-md px-2.5 py-1 text-12-medium ${tone(item.runnable)}`}>
                            {state(item.runnable)}
                          </div>
                        </div>
                        <p class="text-12-mono text-text-weak break-all">{item.file}</p>
                      </div>

                      <div class="flex flex-wrap gap-2">
                        <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                          {item.id}
                        </span>
                        <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                          {kind(item.kind)}
                        </span>
                        <span class="rounded-md border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
                          {item.source}
                        </span>
                      </div>
                    </div>

                    <div class="grid gap-3 md:grid-cols-3">
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Used by</div>
                        <div class="pt-1 text-13-medium text-text-strong">
                          {item.used_by.length > 0 ? `${item.used_by.length} workflow(s)` : "Unused"}
                        </div>
                        <Show when={item.used_by.length > 0}>
                          <div class="pt-1 text-12-regular text-text-weak">{item.used_by.join(", ")}</div>
                        </Show>
                      </div>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Last edited</div>
                        <div class="pt-1 text-13-medium text-text-strong">{stamp(item.last_edited_at)}</div>
                      </div>
                      <div class="rounded-lg border border-border-weak-base px-3 py-2">
                        <div class="text-11-medium uppercase tracking-[0.12em] text-text-weak">Validation</div>
                        <div class="pt-1 text-13-medium text-text-strong">
                          {item.runnable ? "Ready for shared reuse" : `${item.errors.length} validation issue(s)`}
                        </div>
                      </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => navigate(`/${params.dir}/library/${encodeURIComponent(item.id)}`)}>
                        Open resource
                      </Button>
                      <Show when={item.used_by[0]}>
                        {(id) => (
                          <Button variant="ghost" onClick={() => navigate(`/${params.dir}/workflows/${encodeURIComponent(id())}`)}>
                            Open first workflow
                          </Button>
                        )}
                      </Show>
                    </div>

                    <Show when={!item.runnable}>
                      <div class="rounded-lg border border-border-weak-base bg-background-base p-3 space-y-3">
                        <div class="text-12-regular text-icon-critical-base">
                          This shared resource is blocked until its validation issues are resolved.
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
