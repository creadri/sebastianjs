# Releasing SebastianJS

How to cut a release: bump the version, tag it, publish a GitHub Release, and
let CI push the package to npm.

## How the pipeline fits together

Releases are driven by **a GitHub Release**, not by the tag alone. Creating the
Release is what publishes to npm.

```
  bump package.json + CHANGELOG
              |
              v
        git tag v0.1.1  ──────────────>  pages.yml        (rebuilds the docs site)
              |                          release-please   (no-op; see below)
              v
   gh release create v0.1.1  ─────────>  npm-publish.yml  (npm ci, npm test, npm publish)
```

| Workflow | Trigger | Does |
|---|---|---|
| `pages.yml` | push of a `v*` tag, or manual | Builds and deploys the docs site |
| `npm-publish.yml` | a GitHub **Release** is published | `npm ci` → `npm test` → `npm publish` |
| `release-please.yml` | push of a `v*` tag, or manual | Effectively nothing — see below |

Pushing a tag does **not** publish to npm. If you tag and stop there, the docs
site updates and nothing reaches the registry. That is how `v0.1.0` ended up
tagged but absent from npm.

## Prerequisites

**`gh` authenticated** — `gh auth status` should show the account with `repo`
and `workflow` scopes. `gh` is installed in the devcontainer.

**`NPM_TOKEN` repo secret that bypasses 2FA.** npm's classic *Publish* tokens
still demand a one-time password, which no CI runner can supply — the job fails
with `npm error code EOTP`. Use a **granular access token** scoped to
`sebastianjs` with *Read and write*, or a classic **Automation** token:

```bash
gh secret set NPM_TOKEN --repo creadri/sebastianjs
```

## Pre-flight

Run these on `main` before tagging anything. Everything must be committed and
pushed first — the release is built from what is in the tag, not your working
tree.

```bash
npm test                  # full suite
npm run check:mermaid     # the mermaid pin still matches mermaid-cli's lockfile
npm run deviation         # parity gate; unexpectedFailures must be empty
npm run benchmark         # regenerates the README benchmark block
```

`npm run benchmark` **edits README.md**, so run it before you bump, and commit
the result. Both `deviation` and `benchmark` shell out to mermaid-cli and take
10–20 minutes over the full corpus.

If mermaid itself is being upgraded, do that first and separately — see
[Mermaid is pinned, deliberately](../README.md#mermaid-is-pinned-deliberately).

## Cutting the release

### 1. Bump the version and changelog

`npm publish` publishes **the version in `package.json`**, ignoring the tag
name entirely. A `v0.1.1` tag on a tree whose `package.json` says `0.1.0` will
publish `0.1.0` — or fail, if that version already exists. Bump first:

```bash
npm version patch --no-git-tag-version     # or minor / major
```

`--no-git-tag-version` keeps npm from creating its own tag and commit; we do
that explicitly below so the changelog lands in the same commit.

Add the matching `CHANGELOG.md` entry under a new `## [x.y.z] - YYYY-MM-DD`
heading, following the existing `### Added` / `### Changed` / `### Fixed`
structure, then:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release 0.1.1"
git push origin main
```

### 2. Tag it

The tag must point at a commit whose test suite passes, because `npm-publish`
checks out **the tag**, not `main`. A tag placed before a CI fix will keep
failing on the old code no matter what `main` looks like.

```bash
git tag -a v0.1.1 -m "SebastianJS 0.1.1"
git push origin v0.1.1
```

This kicks off `pages.yml`. Nothing is published to npm yet.

### 3. Create the GitHub Release

This is the step that publishes. Pull the notes straight from the changelog so
the Release and `CHANGELOG.md` cannot drift:

```bash
gh release create v0.1.1 \
  --title "Version 0.1.1" \
  --notes "$(sed -n '/## \[0.1.1\]/,/^---$/p' CHANGELOG.md | sed '$d')"
```

Watch it land:

```bash
gh run watch "$(gh run list --workflow=npm-publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

### 4. Verify

```bash
npm view sebastianjs version          # should report the new version
npm pack sebastianjs@0.1.1            # should download and unpack
```

**A 404 on the tarball for the first few minutes is normal.** npm publishes
package metadata to the CDN before the tarball finishes replicating, so
`npm install` can resolve the new version and then fail to fetch it:

```
npm error 404 Not Found - GET .../sebastianjs-0.1.1.tgz
```

It clears on its own, typically within ~5 minutes. Do not republish, and do not
clear your npm cache — the 404 comes from the registry, not from you.

## Troubleshooting

**`npm error code EOTP`** — the `NPM_TOKEN` secret is a classic *Publish*
token. Replace it with a granular or Automation token (see Prerequisites) and
re-run the failed job; no new tag or Release is needed.

**Tests fail in CI but pass locally** — check for something installed on your
machine but not declared. The Chrome parity tests need the Open Sans *system*
font, which `.devcontainer/setup.sh` installs via `fc-cache`; they skip
themselves when `fc-match` cannot resolve it, so a bare runner should never run
them. If they run and fail, the skip guard has regressed.

**The Release exists but npm-publish never ran** — it triggers on
`release: [published]`, not on drafts. A draft Release fires nothing.

## Fixing a bad release

**Version numbers are burned permanently.** Once `0.1.1` is published, that
number can never be reused, even if you unpublish it. npm allows unpublishing
only within 72 hours and under narrow conditions, so the normal remedy is to
deprecate and roll forward:

```bash
npm deprecate sebastianjs@0.1.1 "Broken with X; use 0.1.2"
```

Then fix, bump to `0.1.2`, and release again.

**Moving a tag** is only defensible when nothing has consumed it — no Release,
not on npm, pushed minutes ago:

```bash
git tag -d v0.1.1
git tag -a v0.1.1 main -m "SebastianJS 0.1.1"
git push origin v0.1.1 --force
```

Once a Release or an npm publish exists for a tag, bump the version instead.

## A note on release-please

`release-please.yml` is in the repo but is effectively disabled. It is designed
to watch `main` and keep a "chore: release X.Y.Z" PR open, where **merging that
PR** is what creates the tag. It is currently triggered by tag pushes, which
inverts that ordering — by the time it runs, the release it would have proposed
already exists.

So the two approaches compete for the same job. Either keep hand-tagging as
documented above and delete the workflow, or hand versioning back to
release-please: put its trigger back to `push: branches: [main]`, stop tagging
by hand, and merge the release PRs it opens. Commits already follow
Conventional Commits, so it would compute versions correctly today.
