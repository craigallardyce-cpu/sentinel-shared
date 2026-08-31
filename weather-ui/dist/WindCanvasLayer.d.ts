import type { ChartBackground, WindFieldAxes, WindFieldLike } from './windTypes';
export interface WindCanvasLayerProps {
    /** The field to draw. Structurally a `WindField` from `@sentinel/weather`. */
    field: WindFieldLike | null;
    /** Its axes as 2D arrays, which is the shape the worker's interpolator reads. */
    axes: WindFieldAxes | null;
    /** Which forecast hour to draw. */
    timeIndex?: number;
    /** Night mode overrides the palette question entirely — see below. */
    isNightMode?: boolean;
    /** How the basemap underneath reads, which is what picks the palette. */
    chartBackground?: ChartBackground;
    /** Particles alive at once. Lower it on a phone. */
    maxParticles?: number;
    /**
     * Dot radius in pixels, and how fast the trail fades (0-1 alpha removed per frame).
     *
     * Both exist because the same field is drawn at wildly different scales. At passage zoom a
     * particle crosses several grid cells, so it moves visibly and 1.8px dots at a 0.12 fade
     * leave long, legible streaks. At anchor-watch zoom the whole viewport sits inside ONE cell
     * of a 1-degree grid: every particle carries the same vector, and in light airs it moves a
     * fifth of a pixel per frame. The streaks collapse to specks, and wind reads as dust.
     *
     * Raising the radius and slowing the fade buys back a visible mark and a longer tail, which
     * is the honest presentation of "one wind, everywhere here" — the alternative is a layer that
     * looks broken whenever it is calm.
     */
    particleRadius?: number;
    trailFade?: number;
}
/**
 * Draws the wind field onto a canvas laid over the chart.
 *
 * Shared by every app in the fleet that shows a chart. It was OceanSentinel's
 * `tacticalMap/WeatherCanvasLayer.jsx`, itself ported from the CanvasWeatherOverlay inside the
 * long-removed MapLibre WindGribMap. The drawing maths has not changed through either move;
 * only the projection swapped, from MapLibre's `map.project([lon, lat])` to Leaflet's
 * `map.latLngToContainerPoint([lat, lon])`.
 *
 * The canvas is kept in container space: sized to the map viewport and repositioned to the
 * container's top-left corner on every move, the same technique Leaflet's own canvas renderer
 * uses.
 *
 * WHAT IT DRAWS FROM. A `WindField` — the same structure, and where the apps share a cache the
 * same download, that the passage router plans on. The streaks on the chart and the barbs on a
 * passage therefore cannot disagree about what the forecast says. See `useWindField`.
 */
export default function WindCanvasLayer({ field, axes, timeIndex, isNightMode, chartBackground, maxParticles, particleRadius, trailFade }: WindCanvasLayerProps): null;
