import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRequestedPaths } from "./paths";
import { implementSchema } from "./smithers-implement";
import type { ImplementOutput } from "./smithers-implement";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type ImplementInput = {
  stage?: "docs" | "tests" | "implementation";
  scope?: string;
  focus?: string;
  paths?: string[] | string;
  previousEpisodes?: ImplementOutput[];
  iteration?: number;
  smokeScenario?: string;
};

export type ResolvedImplementInput = {
  focus: string;
  iteration: number;
  paths: string[];
  previousEpisodes: ImplementOutput[];
  scope: string;
  stage: "docs" | "tests" | "implementation";
  smokeScenario: string;
};

function parsePositiveInt(
  value: number | string | undefined,
  fallback: number,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function resolveRepoRoot(
  workspaceRoot = process.env.ORIGIN_IMPLEMENT_WORKSPACE_ROOT,
): string {
  return workspaceRoot && workspaceRoot.length > 0
    ? resolve(workspaceRoot)
    : resolve(__dirname, "..");
}

export function readImplementInput(
  rawInput: unknown,
  repoRoot = resolveRepoRoot(),
): ResolvedImplementInput {
  const input =
    rawInput && typeof rawInput === "object"
      ? (rawInput as Record<string, unknown>)
      : {};

  const stage = input.stage === "docs" || input.stage === "tests"
    ? input.stage
    : "implementation";

  const previousEpisodes: ImplementOutput[] = Array.isArray(
    input.previousEpisodes,
  )
    ? input.previousEpisodes
        .map((ep: unknown) => {
          try {
            return implementSchema.parse(ep) as ImplementOutput;
          } catch {
            return null;
          }
        })
        .filter((ep): ep is ImplementOutput => ep !== null)
    : [];

  return {
    stage,
    scope: asString(input.scope) ?? "",
    focus: asString(input.focus) ?? "",
    paths: parseRequestedPaths(
      repoRoot,
      input.paths as string | string[] | undefined,
    ),
    previousEpisodes,
    iteration: parsePositiveInt(input.iteration, 0),
    smokeScenario: asString(input.smokeScenario) ?? "default",
  };
}
