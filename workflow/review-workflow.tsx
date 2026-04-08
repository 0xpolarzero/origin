import { CodexAgent } from "smithers-orchestrator";
import { addressSchema, createReviewSmithers, reviewSchema } from "./smithers";
import { buildAddressPrompt, buildReviewPrompt } from "./review-prompts";
import {
  readInput,
  resolveRepoRoot,
  smokeLocationToFilePath,
} from "./review-helpers";

const { Workflow, Task, smithers, outputs, db } = createReviewSmithers();

function readPromptField(prompt: string, label: string): string | undefined {
  const match = prompt.match(new RegExp(`${label}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function createSmokeAgent(kind: "review" | "address") {
  return {
    id: `smoke-${kind}`,
    tools: {},
    async generate(args: { prompt: string }) {
      const scenario = readPromptField(args.prompt, "Smoke scenario") ?? "default";
      const reviewRound = Number.parseInt(readPromptField(args.prompt, "Review round") ?? "0", 10);

      if (kind === "review") {
        if (scenario === "immediate-lgtm") {
          return {
            output: {
              verdict: "LGTM",
              findings: [],
              blockers: [],
              residualRisks: [],
            },
          };
        }

        if (reviewRound >= 1) {
          return {
            output: {
              verdict: "LGTM",
              findings: [],
              blockers: [],
              residualRisks: [],
            },
          };
        }

        return {
          output: {
            verdict: "CHANGES_REQUIRED",
            findings: [
              {
                severity: "medium",
                location: "README.md:1",
                problem: "Smoke review found an intentionally unresolved workflow note.",
                requiredAction: "Update the documentation to reflect the new workflow command.",
              },
            ],
            blockers: scenario === "blocker-only" ? ["Smoke blocker requiring follow-up."] : [],
            residualRisks: [],
          },
        };
      }

      if (scenario === "needs-human-decision") {
        return {
          output: {
            status: "NEEDS_HUMAN_DECISION",
            summary: "Smoke address pass needs a maintainer decision.",
            filesChanged: [],
            validationRan: [],
            humanDecisionsNeeded: ["Choose whether to keep the smoke-only blocker."],
          },
        };
      }

      const findingsBlock = args.prompt.match(/Findings:\n([\s\S]+?)\n\nBlockers:/)?.[1] ?? "[]";
      const findings = reviewSchema.shape.findings.catch([]).parse(JSON.parse(findingsBlock));

      return {
        output: {
          status: "READY_FOR_REVIEW",
          summary:
            findings.length > 0
              ? `Smoke address pass resolved ${findings.map((finding) => smokeLocationToFilePath(finding.location)).join(", ")}.`
              : "Smoke address pass resolved the seeded issue.",
          filesChanged:
            findings.length > 0
              ? findings.map((finding) => smokeLocationToFilePath(finding.location))
              : ["README.md"],
          validationRan: ["bun run workflow:review:smoke"],
          humanDecisionsNeeded: [],
        },
      };
    },
  };
}

const SMOKE_MODE = process.env.ORIGIN_REVIEW_SMOKE === "1";
const REPO_ROOT = resolveRepoRoot();
const REVIEW_MODEL = process.env.ORIGIN_REVIEW_MODEL ?? "gpt-5.3-codex";
const ADDRESS_MODEL = process.env.ORIGIN_ADDRESS_MODEL ?? REVIEW_MODEL;
// Keep agent state isolated per workflow run so a broken global Codex home cannot poison tasks.
const REVIEW_CODEX_ENV = (() => {
  const env: Record<string, string> = {};

  if (process.env.ORIGIN_REVIEW_CODEX_HOME) {
    env.CODEX_HOME = process.env.ORIGIN_REVIEW_CODEX_HOME;
  }

  if (process.env.ORIGIN_REVIEW_OPENAI_API_KEY) {
    env.OPENAI_API_KEY = process.env.ORIGIN_REVIEW_OPENAI_API_KEY;
  }

  return Object.keys(env).length > 0 ? env : undefined;
})();

const REVIEW_SYSTEM_PROMPT = `You are reviewing the Origin repository.

You are in review mode only.
Do not edit files, stage changes, or create commits.
Use read-only inspection and validation commands.
Focus on correctness, regressions, safety, and missing validation.`;

const ADDRESS_SYSTEM_PROMPT = `You are fixing validated review findings in the Origin repository.

Make the smallest correct set of changes.
Keep the repo coherent.
Run validation before claiming the work is ready for review.
Do not leave partial fixes behind.
Do not run git commands.`;

const reviewAgent = SMOKE_MODE
  ? createSmokeAgent("review")
  : new CodexAgent({
      model: REVIEW_MODEL,
      cwd: REPO_ROOT,
      env: REVIEW_CODEX_ENV,
      extraArgs: ["--ephemeral"],
      maxOutputBytes: 2_000_000,
      skipGitRepoCheck: true,
      yolo: false,
      sandbox: "read-only",
      timeoutMs: 45 * 60 * 1000,
      config: {
        model_reasoning_effort: "high",
      },
      systemPrompt: REVIEW_SYSTEM_PROMPT,
    });

const addressAgent = SMOKE_MODE
  ? createSmokeAgent("address")
  : new CodexAgent({
      model: ADDRESS_MODEL,
      cwd: REPO_ROOT,
      env: REVIEW_CODEX_ENV,
      extraArgs: ["--ephemeral"],
      maxOutputBytes: 2_000_000,
      skipGitRepoCheck: true,
      yolo: true,
      sandbox: "danger-full-access",
      timeoutMs: 60 * 60 * 1000,
      config: {
        model_reasoning_effort: "high",
      },
      systemPrompt: ADDRESS_SYSTEM_PROMPT,
    });

export default smithers((ctx) => {
  const input = readInput(ctx.input, REPO_ROOT);

  return (
    <Workflow name="origin-review-step" cache={false}>
      {input.mode === "review" ? (
        <Task
          id="repo-review"
          output={outputs.review}
          agent={reviewAgent}
          timeoutMs={45 * 60 * 1000}
          heartbeatTimeoutMs={10 * 60 * 1000}
        >
          {buildReviewPrompt(input)}
        </Task>
      ) : (
        <Task
          id="address-review"
          output={outputs.address}
          agent={addressAgent}
          timeoutMs={60 * 60 * 1000}
          heartbeatTimeoutMs={10 * 60 * 1000}
        >
          {buildAddressPrompt(input)}
        </Task>
      )}
      <Task id="step-output" output={outputs.step}>
        {() =>
          input.mode === "review"
            ? {
                mode: "review",
                review: ctx.latest("review", "repo-review"),
              }
            : {
                address: ctx.latest("address", "address-review"),
                mode: "address",
              }
        }
      </Task>
    </Workflow>
  );
});

export { db };
