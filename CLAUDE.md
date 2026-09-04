# Mariner Sentinel fleet

Fleet-wide conventions for HarborSentinel, OceanSentinel and VesselKeeper, the
`@sentinel/*` packages in this repository, and the MarinerSentinel website that
holds the fleet's database migrations. Each app's own `CLAUDE.md` imports this
file and carries only what is specific to that app.

This file used to live as `Projects/CLAUDE.md`, one level above the repos, where
only a checkout on that one machine could read it. It lives here so that CI, a
cloud session, and a fresh clone all see the same conventions. This repository
is **public**: keystore paths, Play Console identifiers, account numbers and
anything else that should not be published stay in the private release skill,
not here.

## The layout everything assumes

The apps consume this repository's packages as `file:../sentinel-shared/<pkg>`
dependencies, never from npm, so it must sit as a **sibling** of each app:

```
Projects/
├── sentinel-shared/        this repo
├── HarborSentinel/
├── OceanSentinel/          Capacitor project is under frontend/, not the root
├── VesselKeeper/
├── MarinerSentinel Website/   migrations/ for the shared Supabase project
├── docs-kb/                customer-facing knowledge base
└── admin-app/
```

Every CI workflow in the three apps checks this repository out beside the app
for the same reason. A session that starts from a single repo clone has to
reproduce this layout before anything builds.

## Working in the fleet

- **`npm install --legacy-peer-deps`** in every app, always. A pre-existing
  Capacitor v7/v8 peer conflict from `@spryrocks/capacitor-socket-connection-plugin`
  fails a plain install outright.
- **Run the drift checker before and after a change.** From `Projects/` it
  compares the whole fleet; from an app folder it checks that app only:
  ```bash
  node sentinel-shared/scripts/check-fleet-drift.mjs
  ```
  It covers cross-app dependency alignment, version alignment, Vite aliases for
  every bare import a shared package makes, local re-copies of extracted
  modules, Android parity and `applicationId` vs Electron `appId`, OceanSentinel's
  backend-dep mirroring, stale or unpublished `sentinel-shared` SHA pins, palette
  integrity, the installed `sentinel-check` skill, settings drift and theme
  adoption. It also runs in each app's CI on every push, so what it reports
  locally is what will fail there.
- **Ask whether a change applies to the other two apps.** The single
  highest-value habit. Grep the other apps for the same code path before
  assuming a bug is local; if the same logic lives in two or more apps it
  belongs in a package here. The `sentinel-check` skill in `skills/` is the
  review pass for exactly this, and for the pre-release checklist.
- **Verify against a clean checkout, not a working tree.** Both release failures
  in this codebase were of that kind: state on a dev machine (a package's
  `node_modules`, an untracked file) masked a break that only a fresh clone
  showed. `git archive HEAD | tar -x` into a temp folder and build from there.
- **Every fleet app requires sign-in.** Licensing and entitlements live in
  Supabase. The dev-only bypass some apps carry compiles to `false` in every
  build and is not to be widened.

## Changing a shared package

Changes here do not propagate by themselves, and the two mistakes below are
the ones that recur.

1. **`dist/` is committed** and the apps consume it through the `file:` symlink.
   After editing a package: `npm run build && npm test` in that package, then
   commit `dist/` with the source. CI fails a package whose committed `dist/`
   does not match a fresh build. `@sentinel/marine` must emit both ESM and CJS,
   because OceanSentinel's backend is bundled to CommonJS.
2. **A new runtime import in a shared package breaks every consumer** until that
   import is aliased in each app's Vite config. `file:` deps are symlinks, so
   Vite resolves a package's bare imports from this repo rather than the app,
   and that only works locally when this repo happens to have `node_modules`
   installed. The drift checker catches it; a clean-checkout build proves it.

Then, in each consuming app: `npm install --legacy-peer-deps && npm run build`.

Because `dist/` is committed, two branches editing the same package cannot be
merged by hand. Work on any one package is serialized: one change in flight
per package at a time.

## Releasing

The three apps release as one, on one aligned version.

1. Drift checker green fleet-wide.
2. Version bumped in each app's **root** `package.json` (it drives the UI
   version, Android `versionName`/`versionCode`, and electron-builder). Keep all
   three the same. OceanSentinel's `frontend/` and `backend/` versions are not
   the real one.
3. If a shared package changed, bump the pinned `sentinel-shared` SHA in all
   three `.github/workflows/build.yml`, otherwise a release ships the old shared
   code. `test.yml` and `drift-check.yml` deliberately run unpinned so a shared
   change that breaks an app fails on the push that caused it. A pin must point
   at a commit **published** on `origin/main`; one that exists only locally
   produces no build at all, in all three apps at once.
4. Exercise `build.yml` with `workflow_dispatch` first. Its release job is
   guarded to tag pushes, so a manual run builds and verifies without publishing.
5. Tag `vX.Y.Z` and push the tag. Desktop installers publish to GitHub
   Releases, which each app's auto-updater reads.

Android bundles and the Play Console upload run on a machine with the Android
SDK and the signing keystore; the private `sentinel-fleet-play-release` skill
carries that procedure. The Play package names predate the `com.marinersentinel.*`
rename and are immutable; the drift checker enforces the `applicationId`.

## The database

The fleet shares one Supabase project. Its schema of record is the live
database plus `migrations/` in the **MarinerSentinel Website** repository,
applied singly with `node scripts/migrate.mjs --only NNN` from a machine holding
`DATABASE_URL`. A client change that needs a column or a table is a two-repo
change: the migration in the website repo, the client half in the app, and the
website PR is the one that says whether the migration has been applied.

Migration numbers are allocated in order in that repo. Client code naming a
table or column the database does not have fails silently at the PostgREST
boundary and looks like a feature that does nothing; check the payload against
the live schema, not against what the client used to send.

## Deliberate divergence, not drift

These differences between the apps are intentional. Do not harmonise them.

- **VesselKeeper forks and supervises its backend** as a child process, with
  restart-on-crash; the other two `require()` theirs in-process. This is why it
  passes `onBeforeInstall: stopBackend` to the shared auto-updater.
- **Foreground service types differ by purpose:** OceanSentinel `microphone`
  (VHF audio), HarborSentinel `location` (anchor watch), VesselKeeper none (no
  background work, requests only `INTERNET`).
- **Weather services genuinely differ.** HarborSentinel has caching and offline
  detection; OceanSentinel has the Open-Meteo fallback and wind-grid building.
  Merging them means writing new code, not extracting existing code.
- **OceanSentinel keeps its Capacitor project under `frontend/`** and has three
  package roots; its backend bundle resolves dependencies from the **root**
  `node_modules`, so any runtime dependency added to `backend/package.json`
  must also be added to the root `package.json`.
- **HarborSentinel uses `capacitor.config.ts`**, the other two `.json`.

`skills/sentinel-check/SKILL.md` §3 is the canonical list; add to it there.

## Where things are decided and recorded

- **This file:** how the fleet is built, changed and released.
- **`docs-kb/`:** what the customer sees, written from the code; `[NEEDS REVIEW]`
  marks decided behaviour the code does not do yet.
- **The fleet `ROADMAP.md`:** the single list of open items across the fleet.
  OceanSentinel's `ROADMAP.md` is the design record behind its entries, not a
  second checklist.
- **Each app's `CLAUDE.md`:** the traps specific to that app, and how to verify
  a change there.
