# @sentinel/charts

Nautical chart provider registry shared across the Mariner Sentinel fleet — coverage-aware
layer selection, tile URL construction, and the licensing metadata that goes with them.

It exists so that adding a chart source is one entry in one array, rather than a change to a
tile proxy, a layer picker and a fallback list in three separate applications.

## Install

```bash
npm install @sentinel/charts
```

## Use

Configuration is passed in rather than read from the environment, so the same module serves an
Electron backend, a hosted tile proxy and a marketing site without any of them having to agree
on variable names.

```js
import { createChartRegistry } from '@sentinel/charts';

const registry = createChartRegistry({ maptilerKey: process.env.MAPTILER_KEY });

// Pick the best layer for a position: official charts where they exist, imagery elsewhere.
registry.selectBaseProvider(45.90, -60.80).id;   // 'chs_enc'   (Bras d'Or Lake)
registry.selectBaseProvider(41.49, -71.31).id;   // 'noaa_enc'  (Newport, RI)
registry.selectBaseProvider(39.56, 2.63).id;     // satellite   (Palma — no HO coverage)

// Build a tile URL.
const noaa = registry.getProvider('noaa_enc');
noaa.build(12, 1206, 1539, { useMetric: false });

// Client-safe descriptors. Never includes the key or the URL builders.
registry.describe();
```

## Licensing is enforced, not documented

Supplying a MapTiler key activates the licensed basemaps **and withdraws the unlicensed
`osm` and `satellite` entries**, so a configured host cannot serve tiles it has no right to.
Without a key those two remain so a map still renders during development, but they must not
reach production:

- OpenStreetMap's tile usage policy forbids the caching proxies these applications keep.
- Esri World Imagery requires a licence for commercial use.

Every provider carries an `attribution` string. Several sources licence on the condition that
it is displayed — OpenStreetMap and OpenSeaMap are CC-BY-SA — so it is a requirement rather
than a courtesy. The MapTiler Free plan is additionally non-commercial and requires the
MapTiler logo; a paid plan needs only the `© MapTiler` credit already carried here.

## Coverage is tested against real geometry where possible

Bounding boxes are a coarse fallback and get this wrong in ways that matter. A box around the
US east coast also contains the Bahamas, which NOAA does not chart — selecting NOAA there
renders a near-empty chart *and* suppresses the imagery fallback that is genuinely more useful
in those waters.

Hosts that carry the ENC catalog can supply an exact test:

```js
createChartRegistry({
  maptilerKey,
  // Return null when the catalog has not loaded; the registry falls back to bounding boxes.
  noaaCellCoverage: (lat, lon) => isPointInAnyChartCell(lat, lon)
});
```

Note that "is any cell here" is also insufficient: NOAA's small-scale overview cells reach well
past US waters, so a usable-scale threshold (coastal, 1:350,000 or better) is what actually
answers the question.

## Providers

| id | kind | authority | coverage |
|---|---|---|---|
| `noaa_enc` | base | official | US waters |
| `chs_enc` | base | official | Canadian waters |
| `maptiler_satellite` | base | reference | worldwide (key required) |
| `maptiler_streets` | base | reference | worldwide (key required) |
| `satellite` | base | reference | worldwide (unlicensed, dev only) |
| `osm` | base | reference | worldwide (unlicensed, dev only) |
| `seamarks` | overlay | reference | worldwide |
| `bathymetry` | overlay | reference | worldwide |
| `none` | base | — | renders nothing |

NOAA and CHS run the same Esri Maritime Chart Service extension with identical S-52 layer
numbering and the same ECDIS `display_params` contract, so one builder serves both, including
the metric/feet depth-unit toggle.

## Not for navigation

The official chart services are published for reference and carry a "not for navigation"
designation. This package makes them convenient to display; it does not make them a navigation
system, and nothing here should be presented as one.

## Licence

MIT
