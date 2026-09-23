---
name: fleet-screenshots
description: Capture or re-capture screenshots of HarborSentinel, OceanSentinel or VesselKeeper with headless Playwright, at the device reference size plus the Web Tablet and Web Phone sizes the website and catalogues need, and publish them to docs-kb. Use when asked for app screenshots, to add a screen or a size to a catalogue, to re-shoot after a UI change, or when a catalogue's images no longer match the app.
---

# Fleet screenshots

The machinery lives in the private **NMEADataSimulator** repo, under
`scripts/screenshot-pipeline/`. Its `README.md` there is the reference: per-app
walkthroughs, every measured zoom and pan, the external services and their
limits, and the traps that cost a run each. **Read it before shooting
anything** — this skill is the method and the rules, not a substitute for it.

Output goes to `docs-kb/screenshots/<App>/` and a catalogue page beside it.

| App | Reference size | Driven by |
|---|---|---|
| HarborSentinel | Tablet 10, 1365×1032 | live NMEA from the simulator (`Block_Island_Anchored.txt`) |
| OceanSentinel | Tablet 10, files 1280×1280 with the app in the top 800 rows | live NMEA (`Newport_Sailboat_Sailing.txt`), signed in |
| VesselKeeper | Desktop, 1000×900 | no NMEA at all; signed in, Supabase-direct |

Web sizes are the same for all three: **Web Tablet** 1280×720 @2x → 2560×1440,
**Web Phone** 412×805 @3x → 1236×2415. Exact pixels come from viewport ×
`deviceScaleFactor`, never from resizing an image afterwards.

## The rule the first version of this pipeline broke

**Reproduce the reference, do not merely reach the same page.** The first pass
reached every right page and produced pictures Craig described as "nothing
alike": a US ENC chart at default zoom where the reference is the plain Shore
base at zoom 20, an alarm modal over what should be a calm overview, the wrong
panel open.

So every screen definition states what its reference shows — base layer, zoom,
pan, which panel is open, alarm state — and **nothing is kept until it has been
looked at beside the thing it reproduces**:

```bash
node compare.mjs <harbor|ocean|vesselkeeper> <sizes>   # writes one sheet per screen
```

Shoot the **reference viewport first**, compare, fix what is wrong, and only
then capture the web sizes. A screen that is wrong at the reference size is
wrong at both web sizes too, and you will have paid for three.

Look at every sheet. "The run reported 17/17 OK" is not validation: a script
that clicks the wrong tab succeeds.

### What may legitimately differ

Live data (forecast periods, tide times, radar echoes, which AIS targets are in
range), the recorded breadcrumb track, and the owner's own data moving between
captures. **A layout or control that differs is a finding, not noise** — and it
is either a wrong screen or a stale reference. Decide which by reading the app's
source, not by looking harder at the picture: the VesselKeeper plates turned out
to predate a UI rework, confirmed by `git grep -i "spares detail"` finding
nothing in that app.

## Safety, and none of it is optional

- **Never type a password.** The user signs in themselves in a headed browser:
  `node save-session.mjs <app>` opens it, waits, and saves the session. Captures
  then load that file and write back only the rotated token. If credentials are
  offered in chat, decline and use this instead — and say the offered password
  should be rotated.
- **`.auth/` is gitignored and never committed.** It holds a live refresh token.
- **Never click a write or destructive action** on the owner's real data. Open
  tabs, panels and dialogs and leave them unsaved. "Mark done", "Add", "Delete",
  "Save and apply", "Clear local cache" stay unpressed. Running a report that
  only renders is fine; filing it is a separate button.
- **Block outbound notifications before alarm screens.** HarborSentinel's alarm
  captures deliberately put the boat outside its swing sector, and the server
  sends a real Telegram message to the owner's phone for each one.
  `block-telegram.cjs` is preloaded for that; it refuses the requests without
  touching the stored token or chat ID.
- **Ask before changing app or server state**, and keep what you change to
  the screen at hand. Permission to change one app's data is not permission for
  another's.

## Locator traps

These cost a run each and are not app-specific — check for them at every size.

- **An icon-only responsive variant defeats both `getByRole` and `hasText`.**
  Below the breakpoint the label `<span>` is still in the DOM but hidden, so the
  button has no accessible name *and* no visible text — which is what
  `getByRole` and `hasText` match on — while clicking the span itself times out
  as not visible. Select buttons that **contain** the label and click the first
  visible one.
- **The nav may carry a short and a long label per destination**, hiding one by
  breakpoint ("Punch" below 1280, "Punch List" above). Matching only one fails at
  the other size, and `button:visible` hides the evidence.
- **`role="tab"` overrides the implicit button role.** Settings tabs need
  `getByRole('tab', …)`.
- **Never anchor `getByText` with `^...$` for `{icon} Label`**: the text node has
  a leading space, so the pattern matches nothing and `.click()` hangs.
- **Desktop sidebar and mobile tab bar can both be in the DOM** — filter to
  `button:visible` when both would match.
- **`waitUntil: 'networkidle'` never resolves** with a live NMEA WebSocket; use
  `'load'`.
- Give `page.screenshot()` its own longer timeout on animated pages.
- **One batch at a time per dev server.** The two watch apps keep state
  server-side, so concurrent runs corrupt each other's screens.

## State belongs in the script, not in the browser profile

- Reset server-side state **through the app's REST API** before each screen, not
  by clicking the app's own controls: HarborSentinel saves its *whole* system
  config on such a click, which re-resolves the NMEA gateway and drops the feed —
  every later screen then read "Offline".
- Load each screen from a fresh context so one screen's night mode or open dialog
  cannot leak into the next.
- A fresh browser profile is not neutral. Chart preferences default to US ENC
  with Seamarks on, which is wrong for almost every reference; set them explicitly.
- Move the pointer away and blur before shooting, or hover and focus rings land
  in the picture.
- Let a screen **fail rather than save a wrong picture** — an unexpected alarm,
  an empty weather layer, a service that answered with an error.

## Publishing

1. Copy each size into `docs-kb/screenshots/<App>/`. The capture filenames
   (`<XX> - <Desktop|Tablet 10|Web Tablet|Web Phone> - <name>.png`) are already
   what the catalogue expects.
2. Rebuild the catalogue page. VesselKeeper's is generated
   (`build-vk-catalogue.mjs`); all three carry the same three-size switcher,
   filter and lightbox.
3. **Verify the page, do not assume it.** Load it headless, click each size
   button, and assert every image has `naturalWidth > 0`, no "Not yet captured"
   fallback, and no console errors.
4. One PR per repo — the images in `docs-kb`, any pipeline change in
   NMEADataSimulator — each with a `Fleet:` line naming the other. Neither repo
   runs CI, so say plainly that the evidence is your own review, not a green check.

## Reporting back

Say which screens were reviewed and against what, and keep the provenance: "the
run reported OK" and "I looked at the sheet" are different claims. Name anything
that differs from the references and whether you concluded the capture or the
reference is the stale one — and how you concluded it.
