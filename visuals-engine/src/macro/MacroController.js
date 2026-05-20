/**
 * MacroController — "Master Vibe" performance layer.
 *
 * Five macro knobs each drive multiple underlying shader parameters at once,
 * so a single MIDI CC gives you expressive, multi-dimensional control without
 * having to tweak individual sliders.
 *
 * Architecture
 * ────────────
 * Macros sit ABOVE the audio modulation layer:
 *
 *   paramMap.base  ← macro.apply()   (sets base values each frame)
 *   paramMap.modulated ← router.process()  (audio adds on top of base)
 *
 * This means audio always modulates relative to whatever the macros set,
 * giving you full-range MIDI + audio on every param simultaneously.
 *
 * MIDI CC mapping (defaults)
 * ──────────────────────────
 *   CC 20 → Intensity
 *   CC 21 → Melt
 *   CC 22 → Chaos
 *   CC 23 → Zoom
 *   CC 24 → ColorCycle
 *
 * Change via: macro.bindCC('intensity', 74)  (any CC number)
 *
 * Usage
 * ─────
 *   const macro = new MacroController();
 *   // In render loop (BEFORE router.process):
 *   macro.apply(paramMap, elapsed);
 *   // In MIDI callback:
 *   macro.applyCC(cc, rawValue); // rawValue 0-127
 */

// ── Neutral (zero-influence) values for each macro ───────────────────────────
// These are the values applied when a macro is at 0, matching param defaults.
export const MACRO_NEUTRAL = Object.freeze({
  intensity:  0.0,
  melt:       0.0,
  chaos:      0.0,
  zoom:       0.0,
  colorCycle: 0.0,
});

// ── Default MIDI CC assignments ───────────────────────────────────────────────
const DEFAULT_CC_MAP = {
  intensity:  20,
  melt:       21,
  chaos:      22,
  zoom:       23,
  colorCycle: 24,
};

/**
 * Maps a macro value [0,1] to one or more paramMap base values.
 * Each entry: { paramId, fn: (macroValue, elapsed) → paramBaseValue }
 *
 * The functions define the "personality" of each macro — feel free to tune
 * the curves here to match your visual aesthetic.
 */
const MACRO_MAPPINGS = {
  /**
   * Intensity — overall energy / presence.
   * Drives grid displacement and overall brightness.
   */
  intensity: [
    { paramId: 'displacementScale', fn: (v)         => v * 2.0 },
    { paramId: 'colorR',            fn: (v)         => 0.2 + v * 0.8 },
    { paramId: 'colorG',            fn: (v)         => 0.15 + v * 0.6 },
    { paramId: 'colorB',            fn: (v)         => 0.3 + v * 0.7 },
    { paramId: 'cellScale',         fn: (v)         => 1.0 + v * 1.5 },
  ],

  /**
   * Melt — feedback dissolution / liquid smearing.
   * Cranking this up makes the frame blur and smear into itself.
   */
  melt: [
    { paramId: 'feedbackStrength',  fn: (v)         => v * 0.95 },
    { paramId: 'feedbackRotation',  fn: (v)         => v * 0.08 },
    { paramId: 'chaos',             fn: (v)         => v * 0.35 },
    { paramId: 'feedbackScale',     fn: (v)         => 1.0 + v * 0.25 },
  ],

  /**
   * Chaos — neural hallucination intensity.
   * Directly drives the neural.frag u_chaos uniform for deep-dream distortion.
   * At 0 the neural pass is a mathematically exact passthrough.
   */
  chaos: [
    { paramId: 'chaos',             fn: (v)         => v },
    { paramId: 'feedbackRotation',  fn: (v)         => -v * 0.05 },
    { paramId: 'displacementScale', fn: (v)         => v * 0.4 },
  ],

  /**
   * Zoom — inward camera / feedback zoom.
   * feedbackScale > 1 zooms the feedback buffer inward each frame (tunnel effect).
   * cameraDepth pulls the camera back for a different perspective.
   */
  zoom: [
    { paramId: 'feedbackScale',     fn: (v)         => 1.0 + v * 0.8 },
    { paramId: 'cameraDepth',       fn: (v)         => 2.5 - v * 1.5 },
    { paramId: 'cameraHeight',      fn: (v)         => 1.0 + v * 1.0 },
  ],

  /**
   * ColorCycle — slow sinusoidal RGB cycling.
   * Uses elapsed time so the colors rotate even without MIDI changes.
   * Increasing this macro speeds up and intensifies the color sweep.
   */
  colorCycle: [
    {
      paramId: 'colorR',
      fn: (v, t) => 0.5 + 0.5 * Math.sin(t * v * 0.8),
    },
    {
      paramId: 'colorG',
      fn: (v, t) => 0.5 + 0.5 * Math.sin(t * v * 0.8 + (Math.PI * 2) / 3),
    },
    {
      paramId: 'colorB',
      fn: (v, t) => 0.5 + 0.5 * Math.sin(t * v * 0.8 + (Math.PI * 4) / 3),
    },
  ],
};

export class MacroController {
  constructor() {
    /** Current macro values, all normalized [0, 1]. */
    this.values = {
      intensity:  0.0,
      melt:       0.0,
      chaos:      0.0,
      zoom:       0.0,
      colorCycle: 0.0,
    };

    /** CC number → macro name reverse-lookup. */
    this._ccMap = {}; // cc → macroId
    /** macro name → CC number. */
    this._macroCC = {}; // macroId → cc

    // Apply default CC assignments
    for (const [id, cc] of Object.entries(DEFAULT_CC_MAP)) {
      this.bindCC(id, cc);
    }
  }

  /**
   * Apply all active macro mappings into paramMap.base.
   *
   * Call this BEFORE router.process() so audio modulation accumulates on top.
   *
   * @param {import('../params/paramMap.js').ParamMap} paramMap
   * @param {number} elapsed  — seconds since start (for time-varying macros)
   */
  apply(paramMap, elapsed) {
    // Build an accumulator so multiple macros targeting the same param
    // can be combined (last-write-wins is fine here; macros are intentionally
    // designed with non-conflicting primary targets).
    for (const [macroId, mappings] of Object.entries(MACRO_MAPPINGS)) {
      const v = this.values[macroId];
      if (v === 0) continue; // zero-cost fast path — neutral macro

      for (const { paramId, fn } of mappings) {
        const computed = fn(v, elapsed);
        const param    = paramMap.get(paramId);
        if (!param) continue;
        // Clamp to param range before writing
        param.base = Math.max(param.min, Math.min(param.max, computed));
      }
    }
  }

  /**
   * Receive a raw MIDI CC message and update the corresponding macro.
   *
   * @param {number} cc     — CC number (0–127)
   * @param {number} raw    — raw value (0–127)
   * @returns {string|null} — macro id that was updated, or null if CC unmapped
   */
  applyCC(cc, raw) {
    const macroId = this._ccMap[cc];
    if (!macroId) return null;
    this.values[macroId] = raw / 127;
    return macroId;
  }

  /**
   * Bind a CC number to a macro.
   *
   * @param {string} macroId  — 'intensity' | 'melt' | 'chaos' | 'zoom' | 'colorCycle'
   * @param {number} cc       — MIDI CC number (0–127)
   */
  bindCC(macroId, cc) {
    // Remove any existing binding for this macro
    const oldCC = this._macroCC[macroId];
    if (oldCC !== undefined) delete this._ccMap[oldCC];

    this._ccMap[cc]        = macroId;
    this._macroCC[macroId] = cc;
  }

  /**
   * Set a macro value directly (e.g. from GUI slider).
   *
   * @param {string} macroId
   * @param {number} value   — [0, 1]
   */
  set(macroId, value) {
    if (!(macroId in this.values)) return;
    this.values[macroId] = Math.max(0, Math.min(1, value));
  }

  /** Reset all macros to neutral (0). */
  reset() {
    for (const k of Object.keys(this.values)) this.values[k] = 0.0;
  }

  /**
   * Export current macro state as a plain object (for PresetManager).
   * @returns {{ intensity: number, melt: number, chaos: number, zoom: number, colorCycle: number }}
   */
  snapshot() {
    return { ...this.values };
  }

  /**
   * Restore macro state from a snapshot.
   * @param {{ intensity?: number, melt?: number, chaos?: number, zoom?: number, colorCycle?: number }} state
   */
  loadSnapshot(state) {
    for (const [k, v] of Object.entries(state)) {
      if (k in this.values) this.values[k] = Math.max(0, Math.min(1, v));
    }
  }

  /** Current CC assignment table for display / persistence. */
  getCCMap() {
    return { ...this._macroCC };
  }
}
