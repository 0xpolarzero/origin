import { base64Encode } from "@opencode-ai/util/encode"

export const deepLinkEvent = "origin:deep-link"

export type ProjectDeepLink = {
  directory: string
  href?: string
}

export const parseDeepLink = (input: string) => {
  if (!input.startsWith("origin://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  const url = (() => {
    try {
      return new URL(input)
    } catch {
      return undefined
    }
  })()
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

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((link): link is ProjectDeepLink => !!link)

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
