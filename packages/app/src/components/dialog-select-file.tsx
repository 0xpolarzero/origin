import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Keybind } from "@opencode-ai/ui/keybind"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useNavigate, useParams } from "@solidjs/router"
import { createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { formatKeybind, useCommand, type CommandOption } from "@/context/command"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useModels } from "@/context/models"
import { useSettings } from "@/context/settings"
import { useProviders } from "@/hooks/use-providers"
import { decode64 } from "@/utils/base64"
import {
  resolveGlobalWorkspaceDirectory,
  shouldShowEntryCommand,
  sortPaletteGroupsWithGlobal,
} from "@/utils/global-workspace"
import { getRelativeTime } from "@/utils/time"

type EntryType = "entry" | "command" | "file" | "session"

type Entry = {
  id: string
  type: EntryType
  title: string
  description?: string
  search?: string
  keybind?: string
  category: string
  option?: CommandOption
  path?: string
  directory?: string
  sessionID?: string
  archived?: number
  updated?: number
  query?: string
}

type DialogSelectFileMode = "all" | "files"

const ENTRY_LIMIT = 5
const GLOBAL_ENTRY_CATEGORY = "Global"
const COMMON_COMMAND_IDS = [
  "session.new",
  "workspace.new",
  "session.previous",
  "session.next",
  "terminal.toggle",
  "review.toggle",
] as const

const uniqueEntries = (items: Entry[]) => {
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

const createCommandEntry = (option: CommandOption, category: string): Entry => ({
  id: "command:" + option.id,
  type: "command",
  title: option.title,
  description: option.description,
  search: `${option.title}\n${option.description ?? ""}`,
  keybind: option.keybind,
  category,
  option,
})

const createEntrySessionStart = (query: string): Entry => ({
  id: "entry:start-session",
  type: "entry",
  title: "Start agent session from entry",
  description: "Create and send in global workspace",
  search: query,
  category: GLOBAL_ENTRY_CATEGORY,
  query,
})

const createFileEntry = (path: string, category: string): Entry => ({
  id: "file:" + path,
  type: "file",
  title: path,
  search: path,
  category,
  path,
})

const createSessionEntry = (
  input: {
    directory: string
    id: string
    title: string
    description: string
    archived?: number
    updated?: number
  },
  category: string,
): Entry => ({
  id: `session:${input.directory}:${input.id}`,
  type: "session",
  title: input.title,
  description: input.description,
  search: `${input.title}\n${input.description}`,
  category,
  directory: input.directory,
  sessionID: input.id,
  archived: input.archived,
  updated: input.updated,
})

function createCommandEntries(props: {
  filesOnly: () => boolean
  command: ReturnType<typeof useCommand>
  language: ReturnType<typeof useLanguage>
}) {
  const allowed = createMemo(() => {
    if (props.filesOnly()) return []
    return props.command.options.filter(
      (option) =>
        !option.disabled &&
        !option.id.startsWith("suggested.") &&
        option.id !== "file.open" &&
        option.id !== "palette.open",
    )
  })

  const list = createMemo(() => {
    const category = props.language.t("palette.group.commands")
    return allowed().map((option) => createCommandEntry(option, category))
  })

  const picks = createMemo(() => {
    const all = allowed()
    const order = new Map<string, number>(COMMON_COMMAND_IDS.map((id, index) => [id, index]))
    const picked = all.filter((option) => order.has(option.id))
    const base = picked.length ? picked : all.slice(0, ENTRY_LIMIT)
    const sorted = picked.length ? [...base].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : base
    const category = props.language.t("palette.group.commands")
    return sorted.map((option) => createCommandEntry(option, category))
  })

  return { allowed, list, picks }
}

function createFileEntries(props: {
  file: ReturnType<typeof useFile> | undefined
  tabs: () => ReturnType<ReturnType<typeof useLayout>["tabs"]>
  language: ReturnType<typeof useLanguage>
}) {
  const recent = createMemo(() => {
    if (!props.file) return []
    const all = props.tabs().all()
    const active = props.tabs().active()
    const order = active ? [active, ...all.filter((item) => item !== active)] : all
    const seen = new Set<string>()
    const category = props.language.t("palette.group.files")
    const items: Entry[] = []

    for (const item of order) {
      const path = props.file.pathFromTab(item)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      items.push(createFileEntry(path, category))
    }

    return items.slice(0, ENTRY_LIMIT)
  })

  const root = createMemo(() => {
    if (!props.file) return []
    const category = props.language.t("palette.group.files")
    const nodes = props.file.tree.children("")
    const paths = nodes
      .filter((node) => node.type === "file")
      .map((node) => node.path)
      .sort((a, b) => a.localeCompare(b))
    return paths.slice(0, ENTRY_LIMIT).map((path) => createFileEntry(path, category))
  })

  return { recent, root }
}

function optionalContext<T>(read: () => T) {
  try {
    return read()
  } catch {
    return undefined
  }
}

function createSessionEntries(props: {
  workspaces: () => string[]
  label: (directory: string) => string
  globalSDK: ReturnType<typeof useGlobalSDK>
  language: ReturnType<typeof useLanguage>
}) {
  const state: {
    token: number
    inflight: Promise<Entry[]> | undefined
    cached: Entry[] | undefined
  } = {
    token: 0,
    inflight: undefined,
    cached: undefined,
  }

  const sessions = (text: string) => {
    const query = text.trim()
    if (!query) {
      state.token += 1
      state.inflight = undefined
      state.cached = undefined
      return [] as Entry[]
    }

    if (state.cached) return state.cached
    if (state.inflight) return state.inflight

    const current = state.token
    const dirs = props.workspaces()
    if (dirs.length === 0) return [] as Entry[]

    state.inflight = Promise.all(
      dirs.map((directory) => {
        const description = props.label(directory)
        return props.globalSDK.client.session
          .list({ directory, roots: true })
          .then((x) =>
            (x.data ?? [])
              .filter((s) => !!s?.id)
              .map((s) => ({
                id: s.id,
                title: s.title ?? props.language.t("command.session.new"),
                description,
                directory,
                archived: s.time?.archived,
                updated: s.time?.updated,
              })),
          )
          .catch(
            () =>
              [] as {
                id: string
                title: string
                description: string
                directory: string
                archived?: number
                updated?: number
              }[],
          )
      }),
    )
      .then((results) => {
        if (state.token !== current) return [] as Entry[]
        const seen = new Set<string>()
        const category = props.language.t("command.category.session")
        const next = results
          .flat()
          .filter((item) => {
            const key = `${item.directory}:${item.id}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .map((item) => createSessionEntry(item, category))
        state.cached = next
        return next
      })
      .catch(() => [] as Entry[])
      .finally(() => {
        state.inflight = undefined
      })

    return state.inflight
  }

  return { sessions }
}

export function DialogSelectFile(props: { mode?: DialogSelectFileMode; onOpenFile?: (path: string) => void }) {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const file = optionalContext(() => useFile())
  const local = optionalContext(() => useLocal())
  const models = useModels()
  const providers = useProviders()
  const dialog = useDialog()
  const params = useParams()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const settings = useSettings()
  const filesOnly = () => props.mode === "files"
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))
  const state = { cleanup: undefined as (() => void) | void, committed: false }
  const [grouped, setGrouped] = createSignal(false)
  const commandEntries = createCommandEntries({ filesOnly, command, language })
  const fileEntries = createFileEntries({ file, tabs, language })
  const globalWorkspace = createMemo(() =>
    resolveGlobalWorkspaceDirectory({
      configured: settings.general.globalWorkspaceDirectory(),
      home: globalSync.data.path.home,
    }),
  )

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const workspaces = createMemo(() => {
    const directory = projectDirectory()
    const current = project()
    if (!current) return directory ? [directory] : []

    const dirs = [current.worktree, ...(current.sandboxes ?? [])]
    if (directory && !dirs.includes(directory)) return [...dirs, directory]
    return dirs
  })
  const homedir = createMemo(() => globalSync.data.path.home)
  const label = (directory: string) => {
    const current = project()
    const kind =
      current && directory === current.worktree
        ? language.t("workspace.type.local")
        : language.t("workspace.type.sandbox")
    const [store] = globalSync.child(directory, { bootstrap: false })
    const home = homedir()
    const path = home ? directory.replace(home, "~") : directory
    const name = store.vcs?.branch ?? getFilename(directory)
    return `${kind} : ${name || path}`
  }

  const { sessions } = createSessionEntries({ workspaces, label, globalSDK, language })

  const formatError = (error: unknown) => {
    if (error && typeof error === "object" && "data" in error) {
      const data = (error as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (error instanceof Error) return error.message
    return language.t("common.requestFailed")
  }

  const startSessionFromEntry = async (query: string) => {
    const text = query.trim()
    if (!text) return

    const connected = new Set(providers.connected().map((provider) => provider.id))
    const defaults = providers.default()
    const model =
      local?.model.current() ??
      models.recent
        .list()
        .map(models.find)
        .find((entry) => !!entry && connected.has(entry.provider.id)) ??
      providers
        .connected()
        .map((provider) => {
          const configured = defaults[provider.id]
          if (configured) {
            const hit = models.find({ providerID: provider.id, modelID: configured })
            if (hit) return hit
          }
          const first = Object.values(provider.models)[0]
          if (!first) return undefined
          return models.find({ providerID: provider.id, modelID: first.id })
        })
        .find((entry) => !!entry)

    const activeDirectory = decode64(params.dir)
    const directories = [activeDirectory, globalWorkspace()].filter((directory): directory is string => !!directory)
    const agent =
      local?.agent.current() ??
      directories
        .flatMap((directory) => globalSync.child(directory, { bootstrap: false })[0].agent)
        .find((entry) => entry.mode !== "subagent" && !entry.hidden)

    if (!model || !agent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    const directory = globalWorkspace()
    if (!directory) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("common.requestFailed"),
      })
      return
    }

    const ensured = await globalSDK.client.path
      .ensure({ path: directory })
      .then((x) => x.data)
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: formatError(error),
        })
        return undefined
      })

    if (!ensured?.path) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("common.requestFailed"),
      })
      return
    }

    const target = ensured.path
    const client = globalSDK.createClient({
      directory: target,
      throwOnError: true,
    })
    globalSync.child(target)

    const session = await client.session
      .create()
      .then((x) => x.data ?? undefined)
      .catch((error) => {
        showToast({
          title: language.t("prompt.toast.sessionCreateFailed.title"),
          description: formatError(error),
        })
        return undefined
      })

    if (!session?.id) return

    navigate(`/${base64Encode(target)}/session/${session.id}`)

    await client.session
      .promptAsync({
        sessionID: session.id,
        agent: agent.name,
        model: {
          providerID: model.provider.id,
          modelID: model.id,
        },
        variant: local?.model.variant.current(),
        parts: [{ type: "text", text }],
      })
      .catch((error) => {
        showToast({
          title: language.t("prompt.toast.promptSendFailed.title"),
          description: formatError(error),
        })
      })
  }

  const items = async (text: string) => {
    const query = text.trim()
    setGrouped(query.length > 0)
    const showEntry = shouldShowEntryCommand({ query: text, mode: filesOnly() ? "files" : "all" })
    const entry = showEntry ? createEntrySessionStart(query) : undefined

    if (!query && filesOnly() && file) {
      const loaded = file.tree.state("")?.loaded
      const pending = loaded ? Promise.resolve() : file.tree.list("")
      const next = uniqueEntries([...fileEntries.recent(), ...fileEntries.root()])

      if (loaded || next.length > 0) {
        void pending
        return next
      }

      await pending
      return uniqueEntries([...fileEntries.recent(), ...fileEntries.root()])
    }

    if (!query) return [...commandEntries.picks(), ...fileEntries.recent()]

    if (filesOnly()) {
      if (!file) return []
      const files = await file.searchFiles(query)
      const category = language.t("palette.group.files")
      return files.map((path) => createFileEntry(path, category))
    }

    const [files, nextSessions] = await Promise.all([
      file ? file.searchFiles(query) : Promise.resolve([] as string[]),
      Promise.resolve(sessions(query)),
    ])
    const category = language.t("palette.group.files")
    const entries = files.map((path) => createFileEntry(path, category))
    const result = [...commandEntries.list(), ...nextSessions, ...entries]
    if (!entry) return result
    return [entry, ...result]
  }

  const handleMove = (item: Entry | undefined) => {
    state.cleanup?.()
    if (!item) return
    if (item.type !== "command") return
    state.cleanup = item.option?.onHighlight?.()
  }

  const open = (path: string) => {
    if (!file) return
    const value = file.tab(path)
    tabs().open(value)
    file.load(path)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    layout.fileTree.setTab("all")
    props.onOpenFile?.(path)
    tabs().setActive(value)
  }

  const handleSelect = (item: Entry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()

    if (item.type === "command") {
      item.option?.onSelect?.("palette")
      return
    }

    if (item.type === "entry") {
      void startSessionFromEntry(item.query ?? "")
      return
    }

    if (item.type === "session") {
      if (!item.directory || !item.sessionID) return
      navigate(`/${base64Encode(item.directory)}/session/${item.sessionID}`)
      return
    }

    if (!item.path) return
    open(item.path)
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        search={{
          placeholder: filesOnly()
            ? language.t("session.header.searchFiles")
            : language.t("palette.search.placeholder"),
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={language.t("palette.empty")}
        loadingMessage={language.t("common.loading")}
        items={items}
        key={(item) => item.id}
        filterKeys={["title", "description", "category", "search"]}
        groupBy={grouped() ? (item) => item.category : () => ""}
        sortGroupsBy={sortPaletteGroupsWithGlobal}
        onMove={handleMove}
        onSelect={handleSelect}
      >
        {(item) => (
          <Switch
            fallback={
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.path ?? "", type: "file" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular">
                    <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                      {getDirectory(item.path ?? "")}
                    </span>
                    <span class="text-text-strong whitespace-nowrap">{getFilename(item.path ?? "")}</span>
                  </div>
                </div>
              </div>
            }
          >
            <Match when={item.type === "entry"}>
              <div class="w-full flex items-center justify-between gap-4">
                <div class="flex items-center gap-2 min-w-0">
                  <Icon name="models" size="small" class="shrink-0 text-icon-info-base" />
                  <span class="text-14-regular text-text-strong whitespace-nowrap">{item.title}</span>
                </div>
                <Tag class="shrink-0">origin</Tag>
              </div>
            </Match>
            <Match when={item.type === "command"}>
              <div class="w-full flex items-center justify-between gap-4">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-14-regular text-text-strong whitespace-nowrap">{item.title}</span>
                  <Show when={item.description}>
                    <span class="text-14-regular text-text-weak truncate">{item.description}</span>
                  </Show>
                </div>
                <Show when={item.keybind}>
                  <Keybind class="rounded-[4px]">{formatKeybind(item.keybind ?? "")}</Keybind>
                </Show>
              </div>
            </Match>
            <Match when={item.type === "session"}>
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <Icon name="bubble-5" size="small" class="shrink-0 text-icon-weak" />
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="text-14-regular text-text-strong truncate"
                      classList={{ "opacity-70": !!item.archived }}
                    >
                      {item.title}
                    </span>
                    <Show when={item.description}>
                      <span
                        class="text-14-regular text-text-weak truncate"
                        classList={{ "opacity-70": !!item.archived }}
                      >
                        {item.description}
                      </span>
                    </Show>
                  </div>
                </div>
                <Show when={item.updated}>
                  <span class="text-12-regular text-text-weak whitespace-nowrap ml-2">
                    {getRelativeTime(new Date(item.updated!).toISOString(), language.t)}
                  </span>
                </Show>
              </div>
            </Match>
          </Switch>
        )}
      </List>
    </Dialog>
  )
}
