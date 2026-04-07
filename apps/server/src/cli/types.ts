import type { RuntimeContext } from '../runtime/context.ts'

export type CliEnv = {
  ORIGIN_API_URL?: string
  ORIGIN_INSTANCE?: 'local' | 'vps'
  ORIGIN_PROFILE?: string
}

export type RouteKey = string

export type RouteArgs<_route extends RouteKey> = any
export type RouteOptions<_route extends RouteKey> = any

export type RouteHandlerContext<route extends RouteKey> = {
  agent: boolean
  args: RouteArgs<route>
  displayName: string
  env: CliEnv
  error: (options: {
    code: string
    cta?: unknown
    exitCode?: number
    message: string
    retryable?: boolean
  }) => never
  format: string
  formatExplicit: boolean
  name: string
  ok: (data: unknown, meta?: { cta?: unknown }) => never
  options: RouteOptions<route>
  route: route
  runtime: RuntimeContext
}

export type RouteHandler<route extends RouteKey> = (
  context: RouteHandlerContext<route>,
) => unknown | Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>

export type HandlerMap = Record<string, RouteHandler<any>>

export function defineHandlers<const routes extends HandlerMap>(routes: routes) {
  return routes
}
