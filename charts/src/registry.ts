/**
 * Chart provider registry, shared across the Mariner Sentinel fleet.
 *
 * Single source of truth for every map layer any of the apps can display. Tile proxies,
 * layer pickers and coverage-aware auto-select all read from here rather than branching on
 * hardcoded provider names. Adding a provider — including a future commercial one — should
 * mean adding an entry here and nothing else.
 *
 * BASEMAP LICENSING
 * Supplying a MapTiler key activates the licensed basemaps and withdraws the unlicensed
 * `osm` and `satellite` entries, so a configured host cannot serve tiles it has no right to.
 * Without a key those two remain so the map still renders in development, but they must not
 * reach production: OpenStreetMap's tile policy forbids the caching proxies these apps keep,
 * and Esri World Imagery requires a licence for commercial use.
 *
 * The MapTiler Free plan is additionally non-commercial and requires the MapTiler logo to be
 * displayed; a paid plan needs only the "© MapTiler" credit carried in the attribution below.
 */

import type {
  ChartProvider,
  ChartRegistry,
  ProviderDescriptor,
  RegistryOptions,
  TileOptions
} from './types.js';

const MERCATOR_MAX = 20037508.3427892;

/** Web Mercator bbox for an XYZ tile, as the Esri MapServer export endpoints expect. */
export function tileBboxMeters(z: number, x: number, y: number): string {
  const size = (MERCATOR_MAX * 2) / Math.pow(2, Number(z));
  const xmin = -MERCATOR_MAX + Number(x) * size;
  const ymax = MERCATOR_MAX - Number(y) * size;
  return `${xmin},${ymax - size},${xmin + size},${ymax}`;
}

const NOAA_MCS =
  'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/MapServer';
const CHS_MCS =
  'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/chs/ENC_MaritimeChartService/MapServer/exts/MaritimeChartService/MapServer';

/**
 * NOAA and CHS both run Esri's Maritime Chart Service extension with identical S-52 layer
 * numbering and the same ECDIS display_params contract, so one builder serves both.
 */
export function maritimeChartService(baseUrl: string) {
  return (z: number, x: number, y: number, opts: TileOptions = {}): string => {
    const displayParams = {
      ECDISParameters: {
        DynamicParameters: {
          Parameter: [
            { name: 'DisplayCategory', value: '1,2,4' },
            { name: 'DisplayDepthUnits', value: opts.useMetric ? 1 : 2 }
          ]
        }
      }
    };
    // Built by hand rather than with URLSearchParams so the package needs neither the DOM
    // lib nor Node types, and stays usable from a browser bundle and a server alike.
    const params: Array<[string, string]> = [
      ['bbox', tileBboxMeters(z, x, y)],
      ['bboxSR', '102100'],
      ['imageSR', '102100'],
      ['size', '256,256'],
      ['format', 'png32'],
      ['transparent', 'true'],
      ['f', 'image'],
      ['layers', 'show:0,1,2,4,5,6,7'],
      ['display_params', JSON.stringify(displayParams)]
    ];
    const qs = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return `${baseUrl}/export?${qs}`;
  };
}

/** Providers withdrawn once a licensed basemap is configured. */
const UNLICENSED_IDS = new Set(['osm', 'satellite']);
/** Providers available only when a MapTiler key is supplied. */
const MAPTILER_IDS = new Set(['maptiler_satellite', 'maptiler_streets']);

function buildProviders(options: RegistryOptions): ChartProvider[] {
  const key = options.maptilerKey ?? '';

  return [
    {
      id: 'noaa_enc',
      label: 'US ENC',
      kind: 'base',
      authority: 'official',
      background: 'light',
      // Continental US, Alaska, Hawaii, Puerto Rico / USVI, Guam / CNMI. These are a coarse
      // fallback; prefer the exact cell test where a host can supply one.
      coverage: [
        { west: -128, south: 23, east: -65, north: 50 },
        { west: -180, south: 50, east: -128, north: 72 },
        { west: -179, south: 17, east: -153, north: 24 },
        { west: -68.5, south: 17, east: -64, north: 19 },
        { west: 143, south: 12, east: 147, north: 21 }
      ],
      attribution: 'NOAA Maritime Chart Service — not for navigation',
      maxZoom: 19,
      referer: 'https://gis.charttools.noaa.gov/',
      covers: options.noaaCellCoverage,
      build: maritimeChartService(NOAA_MCS)
    },
    {
      id: 'chs_enc',
      label: 'CA ENC',
      kind: 'base',
      authority: 'official',
      background: 'light',
      coverage: [{ west: -141, south: 41, east: -52, north: 84 }],
      attribution: 'Canadian Hydrographic Service — not for navigation',
      maxZoom: 19,
      referer: 'https://egisp.dfo-mpo.gc.ca/',
      build: maritimeChartService(CHS_MCS)
    },
    {
      id: 'maptiler_satellite',
      label: 'Satellite',
      kind: 'base',
      authority: 'reference',
      background: 'dark',
      coverage: null,
      attribution: '© MapTiler © OpenStreetMap contributors',
      maxZoom: 20,
      // No Referer: MapTiler authenticates on the key, optionally narrowed by User-Agent, and
      // reads Referer as an Origin substitute — a bogus one would fight an origin restriction.
      build: (z, x, y) => `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${key}`
    },
    {
      id: 'maptiler_streets',
      label: 'Street',
      kind: 'base',
      authority: 'reference',
      background: 'light',
      coverage: null,
      attribution: '© MapTiler © OpenStreetMap contributors',
      maxZoom: 20,
      build: (z, x, y) =>
        `https://api.maptiler.com/maps/streets-v2/256/${z}/${x}/${y}.png?key=${key}`
    },
    {
      id: 'satellite',
      label: 'Satellite',
      kind: 'base',
      authority: 'reference',
      background: 'dark',
      coverage: null,
      attribution: 'Esri World Imagery',
      maxZoom: 19,
      referer: 'https://tiles.arcgis.com/',
      build: (z, x, y) =>
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    },
    {
      id: 'osm',
      label: 'Street',
      kind: 'base',
      authority: 'reference',
      background: 'light',
      coverage: null,
      attribution: 'OpenStreetMap contributors',
      maxZoom: 19,
      referer: 'https://tile.openstreetmap.org/',
      build: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
    },
    {
      id: 'seamarks',
      label: 'Seamarks',
      kind: 'overlay',
      authority: 'reference',
      background: 'transparent',
      coverage: null,
      attribution: 'OpenSeaMap contributors',
      maxZoom: 18,
      referer: 'https://www.openseamap.org/',
      build: (z, x, y) => `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png`
    },
    {
      id: 'bathymetry',
      label: 'Depth',
      kind: 'overlay',
      authority: 'reference',
      background: 'transparent',
      coverage: null,
      attribution: 'EMODnet Bathymetry / GEBCO',
      maxZoom: 12,
      referer: 'https://emodnet.ec.europa.eu/',
      build: (z, x, y) =>
        `https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/${z}/${x}/${y}.png`
    },
    {
      id: 'none',
      label: 'None',
      kind: 'base',
      authority: 'reference',
      background: 'dark',
      coverage: null,
      attribution: '',
      maxZoom: 19,
      build: null
    }
  ];
}

function coversPoint(provider: ChartProvider, lat: number, lon: number): boolean {
  // An exact test wins where the host can supply one; it returns null when it cannot answer.
  if (typeof provider.covers === 'function') {
    const exact = provider.covers(lat, lon);
    if (exact !== null && exact !== undefined) return exact;
  }
  if (!provider.coverage) return true;
  return provider.coverage.some(
    (b) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north
  );
}

/**
 * Builds a registry for one host.
 *
 * Configuration is passed in rather than read from the environment so the same module serves
 * an Electron backend, a hosted proxy and a marketing site without any of them having to
 * agree on variable names.
 */
export function createChartRegistry(options: RegistryOptions = {}): ChartRegistry {
  const hasLicensedBasemap = Boolean(options.maptilerKey);
  const all = buildProviders(options);

  // Licensed basemaps replace the unlicensed ones rather than sitting alongside them.
  const active = all.filter((p) =>
    hasLicensedBasemap ? !UNLICENSED_IDS.has(p.id) : !MAPTILER_IDS.has(p.id)
  );

  const byId = new Map(active.map((p) => [p.id, p]));
  const fallbackId =
    options.fallbackId ?? (hasLicensedBasemap ? 'maptiler_satellite' : 'satellite');

  const getProvider = (id: string): ChartProvider | null => byId.get(id) ?? null;

  return {
    all,
    active,
    hasLicensedBasemap,
    getProvider,
    selectBaseProvider(lat: number, lon: number): ChartProvider | null {
      if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
        return getProvider(fallbackId);
      }
      const official = active.find(
        (p) => p.kind === 'base' && p.authority === 'official' && coversPoint(p, lat, lon)
      );
      return official ?? getProvider(fallbackId);
    },
    describe(): ProviderDescriptor[] {
      return active.map(({ id, label, kind, authority, background, coverage, attribution, maxZoom, build }) => ({
        id,
        label,
        kind,
        authority,
        background,
        coverage,
        attribution,
        maxZoom,
        renders: build !== null
      }));
    }
  };
}
