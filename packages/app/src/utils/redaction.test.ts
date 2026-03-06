import { describe, expect, test } from "bun:test"
import { Redaction } from "./redaction"

async function with_secret<T>(fn: (value: string) => Promise<T> | T) {
  const key = "OPENCODE_TEST_SECRET"
  const value = "phase13-app-canary-6f2c8b1d"
  const prior = process.env[key]
  process.env[key] = value
  try {
    return await fn(value)
  } finally {
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
}

describe("app redaction", () => {
  test("redacts exact, encoded, base64, and fragmented secret variants", async () => {
    await with_secret((secret) => {
      const encoded = encodeURIComponent(secret)
      const base64 = Buffer.from(secret).toString("base64")
      const fragment = secret.split("").join(" ")

      const result = Redaction.text([secret, encoded, base64, fragment].join("\n"))

      expect(result).not.toContain(secret)
      expect(result).not.toContain(encoded)
      expect(result).not.toContain(base64)
      expect(result).not.toContain(fragment)
      expect(result).toContain(Redaction.MASK)
    })
  })
})
