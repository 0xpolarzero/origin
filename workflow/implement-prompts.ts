import type { ResolvedImplementInput } from "./implement-helpers";

function buildScopeBlock(input: ResolvedImplementInput): string {
  const sections = [
    "Implement Origin features according to the PRD and AGENTS.md.",
  ];

  sections.push(`Stage: ${input.stage}`);

  if (input.scope) {
    sections.push(`Scope: ${input.scope}`);
  } else {
    sections.push("Scope: entire repository.");
  }

  if (input.focus) {
    sections.push(`Extra instructions: ${input.focus}`);
  }

  return sections.join("\n\n");
}

function buildEpisodeHistory(
  episodes: ResolvedImplementInput["previousEpisodes"],
): string {
  if (episodes.length === 0) {
    return "No prior implementation episodes for this run.";
  }

  const lines = episodes.map(
    (ep, i) =>
      `Episode ${i + 1}: ${ep.summary}\n  Status: ${ep.status}\n  Files: ${ep.filesChanged.join(", ") || "none"}\n  Tests: ${ep.testsPassing} pass / ${ep.testsFailing} fail`,
  );

  return [
    `Previous episodes (${episodes.length}):`,
    ...lines,
  ].join("\n\n");
}

function buildFeatureCoverage(
  episodes: ResolvedImplementInput["previousEpisodes"],
): string {
  const covered = new Set<string>();
  const remaining = new Set<string>();

  for (const ep of episodes) {
    for (const f of ep.featuresCovered) covered.add(f);
    for (const f of ep.featuresRemaining) remaining.add(f);
  }

  const sections: string[] = [];

  if (covered.size > 0) {
    sections.push(
      `Features covered so far:\n- ${[...covered].sort().join("\n- ")}`,
    );
  }

  const stillRemaining = [...remaining].filter((f) => !covered.has(f));
  if (stillRemaining.length > 0) {
    sections.push(
      `Features still remaining:\n- ${stillRemaining.sort().join("\n- ")}`,
    );
  }

  if (sections.length === 0) {
    return "No feature coverage data from prior episodes.";
  }

  return sections.join("\n\n");
}

export function buildImplementPrompt(
  input: ResolvedImplementInput,
): string {
  return [
    `Fresh thread. Iteration ${input.iteration + 1}.`,
    buildScopeBlock(input),
    `Smoke scenario: ${input.smokeScenario}`,
    buildEpisodeHistory(input.previousEpisodes),
    buildFeatureCoverage(input.previousEpisodes),
    [
      "AGENTS.md rules:",
      "- Build order: docs → tests → implementation",
      "- Conventional commits",
      "- docs/features.ts is the canonical feature list — keep it in sync",
      "- docs/references/ contains library references",
      "- Strengthen the test suite as you go",
      "- Use docs/references/ for library questions before writing code",
    ].join("\n"),
    [
      "Key references:",
      "- PRD: docs/prd.md",
      "- CLI contract: apps/server/src/cli/spec.ts",
      "- Feature inventory: docs/features.ts",
      "- Test harness: apps/server/test/support/behavior-scenarios.ts",
      "- API specs: docs/api/*.md",
      "- Linked specs: docs/details/*.md",
    ].join("\n"),
    [
      "Domain handler files:",
      "- apps/server/src/handlers/planning-email-github-telegram.ts",
      "- apps/server/src/handlers/chat-memory-workspace-note-file.ts",
      "- apps/server/src/handlers/automation-activity-entity-notification-sync.ts",
      "- apps/server/src/handlers/status-context-search-identity-integration-setup.ts",
      "- apps/server/src/runtime/{store,context,state,helpers,types}.ts",
    ].join("\n"),
    [
      "Validation commands:",
      "- bun test (from repo root)",
      "- oxlint apps/server/src/",
      "- ./bin/origin --llms-full (verify CLI surface intact)",
    ].join("\n"),
    [
      "Requirements:",
      "- Follow AGENTS.md build order strictly for this stage",
      "- Every handler must produce structured JSON output",
      "- Seed data must never leak to fresh homes",
      "- Do not run git commands — only edit, test, and validate",
      "- If blocked by a missing decision or dependency, report it as an unresolved issue",
      "- Return structured JSON only with your final output",
    ].join("\n"),
  ].join("\n\n");
}
