import type { ResolvedReviewInput } from "./review-helpers";

function buildScopeBlock(input: ResolvedReviewInput): string {
  const sections = ["Review the current Origin repository state."];

  if (input.focus) {
    sections.push(`Focus: ${input.focus}`);
  }

  if (input.paths.length > 0) {
    sections.push(`Paths in scope:\n- ${input.paths.join("\n- ")}`);
  } else {
    sections.push("Paths in scope: entire repository.");
  }

  if (input.instructions) {
    sections.push(`Extra instructions: ${input.instructions}`);
  }

  return sections.join("\n\n");
}

export function buildReviewPrompt(input: ResolvedReviewInput): string {
  return [
    "Fresh thread. Perform a strict repository review.",
    buildScopeBlock(input),
    `Review round: ${input.reviewRound}`,
    `Smoke scenario: ${input.smokeScenario}`,
    input.latestAddress?.summary
      ? `Most recent address pass summary: ${input.latestAddress.summary}`
      : "No prior address pass has been recorded for this run.",
    input.latestAddress && input.latestAddress.filesChanged.length > 0
      ? `Files changed:\n- ${input.latestAddress.filesChanged.join("\n- ")}`
      : "Files changed: none reported.",
    input.latestAddress && input.latestAddress.validationRan.length > 0
      ? `Validation run:\n- ${input.latestAddress.validationRan.join("\n- ")}`
      : "Validation run: none reported.",
    [
      "Prioritize:",
      "- bugs and behavioral regressions",
      "- broken CLI or workflow behavior",
      "- missing or incorrect validation",
      "- unsafe assumptions or risky changes",
      "- missing tests when a change clearly needs coverage",
    ].join("\n"),
    [
      "Rules:",
      "- Do not edit files.",
      "- Use read-only inspection and validation commands only.",
      "- Keep findings concrete and actionable.",
      "- Ignore cosmetic nits unless they create real ambiguity or risk.",
      "- Return structured JSON only.",
    ].join("\n"),
  ].join("\n\n");
}

export function buildAddressPrompt(input: ResolvedReviewInput): string {
  return [
    "This is an address-review pass for the Origin repository.",
    buildScopeBlock(input),
    `Review round: ${input.reviewRound}`,
    `Smoke scenario: ${input.smokeScenario}`,
    `Latest review verdict: ${input.latestReview.verdict}`,
    `Findings:\n${JSON.stringify(input.latestReview.findings, null, 2)}`,
    `Blockers:\n${JSON.stringify(input.latestReview.blockers, null, 2)}`,
    [
      "Requirements:",
      "- Fix every valid finding in scope.",
      "- Resolve every valid blocker in scope.",
      "- If a reported issue is invalid, note that briefly in the summary and continue.",
      "- Run the narrowest validation that proves the fix.",
      "- Do not run git commands, stage changes, or create commits.",
      "- If a safe fix requires human direction, return NEEDS_HUMAN_DECISION and list the decisions.",
      "- Return structured JSON only.",
    ].join("\n"),
  ].join("\n\n");
}
