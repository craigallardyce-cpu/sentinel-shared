/**
 * Where the sun is, and therefore whether it is dark.
 *
 * Its own module because both the router and the passage summary need it and
 * neither should have to import the other. The router needs it to charge a
 * sail change what it actually costs a sleeping crew; the summary needs it to
 * say how much of a passage is spent in the dark.
 *
 * Computed rather than fetched. A boat mid-ocean can work out when the sun
 * sets with no network at all, which is the same reason the routing itself
 * runs client-side, and it is exact enough that a service would be a downgrade
 * as well as a dependency.
 */
/**
 * The sun's elevation above the horizon, in degrees.
 *
 * The low-precision solar position algorithm, good to about a hundredth of a
 * degree — three or four orders of magnitude better than any passage decision
 * needs, in about thirty lines and no data.
 */
export declare function solarElevationDeg(lat: number, lon: number, timeMs: number): number;
/**
 * Dark, for a watch-keeping purpose.
 *
 * The threshold is the sun's upper limb on the horizon allowing for
 * refraction, which is the instant an almanac calls sunset. Civil twilight
 * would be defensible too, but a crew changing a headsail at nautical dusk is
 * working in the dark whatever the definition says, and the conservative line
 * is the one that calls more of the passage night.
 */
export declare const NIGHT_ELEVATION_DEG = -0.833;
export declare function isNightAt(lat: number, lon: number, timeMs: number): boolean;
