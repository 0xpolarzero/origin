import path from "node:path"
import { realpath } from "node:fs/promises"
import { Global } from "@/global"

function normalize(input: string) {
  const value = path.resolve(input).replaceAll("\\", "/").replace(/\/+$/, "")
  if (!value) return "/"
  return value
}

export namespace RuntimeWorkspaceType {
  export async function detect(directory: string): Promise<"origin" | "standard"> {
    const root = normalize(path.join(Global.Path.home, "Documents", "origin"))
    const current = normalize(directory)
    if (current === root) return "origin"

    const [resolved_root, resolved_current] = await Promise.all([
      realpath(root).catch(() => undefined),
      realpath(directory).catch(() => undefined),
    ])
    if (!resolved_root || !resolved_current) return "standard"
    if (normalize(resolved_current) === normalize(resolved_root)) return "origin"
    return "standard"
  }
}
