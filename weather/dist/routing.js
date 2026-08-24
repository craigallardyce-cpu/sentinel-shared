import { boatSpeed, foldTwa } from './polars.js';
/**
 * Isochrone weather routing.
 *
 * The method is the standard one: from every point reachable at time T, try
 * every heading, advance each by the boat speed its polar gives in the wind
 * there, and keep the outermost results as the frontier for T+Δt. Repeating
 * that traces expanding fronts of equal sailing time, and the first front to
 * reach the destination carries the fastest route back through its parents.
 *
 * Two deliberate boundaries, both from the fleet's decision not to license
 * navigation cartography:
 *
 *   - THERE IS NO LAND AVOIDANCE. Nothing here knows where the coast is, so a
 *     route may cross a headland, an island, or a traffic separation scheme.
 *     Every result says so in `warnings`, and callers must present it as a
 *     weather plan to lay over a chart, never as a course to steer.
 *   - No currents, no waves, no leeway. Wind and polar only.
 *
 * It runs client-side on cached forecast data, so a passage can be re-planned
 * at sea with no connectivity and costs nothing per user to compute.
 */
const EARTH_RADIUS_NM = 3440.065;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
// Great-circle helpers are kept local rather than imported from
// @sentinel/marine: no shared package depends on another today, and three small
// functions are not worth being the first to break that.
/** Great-circle distance in nautical miles. */
export function distanceNm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
/** Initial great-circle bearing in degrees. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
/** The point reached by steering a bearing for a distance. */
export function destinationPoint(lat, lon, bearing, distNm) {
    const angular = distNm / EARTH_RADIUS_NM;
    const brg = toRad(bearing);
    const lat1 = toRad(lat);
    const lon1 = toRad(lon);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brg));
    const lon2 = lon1 +
        Math.atan2(Math.sin(brg) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    // Keep longitude in -180..180 so a route across the antimeridian stays sane.
    return { lat: toDeg(lat2), lon: (((toDeg(lon2) + 540) % 360) - 180) };
}
/** Smallest angle between two bearings, 0-180. */
export function angleBetween(a, b) {
    return foldTwa(a - b);
}
const NO_LAND_WARNING = 'This route is computed from wind and boat polar only. It does not know where land, ' +
    'shallows, or traffic schemes are — check every leg against your chart before sailing it.';
/**
 * Used instead when an obstacle field is supplied.
 *
 * The wording is deliberate and should not be softened. Steering around the
 * coastline outline is a coarse, shape-level check: it says the route does not
 * run overland, and says nothing whatever about whether the water it does run
 * through is deep enough or clear. A skipper who reads "avoids land" as
 * "checked" is in more danger than one who knows nothing was checked at all,
 * which is why the sentence leads with what is still unknown.
 */
const COARSE_LAND_WARNING = 'This route was kept clear of the coastline outline and any zones you have marked, but that is ' +
    'a check against a coarse outline of the shape of the land — it knows nothing of depths, rocks, ' +
    'reefs, buoyage or traffic schemes, and a strait it leaves open may not be. Check every leg ' +
    'against your chart before sailing it.';
function relativeSide(headingDeg, windFromDeg) {
    const delta = ((headingDeg - windFromDeg + 540) % 360) - 180;
    if (Math.abs(delta) < 1e-6 || Math.abs(Math.abs(delta) - 180) < 1e-6)
        return 0;
    return delta > 0 ? 1 : -1;
}
function buildLegs(node, polarName) {
    const chain = [];
    for (let n = node; n; n = n.parent)
        chain.push(n);
    chain.reverse();
    const legs = [];
    for (let i = 0; i < chain.length; i++) {
        const n = chain[i];
        const prev = i > 0 ? chain[i - 1] : null;
        let manoeuvre = null;
        if (prev && prev.tackSide !== 0 && n.tackSide !== 0 && prev.tackSide !== n.tackSide) {
            // Crossing the wind forward of the beam is a tack, behind it a gybe.
            manoeuvre = (prev.twaDeg + n.twaDeg) / 2 < 90 ? 'tack' : 'gybe';
        }
        legs.push({
            lat: n.lat,
            lon: n.lon,
            time: new Date(n.timeMs).toISOString(),
            headingDeg: Math.round(n.headingDeg * 10) / 10,
            twaDeg: Math.round(n.twaDeg * 10) / 10,
            twsKts: Math.round(n.twsKts * 10) / 10,
            boatSpeedKts: Math.round(n.boatSpeedKts * 100) / 100,
            distanceNm: Math.round(n.distanceNm * 100) / 100,
            manoeuvre
        });
    }
    return legs;
}
function totalDistance(legs) {
    return Math.round(legs.reduce((sum, l) => sum + l.distanceNm, 0) * 100) / 100;
}
/**
 * Compute a weather-optimal route.
 *
 * Returns the best route found even when the destination is not reached — a
 * frontier that stalls in a calm or runs past `maxHours` still says something
 * useful about the passage, and `reachedDestination` reports which happened.
 */
export function routeIsochrone(options) {
    const { start, destination, departure, polar, wind, stepMinutes = 60, headingResolutionDeg = 10, maxHours = 240, sectorWidthDeg = 2, maxOffCourseDeg = 110, manoeuvrePenaltyMinutes = 2, obstacles } = options;
    const avoiding = Boolean(obstacles && obstacles.count > 0);
    const warnings = [avoiding ? COARSE_LAND_WARNING : NO_LAND_WARNING];
    if (polar.generic) {
        warnings.push(`Timings come from a generic polar (${polar.name}), not this boat's measured performance — ` +
            'treat the ETA as a comparison between departure times, not a promise.');
    }
    if (polar.note)
        warnings.push(polar.note);
    const directDistanceNm = distanceNm(start.lat, start.lon, destination.lat, destination.lon);
    const stepHours = stepMinutes / 60;
    const maxSteps = Math.max(1, Math.floor(maxHours / stepHours));
    // Say so immediately when an end of the passage is inside an obstacle.
    //
    // Without this the search behaves badly in a way that reads as a bug: a
    // destination a few hundred metres inland is approachable but never
    // arrivable, so the frontier crowds the shore and then wanders for the whole
    // time limit — ten simulated days to say nothing. It is also the single most
    // likely mistake a user can make here, since a place name means the town and
    // towns are on land. Naming the problem is worth more than any route.
    if (avoiding) {
        const startZone = obstacles.contains(start.lat, start.lon);
        const destZone = obstacles.contains(destination.lat, destination.lon);
        const describe = (z) => z.kind === 'land' ? 'is on land' : `is inside the zone you marked${z.name ? ` — ${z.name}` : ''}`;
        if (startZone || destZone) {
            if (startZone)
                warnings.push(`The starting position ${describe(startZone)}, so no passage could be started from it.`);
            if (destZone)
                warnings.push(`The destination ${describe(destZone)}, so no passage could reach it. Pick a position in open water — the place search offers approaches offshore of each port.`);
            return {
                reachedDestination: false,
                legs: [],
                etaHours: 0,
                distanceNm: 0,
                directDistanceNm: Math.round(directDistanceNm * 100) / 100,
                warnings,
                polarName: polar.name
            };
        }
    }
    const root = {
        lat: start.lat,
        lon: start.lon,
        timeMs: departure,
        parent: null,
        headingDeg: bearingDeg(start.lat, start.lon, destination.lat, destination.lon),
        twaDeg: 0,
        twsKts: 0,
        boatSpeedKts: 0,
        distanceNm: 0,
        tackSide: 0
    };
    let frontier = [root];
    let best = root;
    let bestRemaining = directDistanceNm;
    for (let step = 0; step < maxSteps; step++) {
        const nextTime = departure + (step + 1) * stepMinutes * 60000;
        const candidates = [];
        for (const node of frontier) {
            const sample = wind(node.lat, node.lon, node.timeMs);
            if (!sample || !Number.isFinite(sample.speedKts))
                continue;
            const toDestination = bearingDeg(node.lat, node.lon, destination.lat, destination.lon);
            const remaining = distanceNm(node.lat, node.lon, destination.lat, destination.lon);
            // Final approach. Closing speed is velocity made good toward the
            // destination, not boat speed: the last miles are often dead upwind, and
            // a boat that must tack them still arrives — just later. Testing only a
            // heading that points straight at the destination would strand the search
            // a mile off a windward landfall, sailing in circles until it timed out.
            let closingVmg = 0;
            let closingHeading = toDestination;
            let closingTwa = angleBetween(toDestination, sample.directionDeg);
            for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
                const twa = angleBetween(heading, sample.directionDeg);
                const speed = boatSpeed(polar, twa, sample.speedKts);
                if (speed <= 0)
                    continue;
                const vmg = speed * Math.cos(toRad(angleBetween(heading, toDestination)));
                if (vmg > closingVmg) {
                    closingVmg = vmg;
                    closingHeading = heading;
                    closingTwa = twa;
                }
            }
            const arrivalBlocked = avoiding && obstacles.blocks(node.lat, node.lon, destination.lat, destination.lon) !== null;
            if (closingVmg > 0 && remaining <= closingVmg * stepHours && !arrivalBlocked) {
                const arrivalMs = node.timeMs + (remaining / closingVmg) * 3600000;
                const arrival = {
                    lat: destination.lat,
                    lon: destination.lon,
                    timeMs: arrivalMs,
                    parent: node,
                    headingDeg: closingHeading,
                    twaDeg: closingTwa,
                    twsKts: sample.speedKts,
                    boatSpeedKts: boatSpeed(polar, closingTwa, sample.speedKts),
                    distanceNm: remaining,
                    tackSide: relativeSide(closingHeading, sample.directionDeg)
                };
                const legs = buildLegs(arrival, polar.name);
                return {
                    reachedDestination: true,
                    legs,
                    etaHours: Math.round(((arrivalMs - departure) / 3600000) * 100) / 100,
                    distanceNm: totalDistance(legs),
                    directDistanceNm: Math.round(directDistanceNm * 100) / 100,
                    warnings,
                    polarName: polar.name
                };
            }
            for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
                if (angleBetween(heading, toDestination) > maxOffCourseDeg)
                    continue;
                const twa = angleBetween(heading, sample.directionDeg);
                const speed = boatSpeed(polar, twa, sample.speedKts);
                if (speed <= 0)
                    continue;
                // A manoeuvre eats into the step: the boat is slow through the turn and
                // the crew is busy, so the same hour covers less ground.
                const side = relativeSide(heading, sample.directionDeg);
                const manoeuvring = node.tackSide !== 0 && side !== 0 && side !== node.tackSide;
                const usableHours = manoeuvring
                    ? Math.max(0, stepHours - manoeuvrePenaltyMinutes / 60)
                    : stepHours;
                const legDistance = speed * usableHours;
                if (legDistance <= 0)
                    continue;
                const point = destinationPoint(node.lat, node.lon, heading, legDistance);
                // Discard during the search, not after it: a leg pruned here lets the
                // frontier find its way around the obstruction, whereas trimming a
                // finished route would just cut a corner off it.
                if (avoiding && obstacles.blocks(node.lat, node.lon, point.lat, point.lon))
                    continue;
                candidates.push({
                    lat: point.lat,
                    lon: point.lon,
                    timeMs: nextTime,
                    parent: node,
                    headingDeg: heading,
                    twaDeg: twa,
                    twsKts: sample.speedKts,
                    boatSpeedKts: speed,
                    distanceNm: legDistance,
                    tackSide: side
                });
            }
        }
        if (!candidates.length) {
            warnings.push(step === 0
                ? 'No forecast wind at the departure point and time, so no route could be started.'
                : 'The route stalled: no usable wind was forecast ahead of the last position reached.');
            break;
        }
        // Prune to one survivor per bearing-from-origin sector: the point that got
        // FURTHEST from the origin. That is what makes this an isochrone rather
        // than a greedy walk — keeping whichever point is nearest the destination
        // instead would collapse the search onto the rhumb line and never discover
        // that a detour into stronger wind arrives sooner. Without pruning at all,
        // the frontier multiplies by the heading count every step.
        const bins = new Map();
        let stepClosest = null;
        let stepClosestRemaining = Infinity;
        for (const candidate of candidates) {
            const sector = Math.round(bearingDeg(start.lat, start.lon, candidate.lat, candidate.lon) / sectorWidthDeg);
            const reach = distanceNm(start.lat, start.lon, candidate.lat, candidate.lon);
            const held = bins.get(sector);
            if (!held || reach > held.reach)
                bins.set(sector, { node: candidate, reach });
            // Tracked separately from pruning, so a route that never arrives can
            // still report its closest approach.
            const remaining = distanceNm(candidate.lat, candidate.lon, destination.lat, destination.lon);
            if (remaining < stepClosestRemaining) {
                stepClosestRemaining = remaining;
                stepClosest = candidate;
            }
            if (remaining < bestRemaining) {
                bestRemaining = remaining;
                best = candidate;
            }
        }
        frontier = [...bins.values()].map((b) => b.node);
        // Keep whichever point came nearest the destination, even if a sector-mate
        // sailed further. Pruning on reach alone lets the front fly past the
        // destination — it strands the search a mile short of a windward landfall,
        // because the node that could have closed was dropped for one that
        // overshot. The endgame needs the near miss, not the long shot.
        if (stepClosest && !frontier.includes(stepClosest)) {
            frontier.push(stepClosest);
        }
    }
    if (!warnings.some((w) => w.startsWith('The route stalled') || w.startsWith('No forecast wind'))) {
        warnings.push(`The destination was not reached within ${maxHours} hours; this is the best progress found.`);
    }
    const legs = buildLegs(best, polar.name);
    return {
        reachedDestination: false,
        legs,
        etaHours: Math.round(((best.timeMs - departure) / 3600000) * 100) / 100,
        distanceNm: totalDistance(legs),
        directDistanceNm: Math.round(directDistanceNm * 100) / 100,
        warnings,
        polarName: polar.name
    };
}
