import { useRef, useEffect, useCallback } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { createWindWorker } from './windParticleWorker';
import { windBandRgb } from './windScale';
// Sits above the tile pane (200) but below the overlay pane (400, route lines and vectors) and
// the marker pane (600), so weather never paints over own ship, AIS targets, a plotted route or
// an anchor's swing circle.
const PANE_NAME = 'weatherOverlayPane';
const PANE_Z_INDEX = 250;
// Particle step, expressed in screen pixels per knot per frame rather than degrees, so the drift
// reads the same at every zoom. A fixed degree step tuned for a view of the whole grid throws
// every particle off screen within a frame or two at chart zoom, which is why wind used to look
// unsupported once you zoomed in.
const PIXELS_PER_KNOT_PER_FRAME = 0.075;
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
export default function WindCanvasLayer({ field, axes, timeIndex = 0, isNightMode = false, chartBackground = 'dark', maxParticles = 900, particleRadius = 1.8, trailFade = 0.12 }) {
    const map = useMap();
    const canvasRef = useRef(null);
    const workerRef = useRef(null);
    // Leaflet CSS-scales the map pane through a zoom animation, so container-space drawing is
    // wrong for its duration. Blank the canvas rather than smear it.
    const isZoomingRef = useRef(false);
    // -- Canvas element lives in its own Leaflet pane --------------------------
    useEffect(() => {
        let pane = map.getPane(PANE_NAME);
        if (!pane) {
            pane = map.createPane(PANE_NAME);
            pane.style.zIndex = String(PANE_Z_INDEX);
        }
        // Never intercept clicks, drags or any tool underneath.
        pane.style.pointerEvents = 'none';
        const canvas = L.DomUtil.create('canvas', 'leaflet-weather-canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        pane.appendChild(canvas);
        canvasRef.current = canvas;
        return () => {
            canvasRef.current = null;
            if (canvas.parentNode)
                canvas.parentNode.removeChild(canvas);
        };
    }, [map]);
    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        if (ctx)
            ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, []);
    // Resize to the viewport and pin to the container's top-left in layer coordinates.
    const reposition = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const size = map.getSize();
        if (canvas.width !== size.x || canvas.height !== size.y) {
            canvas.width = size.x;
            canvas.height = size.y;
            canvas.style.width = `${size.x}px`;
            canvas.style.height = `${size.y}px`;
        }
        L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    }, [map]);
    // -- Seed the particles into what is actually on screen ---------------------
    // The grid covers many degrees with sixty nautical miles between nodes, so at navigation zoom
    // the visible chart is a sliver of it. Seeding across the whole grid put nearly every particle
    // out of view; the worker is told the visible box instead, clamped to the grid because the
    // interpolator has no data outside it.
    const syncWorkerView = useCallback(() => {
        const handle = workerRef.current;
        if (!handle || !field?.lats?.length)
            return;
        // Read off the field's own axes rather than carried alongside it. They are ascending,
        // south to north and west to east.
        const gridBounds = {
            latMin: field.lats[0],
            latMax: field.lats[field.lats.length - 1],
            lonMin: field.lons[0],
            lonMax: field.lons[field.lons.length - 1]
        };
        const view = map.getBounds();
        // A little past the edge of the screen, so particles drift in rather than winking on at the
        // border of the viewport.
        const seedArea = view.pad(0.15);
        const visible = {
            latMin: Math.max(seedArea.getSouth(), gridBounds.latMin),
            latMax: Math.min(seedArea.getNorth(), gridBounds.latMax),
            lonMin: Math.max(seedArea.getWest(), gridBounds.lonMin),
            lonMax: Math.min(seedArea.getEast(), gridBounds.lonMax)
        };
        const overlapsGrid = visible.latMax > visible.latMin && visible.lonMax > visible.lonMin;
        const degPerPixel = (view.getEast() - view.getWest()) / Math.max(map.getSize().x, 1);
        handle.worker.postMessage({
            type: 'view',
            data: {
                bounds: overlapsGrid ? visible : gridBounds,
                speedScale: PIXELS_PER_KNOT_PER_FRAME * degPerPixel
            }
        });
    }, [map, field]);
    // -- Wind particle field ----------------------------------------------------
    const drawWindParticles = useCallback((ctx, coords) => {
        if (isZoomingRef.current)
            return;
        // Fade the previous frame instead of clearing it, which is what leaves the streak trails.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        const count = coords.length / 4;
        /*
          The palette follows the BASEMAP, not the app's own light/dark setting: satellite imagery
          is dark and the ENC and street charts are light, and a colour that reads on one disappears
          into the other. Night mode is a separate question again and overrides everything, because
          the point of it is not to emit any other colour.
        */
        const isLightBg = !isNightMode && chartBackground === 'light';
        for (let i = 0; i < count; i++) {
            const lon = coords[i * 4];
            const lat = coords[i * 4 + 1];
            const speed = coords[i * 4 + 2];
            const agePct = coords[i * 4 + 3];
            const point = map.latLngToContainerPoint([lat, lon]);
            const cx = point.x;
            const cy = point.y;
            if (cx >= 0 && cx <= ctx.canvas.width && cy >= 0 && cy <= ctx.canvas.height) {
                const opacity = agePct < 0.25
                    ? agePct / 0.25
                    : agePct > 0.75
                        ? (1.0 - agePct) / 0.25
                        : 1.0;
                ctx.beginPath();
                ctx.arc(cx, cy, particleRadius, 0, 2 * Math.PI);
                ctx.fillStyle = `rgba(${windBandRgb(speed, isLightBg)}, ${opacity * 0.95})`;
                ctx.fill();
            }
        }
    }, [map, isNightMode, chartBackground, particleRadius, trailFade]);
    // -- Keep the canvas glued to the map ---------------------------------------
    useEffect(() => {
        const handleMove = () => {
            reposition();
        };
        const handleZoomStart = () => {
            isZoomingRef.current = true;
            clearCanvas();
        };
        const handleZoomEnd = () => {
            isZoomingRef.current = false;
            reposition();
        };
        // Reseeding is what keeps particles in view, so it follows the view rather than every frame
        // of a drag.
        const handleViewChange = () => {
            reposition();
            syncWorkerView();
        };
        reposition();
        map.on('move resize', handleMove);
        map.on('moveend zoomend viewreset resize', handleViewChange);
        map.on('zoomstart', handleZoomStart);
        map.on('zoomend', handleZoomEnd);
        return () => {
            map.off('move resize', handleMove);
            map.off('moveend zoomend viewreset resize', handleViewChange);
            map.off('zoomstart', handleZoomStart);
            map.off('zoomend', handleZoomEnd);
        };
    }, [map, reposition, clearCanvas, syncWorkerView]);
    /**
     * The hour being drawn, held in a ref as well as a prop.
     *
     * The worker is created once per field and then fed new hours, so the effect that creates it
     * must not list `timeIndex` as a dependency — but it still needs to know which hour to start
     * on. This is that, and nothing else.
     */
    const timeIndexRef = useRef(timeIndex);
    timeIndexRef.current = timeIndex;
    // -- Wind animation worker --------------------------------------------------
    useEffect(() => {
        if (!field?.times?.length || !axes) {
            if (workerRef.current) {
                workerRef.current.dispose();
                workerRef.current = null;
            }
            return;
        }
        const hour = Math.min(timeIndexRef.current, field.times.length - 1);
        if (!field.u[hour] || !field.v[hour])
            return;
        const handle = createWindWorker();
        if (!handle)
            return;
        workerRef.current = handle;
        handle.worker.postMessage({
            type: 'init',
            data: {
                grid: {
                    latGrid: axes.latGrid,
                    lonGrid: axes.lonGrid,
                    uGrid: field.u[hour],
                    vGrid: field.v[hour]
                },
                bounds: {
                    latMin: field.lats[0],
                    latMax: field.lats[field.lats.length - 1],
                    lonMin: field.lons[0],
                    lonMax: field.lons[field.lons.length - 1]
                },
                maxParticles,
                speedScale: 0.0006
            }
        });
        // Narrow the seed box to the current view straight away, before the first frame is drawn.
        syncWorkerView();
        let updating = false;
        let animId = null;
        handle.worker.onmessage = (e) => {
            const { type, coords } = e.data;
            if (type === 'tick' && canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                if (ctx)
                    drawWindParticles(ctx, coords);
                updating = false;
            }
        };
        const tick = () => {
            if (!updating && workerRef.current) {
                updating = true;
                workerRef.current.worker.postMessage({ type: 'update' });
            }
            animId = requestAnimationFrame(tick);
        };
        animId = requestAnimationFrame(tick);
        return () => {
            if (animId)
                cancelAnimationFrame(animId);
            if (workerRef.current) {
                workerRef.current.dispose();
                workerRef.current = null;
            }
        };
    }, [field, axes, maxParticles, drawWindParticles, syncWorkerView]);
    /**
     * Step the running worker to another forecast hour.
     *
     * Separate from the effect above so that scrubbing the chart's clock costs a message rather
     * than a worker: at a quarter-hour per animation frame the old arrangement would have
     * terminated and rebuilt the worker every couple of seconds for the whole length of a passage.
     */
    useEffect(() => {
        const handle = workerRef.current;
        if (!handle || !field?.times?.length)
            return;
        const hour = Math.min(timeIndex, field.times.length - 1);
        if (!field.u[hour] || !field.v[hour])
            return;
        handle.worker.postMessage({
            type: 'grid',
            data: { grid: { uGrid: field.u[hour], vGrid: field.v[hour] } }
        });
    }, [timeIndex, field]);
    // Wipe leftovers when the field is cleared.
    useEffect(() => {
        if (!field)
            clearCanvas();
    }, [field, clearCanvas]);
    return null;
}
