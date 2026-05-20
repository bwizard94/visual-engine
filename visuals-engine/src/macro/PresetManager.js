/**
 * PresetManager — JSON save / load / export / import for macro + router state.
 *
 * Storage
 * ───────
 * Presets are persisted to localStorage under the key `ve_presets`.
 * Each preset is a named JSON object containing:
 *   - macros:  MacroController snapshot  (5 values)
 *   - routes:  ModRouter exportPreset()   (routing table)
 *   - params:  ParamMap snapshot          (all base values)
 *   - savedAt: ISO timestamp
 *
 * Usage
 * ─────
 *   const presets = new PresetManager();
 *
 *   // Save
 *   presets.save('club-set', { macro, router, paramMap });
 *
 *   // Load
 *   presets.load('club-set', { macro, router, paramMap });
 *
 *   // Portable export (copy to clipboard, share as file)
 *   const json = presets.exportJSON('club-set');
 *
 *   // Import from another machine
 *   presets.importJSON(json);
 *
 * Console API
 * ───────────
 *   engine.presets.list()              // array of saved preset names
 *   engine.presets.save('mypreset', engine)
 *   engine.presets.load('mypreset', engine)
 *   engine.presets.exportJSON('mypreset')   // copy the string, send to a friend
 *   engine.presets.importJSON(pastedString)
 *   engine.presets.delete('mypreset')
 */

const STORAGE_KEY = 've_presets';

export class PresetManager {
  constructor() {
    /** @type {Record<string, object>} in-memory cache */
    this._store = this._hydrate();
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  /**
   * Save current engine state under the given name.
   *
   * @param {string} name
   * @param {{ macro: import('./MacroController.js').MacroController,
   *           router: import('../params/modRouter.js').ModRouter,
   *           paramMap: import('../params/paramMap.js').ParamMap }} engine
   */
  save(name, { macro, router, paramMap }) {
    if (!name || typeof name !== 'string') throw new Error('[Presets] name must be a non-empty string');

    this._store[name] = {
      macros:  macro.snapshot(),
      routes:  router.exportPreset(),
      params:  paramMap.snapshot(),
      ccMap:   macro.getCCMap(),
      savedAt: new Date().toISOString(),
    };

    this._persist();
    console.log(`[Presets] Saved "${name}".`);
    return this._store[name];
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  /**
   * Restore a saved preset into the live engine.
   *
   * @param {string} name
   * @param {{ macro: import('./MacroController.js').MacroController,
   *           router: import('../params/modRouter.js').ModRouter,
   *           paramMap: import('../params/paramMap.js').ParamMap }} engine
   * @returns {boolean} true if loaded, false if not found
   */
  load(name, { macro, router, paramMap }) {
    const preset = this._store[name];
    if (!preset) {
      console.warn(`[Presets] "${name}" not found. Available: ${this.list().join(', ') || '(none)'}`);
      return false;
    }

    if (preset.macros) macro.loadSnapshot(preset.macros);

    if (preset.ccMap) {
      for (const [macroId, cc] of Object.entries(preset.ccMap)) {
        macro.bindCC(macroId, cc);
      }
    }

    if (preset.routes) router.loadPreset(preset.routes);

    if (preset.params) {
      for (const [id, value] of Object.entries(preset.params)) {
        const p = paramMap.get(id);
        if (p) p.base = Math.max(p.min, Math.min(p.max, value));
      }
    }

    console.log(`[Presets] Loaded "${name}" (saved ${preset.savedAt}).`);
    return true;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Remove a preset.
   * @param {string} name
   * @returns {boolean} true if it existed
   */
  delete(name) {
    if (!this._store[name]) return false;
    delete this._store[name];
    this._persist();
    console.log(`[Presets] Deleted "${name}".`);
    return true;
  }

  // ── List ──────────────────────────────────────────────────────────────────

  /**
   * @returns {string[]} sorted list of preset names
   */
  list() {
    return Object.keys(this._store).sort();
  }

  /**
   * @returns {{ name: string, savedAt: string }[]}
   */
  listMeta() {
    return this.list().map(name => ({
      name,
      savedAt: this._store[name].savedAt,
    }));
  }

  // ── Export / Import ───────────────────────────────────────────────────────

  /**
   * Export a single preset as a portable JSON string.
   * Copy this to a file or clipboard and share with another machine.
   *
   * @param {string} name
   * @returns {string} JSON string
   */
  exportJSON(name) {
    const preset = this._store[name];
    if (!preset) throw new Error(`[Presets] "${name}" not found`);
    return JSON.stringify({ name, ...preset }, null, 2);
  }

  /**
   * Export ALL presets as a single JSON bundle.
   * @returns {string}
   */
  exportAllJSON() {
    return JSON.stringify({ _all: true, presets: this._store }, null, 2);
  }

  /**
   * Import a preset (or bundle) from a JSON string.
   * Merges into the current store — existing presets with the same name
   * are overwritten.
   *
   * @param {string} jsonString
   * @returns {string[]} names of imported presets
   */
  importJSON(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('[Presets] importJSON: invalid JSON');
    }

    const imported = [];

    if (parsed._all && parsed.presets) {
      // Bundle import
      for (const [name, preset] of Object.entries(parsed.presets)) {
        this._store[name] = preset;
        imported.push(name);
      }
    } else if (parsed.name) {
      // Single preset import
      const { name, ...rest } = parsed;
      this._store[name] = rest;
      imported.push(name);
    } else {
      throw new Error('[Presets] importJSON: unrecognised format — expected { name, ... } or { _all, presets }');
    }

    this._persist();
    console.log(`[Presets] Imported: ${imported.join(', ')}`);
    return imported;
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  _hydrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      console.warn('[Presets] Could not read localStorage — presets will not persist.');
      return {};
    }
  }

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._store));
    } catch (e) {
      console.warn('[Presets] localStorage write failed:', e.message);
    }
  }
}
