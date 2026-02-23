#!/usr/bin/env bun

import { $ } from "bun"

const COMMENT_MARKER = "<!-- beta-sync:conflict:v1 -->"

interface PR {
  number: number
  title: string
  author: { login: string }
  labels: Array<{ name: string }>
}

interface FailedPR {
  number: number
  title: string
  reason: string
  conflicts: string[]
  blockers: number[]
}

interface AppliedPR {
  number: number
  title: string
  files: Set<string>
}

interface IssueComment {
  id: number
  body: string | null
}

function blockerNumbers(conflicts: string[], applied: AppliedPR[]) {
  return applied
    .map((pr) => {
      const score = conflicts.filter((file) => pr.files.has(file)).length
      return { number: pr.number, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.number - a.number)
    .slice(0, 3)
    .map((item) => item.number)
}

function commentBody(failed: FailedPR) {
  const blockers = failed.blockers.length > 0 ? failed.blockers.map((num) => `#${num}`).join(", ") : "none identified"
  const files = failed.conflicts.slice(0, 10)
  const extra = failed.conflicts.length - files.length
  const fileLines = files.length > 0 ? files.map((file) => `- \`${file}\``).join("\n") : "- none captured"
  const extraLine = extra > 0 ? `\n- ...and ${extra} more` : ""

  return `${COMMENT_MARKER}
⚠️ **Blocking Beta Release**

This PR cannot be merged into the beta branch.

**Reason:** ${failed.reason}
**Likely conflicting beta PR(s):** ${blockers}

**Conflicted files:**
${fileLines}${extraLine}

Please rebase onto latest \`dev\` and resolve conflicts with the listed beta PR(s) before the next beta sync.`
}

async function repositoryName() {
  const repo = process.env["GITHUB_REPOSITORY"] ?? process.env["GH_REPO"]
  if (repo) return repo
  return (await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()).trim()
}

async function prFiles(prNumber: number, cache: Map<number, Set<string>>) {
  const cached = cache.get(prNumber)
  if (cached) return cached
  const stdout = await $`gh pr view ${prNumber} --json files --jq .files[].path`.text()
  const files = new Set<string>(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  )
  cache.set(prNumber, files)
  return files
}

async function conflictFiles() {
  const stdout = await $`git diff --name-only --diff-filter=U`.text()
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

async function cleanupMergeState() {
  await $`git merge --abort`.nothrow()
  await $`git checkout -- .`.nothrow()
  await $`git clean -fd`.nothrow()
}

async function upsertComment(repo: string, prNumber: number, body: string) {
  const stdout = await $`gh api repos/${repo}/issues/${prNumber}/comments --paginate`.text()
  const comments = JSON.parse(stdout) as IssueComment[]
  const existing = comments.filter((item) => item.body?.includes(COMMENT_MARKER)).at(-1)
  if (!existing) {
    await $`gh api repos/${repo}/issues/${prNumber}/comments --method POST --field body=${body}`
    console.log(`  Posted comment on PR #${prNumber}`)
    return
  }
  if (existing.body?.trim() === body.trim()) {
    console.log(`  Comment already up to date on PR #${prNumber}`)
    return
  }
  await $`gh api repos/${repo}/issues/comments/${existing.id} --method PATCH --field body=${body}`
  console.log(`  Updated comment on PR #${prNumber}`)
}

async function commentOnPR(repo: string, failed: FailedPR) {
  const body = commentBody(failed)

  try {
    await upsertComment(repo, failed.number, body)
  } catch (err) {
    console.log(`  Failed to post comment on PR #${failed.number}: ${err}`)
  }
}

async function main() {
  const repo = await repositoryName()
  console.log("Fetching open PRs with beta label...")

  const stdout = await $`gh pr list --state open --label beta --json number,title,author,labels --limit 100`.text()
  const prs: PR[] = JSON.parse(stdout).sort((a: PR, b: PR) => a.number - b.number)

  console.log(`Found ${prs.length} open PRs with beta label`)

  if (prs.length === 0) {
    console.log("No team PRs to merge")
    return
  }

  console.log("Fetching latest dev branch...")
  await $`git fetch origin dev`

  console.log("Checking out beta branch...")
  await $`git checkout -B beta origin/dev`

  const applied: AppliedPR[] = []
  const failed: FailedPR[] = []
  const cache = new Map<number, Set<string>>()

  for (const pr of prs) {
    console.log(`\nProcessing PR #${pr.number}: ${pr.title}`)
    let files = new Set<string>()
    try {
      files = await prFiles(pr.number, cache)
    } catch (err) {
      console.log(`  Failed to fetch PR files metadata: ${err}`)
    }

    console.log("  Fetching PR head...")
    try {
      await $`git fetch origin pull/${pr.number}/head:pr/${pr.number}`
    } catch (err) {
      console.log(`  Failed to fetch: ${err}`)
      const failure = {
        number: pr.number,
        title: pr.title,
        reason: "Fetch failed",
        conflicts: [],
        blockers: [],
      }
      failed.push(failure)
      await commentOnPR(repo, failure)
      continue
    }

    console.log("  Merging...")
    try {
      await $`git merge --no-commit --no-ff pr/${pr.number}`
    } catch {
      console.log("  Failed to merge (conflicts)")
      const conflicts = await conflictFiles().catch(() => [])
      const blockers = blockerNumbers(conflicts, applied)
      const reason =
        blockers.length > 0
          ? `Merge conflicts with beta stack (likely: ${blockers.map((num) => `#${num}`).join(", ")})`
          : "Merge conflicts while applying onto beta stack"
      const failure = {
        number: pr.number,
        title: pr.title,
        reason,
        conflicts,
        blockers,
      }
      await cleanupMergeState()
      failed.push(failure)
      await commentOnPR(repo, failure)
      continue
    }

    try {
      await $`git rev-parse -q --verify MERGE_HEAD`.text()
    } catch {
      console.log("  No changes, skipping")
      continue
    }

    try {
      await $`git add -A`
    } catch {
      console.log("  Failed to stage changes")
      await cleanupMergeState()
      const failure = {
        number: pr.number,
        title: pr.title,
        reason: "Staging failed",
        conflicts: [],
        blockers: [],
      }
      failed.push(failure)
      await commentOnPR(repo, failure)
      continue
    }

    const commitMsg = `Apply PR #${pr.number}: ${pr.title}`
    try {
      await $`git commit -m ${commitMsg}`
    } catch (err) {
      console.log(`  Failed to commit: ${err}`)
      await cleanupMergeState()
      const failure = {
        number: pr.number,
        title: pr.title,
        reason: "Commit failed",
        conflicts: [],
        blockers: [],
      }
      failed.push(failure)
      await commentOnPR(repo, failure)
      continue
    }

    console.log("  Applied successfully")
    applied.push({ number: pr.number, title: pr.title, files })
  }

  console.log("\n--- Summary ---")
  console.log(`Applied: ${applied.length} PRs`)
  applied.forEach((pr) => console.log(`  - PR #${pr.number}`))

  if (failed.length > 0) {
    console.log(`Failed: ${failed.length} PRs`)
    failed.forEach((item) => {
      const blockers =
        item.blockers.length > 0 ? ` (likely with ${item.blockers.map((num) => `#${num}`).join(", ")})` : ""
      console.log(`  - PR #${item.number}: ${item.reason}${blockers}`)
    })
    throw new Error(`${failed.length} PR(s) failed to merge`)
  }

  console.log("\nChecking if beta branch has changes...")
  await $`git fetch origin beta`

  const localTree = await $`git rev-parse beta^{tree}`.text()
  const remoteTrees = (await $`git log origin/dev..origin/beta --format=%T`.text()).split("\n")

  const matchIdx = remoteTrees.indexOf(localTree.trim())
  if (matchIdx !== -1) {
    if (matchIdx !== 0) {
      console.log(`Beta branch contains this sync, but additional commits exist after it. Leaving beta branch as is.`)
    } else {
      console.log("Beta branch has identical contents, no push needed")
    }
    return
  }

  console.log("Force pushing beta branch...")
  await $`git push origin beta --force --no-verify`

  console.log("Successfully synced beta branch")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
