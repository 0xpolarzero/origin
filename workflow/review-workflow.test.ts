import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseRequestedPaths } from "./paths";
import { readInput, resolveRepoRoot, smokeLocationToFilePath } from "./review-helpers";
import { buildReviewPrompt } from "./review-prompts";
import { addressSchema } from "./smithers";
import { captureWorkspaceSnapshot, copyRepoWorkspace, syncWorkspaceChanges } from "./workspace";
import { main, parseCliOptions, provisionIsolatedCodexHome, runReviewLoop } from "./run-review";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const HARNESS_STATE_KEY = "__originReviewHarnessState";
const STEP_OUTPUT_NODE_ID = "step-output";

type HarnessRow = Record<string, unknown>;
type HarnessWorkflow = {
  label: string;
  runtimeId: string;
};
type HarnessQuery = {
  label: string;
  nodeId: string;
  runId: string;
  runtimeId: string;
};
type HarnessState = {
  queries: HarnessQuery[];
  rows: Map<string, HarnessRow>;
};

let tempDir: string | null = null;

function getHarnessState(): HarnessState {
  const globalState = globalThis as typeof globalThis & {
    [HARNESS_STATE_KEY]?: HarnessState;
  };

  globalState[HARNESS_STATE_KEY] ??= {
    queries: [],
    rows: new Map<string, HarnessRow>(),
  };

  return globalState[HARNESS_STATE_KEY];
}

function resetHarnessState(): void {
  const globalState = globalThis as typeof globalThis & {
    [HARNESS_STATE_KEY]?: HarnessState;
  };

  delete globalState[HARNESS_STATE_KEY];
}

function buildHarnessRowKey(runtimeId: string, runId: string, nodeId: string): string {
  return `${runtimeId}:${runId}:${nodeId}`;
}

function toHarnessWorkflow(workflow: unknown): HarnessWorkflow {
  return workflow as unknown as HarnessWorkflow;
}

function getHarnessQueries(): HarnessQuery[] {
  return getHarnessState().queries;
}

function setHarnessRow(workflow: HarnessWorkflow, runId: string, nodeId: string, row: HarnessRow): void {
  getHarnessState().rows.set(buildHarnessRowKey(workflow.runtimeId, runId, nodeId), row);
}

function readImportLog(logPath: string): string[] {
  return existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter((entry) => entry.length > 0)
    : [];
}

function buildHarnessWorkflowModule(logPath: string, label: string): string {
  return `
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const globalState = globalThis as Record<
  string,
  | {
      queries: Array<{ label: string; nodeId: string; runId: string; runtimeId: string }>;
      rows: Map<string, Record<string, unknown>>;
    }
  | undefined
>;
const state = (globalState[${JSON.stringify(HARNESS_STATE_KEY)}] ??= {
  queries: [],
  rows: new Map<string, Record<string, unknown>>(),
});
const runtimeId = randomUUID();

appendFileSync(${JSON.stringify(logPath)}, ${JSON.stringify(`${label}\n`)});

export default { label: ${JSON.stringify(label)}, runtimeId };
export const db = {
  $client: {
    close() {},
    query() {
      return {
        get(runId: string, nodeId: string) {
          state.queries.push({ label: ${JSON.stringify(label)}, nodeId, runId, runtimeId });
          return state.rows.get(\`\${runtimeId}:\${runId}:\${nodeId}\`) ?? null;
        },
      };
    },
  },
};
`;
}

function createHarnessRepo(repoRoot: string, logPath: string): void {
  mkdirSync(join(repoRoot, "workflow"), { recursive: true });
  writeFileSync(join(repoRoot, "README.md"), "before\n");
  writeFileSync(
    join(repoRoot, "workflow/review-workflow.tsx"),
    buildHarnessWorkflowModule(logPath, "initial"),
  );
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "origin-review-test-"));
});

afterEach(() => {
  resetHarnessState();
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

describe("paths", () => {
  test("parseRequestedPaths rejects an explicitly empty path list", () => {
    expect(() => parseRequestedPaths(rootDir, ",")).toThrow(
      "Scoped review path list cannot be empty.",
    );
  });

  test("parseRequestedPaths rejects a path outside the repository", () => {
    expect(() => parseRequestedPaths(rootDir, "../outside")).toThrow(
      "Scoped review path resolves outside the repository",
    );
  });
});

describe("smoke helpers", () => {
  test("resolveRepoRoot prefers the workspace env var", () => {
    expect(resolveRepoRoot("/tmp/origin-workspace")).toBe("/tmp/origin-workspace");
  });

  test("readInput normalizes scoped paths", () => {
    const input = readInput(
      {
        mode: "review",
        paths: ["README.md"],
        reviewRound: 0,
      },
      rootDir,
    );

    expect(input.paths).toEqual(["README.md"]);
  });

  test("fresh review prompts report that validation has not run", () => {
    const prompt = buildReviewPrompt(
      readInput(
        {
          mode: "review",
          reviewRound: 0,
        },
        rootDir,
      ),
    );

    expect(prompt).toContain("Validation run: none reported.");
    expect(prompt).toContain("No prior address pass has been recorded for this run.");
  });

  test("smokeLocationToFilePath preserves Windows drive letters", () => {
    expect(smokeLocationToFilePath("C:\\repo\\file.ts:12")).toBe("C:\\repo\\file.ts");
  });

  test("address schema rejects ready output without validation", () => {
    const parsed = addressSchema.safeParse({
      filesChanged: [],
      humanDecisionsNeeded: [],
      status: "READY_FOR_REVIEW",
      summary: "No validation",
      validationRan: [],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("workspace sync", () => {
  test("copyRepoWorkspace recreates package-local node_modules symlinks", () => {
    const sourceRoot = join(tempDir!, "source");
    const workspaceRoot = join(tempDir!, "workspace");
    mkdirSync(join(sourceRoot, "node_modules"), { recursive: true });
    mkdirSync(join(sourceRoot, "apps/server/node_modules"), { recursive: true });
    mkdirSync(join(sourceRoot, "workflow/node_modules"), { recursive: true });
    writeFileSync(join(sourceRoot, "package.json"), "{}\n");
    writeFileSync(join(sourceRoot, "apps/server/package.json"), "{}\n");
    writeFileSync(join(sourceRoot, "workflow/package.json"), "{}\n");

    copyRepoWorkspace(sourceRoot, workspaceRoot);

    expect(lstatSync(join(workspaceRoot, "node_modules")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(workspaceRoot, "apps/server/node_modules")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(workspaceRoot, "workflow/node_modules")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(workspaceRoot, "workflow/node_modules"))).toBe(
      join(sourceRoot, "workflow/node_modules"),
    );
  });

  test("syncWorkspaceChanges copies modified files back to the root snapshot", () => {
    const sourceRoot = join(tempDir!, "source");
    const workspaceRoot = join(tempDir!, "workspace");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "README.md"), "before\n");

    copyRepoWorkspace(sourceRoot, workspaceRoot);
    const baseline = captureWorkspaceSnapshot(workspaceRoot);

    writeFileSync(join(workspaceRoot, "README.md"), "after\n");

    const changedFiles = syncWorkspaceChanges({
      baselineSnapshot: baseline,
      scopePaths: [],
      sourceRoot: workspaceRoot,
      targetRoot: sourceRoot,
    });

    expect(changedFiles).toEqual(["README.md"]);
  });

  test("syncWorkspaceChanges ignores smithers execution artifacts", () => {
    const sourceRoot = join(tempDir!, "source");
    const workspaceRoot = join(tempDir!, "workspace");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "README.md"), "before\n");

    copyRepoWorkspace(sourceRoot, workspaceRoot);
    const baseline = captureWorkspaceSnapshot(workspaceRoot);

    mkdirSync(join(workspaceRoot, ".smithers/executions/run-1/logs"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".smithers/executions/run-1/logs/stream.ndjson"),
      '{"event":"log"}\n',
    );

    const changedFiles = syncWorkspaceChanges({
      baselineSnapshot: baseline,
      scopePaths: [],
      sourceRoot: workspaceRoot,
      targetRoot: sourceRoot,
    });

    expect(changedFiles).toEqual([]);
    expect(existsSync(join(sourceRoot, ".smithers"))).toBe(false);
  });
});

describe("runner", () => {
  test("parseCliOptions rejects missing values for supported flags", () => {
    for (const flag of ["--focus", "--paths", "--instructions", "--smoke-scenario"]) {
      expect(() => parseCliOptions([flag], rootDir)).toThrow(`Missing value for ${flag}.`);
      expect(() => parseCliOptions([flag, "--smoke"], rootDir)).toThrow(
        `Missing value for ${flag}.`,
      );
    }
  });

  test("parseCliOptions preserves provided scoped values", () => {
    const options = parseCliOptions(
      [
        "--focus",
        "cli",
        "--paths",
        "README.md",
        "--instructions",
        "extra",
        "--smoke-scenario",
        "default",
      ],
      rootDir,
    );

    expect(options.focus).toBe("cli");
    expect(options.paths).toEqual(["README.md"]);
    expect(options.instructions).toBe("extra");
    expect(options.smokeScenario).toBe("default");
  });

  test("provisionIsolatedCodexHome copies auth bootstrap files without sqlite state", () => {
    const sourceHome = join(tempDir!, "codex-home-source");
    const isolatedRoot = join(tempDir!, "isolated-home-root");
    mkdirSync(sourceHome, { recursive: true });
    writeFileSync(join(sourceHome, "auth.json"), '{"auth_mode":"api_key"}\n');
    writeFileSync(join(sourceHome, "config.toml"), 'model = "gpt-5.4"\n');
    writeFileSync(join(sourceHome, "state_5.sqlite"), "broken state\n");

    const isolatedHome = provisionIsolatedCodexHome(isolatedRoot, sourceHome);

    expect(readFileSync(join(isolatedHome, "auth.json"), "utf8")).toContain("auth_mode");
    expect(readFileSync(join(isolatedHome, "config.toml"), "utf8")).toContain("gpt-5.4");
    expect(existsSync(join(isolatedHome, "state_5.sqlite"))).toBe(false);
  });

  test("server CLI contract imports cleanly", async () => {
    const module = await import(
      `${new URL("../apps/server/src/cli/contract.ts", import.meta.url).href}?test=${Date.now()}`
    );

    expect(module.origin).toBeDefined();
  });

  test("origin wrapper resolves the copied workspace checkout", () => {
    const workspaceRoot = join(tempDir!, "workspace");

    copyRepoWorkspace(rootDir, workspaceRoot);
    writeFileSync(
      join(workspaceRoot, "apps/server/src/lib/version.ts"),
      "export const ORIGIN_RUNTIME_VERSION = '9.9.9-wrapper-test'\n",
    );

    const result = Bun.spawnSync({
      cmd: ["sh", join(workspaceRoot, "apps/server/bin/origin"), "--version"],
      cwd: workspaceRoot,
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout).trim()).toContain("9.9.9-wrapper-test");
  });

  test("runReviewLoop smoke mode converges to LGTM", async () => {
    const result = await runReviewLoop({
      maxIterations: 3,
      paths: [],
      smoke: true,
    });

    expect(result.finalVerdict).toBe("LGTM");
    expect(result.reviewIterations).toBe(2);
    expect(result.changedFiles).toEqual(["README.md"]);
  });

  test("runReviewLoop returns unresolved human decisions", async () => {
    const result = await runReviewLoop({
      maxIterations: 3,
      paths: [],
      smoke: true,
      smokeScenario: "needs-human-decision",
    });

    expect(result.finalVerdict).toBe("CHANGES_REQUIRED");
    expect(result.humanDecisionsNeeded.length).toBeGreaterThan(0);
  });

  test("runReviewLoop non-smoke reloads the copied workspace workflow and syncs scoped changes", async () => {
    const repoRoot = join(tempDir!, "harness-repo");
    const importLogPath = join(tempDir!, "workflow-imports.log");
    const codexHome = join(tempDir!, "codex-home");
    const scopedPaths = ["README.md", "workflow/review-workflow.tsx"];
    const expectedStepOutputQueries: HarnessQuery[] = [];

    mkdirSync(codexHome, { recursive: true });
    createHarnessRepo(repoRoot, importLogPath);

    const result = await runReviewLoop(
      {
        maxIterations: 3,
        paths: scopedPaths,
        smoke: false,
      },
      {
        provisionIsolatedCodexHome: () => codexHome,
        repoRoot,
        runWorkflow: async (_workflow, options) => {
          const workflow = toHarnessWorkflow(_workflow);
          const input = options.input as { mode: "review" | "address"; reviewRound: number };

          expect(options.rootDir).not.toBe(repoRoot);
          expect(options.workflowPath).toBe(join(options.rootDir, "workflow/review-workflow.tsx"));

          if (input.mode === "review") {
            const latestImport = readImportLog(importLogPath).at(-1);
            const hasUpdatedWorkflow = latestImport === "updated";

            expectedStepOutputQueries.push({
              label: workflow.label,
              nodeId: STEP_OUTPUT_NODE_ID,
              runId: options.runId,
              runtimeId: workflow.runtimeId,
            });
            setHarnessRow(workflow, options.runId, STEP_OUTPUT_NODE_ID, {
              mode: "review",
              review: JSON.stringify(
                input.reviewRound === 0
                  ? {
                      verdict: "CHANGES_REQUIRED",
                      findings: [
                        {
                          severity: "medium",
                          location: "workflow/review-workflow.tsx:1",
                          problem: "Initial harness workflow should be updated in the workspace.",
                          requiredAction:
                            "Rewrite the copied workflow module before the next review.",
                        },
                      ],
                      blockers: [],
                      residualRisks: [],
                    }
                  : {
                      verdict: hasUpdatedWorkflow ? "LGTM" : "CHANGES_REQUIRED",
                      findings: hasUpdatedWorkflow
                        ? []
                        : [
                            {
                              severity: "high",
                              location: "workflow/review-workflow.tsx:1",
                              problem:
                                "The next review round did not reload the workspace workflow.",
                              requiredAction:
                                "Reload the workflow module from the copied workspace.",
                            },
                          ],
                      blockers: [],
                      residualRisks: [],
                    },
              ),
            });

            return { status: "finished" };
          }

          writeFileSync(join(options.rootDir, "README.md"), "after\n");
          writeFileSync(options.workflowPath, buildHarnessWorkflowModule(importLogPath, "updated"));

          expectedStepOutputQueries.push({
            label: workflow.label,
            nodeId: STEP_OUTPUT_NODE_ID,
            runId: options.runId,
            runtimeId: workflow.runtimeId,
          });
          setHarnessRow(workflow, options.runId, STEP_OUTPUT_NODE_ID, {
            mode: "address",
            address: JSON.stringify({
              status: "READY_FOR_REVIEW",
              summary: "Updated the copied workspace workflow and README.",
              filesChanged: scopedPaths,
              validationRan: ["bun test workflow/review-workflow.test.ts"],
              humanDecisionsNeeded: [],
            }),
          });

          return { status: "finished" };
        },
      },
    );

    expect(result.finalVerdict).toBe("LGTM");
    expect(result.reviewIterations).toBe(2);
    expect(result.changedFiles).toEqual(scopedPaths);
    expect(getHarnessQueries()).toEqual(expectedStepOutputQueries);
    expect(getHarnessQueries().at(-1)?.label).toBe("updated");
    expect(readImportLog(importLogPath)).toEqual(["initial", "updated"]);
    expect(readFileSync(join(repoRoot, "README.md"), "utf8")).toBe("after\n");
    expect(readFileSync(join(repoRoot, "workflow/review-workflow.tsx"), "utf8")).toContain(
      '"updated"',
    );
  });

  test("runReviewLoop non-smoke enforces scoped paths when syncing workspace changes", async () => {
    const repoRoot = join(tempDir!, "scoped-harness-repo");
    const importLogPath = join(tempDir!, "scoped-workflow-imports.log");
    const codexHome = join(tempDir!, "scoped-codex-home");

    mkdirSync(codexHome, { recursive: true });
    createHarnessRepo(repoRoot, importLogPath);

    await expect(
      runReviewLoop(
        {
          maxIterations: 3,
          paths: ["README.md"],
          smoke: false,
        },
        {
          provisionIsolatedCodexHome: () => codexHome,
          repoRoot,
          runWorkflow: async (_workflow, options) => {
            const workflow = toHarnessWorkflow(_workflow);
            const input = options.input as { mode: "review" | "address"; reviewRound: number };

            if (input.mode === "review") {
              setHarnessRow(workflow, options.runId, STEP_OUTPUT_NODE_ID, {
                mode: "review",
                review: JSON.stringify(
                  input.reviewRound === 0
                    ? {
                        verdict: "CHANGES_REQUIRED",
                        findings: [
                          {
                            severity: "medium",
                            location: "README.md:1",
                            problem: "README still needs the scoped harness change.",
                            requiredAction: "Update the in-scope file only.",
                          },
                        ],
                        blockers: [],
                        residualRisks: [],
                      }
                    : {
                        verdict: "LGTM",
                        findings: [],
                        blockers: [],
                        residualRisks: [],
                      },
                ),
              });

              return { status: "finished" };
            }

            writeFileSync(join(options.rootDir, "README.md"), "after\n");
            writeFileSync(join(options.rootDir, "NOTES.md"), "out of scope\n");

            setHarnessRow(workflow, options.runId, STEP_OUTPUT_NODE_ID, {
              mode: "address",
              address: JSON.stringify({
                status: "READY_FOR_REVIEW",
                summary: "Applied the README change.",
                filesChanged: ["README.md", "NOTES.md"],
                validationRan: ["bun test workflow/review-workflow.test.ts"],
                humanDecisionsNeeded: [],
              }),
            });

            return { status: "finished" };
          },
        },
      ),
    ).rejects.toThrow("Address pass changed files outside the requested scope: NOTES.md");
  });

  test("main returns non-zero for unresolved human decisions", async () => {
    const exitCode = await main(["--smoke", "--smoke-scenario", "needs-human-decision"]);
    expect(exitCode).toBe(1);
  });

  test("main returns zero for a passing smoke run", async () => {
    const exitCode = await main(["--smoke"]);
    expect(exitCode).toBe(0);
  });
});
