import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { Redaction } from "../util/redaction"
import { UI } from "./ui"

function safe(value?: string) {
  if (value === undefined) return
  return Redaction.text(value)
}

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input))
    return safe(`MCP server "${input.data.name}" failed. Note, opencode does not support MCP authentication yet.`)
  if (Provider.ModelNotFoundError.isInstance(input)) {
    const { providerID, modelID, suggestions } = input.data
    return safe(
      [
        `Model not found: ${providerID}/${modelID}`,
        ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
        `Try: \`opencode models\` to list available models`,
        `Or check your config (opencode.json) provider/model names`,
      ].join("\n"),
    )
  }
  if (Provider.InitError.isInstance(input)) {
    return safe(`Failed to initialize provider "${input.data.providerID}". Check credentials and configuration.`)
  }
  if (Config.JsonError.isInstance(input)) {
    return safe(
      `Config file at ${input.data.path} is not valid JSON(C)` + (input.data.message ? `: ${input.data.message}` : "")
    )
  }
  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    return safe(
      `Directory "${input.data.dir}" in ${input.data.path} is not valid. Rename the directory to "${input.data.suggestion}" or remove it. This is a common typo.`,
    )
  }
  if (ConfigMarkdown.FrontmatterError.isInstance(input)) {
    return safe(input.data.message)
  }
  if (Config.InvalidError.isInstance(input))
    return safe(
      [
        `Configuration is invalid${input.data.path && input.data.path !== "config" ? ` at ${input.data.path}` : ""}` +
          (input.data.message ? `: ${input.data.message}` : ""),
        ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
      ].join("\n"),
    )

  if (UI.CancelledError.isInstance(input)) return ""
}

export function FormatUnknownError(input: unknown): string {
  if (input instanceof Error) {
    return Redaction.text(input.stack ?? `${input.name}: ${input.message}`)
  }

  if (typeof input === "object" && input !== null) {
    try {
      return JSON.stringify(Redaction.value(input), null, 2)
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return Redaction.text(String(input))
}
