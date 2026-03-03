export type PaletteMode = "all" | "files"

export function normalizeWorkspaceDirectory(input: string | undefined) {
  const value = (input ?? "").trim()
  if (!value) return ""
  const drive = value.match(/^([A-Za-z]:)[\\/]+$/)
  if (drive) return `${drive[1]}${value.includes("\\") ? "\\" : "/"}`
  if (/^[\\/]+$/.test(value)) return value.includes("\\") ? "\\" : "/"
  return value.replace(/[\\/]+$/, "")
}

function separator(path: string) {
  if (path.includes("\\") && !path.includes("/")) return "\\"
  return "/"
}

export function defaultGlobalWorkspaceDirectory(home: string | undefined) {
  const root = normalizeWorkspaceDirectory(home)
  if (!root) return ""
  const sep = separator(root)
  return `${root}${sep}Documents${sep}origin`
}

export function resolveGlobalWorkspaceDirectory(input: { configured: string | undefined; home: string | undefined }) {
  const configured = normalizeWorkspaceDirectory(input.configured)
  if (configured) return configured
  return defaultGlobalWorkspaceDirectory(input.home)
}

export function isProtectedWorkspace(input: { directory: string | undefined; protectedDirectory: string | undefined }) {
  const directory = normalizeWorkspaceDirectory(input.directory)
  const protectedDirectory = normalizeWorkspaceDirectory(input.protectedDirectory)
  if (!directory) return false
  if (!protectedDirectory) return false
  return directory === protectedDirectory
}

export function shouldShowEntryCommand(input: { query: string; mode: PaletteMode }) {
  if (input.mode === "files") return false
  const query = input.query.trim()
  if (!query) return false
  if (query.startsWith("/")) return false
  return true
}

export function sortPaletteGroupsWithGlobal(a: { category: string }, b: { category: string }) {
  if (a.category === "Global" && b.category !== "Global") return -1
  if (b.category === "Global" && a.category !== "Global") return 1
  return 0
}

export function shouldBootstrapToGlobalWorkspace(input: {
  autoselect: boolean
  pageReady: boolean
  layoutReady: boolean
  hasDirectoryParam: boolean
  bootstrapping: boolean
  workspaceDirectory?: string
}) {
  if (!input.autoselect) return false
  if (!input.pageReady) return false
  if (!input.layoutReady) return false
  if (input.hasDirectoryParam) return false
  if (input.bootstrapping) return false
  return true
}
