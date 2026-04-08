import { createSmithers } from "smithers-orchestrator";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const findingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  location: z.string(),
  problem: z.string(),
  requiredAction: z.string(),
});

export const reviewSchema = z
  .object({
    verdict: z.enum(["LGTM", "CHANGES_REQUIRED"]),
    findings: z.array(findingSchema),
    blockers: z.array(z.string()),
    residualRisks: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (value.verdict === "LGTM" && (value.findings.length > 0 || value.blockers.length > 0)) {
      ctx.addIssue({
        code: "custom",
        message: "LGTM is only valid when there are zero findings and zero blockers.",
      });
    }

    if (
      value.verdict === "CHANGES_REQUIRED" &&
      value.findings.length === 0 &&
      value.blockers.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "CHANGES_REQUIRED must include at least one finding or blocker.",
      });
    }
  });

export const addressSchema = z
  .object({
    status: z.enum(["READY_FOR_REVIEW", "NEEDS_HUMAN_DECISION"]),
    summary: z.string(),
    filesChanged: z.array(z.string()),
    validationRan: z.array(z.string()),
    humanDecisionsNeeded: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (value.status === "READY_FOR_REVIEW" && value.validationRan.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "READY_FOR_REVIEW must include at least one validation command.",
      });
    }

    if (value.status === "READY_FOR_REVIEW" && value.humanDecisionsNeeded.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "READY_FOR_REVIEW is only valid when there are zero unresolved human decisions.",
      });
    }

    if (value.status === "NEEDS_HUMAN_DECISION" && value.humanDecisionsNeeded.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "NEEDS_HUMAN_DECISION must include at least one unresolved human decision.",
      });
    }
  });

export const stepSchema = z.object({
  mode: z.enum(["review", "address"]),
  review: reviewSchema.optional(),
  address: addressSchema.optional(),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = join(resolve(__dirname, ".."), "origin-review.db");

export function resolveWorkflowDbPath(dbPath = process.env.ORIGIN_REVIEW_WORKFLOW_DB): string {
  return dbPath && dbPath.length > 0 ? dbPath : DEFAULT_DB_PATH;
}

export function createReviewSmithers(dbPath = resolveWorkflowDbPath()) {
  return createSmithers(
    {
      review: reviewSchema,
      address: addressSchema,
      step: stepSchema,
    },
    {
      dbPath,
    },
  );
}
