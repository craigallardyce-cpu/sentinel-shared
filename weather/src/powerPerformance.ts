import type { PolarDiagram } from './polars.js';
import type { SeaStateOptions } from './routing.js';

/**
 * The motorboat's performance model — what a polar is for a sailing boat.
 *
 * A sailing boat's speed is a function of the wind, which is why routing one
 * means searching for wind. A motorboat's speed is a throttle setting. So this
 * file does not predict speed from the weather; it starts from a speed the
 * owner MEASURED at a known throttle, holds it, and lets the router charge the
 * sea against it along the route.
 *
 * That is the honest shape of the problem, and it is also why the inputs are
 * the ones they are. An owner cannot tell you their vessel's effective power
 * or its resistance curve. They can tell you, off the engine hours and the
 * fuel dock, that at 2000 rpm the boat does 8 knots and burns 11 litres an
 * hour — and those two numbers, with the waterline length to scale the sea
 * against, are what the passage is planned from.
 *
 * THE WIND IS NOT CHARGED, DELIBERATELY. There used to be a windage term here
 * that slowed the boat into a headwind and credited it downwind, worked out
 * from its beam, height above the waterline and displacement. It was removed
 * on purpose (Craig, 2026-09-28), along with those inputs: it rested on a drag
 * coefficient and a hull-resistance fraction nobody had measured for any boat
 * in the fleet. Do not re-add it as a tidy-up: it was taken out, not lost.
 *
 * ONE THROTTLE SETTING, DELIBERATELY. A real motorboat has a whole curve of
 * them, and a router given the curve would trade fuel against time — push
 * through a closing window at 12 knots, or throttle back and let it pass.
 * That is a better feature and a bigger one, and it needs numbers most owners
 * do not have to hand. Modelling the single economic setting an owner does
 * know, and being clear that it is the only one modelled, beats interpolating
 * a fuel curve out of one point and presenting the result as a choice.
 *
 * NOTHING HERE IS MEASURED except the numbers the owner types in. The
 * sea-state term is a physically shaped approximation standing in for a tank
 * test nobody ran, exactly as `seaStateFactor` is for a sailing boat, and
 * every route computed with it says so in its warnings.
 */

export interface PowerProfile {
  /** Speed through the water at the economic throttle setting, in knots. */
  economicSpeedKts: number;
  /** Fuel burn at that setting, litres per hour. */
  fuelLitresPerHour: number;
  /** Tank capacity in litres. */
  tankLitres: number;
  /**
   * Share of the tank that is not to be planned against, as a percentage.
   *
   * Same reasoning as the sailing boat's engine reserve: planning to the last
   * litre is planning to arrive with a dry tank, and the whole point of fuel
   * is the part of the passage that did not go to plan. A motorboat has more
   * riding on it — a sailing boat out of fuel is a sailing boat, a motorboat
   * out of fuel is a drifting one — so this is not decoration here, it is the
   * difference between a passage and a tow.
   */
  reservePercent?: number;
  /**
   * Engine speed at the economic setting. Recorded, never used.
   *
   * It earns its place by being the number that makes the other two
   * repeatable: "8 knots on 11 litres" is a claim about a day, "8 knots at
   * 2000 rpm on 11 litres" is a setting the skipper can go and reproduce, and
   * check against, a year later.
   */
  economicRpm?: number | null;
  /** Waterline length in metres — what the sea penalty is scaled against. */
  lwlM?: number | null;
  /** Draught in metres. Recorded for the skipper, not used in routing. */
  draughtM?: number | null;
}

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** True when there is enough here to model a motorboat at all. */
export function isUsablePowerProfile(profile: PowerProfile | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(
    positive(profile.economicSpeedKts) &&
      positive(profile.fuelLitresPerHour) &&
      positive(profile.tankLitres)
  );
}

/**
 * True wind speeds the model is tabulated at.
 *
 * It STARTS AT ZERO, and that is load-bearing rather than tidy. `boatSpeed`
 * ramps linearly to zero below a polar's lightest column, because a sailing
 * boat in a drifter really does stop — and a motorboat handed the same
 * treatment would sit becalmed in a flat calm with its engine running. A
 * column at 0 knots means the ramp never engages and a calm is what it
 * actually is for a motorboat: the best day of the passage.
 */
const POWER_TWS = [0, 5, 10, 15, 20, 25, 30, 40, 50];
const POWER_TWA = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];

/**
 * The motorboat as a `PolarDiagram`, so the isochrone search needs to know
 * nothing about propulsion to move it.
 *
 * This is the trick the whole feature turns on. A polar is just a function
 * from wind angle and strength to boat speed, and a motorboat has one of
 * those too — it is flat: every cell is the economic speed, with no no-go
 * zone and no charge for the wind (see the header for why). Expressing it in
 * the existing shape means the router, the corridor, the hazard scan and the
 * chart drawing all keep working unmodified, and the parts that genuinely do
 * differ — fuel as a hard limit, tacks and gybes not existing — are handled
 * explicitly rather than smuggled in here.
 *
 * The sea is NOT in this table. It is charged separately by `seaStateFactor`
 * during the search, the same way it is for a sailing boat, because it varies
 * along the route rather than with the wind at a point.
 */
export function powerPolar(profile: PowerProfile): PolarDiagram {
  const speed = positive(profile.economicSpeedKts);
  if (!speed) {
    throw new Error('A motorboat needs a speed at its economic setting before it can be routed.');
  }

  const speeds = POWER_TWA.map(() => POWER_TWS.map(() => speed));
  const rpm = positive(profile.economicRpm);

  return {
    name: `Under power at ${speed} kt${rpm ? ` (${rpm} rpm)` : ''}`,
    twsValues: POWER_TWS,
    twaValues: POWER_TWA,
    speeds,
    note:
      `Timings hold ${speed} knots at the economic throttle setting in any wind; the sea is charged ` +
      'along the route, the wind is not. The setting is the only one modelled, so a plan that would ' +
      'have you throttle up to clear a front is a plan this cannot make.'
  };
}

/**
 * How the sea is charged against a motorboat.
 *
 * Scaled against the waterline length like the sailing boat's, but with a
 * heavier hand, and the reason is not only added resistance. A motorboat in a
 * head sea slows because the skipper throttles back — a hull with no rig to
 * steady it slams, and nobody holds cruising revs through that. Resistance and
 * choice both point the same way, and this coefficient is the two of them
 * together rather than either one measured.
 *
 * With these figures an 11.8 m boat loses roughly 6% of its speed in a 1 m
 * head sea, 20% in 2 m and 40% in 3 m. That is a boat that has come off its
 * cruising revs and is picking its way, which is what actually happens.
 *
 * The fuel burn does NOT fall with the speed. At a held throttle the engine
 * drinks what it drinks, so a passage slowed by the sea burns the same litres
 * an hour over more hours — which is exactly why weather costs a motorboat
 * fuel and not just time, and why the range figure moves when the forecast
 * does.
 */
export function powerSeaState(profile: PowerProfile): SeaStateOptions {
  return {
    referenceLengthM: positive(profile.lwlM) ?? 12,
    coefficient: 0.5,
    maxLossFraction: 0.65
  };
}

export interface PowerRange {
  /** Litres the passage may spend: the tank less its reserve. */
  usableLitres: number;
  /** Hours of running that buys at the economic setting. */
  enduranceHours: number;
  /** Still-water miles that buys — the number on the brochure, and the optimistic one. */
  rangeNm: number;
}

/**
 * What the tank is actually worth.
 *
 * `rangeNm` is still water with no wind: the figure a broker quotes. Any real
 * passage costs more, because every hour the weather takes off the speed is an
 * hour the engine still burns fuel for. The router works in hours against
 * `enduranceHours` for exactly that reason — miles are what the boat gets, and
 * hours are what it spends.
 */
export function powerRangeFrom(profile: PowerProfile): PowerRange | null {
  if (!isUsablePowerProfile(profile)) return null;
  const speed = positive(profile.economicSpeedKts)!;
  const burn = positive(profile.fuelLitresPerHour)!;
  const tank = positive(profile.tankLitres)!;
  const reserve = Math.min(90, Math.max(0, Number(profile.reservePercent) || 0)) / 100;
  const usableLitres = tank * (1 - reserve);
  const enduranceHours = usableLitres / burn;
  if (!(enduranceHours > 0)) return null;
  return {
    usableLitres: Math.round(usableLitres * 10) / 10,
    enduranceHours: Math.round(enduranceHours * 100) / 100,
    rangeNm: Math.round(enduranceHours * speed)
  };
}
