/**
 * Parameter Map — central registry of every controllable engine value.
 *
 * Each parameter has:
 *   base      — the "resting" value, set by MIDI or direct code assignment
 *   modulated — base + audio modulation applied by ModRouter each frame
 *               (what the render loop always reads)
 *
 * The split means MIDI and audio modulation never collide: MIDI writes to
 * `base`, ModRouter adds on top into `modulated`, render loop reads `modulated`.
 *
 * ── Default CC assignments ────────────────────────────────────────────────────
 * These map common General MIDI CC numbers to intuitive controls.
 * Override at runtime: paramMap.bindCC('feedbackStrength', 22)
 */

/** @typedef {{ id: string, label: string, group: string, min: number, max: number, default: number, step?: number, cc?: number }} ParamDef */

/** @type {Record<string, ParamDef>} */
export const PARAM_DEFS = {
  // ── Grid ────────────────────────────────────────────────────────────────────
  cellScale: {
    group: 'grid', label: 'Cell Size',
    min: 0.01, max: 0.15, default: 0.05, step: 0.001, cc: 71,
  },
  displacementScale: {
    group: 'grid', label: 'Displacement Intensity',
    min: 0.0, max: 5.0, default: 2.0, step: 0.01, cc: 7,
  },

  // ── Feedback ────────────────────────────────────────────────────────────────
  feedbackStrength: {
    group: 'feedback', label: 'Strength',
    min: 0.0, max: 0.98, default: 0.85, step: 0.001, cc: 1,
  },
  feedbackScale: {
    group: 'feedback', label: 'Zoom',
    min: 0.98, max: 1.02, default: 1.005, step: 0.0001, cc: 74,
  },
  feedbackRotation: {
    group: 'feedback', label: 'Rotation',
    min: -0.02, max: 0.02, default: 0.003, step: 0.0001, cc: 10,
  },

  // ── Neural Style ────────────────────────────────────────────────────────────
  chaos: {
    group: 'neural', label: 'Chaos',
    min: 0.0, max: 1.0, default: 0.0, step: 0.001, cc: 19,
  },

  // ── Color ───────────────────────────────────────────────────────────────────
  colorR: {
    group: 'color', label: 'Red',
    min: 0.0, max: 1.0, default: 0.2, step: 0.001, cc: 14,
  },
  colorG: {
    group: 'color', label: 'Green',
    min: 0.0, max: 1.0, default: 0.6, step: 0.001, cc: 15,
  },
  colorB: {
    group: 'color', label: 'Blue',
    min: 0.0, max: 1.0, default: 1.0, step: 0.001, cc: 16,
  },

  // ── Camera ──────────────────────────────────────────────────────────────────
  cameraHeight: {
    group: 'camera', label: 'Height',
    min: 0.5, max: 8.0, default: 3.0, step: 0.01, cc: 17,
  },
  cameraDepth: {
    group: 'camera', label: 'Depth',
    min: 1.0, max: 15.0, default: 5.0, step: 0.01, cc: 18,
  },
};

// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {{ id: string, label: string, min: number, max: number, base: number, modulated: number }} Param */

export class ParamMap {
  /**
   * @param {Record<string, ParamDef>} [defs]
   */
  constructor(defs = PARAM_DEFS) {
    /** @type {Record<string, Param>} */
    this._params = {};

    /** @type {Map<number, string>}  cc number → param id */
    this._ccMap  = new Map();

    for (const [id, def] of Object.entries(defs)) {
      this._params[id] = {
        id,
        label:        def.label,
        group:        def.group ?? 'misc',
        min:          def.min,
        max:          def.max,
        step:         def.step ?? 0.001,
        defaultValue: def.default,  // stored so resetAll() can restore
        base:         def.default,
        modulated:    def.default,
      };
      if (def.cc != null) this.bindCC(id, def.cc);
    }
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /**
   * Returns the full param object. Throws on unknown id so typos surface fast.
   * @param {string} id
   * @returns {Param}
   */
  get(id) {
    const p = this._params[id];
    if (!p) throw new Error(`[ParamMap] Unknown parameter: "${id}"`);
    return p;
  }

  /**
   * Returns the current modulated value — the number the render loop should use.
   * Shorthand for paramMap.get(id).modulated.
   * @param {string} id
   * @returns {number}
   */
  value(id) {
    return this.get(id).modulated;
  }

  /** Returns all param objects (used by ModRouter to reset modulated values). */
  all() {
    return Object.values(this._params);
  }

  // ─── Write (base value) ────────────────────────────────────────────────────

  /**
   * Directly set the base value for a param (useful for scripting or UI controls).
   * The value is clamped to [min, max].
   * @param {string} id
   * @param {number} value
   */
  setBase(id, value) {
    const p = this.get(id);
    p.base = _clamp(value, p.min, p.max);
  }

  /**
   * Reset every parameter's base (and modulated) value back to its default.
   * Called by the Panic function. Also resets the ModRouter's modulation state
   * implicitly because ModRouter resets modulated → base at the start of each frame.
   */
  resetAll() {
    for (const p of this.all()) {
      p.base      = p.defaultValue;
      p.modulated = p.defaultValue;
    }
    console.log('[ParamMap] All parameters reset to defaults.');
  }

  // ─── MIDI ──────────────────────────────────────────────────────────────────

  /**
   * Bind a MIDI CC number to a parameter.
   * Any previous binding for this CC or this param is replaced.
   * @param {string} paramId
   * @param {number} ccNumber  0–127
   */
  bindCC(paramId, ccNumber) {
    // Remove stale reverse-binding for this param (one param = one CC at a time)
    for (const [cc, pid] of this._ccMap) {
      if (pid === paramId) { this._ccMap.delete(cc); break; }
    }
    this._ccMap.set(ccNumber, paramId);
  }

  /**
   * Apply a raw MIDI CC value (0–127) to the bound parameter.
   * Maps linearly from [0, 127] → [param.min, param.max].
   *
   * @param {number} ccNumber
   * @param {number} rawValue  0–127
   * @returns {boolean}  true if a binding existed and was applied
   */
  applyCC(ccNumber, rawValue) {
    const paramId = this._ccMap.get(ccNumber);
    if (!paramId) return false;
    const p          = this.get(paramId);
    const normalized = rawValue / 127;
    p.base           = p.min + normalized * (p.max - p.min);
    return true;
  }

  /**
   * Activate "MIDI Learn" for one parameter: the next CC message received
   * (on any channel, any number) will be bound to this param.
   *
   * Pass the MidiInput instance. Returns a cancel function.
   *
   * @param {string}    paramId
   * @param {import('../midi/midi.js').MidiInput} midiInput
   * @returns {() => void}  cancel the learn session without binding
   */
  startLearn(paramId, midiInput) {
    const unsub = midiInput.onCC((cc) => {
      this.bindCC(paramId, cc);
      console.log(`[ParamMap] Learned: CC ${cc} → "${paramId}"`);
      unsub();
    });
    return unsub; // caller can invoke to cancel before any message arrives
  }

  // ─── Introspection ─────────────────────────────────────────────────────────

  /** Returns a plain object snapshot of all current modulated values. */
  snapshot() {
    const out = {};
    for (const p of this.all()) out[p.id] = p.modulated;
    return out;
  }

  /** Log all param values to the console — useful during development. */
  debug() {
    console.table(
      Object.fromEntries(
        this.all().map(p => [p.id, {
          base:      p.base.toFixed(4),
          modulated: p.modulated.toFixed(4),
          min:       p.min,
          max:       p.max,
        }])
      )
    );
  }
}

function _clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
