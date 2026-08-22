import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isInsideNwsCoverage,
  formatPosition,
  getOpenMeteoForecast,
  clearForecastCache
} from '../src/openMeteo.js';

const HOURS = 72;

/** Open-Meteo sends ISO strings with no zone suffix; mirror that exactly. */
function isoHour(i: number): string {
  return new Date(Date.UTC(2026, 7, 22, 0, 0, 0) + i * 3600_000).toISOString().slice(0, 16);
}

function buildForecast(opts: {
  wind?: number;
  gust?: number;
  dirs?: number[];
  pressureDrop?: number;
} = {}) {
  const { wind = 12, gust = 18, dirs = null, pressureDrop = 0 } = opts as any;
  const hourly: Record<string, any[]> = {
    time: [], temperature_2m: [], wind_speed_10m: [], wind_direction_10m: [],
    wind_gusts_10m: [], precipitation: [], pressure_msl: []
  };
  for (let i = 0; i < HOURS; i++) {
    hourly.time.push(isoHour(i));
    hourly.temperature_2m.push(18 + (i % 5));
    hourly.wind_speed_10m.push(wind);
    hourly.wind_direction_10m.push(dirs ? dirs[i % dirs.length] : 225);
    hourly.wind_gusts_10m.push(gust);
    hourly.precipitation.push(0);
    hourly.pressure_msl.push(1015 - (pressureDrop * i) / HOURS);
  }
  return { hourly };
}

/** `offset` starts the marine series at a different hour, to prove the two
 *  series are joined by timestamp rather than by array index. */
function buildMarine(opts: { height?: number; period?: number; offset?: number } = {}) {
  const { height = 1.2, period = 7, offset = 0 } = opts;
  const hourly: Record<string, any[]> = { time: [], wave_height: [], wave_period: [], wave_direction: [] };
  for (let i = offset; i < HOURS; i++) {
    hourly.time.push(isoHour(i));
    hourly.wave_height.push(height);
    hourly.wave_period.push(period);
    hourly.wave_direction.push(230);
  }
  return { hourly };
}

let calls: string[] = [];

function stubFetch(opts: {
  forecast?: any;
  marine?: any;
  marineFails?: boolean;
  forecastStatus?: number;
}) {
  const { forecast, marine, marineFails = false, forecastStatus = 200 } = opts;
  calls = [];
  vi.stubGlobal('fetch', async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('marine-api')) {
      if (marineFails) throw new Error('simulated marine outage');
      return { ok: true, status: 200, json: async () => marine } as any;
    }
    if (u.includes('api.weather.gov')) {
      return { ok: true, status: 200, json: async () => ({ features: [] }) } as any;
    }
    return { ok: forecastStatus === 200, status: forecastStatus, json: async () => forecast } as any;
  });
}

beforeEach(() => clearForecastCache());
afterEach(() => vi.unstubAllGlobals());

describe('isInsideNwsCoverage', () => {
  it.each([
    ['Newport RI', 41.5, -71.3],
    ['St Thomas USVI', 18.34, -64.93],
    ['Honolulu', 21.3, -157.8],
    ['Kodiak AK', 57.8, -152.4]
  ])('treats %s as inside NWS coverage', (_name, lat, lon) => {
    expect(isInsideNwsCoverage(lat as number, lon as number)).toBe(true);
  });

  it.each([
    ['Cannes', 43.55, 7.02],
    ['Palma', 39.57, 2.65],
    ['Sydney', -33.85, 151.2],
    ['Cape Town', -33.9, 18.4]
  ])('treats %s as outside NWS coverage', (_name, lat, lon) => {
    expect(isInsideNwsCoverage(lat as number, lon as number)).toBe(false);
  });

  it('never claims coverage for an unusable position', () => {
    expect(isInsideNwsCoverage(NaN, undefined as any)).toBe(false);
  });
});

describe('formatPosition', () => {
  it('labels eastern longitudes E, not W', () => {
    expect(formatPosition(43.55, 7.02)).toBe('43.55°N 7.02°E');
  });
  it('labels southern latitudes S, not negative N', () => {
    expect(formatPosition(-33.85, 151.2)).toBe('33.85°S 151.20°E');
  });
  it('still labels the US east coast correctly', () => {
    expect(formatPosition(41.5, -71.3)).toBe('41.50°N 71.30°W');
  });
});

describe('getOpenMeteoForecast', () => {
  it('builds a bulletin a mariner can read', async () => {
    // 30 hPa over three days is ~5 hPa per period: a genuinely falling glass.
    stubFetch({ forecast: buildForecast({ wind: 14, gust: 20, pressureDrop: 30 }), marine: buildMarine({ offset: 3 }) });
    const fc = await getOpenMeteoForecast(43.55, 7.02);

    expect(fc.periods).toHaveLength(6);
    expect(fc.locName).toBe('43.55°N 7.02°E');
    expect(fc.provider).toBe('open-meteo');
    expect(fc.source).toMatch(/marine sea state/);
    expect(fc.periods[0].reason).toBe(
      'Wind SW up to 14 kts, gusting 20 kts. Seas to 1.2 m at 7 s. Pressure 1010 hPa falling. Precipitation None.'
    );
    // Temperature belongs only in tempRange, which the panel converts by unit.
    expect(fc.periods[0].reason).not.toMatch(/Temperature/);
    expect(fc.periods[0].tempRange).toBe('18°C to 22°C');
  });

  it('requests gusts and pressure from upstream', async () => {
    stubFetch({ forecast: buildForecast(), marine: buildMarine() });
    await getOpenMeteoForecast(43.55, 7.02);
    expect(calls.some((u) => u.includes('wind_gusts_10m') && u.includes('pressure_msl'))).toBe(true);
  });

  it('parses upstream times as UTC rather than server-local', async () => {
    stubFetch({ forecast: buildForecast(), marine: buildMarine() });
    const fc = await getOpenMeteoForecast(43.55, 7.02);
    expect(fc.periods[0].startTime).toBe('2026-08-22T00:00:00.000Z');
  });

  it('joins the marine series by timestamp, not array index', async () => {
    // Marine data starts three hours later than the wind series.
    stubFetch({ forecast: buildForecast(), marine: buildMarine({ height: 1.2, offset: 3 }) });
    const fc = await getOpenMeteoForecast(43.55, 7.02);
    expect(fc.periods[0].waveHeight).toBe(1.2);
    expect(fc.periods[0].wavePeriod).toBe(7);
  });

  it('omits the NWS zone label instead of printing "Zone GLOBAL"', async () => {
    stubFetch({ forecast: buildForecast(), marine: buildMarine() });
    const fc = await getOpenMeteoForecast(43.55, 7.02);
    expect(fc.marineZone).toBeNull();
  });

  describe('wind direction', () => {
    it('averages across north correctly (350° and 10° is northerly, not southerly)', async () => {
      stubFetch({ forecast: buildForecast({ dirs: [350, 10, 350, 10] }), marine: buildMarine() });
      const fc = await getOpenMeteoForecast(43.55, 7.02);
      expect(fc.periods[0].windDirection).toBe('N');
    });

    it('reports an easterly as E', async () => {
      stubFetch({ forecast: buildForecast({ dirs: [90] }), marine: buildMarine() });
      const fc = await getOpenMeteoForecast(43.55, 7.02);
      expect(fc.periods[0].windDirection).toBe('E');
    });
  });

  describe('risk banding', () => {
    it('calls calm conditions low risk', async () => {
      stubFetch({ forecast: buildForecast({ wind: 8, gust: 12 }), marine: buildMarine({ height: 0.5 }) });
      expect((await getOpenMeteoForecast(43.55, 7.02)).overallRisk).toBe('low');
    });

    it('calls 28 kt sustained high risk', async () => {
      stubFetch({ forecast: buildForecast({ wind: 28, gust: 30 }), marine: buildMarine({ height: 1 }) });
      expect((await getOpenMeteoForecast(43.55, 7.02)).overallRisk).toBe('high');
    });

    it('raises risk on gale-force gusts even when sustained wind is modest', async () => {
      stubFetch({ forecast: buildForecast({ wind: 12, gust: 38 }), marine: buildMarine({ height: 1 }) });
      expect((await getOpenMeteoForecast(43.55, 7.02)).overallRisk).toBe('high');
    });

    it('raises risk on large seas even in light wind', async () => {
      stubFetch({ forecast: buildForecast({ wind: 10, gust: 14 }), marine: buildMarine({ height: 4.5 }) });
      expect((await getOpenMeteoForecast(43.55, 7.02)).overallRisk).toBe('high');
    });
  });

  describe('degradation', () => {
    it('still returns a wind forecast when the marine endpoint fails', async () => {
      stubFetch({ forecast: buildForecast({ wind: 14, gust: 20 }), marineFails: true });
      const fc = await getOpenMeteoForecast(43.55, 7.02);
      expect(fc.periods).toHaveLength(6);
      expect(fc.periods[0].reason).toMatch(/Wind SW up to 14 kts/);
      expect(fc.periods[0].reason).not.toMatch(/Seas to/);
      expect(fc.source).toBe('Open-Meteo global model');
    });

    it('propagates an upstream outage rather than returning an empty forecast', async () => {
      stubFetch({ forecast: null, marine: buildMarine(), forecastStatus: 503 });
      await expect(getOpenMeteoForecast(43.55, 7.02)).rejects.toThrow(/HTTP 503/);
    });

    it('rejects a response with no hourly data', async () => {
      stubFetch({ forecast: { hourly: { time: [] } }, marine: buildMarine() });
      await expect(getOpenMeteoForecast(43.55, 7.02)).rejects.toThrow(/no hourly forecast/);
    });
  });

  describe('NWS alerts', () => {
    it('never calls api.weather.gov on the international path', async () => {
      stubFetch({ forecast: buildForecast(), marine: buildMarine() });
      await getOpenMeteoForecast(43.55, 7.02);
      expect(calls.some((u) => u.includes('api.weather.gov'))).toBe(false);
    });

    it('probes NWS alerts when asked, for US positions whose grid forecast failed', async () => {
      stubFetch({ forecast: buildForecast(), marine: buildMarine() });
      await getOpenMeteoForecast(41.5, -71.3, { probeNwsAlerts: true });
      expect(calls.some((u) => u.includes('api.weather.gov/alerts'))).toBe(true);
    });
  });

  describe('units', () => {
    it('defaults to Celsius with accumulation, as OceanSentinel expects', async () => {
      stubFetch({ forecast: buildForecast(), marine: buildMarine() });
      const fc = await getOpenMeteoForecast(43.55, 7.02);
      expect(calls[0]).toContain('temperature_unit=celsius');
      expect(calls[0]).toMatch(/hourly=[^&]*,precipitation,/);
      expect(fc.periods[0].tempRange).toMatch(/°C to .*°C/);
    });

    it('emits Fahrenheit and rain probability when asked, as HarborSentinel expects', async () => {
      const forecast = buildForecast();
      // Harbor's NWS path reports a chance of rain, not millimetres.
      forecast.hourly.precipitation_probability = forecast.hourly.time.map((_: any, i: number) => (i < 12 ? 40 : 10));
      forecast.hourly.temperature_2m = forecast.hourly.time.map(() => 68);
      stubFetch({ forecast, marine: buildMarine() });

      const fc = await getOpenMeteoForecast(41.5, -71.3, {
        temperatureUnit: 'fahrenheit',
        precipitation: 'probability'
      });

      expect(calls[0]).toContain('temperature_unit=fahrenheit');
      expect(calls[0]).toContain('precipitation_probability');
      expect(fc.periods[0].tempRange).toBe('68°F to 68°F');
      // The worst chance across the period, not a sum of percentages.
      expect(fc.periods[0].precipChance).toBe('40%');
      expect(fc.periods[0].reason).toMatch(/Precipitation 40%\./);
    });
  });

  it('marks the forecast as coming from the global model', async () => {
    stubFetch({ forecast: buildForecast(), marine: buildMarine() });
    const fc = await getOpenMeteoForecast(43.55, 7.02);
    expect(fc.isFallback).toBe(true);
  });

  it('serves a repeat request from cache', async () => {
    stubFetch({ forecast: buildForecast(), marine: buildMarine() });
    await getOpenMeteoForecast(43.55, 7.02);
    const afterFirst = calls.length;
    await getOpenMeteoForecast(43.55, 7.02);
    expect(calls.length).toBe(afterFirst);
  });
});
