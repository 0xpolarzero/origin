import { resolveE2ESimulator } from "./simulator";

async function run(command: string, args: string[], options: { allowFailure?: boolean } = {}): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await proc.exited;
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
  }
}

const appBundleIdentifier = "com.polarzero.origin.ios";
const appPath = "native/Origin/build/Debug-iphonesimulator/Origin.app";

const destination = await resolveE2ESimulator();
console.log(`using simulator: ${destination.name} iOS ${destination.runtimeVersion} ${destination.udid}`);

if (destination.state !== "Booted") {
  await run("xcrun", ["simctl", "boot", destination.udid]);
}
await run("xcrun", ["simctl", "bootstatus", destination.udid, "-b"]);
await run("xcrun", ["simctl", "terminate", destination.udid, appBundleIdentifier], { allowFailure: true });
await run("xcrun", ["simctl", "uninstall", destination.udid, appBundleIdentifier], { allowFailure: true });
await run("xcrun", ["simctl", "install", destination.udid, appPath]);
await run("xcrun", ["simctl", "launch", destination.udid, appBundleIdentifier]);
