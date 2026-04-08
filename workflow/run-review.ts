#!/usr/bin/env bun

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseRequestedPaths } from "./paths";
import { copyRepoWorkspace, captureWorkspaceSnapshot, syncWorkspaceChanges } from "./workspace";
import type { addressSchema, reviewSchema } from "./smithers";

type ReviewOutput = typeof reviewSchema._output;
type AddressOutput = typeof addressSchema._output;
type StepOutput = {
  address?: AddressOutput;
  mode: "review" | "address";
  review?: ReviewOutput;
};

type CliOptions = {
  focus?: string;
  instructions?: string;
  maxIterations: number;
  paths: string[];
  smoke: boolean;
  smokeScenario?: string;
};

type LoopResult = {
  changedFiles: string[];
  finalSummary: string;
  finalVerdict: "LGTM" | "CHANGES_REQUIRED";
  humanDecisionsNeeded: string[];
  reviewIterations: number;
};

const ROOT_DIR = resolve(dirname(new URL(import.meta.url).pathname), "..");
const WORKFLOW_ENTRY_RELATIVE = "workflow/review-workflow.tsx";
const DEFAULT_CODEX_HOME = resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));
const REQUIRED_CODEX_HOME_FILES = ["auth.json", "config.toml"] as const;
const OPTIONAL_CODEX_HOME_FILES = ["AGENTS.md", "version.json"] as const;

type StepDbClient = {
  close?: () => void;
  query: (sql: string) => {
    get: (runId: string, nodeId: string) => Record<string, unknown> | null;
  };
};

type WorkflowDefinition = Parameters<typeof import("smithers-orchestrator").runWorkflow>[0];
type WorkflowRunner = (
  workflow: WorkflowDefinition,
  options: {
    input: Record<string, unknown>;
    maxConcurrency: number;
    rootDir: string;
    runId: string;
    workflowPath: string;
  },
) => Promise<{ output?: unknown; status: string }>;

type LoadedWorkflowRuntime = {
  close: () => void;
  dbClient: StepDbClient;
  rootDir: string;
  workflow: WorkflowDefinition;
  workflowPath: string;
};

type WorkflowStepResult = Awaited<ReturnType<WorkflowRunner>>;

type RunReviewLoopDeps = {
  provisionIsolatedCodexHome?: (tempDir: string) => string;
  repoRoot?: string;
  runWorkflow?: WorkflowRunner;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function readOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function parseCliOptions(argv: string[], rootDir = ROOT_DIR): CliOptions {
  let focus: string | undefined;
  let instructions: string | undefined;
  let rawPaths: string | undefined;
  let smoke = false;
  let smokeScenario: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--smoke") {
      smoke = true;
      continue;
    }

    if (argument === "--focus") {
      focus = readOptionValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--paths") {
      rawPaths = readOptionValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--instructions") {
      instructions = readOptionValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--smoke-scenario") {
      smokeScenario = readOptionValue(argv, index, argument);
      index += 1;
      continue;
    }
  }

  const maxIterations = parsePositiveInt(process.env.ORIGIN_REVIEW_MAX_ITERATIONS, smoke ? 3 : 4);

  return {
    focus,
    instructions,
    maxIterations,
    paths: parseRequestedPaths(rootDir, rawPaths ?? process.env.ORIGIN_REVIEW_PATHS),
    smoke,
    smokeScenario,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function extractOutputRow<T extends Record<string, unknown>>(
  result: { output?: unknown; status: string },
  nodeId: string,
): T {
  if (result.status !== "finished") {
    throw new Error(`Workflow step ${nodeId} did not finish successfully.`);
  }

  const outputRows = Array.isArray(result.output) ? result.output : [];
  const row = outputRows.find((entry) => isRecord(entry) && entry.nodeId === nodeId);
  if (!isRecord(row)) {
    throw new Error(`Workflow step ${nodeId} did not produce an output row.`);
  }

  return row as T;
}

function readStepRowFromDb(
  dbClient: {
    query: (sql: string) => {
      get: (runId: string, nodeId: string) => Record<string, unknown> | null;
    };
  },
  runId: string,
): StepOutput {
  const row = dbClient
    .query(
      "select mode, review, address from step where run_id = ? and node_id = ? order by iteration desc limit 1",
    )
    .get(runId, "step-output");

  if (!row) {
    throw new Error(`Workflow step step-output did not produce a database row for ${runId}.`);
  }

  return {
    address:
      typeof row.address === "string" ? (JSON.parse(row.address) as AddressOutput) : undefined,
    mode: row.mode === "address" ? "address" : "review",
    review: typeof row.review === "string" ? (JSON.parse(row.review) as ReviewOutput) : undefined,
  };
}

function getWorkflowFailureReason(result: LoopResult): string | null {
  if (result.humanDecisionsNeeded.length > 0) {
    return `human decisions required: ${result.humanDecisionsNeeded.join(" | ")}`;
  }

  if (result.finalVerdict !== "LGTM") {
    return `final verdict is ${result.finalVerdict}`;
  }

  return null;
}

function setEnv(name: string, value: string | undefined): string | undefined {
  const previous = process.env[name];

  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  return previous;
}

function resolveWorkflowEntry(rootDir: string): string {
  return resolve(rootDir, WORKFLOW_ENTRY_RELATIVE);
}

function stageWorkflowImportEntry(workspaceRoot: string, tempDir: string): string {
  const importRoot = join(tempDir, "workflow-runtime", randomUUID());
  cpSync(join(workspaceRoot, "workflow"), join(importRoot, "workflow"), {
    recursive: true,
  });
  return resolveWorkflowEntry(importRoot);
}

async function runWorkflowStepWithRetry(options: {
  buildRunId: (attempt: number) => string;
  label: "Review" | "Address";
  maxAttempts: number;
  reviewRound: number;
  runWorkflow: WorkflowRunner;
  runtime: LoadedWorkflowRuntime;
  stepInput: Record<string, unknown>;
}): Promise<{ result: WorkflowStepResult; runId: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const runId = options.buildRunId(attempt);

    try {
      const result = await options.runWorkflow(options.runtime.workflow, {
        input: options.stepInput,
        maxConcurrency: 1,
        rootDir: options.runtime.rootDir,
        runId,
        workflowPath: options.runtime.workflowPath,
      });

      if (result.status === "finished") {
        return { result, runId };
      }

      lastError = new Error(
        `${options.label} step ${options.reviewRound} attempt ${attempt} finished with status ${result.status}.`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < options.maxAttempts) {
      await sleep(attempt * 1_000);
    }
  }

  throw new Error(
    `${options.label} step ${options.reviewRound} did not finish successfully after ${options.maxAttempts} attempts.${lastError ? ` Last error: ${lastError.message}` : ""}`,
  );
}

async function loadWorkflowRuntime(
  workspaceRoot: string,
  tempDir: string,
): Promise<LoadedWorkflowRuntime> {
  const workflowPath = resolveWorkflowEntry(workspaceRoot);
  const importPath = stageWorkflowImportEntry(workspaceRoot, tempDir);
  const workflowModule = (await import(
    `${pathToFileURL(importPath).href}?origin-review-run=${randomUUID()}`
  )) as {
    db?: { $client?: StepDbClient };
    default?: unknown;
  };

  if (workflowModule.default === undefined) {
    throw new Error(`Workflow module ${importPath} did not export a default workflow.`);
  }

  const dbClient = workflowModule.db?.$client;
  if (!dbClient) {
    throw new Error(`Workflow module ${importPath} did not expose a database client.`);
  }

  return {
    close: () => dbClient.close?.(),
    dbClient,
    rootDir: workspaceRoot,
    workflow: workflowModule.default as WorkflowDefinition,
    workflowPath,
  };
}

export function provisionIsolatedCodexHome(
  tempDir: string,
  sourceHome = DEFAULT_CODEX_HOME,
): string {
  const resolvedSourceHome = resolve(sourceHome);
  const isolatedHome = join(tempDir, "codex-home");
  mkdirSync(isolatedHome, { recursive: true });

  for (const fileName of REQUIRED_CODEX_HOME_FILES) {
    const sourcePath = join(resolvedSourceHome, fileName);
    if (!existsSync(sourcePath)) {
      throw new Error(`Codex auth bootstrap failed: missing ${fileName} in ${resolvedSourceHome}.`);
    }
    copyFileSync(sourcePath, join(isolatedHome, fileName));
  }

  for (const fileName of OPTIONAL_CODEX_HOME_FILES) {
    const sourcePath = join(resolvedSourceHome, fileName);
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, join(isolatedHome, fileName));
    }
  }

  return isolatedHome;
}

function readIsolatedCodexApiKey(codexHome: string | undefined): string | undefined {
  if (!codexHome) {
    return undefined;
  }

  const authPath = join(codexHome, "auth.json");
  if (!existsSync(authPath)) {
    return undefined;
  }

  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8")) as { OPENAI_API_KEY?: unknown };
    return typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.length > 0
      ? auth.OPENAI_API_KEY
      : undefined;
  } catch {
    return undefined;
  }
}

export async function runReviewLoop(
  options: CliOptions,
  deps: RunReviewLoopDeps = {},
): Promise<LoopResult> {
  const repoRoot = deps.repoRoot ?? ROOT_DIR;
  const tempDir = mkdtempSync(
    join(tmpdir(), options.smoke ? "origin-review-smoke-" : "origin-review-run-"),
  );
  const workspaceRoot = join(tempDir, "repo");
  const dbPath = options.smoke ? ":memory:" : join(tempDir, "origin-review.db");
  const codexHome = options.smoke
    ? undefined
    : (deps.provisionIsolatedCodexHome ?? provisionIsolatedCodexHome)(tempDir);
  const openAiApiKey = process.env.OPENAI_API_KEY ?? readIsolatedCodexApiKey(codexHome);
  const stepMaxAttempts = options.smoke
    ? 1
    : parsePositiveInt(process.env.ORIGIN_REVIEW_STEP_MAX_ATTEMPTS, 3);

  const previousEnv = {
    codexHome: setEnv("ORIGIN_REVIEW_CODEX_HOME", codexHome),
    openAiApiKey: setEnv("ORIGIN_REVIEW_OPENAI_API_KEY", openAiApiKey),
    rootOpenAiApiKey: setEnv("OPENAI_API_KEY", openAiApiKey),
    dbPath: setEnv("ORIGIN_REVIEW_WORKFLOW_DB", dbPath),
    smoke: setEnv("ORIGIN_REVIEW_SMOKE", options.smoke ? "1" : undefined),
    smithersLogDir: setEnv("SMITHERS_LOG_DIR", join(tempDir, ".smithers")),
    workspaceRoot: setEnv("ORIGIN_REVIEW_WORKSPACE_ROOT", workspaceRoot),
  };

  let workflowRuntime: LoadedWorkflowRuntime | null = null;
  const loadedWorkflowRuntimes: LoadedWorkflowRuntime[] = [];

  try {
    copyRepoWorkspace(repoRoot, workspaceRoot);
    const baselineSnapshot = captureWorkspaceSnapshot(workspaceRoot);
    const runWorkflow = deps.runWorkflow ?? (await import("smithers-orchestrator")).runWorkflow;

    let latestAddress: AddressOutput | undefined;

    for (let reviewRound = 0; reviewRound < options.maxIterations; reviewRound += 1) {
      workflowRuntime = await loadWorkflowRuntime(workspaceRoot, tempDir);
      loadedWorkflowRuntimes.push(workflowRuntime);

      const reviewStep = await runWorkflowStepWithRetry({
        buildRunId: (attempt) =>
          `${options.smoke ? "origin-review-smoke" : "origin-review"}-review-${reviewRound}-attempt-${attempt}-${randomUUID()}`,
        label: "Review",
        maxAttempts: stepMaxAttempts,
        reviewRound,
        runWorkflow,
        runtime: workflowRuntime,
        stepInput: {
          mode: "review",
          focus: options.focus,
          instructions: options.instructions,
          latestAddress,
          paths: options.paths,
          reviewRound,
          smokeScenario: options.smokeScenario,
        },
      });
      const reviewOutput = readStepRowFromDb(workflowRuntime.dbClient, reviewStep.runId);
      const review = reviewOutput.review;
      if (!review) {
        throw new Error("Review step completed without a review payload.");
      }

      if (review.verdict === "LGTM") {
        const changedFiles = options.smoke
          ? (latestAddress?.filesChanged ?? [])
          : syncWorkspaceChanges({
              baselineSnapshot,
              scopePaths: options.paths,
              sourceRoot: workspaceRoot,
              targetRoot: repoRoot,
            });

        return {
          changedFiles,
          finalSummary: latestAddress?.summary ?? "Review approved without follow-up edits.",
          finalVerdict: "LGTM",
          humanDecisionsNeeded: [],
          reviewIterations: reviewRound + 1,
        };
      }

      if (reviewRound === options.maxIterations - 1) {
        return {
          changedFiles: [],
          finalSummary: "Review loop reached the configured iteration cap without approval.",
          finalVerdict: "CHANGES_REQUIRED",
          humanDecisionsNeeded: [],
          reviewIterations: options.maxIterations,
        };
      }

      const addressStep = await runWorkflowStepWithRetry({
        buildRunId: (attempt) =>
          `${options.smoke ? "origin-review-smoke" : "origin-review"}-address-${reviewRound}-attempt-${attempt}-${randomUUID()}`,
        label: "Address",
        maxAttempts: stepMaxAttempts,
        reviewRound,
        runWorkflow,
        runtime: workflowRuntime,
        stepInput: {
          focus: options.focus,
          instructions: options.instructions,
          latestReview: review,
          mode: "address",
          paths: options.paths,
          reviewRound,
          smokeScenario: options.smokeScenario,
        },
      });
      const addressOutput = readStepRowFromDb(workflowRuntime.dbClient, addressStep.runId);
      latestAddress = addressOutput.address;
      if (!latestAddress) {
        throw new Error("Address step completed without an address payload.");
      }

      if (latestAddress.status === "NEEDS_HUMAN_DECISION") {
        return {
          changedFiles: [],
          finalSummary: latestAddress.summary,
          finalVerdict: "CHANGES_REQUIRED",
          humanDecisionsNeeded: latestAddress.humanDecisionsNeeded,
          reviewIterations: reviewRound + 1,
        };
      }
    }

    return {
      changedFiles: [],
      finalSummary: "Review loop exited unexpectedly.",
      finalVerdict: "CHANGES_REQUIRED",
      humanDecisionsNeeded: [],
      reviewIterations: options.maxIterations,
    };
  } finally {
    for (const loadedWorkflowRuntime of loadedWorkflowRuntimes) {
      loadedWorkflowRuntime.close();
    }
    setEnv("ORIGIN_REVIEW_CODEX_HOME", previousEnv.codexHome);
    setEnv("ORIGIN_REVIEW_OPENAI_API_KEY", previousEnv.openAiApiKey);
    setEnv("OPENAI_API_KEY", previousEnv.rootOpenAiApiKey);
    setEnv("ORIGIN_REVIEW_WORKFLOW_DB", previousEnv.dbPath);
    setEnv("ORIGIN_REVIEW_SMOKE", previousEnv.smoke);
    setEnv("SMITHERS_LOG_DIR", previousEnv.smithersLogDir);
    setEnv("ORIGIN_REVIEW_WORKSPACE_ROOT", previousEnv.workspaceRoot);

    rmSync(tempDir, { force: true, recursive: true });
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseCliOptions(argv);
    const mode = [
      "Running review workflow",
      options.smoke ? "in smoke mode" : "",
      options.paths.length > 0 ? `for paths: ${options.paths.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    console.log(mode);

    const result = await runReviewLoop(options);
    console.log(JSON.stringify(result, null, 2));

    const failureReason = getWorkflowFailureReason(result);
    if (failureReason) {
      console.error(failureReason);
      return 1;
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
