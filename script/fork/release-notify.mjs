#!/usr/bin/env node
// Turn the output of check-release.mjs into GitHub issue notifications.
//
// The script never creates branches or releases. It only comments on, closes,
// and creates issues in the fork.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const LABEL = "opencodez-release"
const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith("--"))
const dryRun = args.some((arg) => arg === "--dry-run" || arg === "--dry-run=true")
const repo = process.env.GITHUB_REPOSITORY

if (!file) throw new Error("usage: node release-notify.mjs <check.json> [--dry-run]")
if (!repo) throw new Error("GITHUB_REPOSITORY is required")

const result = JSON.parse(readFileSync(file, "utf8"))
const selected = result.selected

if (!selected) {
  console.log("No stable candidate; nothing to do.")
  process.exit(0)
}

function gh(command, input) {
  const run = spawnSync("gh", command, { encoding: "utf8", input })

  if (run.status !== 0) {
    throw new Error(`gh ${command.join(" ")} failed: ${(run.stderr || run.stdout).trim()}`)
  }

  return run.stdout
}

function mentionsTag(title, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`).test(title)
}

function hasLabel(issue) {
  return (issue.labels ?? []).some((label) => label.name === LABEL)
}

function pairText(pair) {
  if (!pair) return "none"
  return `${pair.earlier} -> ${pair.later} (${pair.days.toFixed(1)} days)`
}

function closeIssue(issue, comment) {
  if (dryRun) {
    console.log(`Would close #${issue.number}: ${issue.title}`)
    console.log(`  ${comment}`)
    return
  }

  gh(["issue", "close", String(issue.number), "--repo", repo, "--comment", comment])
  console.log(`Closed #${issue.number}: ${issue.title}`)
}

function ensureLabel() {
  if (dryRun) return

  const run = spawnSync(
    "gh",
    ["label", "create", LABEL, "--repo", repo, "--color", "0E8A16", "--description", "Scheduled upstream release check"],
    { encoding: "utf8" },
  )

  if (run.status !== 0 && !/already exists/i.test(run.stderr ?? "")) {
    throw new Error(`could not create label ${LABEL}: ${(run.stderr || run.stdout).trim()}`)
  }
}

function issueBody() {
  const candidates = result.candidates
    .map((candidate) => `- \`${candidate.tag}\` (${candidate.publishedAt.slice(0, 10)})`)
    .join("\n")

  return [
    "The scheduled upstream release check selected a new stable candidate.",
    "",
    `- Current base: \`${result.base}\``,
    `- Selected: \`${selected}\``,
    `- Qualifying pair: ${pairText(result.pair)}`,
    "",
    "Newer releases:",
    candidates,
    "",
    "Create the branch with:",
    "",
    `    script/fork/new-release.cmd ${selected}`,
    "",
    "After the branch and personal release are done, close this issue.",
    "",
    "This issue was created automatically. No branch or release was created.",
  ].join("\n")
}

const issues = JSON.parse(
  gh(["issue", "list", "--repo", repo, "--state", "all", "--limit", "100", "--json", "number,title,state,labels,url"]),
)

const labeled = issues.filter(hasLabel)
const tracked = labeled.filter((issue) => mentionsTag(issue.title, selected))
const openOthers = labeled.filter((issue) => issue.state === "OPEN" && !mentionsTag(issue.title, selected))

for (const issue of openOthers) {
  const reason = tracked.length
    ? `Superseded by the selected stable candidate \`${selected}\`, which is already tracked in #${tracked[0].number}. Closing this older tracking issue.`
    : `Superseded by the newer stable candidate \`${selected}\` selected by the 3-day release-gap rule. Closing this older tracking issue; a new issue will be opened for \`${selected}\`.`
  closeIssue(issue, reason)
}

if (tracked.length) {
  console.log(`Already tracked by #${tracked[0].number} (${tracked[0].state}): ${tracked[0].title}`)
  process.exit(0)
}

const title = `[opencodez] Stable release candidate: ${selected}`
const body = issueBody()

if (dryRun) {
  console.log(`Would create issue: ${title}`)
  console.log(body)
  process.exit(0)
}

ensureLabel()
const created = gh(
  ["issue", "create", "--repo", repo, "--title", title, "--body-file", "-", "--label", LABEL],
  body,
)
console.log(`Created issue: ${created.trim()}`)
