/**
 * Modulation Router
 *
 * Links audio frequency bands to shader parameters with per-link sensitivity.
 *
 * Concepts
 * ────────
 * Route   — one band → one param connection, with a sensitivity multiplier
 *           and a blend mode.
 *
 * Modes
 * ─────
 *  'add'      (default)
 *      final = clamp(base + band × sensitivity × range, min, max)
 *      The most useful mode. Band energy pushes the param above its base value.
 *      Negative sensitivity inverts the direction (band reduces the param).
 *      Multiple routes to the same param accumulate additively.
 *
 *  'set'
 *      final = clamp(min + band × sensitivity × range, min, max)
 *      Band directly drives the param, ignoring the base value entirely.
 *      Useful for parameters you want 100% audio-controlled (e.g. brightness).
 *      When multiple 'set' routes target the same param, the last one wins
 *      (since each overwrites modulated).
 *
 *  'multiply'
 *      final = clamp(base × (1 + band × sensitivity), min, max)
 *      Scales the base proportionally. Useful for parameters like zoom or scale
 *      where the audio should exaggerate the current position rather than add to it.
 *
 * Sensitivity scale
 * ─────────────────
 *  sensitivity is normalised to the parameter's own range, so it means the same
 *  thing regardless of whether the param spans [0,1] or [0,5]:
 *    0.0  → no modulation
 *    0.5  → full band energy moves the param by 50% of its range
 *    1.0  → full band energy moves the param across its full range
 *   >1.0  → can exceed the range but is clamped — creates a "slam" effect
 *   <0.0  → inverted (band reduces the param value)
 *
 * Usage
 * ─────
 *   const router = new ModRouter();
 *
 *   // Assign bass band to displacement intensity, 80% sensitivity
 *   const id = router.addRoute({ bandIndex: 1, paramId: 'displacementScale', sensitivity: 0.8 });
 *
 *   // Assign mid band to feedback strength (set mode), 60% sensitivity
 *   router.addRoute({ bandIndex: 3, paramId: 'feedbackStrength', sensitivity: 0.6, mode: 'set' });
 *
 *   // Route spectral flux directly to the chaos param
 *   router.addRoute({ source: 'flux', paramId: 'chaos', sensitivity: 1.2 });
 *
 *   // Inside render loop (after audio.getBands()):
 *   router.process(bands, paramMap, audio.getSpectralFlux());
 *
 *   // Remove a specific route:
 *   router.removeRoute(id);
 */

import { BANDS } from '../audio/bands.js';

/** @typedef {'add'|'set'|'multiply'} RouteMode */
/** @typedef {'band'|'flux'} RouteSource */
/** @typedef {{ id: string, source: RouteSource, bandIndex: number|null, paramId: string, sensitivity: number, mode: RouteMode }} Route */

let _uid = 0;

export class ModRouter {
  constructor() {
    /** @type {Map<string, Route>} */
    this._routes = new Map();
  }

  // ─── Route management ───────────────────────────────────────────────────────

  /**
   * Add a modulation route.
   *
   * @param {object} opts
   * @param {RouteSource} [opts.source='band']  'band' reads from the 8 FFT bands;
   *                                             'flux' reads from spectral flux (no bandIndex needed)
   * @param {number}     [opts.bandIndex]        0–7 — required when source='band'
   * @param {string}      opts.paramId           Must match a key in ParamMap
   * @param {number}     [opts.sensitivity=1.0]
   * @param {RouteMode}  [opts.mode='add']
   * @returns {string}  Unique route ID — pass to removeRoute() to delete it.
   */
  addRoute({ source = 'band', bandIndex = null, paramId, sensitivity = 1.0, mode = 'add' }) {
    if (!['band', 'flux'].includes(source)) {
      throw new Error(`[ModRouter] Unknown source "${source}". Use 'band' or 'flux'.`);
    }
    if (source === 'band') {
      if (bandIndex === null || bandIndex < 0 || bandIndex > 7) {
        throw new RangeError(`[ModRouter] source='band' requires bandIndex 0–7, got ${bandIndex}`);
      }
    }
    if (!['add', 'set', 'multiply'].includes(mode)) {
      throw new Error(`[ModRouter] Unknown mode "${mode}". Use 'add', 'set', or 'multiply'.`);
    }

    const id = `route_${_uid++}`;
    this._routes.set(id, { id, source, bandIndex, paramId, sensitivity, mode });

    const srcLabel = source === 'flux'
      ? 'spectral-flux'
      : `band[${bandIndex}](${BANDS[bandIndex]?.name})`;
    console.log(`[ModRouter] Added route ${id}: ${srcLabel} → ${paramId} (${mode}, ×${sensitivity})`);

    return id;
  }

  /**
   * Remove a route by the ID returned from addRoute().
   * @param {string} routeId
   */
  removeRoute(routeId) {
    if (this._routes.delete(routeId)) {
      console.log(`[ModRouter] Removed route ${routeId}`);
    }
  }

  /** Remove all routes. */
  clearRoutes() {
    this._routes.clear();
    console.log('[ModRouter] All routes cleared.');
  }

  /**
   * Replace all current routes with a preset array.
   * The preset format matches the opts object accepted by addRoute().
   *
   * @param {Array<{ bandIndex: number, paramId: string, sensitivity?: number, mode?: RouteMode }>} routes
   * @returns {string[]}  The IDs of the newly created routes.
   */
  loadPreset(routes) {
    this.clearRoutes();
    return routes.map(r => this.addRoute(r));
  }

  /**
   * Export all current routes as a serialisable array (for saving presets).
   * @returns {Array<Route>}
   */
  exportPreset() {
    return [...this._routes.values()].map(r => ({
      source:      r.source,
      bandIndex:   r.bandIndex,
      paramId:     r.paramId,
      sensitivity: r.sensitivity,
      mode:        r.mode,
    }));
  }

  // ─── Per-frame processing ───────────────────────────────────────────────────

  /**
   * Apply all active routes to paramMap.
   * Call this ONCE per frame, before reading any param values for rendering.
   *
   * Algorithm:
   *   1. Reset every param's `modulated` to its current `base` value.
   *   2. For each route, read the band value and apply it according to mode.
   *
   * @param {Float32Array} bands     Length-8 array from AudioAnalyser.getBands()
   * @param {import('./paramMap.js').ParamMap} paramMap
   * @param {number}      [flux=0]   Spectral flux from AudioAnalyser.getSpectralFlux(), [0,1]
   */
  process(bands, paramMap, flux = 0) {
    // ── Step 1: Reset modulated → base for every param ───────────────────────
    // This ensures params with no active routes always reflect pure base values,
    // and that 'add' contributions don't carry over between frames.
    for (const p of paramMap.all()) {
      p.modulated = p.base;
    }

    if (this._routes.size === 0) return;

    // ── Step 2: Apply each route ──────────────────────────────────────────────
    for (const route of this._routes.values()) {
      const p = paramMap.get(route.paramId);

      // Resolve the signal value for this route.
      // 'flux' uses the pre-computed spectral flux scalar.
      // 'band' indexes the 8-element bands array (defaults to 0 if audio not ready).
      const signal  = route.source === 'flux'
        ? flux
        : (bands[route.bandIndex] ?? 0);

      const range   = p.max - p.min;
      const delta   = signal * route.sensitivity * range;

      switch (route.mode) {
        case 'add':
          // Accumulates — multiple routes to the same param stack together.
          p.modulated = _clamp(p.modulated + delta, p.min, p.max);
          break;

        case 'set':
          // Overwrites the base. Last 'set' route targeting this param wins.
          p.modulated = _clamp(p.min + delta, p.min, p.max);
          break;

        case 'multiply':
          // Scales the current modulated value proportionally.
          p.modulated = _clamp(p.modulated * (1.0 + band * route.sensitivity), p.min, p.max);
          break;
      }
    }
  }

  // ─── Introspection ─────────────────────────────────────────────────────────

  /**
   * Log a table of all active routes to the console.
   * Useful during live performance: router.debug() in the browser console.
   */
  debug() {
    if (this._routes.size === 0) {
      console.log('[ModRouter] No active routes.');
      return;
    }
    console.table(
      Object.fromEntries(
        [...this._routes.values()].map(r => [
          r.id,
          {
            source:      r.source === 'flux'
              ? 'spectral-flux'
              : `band[${r.bandIndex}] (${BANDS[r.bandIndex]?.name})`,
            param:       r.paramId,
            sensitivity: r.sensitivity,
            mode:        r.mode,
          },
        ])
      )
    );
  }
}

function _clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
