import { OriginStore, createRuntimePaths } from './store.ts'

export interface RuntimeContext {
  apiUrl?: string
  instance: 'local' | 'vps'
  paths: ReturnType<typeof createRuntimePaths>
  profile: string
  store: OriginStore
}

export async function createRuntimeContext(options: {
  apiUrl?: string
  instance?: 'local' | 'vps'
  profile?: string
}) {
  const profile = options.profile || 'default'
  const paths = createRuntimePaths(profile)
  const store = new OriginStore(paths)
  await store.load()
  return {
    apiUrl: options.apiUrl,
    instance: options.instance ?? 'local',
    paths,
    profile,
    store,
  } satisfies RuntimeContext
}
