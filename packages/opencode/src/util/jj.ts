import { Process } from "./process"

export interface JJResult {
  exitCode: number
  text(): string
  stdout: Buffer
  stderr: Buffer
}

export interface JJOptions {
  cwd: string
  env?: Record<string, string>
  binary?: string
}

export function resolveJjBinary(override?: string) {
  const env = process.env["OPENCODE_JJ_BIN"]?.trim()
  if (override?.trim()) return override.trim()
  if (env) return env
  return Bun.which("jj") ?? "jj"
}

/**
 * Run a jj command with stdin ignored to avoid inheriting protocol pipes.
 */
export async function jj(args: string[], opts: JJOptions): Promise<JJResult> {
  const cmd = [resolveJjBinary(opts.binary), ...args]
  return Process.run(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: "ignore",
    nothrow: true,
  })
    .then((result) => ({
      exitCode: result.code,
      text: () => result.stdout.toString(),
      stdout: result.stdout,
      stderr: result.stderr,
    }))
    .catch((error) => ({
      exitCode: 1,
      text: () => "",
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(error instanceof Error ? error.message : String(error)),
    }))
}
