import { type Bounds, type WindField } from '@sentinel/weather';
import type { WindFieldAxes } from './windTypes';
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
    recall(bounds: Bounds, resolutionDeg: number): Promise<{
        field: WindField;
        ageHours: number;
    } | null>;
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
export interface UseWindFieldResult {
    field: WindField | null;
    axes: WindFieldAxes | null;
    /** The forecast's own span, for a caller bounding a time control against it. */
    span: {
        fromMs: number;
        toMs: number;
    } | null;
    loading: boolean;
    error: string | null;
    /** Non-zero only when the field came back from the cache after a failed fetch. */
    ageHours: number;
    reload: () => Promise<void>;
}
export declare function useWindField({ lat, lon, enabled, hoursNeeded, cache }: UseWindFieldOptions): UseWindFieldResult;
export default useWindField;
