import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchWindField, type Bounds, type WindField } from '@sentinel/weather';
import type { WindFieldAxes } from './windTypes';

/**
 * The wind under the chart — the same field the router plans on.
 *
 * Shared by every app in the fleet that draws wind on a chart, so that a navigator running two
 * of them is looking at one forecast rather than two renderings of it.
 *
 * The history is worth keeping, because it is the reason this hook exists at all. OceanSentinel
 * once had a second, older wind fetch that existed only for the animation: a 13x13 lattice over
 * +/-10 degrees, three-hourly, built by the app's own copy of an Open-Meteo call and mirrored
 * again in its API helper. Nothing was wrong with it in isolation. What was wrong was having
 * two of them.
 *
 * Two fetches of the same variable from the same provider will disagree, and every way they
 * disagreed there was an artifact rather than information: a different grid spacing, a
 * different time step, a different code path with its own bugs — the local copy had been
 * reading Open-Meteo's GMT timestamps as local time for as long as it had existed, which nobody
 * could see until the chart grew a clock. A navigator comparing the streaks on the chart
 * against the barbs on a passage would have been comparing two renderings of the same forecast
 * and finding differences that meant nothing.
 *
 * So the animation reads `fetchWindField` from `@sentinel/weather`: one degree, hourly,
 * `best_match`, in knots — the identical call, with the identical parameters, that the passage
 * planner and the underway advisory make. Where the chart's box overlaps a passage, the numbers
 * are not merely consistent; they are the same numbers.
 *
 * WHAT THIS DOES NOT MAKE IDENTICAL, deliberately. The barbs drawn along a filed passage are
 * what the forecast said WHEN IT WAS FILED, kept on the record for exactly that reason. The
 * animation is what it says now. Those two differing is the entire product of the underway
 * advisory — "this was not in your plan" — and collapsing them into one would delete the
 * feature.
 */

/** Half-width of the fetched box, in degrees. */
const HALF_SPAN_DEG = 6;

/** Grid spacing. The router's own default, and the reason the two agree. */
const RESOLUTION_DEG = 1;

/** Refetch cadence while the overlay stays on. */
const REFRESH_MS = 60 * 60 * 1000;

/**
 * Somewhere to keep a fetched field between sessions, if the host has one.
 *
 * Optional because the apps differ in whether it is worth anything. OceanSentinel plans
 * passages, so a field left behind by the chart can be planned on offshore an hour later and
 * the reverse — plan alongside, and the animation offshore is drawn from the plan's own
 * download. HarborSentinel sits at anchor within reach of the same forecast it fetched an hour
 * ago; there is no second consumer for the cache to feed, so it passes none and the hook simply
 * refetches.
 *
 * Both methods may reject; the hook treats a failure as a miss. A boat with no writable storage
 * still gets the overlay it just fetched.
 */
export interface WindFieldCache {
  remember(bounds: Bounds, resolutionDeg: number, field: WindField): Promise<void>;
  /** Returns the field and how stale it is, or null when nothing usable is stored. */
  recall(
    bounds: Bounds,
    resolutionDeg: number
  ): Promise<{ field: WindField; ageHours: number } | null>;
}

export interface UseWindFieldOptions {
  lat: number | null | undefined;
  lon: number | null | undefined;
  /** Nothing is fetched until this is true, and the field is dropped when it goes false. */
  enabled?: boolean;
  /** How far ahead the host's clock can be wound, which sizes the download. */
  hoursNeeded?: number;
  cache?: WindFieldCache | null;
}

/**
 * Why the field is missing, when it is.
 *
 * 'rate-limited' is separated out because it is the one cause that is temporary, not about the
 * location, and not the boat's fault. Reporting it as "no forecast for this water" — which is
 * what a single error string forced — sends someone hunting for a coverage problem that does
 * not exist, on the provider's clock rather than their own.
 */
export type WindFieldErrorKind = 'rate-limited' | 'unavailable' | null;

export interface UseWindFieldResult {
  field: WindField | null;
  axes: WindFieldAxes | null;
  /** The forecast's own span, for a caller bounding a time control against it. */
  span: { fromMs: number; toMs: number } | null;
  loading: boolean;
  error: string | null;
  errorKind: WindFieldErrorKind;
  /** Non-zero only when the field came back from the cache after a failed fetch. */
  ageHours: number;
  reload: () => Promise<void>;
}

/**
 * Where the box is centred, snapped so ordinary panning does not refetch.
 * Two degrees, well inside the six degrees of margin the box carries.
 */
function snap(value: number): number {
  return Math.round(value / 2) * 2;
}

export function useWindField({
  lat,
  lon,
  enabled = false,
  hoursNeeded = 120,
  cache = null
}: UseWindFieldOptions): UseWindFieldResult {
  const [field, setField] = useState<WindField | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<WindFieldErrorKind>(null);
  const [ageHours, setAgeHours] = useState(0);

  const centre = useMemo(
    () =>
      typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)
        ? { lat: snap(lat), lon: snap(lon) }
        : null,
    [lat, lon]
  );

  const bounds = useMemo<Bounds | null>(
    () =>
      centre
        ? {
            north: Math.min(89, centre.lat + HALF_SPAN_DEG),
            south: Math.max(-89, centre.lat - HALF_SPAN_DEG),
            east: Math.min(180, centre.lon + HALF_SPAN_DEG),
            west: Math.max(-180, centre.lon - HALF_SPAN_DEG)
          }
        : null,
    [centre]
  );

  /*
    How much forecast to ask for.

    Sized to how far the chart's clock can be wound rather than to a fixed horizon, so winding
    forward to a landfall five days out animates the wind there instead of holding the last hour
    of an arbitrary window. Rounded to whole days so the number does not change every minute and
    refetch.
  */
  const days = useMemo(
    () => Math.min(16, Math.max(2, Math.ceil(hoursNeeded / 24) + 1)),
    [hoursNeeded]
  );

  const load = useCallback(async () => {
    if (!bounds) return;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    try {
      const fetched = await fetchWindField(bounds, { resolutionDeg: RESOLUTION_DEG, days });
      setField(fetched);
      setAgeHours(0);
      cache?.remember(bounds, RESOLUTION_DEG, fetched).catch(() => {
        /* a boat with no writable storage still gets the overlay it just fetched */
      });
    } catch (err) {
      const recalled = cache
        ? await cache.recall(bounds, RESOLUTION_DEG).catch(() => null)
        : null;
      if (recalled) {
        setField(recalled.field);
        setAgeHours(recalled.ageHours);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setField(null);
        setError(message);
        // Open-Meteo meters by coordinate, and one field is a 13x13 grid, so an hourly cap is
        // reachable by ordinary use rather than only by abuse. It clears on its own.
        setErrorKind(/429|rate limit|request limit/i.test(message) ? 'rate-limited' : 'unavailable');
      }
    } finally {
      setLoading(false);
    }
  }, [bounds, days, cache]);

  useEffect(() => {
    if (!enabled || !bounds) return undefined;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, bounds, load]);

  // Dropped when the overlay is switched off. A sixteen-day field over a hundred and sixty-nine
  // points is megabytes, and holding it for a layer nobody is looking at is how a long passage
  // ends with the tablet out of memory.
  useEffect(() => {
    if (!enabled) setField(null);
  }, [enabled]);

  /**
   * The axes as the animation worker wants them.
   *
   * The worker reads `latGrid[0][0]` and `latGrid[rows-1][0]` to derive its own spacing, so it
   * needs the axes as 2D arrays. Built once per field rather than per frame — it is a hundred
   * and sixty-nine numbers, and doing it here keeps the worker's protocol exactly as it was.
   */
  const axes = useMemo<WindFieldAxes | null>(() => {
    if (!field?.lats?.length || !field?.lons?.length) return null;
    return {
      latGrid: field.lats.map((la) => field.lons.map(() => la)),
      lonGrid: field.lats.map(() => field.lons.slice())
    };
  }, [field]);

  const span = useMemo(
    () =>
      field?.times?.length
        ? { fromMs: field.times[0], toMs: field.times[field.times.length - 1] }
        : null,
    [field]
  );

  return { field, axes, span, loading, error, errorKind, ageHours, reload: load };
}

export default useWindField;
