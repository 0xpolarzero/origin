import { describe, expect, test } from "bun:test"
import { loadRunDetail, loadWorkflowDetail, loadWorkflowSessionLink, type GraphStep } from "./graph-detail-data"

const detailStep = {
  id: "ask",
  kind: "agent_request",
  title: "Ask reviewer",
  prompt: {
    source: "inline",
    text: "Summarize changes",
  },
} satisfies GraphStep

describe("graph detail data", () => {
  test("loads workflow detail payloads", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []
    const data = await loadWorkflowDetail({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      workflow_id: "workflow.daily",
      auth: "Basic test",
      fetch: async (input, init) => {
        calls.push({ input, init })
        return new Response(
          JSON.stringify({
            item: {
              id: "workflow.daily",
              file: ".origin/workflows/daily.yaml",
              runnable: true,
              errors: [],
              workflow: {
                id: "workflow.daily",
                name: "Daily workflow",
                description: "Runs every morning",
                steps: [detailStep],
                resources: [{ id: "prompt.summary" }],
              },
            },
            revision_head: {
              id: "rev_1",
              workflow_id: "workflow.daily",
              content_hash: "hash_1",
              created_at: 1,
            },
            resources: [
              {
                id: "prompt.summary",
                source: "library",
                kind: "prompt_template",
                item_id: "lib.prompt.summary",
                used_by: ["ask"],
                errors: [],
              },
            ],
            runs: [
              {
                id: "run_1",
                status: "completed_no_change",
                workflow_id: "workflow.daily",
                workspace_id: "wrk_1",
                created_at: 1,
                started_at: 2,
                finished_at: 3,
                reason_code: null,
                failure_code: null,
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    expect(data.endpoint).toBe("/workflow/workflows/workflow.daily/detail")
    expect(data.item.workflow?.steps).toEqual([
      {
        id: "ask",
        kind: "agent_request",
        title: "Ask reviewer",
        prompt: {
          source: "inline",
          text: "Summarize changes",
          resource_id: undefined,
        },
        output: undefined,
        script: undefined,
        when: undefined,
        then: [],
        else: [],
        result: undefined,
      },
    ])
    expect(data.resources[0]).toEqual({
      id: "prompt.summary",
      source: "library",
      kind: "prompt_template",
      item_id: "lib.prompt.summary",
      used_by: ["ask"],
      errors: [],
    })
    expect(data.runs[0]?.id).toBe("run_1")
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.input).toBe("http://127.0.0.1:4096/workflow/workflows/workflow.daily/detail")
    const headers = new Headers(call.init?.headers)
    expect(headers.get("x-opencode-directory")).toBe("/tmp/demo")
    expect(headers.get("authorization")).toBe("Basic test")
  })

  test("loads run detail payloads with attempts and linked sessions", async () => {
    const data = await loadRunDetail({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      run_id: "run_1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            run: {
              id: "run_1",
              status: "ready_for_integration",
              workflow_id: "workflow.daily",
              workspace_id: "wrk_1",
              session_id: "sess_followup",
              reason_code: null,
              failure_code: null,
              created_at: 1,
              started_at: 2,
              finished_at: 3,
              integration_candidate: {
                changed_paths: ["src/app.tsx"],
              },
            },
            snapshot: {
              id: "snap_1",
              workflow_id: "workflow.daily",
              workflow_revision_id: "rev_1",
              workflow_hash: "hash_1",
              workflow_text: "schema_version: 2",
              graph_json: {
                id: "workflow.daily",
                name: "Daily workflow",
                description: "Runs every morning",
                steps: [
                  detailStep,
                  {
                    id: "done",
                    kind: "end",
                    title: "Done",
                    result: "success",
                  },
                ],
              },
              input_json: {
                topic: "release",
              },
              input_store_json: {
                topic: "release",
              },
              resource_materials_json: {
                "prompt.summary": "Summarize the changes",
              },
            },
            revision: {
              id: "rev_1",
              workflow_id: "workflow.daily",
              content_hash: "hash_1",
              created_at: 1,
            },
            live: {
              current_revision_id: "rev_2",
              has_newer_revision: true,
            },
            nodes: [
              {
                node: {
                  id: "row_ask",
                  node_id: "ask",
                  kind: "agent_request",
                  title: "Ask reviewer",
                  status: "completed",
                  skip_reason_code: null,
                  output_json: {
                    summary: "done",
                  },
                  error_json: null,
                  attempt_count: 1,
                },
                step: detailStep,
                attempts: [
                  {
                    attempt: {
                      id: "attempt_1",
                      attempt_index: 1,
                      status: "completed",
                      session_id: "sess_exec",
                      output_json: {
                        stdout: "ok",
                        stderr: "",
                        changed_paths: ["src/app.tsx"],
                      },
                      error_json: null,
                      started_at: 2,
                      finished_at: 3,
                    },
                    session: {
                      link: {
                        session_id: "sess_exec",
                        role: "execution_node",
                        visibility: "hidden",
                        run_id: "run_1",
                        run_node_id: "row_ask",
                        run_attempt_id: "attempt_1",
                        readonly: true,
                      },
                      session: {
                        id: "sess_exec",
                        title: "Ask execution",
                        directory: "/tmp/demo",
                      },
                    },
                  },
                ],
              },
            ],
            events: [
              {
                sequence: 1,
                event_type: "node.started",
                payload_json: {
                  node_id: "ask",
                },
                run_node_id: "row_ask",
                run_attempt_id: null,
              },
            ],
            followup: {
              link: {
                session_id: "sess_followup",
                role: "run_followup",
                visibility: "visible",
                run_id: "run_1",
                run_node_id: null,
                run_attempt_id: null,
                readonly: false,
              },
              session: {
                id: "sess_followup",
                title: "Run follow-up",
                directory: "/tmp/demo",
              },
            },
          }),
          { status: 200 },
        ),
    })

    expect(data.endpoint).toBe("/workflow/runs/run_1/detail")
    expect(data.run.integration_candidate?.changed_paths).toEqual(["src/app.tsx"])
    expect(data.snapshot.graph_json.steps.map((item) => item.id)).toEqual(["ask", "done"])
    expect(data.nodes[0]?.attempts[0]?.session?.link.role).toBe("execution_node")
    expect(data.followup?.session?.id).toBe("sess_followup")
    expect(data.events[0]?.event_type).toBe("node.started")
  })

  test("loads session link payloads", async () => {
    const data = await loadWorkflowSessionLink({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      session_id: "sess_exec",
      fetch: async () =>
        new Response(
          JSON.stringify({
            session_id: "sess_exec",
            role: "execution_node",
            visibility: "hidden",
            run_id: "run_1",
            run_node_id: "row_ask",
            run_attempt_id: "attempt_1",
            readonly: true,
          }),
          { status: 200 },
        ),
    })

    expect(data).toEqual({
      session_id: "sess_exec",
      role: "execution_node",
      visibility: "hidden",
      run_id: "run_1",
      run_node_id: "row_ask",
      run_attempt_id: "attempt_1",
      readonly: true,
    })
  })

  test("encodes non-ASCII directories for session-link requests", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []

    await loadWorkflowSessionLink({
      baseUrl: "http://127.0.0.1:4096/",
      directory: "/tmp/démo",
      session_id: "sess_exec",
      fetch: async (input, init) => {
        calls.push({ input, init })
        return new Response(
          JSON.stringify({
            session_id: "sess_exec",
            role: "execution_node",
            visibility: "hidden",
            run_id: "run_1",
            run_node_id: "row_ask",
            run_attempt_id: "attempt_1",
            readonly: true,
          }),
          { status: 200 },
        )
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toBe("http://127.0.0.1:4096/workflow/session-link/sess_exec")
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get("x-opencode-directory")).toBe(encodeURIComponent("/tmp/démo"))
  })

  test("encodes non-ASCII directories and surfaces backend error messages", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []

    await expect(
      loadWorkflowDetail({
        baseUrl: "http://127.0.0.1:4096/",
        directory: "/tmp/démo",
        workflow_id: "missing",
        fetch: async (input, init) => {
          calls.push({ input, init })
          return new Response(JSON.stringify({ message: "Workflow not found: missing" }), {
            status: 404,
          })
        },
      }),
    ).rejects.toThrow("Workflow not found: missing")

    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get("x-opencode-directory")).toBe(encodeURIComponent("/tmp/démo"))
  })

  test("falls back to raw backend error text for non-JSON error bodies", async () => {
    await expect(
      loadRunDetail({
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/demo",
        run_id: "run_1",
        fetch: async () => new Response("not allowed", { status: 403 }),
      }),
    ).rejects.toThrow("not allowed")
  })

  test("falls back to raw JSON text when backend errors omit a message field", async () => {
    await expect(
      loadRunDetail({
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/demo",
        run_id: "run_1",
        fetch: async () => new Response(JSON.stringify({ error: "denied" }), { status: 403 }),
      }),
    ).rejects.toThrow('{"error":"denied"}')
  })

  test("falls back to the status code when backend errors return an empty body", async () => {
    await expect(
      loadWorkflowSessionLink({
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/demo",
        session_id: "sess_exec",
        fetch: async () => new Response("   ", { status: 503 }),
      }),
    ).rejects.toThrow("Request failed with status 503")
  })

  test("rejects empty and invalid JSON responses deterministically", async () => {
    await expect(
      loadWorkflowDetail({
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/demo",
        workflow_id: "workflow.daily",
        fetch: async () => new Response("   ", { status: 200 }),
      }),
    ).rejects.toThrow("Graph detail endpoint returned an empty response.")

    await expect(
      loadRunDetail({
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/demo",
        run_id: "run_1",
        fetch: async () => new Response("{", { status: 200 }),
      }),
    ).rejects.toThrow("Graph detail endpoint returned invalid JSON.")
  })

  test("rejects malformed workflow and run detail payloads", async () => {
    await expect(
      loadWorkflowDetail({
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/demo",
        workflow_id: "workflow.daily",
        fetch: async () =>
          new Response(
            JSON.stringify({
              item: {
                runnable: true,
              },
            }),
            { status: 200 },
          ),
      }),
    ).rejects.toThrow("Workflow detail payload is invalid.")

    await expect(
      loadRunDetail({
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/demo",
        run_id: "run_1",
        fetch: async () =>
          new Response(
            JSON.stringify({
              run: {
                id: "run_1",
              },
              snapshot: {
                id: "snap_1",
                workflow_id: "workflow.daily",
                workflow_revision_id: "rev_1",
                workflow_hash: "hash_1",
                workflow_text: "schema_version: 2",
              },
              revision: {
                id: "rev_1",
                workflow_id: "workflow.daily",
                content_hash: "hash_1",
                created_at: 1,
              },
              live: {
                current_revision_id: null,
                has_newer_revision: false,
              },
            }),
            { status: 200 },
          ),
      }),
    ).rejects.toThrow("Run detail payload is invalid.")
  })

  test("returns null for malformed session-link payloads", async () => {
    const data = await loadWorkflowSessionLink({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      session_id: "sess_exec",
      fetch: async () =>
        new Response(
          JSON.stringify({
            session_id: "sess_exec",
            role: "other",
          }),
          { status: 200 },
        ),
    })

    expect(data).toBeNull()
  })
})
