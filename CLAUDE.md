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

## A session started on this repository decides its role first

Craig starts fleet work from claude.ai/code or the phone as a cloud session on
`sentinel-shared`, and does not repeat the instructions each time. So, before
doing anything else, decide from the shape of the task:

- **It touches any other repository** -- an app, the website, `docs-kb`,
  `admin-app` -- or it is a roadmap item: **you are the fleet coordinator.**
  Read `skills/fleet-coordinator/SKILL.md` now and follow it. You decide,
  delegate, review and hand off; you do not edit app code yourself, and you do
  not merge.
- **It is confined to this repository** -- a package, a skill, this file, the
  drift checker: do it here, directly, on a branch with a PR. A worker session
  for a single-repo change costs more than the change (see the skill's costs).
- **Not sure which**: grep every fleet repo for where the change really lives
  (the skill's §1) before deciding. The roadmap's wording has pointed at the
  wrong surface before.

Either way, the rest of this file applies.

## The layout everything assumes

The apps consume this repository's packages as `file:../sentinel-shared/<pkg>`
dependencies, never from npm, so it must sit as a **sibling** of each app.
`Projects/` itself is not a git repository; it is a folder of independent
repositories, each with its own history and remote:

| Folder | What it is | Remote (`craigallardyce-cpu/…`) |
|---|---|---|
| `sentinel-shared/` | This repo: the `@sentinel/*` packages, the drift checker, the `sentinel-check` skill | `sentinel-shared` (**public**) |
| `HarborSentinel/` | Vessels at anchor: anchor-watch Electron + Android app | `HarborSentinel` (private) |
| `OceanSentinel/` | Vessels underway: chartplotter, weather, VHF monitoring and transcription, ship's log. Its Capacitor project is under `frontend/`, not the root | `OceanSentinel` (private) |
| `VesselKeeper/` | Maintenance and ship's records; Premium only | `VesselKeeper` (private) |
| `MarinerSentinel Website/` | Marketing site and portal (React + Express), the public shared-vessel and voyage views, and `migrations/` for the shared Supabase project | `MarinerSentinel-Website` (private) |
| `docs-kb/` | The customer-facing knowledge base, see below | `docs-kb` (private) |
| `admin-app/` | Admin and catalog app (Next.js + Electron). Secrets load from a gitignored `.env.local`; its history was re-initialised on first push (2026-08-18) so nothing earlier is on GitHub | `admin-app` (private) |
| `Watch Schedule/` | Crew watch-rotation planner extracted from OceanSentinel's ship's log. Shares `@sentinel/theme` and `@sentinel/electron-shell` but deliberately has no backend, no Supabase and no Android build, and sits **outside** the fleet version alignment. Read its own `CLAUDE.md` before touching the rotation maths | `WatchSchedule` (private) |
| `NMEA Data Simulator/` | Replays NMEA 0183 over TCP so the apps can be driven without a boat; the source of every screenshot and end-to-end test. Its `data/` captures are gitignored because both generators are deterministic; see its README to rebuild them | `NMEADataSimulator` (private, no spaces in the remote name) |

Also under `Projects/` but not source and not under git: `data/` (chart index and
downloaded ENC charts and tiles), `recordings/`, `uploads/`, `NMEA Server/` (an
older standalone NMEA test tool) and a few loose data and log files.

Every CI workflow in the three apps checks this repository out beside the app
for the same reason. A session that starts from a single repo clone has to
reproduce this layout before anything builds.

## Working in the fleet

- **Confirm which repo you are in before running git.** A `cd` made mid-session
  persists in the shell, so a task that spans repos should verify with `pwd`.
  When a task concerns one project, treat that folder as the working root
  rather than operating from `Projects/` broadly.
- **Committing and pushing to `origin` is pre-approved** for every repo listed
  above. Merging, tagging, uploading to Play and applying migrations are not.
- **Work reaches `main` through a pull request**, so that a change has somewhere
  to be reviewed, CI has something to report on, and a session that did not write
  it can pick it up. Two conventions make a change that spans repos legible
  without any tooling:
  - **Branch name `fleet/<initiative>/<repo>`** for a change that has companions
    in other repositories, so the set can be found by prefix. A change confined
    to one repo takes any name.
  - **A `Fleet:` line in each PR body** naming its companions by URL and saying
    which merges first. A shared-package change merges before the apps that
    consume it; a migration merges before, or with, the client half that needs it.

  A single-repo fix small enough to review in the diff can go straight to `main`
  — that is the author's call, not an agent's. Anything an agent wrote, and
  anything touching more than one repository, goes through a PR.

  Before merging any PR, re-read its head SHA and confirm CI ran on that commit:
  a branch can move between review and merge, and one did (HarborSentinel #3).
- **A change that spans repositories is run by a coordinator session**, which
  decomposes it, spawns one worker session per repo, reviews the diffs and
  closes the roadmap item: `skills/fleet-coordinator/SKILL.md`. Worker sessions
  spend from the same usage window as the session that spawned them.
- **`.env` files are never committed.** Check `.gitignore` covers a new one
  before adding it in any project. It has happened once (OceanSentinel's
  `backend/.env`, since untracked); treat anything that reached history as
  exposed.
- **Check this repository before writing marine, weather, auth, settings,
  theme or Electron main-process code.** It almost certainly already lives in
  a package here, and a second copy in an app is exactly the drift the checker
  exists to catch:

  | Package | Contents |
  |---|---|
  | `@sentinel/marine` | Navigation math, NMEA 0183 parsing, AIS/AIVDM decoding, the NMEA gateway rule and TCP connection pool |
  | `@sentinel/weather` | Weather providers: NWS coverage routing and the Open-Meteo global fallback |
  | `@sentinel/weather-ui` | NWS alert and forecast React components |
  | `@sentinel/electron-shell` | Auto-updater IPC, Linux GPU compat, window diagnostics, tray, power-save blocker, hidden title bar |
  | `@sentinel/auth-ui` | Supabase `AuthScreen` |
  | `@sentinel/theme` | Colour and font tokens, the Tailwind role map, night mode, glass surfaces |
  | `@sentinel/ui` | UI primitives: buttons, inputs, modals, toasts, `AppShell`, `SettingsShell`, the updater panel, `Stepper` |
  | `@sentinel/vessel` | The fleet's canonical vessel identity record (`public.vessels`) |
  | `@sentinel/settings` | The settings registry: one declaration per setting, resolved through account, vessel, host and device layers |
  | `@sentinel/lan-pairing` | LAN pairing auth for the two on-boat backends (server-side; not for Vite) |

  The README here describes each one in depth.
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
  in this codebase were of that kind, and a local build proves nothing about
  them:
  - `sentinel-shared/*/node_modules` existing locally masked missing Vite
    aliases; CI failed with `Rollup failed to resolve import "@capacitor/core"`.
  - An untracked-but-present `app.html` in VesselKeeper masked it having been
    wrongly gitignored; the release build died with `ENOENT`.

  To test a clean checkout without pushing, extract the tracked files only:
  ```bash
  mkdir -p /tmp/sim/AppName /tmp/sim/sentinel-shared
  cd <app> && git archive HEAD | tar -x -C /tmp/sim/AppName
  cd sentinel-shared && git archive HEAD | tar -x -C /tmp/sim/sentinel-shared
  cd /tmp/sim/AppName && npm install --legacy-peer-deps && npm run build
  ```
  Check the extraction actually produced files before trusting a pass.
- **Every fleet app requires sign-in.** Licensing and entitlements live in
  Supabase. The dev-server bypass each app carries is `import.meta.env.DEV`,
  which Vite substitutes at compile time, so it is literally `false` in every
  build and is not to be widened. Devices that have verified before are admitted
  offline for 30 days (`offlineGraceDays`); that is a separate mechanism and
  stays.

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

The three apps release as one, on one aligned version (v2.10.1 as of September
2026; the root `package.json` of each app is authoritative). They drifted apart
once, and most of the rules in this file exist because something then broke.

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
applied from a machine holding `DATABASE_URL`. A client change that needs a
column or a table is a two-repo change: the migration in the website repo, the
client half in the app, and the website PR is the one that says whether the
migration has been applied.

`public.schema_migrations` records which files have run (website migration 050),
and `scripts/migrate.mjs` consults it:

```bash
node scripts/migrate.mjs --status      # what is applied, what is pending
node scripts/migrate.mjs               # apply everything pending, in order
node scripts/migrate.mjs --only 051    # apply one file
```

A bare run applies only pending files, so it is safe; before the ledger it
re-applied all of them from 001, which is how an afternoon went on 2026-09-04.
`--only NNN --force` re-applies a recorded file, which is only for repair.

**Repairing by re-applying an old file needs care.** A migration re-run in
isolation silently undoes every later one that touches the same object: replaying
001–015 that day reverted five functions, and the repair itself then reverted a
grant (049) and a price (046) because the files that set them came later than the
ones being replayed. The rule is to re-apply, in ascending order, every later
migration touching the same tables, functions, grants or rows — not just the ones
that obviously conflict.

Migration numbers are allocated in order in that repo. Client code naming a
table or column the database does not have fails silently at the PostgREST
boundary and looks like a feature that does nothing; check the payload against
the live schema, not against what the client used to send.

After any change to the shared project (functions, views, tables, policies,
grants, roles) run the `supabase-security-advisor` skill as the last step; it
knows which advisor findings are accepted and flags only new ones.

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

## The knowledge base and the roadmap

`docs-kb/` is the unified, feature-organised knowledge base for the three
products, generated from the code in four passes (inventory, shared layer,
per-product, then troubleshooting and FAQ). It powers the AI support agent and
the public FAQ. Its audience is non-technical boat owners: plain language, no
code references, no internal function names. Anything the code leaves ambiguous
is tagged `[NEEDS REVIEW]` rather than guessed.

Product roles, as a customer would describe them: **HarborSentinel** for
vessels at anchor, **OceanSentinel** for vessels underway, **VesselKeeper** for
maintenance and ship's records. Tiers are **Basic** (one device, on-device
functions only) and **Premium** (up to five devices, NMEA integration, cloud
storage, AI features); VesselKeeper is Premium only. The authoritative gates are
each app's `entitlements` module and the subscription catalog behind
`@sentinel/auth-ui`.

The fleet-wide list of open work, all of which must land before go-live
(planned **May 2027**), is `ROADMAP.md` in the private `docs-kb` repository
(moved there from `Projects/` on 2026-09-04; consolidated on 2026-09-03 to
include OceanSentinel's items).
OceanSentinel's own `ROADMAP.md` keeps the design narrative and decision history
behind each of its entries; it is no longer where open work is tracked.

## Where things are decided and recorded

- **This file:** how the fleet is built, changed and released.
- **`docs-kb/`:** what the customer sees, written from the code; `[NEEDS REVIEW]`
  marks decided behaviour the code does not do yet.
- **The fleet `ROADMAP.md`:** the single list of open items across the fleet.
  OceanSentinel's `ROADMAP.md` is the design record behind its entries, not a
  second checklist.
- **Each app's `CLAUDE.md`:** the traps specific to that app, and how to verify
  a change there.
