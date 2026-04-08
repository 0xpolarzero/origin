import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseRequestedPaths } from "./paths";
import { readImplementInput, resolveRepoRoot } from "./implement-helpers";
import { buildImplementPrompt } from "./implement-prompts";
import { implementSchema } from "./smithers-implement";
import { parseCliOptions } from "./run-implement";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

let tempDir: string | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "origin-implement-test-"));
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

describe("implement schema validation", () => {
  test("DONE requires zero failing tests", () => {
    const parsed = implementSchema.safeParse({
      stage: "implementation",
      scope: "planning",
      summary: "All done",
      filesChanged: ["a.ts"],
      testsAdded: [],
      testsPassing: 10,
      testsFailing: 1,
      featuresCovered: ["app.planning.tasks"],
      featuresRemaining: [],
      unresolvedIssues: [],
      status: "DONE",
    });

    expect(parsed.success).toBe(false);
  });

  test("DONE requires zero remaining features", () => {
    const parsed = implementSchema.safeParse({
      stage: "implementation",
      scope: "planning",
      summary: "Mostly done",
      filesChanged: ["a.ts"],
      testsAdded: [],
      testsPassing: 10,
      testsFailing: 0,
      featuresCovered: ["app.planning.tasks"],
      featuresRemaining: ["app.planning.calendar-items"],
      unresolvedIssues: [],
      status: "DONE",
    });

    expect(parsed.success).toBe(false);
  });

  test("BLOCKED requires unresolved issues", () => {
    const parsed = implementSchema.safeParse({
      stage: "implementation",
      scope: "planning",
      summary: "Blocked",
      filesChanged: [],
      testsAdded: [],
      testsPassing: 0,
      testsFailing: 0,
      featuresCovered: [],
      featuresRemaining: ["app.planning.tasks"],
      unresolvedIssues: [],
      status: "BLOCKED",
    });

    expect(parsed.success).toBe(false);
  });

  test("PARTIAL requires at least one file changed or test added", () => {
    const parsed = implementSchema.safeParse({
      stage: "implementation",
      scope: "planning",
      summary: "Partial",
      filesChanged: [],
      testsAdded: [],
      testsPassing: 5,
      testsFailing: 1,
      featuresCovered: [],
      featuresRemaining: ["app.planning.tasks"],
      unresolvedIssues: [],
      status: "PARTIAL",
    });

    expect(parsed.success).toBe(false);
  });

  test("valid DONE passes", () => {
    const parsed = implementSchema.safeParse({
      stage: "implementation",
      scope: "planning",
      summary: "All done",
      filesChanged: ["a.ts"],
      testsAdded: ["a.test.ts"],
      testsPassing: 10,
      testsFailing: 0,
      featuresCovered: ["app.planning.tasks"],
      featuresRemaining: [],
      unresolvedIssues: [],
      status: "DONE",
    });

    expect(parsed.success).toBe(true);
  });

  test("valid PARTIAL passes", () => {
    const parsed = implementSchema.safeParse({
      stage: "tests",
      scope: "email",
      summary: "Added some tests",
      filesChanged: ["email.test.ts"],
      testsAdded: ["email.test.ts"],
      testsPassing: 5,
      testsFailing: 2,
      featuresCovered: ["app.email.agent-inbox"],
      featuresRemaining: ["app.email.forwarded-intake"],
      unresolvedIssues: [],
      status: "PARTIAL",
    });

    expect(parsed.success).toBe(true);
  });

  test("valid BLOCKED passes", () => {
    const parsed = implementSchema.safeParse({
      stage: "implementation",
      scope: "planning",
      summary: "Missing dependency",
      filesChanged: ["a.ts"],
      testsAdded: [],
      testsPassing: 0,
      testsFailing: 0,
      featuresCovered: [],
      featuresRemaining: ["app.planning.tasks"],
      unresolvedIssues: ["Automerge not yet integrated"],
      status: "BLOCKED",
    });

    expect(parsed.success).toBe(true);
  });
});

describe("implement helpers", () => {
  test("resolveRepoRoot prefers the workspace env var", () => {
    expect(resolveRepoRoot("/tmp/origin-workspace")).toBe(
      "/tmp/origin-workspace",
    );
  });

  test("readImplementInput defaults to implementation stage", () => {
    const input = readImplementInput({}, rootDir);
    expect(input.stage).toBe("implementation");
  });

  test("readImplementInput respects stage override", () => {
    const input = readImplementInput({ stage: "tests" }, rootDir);
    expect(input.stage).toBe("tests");
  });

  test("readImplementInput filters invalid previous episodes", () => {
    const input = readImplementInput(
      {
        previousEpisodes: [
          {
            stage: "implementation",
            scope: "planning",
            summary: "Valid",
            filesChanged: [],
            testsAdded: [],
            testsPassing: 1,
            testsFailing: 0,
            featuresCovered: [],
            featuresRemaining: [],
            unresolvedIssues: [],
            status: "DONE",
          },
          { invalid: true },
        ],
      },
      rootDir,
    );
    expect(input.previousEpisodes.length).toBe(1);
    expect(input.previousEpisodes[0]!.summary).toBe("Valid");
  });
});

describe("implement prompts", () => {
  test("includes stage information", () => {
    const prompt = buildImplementPrompt(
      readImplementInput({ stage: "tests", scope: "email" }, rootDir),
    );
    expect(prompt).toContain("Stage: tests");
    expect(prompt).toContain("Scope: email");
  });

  test("reports no prior episodes when none provided", () => {
    const prompt = buildImplementPrompt(
      readImplementInput({}, rootDir),
    );
    expect(prompt).toContain(
      "No prior implementation episodes for this run.",
    );
  });

  test("includes episode history", () => {
    const prompt = buildImplementPrompt(
      readImplementInput(
        {
          previousEpisodes: [
            {
              stage: "implementation",
              scope: "planning",
              summary: "Added task CRUD",
              filesChanged: ["handlers.ts"],
              testsAdded: [],
              testsPassing: 10,
              testsFailing: 0,
              featuresCovered: ["app.planning.tasks"],
              featuresRemaining: [],
              unresolvedIssues: [],
              status: "DONE",
            },
          ],
        },
        rootDir,
      ),
    );
    expect(prompt).toContain("Added task CRUD");
    expect(prompt).toContain("Episode 1");
  });

  test("includes AGENTS.md rules", () => {
    const prompt = buildImplementPrompt(
      readImplementInput({}, rootDir),
    );
    expect(prompt).toContain("docs → tests → implementation");
    expect(prompt).toContain("docs/features.ts");
  });
});

describe("CLI option parsing", () => {
  test("defaults to implementation stage", () => {
    const options = parseCliOptions([]);
    expect(options.stage).toBe("implementation");
  });

  test("parses stage flag", () => {
    const options = parseCliOptions(["--stage", "tests"]);
    expect(options.stage).toBe("tests");
  });

  test("rejects invalid stage", () => {
    expect(() => parseCliOptions(["--stage", "invalid"])).toThrow(
      "--stage must be docs, tests, or implementation",
    );
  });

  test("parses scope flag", () => {
    const options = parseCliOptions(["--scope", "planning"]);
    expect(options.scope).toBe("planning");
  });

  test("parses focus flag", () => {
    const options = parseCliOptions(["--focus", "cover edge cases"]);
    expect(options.focus).toBe("cover edge cases");
  });

  test("parses smoke flag", () => {
    const options = parseCliOptions(["--smoke"]);
    expect(options.smoke).toBe(true);
  });
});
