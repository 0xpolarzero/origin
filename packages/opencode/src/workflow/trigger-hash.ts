const version = "signal-fallback-v1"

function prune_source(_input?: Record<string, unknown>) {
  return {}
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.keys(value)
    .toSorted((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`
}

export namespace WorkflowTriggerHash {
  export const Version = version

  export function stable_json(value: unknown) {
    return stable(value)
  }

  export function canonical(input: {
    signal: string
    event_time: number
    payload_json: Record<string, unknown>
    source?: Record<string, unknown>
  }) {
    return stable({
      version,
      signal: input.signal,
      event_time: input.event_time,
      payload_json: input.payload_json,
      source: prune_source(input.source),
    })
  }

  export function fallback(input: {
    signal: string
    event_time: number
    payload_json: Record<string, unknown>
    source?: Record<string, unknown>
  }) {
    return new Bun.CryptoHasher("sha256").update(canonical(input)).digest("hex")
  }
}
