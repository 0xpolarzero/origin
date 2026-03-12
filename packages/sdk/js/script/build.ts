#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

const workflowStepRef = "#/components/schemas/WorkflowStepView"

const collectWorkflowStepAliases = (value: unknown): Set<string> => {
  const aliases = new Set<string>()
  if (Array.isArray(value)) {
    value.forEach((item) => collectWorkflowStepAliases(item).forEach((alias) => aliases.add(alias)))
    return aliases
  }
  if (!value || typeof value !== "object") return aliases

  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (/^__schema\d+$/.test(key) && item && typeof item === "object") {
      if ((item as { $ref?: unknown }).$ref === workflowStepRef) {
        aliases.add(key)
      }
    }
    collectWorkflowStepAliases(item).forEach((alias) => aliases.add(alias))
  })

  return aliases
}

const normalizeWorkflowStepRefs = (value: unknown, aliases: Set<string>): unknown => {
  if (Array.isArray(value)) return value.map((item) => normalizeWorkflowStepRefs(item, aliases))
  if (!value || typeof value !== "object") return value

  const current = value as Record<string, unknown>
  const ref = typeof current.$ref === "string" ? current.$ref : undefined
  if (ref) {
    const alias = ref.match(/^#\/components\/schemas\/(__schema\d+)$/)?.[1]
    if (alias && aliases.has(alias)) {
      return {
        $ref: workflowStepRef,
      }
    }
  }

  return Object.fromEntries(
    Object.entries(current).flatMap(([key, item]) => {
      if (aliases.has(key)) return []
      return [[key, normalizeWorkflowStepRefs(item, aliases)]]
    }),
  )
}

const escape = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1")

const normalizeSchemaRefs = (value: unknown, path: string[] = [], defs = new Map<string, string>()): unknown => {
  if (Array.isArray(value)) return value.map((item, index) => normalizeSchemaRefs(item, [...path, `${index}`], defs))
  if (!value || typeof value !== "object") return value

  const current = value as Record<string, unknown>
  const next = new Map(defs)
  const local = current.$defs
  if (local && typeof local === "object" && !Array.isArray(local)) {
    Object.keys(local).forEach((key) => {
      if (!/^__schema\d+$/.test(key)) return
      next.set(key, `#/${[...path, "$defs", key].map(escape).join("/")}`)
    })
  }

  const ref = typeof current.$ref === "string" ? current.$ref : undefined
  const alias = ref?.match(/^#\/components\/schemas\/(__schema\d+)$/)?.[1]
  if (alias && next.has(alias)) {
    return {
      ...current,
      $ref: next.get(alias)!,
    }
  }

  return Object.fromEntries(Object.entries(current).map(([key, item]) => [key, normalizeSchemaRefs(item, [...path, key], next)]))
}

const openapi = (await Bun.file("./openapi.json").json()) as {
  components?: {
    schemas?: Record<string, unknown>
  }
}
const normalized = normalizeSchemaRefs(
  normalizeWorkflowStepRefs(openapi, collectWorkflowStepAliases(openapi)),
) as typeof openapi

await Bun.write("./openapi.json", JSON.stringify(normalized, null, 2) + "\n")

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
      operations: {
        strategy: "single",
        containerName: "OpencodeClient",
        methods: "instance",
      },
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

const tightenRunMethods = async (file: string) => {
  const source = await Bun.file(file).text()
  const validate = source.replace(
    /public validate<ThrowOnError extends boolean = false>\(parameters\?: \{\s+directory\?: string;\s+workspace\?: string;\s+workflow_id\?: string;\s+\}, options\?: Options<never, ThrowOnError>\)/m,
    `public validate<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        workflow_id: string;
    }, options?: Options<never, ThrowOnError>)`,
  )
  if (validate === source) {
    throw new Error(`SDK validate postprocess anchor not found in ${file}`)
  }

  const next = validate.replace(
    /public start<ThrowOnError extends boolean = false>\(parameters\?: \{\s+directory\?: string;\s+workspace\?: string;\s+workflow_id\?: string;\s+trigger_id\?: string;\s+inputs\?: \{\s+\[key: string\]: unknown;\s+\};\s+\}, options\?: Options<never, ThrowOnError>\)/m,
    `public start<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        workflow_id: string;
        trigger_id?: string;
        inputs?: {
            [key: string]: unknown;
        };
    }, options?: Options<never, ThrowOnError>)`,
  )
  if (next === validate) {
    throw new Error(`SDK start postprocess anchor not found in ${file}`)
  }

  await Bun.write(file, next)
}

await tightenRunMethods("./src/v2/gen/sdk.gen.ts")

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
