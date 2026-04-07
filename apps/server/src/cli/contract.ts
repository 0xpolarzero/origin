import { Cli } from 'incur'

import contractOrigin, { originRootDefinition } from './spec.ts'
import { handlers } from '../handlers/index.ts'
import { createRuntimeContext } from '../runtime/context.ts'
import { ORIGIN_RUNTIME_VERSION } from '../lib/version.ts'

type ContractEntry = Record<string, any> & {
  _group?: boolean
  commands?: Map<string, ContractEntry>
}

function getContractCommands() {
  const commands = Cli.toCommands.get(contractOrigin as any)
  if (!commands) throw new Error('Unable to load command map from the Origin CLI contract.')
  return commands as Map<string, ContractEntry>
}

function isGroup(entry: ContractEntry) {
  return Boolean(entry?._group && entry.commands instanceof Map)
}

function collectLeafCommandPaths(
  commands: Map<string, ContractEntry>,
  prefix: string[] = [],
): string[] {
  const paths: string[] = []
  for (const [name, entry] of commands) {
    const next = [...prefix, name]
    if (isGroup(entry)) {
      paths.push(...collectLeafCommandPaths(entry.commands!, next))
      continue
    }
    paths.push(next.join(' '))
  }
  return paths
}

function validateHandlerCoverage() {
  const contractPaths = collectLeafCommandPaths(getContractCommands()).toSorted()
  const handlerKeys = Object.keys(handlers).filter((key) => !key.includes('.')).toSorted()
  const handlerKeySet = new Set(handlerKeys)
  const missing = contractPaths.filter((path) => !handlerKeySet.has(path))
  if (missing.length > 0) {
    throw new Error(`Origin CLI handler coverage is incomplete: ${missing.join(', ')}`)
  }
}

function createGroup(name: string, entry: ContractEntry) {
  return Cli.create(name, {
    description: entry.description as string | undefined,
  })
}

function mountCommands(
  target: ReturnType<typeof Cli.create>,
  commands: Map<string, ContractEntry>,
  prefix: string[] = [],
) {
  for (const [name, entry] of commands) {
    const path = [...prefix, name]
    if (isGroup(entry)) {
      const group = createGroup(name, entry)
      mountCommands(group, entry.commands!, path)
      target.command(group as any)
      continue
    }

    const route = path.join(' ')
    const handler = (handlers as Record<string, (context: any) => unknown | Promise<unknown>>)[route]
    if (!handler) {
      throw new Error(`Missing handler for Origin CLI route: ${route}`)
    }

    const { run: _ignored, ...definition } = entry
    target.command(name, {
      ...definition,
      async run(c: any) {
        const env = c.env ?? {}
        const runtime = await createRuntimeContext({
          apiUrl: env.ORIGIN_API_URL,
          instance: env.ORIGIN_INSTANCE,
          profile: env.ORIGIN_PROFILE,
        })

        const result = await handler({
          agent: Boolean(c.agent),
          args: c.args ?? {},
          displayName: c.displayName ?? 'Origin',
          env,
          error: c.error.bind(c),
          format: c.format ?? 'json',
          formatExplicit: Boolean(c.formatExplicit),
          name: c.name ?? name,
          ok: c.ok.bind(c),
          options: c.options ?? {},
          route,
          runtime,
        })

        const output = (definition as { output?: { parse?: (value: unknown) => unknown } }).output
        return output?.parse ? output.parse(result) : result
      },
    } as any)
  }
}

validateHandlerCoverage()

export const origin = Cli.create('origin', {
  ...originRootDefinition,
  version: ORIGIN_RUNTIME_VERSION,
})

mountCommands(origin, getContractCommands())
