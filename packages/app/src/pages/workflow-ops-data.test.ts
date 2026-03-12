import { describe, expect, test } from "bun:test"
import {
  copyWorkflow,
  hideWorkflow,
  rerunWorkflowRun,
  startWorkflowRun,
  validateWorkflowRun,
} from "./graph-detail-data"

describe("workflow operation data", () => {
  test("copy and hide workflow endpoints parse payloads", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []

    const copied = await copyWorkflow({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      workflow_id: "workflow.daily",
      fetch: async (input, init) => {
        calls.push({ input, init })
        return new Response(
          JSON.stringify({
            workflow_id: "workflow.daily-copy",
            file: ".origin/workflows/workflow.daily-copy.yaml",
          }),
          { status: 200 },
        )
      },
    })

    const hidden = await hideWorkflow({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      workflow_id: "workflow.daily",
      fetch: async (input, init) => {
        calls.push({ input, init })
        return new Response(
          JSON.stringify({
            workflow_id: "workflow.daily",
            hidden: true,
            file: ".origin/workflows/workflow.daily.yaml",
            target: ".origin/workflows/.hidden/workflow.daily.yaml",
          }),
          { status: 200 },
        )
      },
    })

    expect(copied.workflow_id).toBe("workflow.daily-copy")
    expect(hidden.hidden).toBe(true)
    expect(calls[0]?.input).toBe("http://127.0.0.1:4096/workflow/workflows/workflow.daily/copy")
    expect(calls[1]?.input).toBe("http://127.0.0.1:4096/workflow/workflows/workflow.daily/hide")
  })

  test("validate, start, and rerun resolve a workspace and hit workflow endpoints", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []

    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init })
      const url = typeof input === "string" ? input : input.toString()
      if (url.endsWith("/experimental/workspace?directory=%2Ftmp%2Fdemo")) {
        return new Response(
          JSON.stringify([
            {
              id: "wrk_1",
              directory: "/tmp/demo",
            },
          ]),
          { status: 200 },
        )
      }
      if (url.includes("/workflow/run/validate?workspace=wrk_1")) {
        return new Response(
          JSON.stringify({
            ok: true,
            workflow_id: "workflow.daily",
          }),
          { status: 200 },
        )
      }
      if (url.includes("/workflow/run/start?workspace=wrk_1")) {
        return new Response(
          JSON.stringify({
            id: "run_started",
            status: "queued",
            trigger_type: "manual",
            workflow_id: "workflow.daily",
            workspace_id: "wrk_1",
            session_id: null,
            reason_code: null,
            failure_code: null,
            created_at: 1,
            updated_at: 1,
            started_at: null,
            finished_at: null,
          }),
          { status: 200 },
        )
      }
      if (url.includes("/workflow/runs/run_started/rerun?workspace=wrk_1")) {
        return new Response(
          JSON.stringify({
            id: "run_rerun",
            status: "queued",
            trigger_type: "manual",
            workflow_id: "workflow.daily",
            workspace_id: "wrk_1",
            session_id: null,
            reason_code: null,
            failure_code: null,
            created_at: 2,
            updated_at: 2,
            started_at: null,
            finished_at: null,
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected request: ${url}`)
    }

    const validated = await validateWorkflowRun({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      workflow_id: "workflow.daily",
      fetch: fetcher,
    })
    const started = await startWorkflowRun({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      workflow_id: "workflow.daily",
      inputs: {
        topic: "release",
      },
      fetch: fetcher,
    })
    const rerun = await rerunWorkflowRun({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      run_id: started.id,
      fetch: fetcher,
    })

    expect(validated.workspace_id).toBe("wrk_1")
    expect(started.id).toBe("run_started")
    expect(rerun.id).toBe("run_rerun")
    expect(calls.map((item) => item.input)).toEqual([
      "http://127.0.0.1:4096/experimental/workspace?directory=%2Ftmp%2Fdemo",
      "http://127.0.0.1:4096/workflow/run/validate?workspace=wrk_1",
      "http://127.0.0.1:4096/experimental/workspace?directory=%2Ftmp%2Fdemo",
      "http://127.0.0.1:4096/workflow/run/start?workspace=wrk_1",
      "http://127.0.0.1:4096/experimental/workspace?directory=%2Ftmp%2Fdemo",
      "http://127.0.0.1:4096/workflow/runs/run_started/rerun?workspace=wrk_1",
    ])
  })

  test("start creates an attached workspace when the directory is not registered yet", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []

    const started = await startWorkflowRun({
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      workflow_id: "workflow.daily",
      inputs: {
        topic: "release",
      },
      fetch: async (input, init) => {
        calls.push({ input, init })
        const url = typeof input === "string" ? input : input.toString()
        if (url.endsWith("/experimental/workspace?directory=%2Ftmp%2Fdemo")) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        if (url.includes("/experimental/workspace/wrk_")) {
          return new Response(
            JSON.stringify({
              id: "wrk_created",
              type: "worktree",
              branch: "main",
              name: "demo",
              directory: "/tmp/demo",
              extra: {
                local: true,
              },
            }),
            { status: 200 },
          )
        }
        if (url.includes("/workflow/run/start?workspace=wrk_created")) {
          return new Response(
            JSON.stringify({
              id: "run_started",
              status: "queued",
              trigger_type: "manual",
              workflow_id: "workflow.daily",
              workspace_id: "wrk_created",
              session_id: null,
              reason_code: null,
              failure_code: null,
              created_at: 1,
              updated_at: 1,
              started_at: null,
              finished_at: null,
            }),
            { status: 200 },
          )
        }
        throw new Error(`unexpected request: ${url}`)
      },
    })

    expect(started.workspace_id).toBe("wrk_created")
    expect(calls[0]?.input).toBe("http://127.0.0.1:4096/experimental/workspace?directory=%2Ftmp%2Fdemo")
    expect(String(calls[1]?.input)).toContain("/experimental/workspace/wrk_")
    expect(calls[2]?.input).toBe("http://127.0.0.1:4096/workflow/run/start?workspace=wrk_created")
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      branch: null,
      config: {
        type: "worktree",
        directory: "/tmp/demo",
      },
    })
  })
})
