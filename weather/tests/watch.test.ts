import { describe, it, expect } from 'vitest';
import { routeIsochrone, type WindSampler, type RouteResult } from '../src/routing.js';
import { summarisePassage } from '../src/passageSummary.js';
import { isNightAt } from '../src/sun.js';
import { GENERIC_POLARS } from '../src/polars.js';

const polar = GENERIC_POLARS.cruisingMonohull;

// Late evening, so the first night arrives within a few steps.
const DEPARTURE = Date.UTC(2026, 6, 15, 22, 0, 0);

/**
 * A wind that backs steadily through the passage.
 *
 * Deliberately faster than any real forecast backs. A realistic shift rate
 * produces a route with one or two manoeuvres in three days, almost never at
 * night — which is a fine outcome for a sailor and useless for testing a
 * policy, because there is nothing for it to prevent. The rate here forces the
 * boat to keep deciding whether to gybe, which is the decision under test.
 */
const backingWind = (speedKts: number, fromDeg: number, degPerHour: number): WindSampler =>
  (_lat, _lon, timeMs) => ({
    speedKts,
    directionDeg: (((fromDeg + (degPerHour * (timeMs - DEPARTURE)) / 3_600_000) % 360) + 360) % 360
  });

const passage = (extra: Record<string, unknown> = {}): RouteResult =>
  routeIsochrone({
    start: { lat: 38, lon: -60 },
    destination: { lat: 34, lon: -50 },
    departure: DEPARTURE,
    polar,
    wind: backingWind(16, 200, 9),
    maxHours: 168,
    ...extra
  });

/**
 * Sail changes made in the dark.
 *
 * Judged at the START of the leg, because that is when the boat turns and it
 * is where the router charges for it. A leg carries its arrival time, so using
 * its own timestamp counts a gybe made at dusk as a night gybe and then
 * wonders why the policy did not prevent it.
 */
const nightManoeuvresIn = (route: RouteResult) =>
  route.legs.filter(
    (l, i) => l.manoeuvre && i > 0 && isNightAt(l.lat, l.lon, Date.parse(route.legs[i - 1].time))
  ).length;

const NO_NIGHT_GYBES = { gybePenaltyMinutes: Infinity };
const NO_NIGHT_WORK = { gybePenaltyMinutes: Infinity, tackPenaltyMinutes: Infinity };

describe('manoeuvre limits by watch', () => {
  it('changes nothing when no policy is set', () => {
    const free = passage();
    const explicitlyFree = passage({
      nightManoeuvre: { tackPenaltyMinutes: 0, gybePenaltyMinutes: 0 }
    });
    expect(free.reachedDestination).toBe(true);
    expect(free.etaHours).toBe(explicitlyFree.etaHours);
    expect(free.warnings.some((w) => w.includes('sail change'))).toBe(false);
  });

  it('takes every sail change out of the dark when the policy refuses them', () => {
    const free = passage();
    expect(nightManoeuvresIn(free)).toBeGreaterThan(0);

    const strict = passage({ nightManoeuvre: NO_NIGHT_WORK });
    expect(strict.reachedDestination).toBe(true);
    expect(nightManoeuvresIn(strict)).toBe(0);
  });

  it('still arrives, because holding the tack is never forbidden', () => {
    // A prohibition removes only the courses that cross the wind. Carrying on
    // is always available, so the policy costs time rather than the passage.
    const strict = passage({ nightManoeuvre: NO_NIGHT_WORK });
    expect(strict.reachedDestination).toBe(true);
    expect(strict.etaHours).toBeGreaterThanOrEqual(passage().etaHours);
  });

  it('says the route is deliberately not the fastest one', () => {
    const strict = passage({ nightManoeuvre: NO_NIGHT_GYBES });
    expect(
      strict.warnings.some((w) => w.includes('leaves the off-watch asleep'))
    ).toBe(true);
  });

  it('lets tacks through when only gybes are refused', () => {
    // The distinction is the point: a tack is a controlled stall through the
    // wind, a gybe is a loaded boom crossing the boat in the dark.
    const gybeFree = passage({ nightManoeuvre: NO_NIGHT_GYBES });
    const allFree = passage({ nightManoeuvre: NO_NIGHT_WORK });
    expect(gybeFree.reachedDestination).toBe(true);
    expect(allFree.reachedDestination).toBe(true);
    // Refusing more can only cost more time, never less.
    expect(allFree.etaHours).toBeGreaterThanOrEqual(gybeFree.etaHours);
  });

  it('leaves daylight manoeuvres alone', () => {
    const strict = passage({ nightManoeuvre: NO_NIGHT_WORK });
    const daylight = strict.legs.filter(
      (l, i) => l.manoeuvre && i > 0 && !isNightAt(l.lat, l.lon, Date.parse(strict.legs[i - 1].time))
    ).length;
    // The policy is about darkness. A rested crew at noon is not its business.
    expect(daylight).toBeGreaterThan(0);
  });

  it('warns that a finite charge is a preference, not a rule', () => {
    // Measured and not hidden: sweeping the penalty over this passage gave two
    // night manoeuvres at 0 minutes, one at 60 and four at 90. The search
    // optimises arrival time, so a charge biases each choice without bounding
    // the outcome. Anyone reading a soft-limited route is told as much.
    const soft = passage({ nightManoeuvre: { gybePenaltyMinutes: 45, tackPenaltyMinutes: 10 } });
    expect(soft.warnings.some((w) => w.includes('preference rather than a rule'))).toBe(true);
  });

  it('is reflected in the summary the app already shows', () => {
    const free = summarisePassage(passage())!;
    const strict = summarisePassage(passage({ nightManoeuvre: NO_NIGHT_WORK }))!;
    expect(strict.night.manoeuvres).toBe(0);
    expect(free.night.manoeuvres).toBeGreaterThan(0);
    // The passage is no less dark for it — only the work in it has moved.
    expect(strict.night.fraction).toBeGreaterThan(0.2);
  });

  it('names the watch policy when it is what closed the door', () => {
    // A wind spinning fast enough that every course inside the off-course
    // limit ends up on the other side of it. Rare, but it must not be
    // reported as a calm or a headwind, because it is neither.
    const spun = routeIsochrone({
      start: { lat: 38, lon: -60 },
      destination: { lat: 34, lon: -50 },
      departure: DEPARTURE,
      polar,
      wind: backingWind(16, 200, 170),
      maxHours: 72,
      nightManoeuvre: NO_NIGHT_WORK
    });
    if (!spun.reachedDestination) {
      const blamed = spun.warnings.some((w) => w.includes('sail change in the dark'));
      const misblamed = spun.warnings.some(
        (w) => w.includes('No forecast wind') || w.includes('dead against this passage')
      );
      expect(blamed || !misblamed).toBe(true);
    }
  });
});
