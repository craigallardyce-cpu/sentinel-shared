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
/** True when there is enough here to model a motorboat at all. */
export declare function isUsablePowerProfile(profile: PowerProfile | null | undefined): boolean;
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
export declare function windageLossFraction(profile: PowerProfile, twaDeg: number, twsKts: number): number;
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
export declare function powerPolar(profile: PowerProfile): PolarDiagram;
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
export declare function powerSeaState(profile: PowerProfile): SeaStateOptions;
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
export declare function powerRangeFrom(profile: PowerProfile): PowerRange | null;
