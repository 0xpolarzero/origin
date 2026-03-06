import { describe, expect, test } from "bun:test"
import {
  loadHistoryOperations,
  loadHistoryRuns,
  normalizeOperationPage,
  normalizeRunPage,
  type HistoryOperation,
  type HistoryRun,
} from "./history-data"

const run = (id: string): HistoryRun => ({
  id,
  status: "completed",
  trigger_type: "manual",
  workflow_id: "workflow.daily",
  workspace_id: "wrk_1",
  session_id: "session_1",
  reason_code: null,
  failure_code: null,
  ready_for_integration_at: null,
  created_at: 10,
  updated_at: 10,
  started_at: 10,
  finished_at: 11,
  operation_id: "op_1",
  operation_exists: true,
  duplicate_event: {
    reason: false,
    failure: false,
  },
})

const operation = (id: string, provenance: "app" | "user"): HistoryOperation => ({
  id,
  run_id: "run_1",
  run_exists: true,
  status: "completed",
  trigger_type: "manual",
  workflow_id: "workflow.daily",
  workspace_id: "wrk_1",
  session_id: "session_1",
  ready_for_integration_at: null,
  changed_paths: ["README.md"],
  created_at: 10,
  updated_at: 10,
  provenance,
})

describe("history-data", () => {
  test("normalizeRunPage keeps valid rows and removes malformed rows", () => {
    const value = normalizeRunPage({
      items: [run("run_1"), { id: "broken" }],
      next_cursor: "10:run_1",
    })

    expect(value.items.map((item) => item.id)).toEqual(["run_1"])
    expect(value.next_cursor).toBe("10:run_1")
  })

  test("normalizeOperationPage keeps valid rows and parses next cursor", () => {
    const value = normalizeOperationPage({
      items: [operation("op_1", "app"), { id: "bad", provenance: "unknown" }],
      next_cursor: "20:op_1",
    })

    expect(value.items.map((item) => item.id)).toEqual(["op_1"])
    expect(value.items[0]?.provenance).toBe("app")
    expect(value.next_cursor).toBe("20:op_1")
  })

  test("loadHistoryRuns sends directory/auth headers and run query params", async () => {
    let seen = ""
    let headers = new Headers()

    const page = await loadHistoryRuns({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/proj-é",
      auth: "Basic token",
      include_debug: true,
      cursor: "10:run_1",
      limit: 5,
      fetch: async (url, init) => {
        seen = `${url}`
        headers = new Headers(init?.headers)
        return new Response(
          JSON.stringify({
            items: [run("run_1")],
            next_cursor: null,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        )
      },
    })

    expect(seen).toBe("http://localhost:4096/workflow/history/runs?cursor=10%3Arun_1&limit=5&include_debug=true")
    expect(headers.get("x-opencode-directory")).toBe(encodeURIComponent("/tmp/proj-é"))
    expect(headers.get("authorization")).toBe("Basic token")
    expect(page.items.map((item) => item.id)).toEqual(["run_1"])
  })

  test("loadHistoryOperations sends include_user query only when enabled", async () => {
    const calls: string[] = []

    const fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" || input instanceof URL ? `${input}` : input.url
      calls.push(url)
      return new Response(
        JSON.stringify({
          items: [operation("op_1", "app")],
          next_cursor: null,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )
    }

    await loadHistoryOperations({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      fetch: fetch as typeof globalThis.fetch,
    })

    await loadHistoryOperations({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      include_user: true,
      fetch: fetch as typeof globalThis.fetch,
    })

    expect(calls[0]).toBe("http://localhost:4096/workflow/history/operations")
    expect(calls[1]).toBe("http://localhost:4096/workflow/history/operations?include_user=true")
  })

  test("loadHistoryRuns throws endpoint error payload", async () => {
    const result = loadHistoryRuns({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      fetch: async () =>
        new Response("history failed", {
          status: 500,
        }),
    })

    await expect(result).rejects.toThrow("history failed")
  })

  test("loadHistoryOperations throws on invalid json response", async () => {
    const result = loadHistoryOperations({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      fetch: async () =>
        new Response("<html>", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        }),
    })

    await expect(result).rejects.toThrow("History endpoint returned invalid JSON.")
  })
})
