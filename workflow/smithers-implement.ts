import { createSmithers } from "smithers-orchestrator";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const implementSchema = z
  .object({
    stage: z.enum(["docs", "tests", "implementation"]),
    scope: z.string().min(1),
    summary: z.string().min(1),
    filesChanged: z.array(z.string()),
    testsAdded: z.array(z.string()),
    testsPassing: z.number().int().min(0),
    testsFailing: z.number().int().min(0),
    featuresCovered: z.array(z.string()),
    featuresRemaining: z.array(z.string()),
    unresolvedIssues: z.array(z.string()),
    status: z.enum(["DONE", "PARTIAL", "BLOCKED"]),
  })
  .superRefine((value, ctx) => {
    if (value.status === "DONE" && value.testsFailing > 0) {
      ctx.addIssue({
        code: "custom",
        message: "DONE requires zero failing tests.",
      });
    }

    if (value.status === "DONE" && value.featuresRemaining.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "DONE requires zero remaining features within scope.",
      });
    }

    if (value.status === "BLOCKED" && value.unresolvedIssues.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "BLOCKED requires at least one unresolved issue.",
      });
    }

    if (
      value.status === "PARTIAL" &&
      value.filesChanged.length === 0 &&
      value.testsAdded.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "PARTIAL requires at least one file changed or test added.",
      });
    }
  });

export const stepSchema = z.object({
  mode: z.enum(["implement"]),
  implement: implementSchema.optional(),
});

export type ImplementOutput = typeof implementSchema._output;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = join(resolve(__dirname, ".."), "origin-implement.db");

export function resolveImplementDbPath(
  dbPath = process.env.ORIGIN_IMPLEMENT_WORKFLOW_DB,
): string {
  return dbPath && dbPath.length > 0 ? dbPath : DEFAULT_DB_PATH;
}

export function createImplementSmithers(
  dbPath = resolveImplementDbPath(),
) {
  return createSmithers(
    {
      implement: implementSchema,
      step: stepSchema,
    },
    {
      dbPath,
    },
  );
}
