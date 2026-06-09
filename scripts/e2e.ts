import { resolveE2ESimulator } from "./simulator";
import { cp } from "node:fs/promises";

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
const buildRoot = "native/Origin/build";
const xctestRunPath = `${buildRoot}/OriginUITests.xctestrun`;
const testingInteropSource =
  "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/usr/lib/lib_TestingInterop.dylib";
const testingInteropDestination = `${buildRoot}/Debug-iphonesimulator/lib_TestingInterop.dylib`;
const testingFrameworkSourceRoot =
  "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Frameworks";
const testingFrameworkNames = [
  "_Testing_CoreGraphics.framework",
  "_Testing_CoreImage.framework",
  "_Testing_Foundation.framework",
  "_Testing_UIKit.framework"
];

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

// The checked-in project is handmade enough that scheme-based test actions currently
// resolve only the latest iOS device placeholder. Build the UI test target directly,
// then provide the small XCTest runner manifest that points XCUIApplication() at
// the built simulator app.
async function writeXCTestRunFile(): Promise<void> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>TestPlan</key>
  <dict>
    <key>Name</key>
    <string>OriginUITests</string>
    <key>IsDefault</key>
    <true/>
  </dict>
  <key>TestConfigurations</key>
  <array>
    <dict>
      <key>Name</key>
      <string>Default</string>
      <key>IsEnabled</key>
      <true/>
      <key>TestTargets</key>
      <array>
        <dict>
          <key>BlueprintName</key>
          <string>OriginUITests</string>
          <key>IsUITestBundle</key>
          <true/>
          <key>IsXCTRunnerHostedTestBundle</key>
          <true/>
          <key>TestBundlePath</key>
          <string>__TESTHOST__/PlugIns/OriginUITests.xctest</string>
          <key>TestHostPath</key>
          <string>__TESTROOT__/Debug-iphonesimulator/OriginUITests-Runner.app</string>
          <key>TestHostBundleIdentifier</key>
          <string>com.polarzero.origin.ios.uitests.xctrunner</string>
          <key>UITargetAppPath</key>
          <string>__TESTROOT__/Debug-iphonesimulator/Origin.app</string>
          <key>UITargetAppBundleIdentifier</key>
          <string>${appBundleIdentifier}</string>
          <key>DependentProductPaths</key>
          <array>
            <string>__TESTROOT__/Debug-iphonesimulator/Origin.app</string>
            <string>__TESTROOT__/Debug-iphonesimulator/OriginUITests-Runner.app</string>
            <string>__TESTROOT__/Debug-iphonesimulator/OriginUITests-Runner.app/PlugIns/OriginUITests.xctest</string>
          </array>
          <key>TestingEnvironmentVariables</key>
          <dict>
            <key>DYLD_FRAMEWORK_PATH</key>
            <string>__TESTROOT__/Debug-iphonesimulator</string>
            <key>DYLD_LIBRARY_PATH</key>
            <string>__TESTROOT__/Debug-iphonesimulator</string>
            <key>XCInjectBundleInto</key>
            <string>__TESTHOST__/OriginUITests-Runner</string>
          </dict>
          <key>ProductModuleName</key>
          <string>OriginUITests</string>
          <key>SystemAttachmentLifetime</key>
          <string>deleteOnSuccess</string>
          <key>UserAttachmentLifetime</key>
          <string>deleteOnSuccess</string>
        </dict>
      </array>
    </dict>
  </array>
  <key>CodeCoverageBuildableInfos</key>
  <array/>
  <key>__xctestrun_metadata__</key>
  <dict>
    <key>FormatVersion</key>
    <integer>2</integer>
  </dict>
</dict>
</plist>
`;
  await Bun.write(xctestRunPath, xml);
}

async function copyTestingSupportLibraries(): Promise<void> {
  await Bun.write(testingInteropDestination, Bun.file(testingInteropSource));
  for (const framework of testingFrameworkNames) {
    await cp(`${testingFrameworkSourceRoot}/${framework}`, `${buildRoot}/Debug-iphonesimulator/${framework}`, {
      force: true,
      recursive: true
    });
  }
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
    "OriginUITests",
    "-configuration",
    "Debug",
    "-sdk",
    "iphonesimulator",
    "-quiet",
    "build"
  ]);
  await copyTestingSupportLibraries();
  await writeXCTestRunFile();
  await run("xcodebuild", [
    "test-without-building",
    "-xctestrun",
    xctestRunPath,
    "-destination",
    `id=${destination.udid}`
  ]);
  await waitForLog("issued powersync credentials", 0, 10_000);
} finally {
  backend?.kill();
  logWriter?.end();
}
