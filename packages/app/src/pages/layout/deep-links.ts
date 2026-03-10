import { base64Encode } from "@opencode-ai/util/encode"

export const deepLinkEvent = "origin:deep-link"

export type ProjectDeepLink = {
  directory: string
  href?: string
}

const parseUrl = (input: string) => {
  if (!input.startsWith("origin://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
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
