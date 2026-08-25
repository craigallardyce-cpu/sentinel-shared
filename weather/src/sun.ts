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
export function solarElevationDeg(lat: number, lon: number, timeMs: number): number {
  const rad = Math.PI / 180;
  // Days since J2000.0.
  const d = timeMs / 86_400_000 + 2440587.5 - 2451545.0;
  const meanAnomaly = (357.529 + 0.98560028 * d) * rad;
  const meanLongitude = (280.459 + 0.98564736 * d) * rad;
  const eclipticLongitude =
    meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.00000036 * d) * rad;

  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude)
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

  // Greenwich mean sidereal time, in degrees, then the local hour angle.
  const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
  const hourAngle = (gmstHours * 15 + lon) * rad - rightAscension;

  const elevation = Math.asin(
    Math.sin(lat * rad) * Math.sin(declination) +
      Math.cos(lat * rad) * Math.cos(declination) * Math.cos(hourAngle)
  );
  return elevation / rad;
}

/**
 * Dark, for a watch-keeping purpose.
 *
 * The threshold is the sun's upper limb on the horizon allowing for
 * refraction, which is the instant an almanac calls sunset. Civil twilight
 * would be defensible too, but a crew changing a headsail at nautical dusk is
 * working in the dark whatever the definition says, and the conservative line
 * is the one that calls more of the passage night.
 */
export const NIGHT_ELEVATION_DEG = -0.833;

export function isNightAt(lat: number, lon: number, timeMs: number): boolean {
  return solarElevationDeg(lat, lon, timeMs) < NIGHT_ELEVATION_DEG;
}
