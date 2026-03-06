export type HistoryTab = "runs" | "operations"

export type HistoryQuery = {
  tab?: HistoryTab
  debug?: boolean
  run_id?: string
  operation_id?: string
}

export type DebugState = {
  persisted: boolean
  override?: boolean
}

type Duplicate = {
  duplicate_event: {
    reason: boolean
    failure: boolean
  }
}

const tabs = new Set<HistoryTab>(["runs", "operations"])

const bool = (value: string | null) => {
  if (!value) return
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "true") return true
  if (normalized === "0" || normalized === "false") return false
}

const text = (value: string | null) => {
  if (!value) return
  const normalized = value.trim()
  if (!normalized) return
  return normalized
}

export function parseHistoryQuery(value: string) {
  const params = new URLSearchParams(value.startsWith("?") ? value.slice(1) : value)
  const tab = params.get("tab")
  const run_id = text(params.get("run_id"))
  const operation_id = text(params.get("operation_id"))

  return {
    tab: tab && tabs.has(tab as HistoryTab) ? (tab as HistoryTab) : undefined,
    debug: bool(params.get("debug")),
    run_id,
    operation_id,
  } satisfies HistoryQuery
}

export function resolveDebug(input: DebugState) {
  if (input.override !== undefined) return input.override
  return input.persisted
}

export function applyDebugToggle(input: DebugState & { next: boolean }): DebugState {
  if (input.override !== undefined) {
    return {
      persisted: input.persisted,
      override: input.next,
    }
  }

  return {
    persisted: input.next,
    override: undefined,
  }
}

export function focusFromQuery(input: HistoryQuery) {
  if (input.operation_id) {
    return {
      tab: "operations" as const,
      id: input.operation_id,
    }
  }

  if (input.run_id) {
    return {
      tab: "runs" as const,
      id: input.run_id,
    }
  }
}

export function duplicate(input: Duplicate) {
  return input.duplicate_event.reason || input.duplicate_event.failure
}

export function counters<T extends Duplicate>(items: T[]) {
  return items.reduce(
    (acc, item) => {
      if (duplicate(item)) {
        return {
          runs: acc.runs,
          duplicates: acc.duplicates + 1,
        }
      }

      return {
        runs: acc.runs + 1,
        duplicates: acc.duplicates,
      }
    },
    {
      runs: 0,
      duplicates: 0,
    },
  )
}
