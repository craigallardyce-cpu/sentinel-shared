---
name: fleet-shared-change
description: Change a @sentinel/* package and land it in the three apps — the shared → consumers → pins sequence, the committed dist, the Vite aliases, and what to check before extracting code into a package. Use when editing anything under sentinel-shared, when the same logic appears in two apps, or when a shared change needs to reach a release.
---

# Changing a shared package

The ten `@sentinel/*` packages are consumed as `file:../sentinel-shared/<pkg>`
dependencies by HarborSentinel, OceanSentinel and VesselKeeper. Nothing is
published to npm. A change here is a change to three products at once, and it
reaches them in a fixed sequence.

## The sequence

1. **The package.** Edit `src/`, then `npm run build && npm test` in that package
   and commit `dist/` **with** the source. `dist/` is committed and consumed
   through the symlink; CI fails a package whose committed `dist/` does not match
   a fresh build. Editing a shared package without rebuilding is the recurring
   failure in this repo.
2. **The consumers.** In each app: `npm install --legacy-peer-deps && npm run
   build`. This is where a missing Vite alias surfaces.
3. **The SHA pins.** If a release should carry the change, bump the pinned
   `sentinel-shared` SHA in all three `.github/workflows/build.yml`, to a commit
   **published on `origin/main`**. A pin that exists only locally produces no
   build at all, in all three apps. `test.yml` and `drift-check.yml` are
   deliberately unpinned so a shared break surfaces on the push that caused it.
4. **The drift checker**, from `Projects/`: `node
   sentinel-shared/scripts/check-fleet-drift.mjs`. It must be green before any of
   this is considered done.

## Two things that will bite

**A new runtime import in a shared package breaks every consumer** until that
import is aliased in each app's Vite config. `file:` deps are symlinks, so Vite
resolves a package's bare imports from `sentinel-shared` rather than from the
app — which happens to work locally whenever `sentinel-shared/*/node_modules`
exists, and fails on a clean checkout. That exact mismatch produced
`Rollup failed to resolve import "@capacitor/core"` in CI. The drift checker
catches it; a clean-checkout build proves it.

**Committed `dist/` cannot be merged by hand.** Two branches editing the same
package produce a conflict in generated output. Work on any one package is
serialized: one change in flight per package at a time. If two are open, the
second rebases and rebuilds rather than resolving `dist/` by hand.

## Before extracting code into a package

Ask whether the change applies to the other two apps — the single highest-value
habit in this fleet. Grep the others for the same code path before assuming a bug
is local:

```bash
grep -rn "<symbol>" OceanSentinel/frontend/src HarborSentinel/src VesselKeeper/src/client \
  --include=*.ts --include=*.tsx --include=*.js --include=*.jsx
```

If the same logic lives in two or more apps, it belongs here. When consolidating:

- **Determine whether each copy is live or dead.** Dead code can be standardised
  on either implementation; live code must preserve exact behaviour.
- **Diff the copies rather than assuming they agree.** Extracting `calculateXTE`
  found HarborSentinel dividing feet by a nautical-mile Earth radius while
  OceanSentinel's copy was correct. The extraction is what surfaced it.
- **Do not merge things that genuinely differ.** Harbor's weather service has
  caching and offline detection; Ocean's has the Open-Meteo fallback and wind-grid
  building. Merging those means writing new code, not extracting existing code.
  `sentinel-check` §3 lists the divergences that are deliberate.

## Verifying

A local build proves little: a dev machine carries state a fresh clone does not,
and both release failures in this codebase were of that kind. Extract the tracked
files and build from those:

```bash
mkdir -p /tmp/sim/AppName /tmp/sim/sentinel-shared
cd <app> && git archive HEAD | tar -x -C /tmp/sim/AppName
cd sentinel-shared && git archive HEAD | tar -x -C /tmp/sim/sentinel-shared
cd /tmp/sim/AppName && npm install --legacy-peer-deps && npm run build
```

Check the extraction produced files before trusting a pass — an empty extraction
yields a meaningless success.

## Landing it

The shared PR merges first; the app PRs carry a `Fleet:` line naming it and
saying so. Then the pin bumps, if a release needs them. `sentinel-check` is the
review pass to run over the whole set before calling it done.
