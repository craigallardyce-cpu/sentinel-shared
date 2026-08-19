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
| `@sentinel/theme` | The fleet visual foundation: colour/font tokens, the Tailwind role map, night mode and glass surfaces | all three |
| `@sentinel/ui` | UI primitives built on the theme: `Button`, `Input`/`Select`/`Textarea`, `Toggle`, `Modal`/`ConfirmDialog`, `ToastProvider` + `toast`/`confirm`, `StatusPill`, `EmptyState` | all three |
| `@sentinel/vessel` | The fleet's canonical vessel identity record (`public.vessels` in the shared Supabase project): the `VesselProfile` type and best-effort read/write helpers | OceanSentinel, VesselKeeper |


## `@sentinel/theme`

One import gives an app the whole fleet look:

```css
@import "tailwindcss";
@import "@sentinel/theme/index.css";
@source "./";
```

| File | What it is |
|---|---|
| `tokens.css` | Raw values — surfaces, text, border, accent and status colours, fonts, glass, safe-area insets. The only place a hex should live. |
| `roles.css` | `@theme inline reference` map from tokens to Tailwind utilities: `bg-bg-card`, `text-cyan`, `bg-primary`, `font-heading`… Role meanings are fixed: **primary = cyan accent, secondary = orange, tertiary = warning (amber), error = red (alarm)**. |
| `night.css` | `.theme-night` / `.night-mode` red-shifted overrides. ok / warning / alarm keep three distinct luminances. |
| `glass.css` | `.glass-panel`, `.glass-divider`, `.glass-btn[-active]`, `.custom-scrollbar`. |

Status colours carry meaning and must come from the tokens, never the Tailwind
palette: `green` = ok, `warning`/`amber` = warning, `red` = alarm, `text-muted` =
offline. Cyan is the accent and is never a status colour. Apps may add their own
layout tokens in a local `@theme`, but the drift checker fails any app that declares
a literal-hex `--color-*` role or redefines a shared token at `:root`.

## `@sentinel/ui`

The primitives every app was re-implementing by hand. Consuming it takes three lines:

```json
"@sentinel/ui": "file:../sentinel-shared/ui"
```
```css
@source "../node_modules/@sentinel/ui/dist";   /* after @import "tailwindcss"; path relative to the CSS file */
```
```tsx
<ToastProvider><App /></ToastProvider>           /* once, at the root */
```

| Primitive | Replaces |
|---|---|
| `Button` (`primary` / `secondary` / `danger` / `ghost`, `sm` / `md`, `icon`, `loading`) | bespoke Tailwind buttons; ALL-CAPS labels — use sentence case |
| `Input`, `Select`, `Textarea` (`label`, `hint`, `error`, `required`) | 20+ hand-assembled input class strings; toast-as-validation |
| `Toggle` | copy-pasted iOS switches |
| `Modal` (focus trap, Escape, scrim click, safe-area padding, `tone="danger"`) and `ConfirmDialog` | 34 hand-rolled fixed overlays with eight different scrims |
| `toast.success/info/warning/error()` and `await confirm({...})` — imperative, work from any module once `ToastProvider` is mounted | `window.alert()` / `window.confirm()` (OS-styled dialogs on Android) and three toast implementations |
| `StatusPill` (`ok` / `warning` / `alarm` / `offline` / `info`) | ad-hoc emerald/amber/rose/cyan status dots |
| `EmptyState` (`panel` / `inline`) | bare italic sentences in one place, illustrated blocks in another |
| `Stepper` (moved here from `auth-ui`; token defaults, so wrappers are no longer needed) | three per-app 14-line wrappers |
| `useAppUpdater()` + `<UpdatePanel>` — one reducer over electron-shell's `updater:event`, with a web/Capacitor display-only fallback via `versionUrl` | three identical ~90-line updater state machines |
| `<SettingsShell>` + `SettingsSection`/`SettingsRow` — Display (night, brightness, keep-awake) → app sections → Updates → About | three differently-organised settings modals; no About surface existed |
| `<AppShell>` + `HeaderButton`/`HeaderGroup` — glass header, left dock ≥ lg, bottom bar < lg, safe-area aware, night-mode + brightness applied on `<html>` so portals follow | near-verbatim shells in OceanSentinel and VesselKeeper that had already drifted (2xl vs lg, h-16 vs h-12) |

`@sentinel/theme` gains `shell.css` (AppShell layout variables) and `motion.css`. The package is built with `tsc` and its `dist/` is committed, like `auth-ui`. It
imports only `react`, `react-dom` and `lucide-react`, which every app already
aliases in its Vite config. The drift checker fails an app that depends on it
without the `@source` line.

## `@sentinel/vessel`

One vessel identity for the fleet. The record lives in `public.vessels` in the
shared Supabase project (one row, keyed by `vessel_slug`, historically
`'sentinel'`); this package is just the `VesselProfile` type plus
`fetchVesselProfile()` / `saveVesselProfile()`. It takes any Supabase client as
an argument, so it has no runtime dependencies and never bundles a second client.

- **VesselKeeper owns the editor.** Its settings write `name` and `vessel_type`
  through to the shared record (alongside its own `vesselstate` row, which still
  holds engine/genset hours), and it now edits the MMSI too.
- **OceanSentinel reads and writes the same record** — MMSI as before, plus the
  boat name, and it adopts a name set elsewhere only while its own is still the
  seed value, so it never overwrites a name the user typed locally.
- **Writes are best-effort by design**: offline or signed-out returns false
  quietly and the app keeps its local value. Treat the shared record as
  eventually consistent, not a hard dependency.

Column grants decide who may write what (migrations `002` and `007` in the
MarinerSentinel Website repo): `anon` reads the identity columns and may update
only `mmsi`/`updated_at`; `authenticated` may also update `name`/`vessel_type`;
the site secrets are not client-readable at all.

## Review finding H6: investigated, then parked

H6 proposed standardising the fleet on one database adapter — VesselKeeper's, which
already spoke SQLite locally and Postgres against Supabase. Two packages were built
for it (`@sentinel/db`, `@sentinel/db-wasm`) and then **removed again**, because the
work was not paying for itself. What was learned is worth more than the code was:

- **HarborSentinel is the expensive migration.** 62 `db.prepare()` call sites across
  10 files, 12 of them in the anchor-watch polling loop. `better-sqlite3` is
  synchronous and any shared contract has to be async, so every one becomes an
  `await` cascading through the alarm path that findings S1 and S3 already flag.
- **OceanSentinel has no SQL driver at all**, only `pg`. Giving it local persistence
  through such a contract means adding a native SQLite module — importing the exact
  problem H6 exists to remove, since native modules cannot run under Capacitor.
  Node's built-in `node:sqlite` would avoid that but needs Node >= 22.5, and
  Electron 32 ships Node 20.
- **A non-native driver must run in a Web Worker.** Measured in a real browser, not
  read from docs: OPFS itself works on the main thread (`getDirectory` succeeds) but
  `FileSystemFileHandle.createSyncAccessHandle` is not exposed there, and SQLite's
  OPFS SyncAccessHandle Pool VFS requires it. No header or flag changes that. The
  plain OPFS VFS additionally wants COOP/COEP; the pool VFS avoids that but not the
  Worker requirement.
- **A durability layer must fail loudly.** The first driver caught the OPFS error and
  quietly returned an in-memory database. Every SQL test passed while nothing was
  being stored — only a close-and-reopen check caught it. If this is ever revisited,
  refuse to start rather than silently downgrade.
- **The motivating problem had a much cheaper fix.** The concern was HarborSentinel's
  Android build keeping its breadcrumb trail in localStorage with nothing trimming it.
  Samples are only appended when the vessel moves more than 2ft or an alarm is active,
  so growth is slower than it first appeared, and a retention cap in
  `useAnchorWatch.ts` (`capAnchorHistory`) bounds it in a few lines — the same
  keep-recent-detail, thin-the-past approach as the server-side sweep in S2.

Revisit this only if Android genuinely needs SQL-shaped local storage. Until then the
three apps keep their own persistence, which is duplication but not a defect.


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
