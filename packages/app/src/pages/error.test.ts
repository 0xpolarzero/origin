import { describe, expect, test } from "bun:test"
import { formatError } from "./error-format"
import { Redaction } from "@/utils/redaction"

const t = ((key: string, values?: Record<string, unknown>) => {
  switch (key) {
    case "error.chain.apiError":
      return "API error"
    case "error.chain.status":
      return `Status: ${values?.status ?? ""}`
    case "error.chain.retryable":
      return `Retryable: ${values?.retryable ?? ""}`
    case "error.chain.responseBody":
      return `Response body:\n${values?.body ?? ""}`
    case "error.chain.unknown":
      return "Unknown error"
    case "error.chain.causedBy":
      return "Caused by"
    default:
      return `${key} ${Object.values(values ?? {}).join(" ")}`
  }
}) as never

async function with_secret<T>(fn: (value: string) => Promise<T> | T) {
  const key = "OPENCODE_TEST_SECRET"
  const value = "phase13-error-canary-5d7a1c9e"
  const prior = process.env[key]
  process.env[key] = value
  try {
    return await fn(value)
  } finally {
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
}

describe("error page formatting", () => {
  test("redacts unknown error payloads", async () => {
    await with_secret((secret) => {
      const value = formatError(
        {
          name: "UnknownError",
          data: {
            message: `boom ${secret}`,
          },
        },
        t,
      )

      expect(value).not.toContain(secret)
      expect(value).toContain(Redaction.MASK)
    })
  })

  test("redacts api response bodies", async () => {
    await with_secret((secret) => {
      const value = formatError(
        {
          name: "APIError",
          data: {
            message: "request failed",
            responseBody: JSON.stringify({ apiKey: secret }),
          },
        },
        t,
      )

      expect(value).not.toContain(secret)
      expect(value).toContain(Redaction.MASK)
    })
  })

  test("redacts error stacks", async () => {
    await with_secret((secret) => {
      const error = new Error(`boom ${secret}`)
      error.stack = `Error: boom ${secret}\nAuthorization: Bearer ${secret}\n${encodeURIComponent(secret)}`

      const value = formatError(error, t)

      expect(value).not.toContain(secret)
      expect(value).not.toContain(encodeURIComponent(secret))
      expect(value).toContain(Redaction.MASK)
    })
  })
})
