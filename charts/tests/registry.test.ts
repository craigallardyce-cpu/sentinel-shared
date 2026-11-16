import { describe, it, expect } from 'vitest';
import { createChartRegistry, tileBboxMeters, PROXY_MAX_ZOOM } from '../src/registry.js';
import { CHS_WATERS } from '../src/chsCoverage.js';

describe('licensing posture', () => {
  it('withdraws the unlicensed basemaps once a key is supplied', () => {
    const licensed = createChartRegistry({ maptilerKey: 'test-key' });
    const ids = licensed.active.map((p) => p.id);

    expect(ids).toContain('maptiler_satellite');
    expect(ids).toContain('maptiler_streets');
    // The whole point: a configured host must not be able to serve these.
    expect(ids).not.toContain('osm');
    expect(ids).not.toContain('satellite');
    expect(licensed.hasLicensedBasemap).toBe(true);
  });

  it('falls back to the unlicensed pair only when no key is configured', () => {
    const dev = createChartRegistry();
    const ids = dev.active.map((p) => p.id);

    expect(ids).toContain('osm');
    expect(ids).toContain('satellite');
    expect(ids).not.toContain('maptiler_satellite');
    expect(dev.hasLicensedBasemap).toBe(false);
  });

  it('never exposes the key through the client-facing descriptors', () => {
    const registry = createChartRegistry({ maptilerKey: 'super-secret-key' });
    expect(JSON.stringify(registry.describe())).not.toContain('super-secret-key');
  });

  it('gives every provider a non-empty attribution, except the blank layer', () => {
    const registry = createChartRegistry({ maptilerKey: 'k' });
    for (const p of registry.active) {
      if (p.id === 'none') continue;
      expect(p.attribution.length, `${p.id} must carry attribution`).toBeGreaterThan(0);
    }
  });
});

describe('coverage-aware selection', () => {
  const registry = createChartRegistry({ maptilerKey: 'k' });
  const pick = (lat: number, lon: number) => registry.selectBaseProvider(lat, lon)?.id;

  it('prefers the official chart service in its own waters', () => {
    expect(pick(41.49, -71.31)).toBe('noaa_enc'); // Newport RI
    expect(pick(45.9, -60.8)).toBe('chs_enc'); // Bras d'Or Lake
  });

  it('falls back to imagery where no hydrographic office covers the position', () => {
    expect(pick(39.56, 2.63)).toBe('maptiler_satellite'); // Palma
    expect(pick(-17.53, -149.57)).toBe('maptiler_satellite'); // Tahiti
  });

  it('falls back on invalid input rather than throwing', () => {
    expect(pick(NaN, NaN)).toBe('maptiler_satellite');
  });

  it('lets an exact coverage test override the bounding boxes', () => {
    // The US east coast box also contains the Bahamas, which NOAA does not chart. A host
    // carrying the cell catalog supplies the real answer.
    const withCatalog = createChartRegistry({
      maptilerKey: 'k',
      noaaCellCoverage: (lat, lon) => !(lat > 20 && lat < 27 && lon > -80 && lon < -72)
    });
    expect(withCatalog.selectBaseProvider(25.08, -77.35)?.id).toBe('maptiler_satellite');
    expect(withCatalog.selectBaseProvider(41.49, -71.31)?.id).toBe('noaa_enc');
  });

  it('falls through to the boxes when the exact test cannot answer', () => {
    const notReady = createChartRegistry({ maptilerKey: 'k', noaaCellCoverage: () => null });
    expect(notReady.selectBaseProvider(41.49, -71.31)?.id).toBe('noaa_enc');
  });
});

describe('the border between US and Canadian charts', () => {
  // [name, lat, lon]. Harbours and anchorages on each side, chosen close to the line.
  const AMERICAN: Array<[string, number, number]> = [
    ['Neah Bay', 48.37, -124.61], ['Port Angeles', 48.13, -123.43], ['Roche Harbor', 48.61, -123.15],
    ['Friday Harbor', 48.535, -123.015], ['Stuart Island, Reid Harbor', 48.675, -123.2],
    ['Sucia Island', 48.76, -122.9], ['Point Roberts', 48.975, -123.07], ['Blaine', 48.99, -122.76],
    ['Bellingham', 48.75, -122.5], ['Ketchikan', 55.34, -131.65], ['Juneau', 58.3, -134.42],
    ['Sitka', 57.05, -135.33], ['Craig', 55.48, -133.15], ['Prudhoe Bay', 70.4, -148.5],
    ['Grand Portage', 47.96, -89.68], ['Isle Royale, Rock Harbor', 48.145, -88.485],
    ['Copper Harbor', 47.47, -87.89], ['Marquette', 46.54, -87.39], ['Whitefish Point', 46.77, -84.96],
    ['Sault Ste Marie, Michigan', 46.5, -84.35], ['De Tour Village', 45.99, -83.9],
    ['Drummond Island', 46.02, -83.75], ['Mackinac Island', 45.85, -84.62], ['Alpena', 45.06, -83.43],
    ['Harbor Beach', 43.85, -82.64], ['Port Huron', 42.97, -82.425], ['Algonac', 42.62, -82.53],
    ['Detroit', 42.33, -83.04], ['Put-in-Bay', 41.655, -82.82], ['Kelleys Island', 41.6, -82.71],
    ['Cleveland', 41.51, -81.7], ['Erie', 42.14, -80.09], ['Buffalo', 42.88, -78.89],
    ['Youngstown, New York', 43.25, -79.05], ['Rochester', 43.26, -77.6], ['Oswego', 43.46, -76.51],
    ['Sackets Harbor', 43.95, -76.12], ['Cape Vincent', 44.13, -76.33], ['Clayton', 44.24, -76.09],
    ['Alexandria Bay', 44.34, -75.92], ['Ogdensburg', 44.7, -75.5], ['Rouses Point', 44.99, -73.37],
    ['Eastport', 44.905, -66.985], ['Lubec', 44.86, -66.985], ['Cutler', 44.66, -67.2],
    ['Bar Harbor', 44.39, -68.2], ['Newport, Rhode Island', 41.49, -71.31],
  ];
  const CANADIAN: Array<[string, number, number]> = [
    ['Victoria', 48.42, -123.37], ['Sooke', 48.37, -123.73], ['Sidney', 48.65, -123.39],
    ['Port Renfrew', 48.555, -124.42], ['Bamfield', 48.83, -125.14], ['Tofino', 49.15, -125.9],
    ['Ganges', 48.855, -123.5], ['Bedwell Harbour', 48.75, -123.23], ['Nanaimo', 49.17, -123.93],
    ['Vancouver', 49.29, -123.11], ['White Rock', 49.02, -122.8], ['Port Hardy', 50.72, -127.48],
    ['Bella Bella', 52.16, -128.14], ['Prince Rupert', 54.31, -130.33], ['Masset', 54.02, -132.15],
    ['Tuktoyaktuk', 69.45, -133.03], ['Kenora', 49.77, -94.49], ['Thunder Bay', 48.43, -89.21],
    ['Marathon', 48.72, -86.38], ['Wawa, Michipicoten', 47.93, -84.85], ['Batchawana Bay', 46.92, -84.55],
    ['Thessalon', 46.25, -83.55], ['Blind River', 46.18, -82.96], ['Gore Bay', 45.92, -82.47],
    ['Little Current', 45.98, -81.93], ['Killarney', 45.97, -81.51], ['Tobermory', 45.26, -81.66],
    ['Parry Sound', 45.34, -80.04], ['Midland', 44.75, -79.89], ['Kincardine', 44.18, -81.64],
    ['Goderich', 43.74, -81.72], ['Grand Bend', 43.31, -81.76], ['Belle River', 42.3, -82.71],
    ['Leamington', 42.03, -82.6], ['Pelee Island', 41.77, -82.66], ['Erieau', 42.26, -81.91],
    ['Port Stanley', 42.66, -81.21], ['Port Dover', 42.78, -80.2], ['Port Colborne', 42.87, -79.25],
    ['Port Dalhousie', 43.2, -79.27], ['Hamilton', 43.27, -79.85], ['Toronto', 43.63, -79.38],
    ['Cobourg', 43.95, -78.17], ['Picton', 44.0, -77.14], ['Kingston', 44.23, -76.48],
    ['Ottawa', 45.43, -75.7], ['Montreal', 45.5, -73.55], ['Quebec City', 46.81, -71.2],
    ['Tadoussac', 48.14, -69.72], ['Rimouski', 48.45, -68.53], ['Saint John', 45.27, -66.06],
    ['Grand Manan, North Head', 44.76, -66.75], ['Digby', 44.62, -65.76], ['Yarmouth', 43.84, -66.12],
    ['Halifax', 44.65, -63.57], ['Bras d\'Or Lake', 45.9, -60.8], ['St John\'s', 47.56, -52.71],
  ];

  const boxesOnly = createChartRegistry({ maptilerKey: 'k' });

  it.each(AMERICAN)('%s gets the US chart', (_name, lat, lon) => {
    expect(boxesOnly.selectBaseProvider(lat, lon)?.id).toBe('noaa_enc');
  });

  it.each(CANADIAN)('%s gets the Canadian chart', (_name, lat, lon) => {
    expect(boxesOnly.selectBaseProvider(lat, lon)?.id).toBe('chs_enc');
  });

  it('answers the same for a client that tests the published boxes in list order', () => {
    // HarborSentinel and the website's clients do this with `describe()`, without the registry.
    const charts = boxesOnly.describe().filter((p) => p.kind === 'base' && p.authority === 'official');
    const pick = (lat: number, lon: number) =>
      charts.find((p) =>
        p.coverage!.some((b) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north)
      )?.id;
    for (const [name, lat, lon] of AMERICAN) expect(pick(lat, lon), name).toBe('noaa_enc');
    for (const [name, lat, lon] of CANADIAN) expect(pick(lat, lon), name).toBe('chs_enc');
  });

  it('is not overruled in Canadian water by a NOAA cell that reaches across the line', () => {
    // NOAA's cells are rectangles and the ones along the border take in the far shore.
    const withCatalog = createChartRegistry({ maptilerKey: 'k', noaaCellCoverage: () => true });
    expect(withCatalog.selectBaseProvider(48.42, -123.37)?.id).toBe('chs_enc'); // Victoria
    expect(withCatalog.selectBaseProvider(48.13, -123.43)?.id).toBe('noaa_enc'); // Port Angeles
  });

  it('still gives Canadian water outside the boxes the Canadian chart when NOAA has no cell', () => {
    // Gananoque is in the Thousand Islands, where no box is drawn. A host with the cell
    // catalog knows NOAA does not chart it; a host without one keeps the US chart, as before.
    const withCatalog = createChartRegistry({ maptilerKey: 'k', noaaCellCoverage: () => false });
    expect(withCatalog.selectBaseProvider(44.33, -76.16)?.id).toBe('chs_enc');
    expect(boxesOnly.selectBaseProvider(44.33, -76.16)?.id).toBe('noaa_enc');
    // And nothing outside CHS's reach is given to it.
    expect(withCatalog.selectBaseProvider(25.08, -77.35)?.id).toBe('maptiler_satellite');
  });

  it('keeps every CHS box north of 41°N and a real rectangle', () => {
    for (const b of CHS_WATERS) {
      expect(b.west).toBeLessThan(b.east);
      expect(b.south).toBeLessThan(b.north);
      expect(b.south).toBeGreaterThanOrEqual(41);
    }
  });
});

describe('tile URL construction', () => {
  it('builds a Web Mercator bbox with ymin before ymax', () => {
    const [xmin, ymin, xmax, ymax] = tileBboxMeters(12, 1206, 1539).split(',').map(Number);
    expect(xmin).toBeLessThan(xmax);
    expect(ymin).toBeLessThan(ymax);
  });

  it('switches chart soundings between feet and metres', () => {
    const noaa = createChartRegistry().getProvider('noaa_enc')!;
    const feet = decodeURIComponent(noaa.build!(12, 1206, 1539, { useMetric: false }));
    const metres = decodeURIComponent(noaa.build!(12, 1206, 1539, { useMetric: true }));
    expect(feet).toContain('"DisplayDepthUnits","value":2');
    expect(metres).toContain('"DisplayDepthUnits","value":1');
  });

  it('leaves light sector arcs off unless asked for', () => {
    const noaa = createChartRegistry().getProvider('noaa_enc')!;
    const plain = decodeURIComponent(noaa.build!(12, 1206, 1539));
    const sectors = decodeURIComponent(noaa.build!(12, 1206, 1539, { fullLightSectors: true }));
    // The service's own default is 2 (full arcs), which buries a passage-scale chart under
    // overlapping nominal-range circles — the parameter has to be sent, not omitted.
    expect(plain).toContain('"DisplayLightSectors","value":1');
    expect(sectors).toContain('"DisplayLightSectors","value":2');
  });

  it('embeds the key in MapTiler URLs but nowhere else', () => {
    const registry = createChartRegistry({ maptilerKey: 'abc123' });
    expect(registry.getProvider('maptiler_satellite')!.build!(5, 1, 1)).toContain('key=abc123');
    expect(registry.getProvider('noaa_enc')!.build!(5, 1, 1)).not.toContain('abc123');
  });

  it('marks the blank layer as rendering nothing', () => {
    const none = createChartRegistry().describe().find((p) => p.id === 'none');
    expect(none?.renders).toBe(false);
  });
});

describe('the tile proxy option', () => {
  const PROXY = 'https://marinersentinel.com/api/tiles/';

  it('fetches the licensed basemaps through the proxy and withdraws the unlicensed pair', () => {
    const r = createChartRegistry({ tileProxy: PROXY });
    const ids = r.active.map((p) => p.id);
    expect(ids).toContain('maptiler_satellite');
    expect(ids).toContain('maptiler_streets');
    expect(ids).not.toContain('osm');
    expect(ids).not.toContain('satellite');
    expect(r.basemapSource).toBe('proxy');
    expect(r.proxyBase).toBe('https://marinersentinel.com/api/tiles');
    expect(r.hasLicensedBasemap).toBe(true);
  });

  it('builds proxy URLs, caps the zoom at the proxy limit, and marks the layer proxied', () => {
    const r = createChartRegistry({ tileProxy: PROXY });
    const sat = r.getProvider('maptiler_satellite')!;
    expect(sat.build!(12, 1206, 1539)).toBe('https://marinersentinel.com/api/tiles/maptiler_satellite/12/1206/1539.png');
    expect(sat.maxZoom).toBeLessThanOrEqual(PROXY_MAX_ZOOM);
    expect(sat.proxied).toBe(true);
    expect(createChartRegistry({ tileProxy: PROXY, proxyMaxZoom: 14 }).getProvider('maptiler_streets')!.maxZoom).toBe(14);
  });

  it('keeps everything else as the keyed registry has it, in the same order', () => {
    const keyed = createChartRegistry({ maptilerKey: 'k' });
    const proxied = createChartRegistry({ tileProxy: PROXY });
    expect(proxied.active.map((p) => p.id)).toEqual(keyed.active.map((p) => p.id));
    const keyedSat = keyed.getProvider('maptiler_satellite')!;
    const proxiedSat = proxied.getProvider('maptiler_satellite')!;
    expect(proxiedSat.label).toBe(keyedSat.label);
    expect(proxiedSat.attribution).toBe(keyedSat.attribution);
    expect(proxied.getProvider('noaa_enc')!.proxied).toBeUndefined();
  });

  it('lets a key win over the proxy, and treats an empty proxy as none', () => {
    const both = createChartRegistry({ maptilerKey: 'k', tileProxy: PROXY });
    expect(both.basemapSource).toBe('maptiler');
    expect(both.proxyBase).toBeNull();
    expect(both.getProvider('maptiler_satellite')!.proxied).toBeUndefined();
    const none = createChartRegistry({ tileProxy: '  ' });
    expect(none.basemapSource).toBe('none');
    expect(none.active.map((p) => p.id)).toContain('osm');
  });

  it('never sends the proxied layers anywhere but the proxy', () => {
    const r = createChartRegistry({ tileProxy: PROXY });
    expect(JSON.stringify(r.describe())).not.toMatch(/api\.maptiler\.com/);
  });
});
