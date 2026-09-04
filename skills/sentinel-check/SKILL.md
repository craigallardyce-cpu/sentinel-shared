---
name: sentinel-check
description: Review changes across the Mariner Sentinel fleet (OceanSentinel, HarborSentinel, VesselKeeper) for drift, duplicated code, and breakage that only appears on a clean checkout. Use when editing shared @sentinel/* packages, when a change to one app may apply to the others, or before cutting a release.
---

# Sentinel fleet check

Three apps — OceanSentinel, HarborSentinel, VesselKeeper — are separate products that
share code via `@sentinel/*` packages in the sibling `sentinel-shared/` repo, and are
kept on one aligned version. This skill is the review pass that keeps them from
diverging again.

## 1. Run the drift checker first

```bash
node sentinel-shared/scripts/check-fleet-drift.mjs
```

Run it from `Projects/` for the full fleet (cross-app dependency and version
comparisons). Run it from an app folder and it checks that app only. It also runs in CI
on every push.

Fix whatever it reports before going further — it covers dependency alignment, Android
parity, `applicationId` vs Electron `appId`, backend-dep mirroring, local re-copies of
extracted modules, stale shared-SHA pins, and missing Vite aliases.

## 2. Ask whether the change applies to the other two apps

The single highest-value habit. When you change one app, grep the other two for the same
code path before assuming it's local:

```bash
grep -rn "<symbol or string>" OceanSentinel/frontend/src HarborSentinel/src VesselKeeper/src/client --include=*.ts --include=*.tsx --include=*.js --include=*.jsx
```

If the same logic exists in two or more apps, it belongs in `sentinel-shared`. This is
how a real bug was found: `calculateXTE` divided a distance in **feet** by a
**nautical-mile** Earth radius in HarborSentinel, while OceanSentinel's parallel copy was
correct. Extracting the shared version surfaced the discrepancy.

When consolidating, first determine whether each copy is **live or dead**. Dead code can
be standardised on either implementation; live code must preserve exact behaviour. Do not
assume the copies agree — diff them.

## 3. Do not "fix" deliberate divergence

These differences are intentional. Leave them alone:

- **VesselKeeper forks and supervises its backend** as a child process; the other two
  `require()` theirs in-process. This is why it passes `onBeforeInstall: stopBackend` to
  the shared `setupAutoUpdater`.
- **The sign-in bypass is dev-server-only, in all three apps.** OceanSentinel
  used to treat missing Supabase config as "run offline" and render `AuthScreen`
  with `allowOfflineMode`; that was withdrawn on 2026-08-24. Every app now
  requires sign-in, and the bypass each one carries is `import.meta.env.DEV`,
  which Vite folds to `false` in every build. Do not widen it, and do not
  "restore" the old behaviour in Ocean.
- **Foreground service types differ by purpose**: OceanSentinel `microphone` (VHF
  audio), HarborSentinel `location` (anchor watch), VesselKeeper none (no background
  work).
- **Weather services genuinely differ** — Harbor has caching and offline detection,
  Ocean has Open-Meteo fallback and wind-grid building. Merging them means writing new
  code, not extracting existing code.

## 4. Verify against a clean checkout, not your working tree

**Local builds prove nothing about this class of bug.** A dev machine carries state a
fresh clone does not, and both release failures in this codebase were of exactly this
kind:

- `sentinel-shared/*/node_modules` existing locally masked missing Vite aliases; CI
  failed with `Rollup failed to resolve import "@capacitor/core"`.
- An untracked-but-present `app.html` masked it having been wrongly gitignored; the
  release build failed with `ENOENT`.

To reproduce a clean checkout offline, extract only the tracked files:

```bash
mkdir -p /tmp/sim/AppName /tmp/sim/sentinel-shared
cd <app> && git archive HEAD | tar -x -C /tmp/sim/AppName
cd sentinel-shared && git archive HEAD | tar -x -C /tmp/sim/sentinel-shared
cd /tmp/sim/AppName && npm install --legacy-peer-deps && npm run build
```

Sanity-check that the extraction actually produced files before trusting a pass — an
empty extraction yields a meaningless "success".

A faster partial check for the alias problem specifically: move the shared
`node_modules` aside and rebuild.

```bash
mv sentinel-shared/auth-ui/node_modules{,.bak}   # repeat per package, then restore
```

## 5. After editing a shared package

Changes do not propagate automatically:

```bash
cd sentinel-shared/<package> && npm run build && npm test
cd <each consuming app> && npm install --legacy-peer-deps && npm run build
```

`--legacy-peer-deps` is required in all three apps (a pre-existing Capacitor v7/v8 peer
conflict). `@sentinel/marine` must emit **both** ESM and CJS — OceanSentinel's backend is
bundled to CommonJS by esbuild.

**Adding a new runtime import to a shared package is a breaking change for every
consumer** until that import is aliased in each app's Vite config. The drift checker
catches this.

## 6. Before releasing

1. Drift checker green.
2. Version bumped in each app's **root** `package.json` (it drives the UI version,
   Android `versionName`/`versionCode`, and electron-builder). Keep all three aligned.
3. If shared code changed, bump the pinned `sentinel-shared` SHA in all three
   `.github/workflows/build.yml` — otherwise releases ship the old shared code.
4. Exercise the pipeline **without publishing** first:
   ```bash
   gh workflow run build.yml --repo craigallardyce-cpu/<App> --ref main
   ```
   The release job is guarded to tag pushes, so a manual run builds and verifies only.
5. Then tag `vX.Y.Z` and push the tag.

Watch a run with `gh run watch <id> --repo craigallardyce-cpu/<App> --exit-status`, and
read failures with `gh run view <id> --log-failed`. The app repos are private; the
`sentinel-shared` repo is public.
