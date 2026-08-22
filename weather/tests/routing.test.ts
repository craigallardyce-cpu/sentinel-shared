import { describe, it, expect } from 'vitest';
import {
  routeIsochrone,
  distanceNm,
  bearingDeg,
  destinationPoint,
  angleBetween,
  type WindSampler
} from '../src/routing.js';
import { GENERIC_POLARS, type PolarDiagram } from '../src/polars.js';

const polar = GENERIC_POLARS.cruisingMonohull;
const DEPARTURE = Date.UTC(2026, 7, 22, 0, 0, 0);

/** Wind of one strength and direction everywhere, at all times. */
const steadyWind = (speedKts: number, directionDeg: number): WindSampler => () => ({
  speedKts,
  directionDeg
});

describe('great-circle helpers', () => {
  it('measures a known distance', () => {
    // Newport RI to Bermuda is about 635 nm.
    const d = distanceNm(41.49, -71.31, 32.3, -64.78);
    expect(d).toBeGreaterThan(600);
    expect(d).toBeLessThan(660);
  });

  it('bears due east along the equator', () => {
    expect(bearingDeg(0, 0, 0, 10)).toBeCloseTo(90, 3);
  });

  it('round-trips a bearing and distance', () => {
    const p = destinationPoint(40, -70, 55, 120);
    expect(distanceNm(40, -70, p.lat, p.lon)).toBeCloseTo(120, 3);
    expect(bearingDeg(40, -70, p.lat, p.lon)).toBeCloseTo(55, 2);
  });

  it('keeps longitude in range across the antimeridian', () => {
    const p = destinationPoint(0, 179.5, 90, 120);
    expect(p.lon).toBeLessThanOrEqual(180);
    expect(p.lon).toBeGreaterThanOrEqual(-180);
  });

  it('measures the smaller angle between bearings', () => {
    expect(angleBetween(350, 10)).toBe(20);
    expect(angleBetween(10, 350)).toBe(20);
    expect(angleBetween(0, 180)).toBe(180);
  });
});

describe('routeIsochrone', () => {
  const start = { lat: 40, lon: -70 };
  // Roughly 120 nm due east.
  const east = { lat: 40, lon: -67.4 };

  it('sails a beam reach almost straight down the rhumb line', () => {
    // Wind from the north; heading east is a beam reach at 90° TWA.
    const result = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(14, 0), stepMinutes: 30
    });

    expect(result.reachedDestination).toBe(true);
    // A beam reach needs no tacking, so sailed distance ≈ direct distance.
    expect(result.distanceNm).toBeLessThan(result.directDistanceNm * 1.05);
    // 7.5 kt beam reach over ~120 nm is roughly 16 hours.
    expect(result.etaHours).toBeGreaterThan(13);
    expect(result.etaHours).toBeLessThan(20);
    // Skip the first leg: it is the departure point, before any sailing.
    expect(result.legs.slice(1).every((l) => l.twaDeg > 60 && l.twaDeg < 120)).toBe(true);
  });

  it('beats to windward instead of claiming it can sail into the wind', () => {
    // Wind from the east: the destination is dead upwind.
    const result = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(14, 90), stepMinutes: 30
    });

    expect(result.reachedDestination).toBe(true);
    // Beating covers appreciably more ground than the rhumb line.
    expect(result.distanceNm).toBeGreaterThan(result.directDistanceNm * 1.2);
    // Nothing inside the boat's pointing angle.
    expect(result.legs.every((l) => l.boatSpeedKts === 0 || l.twaDeg >= 39)).toBe(true);
    // And it has to change tacks to get there.
    expect(result.legs.some((l) => l.manoeuvre === 'tack')).toBe(true);
  });

  it('takes longer upwind than on a reach over the same course', () => {
    const reach = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(14, 0), stepMinutes: 30
    });
    const beat = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(14, 90), stepMinutes: 30
    });
    expect(beat.etaHours).toBeGreaterThan(reach.etaHours);
  });

  it('arrives sooner in more wind', () => {
    const light = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(8, 0), stepMinutes: 30
    });
    const fresh = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(16, 0), stepMinutes: 30
    });
    expect(fresh.etaHours).toBeLessThan(light.etaHours);
  });

  it('detours into stronger wind when the detour pays', () => {
    // Wind from the northwest, so north is close-hauled but sailable, and
    // appreciably stronger north of 40.3°.
    const wind: WindSampler = (lat) => ({ speedKts: lat > 40.3 ? 18 : 7, directionDeg: 315 });
    const result = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar, wind, stepMinutes: 30
    });
    const ifItHadStayedLight = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(7, 315), stepMinutes: 30
    });

    expect(result.reachedDestination).toBe(true);
    // It climbs into the breeze rather than ghosting along the rhumb line...
    expect(Math.max(...result.legs.map((l) => l.lat))).toBeGreaterThan(40.3);
    // ...and the detour is what makes it faster, which is the whole point.
    expect(result.etaHours).toBeLessThan(ifItHadStayedLight.etaHours);
  });

  it('sails angles downwind rather than wallowing dead before the wind', () => {
    // Wind from due west with the destination due east: dead astern.
    const result = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(12, 270), stepMinutes: 30
    });

    expect(result.reachedDestination).toBe(true);
    // A dead run makes 5.0 kt where a broad reach makes 6.5, so it pays to
    // sail further at an angle and gybe.
    expect(result.distanceNm).toBeGreaterThan(result.directDistanceNm);
    expect(result.legs.some((l) => l.manoeuvre === 'gybe')).toBe(true);
    expect(result.legs.slice(1).every((l) => l.twaDeg > 90)).toBe(true);
  });

  it('does not gybe away an advantage the crew has to work for', () => {
    const run = (manoeuvrePenaltyMinutes: number) =>
      routeIsochrone({
        start, destination: east, departure: DEPARTURE, polar,
        wind: steadyWind(12, 270), stepMinutes: 30, manoeuvrePenaltyMinutes
      });

    const free = run(0);
    const costed = run(2);
    const count = (r: ReturnType<typeof run>) => r.legs.filter((l) => l.manoeuvre).length;

    // Charging for the turn is what separates a route a crew would sail from
    // one that gybes every half hour to chase a fractionally better angle.
    expect(count(free)).toBeGreaterThan(count(costed) * 3);
    expect(count(costed)).toBeLessThan(5);
  });

  it('lands exactly on the destination', () => {
    const result = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(14, 0), stepMinutes: 60
    });
    const last = result.legs[result.legs.length - 1];
    expect(last.lat).toBeCloseTo(east.lat, 6);
    expect(last.lon).toBeCloseTo(east.lon, 6);
  });

  it('reports times as an increasing ISO sequence from the departure', () => {
    const result = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(14, 0), stepMinutes: 60
    });
    const times = result.legs.map((l) => Date.parse(l.time));
    expect(times[0]).toBe(DEPARTURE);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  describe('honesty about what it does not know', () => {
    it('always warns that land is not considered', () => {
      const result = routeIsochrone({
        start, destination: east, departure: DEPARTURE, polar,
        wind: steadyWind(14, 0)
      });
      expect(result.warnings.some((w) => /does not know where land/i.test(w))).toBe(true);
    });

    it('warns that a generic polar is not this boat', () => {
      const result = routeIsochrone({
        start, destination: east, departure: DEPARTURE, polar,
        wind: steadyWind(14, 0)
      });
      expect(result.warnings.some((w) => /generic polar/i.test(w))).toBe(true);
      expect(result.polarName).toBe(polar.name);
    });

    it('does not cry generic for a boat\'s own measured polar', () => {
      const measured: PolarDiagram = { ...polar, name: 'Sula, measured 2026', generic: false };
      const result = routeIsochrone({
        start, destination: east, departure: DEPARTURE, polar: measured,
        wind: steadyWind(14, 0)
      });
      expect(result.warnings.some((w) => /generic polar/i.test(w))).toBe(false);
    });
  });

  describe('when it cannot get there', () => {
    it('reports a stall rather than inventing a route through a calm', () => {
      const result = routeIsochrone({
        start, destination: east, departure: DEPARTURE, polar,
        wind: steadyWind(0, 0)
      });
      expect(result.reachedDestination).toBe(false);
      expect(result.warnings.some((w) => /no route could be started/i.test(w))).toBe(true);
    });

    it('reports missing forecast data rather than guessing', () => {
      const result = routeIsochrone({
        start, destination: east, departure: DEPARTURE, polar,
        wind: () => null
      });
      expect(result.reachedDestination).toBe(false);
      expect(result.legs).toHaveLength(1);
    });

    it('gives up at maxHours and returns its best progress', () => {
      const far = { lat: 40, lon: -20 }; // ~2300 nm
      const result = routeIsochrone({
        start, destination: far, departure: DEPARTURE, polar,
        wind: steadyWind(10, 0), maxHours: 6
      });
      expect(result.reachedDestination).toBe(false);
      expect(result.etaHours).toBeLessThanOrEqual(6);
      expect(result.legs.length).toBeGreaterThan(1);
      expect(result.warnings.some((w) => /not reached within 6 hours/i.test(w))).toBe(true);
    });
  });

  it('completes an ocean passage in reasonable time and shape', () => {
    // Newport to Bermuda on a steady southwesterly: a broad reach most of the way.
    const result = routeIsochrone({
      start: { lat: 41.49, lon: -71.31 },
      destination: { lat: 32.3, lon: -64.78 },
      departure: DEPARTURE,
      polar,
      wind: steadyWind(15, 225),
      stepMinutes: 60
    });
    expect(result.reachedDestination).toBe(true);
    expect(result.directDistanceNm).toBeGreaterThan(600);
    // ~635 nm at roughly 7 kt is about four days.
    expect(result.etaHours).toBeGreaterThan(70);
    expect(result.etaHours).toBeLessThan(130);
    expect(result.distanceNm).toBeLessThan(result.directDistanceNm * 1.3);
  });

  it('closes a windward destination on VMG rather than stalling off the entrance', () => {
    // Destination dead upwind of the last mile: the boat must tack in, and the
    // search must still recognise that it has arrived.
    const result = routeIsochrone({
      start, destination: east, departure: DEPARTURE, polar,
      wind: steadyWind(14, 85), stepMinutes: 60
    });
    expect(result.reachedDestination).toBe(true);
    const last = result.legs[result.legs.length - 1];
    expect(last.lat).toBeCloseTo(east.lat, 6);
    expect(last.lon).toBeCloseTo(east.lon, 6);
  });
});
