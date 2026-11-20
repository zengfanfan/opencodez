# opencodez

Personal fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). Not affiliated with the upstream project.

## Branch model

- `dev` is a static snapshot of upstream `dev` from the fork date. It is not synced and is not used for releases.
- `vA.B.C-z` is created from the official release tag `vA.B.C`. Personal changes live here.
- The newest `v*-z` branch is the repository default branch.
- Personal release tags use `vA.B.C-z.N` so they never collide with upstream tags.

## Current state

- `v2.3.2-z` is the first personal release branch, based on upstream `v2.3.2`, and is the current default branch.
- `dev` is kept for reference only.
- Upstream release tags for this fork are taken from the V2 line (`v2.x`). At the time of writing, GitHub's "Latest" release badge points at the V1 line, so do not use that badge to pick the base tag.
- The fork inherited all upstream branches when it was created. Only `dev` and `v*-z` are maintained here; the other branches can be ignored.

## Release check (roughly every 11 days)

Do not sync `dev`. On the 1st, 12th, and 23rd of each month, check upstream releases and only move to a release that has shown a stable gap:

1. Consider only non-draft, non-prerelease V2 tags (`v2.x.y`) newer than the tag the current `v*-z` branch is based on.
2. Sort them by publish time.
3. For every adjacent pair, keep the pair when the later release is more than 3 days after the earlier one.
4. Take the newest qualifying pair and select its earlier release.
5. If no pair qualifies, do nothing and check again in 10 days.

This filters out a release that was followed by an emergency patch within 3 days, while still moving forward.

Run the local check (reports only, does not create a branch):

```text
script\fork\check-release.cmd
```

Override the base tag when needed:

```text
script\fork\check-release.cmd --base v2.3.2
```

Create the branch only after reviewing the selected tag:

```text
script\fork\new-release.cmd vX.Y.Z
```

## GitHub Actions check

The scheduled check is `.github/workflows/opencodez-release-check.yml`:

- It runs on the 1st, 12th, and 23rd at 01:00 UTC (09:00 in China).
- It runs `script/fork/check-release.mjs` and `script/fork/release-notify.mjs`.
- Manual runs default to dry-run. Run one from the Actions tab or with:

  ```bash
  gh workflow run opencodez-release-check.yml -R zengfanfan/opencodez -f dry_run=true
  ```

- A stable candidate opens an issue labeled `opencodez-release`.
- If an older candidate issue is still open, the workflow comments with the reason, closes it, and opens a new issue.
- If the selected candidate is already tracked (open or closed), the workflow does nothing.
- All inherited upstream workflows are disabled; only this workflow is active.
- Public repositories disable scheduled workflows after 60 days without repository activity. Re-enable it manually if GitHub stops it:

  ```bash
  gh workflow enable opencodez-release-check -R zengfanfan/opencodez
  ```

## Create the next release branch

Manual equivalent:

```bash
git fetch upstream "+refs/tags/*:refs/tags/*"
git switch -c vX.Y.Z-z vX.Y.Z
git push -u origin vX.Y.Z-z
```

Then replay the personal commits from the previous release branch:

```bash
git cherry-pick vA.B.C..vA.B.C-z
```

Resolve conflicts, run the affected package checks, then commit.

After the new branch is ready, make it the default:

```bash
gh repo edit zengfanfan/opencodez --default-branch vX.Y.Z-z
```

## Personal changes

| Change | Upstream issue/PR | Files | Tests | Status |
| --- | --- | --- | --- | --- |
| Per-session prompt history | #52154 | `packages/app/src/composer/history/store.ts`, `packages/app/src/composer/model.ts` | pending | planned |

## Build and release

The repository requires Bun 1.4.4 or newer (see `packageManager` in `package.json`).

```bash
bun install
bun run dev:desktop
bun run check
```

After the release branch is verified:

```bash
git tag vX.Y.Z-z.1
git push origin vX.Y.Z-z.1
gh release create vX.Y.Z-z.1 --title "vX.Y.Z-z.1" --notes "Personal build based on upstream vX.Y.Z."
```

Attach the built desktop artifacts to the GitHub release.
