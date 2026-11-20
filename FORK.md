# opencodez

Personal fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). Not affiliated with the upstream project.

## Branch model

- `dev` mirrors `upstream/dev`. Do not add commits to this branch.
- `vA.B.C-z` is created from the official release tag `vA.B.C`. Personal changes live here.
- Personal release tags use `vA.B.C-z.N` so they never collide with upstream tags.

## Current state

- `dev` tracks `upstream/dev`.
- `v2.3.2-z` is the first personal release branch, based on upstream `v2.3.2`.
- Upstream release tags for this fork are taken from the V2 line (`v2.x`). At the time of writing, GitHub's "Latest" release badge points at the V1 line, so do not use that badge to pick the base tag.
- The fork inherited all upstream branches when it was created. Only `dev` and `v*-z` are maintained here; the other branches can be ignored.

## Sync `dev`

The sync script is kept outside this repository so `dev` stays byte-for-byte upstream.

Manual equivalent:

```bash
git fetch upstream --prune --tags
git switch dev
git merge --ff-only upstream/dev
git push origin dev
```

Do not use GitHub's **Sync fork** button for `dev`; this repository uses an explicit fast-forward sync so `dev` never gains a merge commit.

## Create the next release branch

When upstream publishes `vX.Y.Z`:

```bash
git fetch upstream --prune --tags
git switch -c vX.Y.Z-z vX.Y.Z
git push -u origin vX.Y.Z-z
```

Then replay the personal commits from the previous release branch:

```bash
git cherry-pick vA.B.C..vA.B.C-z
```

Resolve conflicts, run the affected package checks, then commit.

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
