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
export const RADAR_LIVE_MAX_AGE_MIN = 20;

/** "-30m", or "-3h" once minutes stop being the useful unit. */
function agoLabel(minutesAgo: number): string {
  const minutes = Math.max(0, minutesAgo);
  return minutes >= 120 ? `-${Math.round(minutes / 60)}h` : `-${minutes}m`;
}

/**
 * Frames with their labels as of `nowMs`. The newest is "Live" only while it
 * is recent; after that it is labelled with its age like any other.
 */
export function labelFrames(
  frames: Array<{ time: number; path: string }>,
  nowMs: number
): RadarFrame[] {
  return frames.map((frame, index) => {
    const timeStr = new Date(frame.time * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    const minutesAgo = Math.round((nowMs - frame.time * 1000) / (60 * 1000));
    const isNewest = index === frames.length - 1;
    const relativeText =
      isNewest && minutesAgo <= RADAR_LIVE_MAX_AGE_MIN ? 'Live' : agoLabel(minutesAgo);
    return {
      time: frame.time,
      path: frame.path,
      timeLabel: `${timeStr} (${relativeText})`,
      relativeLabel: relativeText
    };
  });
}

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
export function useRadarFrames({
  radarEnabled = false
}: UseRadarFramesOptions = {}): UseRadarFramesResult {
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [radarHost, setRadarHost] = useState(DEFAULT_RADAR_HOST);

  const loadRadarFrames = useCallback(async () => {
    /*
      A refresh that fails leaves the frames already held, and they go on being
      drawn, so their labels are brought up to date instead. The newest frame
      was labelled "Live" when it arrived and kept that label for as long as
      RainViewer could not be reached: a boat that lost its connection at dusk
      was still looking at "Live" radar at midnight.
    */
    const relabel = () => setRadarFrames((held) => labelFrames(held, Date.now()));
    try {
      const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if (!response.ok) return relabel();
      const data = await response.json();
      if (!data.radar?.past?.length) return relabel();

      setRadarHost(data.host || DEFAULT_RADAR_HOST);
      setRadarFrames(labelFrames(data.radar.past, Date.now()));
    } catch (err) {
      console.error('[Weather] Failed to fetch RainViewer radar frames:', err);
      relabel();
    }
  }, []);

  useEffect(() => {
    if (!radarEnabled) return;
    loadRadarFrames();
    const intervalId = setInterval(loadRadarFrames, RADAR_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [radarEnabled, loadRadarFrames]);

  // The chart shows a single still frame rather than an animated loop, so only the newest frame
  // is ever needed.
  const latestRadarFrame = useMemo(
    () => (radarFrames.length > 0 ? radarFrames[radarFrames.length - 1] : null),
    [radarFrames]
  );

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
export function radarTileUrl(host: string, frame: RadarFrame): string {
  return `${host}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`;
}

export default useRadarFrames;
