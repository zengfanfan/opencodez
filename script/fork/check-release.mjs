#!/usr/bin/env node
// Check the next stable upstream release for the personal fork.
//
// Rule: consider only V2 releases newer than the tag the current v*-z branch is
// based on. Sort them by publish time. Keep adjacent pairs whose gap is more
// than 3 days. Take the newest qualifying pair and pick its earlier release.
// That avoids a release that was followed by an emergency patch within 3 days.

import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const releasePattern = /^v(\d+)\.(\d+)\.(\d+)$/
const DAY = 24 * 60 * 60 * 1000
const MIN_GAP = 3 * DAY

function parseTag(tag) {
  const match = releasePattern.exec(tag ?? "")
  if (!match) return undefined

  return {
    tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

function latestBaseFromBranches() {
  const output = execFileSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
    cwd: repo,
    encoding: "utf8",
  })

  const bases = output
    .split(/\r?\n/)
    .flatMap((branch) => {
      const match = /^(v\d+\.\d+\.\d+)-z$/.exec(branch.trim())
      return match ? [parseTag(match[1])] : []
    })
    .filter(Boolean)

  if (bases.length === 0) throw new Error("no v*-z branch found; pass --base vX.Y.Z")
  return bases.sort(compareVersions).at(-1)
}

function fetchReleases() {
  const raw = execFileSync(
    "gh",
    [
      "release",
      "list",
      "-R",
      "anomalyco/opencode",
      "--exclude-drafts",
      "--exclude-pre-releases",
      "--limit",
      "500",
      "--order",
      "desc",
      "--json",
      "tagName,publishedAt,isDraft,isPrerelease",
    ],
    { encoding: "utf8" },
  )

  return JSON.parse(raw)
}

function candidateReleases(releases, base) {
  return releases
    .flatMap((release) => {
      const tag = parseTag(release.tagName)
      if (!tag || !release.publishedAt || release.isDraft || release.isPrerelease) return []
      if (compareVersions(tag, base) <= 0) return []

      const time = Date.parse(release.publishedAt)
      if (!Number.isFinite(time)) return []

      return [{ ...tag, publishedAt: release.publishedAt, time }]
    })
    .sort((a, b) => a.time - b.time || compareVersions(a, b))
}

function qualifyingPairs(candidates) {
  const pairs = []

  for (let index = 1; index < candidates.length; index++) {
    const earlier = candidates[index - 1]
    const later = candidates[index]
    const delta = later.time - earlier.time

    if (delta > MIN_GAP) pairs.push({ earlier, later, delta })
  }

  return pairs
}

function selectStableRelease(releases, base) {
  const candidates = candidateReleases(releases, base)
  const pairs = qualifyingPairs(candidates)
  const pair = pairs.at(-1)

  return { base, candidates, pairs, pair, selected: pair?.earlier }
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10)
}

function runSelfTest() {
  const release = (tagName, publishedAt) => ({ tagName, publishedAt, isDraft: false, isPrerelease: false })
  const base = parseTag("v2.3.2")
  const cases = [
    {
      name: "hotfix followed by a stable gap",
      releases: [release("v2.3.3", "2026-01-01"), release("v2.3.4", "2026-01-02"), release("v2.3.5", "2026-01-13")],
      expected: "v2.3.4",
    },
    {
      name: "latest qualifying pair wins",
      releases: [
        release("v2.3.3", "2026-01-01"),
        release("v2.3.4", "2026-01-11"),
        release("v2.3.5", "2026-01-12"),
        release("v2.3.6", "2026-01-26"),
      ],
      expected: "v2.3.5",
    },
    {
      name: "two releases less than three days apart",
      releases: [release("v2.3.3", "2026-01-01"), release("v2.3.4", "2026-01-02")],
      expected: undefined,
    },
    {
      name: "no releases newer than the base",
      releases: [release("v2.3.2", "2026-01-01")],
      expected: undefined,
    },
    {
      name: "exactly three days is not enough",
      releases: [release("v2.3.3", "2026-01-01"), release("v2.3.4", "2026-01-04")],
      expected: undefined,
    },
  ]

  for (const test of cases) {
    const actual = selectStableRelease(test.releases, base).selected?.tag
    if (actual !== test.expected) throw new Error(`${test.name}: expected ${test.expected}, got ${actual}`)
  }

  console.log("self-test passed")
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes("--self-test")) {
    runSelfTest()
    return
  }

  const baseIndex = args.indexOf("--base")
  const base = baseIndex >= 0 ? parseTag(args[baseIndex + 1]) : latestBaseFromBranches()

  if (!base) throw new Error("base tag must look like vX.Y.Z")

  const result = selectStableRelease(fetchReleases(), base)

  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          repository: repo,
          base: base.tag,
          selected: result.selected?.tag ?? null,
          pair: result.pair
            ? {
                earlier: result.pair.earlier.tag,
                later: result.pair.later.tag,
                days: result.pair.delta / DAY,
              }
            : null,
          pairs: result.pairs.map((pair) => ({
            earlier: pair.earlier.tag,
            later: pair.later.tag,
            days: pair.delta / DAY,
          })),
          candidates: result.candidates.map((candidate) => ({
            tag: candidate.tag,
            publishedAt: candidate.publishedAt,
          })),
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(`Repository: ${repo}`)
  console.log(`Current base: ${base.tag}`)

  if (result.candidates.length === 0) {
    console.log("No V2 release newer than the current base.")
    return
  }

  console.log("\nNewer releases:")
  for (const candidate of result.candidates) {
    console.log(`  ${candidate.tag}  ${formatDate(candidate.publishedAt)}`)
  }

  console.log("\nQualifying pairs (more than 3 days apart):")
  if (result.pairs.length === 0) {
    console.log("  none")
  } else {
    for (const pair of result.pairs) {
      console.log(`  ${pair.earlier.tag} -> ${pair.later.tag}  ${(pair.delta / DAY).toFixed(1)} days`)
    }
  }

  if (result.selected) {
    console.log(`\nSelected: ${result.selected.tag}`)
    console.log(
      `Reason: newest qualifying pair is ${result.pair.earlier.tag} -> ${result.pair.later.tag}; pick the earlier release.`,
    )
  } else {
    console.log("\nNo stable candidate yet. Check again in 10 days.")
  }
}

try {
  main()
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
