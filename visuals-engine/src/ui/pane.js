/**
 * pane.js — Tweakpane Performance Mode UI
 *
 * A dark, high-contrast sidebar overlay designed for live VJ use:
 *   - Separate CSS layer (z-index + pointer-events) — never steals canvas events
 *   - Slide-in/out transition on toggle (H key)
 *   - Large 30px blade rows for easy grab in a dark environment
 *   - Stepped sliders match per-param precision from paramMap
 *   - Rolling graph monitors for all 8 frequency bands + spectral flux
 *
 * Replaces lil-gui (gui.js) — exposes the same interface so main.js only
 * needs one import swap:
 *
 *   import { createPane } from './ui/pane.js';
 *   let ui = createPane({ paramMap, macro, router, panic, capture, audio, presets });
 *   // ui.sync()  ui.updateMeters(bands, flux)  ui.toggle()
 */

import { Pane }           from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.4/+esm';
import { OUTPUT_PRESETS } from '../output/outputManager.js';

// ─── CSS ──────────────────────────────────────────────────────────────────────
// Injected once into <head>. All rules scoped under #ve-sidebar so we never
// bleed into the rest of the document.

const SIDEBAR_CSS = `
  /* ── Layout ── */
  #ve-sidebar {
    position: fixed;
    top:    0;
    right:  0;
    width:  290px;
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    /* UI sits above the canvas on its own stacking context */
    z-index: 9999;
    /* Only the pane itself is interactive — the transparent gap beside it is not */
    pointer-events: auto;
    /* Smooth slide-out when hidden */
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    scrollbar-width: thin;
    scrollbar-color: #2a2a3a transparent;
    /* Prevent text selection on fast drags */
    user-select: none;
  }

  #ve-sidebar.ve-hidden {
    transform: translateX(298px);
    pointer-events: none;
  }

  #ve-sidebar::-webkit-scrollbar       { width: 3px; }
  #ve-sidebar::-webkit-scrollbar-track { background: transparent; }
  #ve-sidebar::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }

  /* ── Tweakpane dark VJ theme ── */
  /* Variables are set on the pane root (.tp-dfwv); scoped under our container */
  #ve-sidebar .tp-dfwv {
    --tp-base-background-color:          hsla(228, 25%, 7%, 0.93);
    --tp-base-shadow-color:              hsla(0, 0%, 0%, 0.55);

    --tp-button-background-color:        hsla(228, 18%, 16%, 1);
    --tp-button-background-color-active: hsla(162, 90%, 35%, 0.28);
    --tp-button-background-color-focus:  hsla(228, 18%, 20%, 1);
    --tp-button-background-color-hover:  hsla(228, 18%, 21%, 1);
    --tp-button-foreground-color:        hsla(220, 15%, 80%, 1);

    --tp-container-background-color:        hsla(228, 22%, 11%, 0.65);
    --tp-container-background-color-active: hsla(162, 80%, 35%, 0.18);
    --tp-container-background-color-focus:  hsla(228, 22%, 14%, 0.65);
    --tp-container-background-color-hover:  hsla(228, 22%, 13%, 0.65);
    --tp-container-foreground-color:        hsla(220, 10%, 55%, 0.7);

    --tp-groove-foreground-color:        hsla(228, 22%, 17%, 0.8);

    --tp-input-background-color:         hsla(228, 22%, 13%, 0.85);
    --tp-input-background-color-active:  hsla(162, 80%, 38%, 0.22);
    --tp-input-background-color-focus:   hsla(228, 22%, 17%, 0.85);
    --tp-input-background-color-hover:   hsla(228, 22%, 16%, 0.85);
    --tp-input-foreground-color:         hsla(220, 15%, 88%, 1);

    --tp-label-foreground-color:         hsla(220, 10%, 52%, 1);

    --tp-monitor-background-color:       hsla(228, 30%, 6%, 0.92);
    --tp-monitor-foreground-color:       #00ffaa;  /* cyan-green accent */

    --tp-separator-foreground-color:     hsla(228, 22%, 16%, 1);

    width: 290px !important;
    /* Increase font scale for dark-room readability */
    font-size: 12px;
  }

  /* ── Blade row height — easier to hit in a dark room ── */
  /* Tweakpane v4 uses tp-brkv for each blade row */
  #ve-sidebar .tp-brkv {
    height: 30px !important;
  }

  /* Slider knob — accent colour */
  #ve-sidebar .tp-sldv_k {
    background: #00ffaa !important;
  }
  /* Slider filled track */
  #ve-sidebar .tp-sldv_i {
    background: rgba(0, 255, 170, 0.14) !important;
  }

  /* Monitor graph line colour already set via --tp-monitor-foreground-color above,
     but some builds expose the graph colour via a direct fill — belt-and-braces: */
  #ve-sidebar .tp-mllv_g line,
  #ve-sidebar canvas { color: #00ffaa; }

  /* ── PANIC button override (applied via DOM after creation) ── */
  #ve-sidebar .ve-panic button {
    background:     rgba(210, 35, 55, 0.75) !important;
    color:          #fff !important;
    font-weight:    700 !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
    border:         none !important;
    transition:     background 0.1s !important;
  }
  #ve-sidebar .ve-panic button:hover {
    background: rgba(230, 50, 70, 1) !important;
  }
  #ve-sidebar .ve-panic button:active {
    background: #ff2244 !important;
  }

  /* ── Hint text (disabled read-only label) ── */
  #ve-sidebar .ve-hint .tp-lblv_l,
  #ve-sidebar .ve-hint input {
    color: hsla(220, 10%, 38%, 1) !important;
    font-style: italic !important;
    font-size: 10px !important;
  }
`;

function _injectStyles() {
  if (document.getElementById('ve-pane-styles')) return;
  const style       = document.createElement('style');
  style.id          = 've-pane-styles';
  style.textContent = SIDEBAR_CSS;
  document.head.appendChild(style);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {import('../params/paramMap.js').ParamMap}         opts.paramMap
 * @param {import('../macro/MacroController.js').MacroController} opts.macro
 * @param {import('../params/modRouter.js').ModRouter}       opts.router
 * @param {import('../macro/PresetManager.js').PresetManager} opts.presets
 * @param {import('../audio/analyser.js').AudioAnalyser}     opts.audio
 * @param {import('../output/capture.js').CanvasCapture}     opts.capture
 * @param {() => void}                                       opts.panic
 */
export function createPane({ paramMap, macro, router, presets, audio, capture, panic, output, calibration }) {
  _injectStyles();

  // ── Sidebar container ──────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.id    = 've-sidebar';
  document.body.appendChild(container);

  // ── Tweakpane root ─────────────────────────────────────────────────────────
  const pane = new Pane({ title: 'VJ ENGINE', container, expanded: true });

  // ── Shared band/flux state (updated each frame, auto-polled by Tweakpane) ──
  // Keys match the labels below; Tweakpane binds to the object by reference.
  const _b = { sub: 0, low: 0, loMid: 0, mid: 0, hiMid: 0, high: 0, air: 0, ultra: 0 };
  const _bKeys   = Object.keys(_b);
  const _bLabels = ['Sub', 'Low', 'Lo-Mid', 'Mid', 'Hi-Mid', 'High', 'Air', 'Ultra'];
  const _f = { flux: 0 };

  // ── Macro proxy — two-way synced with MacroController ─────────────────────
  const macroProxy = { ...macro.values };

  // ── Param proxy factory — each param gets a {v} wrapper ───────────────────
  // Tweakpane binds to an object property by reference, so we can't share a
  // single `proxy` object (different params have different ranges).  Instead,
  // we create a thin `{v}` wrapper per param and push changes back on 'change'.
  function _makeParamEntry(id) {
    const p = paramMap.get(id); // throws on unknown id — surfaces typos early
    const obj = { v: p.base };
    return { p, obj };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FOLDER 1 — AUDIO INPUTS
  // ─────────────────────────────────────────────────────────────────────────
  const audioF = pane.addFolder({ title: 'AUDIO INPUTS', expanded: true });

  audioF
    .addButton({ title: 'Connect Microphone' })
    .on('click', async () => {
      if (audio.isConnected) {
        console.log('[Audio] Already connected.');
        return;
      }
      await audio.connectMic();
      console.log('[Audio] Microphone connected via UI.');
    });

  audioF.addBinding({ hint: 'Click canvas to arm on first touch' }, 'hint', {
    label:    '',
    readonly: true,
  }).element.classList.add('ve-hint');

  // ─────────────────────────────────────────────────────────────────────────
  // FOLDER 2 — VISUAL MACROS
  // ─────────────────────────────────────────────────────────────────────────
  const macroF = pane.addFolder({ title: 'VISUAL MACROS', expanded: true });

  /** @type {Array<{id:string, label:string}>} */
  const MACRO_DEFS = [
    { id: 'intensity',  label: 'Intensity  [CC 20]' },
    { id: 'melt',       label: 'Melt       [CC 21]' },
    { id: 'chaos',      label: 'Chaos      [CC 22]' },
    { id: 'zoom',       label: 'Zoom       [CC 23]' },
    { id: 'colorCycle', label: 'ColorCycle [CC 24]' },
  ];

  // Keep a reference to each binding so sync() can call .refresh()
  const _macroCtrls = {};

  for (const { id, label } of MACRO_DEFS) {
    const b = macroF
      .addBinding(macroProxy, id, { label, min: 0, max: 1, step: 0.01 })
      .on('change', ({ value }) => macro.set(id, value));
    _macroCtrls[id] = b;
  }

  macroF.addSeparator();

  // PANIC — top-level so it's always visible, styled red
  const panicBtn = macroF.addButton({ title: '⬛  PANIC  [Space]' });
  panicBtn.element.classList.add('ve-panic');
  panicBtn.on('click', panic);

  // ─────────────────────────────────────────────────────────────────────────
  // FOLDER 3 — FEEDBACK SETTINGS
  // ─────────────────────────────────────────────────────────────────────────
  const feedF = pane.addFolder({ title: 'FEEDBACK SETTINGS', expanded: false });

  const _feedEntries = {};

  const FEEDBACK_PARAMS = [
    'feedbackStrength',
    'feedbackScale',
    'feedbackRotation',
  ];
  const GRID_PARAMS = [
    'displacementScale',
    'cellScale',
  ];

  for (const id of FEEDBACK_PARAMS) {
    const { p, obj } = _makeParamEntry(id);
    _feedEntries[id] = obj;
    feedF
      .addBinding(obj, 'v', { label: p.label, min: p.min, max: p.max, step: p.step })
      .on('change', ({ value }) => paramMap.setBase(id, value));
  }

  feedF.addSeparator();

  const _gridEntries = {};
  for (const id of GRID_PARAMS) {
    const { p, obj } = _makeParamEntry(id);
    _gridEntries[id] = obj;
    feedF
      .addBinding(obj, 'v', { label: p.label, min: p.min, max: p.max, step: p.step })
      .on('change', ({ value }) => paramMap.setBase(id, value));
  }

  feedF.addSeparator();

  // Neural chaos sits here too (it's part of the visual texture)
  const _chaosEntry = _makeParamEntry('chaos');
  _feedEntries['chaos'] = _chaosEntry.obj;
  feedF
    .addBinding(_chaosEntry.obj, 'v', {
      label: _chaosEntry.p.label + '  ← spectral flux',
      min:   _chaosEntry.p.min,
      max:   _chaosEntry.p.max,
      step:  _chaosEntry.p.step,
    })
    .on('change', ({ value }) => paramMap.setBase('chaos', value));

  // Camera sub-folder (collapsed by default — rarely touched during a set)
  const cameraF = feedF.addFolder({ title: 'Camera', expanded: false });
  const _camEntries = {};
  for (const id of ['cameraHeight', 'cameraDepth']) {
    const { p, obj } = _makeParamEntry(id);
    _camEntries[id] = obj;
    cameraF
      .addBinding(obj, 'v', { label: p.label, min: p.min, max: p.max, step: p.step })
      .on('change', ({ value }) => paramMap.setBase(id, value));
  }

  // Color sub-folder
  const colorF = feedF.addFolder({ title: 'Color', expanded: false });
  const _colorEntries = {};
  for (const id of ['colorR', 'colorG', 'colorB']) {
    const { p, obj } = _makeParamEntry(id);
    _colorEntries[id] = obj;
    colorF
      .addBinding(obj, 'v', { label: p.label, min: p.min, max: p.max, step: p.step })
      .on('change', ({ value }) => paramMap.setBase(id, value));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FOLDER 4 — OUTPUT CONFIG
  // ─────────────────────────────────────────────────────────────────────────
  const outF = pane.addFolder({ title: 'OUTPUT CONFIG', expanded: false });

  outF.addButton({ title: '▶  Start Stream  (60 fps)' })
    .on('click', () => {
      if (!capture.isStreaming) capture.start(60);
      else console.log('[Capture] Already streaming.');
    });

  outF.addButton({ title: '■  Stop Stream' })
    .on('click', () => capture.stop());

  outF.addSeparator();

  outF.addButton({ title: '⏺  Start Recording  (VP9/WebM)' })
    .on('click', () => capture.startRecording());

  outF.addButton({ title: '⏹  Stop + Download Recording' })
    .on('click', () => { capture.stopRecording(); capture.downloadRecording('ve-set'); });

  // Electron Spout/Syphon section — only when running inside the Electron host
  if (window.electronBridge?.isElectron) {
    outF.addSeparator();
    const gpuTarget = /Win/i.test(navigator.platform) ? 'spout' : 'syphon';
    outF.addButton({ title: `↗  Start ${gpuTarget.toUpperCase()} Output` })
      .on('click', () => capture.startElectronOutput(gpuTarget));
    outF.addButton({ title: `✕  Stop ${gpuTarget.toUpperCase()} Output` })
      .on('click', () => capture.stopElectronOutput());
  }

  outF.addSeparator();

  // ── Presets ───────────────────────────────────────────────────────────────
  const presetState = { name: '' };

  outF.addBinding(presetState, 'name', { label: 'Preset name' });

  outF.addButton({ title: '💾  Save Preset' }).on('click', () => {
    const name = presetState.name.trim();
    if (!name) { console.warn('[Presets] Enter a name first.'); return; }
    presets.save(name, { macro, router, paramMap });
  });

  outF.addButton({ title: '📂  Load Preset' }).on('click', () => {
    const name = presetState.name.trim();
    if (!name) { console.warn('[Presets] Enter a name first.'); return; }
    if (presets.load(name, { macro, router, paramMap })) sync();
  });

  outF.addButton({ title: '📋  List Presets (console)' }).on('click', () => {
    const list = presets.listMeta();
    console.table(list.length ? list : [{ name: '(no presets saved yet)', savedAt: '—' }]);
  });

  outF.addButton({ title: '⬆  Export JSON (console)' }).on('click', () => {
    const name = presetState.name.trim();
    if (!name) { console.warn('[Presets] Enter preset name to export.'); return; }
    try   { console.log(`[Preset Export]\n${presets.exportJSON(name)}`); }
    catch (e) { console.warn(e.message); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FOLDER 5 — MONITOR  (real-time rolling graphs for all 8 bands + flux)
  // ─────────────────────────────────────────────────────────────────────────
  // Collapsed by default — open it when you need to diagnose audio signal.
  const monF = pane.addFolder({ title: 'MONITOR', expanded: false });

  monF.addBinding(_f, 'flux', {
    readonly:   true,
    view:       'graph',
    min:        0,
    max:        1,
    bufferSize: 200,
    label:      'Flux',
  });

  monF.addSeparator();

  for (let i = 0; i < 8; i++) {
    monF.addBinding(_b, _bKeys[i], {
      readonly:   true,
      view:       'graph',
      min:        0,
      max:        1,
      bufferSize: 200,
      label:      _bLabels[i],
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FOLDER 6 — PROJECTION SETUP
  // ─────────────────────────────────────────────────────────────────────────
  // Only rendered when output + calibration modules are available.
  if (output && calibration) {
    const projF = pane.addFolder({ title: 'PROJECTION SETUP', expanded: false });

    // ── Aspect ratio lock ────────────────────────────────────────────────────
    const lockState = { locked: output.isLocked };

    projF.addBinding(lockState, 'locked', { label: 'Lock Aspect Ratio' })
      .on('change', ({ value }) => {
        if (value) output.lock();
        else       output.unlock();
      });

    projF.addSeparator();

    // ── Resolution presets ───────────────────────────────────────────────────
    for (const [label, [w, h]] of Object.entries(OUTPUT_PRESETS)) {
      projF.addButton({ title: label }).on('click', () => {
        output.setResolution(w, h);
        customRes.w = w;
        customRes.h = h;
        pane.refresh();
        // Notify main.js to rebuild render FBOs — dispatched as a custom event
        window.dispatchEvent(new CustomEvent('ve-output-resize', { detail: { w, h } }));
      });
    }

    projF.addSeparator();

    // ── Custom resolution ────────────────────────────────────────────────────
    const customRes = { w: output.width, h: output.height };

    projF.addBinding(customRes, 'w', {
      label: 'Custom W', min: 320, max: 7680, step: 1,
    });
    projF.addBinding(customRes, 'h', {
      label: 'Custom H', min: 240, max: 4320, step: 1,
    });
    projF.addButton({ title: 'Apply Custom Resolution' }).on('click', () => {
      output.setResolution(customRes.w, customRes.h);
      window.dispatchEvent(new CustomEvent('ve-output-resize', {
        detail: { w: customRes.w, h: customRes.h },
      }));
    });

    projF.addSeparator();

    // ── Calibration overlays ─────────────────────────────────────────────────
    const calState = {
      crosshair:   calibration.crosshairEnabled,
      checkerboard: calibration.checkerEnabled,
      checkSize:   32,
      opacity:     1.0,
    };

    projF.addBinding(calState, 'crosshair', { label: 'Crosshair  [C]' })
      .on('change', ({ value }) => {
        if (value !== calibration.crosshairEnabled) calibration.toggleCrosshair();
      });

    projF.addBinding(calState, 'checkerboard', { label: 'Checkerboard  [B]' })
      .on('change', ({ value }) => {
        if (value !== calibration.checkerEnabled) calibration.toggleCheckerboard();
      });

    projF.addBinding(calState, 'checkSize', {
      label: 'Check Size (px)', min: 8, max: 256, step: 8,
    }).on('change', ({ value }) => calibration.setCheckSize(value));

    projF.addBinding(calState, 'opacity', {
      label: 'Overlay Opacity', min: 0.1, max: 1.0, step: 0.05,
    }).on('change', ({ value }) => calibration.setOpacity(value));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public interface
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Write current audio levels into the monitor state objects.
   * Tweakpane polls these on its own rAF — just assign, no explicit refresh needed.
   *
   * @param {Float32Array|number[]} bands  — 8 normalized values [0,1]
   * @param {number}                flux
   */
  function updateMeters(bands, flux) {
    for (let i = 0; i < 8; i++) _b[_bKeys[i]] = bands[i] ?? 0;
    _f.flux = flux ?? 0;
  }

  /**
   * Pull all current paramMap base values and macro values into the UI proxies,
   * then force a Tweakpane refresh.  Call after MIDI, preset load, or panic.
   */
  function sync() {
    // Macros
    for (const id of Object.keys(macroProxy)) {
      macroProxy[id] = macro.values[id] ?? 0;
    }

    // Feedback / grid params
    for (const id of [...FEEDBACK_PARAMS, ...GRID_PARAMS, 'chaos']) {
      const entry = _feedEntries[id] ?? _gridEntries[id];
      if (entry) entry.v = paramMap.get(id).base;
    }
    for (const id of ['cameraHeight', 'cameraDepth']) {
      if (_camEntries[id]) _camEntries[id].v = paramMap.get(id).base;
    }
    for (const id of ['colorR', 'colorG', 'colorB']) {
      if (_colorEntries[id]) _colorEntries[id].v = paramMap.get(id).base;
    }

    // Single pane.refresh() re-reads all bound proxy values at once
    pane.refresh();
  }

  /**
   * Slide the sidebar on/off screen.  Bound to the H key in main.js.
   * Uses CSS transform (GPU composited) so the WebGL canvas is unaffected.
   */
  function toggle() {
    container.classList.toggle('ve-hidden');
  }

  return { updateMeters, sync, toggle, pane };
}
