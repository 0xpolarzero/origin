import { describe, expect, test } from "bun:test"
import {
  approveHistoryDraft,
  createDebugReport,
  createHistoryDraft,
  loadDebugReminders,
  loadDebugReportPreview,
  loadHistoryOperations,
  loadHistoryDraft,
  loadHistoryDrafts,
  loadHistoryRuns,
  normalizeDebugReportCreate,
  normalizeDebugReportPreview,
  normalizeDraftDetail,
  normalizeDraftPage,
  normalizeOperationPage,
  normalizeReminderPage,
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
  debug: false,
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

const systemReportDraft = (id: string, status = "approved"): HistoryDraft => ({
  ...draft(id, status),
  source_kind: "system_report",
  adapter_id: "system",
  integration_id: "system/default",
  action_id: "report.dispatch",
  target: "system://developers",
  payload_json: {
    metadata: {
      run_id: "run_1",
    },
  },
  preview_text: "System report system://developers",
})

const reminder = (run_id: string) => ({
  run_id,
  session_id: "session_1",
  workspace_id: "wrk_1",
  workflow_id: "workflow.daily",
  status: "integrating",
  trigger_type: "debug",
  started_at: 10,
  threshold_ms: 900_000,
  cadence_ms: 600_000,
  hard_stop_ms: 2_700_000,
  threshold_at: 900_010,
  hard_stop_at: 2_700_010,
  next_notification_at: 900_010,
  last_notification_at: null,
  last_keep_running_at: null,
  elapsed_ms: 3_000,
  remaining_ms: 2_697_010,
  notify: true,
})

const reportPreview = (run_id: string) => ({
  run_id,
  session_id: "session_1",
  workspace_id: "wrk_1",
  workflow_id: "workflow.daily",
  status: "integrating",
  trigger_type: "debug",
  target: "system://developers",
  targets: ["system://developers"],
  fields: [
    {
      id: "metadata",
      title: "Metadata",
      required: true,
      selected: true,
      preview: "metadata preview",
    },
    {
      id: "prompt",
      title: "Prompt",
      required: false,
      selected: false,
      preview: "prompt preview",
    },
  ],
})

describe("history-data", () => {
  test("normalizeRunPage keeps debug flags and hidden counts while removing malformed rows", () => {
    const value = normalizeRunPage({
      items: [{ ...run("run_1"), debug: true }, { id: "broken" }],
      next_cursor: "10:run_1",
      hidden_debug_count: 2,
    })

    expect(value.items.map((item) => item.id)).toEqual(["run_1"])
    expect(value.items[0]?.debug).toBe(true)
    expect(value.items[0]?.trigger_metadata).toEqual({
      source: "cron",
      slot_local: "2026-03-08T02:30[America/New_York]",
    })
    expect(value.next_cursor).toBe("10:run_1")
    expect(value.hidden_debug_count).toBe(2)
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

  test("normalizeDraftPage accepts system report drafts", () => {
    const value = normalizeDraftPage({
      items: [systemReportDraft("draft_1"), { ...draft("draft_2"), source_kind: "invalid" }],
      next_cursor: null,
    })

    expect(value.items).toHaveLength(1)
    expect(value.items[0]?.source_kind).toBe("system_report")
    expect(value.items[0]?.action_id).toBe("report.dispatch")
  })

  test("normalizeReminderPage keeps valid reminders and filters malformed rows", () => {
    const value = normalizeReminderPage({
      generated_at: 20,
      items: [reminder("run_1"), { run_id: "broken" }],
    })

    expect(value.generated_at).toBe(20)
    expect(value.items.map((item) => item.run_id)).toEqual(["run_1"])
    expect(value.items[0]?.notify).toBe(true)
  })

  test("normalizeDebugReportPreview filters malformed fields", () => {
    const value = normalizeDebugReportPreview({
      ...reportPreview("run_1"),
      fields: [
        ...reportPreview("run_1").fields,
        {
          id: "invalid",
          title: "Invalid",
          required: false,
          selected: false,
          preview: "skip me",
        },
      ],
    })

    expect(value?.run_id).toBe("run_1")
    expect(value?.fields.map((item) => item.id)).toEqual(["metadata", "prompt"])
    expect(value?.fields.find((item) => item.id === "metadata")?.required).toBe(true)
  })

  test("normalizeDebugReportCreate accepts system report drafts", () => {
    const value = normalizeDebugReportCreate({
      run_status: "cancel_requested",
      draft: systemReportDraft("draft_1"),
    })

    expect(value?.run_status).toBe("cancel_requested")
    expect(value?.draft.source_kind).toBe("system_report")
    expect(value?.draft.adapter_id).toBe("system")
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

  test("loadDebugReminders sends directory/auth headers and parses items", async () => {
    let seen = ""
    let headers = new Headers()

    const page = await loadDebugReminders({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/proj-é",
      auth: "Basic token",
      fetch: async (url, init) => {
        seen = `${url}`
        headers = new Headers(init?.headers)
        return new Response(
          JSON.stringify({
            generated_at: 20,
            items: [reminder("run_1")],
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

    expect(seen).toBe("http://localhost:4096/workflow/debug/reminders")
    expect(headers.get("x-opencode-directory")).toBe(encodeURIComponent("/tmp/proj-é"))
    expect(headers.get("authorization")).toBe("Basic token")
    expect(page.generated_at).toBe(20)
    expect(page.items.map((item) => item.run_id)).toEqual(["run_1"])
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

  test("loadDebugReportPreview reads the report preview endpoint", async () => {
    let seen = ""

    const value = await loadDebugReportPreview({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      workspace: "wrk_1",
      run_id: "run_1",
      fetch: async (url) => {
        seen = `${url}`
        return new Response(JSON.stringify(reportPreview("run_1")), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        })
      },
    })

    expect(seen).toBe("http://localhost:4096/workflow/debug/run/run_1/report-preview?workspace=wrk_1")
    expect(value.target).toBe("system://developers")
    expect(value.fields.map((item) => item.id)).toEqual(["metadata", "prompt"])
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

  test("createDebugReport posts consent flags and parses the system report draft", async () => {
    let url = ""
    let method = ""
    let body = ""
    let headers = new Headers()

    const value = await createDebugReport({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/proj-é",
      auth: "Basic token",
      workspace: "wrk_1",
      run_id: "run_1",
      body: {
        consent: true,
        target: "system://developers",
        include_prompt: true,
        include_files: true,
      },
      fetch: async (next, init) => {
        url = `${next}`
        method = `${init?.method}`
        body = `${init?.body ?? ""}`
        headers = new Headers(init?.headers)
        return new Response(
          JSON.stringify({
            run_status: "cancel_requested",
            draft: systemReportDraft("draft_1"),
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

    expect(url).toBe("http://localhost:4096/workflow/debug/run/run_1/report?workspace=wrk_1")
    expect(method).toBe("POST")
    expect(JSON.parse(body)).toEqual({
      consent: true,
      target: "system://developers",
      include_prompt: true,
      include_files: true,
    })
    expect(headers.get("x-opencode-directory")).toBe(encodeURIComponent("/tmp/proj-é"))
    expect(headers.get("authorization")).toBe("Basic token")
    expect(value.run_status).toBe("cancel_requested")
    expect(value.draft.source_kind).toBe("system_report")
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
