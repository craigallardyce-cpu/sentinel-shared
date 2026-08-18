# Sentinel Shared

Shared packages for the Mariner Sentinel fleet — [OceanSentinel](https://github.com/craigallardyce-cpu/OceanSentinel),
[HarborSentinel](https://github.com/craigallardyce-cpu/HarborSentinel), and
[VesselKeeper](https://github.com/craigallardyce-cpu/VesselKeeper).

These are **not published to npm**. Each app consumes them as local `file:` dependencies,
which requires `sentinel-shared/` to sit as a **sibling directory** of the app repos:

```
Projects/
├── sentinel-shared/     <- this repo
├── OceanSentinel/
├── HarborSentinel/
└── VesselKeeper/
```

## Packages

| Package | What it is | Consumed by |
|---|---|---|
| `@sentinel/marine` | Navigation math (haversine, bearing, XTE, CPA/TCPA), NMEA 0183 parsing, AIS/AIVDM decoding | all three |
| `@sentinel/weather-ui` | NWS alert/forecast React components and helpers | OceanSentinel, HarborSentinel |
| `@sentinel/electron-shell` | Electron main-process building blocks (auto-updater IPC, Linux GPU compat, window diagnostics, tray, power-save blocker) | all three |
| `@sentinel/auth-ui` | Supabase-backed `AuthScreen` and the `Stepper` input control | all three |
| `@sentinel/theme` | The fleet colour palette and font tokens | OceanSentinel, VesselKeeper |
| `@sentinel/db` | Database adapter contract (`DbAdapter`, `getDatabaseType`) | VesselKeeper |

`@sentinel/db` is the first step of review finding H6 (three persistence strategies
for one fleet). It currently has one consumer. HarborSentinel talks to
`better-sqlite3` directly and OceanSentinel writes a JSON file; neither has been
migrated, because:

- **HarborSentinel** has 62 `db.prepare()` call sites across 10 files, 12 of them in
  the anchor-watch polling loop. `better-sqlite3` is synchronous and this contract is
  async, so every one becomes an `await` that cascades through the alarm path. That
  wants its own change, with tests around the alarm first.
- **OceanSentinel** has no SQL driver at all, only `pg`. Giving it local persistence
  through this contract means adding a native SQLite module — importing the exact
  problem H6 exists to remove, since native modules cannot run under Capacitor.
  Node's built-in `node:sqlite` would avoid that but needs Node >= 22.5, and
  Electron 32 ships Node 20. Its JSON writes are already atomic (finding S4) and the
  dataset is a handful of records, so the urgency is low.

The unlock for both is a non-native driver implementing `DbAdapter`. That should come
before either migration, or the work gets done twice.

## Tooling in this repo

| Path | What it is |
|---|---|
| `scripts/check-fleet-drift.mjs` | Drift checker. Run from `Projects/` for the whole fleet, or from an app for that app only. Also runs in each app's CI on every push. |
| `skills/sentinel-check/SKILL.md` | Canonical source for the `/sentinel-check` Claude Code skill. |

The skill is **not** picked up from this repo automatically — copy it to your user-level
skills directory so it is available from every app folder:

```bash
mkdir -p ~/.claude/skills/sentinel-check
cp skills/sentinel-check/SKILL.md ~/.claude/skills/sentinel-check/SKILL.md
```

Edit the copy here, not the installed one; the drift checker warns if the two diverge.

## Working on a shared package

Changes here do **not** reach the apps automatically. After editing:

```bash
# 1. in sentinel-shared/<package>
npm run build          # required — apps import from dist/, not src/
npm test               # marine and auth-ui have test suites

# 2. in each consuming app
npm install --legacy-peer-deps    # re-links the file: dependency
npm run build
```

`--legacy-peer-deps` is required across all three apps because of a pre-existing
Capacitor v7/v8 peer conflict from `@spryrocks/capacitor-socket-connection-plugin`.

## Gotchas worth knowing

- **`@sentinel/marine` ships both ESM and CJS.** OceanSentinel's backend is bundled to
  CommonJS by esbuild, so the package needs its `dist-cjs/` output and the `require`
  export condition. `npm run build` produces both — don't drop one.
- **Every bare import a shared package makes must be aliased in the consuming app's Vite
  config**, pointing at that app's own `node_modules`. This is the single most important
  constraint here, and it bites in two different ways:
  1. *Duplicate instances.* Because `file:` deps resolve through a symlink, Vite would
     otherwise bundle this repo's copy of React as a **second** React instance, which
     crashes at mount with `Cannot read properties of null (reading 'useState')`.
  2. *Builds that pass locally and fail in CI.* Vite resolves a shared package's bare
     imports relative to `sentinel-shared/`, **not** the app. On a dev machine that
     usually works by accident, because these packages have their own `node_modules`
     installed. A fresh clone (i.e. CI) has none, so the build fails with
     `Rollup failed to resolve import "X" from ".../sentinel-shared/<pkg>/dist/...".`

  The current set that must be aliased is `react`, `react-dom`, `react/jsx-runtime`
  (covered by the `react` alias), `lucide-react`, `motion/react` (weather-ui only), and
  `@capacitor/core` + `@capacitor/device` (auth-ui only). **Adding a new runtime import
  to a shared package is a breaking change for every consumer** until its alias is added.
  To check before pushing, build an app with the shared `node_modules` moved aside —
  that reproduces CI exactly:

  ```bash
  mv sentinel-shared/auth-ui/node_modules{,.bak}   # repeat per package
  cd <app> && npm run build                        # must still succeed
  ```
- **Peer dependency versions must stay aligned** with the apps (`react` ^19.0.1,
  `lucide-react` ^0.546.0, `@capacitor/*` ^8.x, `@supabase/supabase-js` ^2.110.0).
  Bumping one app without the others reintroduces duplicate-instance bugs.
- **`@sentinel/auth-ui` takes the Supabase client as a prop**, typed structurally
  (`SupabaseClientLike`) rather than importing `SupabaseClient`. This avoids a nominal
  type mismatch when an app's installed copy of `@supabase/supabase-js` differs from
  this repo's. Don't "fix" it by importing the real type.

## What deliberately is *not* shared

Some duplication across the apps is intentional, not drift:

- **`createWindow()` / backend startup** — VesselKeeper forks and supervises its backend
  as a child process; OceanSentinel and HarborSentinel `require()` theirs in-process.
- **Weather services** — HarborSentinel's has caching and offline detection, OceanSentinel's
  has Open-Meteo fallback and wind-grid building. Merging these needs synthesized new code,
  not extraction.
- **Foreground services** — OceanSentinel uses the `microphone` type (VHF audio),
  HarborSentinel uses `location` (anchor watch), VesselKeeper needs none.
