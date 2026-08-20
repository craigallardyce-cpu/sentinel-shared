import { describe, it, expect } from 'vitest';
import { createChartRegistry, tileBboxMeters } from '../src/registry.js';

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
