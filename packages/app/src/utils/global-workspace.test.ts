import { describe, expect, test } from "bun:test"
import {
  defaultGlobalWorkspaceDirectory,
  isProtectedWorkspace,
  normalizeWorkspaceDirectory,
  resolveGlobalWorkspaceDirectory,
  sortPaletteGroupsWithGlobal,
  shouldBootstrapToGlobalWorkspace,
  shouldShowEntryCommand,
} from "./global-workspace"

describe("global workspace path helpers", () => {
  test("resolves default directory from posix home", () => {
    expect(defaultGlobalWorkspaceDirectory("/Users/polarzero")).toBe("/Users/polarzero/Documents/origin")
  })

  test("resolves default directory from windows home", () => {
    expect(defaultGlobalWorkspaceDirectory("C:\\Users\\polarzero")).toBe("C:\\Users\\polarzero\\Documents\\origin")
  })

  test("uses configured override when provided", () => {
    expect(
      resolveGlobalWorkspaceDirectory({
        configured: " /tmp/custom/ ",
        home: "/Users/polarzero",
      }),
    ).toBe("/tmp/custom")
  })

  test("falls back to home-derived default when override is empty", () => {
    expect(
      resolveGlobalWorkspaceDirectory({
        configured: " ",
        home: "/Users/polarzero",
      }),
    ).toBe("/Users/polarzero/Documents/origin")
  })

  test("returns empty default when home is unavailable", () => {
    expect(
      resolveGlobalWorkspaceDirectory({
        configured: "",
        home: undefined,
      }),
    ).toBe("")
  })

  test("normalizes trailing separators", () => {
    expect(normalizeWorkspaceDirectory("/tmp/demo///")).toBe("/tmp/demo")
    expect(normalizeWorkspaceDirectory("C:\\tmp\\demo\\\\")).toBe("C:\\tmp\\demo")
  })
})

describe("global workspace guards", () => {
  test("matches protected workspace with normalized paths", () => {
    expect(
      isProtectedWorkspace({
        directory: "/tmp/demo/",
        protectedDirectory: "/tmp/demo",
      }),
    ).toBe(true)
  })

  test("does not match different directories", () => {
    expect(
      isProtectedWorkspace({
        directory: "/tmp/a",
        protectedDirectory: "/tmp/b",
      }),
    ).toBe(false)
  })
})

describe("entry command visibility", () => {
  test("shows only for non-empty non-slash query in all mode", () => {
    expect(shouldShowEntryCommand({ query: "fix tests", mode: "all" })).toBe(true)
    expect(shouldShowEntryCommand({ query: "   ", mode: "all" })).toBe(false)
    expect(shouldShowEntryCommand({ query: "/open", mode: "all" })).toBe(false)
    expect(shouldShowEntryCommand({ query: "fix tests", mode: "files" })).toBe(false)
  })

  test("sorts the global palette group first", () => {
    expect(sortPaletteGroupsWithGlobal({ category: "Global" }, { category: "Commands" })).toBe(-1)
    expect(sortPaletteGroupsWithGlobal({ category: "Commands" }, { category: "Global" })).toBe(1)
    expect(sortPaletteGroupsWithGlobal({ category: "Commands" }, { category: "Sessions" })).toBe(0)
  })
})

describe("startup bootstrap decision", () => {
  test("boots when root route is idle and ready", () => {
    expect(
      shouldBootstrapToGlobalWorkspace({
        autoselect: true,
        pageReady: true,
        layoutReady: true,
        hasDirectoryParam: false,
        bootstrapping: false,
        workspaceDirectory: "/Users/polarzero/Documents/origin",
      }),
    ).toBe(true)
  })

  test("skips bootstrap when any gate is not met", () => {
    expect(
      shouldBootstrapToGlobalWorkspace({
        autoselect: false,
        pageReady: true,
        layoutReady: true,
        hasDirectoryParam: false,
        bootstrapping: false,
        workspaceDirectory: "/Users/polarzero/Documents/origin",
      }),
    ).toBe(false)
    expect(
      shouldBootstrapToGlobalWorkspace({
        autoselect: true,
        pageReady: false,
        layoutReady: true,
        hasDirectoryParam: false,
        bootstrapping: false,
        workspaceDirectory: "/Users/polarzero/Documents/origin",
      }),
    ).toBe(false)
    expect(
      shouldBootstrapToGlobalWorkspace({
        autoselect: true,
        pageReady: true,
        layoutReady: false,
        hasDirectoryParam: false,
        bootstrapping: false,
        workspaceDirectory: "/Users/polarzero/Documents/origin",
      }),
    ).toBe(false)
    expect(
      shouldBootstrapToGlobalWorkspace({
        autoselect: true,
        pageReady: true,
        layoutReady: true,
        hasDirectoryParam: true,
        bootstrapping: false,
        workspaceDirectory: "/Users/polarzero/Documents/origin",
      }),
    ).toBe(false)
    expect(
      shouldBootstrapToGlobalWorkspace({
        autoselect: true,
        pageReady: true,
        layoutReady: true,
        hasDirectoryParam: false,
        bootstrapping: true,
        workspaceDirectory: "/Users/polarzero/Documents/origin",
      }),
    ).toBe(false)
  })
})
