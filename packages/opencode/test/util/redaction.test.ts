import { describe, expect, test } from "bun:test"
import { Redaction } from "../../src/util/redaction"

async function with_secret<T>(fn: (value: string) => Promise<T> | T) {
  const key = "OPENCODE_TEST_SECRET"
  const value = "phase13-canary-secret-9f4e0d31"
  const prior = process.env[key]
  process.env[key] = value
  try {
    return await fn(value)
  } finally {
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
}

describe("util.redaction", () => {
  test("redacts exact, encoded, base64, and fragmented secret variants", async () => {
    await with_secret((secret) => {
      const encoded = encodeURIComponent(secret)
      const base64 = Buffer.from(secret).toString("base64")
      const fragment = secret.split("").join(" ")
      const input = [
        `raw ${secret}`,
        `encoded ${encoded}`,
        `base64 ${base64}`,
        `fragment ${fragment}`,
        `Authorization: Bearer ${secret}`,
        `OPENAI_API_KEY=${secret}`,
      ].join("\n")

      const result = Redaction.text(input)

      expect(result).not.toContain(secret)
      expect(result).not.toContain(encoded)
      expect(result).not.toContain(base64)
      expect(result).not.toContain(fragment)
      expect(result).toContain(Redaction.MASK)
    })
  })

  test("redacts object values and preserves non-secret token counters", async () => {
    await with_secret((secret) => {
      const result = Redaction.value({
        apiKey: secret,
        note: `value=${secret}`,
        nested: {
          clientSecret: secret,
          tokens: {
            input: 1,
            output: 2,
          },
          tokenCount: 3,
        },
      })

      expect(result.apiKey).toBe(Redaction.MASK)
      expect(result.note).toContain(Redaction.MASK)
      expect(result.note).not.toContain(secret)
      expect(result.nested.clientSecret).toBe(Redaction.MASK)
      expect(result.nested.tokens).toEqual({
        input: 1,
        output: 2,
      })
      expect(result.nested.tokenCount).toBe(3)
    })
  })
})
