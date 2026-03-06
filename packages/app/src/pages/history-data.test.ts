import { describe, expect, test } from "bun:test"
import {
  approveHistoryDraft,
  createHistoryDraft,
  loadHistoryOperations,
  loadHistoryDraft,
  loadHistoryDrafts,
  loadHistoryRuns,
  normalizeDraftDetail,
  normalizeDraftPage,
  normalizeOperationPage,
  normalizeRunPage,
  rejectHistoryDraft,
  sendHistoryDraft,
  type HistoryDraft,
  type HistoryOperation,
  type HistoryRun,
  updateHistoryDraft,
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
  trigger_metadata: {
    source: "cron",
    slot_local: "2026-03-08T02:30[America/New_York]",
  },
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

const draft = (id: string, status = "pending"): HistoryDraft => ({
  id,
  run_id: "run_1",
  workspace_id: "wrk_1",
  status,
  source_kind: "user",
  adapter_id: "test",
  integration_id: "test/default",
  action_id: "message.send",
  target: "channel://general",
  payload_json: { text: "hello" },
  payload_schema_version: 1,
  preview_text: "Message channel://general: hello",
  material_hash: "hash_1",
  block_reason_code: null,
  policy_id: "policy/outbound-default",
  policy_version: "10",
  decision_id: "decision_1",
  decision_reason_code: "policy_allow",
  created_at: 10,
  updated_at: 11,
  dispatch: {
    id: "dispatch_1",
    state: "created",
    idempotency_key: "dispatch:draft_1",
    remote_reference: null,
    block_reason_code: null,
  },
})

describe("history-data", () => {
  test("normalizeRunPage keeps valid rows and removes malformed rows", () => {
    const value = normalizeRunPage({
      items: [run("run_1"), { id: "broken" }],
      next_cursor: "10:run_1",
    })

    expect(value.items.map((item) => item.id)).toEqual(["run_1"])
    expect(value.items[0]?.trigger_metadata).toEqual({
      source: "cron",
      slot_local: "2026-03-08T02:30[America/New_York]",
    })
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

  test("normalizeDraftPage keeps valid rows and returns dispatch metadata", () => {
    const value = normalizeDraftPage({
      items: [draft("draft_1"), { id: "bad", payload_json: [] }],
      next_cursor: "11:draft_1",
    })

    expect(value.items.map((item) => item.id)).toEqual(["draft_1"])
    expect(value.items[0]?.dispatch?.id).toBe("dispatch_1")
    expect(value.next_cursor).toBe("11:draft_1")
  })

  test("normalizeDraftDetail accepts direct and nested draft payloads", () => {
    expect(normalizeDraftDetail(draft("draft_1"))?.id).toBe("draft_1")
    expect(
      normalizeDraftDetail({
        item: draft("draft_2"),
      })?.id,
    ).toBe("draft_2")
  })

  test("normalizeDraftDetail keeps drafts with empty preview text", () => {
    const value = normalizeDraftDetail({
      ...draft("draft_1"),
      preview_text: "",
    })

    expect(value?.id).toBe("draft_1")
    expect(value?.preview_text).toBe("")
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

  test("loadHistoryDrafts sends pending scope query params", async () => {
    let seen = ""

    const page = await loadHistoryDrafts({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      scope: "pending",
      cursor: "11:draft_1",
      limit: 10,
      fetch: async (url) => {
        seen = `${url}`
        return new Response(
          JSON.stringify({
            items: [draft("draft_1")],
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

    expect(seen).toBe("http://localhost:4096/workflow/history/drafts?cursor=11%3Adraft_1&limit=10&scope=pending")
    expect(page.items.map((item) => item.id)).toEqual(["draft_1"])
  })

  test("loadHistoryDraft reads a draft detail", async () => {
    let seen = ""

    const value = await loadHistoryDraft({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      workspace: "wrk_1",
      draft_id: "draft_1",
      fetch: async (url) => {
        seen = `${url}`
        return new Response(JSON.stringify(draft("draft_1")), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        })
      },
    })

    expect(seen).toBe("http://localhost:4096/workflow/drafts/draft_1?workspace=wrk_1")
    expect(value.id).toBe("draft_1")
  })

  test("createHistoryDraft sends json body and auth headers", async () => {
    let url = ""
    let method = ""
    let body = ""
    let headers = new Headers()

    const value = await createHistoryDraft({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/proj-é",
      auth: "Basic token",
      workspace: "wrk_1",
      body: {
        run_id: "run_1",
        source_kind: "user",
        adapter_id: "test",
        integration_id: "test/default",
        action_id: "message.send",
        target: "channel://general",
        payload_json: { text: "hello" },
        payload_schema_version: 1,
        actor_type: "user",
      },
      fetch: async (next, init) => {
        url = `${next}`
        method = `${init?.method}`
        body = `${init?.body ?? ""}`
        headers = new Headers(init?.headers)
        return new Response(JSON.stringify(draft("draft_1")), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        })
      },
    })

    expect(url).toBe("http://localhost:4096/workflow/drafts?workspace=wrk_1")
    expect(method).toBe("POST")
    expect(JSON.parse(body)).toEqual({
      run_id: "run_1",
      source_kind: "user",
      adapter_id: "test",
      integration_id: "test/default",
      action_id: "message.send",
      target: "channel://general",
      payload_json: { text: "hello" },
      payload_schema_version: 1,
      actor_type: "user",
    })
    expect(headers.get("x-opencode-directory")).toBe(encodeURIComponent("/tmp/proj-é"))
    expect(headers.get("authorization")).toBe("Basic token")
    expect(value.id).toBe("draft_1")
  })

  test("updateHistoryDraft patches a draft row", async () => {
    let url = ""
    let method = ""

    const value = await updateHistoryDraft({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      workspace: "wrk_1",
      draft_id: "draft_1",
      body: {
        target: "channel://alerts",
        payload_json: { text: "updated" },
        actor_type: "user",
      },
      fetch: async (next, init) => {
        url = `${next}`
        method = `${init?.method}`
        return new Response(
          JSON.stringify({
            ...draft("draft_1"),
            target: "channel://alerts",
            payload_json: { text: "updated" },
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

    expect(url).toBe("http://localhost:4096/workflow/drafts/draft_1?workspace=wrk_1")
    expect(method).toBe("PATCH")
    expect(value.target).toBe("channel://alerts")
  })

  test("approveHistoryDraft, rejectHistoryDraft, and sendHistoryDraft hit their control endpoints", async () => {
    const calls: Array<{ url: string; body: unknown }> = []

    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? `${input}` : input.url
      calls.push({
        url,
        body: init?.body ? JSON.parse(`${init.body}`) : undefined,
      })
      return new Response(JSON.stringify(draft("draft_1", "approved")), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })
    }

    await approveHistoryDraft({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      workspace: "wrk_1",
      draft_id: "draft_1",
      body: { actor_type: "user" },
      fetch: fetch as typeof globalThis.fetch,
    })

    await sendHistoryDraft({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      workspace: "wrk_1",
      draft_id: "draft_1",
      body: { actor_type: "user" },
      fetch: fetch as typeof globalThis.fetch,
    })

    await rejectHistoryDraft({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      workspace: "wrk_1",
      draft_id: "draft_1",
      body: { actor_type: "user" },
      fetch: fetch as typeof globalThis.fetch,
    })

    expect(calls).toEqual([
      {
        url: "http://localhost:4096/workflow/drafts/draft_1/approve?workspace=wrk_1",
        body: { actor_type: "user" },
      },
      {
        url: "http://localhost:4096/workflow/drafts/draft_1/send?workspace=wrk_1",
        body: { actor_type: "user" },
      },
      {
        url: "http://localhost:4096/workflow/drafts/draft_1/reject?workspace=wrk_1",
        body: { actor_type: "user" },
      },
    ])
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

  test("createHistoryDraft throws endpoint errors", async () => {
    const result = createHistoryDraft({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      body: {
        source_kind: "user",
        adapter_id: "test",
        integration_id: "test/default",
        action_id: "message.send",
        target: "channel://general",
        payload_json: { text: "hello" },
        payload_schema_version: 1,
      },
      fetch: async () =>
        new Response(JSON.stringify({ message: "send now requires an approved draft" }), {
          status: 409,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    })

    await expect(result).rejects.toThrow("send now requires an approved draft")
  })
})
