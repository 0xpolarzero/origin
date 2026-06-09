type SimctlDevice = {
  isAvailable?: boolean;
  name?: string;
  state?: string;
  udid?: string;
};

type SimctlDevices = {
  devices?: Record<string, SimctlDevice[]>;
};

type RuntimeVersion = {
  major: number;
  minor: number;
  patch: number;
};

export type SimulatorDestination = {
  name: string;
  runtime: string;
  runtimeVersion: string;
  state: string;
  udid: string;
};

const e2eDeviceName = "iPhone 13 Pro";
const e2eRuntimeMajor = 18;

export async function resolveE2ESimulator(): Promise<SimulatorDestination> {
  const proc = Bun.spawn(["xcrun", "simctl", "list", "devices", "available", "--json"], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (code !== 0) {
    throw new Error(`xcrun simctl failed: ${stderr.trim() || stdout.trim()}`);
  }

  let parsed: SimctlDevices;
  try {
    parsed = JSON.parse(stdout) as SimctlDevices;
  } catch (error) {
    throw new Error(`xcrun simctl returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const destinations = Object.entries(parsed.devices ?? {})
    .flatMap(([runtime, devices]) => {
      const version = parseIOSRuntimeVersion(runtime);
      if (version === undefined || version.major !== e2eRuntimeMajor) {
        return [];
      }

      return devices
        .filter((device) => device.name === e2eDeviceName && device.isAvailable === true && device.udid !== undefined)
        .map((device) => ({
          name: device.name ?? e2eDeviceName,
          runtime,
          runtimeVersion: formatRuntimeVersion(version),
          runtimeSort: version,
          state: device.state ?? "unknown",
          udid: device.udid ?? ""
        }));
    })
    .sort((left, right) => compareRuntimeVersions(right.runtimeSort, left.runtimeSort));

  const destination = destinations[0];
  if (destination === undefined) {
    throw new Error(
      `Create an available ${e2eDeviceName} simulator on iOS ${e2eRuntimeMajor}.x in Xcode Devices and Simulators.`
    );
  }

  return {
    name: destination.name,
    runtime: destination.runtime,
    runtimeVersion: destination.runtimeVersion,
    state: destination.state,
    udid: destination.udid
  };
}

function parseIOSRuntimeVersion(runtime: string): RuntimeVersion | undefined {
  const match = runtime.match(/com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$/);
  if (match === null) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? "0")
  };
}

function compareRuntimeVersions(left: RuntimeVersion, right: RuntimeVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function formatRuntimeVersion(version: RuntimeVersion): string {
  return version.patch === 0 ? `${version.major}.${version.minor}` : `${version.major}.${version.minor}.${version.patch}`;
}
