type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

import { resolveE2ESimulator } from "./simulator";

export {};

async function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  return { code, stdout, stderr };
}

function print(check: Check): void {
  const status = check.ok ? "ok" : "fail";
  console.log(`${status} ${check.name}: ${check.detail}`);
}

const checks: Check[] = [];

const xcodeSelect = await run("xcode-select", ["-p"]);
checks.push({
  name: "xcode-select",
  ok: xcodeSelect.code === 0 && xcodeSelect.stdout.trim().length > 0,
  detail:
    xcodeSelect.code === 0
      ? xcodeSelect.stdout.trim()
      : "Run sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
});

const sdks = await run("xcodebuild", ["-showsdks"]);
const iosSimulatorSdk = sdks.stdout
  .split("\n")
  .map((line) => line.trim())
  .find((line) => /-sdk\s+iphonesimulator\d+(?:\.\d+)?/.test(line));
checks.push({
  name: "iOS simulator SDK",
  ok: sdks.code === 0 && iosSimulatorSdk !== undefined,
  detail:
    sdks.code === 0 && iosSimulatorSdk !== undefined
      ? iosSimulatorSdk
      : "Install an Xcode version that includes an iOS Simulator SDK."
});

let destinationDetail: string;
let destinationOk = false;
try {
  const destination = await resolveE2ESimulator();
  destinationOk = true;
  destinationDetail = `${destination.name} iOS ${destination.runtimeVersion} ${destination.udid}`;
} catch (error) {
  destinationDetail = error instanceof Error ? error.message : String(error);
}
checks.push({
  name: "E2E simulator destination",
  ok: destinationOk,
  detail: destinationDetail
});

for (const check of checks) {
  print(check);
}

if (checks.some((check) => !check.ok)) {
  console.error("doctor failed; fix the failed checks above before running simulator e2e.");
  process.exit(1);
}
