import { describe, expect, test } from "bun:test"
import z from "zod"
import { Tool } from "../../src/tool/tool"
import { Redaction } from "../../src/util/redaction"

const ctx = {
  sessionID: "session",
  messageID: "message",
  callID: "call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function with_secret<T>(fn: (value: string) => Promise<T> | T) {
  const key = "OPENCODE_TEST_SECRET"
  const value = "phase13-tool-canary-ec9d8e86"
  const prior = process.env[key]
  process.env[key] = value
  try {
    return await fn(value)
  } finally {
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
}

describe("tool redaction", () => {
  test("sanitizes tool output, title, and metadata before returning", async () => {
    await with_secret(async (secret) => {
      const subject = Tool.define("redaction_test", {
        description: "redaction test",
        parameters: z.object({}),
        async execute() {
          return {
            title: `title ${secret}`,
            output: `output ${secret}`,
            metadata: {
              apiKey: secret,
              note: `note ${secret}`,
            },
          }
        },
      })

      const tool = await subject.init()
      const result = await tool.execute({}, ctx)

      expect(result.title).not.toContain(secret)
      expect(result.output).not.toContain(secret)
      expect(result.output).toContain(Redaction.MASK)
      expect(result.metadata.apiKey).toBe(Redaction.MASK)
      expect(result.metadata.note).toContain(Redaction.MASK)
    })
  })
})
