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
 *   - LAND AVOIDANCE IS COARSE, AND OPTIONAL. Given an `obstacles` field the
 *     search discards any leg that crosses it, so a route will not run over
 *     the coastline outline or a zone the skipper has marked. Without one it
 *     knows nothing of the coast at all. Neither case is navigational safety:
 *     the outline carries no depths, rocks, reefs, buoyage or traffic
 *     schemes. Every result says which case it was in `warnings`, and callers
 *     must present it as a weather plan to lay over a chart, never as a
 *     course to steer.
 *   - No currents, no leeway. Sea state is used, but coarsely: significant
 *     wave height and the angle it meets the boat at slow the polar down, and
 *     a wave height limit steers the search around water rougher than the
 *     skipper is willing to sail. Both are approximations of a boat nobody
 *     measured in a seaway — see `seaStateFactor` — and both are optional:
 *     with no `waves` sampler this behaves exactly as it did when it was
 *     wind-only.
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
/**
 * How much of its polar speed a boat keeps in a given sea.
 *
 * Added resistance in waves rises roughly with the square of wave height and
 * falls with the length of the boat, which gives the shape used here:
 *
 *     loss = coefficient · Hs² · angleFactor / referenceLength
 *
 * With the defaults, a 12 m boat punching into it loses about 3% of its speed
 * in a 1 m sea, 10% in 2 m, 22% in 3 m and 40% in 4 m. Those are the right
 * order of magnitude for a cruising boat and they are not this boat's numbers.
 * Nothing here is measured: not the coefficient, not the angle shape, and not
 * the boat. It is a defensible curve standing in for a sea trial nobody ran,
 * and every route computed with it says so in its warnings.
 *
 * The angle factor is full strength dead on the bow, falls away through the
 * beam, and keeps a small floor dead astern — a following sea still costs a
 * cruising boat something in steering and rolling, even when it is not the
 * wall a head sea is. It deliberately never goes negative: a boat that surfs
 * down a swell is a real effect and modelling it as free speed is how a router
 * talks a crew into a passage it should not make.
 *
 * Wave period is not in this. A short steep sea hurts far more than a long
 * swell of the same height, and pretending otherwise is the largest single
 * error left in here — but a period term guessed as loosely as the rest would
 * add error while looking like precision. Period is carried through to the
 * legs so a navigator can apply the judgement this cannot.
 */
export function seaStateFactor(heightM, waveAngleDeg, options = {}) {
    const { referenceLengthM = 12, coefficient = 0.3, maxLossFraction = 0.6 } = options;
    if (!Number.isFinite(heightM) || heightM <= 0)
        return 1;
    if (!(referenceLengthM > 0))
        return 1;
    const angle = foldTwa(waveAngleDeg);
    const head = (1 + Math.cos(toRad(angle))) / 2; // 1 dead ahead, 0 dead astern
    const angleFactor = 0.1 + 0.9 * head ** 1.5;
    const loss = (coefficient * heightM * heightM * angleFactor) / referenceLengthM;
    return 1 - Math.min(maxLossFraction, Math.max(0, loss));
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
/**
 * What using sea state does, and does not, entitle a route to claim.
 *
 * Appended at the end rather than led with, because unlike the land warning it
 * is not the thing most likely to hurt someone — but it is not optional
 * either. A boat given a wave-aware ETA will trust it further than a wind-only
 * one, and the extra trust is not earned by anything measured.
 *
 * The no-data case gets its own sentence for the same reason a calm and a
 * headwind do: a plan that quietly fell back to wind-only, in exactly the
 * coastal or high-latitude corners where the marine models thin out, is one a
 * skipper would otherwise read as having been checked against the sea.
 */
function seaStateWarnings(waves, sampleCount, seaLimit) {
    if (!waves)
        return [];
    if (sampleCount === 0) {
        return [
            'No sea state covered this passage, so these timings are from wind and polar alone. The ' +
                'marine forecast reaches neither as far ahead nor as far into coastal water as the wind ' +
                'one does, and where it stops this route knows nothing about the sea it is crossing.'
        ];
    }
    const notes = [
        'Sea state is charged against the boat as a coarse speed penalty from wave height and the ' +
            'angle it meets the boat at. It is a reasonable curve for a cruising boat, not this boat ' +
            'measured in a seaway, and it ignores wave period entirely — a short steep sea costs far ' +
            'more than a long swell of the same height. Treat a rough-weather ETA as the optimistic end.'
    ];
    if (seaLimit !== null) {
        notes.push(`The route was kept out of seas above ${seaLimit} m, checked at each simulated position ` +
            'rather than continuously — a patch of rougher water narrower than one step of the search ' +
            'can be stepped straight over. It keeps a passage out of a gale; it does not promise every ' +
            'mile of it is under the limit.');
    }
    return notes;
}
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
            gustKts: n.gustKts === null ? null : Math.round(n.gustKts * 10) / 10,
            boatSpeedKts: Math.round(n.boatSpeedKts * 100) / 100,
            distanceNm: Math.round(n.distanceNm * 100) / 100,
            manoeuvre,
            waveHeightM: n.waveHeightM === null ? null : Math.round(n.waveHeightM * 10) / 10,
            waveAngleDeg: n.waveAngleDeg === null ? null : Math.round(n.waveAngleDeg),
            wavePeriodS: n.wavePeriodS === null ? null : Math.round(n.wavePeriodS)
        });
    }
    return legs;
}
function totalDistance(legs) {
    return Math.round(legs.reduce((sum, l) => sum + l.distanceNm, 0) * 100) / 100;
}
/**
 * The roughest water the route goes through, rounded as the legs are.
 *
 * Taken from the legs rather than tracked during the search, so it describes
 * the passage that was actually chosen and not the worst sea the frontier
 * looked at and rejected.
 */
function worstSeas(legs) {
    let worst = null;
    for (const leg of legs) {
        if (leg.waveHeightM === null)
            continue;
        if (worst === null || leg.waveHeightM > worst)
            worst = leg.waveHeightM;
    }
    return worst;
}
/**
 * Compute a weather-optimal route.
 *
 * Returns the best route found even when the destination is not reached — a
 * frontier that stalls in a calm or runs past `maxHours` still says something
 * useful about the passage, and `reachedDestination` reports which happened.
 */
export function routeIsochrone(options) {
    const { start, destination, departure, polar, wind, stepMinutes = 60, headingResolutionDeg = 10, maxHours = 240, sectorWidthDeg = 2, maxOffCourseDeg = 110, manoeuvrePenaltyMinutes = 2, obstacles, waves, maxWaveHeightM, seaState } = options;
    const avoiding = Boolean(obstacles && obstacles.count > 0);
    const warnings = [avoiding ? COARSE_LAND_WARNING : NO_LAND_WARNING];
    if (polar.generic) {
        warnings.push(`Timings come from a generic polar (${polar.name}), not this boat's measured performance — ` +
            'treat the ETA as a comparison between departure times, not a promise.');
    }
    if (polar.note)
        warnings.push(polar.note);
    const seaLimit = Number.isFinite(maxWaveHeightM) ? maxWaveHeightM : null;
    // Whether the sea state ever actually resolved. A sampler that was supplied
    // but had nothing for this passage must not leave the result looking like it
    // was routed through waves, so the count decides which warning is told.
    let waveSampleCount = 0;
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
                polarName: polar.name,
                maxWaveHeightM: null
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
        gustKts: null,
        boatSpeedKts: 0,
        distanceNm: 0,
        tackSide: 0,
        waveHeightM: null,
        waveAngleDeg: null,
        wavePeriodS: null
    };
    let frontier = [root];
    let best = root;
    let bestRemaining = directDistanceNm;
    for (let step = 0; step < maxSteps; step++) {
        const nextTime = departure + (step + 1) * stepMinutes * 60000;
        const candidates = [];
        // Why each course was discarded, so an empty step can say what actually
        // stopped it. "No wind" was the only explanation on offer, and it was
        // usually the wrong one: a boat pinned in a bay by a headwind has plenty
        // of wind and nowhere it is allowed to point.
        let blockedByLand = 0;
        let unsailable = 0;
        let noWind = 0;
        let calm = 0;
        let tooRough = 0;
        for (const node of frontier) {
            const sample = wind(node.lat, node.lon, node.timeMs);
            if (!sample || !Number.isFinite(sample.speedKts)) {
                noWind++;
                continue;
            }
            // A calm is not a headwind. Both leave the boat going nowhere, but only
            // one of them is fixed by waiting for a shift, so they must not share a
            // message.
            if (sample.speedKts <= 0) {
                calm++;
                continue;
            }
            // The sea here, and what the boat keeps of its polar in it. Sampled once
            // per position: the height and the direction of the sea do not depend on
            // which course is being tried, only the angle between them does.
            const sea = waves ? waves(node.lat, node.lon, node.timeMs) : null;
            if (sea && Number.isFinite(sea.heightM)) {
                waveSampleCount++;
                // Above the skipper's limit this water is simply not available, the
                // same as land. Dropping the whole position rather than each course
                // is what lets the frontier route around a gale instead of into it.
                if (seaLimit !== null && sea.heightM > seaLimit) {
                    tooRough++;
                    continue;
                }
            }
            const speedIn = (headingDeg, twaDeg) => {
                const base = boatSpeed(polar, twaDeg, sample.speedKts);
                if (!sea || !Number.isFinite(sea.heightM) || base <= 0)
                    return base;
                return base * seaStateFactor(sea.heightM, angleBetween(headingDeg, sea.directionDeg), seaState);
            };
            const seaOf = (headingDeg) => ({
                waveHeightM: sea && Number.isFinite(sea.heightM) ? sea.heightM : null,
                waveAngleDeg: sea && Number.isFinite(sea.heightM)
                    ? angleBetween(headingDeg, sea.directionDeg)
                    : null,
                wavePeriodS: sea?.periodS ?? null
            });
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
                const speed = speedIn(heading, twa);
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
                    gustKts: sample.gustKts ?? null,
                    boatSpeedKts: speedIn(closingHeading, closingTwa),
                    distanceNm: remaining,
                    tackSide: relativeSide(closingHeading, sample.directionDeg),
                    ...seaOf(closingHeading)
                };
                const legs = buildLegs(arrival, polar.name);
                return {
                    reachedDestination: true,
                    legs,
                    etaHours: Math.round(((arrivalMs - departure) / 3600000) * 100) / 100,
                    distanceNm: totalDistance(legs),
                    directDistanceNm: Math.round(directDistanceNm * 100) / 100,
                    warnings: [...warnings, ...seaStateWarnings(waves, waveSampleCount, seaLimit)],
                    polarName: polar.name,
                    maxWaveHeightM: worstSeas(legs)
                };
            }
            for (let heading = 0; heading < 360; heading += headingResolutionDeg) {
                if (angleBetween(heading, toDestination) > maxOffCourseDeg)
                    continue;
                const twa = angleBetween(heading, sample.directionDeg);
                const speed = speedIn(heading, twa);
                if (speed <= 0) {
                    unsailable++;
                    continue;
                }
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
                if (avoiding && obstacles.blocks(node.lat, node.lon, point.lat, point.lon)) {
                    blockedByLand++;
                    continue;
                }
                candidates.push({
                    lat: point.lat,
                    lon: point.lon,
                    timeMs: nextTime,
                    parent: node,
                    headingDeg: heading,
                    twaDeg: twa,
                    twsKts: sample.speedKts,
                    gustKts: sample.gustKts ?? null,
                    boatSpeedKts: speed,
                    distanceNm: legDistance,
                    tackSide: side,
                    ...seaOf(heading)
                });
            }
        }
        if (!candidates.length) {
            const where = step === 0 ? 'from the starting position' : 'from the last position reached';
            // Said first and on its own terms, because it is the one cause here the
            // skipper chose: the limit is a setting, and "your limit stopped this"
            // is a different sentence from "the sea stopped this".
            if (tooRough) {
                warnings.push(step === 0
                    ? `The sea at the departure point is already above the ${seaLimit} m limit set, so no ` +
                        'passage could be started. A later departure may find it down.'
                    : `The route stopped: every position it could sail on from is in seas above the ` +
                        `${seaLimit} m limit set.`);
            }
            // Everything else the search ran into. Skipped entirely when the sea
            // limit was the only thing in the way, so a route the skipper's own
            // setting stopped is not also told the wind was against it.
            if (noWind || calm || blockedByLand || unsailable) {
                if ((noWind || calm) && !blockedByLand && !unsailable) {
                    warnings.push(step === 0
                        ? 'No forecast wind at the departure point and time, so no route could be started.'
                        : 'The route stalled: no usable wind was forecast ahead of the last position reached.');
                }
                else if (blockedByLand && !unsailable) {
                    warnings.push(`Every course ${where} runs into land within one step of the search. ` +
                        'Start further offshore, where a passage plan is the right tool.');
                }
                else if (unsailable && !blockedByLand) {
                    warnings.push(`The wind is dead against this passage ${where}: every course open to the search is ` +
                        'inside the angle this boat cannot sail. Try a later departure.');
                }
                else {
                    // Both, which is the boxed-in case: what land leaves open, the wind
                    // forbids. Naming both is the whole point — either alone reads as a
                    // different and fixable problem.
                    warnings.push(`There is no way out ${where}: the courses that clear the land are ones this boat ` +
                        'cannot sail against the forecast wind, and the courses it could sail run ashore. ' +
                        'Beating out of somewhere this tight is pilotage, which this planner does not do — ' +
                        'start from open water, or wait for a shift.');
                }
            }
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
        warnings: [...warnings, ...seaStateWarnings(waves, waveSampleCount, seaLimit)],
        polarName: polar.name,
        maxWaveHeightM: worstSeas(legs)
    };
}
