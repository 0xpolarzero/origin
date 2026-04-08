import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRequestedPaths } from "./paths";
import { addressSchema, reviewSchema } from "./smithers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type ReviewInput = {
  mode?: "review" | "address";
  reviewRound?: number;
  focus?: string;
  paths?: string[] | string;
  instructions?: string;
  latestReview?: typeof reviewSchema._output;
  latestAddress?: typeof addressSchema._output;
  smokeScenario?: string;
};

export type ResolvedReviewInput = {
  focus: string;
  instructions: string;
  latestAddress?: typeof addressSchema._output;
  latestReview: typeof reviewSchema._output;
  mode: "review" | "address";
  paths: string[];
  reviewRound: number;
  smokeScenario: string;
};

function parsePositiveInt(value: number | string | undefined, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(typeof value === "string" ? value : "", 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveRepoRoot(workspaceRoot = process.env.ORIGIN_REVIEW_WORKSPACE_ROOT): string {
  return workspaceRoot && workspaceRoot.length > 0
    ? resolve(workspaceRoot)
    : resolve(__dirname, "..");
}

export function smokeLocationToFilePath(location: string): string {
  return location.trim().replace(/:(\d+)(:\d+)?$/, "");
}

export function readInput(rawInput: unknown, repoRoot = resolveRepoRoot()): ResolvedReviewInput {
  const input =
    rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};

  return {
    mode: input.mode === "address" ? "address" : "review",
    reviewRound: parsePositiveInt(input.reviewRound as number | string | undefined, 0),
    focus: asString(input.focus) ?? "",
    paths: parseRequestedPaths(repoRoot, input.paths as string | string[] | undefined),
    instructions: asString(input.instructions) ?? "",
    latestReview: reviewSchema
      .catch({
        verdict: "CHANGES_REQUIRED",
        findings: [],
        blockers: [],
        residualRisks: [],
      })
      .parse(input.latestReview),
    latestAddress:
      input.latestAddress === undefined
        ? undefined
        : addressSchema.parse(input.latestAddress),
    smokeScenario: asString(input.smokeScenario) ?? "default",
  };
}
