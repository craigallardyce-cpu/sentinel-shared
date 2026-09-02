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
| `@sentinel/marine` | Navigation math (haversine, bearing, XTE, CPA/TCPA), NMEA 0183 parsing, AIS/AIVDM decoding, the NMEA gateway rule and the TCP connection pool | all three |
| `@sentinel/weather` | Weather providers: NWS coverage routing and the Open-Meteo global model used everywhere NWS has no data | OceanSentinel (server + client) |
| `@sentinel/weather-ui` | NWS alert/forecast React components and helpers | OceanSentinel, HarborSentinel |
| `@sentinel/electron-shell` | Electron main-process building blocks (auto-updater IPC, Linux GPU compat, window diagnostics, tray, power-save blocker, the hidden title bar) | all three |
| `@sentinel/auth-ui` | Supabase-backed `AuthScreen` and the `Stepper` input control | all three |
| `@sentinel/theme` | The fleet visual foundation: colour/font tokens, the Tailwind role map, night mode and glass surfaces | all three |
| `@sentinel/ui` | UI primitives built on the theme: `Button` (with a lit `active` state and a `dense` size), `Input`/`Select`/`Textarea`, `UnitField` for instrument cells, `Toggle`, `Modal`/`ConfirmDialog`, `ToastProvider` + `toast`/`confirm`, `StatusPill`, `EmptyState` | all three |
| `@sentinel/vessel` | The fleet's canonical vessel identity record (`public.vessels` in the shared Supabase project): the `VesselProfile` type and best-effort read/write helpers | OceanSentinel, VesselKeeper |
| `@sentinel/settings` | The settings registry: one declaration per setting — type, default, and the scopes allowed to hold it — resolved through account/vessel/host/device layers | (landing; consumed by nobody yet) |


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

On desktop the header **is** the title bar. Each app's `main.cjs` spreads
`hiddenTitleBarOptions()` from `@sentinel/electron-shell` into its `BrowserWindow`,
which hides the native bar and leaves the OS window-controls cluster painted
top-right, 32px tall. `shell.css` reads `env(titlebar-area-height)` to keep the
floating header clear of the cluster and makes the strip above it (and the header
itself, minus its buttons) a drag region; outside Electron the env() is undefined
and nothing changes. The cluster follows night mode: `AppShell` calls
`window.appShell.setNightMode`, which the preload sends over `shell:night-mode` to
`setupTitleBarOverlay()`.

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

## `@sentinel/settings`

One declaration per setting, in one place, replacing 81 flat `localStorage` keys
spread over 55 files in two apps. A setting says what it is, which layers are
allowed to hold it, and — usually — nothing about what it should be:

```ts
'nmea.gateway.host': defineSetting({
  scopes: ['vessel', 'host', 'device'],
  type: hostType,
  label: 'NMEA gateway address',
  placeholder: 'e.g. 10.10.10.1',
  legacy: { ocean: ['vessel_nmea_local_host'] },
})
```

**Almost nothing has a default, and that is the design.** A default is a value
nobody chose, and every one this fleet shipped was wrong for every install but
the developer's: a home LAN address as the NMEA gateway, a specific real boat as
the boat name. Each looked like a helpful head start and each was invisible, because
a pre-filled field reads as a configured field. So a setting the owner is the
authority on stays `unset` until they set it, `get()` returns `undefined`, and
`placeholder` is what tells them the shape of value that belongs there.

What keeps a default is what the app needs before anybody has opened the settings:
on/off toggles, which have to be one way or the other; screen brightness, which the
first frame has to render at; and the auto-dim interval, without which its toggle
switches on and does nothing. `createRegistry` requires a default on every `bool`,
and a fleet test names the full list so it cannot quietly grow.

Reading walks `account → vessel → host → device` and keeps the **last** layer that
answered, so a device override beats the boat, which beats the account. `resolve()`
returns the value *and* its `source` — a scope, `default`, or `unset` — which is what
lets a settings screen distinguish "from the boat" from "set on this device" from
"nobody has said yet", and offer to clear an override.

That layering is not a nicety. The NMEA gateway has two right answers at once —
the boat's multiplexer is at a fixed address, and a phone in the cabin reaches it
through the PC — and having only one place to put it is why HarborSentinel strips
the host and port out of its payload on Android, so a phone cannot overwrite the
PC's hardware settings. There is deliberately no `nmea.remote.*` group: a device
off the boat reaches the same local address over the VPN, so a second address for
one gateway would be the shape this package exists to prevent.

Four more properties, each answering something that has already gone wrong here:

- **Partial writes by construction.** `set()` takes one key. There is no
  object-shaped write, so the shape that made `POST /config` null every omitted
  field cannot be spelled.
- **Reads are lenient, writes are strict.** A layer holding a value this build
  cannot parse is skipped, not fatal — instead of the `NaN` that
  `parseInt(localStorage.getItem(...))` hands on today. A write that does not
  parse, or names a scope the setting does not declare, throws.
- **Empty is absence, uniformly.** A cleared field is an unset field; the UI calls
  `clear()` rather than writing `''`, so no screen has to ask which kind of nothing
  it is looking at.
- **Adoption loses nothing.** A setting declares where it used to live per app
  (`harbor_sentinel_keep_awake` and `ocean_sentinel_keep_awake` are one setting),
  and the device store reads those names when the namespaced key is absent —
  read-only, so a read never rewrites somebody's storage.

Stores are injected, so the package has no runtime dependencies and adds none to
the three apps. It ships the registry, the validator set, the `device` store
(localStorage) and the two cloud stores:

| Layer | Store | Where it reads |
|---|---|---|
| `account` | `createAccountStore(client, userId)` | `public.user_settings.settings` (jsonb) |
| `vessel` | `createVesselStore(client)` | `public.vessel_settings.settings` (jsonb) for configuration, `public.vessels` columns for identity |
| `device` | `createDeviceStore(storage, {app, registry})` | `localStorage`, namespaced `sentinel.*` |

The vessel layer reads two tables on purpose. `public.vessels` is publicly
readable — it backs the shared voyage pages — so a boat's identity belongs there
and its configuration must not: putting the settings blob on that row published
the gateway address to every signed-in user of the project, which is why
`public.vessel_settings` exists and is owner-only. Nothing downstream has to know
which storage a key uses; `settings.get('vessel.name')` and
`settings.get('nmea.gateway.host')` read the same.

Cloud reads are synchronous and *empty* until `load()` resolves, then promote in
and notify. That is a requirement, not a limitation: every settings read in
OceanSentinel is a `useState(() => ...)` initialiser that runs during the first
render, and a layer that cannot answer then must say so rather than block. Cloud
writes merge server-side (`merge_user_settings`, `merge_vessel_settings`) so a
partial write stays partial — a client sending back a blob it read a moment ago
would let two devices erase each other's settings.

The `host` layer has no store yet; it lands with the NMEA work.

Cloud layers keep an offline cache of their last successful load, so they answer
on the first render and keep answering with no network — which on a boat is most
of the time. A live read replaces it wholesale, so it is never authoritative.

**Adopting loses nothing, but not for free.** A setting declares where it used to
live per app, and the device store reads those names when the namespaced key is
absent. That only covers settings declared at `device` scope, because a store is
never consulted for a scope its setting does not declare — so anything held at
`account` or `vessel` has its old value sitting in `localStorage` where nothing
will read it. `migrateLegacyKeys()` carries those up once and records a marker.
Call it **after** every cloud layer has finished `load()`: a setting reads as
unconfigured while its layer is still loading, and migrating into that would push
a stale local value over what the account already holds.

**Status: consumed by nobody.** It is deliberately unwired, so it can be reviewed
and built against without any app changing behaviour.

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
