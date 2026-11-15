/**
 * RainViewer serves real radar only to zoom 7; every tile above it comes back as a grey
 * "Zoom Level Not Supported" placeholder, which tiles the whole chart at navigation zooms.
 * Capping a TileLayer's `maxNativeZoom` at this makes Leaflet stretch the z7 tile instead of
 * asking for one it will not get.
 */
export declare const RADAR_MAX_NATIVE_ZOOM = 7;
export interface RadarFrame {
    /** Epoch seconds, as RainViewer publishes it. */
    time: number;
    /** Path fragment to append to the host. */
    path: string;
    /** "14:20 (Live)" or "14:20 (-30m)": absolute time with how long ago it was. */
    timeLabel: string;
    /** "Live" for a recent newest frame, otherwise "-30m" or "-3h". */
    relativeLabel: string;
}
/**
 * How old the newest frame may be and still be called "Live". RainViewer
 * publishes about every ten minutes and a frame is a few minutes old when it
 * appears, so twenty covers a healthy feed and nothing staler.
 */
export declare const RADAR_LIVE_MAX_AGE_MIN = 20;
/**
 * Frames with their labels as of `nowMs`. The newest is "Live" only while it
 * is recent; after that it is labelled with its age like any other.
 */
export declare function labelFrames(frames: Array<{
    time: number;
    path: string;
}>, nowMs: number): RadarFrame[];
export interface UseRadarFramesOptions {
    /** Lazy: nothing is fetched until this is true. */
    radarEnabled?: boolean;
}
export interface UseRadarFramesResult {
    radarFrames: RadarFrame[];
    radarHost: string;
    latestRadarFrame: RadarFrame | null;
    refreshRadarFrames: () => Promise<void>;
}
/**
 * The RainViewer radar frames a chart's precipitation overlay draws from.
 *
 * Radar is the one weather layer that cannot be wound forward. RainViewer publishes what the
 * radar actually saw; there is no forecast frame for Thursday. Callers should therefore fetch
 * and draw it only while their clock reads live — drawn under a wound clock it looks like rain
 * the chart is predicting, which is the one thing it never is.
 */
export declare function useRadarFrames({ radarEnabled }?: UseRadarFramesOptions): UseRadarFramesResult;
/**
 * The Leaflet tile URL template for a frame.
 *
 * The trailing `/2/1_0.png` is RainViewer's colour scheme (2, "Universal Blue") and its
 * smooth/snow flags. Written here rather than at each call site so the fleet's radar looks the
 * same in every app.
 */
export declare function radarTileUrl(host: string, frame: RadarFrame): string;
export default useRadarFrames;
