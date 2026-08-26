import type { PolarDiagram } from './polars.js';
import type { SeaStateOptions } from './routing.js';

/**
 * The motorboat's performance model — what a polar is for a sailing boat.
 *
 * A sailing boat's speed is a function of the wind, which is why routing one
 * means searching for wind. A motorboat's speed is a throttle setting, and the
 * weather only ever takes away from it. So this file does not predict speed
 * from the weather; it starts from a speed the owner MEASURED at a known
 * throttle and subtracts what the wind and the sea will cost.
 *
 * That is the honest shape of the problem, and it is also why the inputs are
 * the ones they are. An owner cannot tell you their vessel's effective power
 * or its resistance curve. They can tell you, off the engine hours and the
 * fuel dock, that at 2000 rpm the boat does 8 knots and burns 11 litres an
 * hour — and those two numbers, with the hull's dimensions, are enough to
 * charge weather against them defensibly.
 *
 * ONE THROTTLE SETTING, DELIBERATELY. A real motorboat has a whole curve of
 * them, and a router given the curve would trade fuel against time — push
 * through a closing window at 12 knots, or throttle back and let it pass.
 * That is a better feature and a bigger one, and it needs numbers most owners
 * do not have to hand. Modelling the single economic setting an owner does
 * know, and being clear that it is the only one modelled, beats interpolating
 * a fuel curve out of one point and presenting the result as a choice.
 *
 * NOTHING HERE IS MEASURED except the numbers the owner types in. The windage
 * and sea-state terms are physically shaped approximations standing in for a
 * tank test nobody ran, exactly as `seaStateFactor` is for a sailing boat, and
 * every route computed with them says so in its warnings.
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
  /** Displacement in tonnes — what the windage penalty is scaled against. */
  displacementTonnes?: number | null;
  /** Beam in metres. With the height below, the frontal area the wind sees. */
  beamM?: number | null;
  /** Height of the superstructure above the waterline, in metres. */
  heightAboveWaterlineM?: number | null;
  /** Draught in metres. Recorded for the skipper, not used in routing. */
  draughtM?: number | null;
}

const KTS_TO_MS = 0.514444;
const AIR_DENSITY = 1.225; // kg/m³
const GRAVITY = 9.80665;

/**
 * Drag coefficient of a motorboat's superstructure, referred to its frontal
 * area. Around 0.8 is the usual figure for the boxy end of the fleet — a
 * flybridge trawler is closer to a van than to an aerofoil. A sleek express
 * cruiser is lower and this will over-charge it slightly, in the direction
 * that costs the skipper time on paper rather than fuel at sea.
 */
const SUPERSTRUCTURE_DRAG_COEFFICIENT = 0.8;

/**
 * Hull resistance at cruising speed as a fraction of displacement weight.
 *
 * The one number here with no owner-supplied basis, and the one doing the most
 * work: it converts "how hard is the wind pushing" into "how much slower does
 * this boat go". A displacement hull at a Froude number around 0.3 — which is
 * where an economic setting sits — takes roughly 3–4% of its weight in total
 * resistance. 0.035 is the middle of that, and it is a stand-in for a
 * resistance curve, not a measurement of one.
 */
const HULL_RESISTANCE_FRACTION = 0.035;

/**
 * How resistance grows with speed near the cruising setting.
 *
 * At a fixed throttle the engine holds roughly constant power, so P = R·V is
 * fixed and R ≈ k·Vⁿ. Adding a small resistance ΔR therefore costs about
 * ΔR / ((n+1)·R) of the speed. n = 3 is the usual figure for a displacement
 * hull in this range, giving the divisor of 4 below.
 */
const RESISTANCE_SPEED_EXPONENT = 3;

/** Most speed the wind is allowed to take, and most it can give back. */
const MAX_WINDAGE_LOSS = 0.5;
const MAX_WINDAGE_GAIN = 0.15;

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
 * The frontal area the wind acts on, in square metres, or null when the hull
 * has not been described well enough to know it.
 *
 * Beam × height above the waterline is a rectangle, and a boat is not one — a
 * real superstructure fills perhaps 70% of that box. The shortfall is folded
 * into the drag coefficient rather than applied here, because splitting one
 * fudge factor into two does not make it two measurements.
 */
function frontalAreaM2(profile: PowerProfile): number | null {
  const beam = positive(profile.beamM);
  const height = positive(profile.heightAboveWaterlineM);
  return beam && height ? beam * height : null;
}

/**
 * The fraction of its speed the boat loses to the wind at a given true wind
 * angle and strength. Negative where a following wind pushes it along.
 *
 * The wind the hull actually feels is the apparent one, which depends on boat
 * speed, which depends on this answer. That loop is closed once, from the
 * economic speed, rather than iterated: at these magnitudes a second pass
 * moves the result by well under a tenth of a knot, and pretending otherwise
 * would be precision the drag coefficient cannot support.
 *
 * Only the along-track component is charged. A beam wind on a high-sided boat
 * is a real force, but what it produces is leeway and a corrected heading, not
 * a slower boat, and this router does not model leeway for a sailing boat
 * either.
 *
 * WHAT IS CHARGED IS THE EXCESS over still air, which is the subtlety that
 * decides whether any of this is honest. A boat doing 8 knots in a flat calm
 * is already pushing through 8 knots of wind of its own making — and the
 * owner's 8 knots at 2000 rpm was measured with that drag included. Charging
 * the full apparent wind would bill the vessel a second time for the air it
 * has already paid for, and the tell is unmissable once you look: a flat calm
 * would come out slower than the stated economic speed. So the still-air case
 * is subtracted, which makes zero wind cost exactly nothing and a beam wind
 * cost exactly nothing along the track, both of which are the right answers.
 */
export function windageLossFraction(
  profile: PowerProfile,
  twaDeg: number,
  twsKts: number
): number {
  const area = frontalAreaM2(profile);
  const displacementKg = (positive(profile.displacementTonnes) ?? 0) * 1000;
  const speed = positive(profile.economicSpeedKts);
  // Without an area or a displacement there is nothing to scale a wind force
  // against, so the wind costs nothing and the polar's note says as much.
  // Silence beats a made-up number: a default hull would be this app claiming
  // to know a boat it has never been told about.
  if (!area || !displacementKg || !speed || !Number.isFinite(twsKts)) return 0;

  // Component of the true wind along the boat's axis, positive when opposing.
  const axialTrueKts = twsKts * Math.cos((twaDeg * Math.PI) / 180);
  const apparentAxialMs = (speed + axialTrueKts) * KTS_TO_MS;
  // The still-air case the economic speed was measured in, and therefore the
  // datum. Only what the weather adds on top of this is the weather's fault.
  const ownHeadwindMs = speed * KTS_TO_MS;

  // Signed throughout, so a following wind subtracts resistance rather than
  // adding it, and the vessel is credited for being pushed along.
  const airResistanceN =
    0.5 *
    AIR_DENSITY *
    SUPERSTRUCTURE_DRAG_COEFFICIENT *
    area *
    (apparentAxialMs * Math.abs(apparentAxialMs) - ownHeadwindMs * ownHeadwindMs);

  const hullResistanceN = HULL_RESISTANCE_FRACTION * displacementKg * GRAVITY;
  const loss = airResistanceN / ((RESISTANCE_SPEED_EXPONENT + 1) * hullResistanceN);
  return Math.min(MAX_WINDAGE_LOSS, Math.max(-MAX_WINDAGE_GAIN, loss));
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
 * those too — it is simply nearly flat, has no no-go zone, and slopes gently
 * downhill into a headwind instead of uphill into a reach. Expressing it in
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

  const speeds = POWER_TWA.map((twa) =>
    POWER_TWS.map((tws) => {
      const kept = 1 - windageLossFraction(profile, twa, tws);
      return Math.round(speed * Math.max(0, kept) * 100) / 100;
    })
  );

  const rpm = positive(profile.economicRpm);
  const modelled = frontalAreaM2(profile) !== null && positive(profile.displacementTonnes) !== null;

  return {
    name: `Under power at ${speed} kt${rpm ? ` (${rpm} rpm)` : ''}`,
    twsValues: POWER_TWS,
    twaValues: POWER_TWA,
    speeds,
    note: modelled
      ? `Timings hold ${speed} knots at the economic throttle setting and charge the wind against ` +
        "the vessel's frontal area and displacement. That windage term is a physically shaped " +
        'estimate, not this hull measured — and the setting is the only one modelled, so a plan ' +
        'that would have you throttle up to clear a front is a plan this cannot make.'
      : `Timings hold ${speed} knots at the economic throttle setting in any wind, because the ` +
        'beam, height above the waterline and displacement needed to work out what a headwind ' +
        'costs this vessel have not been entered. Fill them in and a headwind will slow the ' +
        'passage down the way it actually will.'
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
