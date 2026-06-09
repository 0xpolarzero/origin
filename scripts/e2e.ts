import { resolveE2ESimulator } from "./simulator";

async function run(command: string, args: string[], options: { allowFailure?: boolean; exitOnFailure?: boolean } = {}): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await proc.exited;
  if (code !== 0 && !options.allowFailure) {
    if (options.exitOnFailure === true) {
      process.exit(code);
    }
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
  }
}

type LogWriter = {
  write(chunk: Uint8Array): unknown;
  end(): unknown;
};

const backendLogPath = ".logs/backend.log";
const appBundleIdentifier = "com.polarzero.origin.ios";
const appPath = "native/Origin/build/Debug-iphonesimulator/Origin.app";

async function copyToLog(stream: ReadableStream<Uint8Array>, writer: LogWriter): Promise<void> {
  for await (const chunk of stream) {
    writer.write(chunk);
  }
}

async function waitForBackend(backend: Bun.Subprocess): Promise<void> {
  const startup = new Promise((resolve) => setTimeout(resolve, 1500));
  const exitCode = await Promise.race([backend.exited, startup]);
  if (typeof exitCode === "number") {
    throw new Error(`backend exited before E2E could start; check ${backendLogPath}`);
  }

  const health = await fetch("http://127.0.0.1:3000/health", {
    headers: { "x-correlation-id": "agent-e2e-health" }
  });
  if (!health.ok) {
    throw new Error(`backend health failed with ${health.status}`);
  }
}

async function backendIsHealthy(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:3000/health", {
      headers: { "x-correlation-id": "agent-e2e-existing-backend" },
      signal: AbortSignal.timeout(1_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForLog(pattern: string, offset: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await Bun.file(backendLogPath).text().catch(() => "");
    if (text.slice(offset).includes(pattern)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for "${pattern}" in ${backendLogPath}`);
}

export {};

await run("make", ["doctor"], { exitOnFailure: true });
const destination = await resolveE2ESimulator();
console.log(`using simulator: ${destination.name} iOS ${destination.runtimeVersion} ${destination.udid}`);
await run("make", ["up"]);

await run("mkdir", ["-p", ".logs"]);
let logWriter: LogWriter | undefined;
let backend: Bun.Subprocess | undefined;

try {
  if (await backendIsHealthy()) {
    throw new Error("port 3000 is already serving /health; stop the existing backend before running make e2e");
  }

  await Bun.write(backendLogPath, "");
  logWriter = Bun.file(backendLogPath).writer();
  backend = Bun.spawn(["bun", "backend/src/index.ts"], {
    stdout: "pipe",
    stderr: "pipe"
  });
  if (!(backend.stdout instanceof ReadableStream) || !(backend.stderr instanceof ReadableStream)) {
    throw new Error("backend stdout/stderr pipes were not created");
  }
  void copyToLog(backend.stdout, logWriter);
  void copyToLog(backend.stderr, logWriter);
  await waitForBackend(backend);

  await run("xcodebuild", [
    "-project",
    "native/Origin/Origin.xcodeproj",
    "-target",
    "Origin-iOS",
    "-configuration",
    "Debug",
    "-sdk",
    "iphonesimulator",
    "-quiet",
    "build"
  ]);
  if (destination.state !== "Booted") {
    await run("xcrun", ["simctl", "boot", destination.udid]);
  }
  await run("xcrun", ["simctl", "bootstatus", destination.udid, "-b"]);
  await run("xcrun", ["simctl", "terminate", destination.udid, appBundleIdentifier], { allowFailure: true });
  await run("xcrun", ["simctl", "uninstall", destination.udid, appBundleIdentifier], { allowFailure: true });
  await run("xcrun", ["simctl", "install", destination.udid, appPath]);
  await run("xcrun", ["simctl", "launch", destination.udid, appBundleIdentifier]);
  await waitForLog("issued powersync credentials", 0, 10_000);
} finally {
  backend?.kill();
  logWriter?.end();
}
