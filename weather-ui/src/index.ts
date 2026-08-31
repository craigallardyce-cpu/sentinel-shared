export { default as AlertsPanel } from './AlertsPanel';
export type { WeatherAlert, WeatherData, AlertsPanelProps } from './AlertsPanel';

export { default as ForecastTimeline } from './ForecastTimeline';
export type { ForecastPeriod, ForecastTimelineProps } from './ForecastTimeline';

export * from './weatherUtils';

export { WIND_BANDS, windBandRgb, windBandColor, windScaleGradient, windBandEdges } from './windScale';
export type { WindBand } from './windScale';

/*
  The chart's wind and radar layers.
  ---------------------------------------------------------------------------
  These were OceanSentinel's alone — a Leaflet canvas layer, a particle worker,
  a RainViewer hook and a legend, living in `components/tacticalMap/` and
  `hooks/`. HarborSentinel wanted the same three overlays on its own chart, and
  the fleet has been bitten before by "the same feature" meaning two
  implementations that quietly disagree: the wind colour scale in `windScale`
  above is here precisely because it had already happened once.

  So they moved here rather than being copied. `WindCanvasLayer` needs Leaflet
  and react-leaflet, which is why this package now declares them as peers —
  every app that draws a chart already has both.
*/
export { default as WindCanvasLayer } from './WindCanvasLayer';
export type { WindCanvasLayerProps } from './WindCanvasLayer';

export { default as WindLegend } from './WindLegend';
export type { WindLegendProps } from './WindLegend';

export { useWindField } from './useWindField';
export type {
  WindFieldCache,
  UseWindFieldOptions,
  UseWindFieldResult
} from './useWindField';

export { useRadarFrames, radarTileUrl, RADAR_MAX_NATIVE_ZOOM } from './useRadarFrames';
export type { RadarFrame, UseRadarFramesOptions, UseRadarFramesResult } from './useRadarFrames';

export { WIND_WORKER_SOURCE, createWindWorker } from './windParticleWorker';
export type { WindWorkerHandle } from './windParticleWorker';

export type {
  WindFieldLike,
  WindFieldAxes,
  WindGridBounds,
  ChartBackground
} from './windTypes';
