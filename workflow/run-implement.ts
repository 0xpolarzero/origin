#!/usr/bin/env bun

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { parseRequestedPaths } from "./paths";
import {
  copyRepoWorkspace,
  captureWorkspaceSnapshot,
  syncWorkspaceChanges,
} from "./workspace";
import type { ImplementOutput } from "./smithers-implement";
import { implementSchema } from "./smithers-implement";

type StepDbClient = {
  close?: () => void;
  query: (sql: string) => {
    get: (runId: string, nodeId: string) => Record<string, unknown> | null;
  };
};

type WorkflowDefinition = Parameters<
  typeof import("smithers-orchestrator").runWorkflow
>[0];
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

type CliOptions = {
  focus?: string;
  maxIterations: number;
  paths: string[];
  scope?: string;
  smoke: boolean;
  smokeScenario?: string;
  stage: "docs" | "tests" | "implementation";
};

type LoopResult = {
  changedFiles: string[];
  episodes: ImplementOutput[];
  finalStatus: "DONE" | "PARTIAL" | "BLOCKED";
  finalSummary: string;
  humanDecisionsNeeded: string[];
  iterations: number;
};

const ROOT_DIR = resolve(
  dirname(new URL(import.meta.url).pathname),
  "..",
);
const WORKFLOW_ENTRY_RELATIVE =
  "workflow/implement-workflow.tsx";

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function readOptionValue(
  argv: string[],
  index: number,
  flag: string,
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function parseCliOptions(
  argv: string[],
  _rootDir = ROOT_DIR,
): CliOptions {
  let focus: string | undefined;
  let rawPaths: string | undefined;
  let scope: string | undefined;
  let smoke = false;
  let smokeScenario: string | undefined;
  let stage: "docs" | "tests" | "implementation" = "implementation";

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

    if (argument === "--scope") {
      scope = readOptionValue(argv, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--stage") {
      const value = readOptionValue(argv, index, argument);
      if (value !== "docs" && value !== "tests" && value !== "implementation") {
        throw new Error(
          `--stage must be docs, tests, or implementation. Got: ${value}`,
        );
      }
      stage = value;
      index += 1;
      continue;
    }

    if (argument === "--smoke-scenario") {
      smokeScenario = readOptionValue(argv, index, argument);
      index += 1;
      continue;
    }
  }

  const maxIterations = parsePositiveInt(
    process.env.ORIGIN_IMPLEMENT_MAX_ITERATIONS,
    smoke ? 3 : 8,
  );

  return {
    focus,
    maxIterations,
    paths: parseRequestedPaths(
      ROOT_DIR,
      rawPaths ?? process.env.ORIGIN_IMPLEMENT_PATHS,
    ),
    scope,
    smoke,
    smokeScenario,
    stage,
  };
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function extractOutputRow<T extends Record<string, unknown>>(
  result: { output?: unknown; status: string },
  nodeId: string,
): T {
  if (result.status !== "finished") {
    throw new Error(
      `Workflow step ${nodeId} did not finish successfully.`,
    );
  }

  const outputRows = Array.isArray(result.output) ? result.output : [];
  const row = outputRows.find(
    (entry) => isRecord(entry) && entry.nodeId === nodeId,
  );
  if (!isRecord(row)) {
    throw new Error(
      `Workflow step ${nodeId} did not produce an output row.`,
    );
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
): { implement?: ImplementOutput; mode: string } {
  const row = dbClient
    .query(
      "select mode, implement from step where run_id = ? and node_id = ? order by iteration desc limit 1",
    )
    .get(runId, "step-output");

  if (!row) {
    throw new Error(
      `Workflow step step-output did not produce a database row for ${runId}.`,
    );
  }

  return {
    implement:
      typeof row.implement === "string"
        ? (JSON.parse(row.implement) as ImplementOutput)
        : undefined,
    mode: String(row.mode ?? ""),
  };
}

function setEnv(
  name: string,
  value: string | undefined,
): string | undefined {
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

function stageWorkflowImportEntry(
  workspaceRoot: string,
  tempDir: string,
): string {
  const importRoot = join(
    tempDir,
    "implement-runtime",
    randomUUID(),
  );
  cpSync(
    join(workspaceRoot, "workflow"),
    join(importRoot, "workflow"),
    { recursive: true },
  );
  return resolveWorkflowEntry(importRoot);
}

async function runWorkflowStepWithRetry(options: {
  buildRunId: (attempt: number) => string;
  label: string;
  maxAttempts: number;
  runWorkflow: WorkflowRunner;
  runtime: LoadedWorkflowRuntime;
  stepInput: Record<string, unknown>;
}): Promise<{ result: { output?: unknown; status: string }; runId: string }> {
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
        `${options.label} attempt ${attempt} finished with status ${result.status}.`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < options.maxAttempts) {
      await sleep(attempt * 1_000);
    }
  }

  throw new Error(
    `${options.label} did not finish successfully after ${options.maxAttempts} attempts.${lastError ? ` Last error: ${lastError.message}` : ""}`,
  );
}

async function loadWorkflowRuntime(
  workspaceRoot: string,
  tempDir: string,
): Promise<LoadedWorkflowRuntime> {
  const workflowPath = resolveWorkflowEntry(workspaceRoot);
  const importPath = stageWorkflowImportEntry(workspaceRoot, tempDir);
  const workflowModule = (await import(
    `${pathToFileURL(importPath).href}?origin-implement-run=${randomUUID()}`
  )) as {
    db?: { $client?: StepDbClient };
    default?: unknown;
  };

  if (workflowModule.default === undefined) {
    throw new Error(
      `Workflow module ${importPath} did not export a default workflow.`,
    );
  }

  const dbClient = workflowModule.db?.$client;
  if (!dbClient) {
    throw new Error(
      `Workflow module ${importPath} did not expose a database client.`,
    );
  }

  return {
    close: () => dbClient.close?.(),
    dbClient,
    rootDir: workspaceRoot,
    workflow: workflowModule.default as WorkflowDefinition,
    workflowPath,
  };
}

function runTestsInWorkspace(
  workspaceRoot: string,
): { pass: number; fail: number; output: string } {
  try {
    const output = execSync("bun test 2>&1", {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const passMatch = output.match(/(\d+) pass/);
    const failMatch = output.match(/(\d+) fail/);

    return {
      pass: passMatch ? Number.parseInt(passMatch[1]!, 10) : 0,
      fail: failMatch ? Number.parseInt(failMatch[1]!, 10) : 0,
      output,
    };
  } catch (error) {
    const err = error as Error & { stdout?: string };
    const output = err.stdout ?? err.message ?? "";

    const passMatch = output.match(/(\d+) pass/);
    const failMatch = output.match(/(\d+) fail/);

    return {
      pass: passMatch ? Number.parseInt(passMatch[1]!, 10) : 0,
      fail: failMatch ? Number.parseInt(failMatch[1]!, 10) : 1,
      output,
    };
  }
}

export async function runImplementLoop(
  options: CliOptions,
  deps: {
    repoRoot?: string;
    runWorkflow?: WorkflowRunner;
  } = {},
): Promise<LoopResult> {
  const repoRoot = deps.repoRoot ?? ROOT_DIR;
  const tempDir = mkdtempSync(
    join(
      tmpdir(),
      options.smoke
        ? "origin-implement-smoke-"
        : "origin-implement-run-",
    ),
  );
  const workspaceRoot = join(tempDir, "repo");
  const dbPath = options.smoke
    ? ":memory:"
    : join(tempDir, "origin-implement.db");

  const stepMaxAttempts = options.smoke
    ? 1
    : parsePositiveInt(
        process.env.ORIGIN_IMPLEMENT_STEP_MAX_ATTEMPTS,
        3,
      );

  const previousEnv = {
    dbPath: setEnv("ORIGIN_IMPLEMENT_WORKFLOW_DB", dbPath),
    smoke: setEnv(
      "ORIGIN_IMPLEMENT_SMOKE",
      options.smoke ? "1" : undefined,
    ),
    smithersLogDir: setEnv(
      "SMITHERS_LOG_DIR",
      join(tempDir, ".smithers"),
    ),
    workspaceRoot: setEnv(
      "ORIGIN_IMPLEMENT_WORKSPACE_ROOT",
      workspaceRoot,
    ),
  };

  const loadedWorkflowRuntimes: LoadedWorkflowRuntime[] = [];
  const episodes: ImplementOutput[] = [];
  let allChangedFiles: string[] = [];

  try {
    copyRepoWorkspace(repoRoot, workspaceRoot);
    const baselineSnapshot =
      captureWorkspaceSnapshot(workspaceRoot);
    const runWorkflow =
      deps.runWorkflow ??
      (await import("smithers-orchestrator")).runWorkflow;

    for (
      let iteration = 0;
      iteration < options.maxIterations;
      iteration += 1
    ) {
      const runtime = await loadWorkflowRuntime(
        workspaceRoot,
        tempDir,
      );
      loadedWorkflowRuntimes.push(runtime);

      const stepResult = await runWorkflowStepWithRetry({
        buildRunId: (attempt) =>
          `${options.smoke ? "origin-implement-smoke" : "origin-implement"}-iter-${iteration}-attempt-${attempt}-${randomUUID()}`,
        label: `Implement iteration ${iteration}`,
        maxAttempts: stepMaxAttempts,
        runWorkflow,
        runtime,
        stepInput: {
          focus: options.focus,
          iteration,
          mode: "implement",
          paths: options.paths,
          previousEpisodes: episodes,
          scope: options.scope ?? "",
          smokeScenario: options.smokeScenario,
          stage: options.stage,
        },
      });

      const stepOutput = readStepRowFromDb(
        runtime.dbClient,
        stepResult.runId,
      );
      const implementResult = stepOutput.implement;

      if (!implementResult) {
        throw new Error(
          `Implement iteration ${iteration} completed without an output payload.`,
        );
      }

      episodes.push(implementResult);

      if (!options.smoke) {
        const nextSnapshot =
          captureWorkspaceSnapshot(workspaceRoot);
        const iterationChanged = syncWorkspaceChanges({
          baselineSnapshot,
          scopePaths: options.paths,
          sourceRoot: workspaceRoot,
          targetRoot: repoRoot,
        });
        allChangedFiles = [
          ...new Set([...allChangedFiles, ...iterationChanged]),
        ];

        const testResult = runTestsInWorkspace(workspaceRoot);
        implementResult.testsPassing = testResult.pass;
        implementResult.testsFailing = testResult.fail;
      }

      if (implementResult.status === "BLOCKED") {
        return {
          changedFiles: allChangedFiles,
          episodes,
          finalStatus: "BLOCKED",
          finalSummary: implementResult.summary,
          humanDecisionsNeeded: implementResult.unresolvedIssues,
          iterations: iteration + 1,
        };
      }

      if (implementResult.status === "DONE") {
        return {
          changedFiles: allChangedFiles,
          episodes,
          finalStatus: "DONE",
          finalSummary: implementResult.summary,
          humanDecisionsNeeded: [],
          iterations: iteration + 1,
        };
      }
    }

    const lastEpisode = episodes[episodes.length - 1];
    return {
      changedFiles: allChangedFiles,
      episodes,
      finalStatus: "PARTIAL",
      finalSummary:
        lastEpisode?.summary ??
        "Implementation loop reached the configured iteration cap.",
      humanDecisionsNeeded: [],
      iterations: options.maxIterations,
    };
  } finally {
    for (const runtime of loadedWorkflowRuntimes) {
      runtime.close();
    }
    setEnv("ORIGIN_IMPLEMENT_WORKFLOW_DB", previousEnv.dbPath);
    setEnv("ORIGIN_IMPLEMENT_SMOKE", previousEnv.smoke);
    setEnv("SMITHERS_LOG_DIR", previousEnv.smithersLogDir);
    setEnv(
      "ORIGIN_IMPLEMENT_WORKSPACE_ROOT",
      previousEnv.workspaceRoot,
    );

    rmSync(tempDir, { force: true, recursive: true });
  }
}

export async function main(
  argv = process.argv.slice(2),
): Promise<number> {
  try {
    const options = parseCliOptions(argv);
    const mode = [
      "Running implementation workflow",
      options.smoke ? "in smoke mode" : "",
      `stage: ${options.stage}`,
      options.scope ? `scope: ${options.scope}` : "",
      options.paths.length > 0
        ? `paths: ${options.paths.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    console.log(mode);

    const result = await runImplementLoop(options);
    console.log(JSON.stringify(result, null, 2));

    if (result.finalStatus === "BLOCKED") {
      console.error(
        `Blocked: ${result.humanDecisionsNeeded.join(" | ")}`,
      );
      return 1;
    }

    if (result.finalStatus === "PARTIAL") {
      console.error(
        `Partial: loop finished without completing scope.`,
      );
      return 1;
    }

    return 0;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
