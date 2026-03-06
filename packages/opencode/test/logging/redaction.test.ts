import { describe, expect, test } from "bun:test"
import { FormatUnknownError } from "../../src/cli/error"
import { Log } from "../../src/util/log"
import { Redaction } from "../../src/util/redaction"
import { Filesystem } from "../../src/util/filesystem"

async function with_secret<T>(fn: (value: string) => Promise<T> | T) {
  const key = "OPENCODE_TEST_SECRET"
  const value = "phase13-logging-canary-7b2fd8c1"
  const prior = process.env[key]
  process.env[key] = value
  try {
    return await fn(value)
  } finally {
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
}

describe("logging redaction", () => {
  test("redacts secrets from structured log output", async () => {
    await with_secret(async (secret) => {
      await Log.init({ print: false, dev: true })
      const log = Log.create({ service: "logging-redaction" })
      const encoded = encodeURIComponent(secret)
      log.error(`crash ${secret}`, {
        apiKey: secret,
        encoded,
        failure: new Error(`failed ${secret}`),
      })

      await Bun.sleep(50)
      const file = await Filesystem.readText(Log.file())

      expect(file).not.toContain(secret)
      expect(file).not.toContain(encoded)
      expect(file).toContain(Redaction.MASK)
    })
  })

  test("redacts secrets from unknown error formatting", async () => {
    await with_secret((secret) => {
      const encoded = encodeURIComponent(secret)
      const error = new Error(`boom ${secret}`)
      error.stack = `Error: boom ${secret}\n${encoded}\nAuthorization: Bearer ${secret}`

      const result = FormatUnknownError(error)

      expect(result).not.toContain(secret)
      expect(result).not.toContain(encoded)
      expect(result).toContain(Redaction.MASK)
    })
  })

  test("redacts secrets from unknown error objects", async () => {
    await with_secret((secret) => {
      const result = FormatUnknownError({
        apiKey: secret,
        nested: {
          note: `value=${secret}`,
        },
      })

      expect(result).not.toContain(secret)
      expect(result).toContain(Redaction.MASK)
    })
  })
})
