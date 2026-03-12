import path from "node:path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { git } from "@/util/git"
import { Worktree } from "@/worktree"
import { type Adaptor, WorkspaceInfo } from "../types"

const Config = WorkspaceInfo.extend({
  name: WorkspaceInfo.shape.name.unwrap(),
  branch: WorkspaceInfo.shape.branch.unwrap(),
  directory: WorkspaceInfo.shape.directory.unwrap(),
})

type Config = z.infer<typeof Config>

const Attached = z.object({
  local: z.literal(true),
  directory: z.string(),
})

const Local = z.object({
  local: z.literal(true),
})

async function local(info: WorkspaceInfo) {
  const parsed = Attached.safeParse(info.extra)
  if (!parsed.success) return

  const directory = path.resolve(parsed.data.directory)
  const project = await Project.fromDirectory(directory)
  if (project.project.id !== Instance.project.id) {
    throw new Error(`Workspace directory is outside the current project: ${directory}`)
  }

  const branch = await git(["branch", "--show-current"], { cwd: directory })
    .then((result) => result.text().trim())
    .catch(() => "")

  return {
    ...info,
    name: path.basename(directory) || "local",
    branch: branch || "detached",
    directory,
    extra: {
      local: true,
    },
  } satisfies WorkspaceInfo
}

export const WorktreeAdaptor: Adaptor = {
  async configure(info) {
    const attached = await local(info)
    if (attached) return attached

    const worktree = await Worktree.makeWorktreeInfo(info.name ?? undefined)
    return {
      ...info,
      name: worktree.name,
      branch: worktree.branch,
      directory: worktree.directory,
    }
  },
  async create(info) {
    if (Local.safeParse(info.extra).success) return

    const config = Config.parse(info)
    const bootstrap = await Worktree.createFromInfo({
      name: config.name,
      directory: config.directory,
      branch: config.branch,
    })
    return bootstrap()
  },
  async remove(info) {
    if (Local.safeParse(info.extra).success) return

    const config = Config.parse(info)
    await Worktree.remove({ directory: config.directory })
  },
  async fetch(info, input: RequestInfo | URL, init?: RequestInit) {
    const config = Config.parse(info)
    const { WorkspaceServer } = await import("../workspace-server/server")
    const url = input instanceof Request || input instanceof URL ? input : new URL(input, "http://opencode.internal")
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set("x-opencode-directory", config.directory)

    const request = new Request(url, { ...init, headers })
    return WorkspaceServer.App().fetch(request)
  },
}
