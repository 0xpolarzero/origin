import { ClaudeCodeAgent } from "smithers-orchestrator";
import { createImplementSmithers } from "./smithers-implement";
import { buildImplementPrompt } from "./implement-prompts";
import { readImplementInput, resolveRepoRoot } from "./implement-helpers";

const SMOKE_MODE = process.env.ORIGIN_IMPLEMENT_SMOKE === "1";
const REPO_ROOT = resolveRepoRoot();
const IMPLEMENT_MODEL =
  process.env.ORIGIN_IMPLEMENT_MODEL ?? "glm-5.1";

const IMPLEMENT_SYSTEM_PROMPT = `You are implementing features for the Origin personal life-management agent.

Follow AGENTS.md strictly:
1. Build order: docs → tests → implementation
2. docs/features.ts is the canonical feature list
3. docs/references/ contains library references for core dependencies
4. Strengthen the test suite as you go

Make the smallest correct set of changes.
Keep the repo coherent.
Run validation before claiming the work is done.
Do not leave partial implementations behind.
Do not run git commands.
Return structured JSON output matching the implement schema.`;

type SmokeAgent = {
  id: string;
  tools: Record<string, unknown>;
  generate: (args: { prompt: string }) => Promise<{ output: unknown }>;
};

function createSmokeAgent(): SmokeAgent {
  return {
    id: "smoke-claude-code",
    tools: {},
    async generate(args: { prompt: string }) {
      const scenarioMatch = args.prompt.match(/Smoke scenario:\s*(.+)/);
      const scenario = scenarioMatch?.[1]?.trim() ?? "default";

      if (scenario === "blocked") {
        return {
          output: {
            stage: "implementation",
            scope: "planning",
            summary: "Smoke implement blocked by missing dependency.",
            filesChanged: [],
            testsAdded: [],
            testsPassing: 0,
            testsFailing: 0,
            featuresCovered: [],
            featuresRemaining: ["app.planning.tasks"],
            unresolvedIssues: ["Missing Automerge dependency."],
            status: "BLOCKED",
          },
        };
      }

      return {
        output: {
          stage: "implementation",
          scope: "planning",
          summary: "Smoke implement pass completed successfully.",
          filesChanged: ["apps/server/src/handlers/planning-email-github-telegram.ts"],
          testsAdded: [],
          testsPassing: 42,
          testsFailing: 0,
          featuresCovered: ["app.planning.tasks"],
          featuresRemaining: [],
          unresolvedIssues: [],
          status: scenario === "partial" ? "PARTIAL" : "DONE",
        },
      };
    },
  };
}

const implementAgent = SMOKE_MODE
  ? createSmokeAgent()
  : new ClaudeCodeAgent({
      model: IMPLEMENT_MODEL,
      cwd: REPO_ROOT,
      timeoutMs: 60 * 60 * 1000,
      maxOutputBytes: 4_000_000,
      yolo: true,
      systemPrompt: IMPLEMENT_SYSTEM_PROMPT,
    });

const { Workflow, Task, smithers, outputs, db } =
  createImplementSmithers();

export default smithers((ctx) => {
  const input = readImplementInput(ctx.input, REPO_ROOT);

  return (
    <Workflow name="origin-implement-step" cache={false}>
      <Task
        id="implement"
        output={outputs.implement}
        agent={implementAgent}
        timeoutMs={60 * 60 * 1000}
        heartbeatTimeoutMs={60 * 60 * 1000}
      >
        {buildImplementPrompt(input)}
      </Task>
      <Task id="step-output" output={outputs.step}>
        {() => ({
          mode: "implement" as const,
          implement: ctx.latest("implement", "implement"),
        })}
      </Task>
    </Workflow>
  );
});

export { db };
