import { describe, expect, test } from "bun:test"
import { loadValidationList, normalizeValidationList } from "./workflow-validation"

describe("normalizeValidationList", () => {
  test("normalizes workflow payload with deterministic ordering", () => {
    const result = normalizeValidationList("workflow", {
      data: [
        {
          id: "wf-b",
          name: "b",
          path: ".origin/workflows/b.yaml",
          runnable: true,
          errors: [],
        },
        {
          id: "wf-a",
          name: "a",
          path: ".origin/workflows/a.yaml",
          runnable: false,
          errors: [
            {
              code: "workflow.missing_ref",
              path: "steps[0].uses",
              message: "Missing library reference",
            },
          ],
        },
      ],
    })

    expect(result.map((item) => item.id)).toEqual(["wf-a", "wf-b"])
    expect(result[0]?.runnable).toBe(false)
    expect(result[0]?.errors[0]).toEqual({
      code: "workflow.missing_ref",
      path: "steps[0].uses",
      message: "Missing library reference",
    })
  })

  test("derives runnable state from nested validation errors", () => {
    const result = normalizeValidationList("library", {
      items: [
        {
          id: "lib-query",
          kind: "query",
          file: ".origin/library/query.yaml",
          validation: {
            errors: [
              {
                code: "library.kind_invalid",
                path: "kind",
                message: "Unsupported kind",
              },
            ],
          },
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.runnable).toBe(false)
    expect(result[0]?.path).toBe(".origin/library/query.yaml")
    expect(result[0]?.errors[0]?.code).toBe("library.kind_invalid")
  })
})

describe("loadValidationList", () => {
  test("falls back to next endpoint when the first one is missing", async () => {
    const calls: string[] = []
    const fakeFetchBase = (input: URL | RequestInfo | string) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url.endsWith("/workflow")) {
        return Promise.resolve(new Response("not found", { status: 404 }))
      }

      if (url.endsWith("/workflow/validation")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "wf-invalid",
                  path: ".origin/workflows/bad.yaml",
                  runnable: false,
                  errors: [
                    {
                      code: "workflow.invalid",
                      path: "steps[0]",
                      message: "Invalid step definition",
                    },
                  ],
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        )
      }

      return Promise.resolve(new Response("unexpected", { status: 500 }))
    }
    const fakeFetch = Object.assign(fakeFetchBase, { preconnect: fetch.preconnect }) as typeof fetch

    const result = await loadValidationList({
      view: "workflow",
      baseUrl: "http://127.0.0.1:4096",
      directory: "/tmp/demo",
      fetch: fakeFetch,
    })

    expect(result.endpoint).toBe("/workflow/validation")
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.runnable).toBe(false)
    expect(calls.some((url) => url.endsWith("/workflow"))).toBe(true)
    expect(calls.some((url) => url.endsWith("/workflow/validation"))).toBe(true)
  })
})
