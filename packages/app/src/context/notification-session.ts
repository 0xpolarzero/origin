import type { GraphSessionLink } from "@/pages/graph-detail-data"

export function isRunWorkspaceDirectory(directory?: string) {
  if (!directory) return false
  return /(^|[\\/])\.origin[\\/]runs([\\/]|$)/.test(directory)
}

export function shouldSuppressSessionNotification(input: {
  session?: { directory?: string } | undefined
  link?: Pick<GraphSessionLink, "role" | "visibility"> | null
}) {
  if (input.link?.role === "execution_node" && input.link.visibility === "hidden") return true
  return isRunWorkspaceDirectory(input.session?.directory)
}
