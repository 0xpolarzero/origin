#!/usr/bin/env bun

import path from "node:path"
import { parseArgs } from "node:util"

const rec = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const str = (value: unknown) => (typeof value === "string" ? value : null)
const num = (value: unknown) => (typeof value === "number" ? value : null)
const arr = (value: unknown) => (Array.isArray(value) ? value : [])

const parse = (value: string | null) => {
  if (!value) return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const fence = (value: string, lang = "") => {
  const size = Array.from(value.matchAll(/`+/g)).reduce((max, match) => Math.max(max, match[0].length), 0)
  const ticks = "`".repeat(Math.max(3, size + 1))
  const head = lang ? `${ticks}${lang}` : ticks
  return `${head}\n${value.trimEnd()}\n${ticks}`
}

const details = (summary: string, body: string) => `<details>
<summary>${esc(summary)}</summary>

${body.trim()}

</details>`

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

const text = (items: unknown[]) =>
  items
    .map((item) => {
      if (!rec(item)) return null
      return str(item.text)
    })
    .filter((value): value is string => Boolean(value))
    .join("\n\n")
    .trim()

const stamp = (value: unknown) => str(value) ?? "unknown"

const label = (value: string) =>
  value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")

const exec = (value: string) => {
  const chunk = value.match(/Chunk ID: ([^\n]+)/)?.[1] ?? null
  const wall = value.match(/Wall time: ([^\n]+)/)?.[1] ?? null
  const code = value.match(/Process exited with code ([^\n]+)/)?.[1] ?? null
  const tokens = value.match(/Original token count: ([^\n]+)/)?.[1] ?? null
  const body = value.split("\nOutput:\n").slice(1).join("\nOutput:\n")
  return {
    chunk,
    wall,
    code,
    tokens,
    body: body.trim(),
  }
}

const lines = (items: Array<string | null>) => items.filter((item): item is string => Boolean(item)).join("\n")

const summary = (value: Record<string, unknown>) => {
  const parts = [
    str(value.agent_id) ? `agent \`${str(value.agent_id)}\`` : null,
    str(value.nickname) ? `nickname \`${str(value.nickname)}\`` : null,
    str(value.submission_id) ? `submission \`${str(value.submission_id)}\`` : null,
    typeof value.timed_out === "boolean" ? `timed out: \`${value.timed_out}\`` : null,
  ]

  const status = rec(value.status) ? value.status : null
  if (status && str(status.completed)) parts.push("status: `completed`")

  return parts.filter((item): item is string => Boolean(item))
}

const tokenSummary = (items: Record<string, unknown>[]) => {
  if (!items.length) return ""

  const info =
    items
      .toReversed()
      .map((item) => (rec(item.info) ? item.info : null))
      .find((item) => item !== null) ?? null
  const rate = rec(items.at(-1)?.rate_limits) ? (items.at(-1)?.rate_limits as Record<string, unknown>) : null

  const last = info && rec(info.last_token_usage) ? info.last_token_usage : null
  const total = info && rec(info.total_token_usage) ? info.total_token_usage : null
  const primary = rate && rec(rate.primary) ? rate.primary : null
  const secondary = rate && rec(rate.secondary) ? rate.secondary : null

  return lines([
    "### Token Summary",
    "",
    `- Snapshots: \`${items.length}\``,
    last
      ? `- Last usage: input \`${num(last.input_tokens) ?? "?"}\`, cached \`${num(last.cached_input_tokens) ?? "?"}\`, output \`${num(last.output_tokens) ?? "?"}\`, reasoning \`${num(last.reasoning_output_tokens) ?? "?"}\`, total \`${num(last.total_tokens) ?? "?"}\``
      : null,
    total
      ? `- Session total so far: input \`${num(total.input_tokens) ?? "?"}\`, cached \`${num(total.cached_input_tokens) ?? "?"}\`, output \`${num(total.output_tokens) ?? "?"}\`, reasoning \`${num(total.reasoning_output_tokens) ?? "?"}\`, total \`${num(total.total_tokens) ?? "?"}\``
      : null,
    info && num(info.model_context_window) !== null
      ? `- Model context window: \`${num(info.model_context_window)}\``
      : null,
    primary && num(primary.used_percent) !== null
      ? `- Primary rate window: \`${num(primary.used_percent)}%\` used, resets at \`${num(primary.resets_at) ?? "?"}\``
      : null,
    secondary && num(secondary.used_percent) !== null
      ? `- Secondary rate window: \`${num(secondary.used_percent)}%\` used, resets at \`${num(secondary.resets_at) ?? "?"}\``
      : null,
    "",
  ])
}

const renderHistory = (item: Record<string, unknown>, index: number) => {
  const kind = str(item.type) ?? "unknown"
  if (kind === "message") {
    const role = str(item.role) ?? "unknown"
    const body = text(arr(item.content))
    if (role === "developer") {
      return lines([
        `### Compacted ${label(role)} ${index}`,
        "",
        details("View message", fence(body || "(empty)", "md")),
        "",
      ])
    }

    return lines([`### Compacted ${label(role)} ${index}`, "", body || "_Empty message_", ""])
  }

  if (kind === "compaction") {
    return lines([
      `### Compaction Marker ${index}`,
      "",
      "- Earlier content was compacted in-place.",
      "- The raw replacement payload is encrypted in the source log and omitted from this Markdown rendering.",
      "",
    ])
  }

  return lines([`### Compacted ${label(kind)} ${index}`, "", fence(pretty(item), "json"), ""])
}

const argsBlock = (value: unknown) => details("Arguments", fence(pretty(value), "json"))

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    output: {
      type: "string",
      short: "o",
    },
  },
})

const input = positionals[0] ?? "docs/sessions/design.session.jsonl"
const output = values.output ?? input.replace(/\.jsonl$/u, ".md")
const source = await Bun.file(input).text()

if (!source.trim()) throw new Error(`Input file is empty: ${input}`)

const rows = source
  .trim()
  .split("\n")
  .map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${error}`)
    }
  })

const stats = {
  rows: rows.length,
  turns: rows.filter((row) => row.type === "event_msg" && row.payload?.type === "task_started").length,
  compactions: rows.filter((row) => row.type === "compacted").length,
  response_items: rows.filter((row) => row.type === "response_item").length,
  event_msgs: rows.filter((row) => row.type === "event_msg").length,
  tools: rows.filter(
    (row) =>
      row.type === "response_item" &&
      ["function_call", "custom_tool_call", "web_search_call"].includes(row.payload?.type),
  ).length,
}

const meta = rows.find((row) => row.type === "session_meta")
const dev = rows.filter(
  (row) => row.type === "response_item" && row.payload?.type === "message" && row.payload?.role === "developer",
)

const out = [
  "# Design Session",
  "",
  `- Source: \`${path.resolve(input)}\``,
  `- Generated from: \`${path.basename(input)}\``,
  `- Generated at: \`${new Date().toISOString()}\``,
  "",
  "> This rendering uses the event stream as the primary transcript. Duplicate user/assistant `response_item` chat bodies are omitted, while developer prompts, tool calls, tool outputs, compactions, and web search traces are preserved.",
  "",
  "## Overview",
  "",
  "| Metric | Value |",
  "| --- | --- |",
  `| Rows | ${stats.rows} |`,
  `| Turns | ${stats.turns} |`,
  `| Event messages | ${stats.event_msgs} |`,
  `| Response items | ${stats.response_items} |`,
  `| Tool calls | ${stats.tools} |`,
  `| Compactions | ${stats.compactions} |`,
  "",
]

if (meta && rec(meta.payload)) {
  const git = rec(meta.payload.git) ? meta.payload.git : null
  const base = rec(meta.payload.base_instructions) ? meta.payload.base_instructions : null

  out.push(
    "## Session Meta",
    "",
    lines([
      `- Session ID: \`${str(meta.payload.id) ?? "unknown"}\``,
      `- Started: \`${stamp(meta.payload.timestamp)}\``,
      `- CWD: \`${str(meta.payload.cwd) ?? "unknown"}\``,
      `- Originator: \`${str(meta.payload.originator) ?? "unknown"}\``,
      `- CLI version: \`${str(meta.payload.cli_version) ?? "unknown"}\``,
      `- Source: \`${str(meta.payload.source) ?? "unknown"}\``,
      `- Model provider: \`${str(meta.payload.model_provider) ?? "unknown"}\``,
      git ? `- Git branch: \`${str(git.branch) ?? "unknown"}\` at \`${str(git.commit_hash) ?? "unknown"}\`` : null,
    ]),
    "",
  )

  if (base && str(base.text)) {
    out.push(details("Base instructions", fence(str(base.text) ?? "", "md")), "")
  }
}

if (dev.length) {
  out.push("## Developer Prompts", "")

  dev.forEach((row, index) => {
    const body = text(arr(row.payload.content))
    out.push(`### Developer Message ${index + 1}`, "")
    out.push(`- Timestamp: \`${stamp(row.timestamp)}\``, "")
    out.push(details("View message", fence(body || "(empty)", "md")), "")
  })
}

const calls = new Map<string, { name: string; type: string }>()
let turn = 0
let current: {
  id: string
  tokens: Record<string, unknown>[]
  last: string | null
} | null = null

for (const row of rows) {
  if (row.type === "session_meta") continue

  if (row.type === "compacted" && rec(row.payload)) {
    const history = arr(row.payload.replacement_history).filter(rec)
    const counts = history.reduce<Record<string, number>>((acc, item) => {
      const key = str(item.type) ?? "unknown"
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})

    out.push(`## Context Compaction ${stamp(row.timestamp)}`, "")
    out.push(
      lines([
        `- Replacement items: \`${history.length}\``,
        `- Messages: \`${counts.message ?? 0}\``,
        `- Compaction markers: \`${counts.compaction ?? 0}\``,
      ]),
      "",
    )

    const body = history.map((item, index) => renderHistory(item, index + 1)).join("\n")
    out.push(details("Expanded replacement history", body || "_No replacement history_"), "")
    continue
  }

  if (row.type === "turn_context" && rec(row.payload)) {
    out.push("### Turn Context", "")
    out.push(
      details(
        "View context",
        lines([
          `- Turn ID: \`${str(row.payload.turn_id) ?? "unknown"}\``,
          `- Model: \`${str(row.payload.model) ?? "unknown"}\``,
          `- Personality: \`${str(row.payload.personality) ?? "unknown"}\``,
          `- Effort: \`${str(row.payload.effort) ?? "unknown"}\``,
          `- Summary mode: \`${str(row.payload.summary) ?? "unknown"}\``,
          `- CWD: \`${str(row.payload.cwd) ?? "unknown"}\``,
          `- Date: \`${str(row.payload.current_date) ?? "unknown"}\``,
          `- Timezone: \`${str(row.payload.timezone) ?? "unknown"}\``,
          `- Approval policy: \`${str(row.payload.approval_policy) ?? "unknown"}\``,
          `- Sandbox policy: \`${str(rec(row.payload.sandbox_policy) ? row.payload.sandbox_policy.type : row.payload.sandbox_policy) ?? "unknown"}\``,
          `- Collaboration mode: \`${str(rec(row.payload.collaboration_mode) ? row.payload.collaboration_mode.mode : row.payload.collaboration_mode) ?? "unknown"}\``,
        ]),
      ),
      "",
    )
    continue
  }

  if (row.type === "event_msg" && rec(row.payload)) {
    const kind = str(row.payload.type) ?? "unknown"

    if (kind === "task_started") {
      turn += 1
      current = {
        id: str(row.payload.turn_id) ?? `turn-${turn}`,
        tokens: [],
        last: null,
      }

      out.push(`## Turn ${String(turn).padStart(2, "0")}`, "")
      out.push(
        lines([
          `- Started: \`${stamp(row.timestamp)}\``,
          `- Turn ID: \`${current.id}\``,
          `- Context window: \`${num(row.payload.model_context_window) ?? "unknown"}\``,
          `- Collaboration mode: \`${str(row.payload.collaboration_mode_kind) ?? "unknown"}\``,
        ]),
        "",
      )
      continue
    }

    if (kind === "user_message") {
      out.push("### User", "")
      out.push(str(row.payload.message) || "_Empty message_", "")
      continue
    }

    if (kind === "agent_reasoning") {
      out.push("### Reasoning", "")
      out.push(str(row.payload.text) || "_No reasoning text_", "")
      continue
    }

    if (kind === "agent_message") {
      current = current
        ? {
            ...current,
            last: str(row.payload.message),
          }
        : current

      out.push(`### Assistant${str(row.payload.phase) ? ` (${str(row.payload.phase)})` : ""}`, "")
      out.push(str(row.payload.message) || "_Empty message_", "")
      continue
    }

    if (kind === "token_count") {
      if (current) current.tokens.push(row.payload)
      continue
    }

    if (kind === "context_compacted") {
      out.push("### Context Compacted", "", "- The active working context was compacted after this point.", "")
      continue
    }

    if (kind === "task_complete") {
      out.push("### Turn Complete", "")
      out.push(`- Completed at: \`${stamp(row.timestamp)}\``, "")

      const last = str(row.payload.last_agent_message)
      if (last && last !== current?.last) {
        out.push(details("Last agent message snapshot", last), "")
      }

      const tokens = current ? tokenSummary(current.tokens) : ""
      if (tokens) out.push(tokens)

      current = null
      continue
    }

    out.push(`### Event: ${label(kind)}`, "", fence(pretty(row.payload), "json"), "")
    continue
  }

  if (row.type === "response_item" && rec(row.payload)) {
    const kind = str(row.payload.type) ?? "unknown"

    if (kind === "message") continue

    if (kind === "reasoning") continue

    if (kind === "function_call") {
      const name = str(row.payload.name) ?? "unknown"
      const callId = str(row.payload.call_id) ?? "unknown"
      const args = parse(str(row.payload.arguments))

      calls.set(callId, { name, type: kind })

      out.push(`### Tool Call: \`${name}\``, "")
      out.push(lines([`- Timestamp: \`${stamp(row.timestamp)}\``, `- Call ID: \`${callId}\``]), "")

      if (name === "exec_command" && rec(args)) {
        out.push(
          lines([
            `- Workdir: \`${str(args.workdir) ?? "unknown"}\``,
            str(args.shell) ? `- Shell: \`${str(args.shell)}\`` : null,
            typeof args.tty === "boolean" ? `- TTY: \`${args.tty}\`` : null,
            num(args.yield_time_ms) !== null ? `- Yield time: \`${num(args.yield_time_ms)}ms\`` : null,
            num(args.max_output_tokens) !== null ? `- Max output tokens: \`${num(args.max_output_tokens)}\`` : null,
          ]),
          "",
        )

        const cmd = str(args.cmd)
        if (cmd) out.push(fence(cmd, "sh"), "")
        continue
      }

      if (name === "spawn_agent" && rec(args)) {
        out.push(
          lines([
            `- Agent type: \`${str(args.agent_type) ?? "default"}\``,
            typeof args.fork_context === "boolean" ? `- Fork context: \`${args.fork_context}\`` : null,
          ]),
          "",
        )

        const msg = str(args.message)
        if (msg) out.push(details("Prompt", fence(msg, "text")), "")
        if (args.items) out.push(argsBlock(args.items), "")
        continue
      }

      if (name === "send_input" && rec(args)) {
        out.push(
          lines([
            `- Agent ID: \`${str(args.id) ?? "unknown"}\``,
            typeof args.interrupt === "boolean" ? `- Interrupt: \`${args.interrupt}\`` : null,
          ]),
          "",
        )

        const msg = str(args.message)
        if (msg) out.push(details("Message", fence(msg, "text")), "")
        if (args.items) out.push(argsBlock(args.items), "")
        continue
      }

      if (name === "wait" && rec(args)) {
        out.push(
          lines([
            `- Agent IDs: ${
              arr(args.ids)
                .map((item) => `\`${str(item) ?? "unknown"}\``)
                .join(", ") || "_none_"
            }`,
            num(args.timeout_ms) !== null ? `- Timeout: \`${num(args.timeout_ms)}ms\`` : null,
          ]),
          "",
        )
        continue
      }

      if (name === "close_agent" && rec(args)) {
        out.push(`- Agent ID: \`${str(args.id) ?? "unknown"}\``, "")
        continue
      }

      out.push(args ? argsBlock(args) : details("Arguments", fence(str(row.payload.arguments) ?? "", "text")), "")
      continue
    }

    if (kind === "function_call_output") {
      const callId = str(row.payload.call_id) ?? "unknown"
      const call = calls.get(callId)
      const name = call?.name ?? "unknown"
      const raw = str(row.payload.output) ?? ""
      const json = parse(raw)

      out.push(`### Tool Output: \`${name}\``, "")
      out.push(lines([`- Timestamp: \`${stamp(row.timestamp)}\``, `- Call ID: \`${callId}\``]), "")

      if (name === "exec_command") {
        const info = exec(raw)

        out.push(
          lines([
            info.code ? `- Exit code: \`${info.code}\`` : null,
            info.wall ? `- Wall time: \`${info.wall}\`` : null,
            info.chunk ? `- Chunk ID: \`${info.chunk}\`` : null,
            info.tokens ? `- Original token count: \`${info.tokens}\`` : null,
          ]),
          "",
        )

        out.push(details("Command output", fence(info.body || "(no stdout)", "text")), "")
        continue
      }

      if (rec(json)) {
        const notes = summary(json)
        if (notes.length) {
          out.push(notes.map((item) => `- ${item}`).join("\n"), "")
        }

        out.push(details("Raw output", fence(pretty(json), "json")), "")
        continue
      }

      out.push(details("Raw output", fence(raw || "(empty)", "text")), "")
      continue
    }

    if (kind === "custom_tool_call") {
      const name = str(row.payload.name) ?? "unknown"
      const callId = str(row.payload.call_id) ?? "unknown"

      calls.set(callId, { name, type: kind })

      out.push(`### Custom Tool: \`${name}\``, "")
      out.push(
        lines([
          `- Timestamp: \`${stamp(row.timestamp)}\``,
          `- Call ID: \`${callId}\``,
          `- Status: \`${str(row.payload.status) ?? "unknown"}\``,
        ]),
        "",
      )

      const input = str(row.payload.input)
      if (input) out.push(details("Patch input", fence(input, "diff")), "")
      continue
    }

    if (kind === "custom_tool_call_output") {
      const callId = str(row.payload.call_id) ?? "unknown"
      const call = calls.get(callId)
      const name = call?.name ?? "unknown"
      const raw = str(row.payload.output) ?? ""
      const json = parse(raw)

      out.push(`### Custom Tool Output: \`${name}\``, "")
      out.push(lines([`- Timestamp: \`${stamp(row.timestamp)}\``, `- Call ID: \`${callId}\``]), "")

      if (rec(json)) {
        const meta = rec(json.metadata) ? json.metadata : null
        if (meta) {
          out.push(
            lines([
              num(meta.exit_code) !== null ? `- Exit code: \`${num(meta.exit_code)}\`` : null,
              num(meta.duration_seconds) !== null ? `- Duration: \`${num(meta.duration_seconds)}s\`` : null,
            ]),
            "",
          )
        }

        if (str(json.output)) out.push(details("Tool output", fence(str(json.output) ?? "", "text")), "")
        out.push(details("Raw output", fence(pretty(json), "json")), "")
        continue
      }

      out.push(details("Raw output", fence(raw || "(empty)", "text")), "")
      continue
    }

    if (kind === "web_search_call") {
      const action = rec(row.payload.action) ? row.payload.action : null
      const queries = action
        ? arr(action.queries)
            .map((item) => str(item))
            .filter((item): item is string => Boolean(item))
        : []

      out.push("### Web Search", "")
      out.push(
        lines([
          `- Timestamp: \`${stamp(row.timestamp)}\``,
          `- Status: \`${str(row.payload.status) ?? "unknown"}\``,
          action && str(action.type) ? `- Action: \`${str(action.type)}\`` : null,
          action && str(action.query) ? `- Primary query: ${str(action.query)}` : null,
        ]),
        "",
      )

      if (queries.length) out.push(queries.map((item) => `- ${item}`).join("\n"), "")
      out.push(details("Raw payload", fence(pretty(row.payload), "json")), "")
      continue
    }

    out.push(`### Response Item: ${label(kind)}`, "", fence(pretty(row.payload), "json"), "")
  }
}

await Bun.write(output, `${out.join("\n").trim()}\n`)
console.log(`wrote ${path.resolve(output)}`)
