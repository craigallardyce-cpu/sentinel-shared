import { useState, useEffect, useCallback, useMemo } from 'react';
const DEFAULT_RADAR_HOST = 'https://tilecache.rainviewer.com';
// RainViewer publishes a new radar frame roughly every ten minutes. As a chart overlay this can
// stay switched on for a whole passage or a whole night at anchor, so the list refreshes on a
// timer rather than once per visit to a weather tab.
const RADAR_REFRESH_MS = 10 * 60 * 1000;
/**
 * RainViewer serves real radar only to zoom 7; every tile above it comes back as a grey
 * "Zoom Level Not Supported" placeholder, which tiles the whole chart at navigation zooms.
 * Capping a TileLayer's `maxNativeZoom` at this makes Leaflet stretch the z7 tile instead of
 * asking for one it will not get.
 */
export const RADAR_MAX_NATIVE_ZOOM = 7;
/**
 * The RainViewer radar frames a chart's precipitation overlay draws from.
 *
 * Radar is the one weather layer that cannot be wound forward. RainViewer publishes what the
 * radar actually saw; there is no forecast frame for Thursday. Callers should therefore fetch
 * and draw it only while their clock reads live — drawn under a wound clock it looks like rain
 * the chart is predicting, which is the one thing it never is.
 */
export function useRadarFrames({ radarEnabled = false } = {}) {
    const [radarFrames, setRadarFrames] = useState([]);
    const [radarHost, setRadarHost] = useState(DEFAULT_RADAR_HOST);
    const loadRadarFrames = useCallback(async () => {
        try {
            const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
            if (!response.ok)
                return;
            const data = await response.json();
            if (!data.radar?.past?.length)
                return;
            setRadarHost(data.host || DEFAULT_RADAR_HOST);
            const frames = data.radar.past.map((frame, index) => {
                const timeStr = new Date(frame.time * 1000).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                const minutesAgo = Math.round((Date.now() - frame.time * 1000) / (60 * 1000));
                const relativeText = index === data.radar.past.length - 1 ? 'Live' : `-${minutesAgo}m`;
                return {
                    time: frame.time,
                    path: frame.path,
                    timeLabel: `${timeStr} (${relativeText})`,
                    relativeLabel: relativeText
                };
            });
            setRadarFrames(frames);
        }
        catch (err) {
            console.error('[Weather] Failed to fetch RainViewer radar frames:', err);
        }
    }, []);
    useEffect(() => {
        if (!radarEnabled)
            return;
        loadRadarFrames();
        const intervalId = setInterval(loadRadarFrames, RADAR_REFRESH_MS);
        return () => clearInterval(intervalId);
    }, [radarEnabled, loadRadarFrames]);
    // The chart shows a single still frame rather than an animated loop, so only the newest frame
    // is ever needed.
    const latestRadarFrame = useMemo(() => (radarFrames.length > 0 ? radarFrames[radarFrames.length - 1] : null), [radarFrames]);
    return {
        radarFrames,
        radarHost,
        latestRadarFrame,
        refreshRadarFrames: loadRadarFrames
    };
}
/**
 * The Leaflet tile URL template for a frame.
 *
 * The trailing `/2/1_0.png` is RainViewer's colour scheme (2, "Universal Blue") and its
 * smooth/snow flags. Written here rather than at each call site so the fleet's radar looks the
 * same in every app.
 */
export function radarTileUrl(host, frame) {
    return `${host}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`;
}
export default useRadarFrames;
