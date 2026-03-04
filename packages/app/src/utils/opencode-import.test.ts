import { describe, expect, test } from "bun:test"
import { parseOpenCodeModelToggles } from "./opencode-import"

describe("parseOpenCodeModelToggles", () => {
  test("parses OpenCode visibility entries and keeps last duplicate", () => {
    const parsed = parseOpenCodeModelToggles(
      JSON.stringify({
        user: [
          { providerID: "openai", modelID: "gpt-5", visibility: "show" },
          { providerID: "anthropic", modelID: "claude", visibility: "hide" },
          { providerID: "openai", modelID: "gpt-5", visibility: "hide" },
        ],
      }),
    )

    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return
    expect(parsed.entries).toEqual([
      { providerID: "openai", modelID: "gpt-5", visible: false },
      { providerID: "anthropic", modelID: "claude", visible: false },
    ])
  })

  test("returns missing when source is absent", () => {
    const parsed = parseOpenCodeModelToggles(null)
    expect(parsed).toEqual({
      status: "error",
      reason: "missing",
    })
  })

  test("returns invalid when source is malformed", () => {
    const parsed = parseOpenCodeModelToggles("{broken")
    expect(parsed).toEqual({
      status: "error",
      reason: "invalid",
    })
  })

  test("returns invalid when source has no valid user entries", () => {
    const parsed = parseOpenCodeModelToggles(
      JSON.stringify({
        user: [{ providerID: "openai", modelID: "gpt-5", visibility: "sideways" }],
        recent: [{ providerID: "openai", modelID: "gpt-5" }],
        variant: { "openai/gpt-5": "high" },
      }),
    )
    expect(parsed).toEqual({
      status: "error",
      reason: "invalid",
    })
  })

  test("imports only user visibility entries and ignores unrelated state", () => {
    const parsed = parseOpenCodeModelToggles(
      JSON.stringify({
        user: [{ providerID: "acme", modelID: "alpha", visibility: "hide" }],
        recent: [{ providerID: "noise", modelID: "recent" }],
        variant: { "noise/recent": "balanced" },
        provider_auth: {
          noise: { type: "api", key: "do-not-import" },
        },
      }),
    )
    expect(parsed).toEqual({
      status: "ok",
      entries: [{ providerID: "acme", modelID: "alpha", visible: false }],
    })
  })
})
