import { describe, expect, test } from "bun:test"
import { isRunWorkspaceDirectory, shouldSuppressSessionNotification } from "./notification-session"

describe("isRunWorkspaceDirectory", () => {
  test("matches workflow run workspace paths", () => {
    expect(isRunWorkspaceDirectory("/tmp/origin/.origin/runs/run_1")).toBe(true)
    expect(isRunWorkspaceDirectory("C:\\origin\\.origin\\runs\\run_1")).toBe(true)
  })

  test("ignores normal project directories", () => {
    expect(isRunWorkspaceDirectory("/tmp/origin")).toBe(false)
    expect(isRunWorkspaceDirectory(undefined)).toBe(false)
  })
})

describe("shouldSuppressSessionNotification", () => {
  test("suppresses hidden execution sessions from explicit links", () => {
    expect(
      shouldSuppressSessionNotification({
        session: { directory: "/tmp/origin" },
        link: {
          role: "execution_node",
          visibility: "hidden",
        },
      }),
    ).toBe(true)
  })

  test("fails closed for run-workspace sessions when link lookup is unavailable", () => {
    expect(
      shouldSuppressSessionNotification({
        session: { directory: "/tmp/origin/.origin/runs/run_1" },
        link: null,
      }),
    ).toBe(true)
  })

  test("keeps normal project sessions visible", () => {
    expect(
      shouldSuppressSessionNotification({
        session: { directory: "/tmp/origin" },
        link: null,
      }),
    ).toBe(false)
  })
})
