import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { now } from './helpers.ts'
import { createInitialState } from './state.ts'
import type { OriginState, RuntimePaths } from './types.ts'

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true })
}

async function ensureFile(path: string, content: string) {
  await ensureDir(dirname(path))
  try {
    await readFile(path, 'utf8')
  } catch {
    await writeFile(path, content, 'utf8')
  }
}

async function materializeState(paths: RuntimePaths, state: OriginState) {
  const memoryRevision = state.memory.revisions.at(-1)
  await ensureFile(join(paths.vaultRoot, 'Origin', 'Memory.md'), memoryRevision?.content ?? '# Origin Memory\n')

  for (const note of state.notes.notes) {
    await ensureFile(join(paths.workspaceRoot, note.path), note.content)
  }
}

export function createRuntimePaths(profile = 'default'): RuntimePaths {
  const root = join(os.homedir(), '.origin', profile)
  const stateDir = join(root, 'state')
  const workspaceRoot = join(root, 'workspace')
  return {
    blobsDir: join(root, 'blobs'),
    exportsDir: join(root, 'exports'),
    sqliteFile: join(stateDir, 'origin.sqlite'),
    stateDir,
    stateFile: join(stateDir, 'state.json'),
    vaultRoot: workspaceRoot,
    workspaceRoot,
  }
}

export class OriginStore {
  readonly paths: RuntimePaths

  constructor(paths: RuntimePaths) {
    this.paths = paths
  }

  async load() {
    await ensureDir(this.paths.stateDir)
    try {
      const raw = await readFile(this.paths.stateFile, 'utf8')
      const state = JSON.parse(raw) as OriginState
      await materializeState(this.paths, state)
      return state
    } catch {
      const state = createInitialState(this.paths)
      await this.save(state)
      return state
    }
  }

  async save(state: OriginState) {
    state.updatedAt = now()
    await ensureDir(this.paths.stateDir)
    await writeFile(this.paths.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await materializeState(this.paths, state)
  }

  async mutate<T>(mutator: (state: OriginState) => T | Promise<T>) {
    const state = await this.load()
    const result = await mutator(state)
    await this.save(state)
    return result
  }
}
