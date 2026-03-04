export type ModelVisibilityImport = {
  providerID: string
  modelID: string
  visible: boolean
}

type Parsed =
  | {
      status: "ok"
      entries: ModelVisibilityImport[]
    }
  | {
      status: "error"
      reason: "missing" | "invalid"
    }

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function asEntry(value: unknown) {
  const record = asRecord(value)
  if (!record) return
  if (typeof record.providerID !== "string" || !record.providerID) return
  if (typeof record.modelID !== "string" || !record.modelID) return
  if (record.visibility !== "show" && record.visibility !== "hide") return
  return {
    providerID: record.providerID,
    modelID: record.modelID,
    visible: record.visibility === "show",
  }
}

export function parseOpenCodeModelToggles(raw: string | null | undefined): Parsed {
  if (!raw) {
    return { status: "error", reason: "missing" }
  }

  const parsed = (() => {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return
    }
  })()
  if (!parsed) {
    return { status: "error", reason: "invalid" }
  }

  const root = asRecord(parsed)
  if (!root || !Array.isArray(root.user)) {
    return { status: "error", reason: "invalid" }
  }

  const mapped = root.user.map(asEntry).filter((entry) => !!entry)
  if (mapped.length === 0) {
    return { status: "error", reason: "invalid" }
  }

  const dedupe = new Map<string, ModelVisibilityImport>()
  for (const item of mapped) {
    dedupe.set(`${item.providerID}:${item.modelID}`, item)
  }

  return {
    status: "ok",
    entries: [...dedupe.values()],
  }
}
