const mask = "[REDACTED]"

const field = [
  "access[_-]?token",
  "refresh[_-]?token",
  "id[_-]?token",
  "session[_-]?token",
  "token",
  "secret",
  "password",
  "passphrase",
  "api[_-]?key",
  "private[_-]?key",
  "client[_-]?secret",
  "credential",
  "credentials",
  "authorization",
  "cookie",
].join("|")

const field_pattern = new RegExp(`(?:^|_)(${field.replaceAll("[_-]?", "_")})$`, "i")
const inline_pattern = new RegExp(
  `((?:^|[\\s{[(,;])["']?(?:${field})["']?\\s*[:=]\\s*["']?)([^"'\\s,}\\])]+)(["']?)`,
  "gi",
)
const env_pattern = new RegExp(
  `((?:^|\\s)(?:export\\s+)?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSPHRASE|API_KEY|PRIVATE_KEY|CLIENT_SECRET|AUTHORIZATION|COOKIE)[A-Z0-9_]*=)([^\\s"'\\\`]+)`,
  "gim",
)
const query_pattern = new RegExp(
  `(([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|token|secret|password|api[_-]?key|client[_-]?secret|authorization|cookie)=))([^&\\s]+)`,
  "gi",
)
const auth_pattern = /(authorization\s*[:=]\s*(?:bearer|basic)\s+)([^\s"'`,;]+)/gi
const bearer_pattern = /(\bbearer\s+)([A-Za-z0-9._~+/-]+=*)/gi
const basic_pattern = /(\bbasic\s+)([A-Za-z0-9+/=]+)/gi

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
}

function secret(value: string) {
  return field_pattern.test(normalize(value))
}

function uniq(input: Iterable<string>) {
  return Array.from(
    new Set(
      Array.from(input)
        .map((item) => item.trim())
        .filter((item) => item.length >= 6),
    ),
  ).toSorted((a, b) => b.length - a.length || a.localeCompare(b))
}

function env() {
  return uniq(
    Object.entries(process.env)
      .filter(([key, value]) => Boolean(value) && secret(key))
      .map(([, value]) => value ?? ""),
  )
}

function variants(value: string) {
  const result = new Set<string>([value])
  const url = encodeURIComponent(value)
  if (url !== value) result.add(url)
  const json = JSON.stringify(value).slice(1, -1)
  if (json !== value) result.add(json)
  const base64 = Buffer.from(value).toString("base64")
  if (base64 !== value) result.add(base64)
  const base64url = base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
  if (base64url !== value) result.add(base64url)
  return uniq(result)
}

function fragment(value: string) {
  if (value.length < 8 || value.length > 120) return
  return new RegExp(Array.from(value).map(escape).join(`[\\s"'\\\`:=_-]*`), "g")
}

function replace(text: string, value: string) {
  let result = text
  for (const item of variants(value)) {
    result = result.replaceAll(item, mask)
  }
  const split = fragment(value)
  if (split) result = result.replace(split, mask)
  return result
}

function collapse(text: string) {
  return text.replace(/(?:\[REDACTED\][\s"'`:=_-]*){2,}/g, mask)
}

function redact_text(input: string, options?: { secrets?: Iterable<string> }) {
  const secrets = uniq([...(options?.secrets ?? []), ...env()])
  let result = input
  secrets.forEach((item) => {
    result = replace(result, item)
  })
  result = result.replace(inline_pattern, (_, prefix: string, value: string, suffix: string) => {
    if (!value) return `${prefix}${suffix}`
    return `${prefix}${mask}${suffix}`
  })
  result = result.replace(env_pattern, (_, prefix: string) => `${prefix}${mask}`)
  result = result.replace(query_pattern, (_, prefix: string) => `${prefix}${mask}`)
  result = result.replace(auth_pattern, (_, prefix: string) => `${prefix}${mask}`)
  result = result.replace(bearer_pattern, (_, prefix: string) => `${prefix}${mask}`)
  result = result.replace(basic_pattern, (_, prefix: string) => `${prefix}${mask}`)
  return collapse(result)
}

function walk(input: unknown, secrets: string[], trail: string[] = [], seen = new WeakMap<object, unknown>()): unknown {
  if (typeof input === "string") return redact_text(input, { secrets })
  if (Array.isArray(input)) {
    const result: unknown[] = []
    seen.set(input, result)
    input.forEach((item, index) => {
      result[index] = walk(item, secrets, [...trail, index.toString()], seen)
    })
    return result
  }
  if (!input || typeof input !== "object") return input
  if (seen.has(input)) return seen.get(input)
  if (input instanceof Date) return input
  if (input instanceof URL) return redact_text(input.toString(), { secrets })

  const result: Record<string, unknown> = {}
  seen.set(input, result)
  Object.entries(input).forEach(([key, item]) => {
    const next = [...trail, key]
    if (secret(key) || secret(next.join("_"))) {
      result[key] = mask
      return
    }
    result[key] = walk(item, secrets, next, seen)
  })
  return result
}

export namespace Redaction {
  export const MASK = mask

  export function text(input: string, options?: { secrets?: Iterable<string> }) {
    return redact_text(input, options)
  }

  export function value<T>(input: T, options?: { secrets?: Iterable<string> }) {
    return walk(input, uniq([...(options?.secrets ?? []), ...env()])) as T
  }
}
