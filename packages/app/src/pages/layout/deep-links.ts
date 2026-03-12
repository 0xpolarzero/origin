import { base64Encode } from "@opencode-ai/util/encode"

export const deepLinkEvent = "origin:deep-link"

export type ProjectDeepLink = {
  directory: string
  href?: string
}

const tabs = new Set(["runs", "operations", "drafts", "edits"])
const scopes = new Set(["pending", "processed"])

const parseUrl = (input: string) => {
  if (!input.startsWith("origin://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

const text = (value: string | null) => {
  if (!value) return
  const next = value.trim()
  if (!next) return
  return next
}

const flag = (value: string | null) => {
  const next = text(value)?.toLowerCase()
  if (next === "1" || next === "true") return "1"
  if (next === "0" || next === "false") return "0"
}

const historyTab = (value: URLSearchParams) => {
  const tab = text(value.get("tab"))
  if (tab && tabs.has(tab)) return tab
  if (text(value.get("draft_id"))) return "drafts"
  if (text(value.get("edit_id"))) return "edits"
  if (text(value.get("operation_id"))) return "operations"
  if (text(value.get("run_id"))) return "runs"
}

const historyHref = (directory: string, value: URLSearchParams) => {
  const query = new URLSearchParams()
  const tab = historyTab(value)
  const scope = text(value.get("scope"))
  const debug = flag(value.get("debug"))
  const run_id = text(value.get("run_id"))
  const operation_id = text(value.get("operation_id"))
  const draft_id = text(value.get("draft_id"))
  const edit_id = text(value.get("edit_id"))
  const workspace = text(value.get("workspace"))

  if (tab) query.set("tab", tab)
  if (scope && scopes.has(scope)) query.set("scope", scope)
  if (debug) query.set("debug", debug)
  if (run_id) query.set("run_id", run_id)
  if (operation_id) query.set("operation_id", operation_id)
  if (draft_id) query.set("draft_id", draft_id)
  if (edit_id) query.set("edit_id", edit_id)
  if (workspace) query.set("workspace", workspace)

  const next = query.toString()
  return `/${base64Encode(directory)}/history${next ? `?${next}` : ""}`
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const target = url.searchParams.get("target")
  if (target === "workflow") {
    const workflow_id = url.searchParams.get("workflow_id")
    if (!workflow_id) return
    return {
      directory,
      href: `/${base64Encode(directory)}/workflows/${encodeURIComponent(workflow_id)}`,
    } satisfies ProjectDeepLink
  }
  if (target === "run") {
    const run_id = url.searchParams.get("run_id")
    if (!run_id) return
    return {
      directory,
      href: `/${base64Encode(directory)}/runs/${encodeURIComponent(run_id)}`,
    } satisfies ProjectDeepLink
  }
  if (target === "workflow-edit") {
    const workflow_id = text(url.searchParams.get("workflow_id"))
    if (!workflow_id) return
    const query = new URLSearchParams()
    query.set("tab", "history")
    const edit_id = text(url.searchParams.get("edit_id"))
    if (edit_id) query.set("edit_id", edit_id)
    return {
      directory,
      href: `/${base64Encode(directory)}/workflows/${encodeURIComponent(workflow_id)}?${query.toString()}`,
    } satisfies ProjectDeepLink
  }
  if (target === "history") {
    return {
      directory,
      href: historyHref(directory, url.searchParams),
    } satisfies ProjectDeepLink
  }
  return {
    directory,
  } satisfies ProjectDeepLink
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((link): link is ProjectDeepLink => !!link)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return pending
}
