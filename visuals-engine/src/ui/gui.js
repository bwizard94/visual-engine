/**
 * VJ Control GUI
 *
 * Built on lil-gui (the modern successor to dat.GUI, MIT licensed).
 * Loaded from CDN as an ES module — no build step required.
 *
 * Architecture
 * ────────────
 * A thin `proxy` object mirrors paramMap base values.  Sliders write to
 * `proxy[id]` via lil-gui's data-binding, and onChange calls `paramMap.setBase`.
 * When MIDI moves a param, call `gui.sync()` to pull those changes back into
 * the slider display without interfering with any active drag.
 *
 * Live audio meters are driven by `.listen()` — lil-gui polls those fields on
 * its own rAF loop so `updateMeters()` just needs to write into `_meters`.
 *
 * Keyboard shortcuts (registered in main.js):
 *   Space / Escape   — PANIC
 *   H                — toggle this overlay
 */

import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';
import { PARAM_DEFS } from '../params/paramMap.js';

// Human-readable folder titles, in the order they appear in the UI.
const FOLDER_META = {
  grid:     { title: 'Grid',         open: true  },
  feedback: { title: 'Feedback',     open: true  },
  neural:   { title: 'Neural Style', open: true  },
  color:    { title: 'Color',        open: true  },
  camera:   { title: 'Camera',       open: false },
};

/**
 * @param {object} opts
 * @param {import('../params/paramMap.js').ParamMap}   opts.paramMap
 * @param {import('../params/modRouter.js').ModRouter} opts.router
 * @param {import('../output/capture.js').CanvasCapture} opts.capture
 * @param {() => void} opts.panic
 */
export function createGUI({ paramMap, router, capture, panic }) {
  // ── Create root GUI ────────────────────────────────────────────────────────
  const gui = new GUI({ title: 'VISUALS ENGINE', width: 280 });
  applyTheme(gui);

  // ── Panic button ──────────────────────────────────────────────────────────
  // Sits above everything else — must be immediately reachable in a dark room.
  const actions = { PANIC: panic };
  const panicCtrl = gui.add(actions, 'PANIC').name('PANIC  [Space]');
  stylePanicButton(panicCtrl);

  gui.add({ h: 'Space = panic  |  H = hide/show' }, 'h')
     .name('').disable();

  // ── Parameter sliders — auto-built from PARAM_DEFS ────────────────────────
  // proxy mirrors base values; onChange writes back to paramMap.
  const proxy = {};
  for (const p of paramMap.all()) proxy[p.id] = p.base;

  const folders   = {};
  const ctrls     = {}; // id → controller (for sync())

  // Build folders in the order defined in FOLDER_META
  for (const [groupKey, meta] of Object.entries(FOLDER_META)) {
    const defs = Object.entries(PARAM_DEFS).filter(([, d]) => d.group === groupKey);
    if (defs.length === 0) continue;

    const folder = gui.addFolder(meta.title);
    folders[groupKey] = folder;
    if (!meta.open) folder.close();

    for (const [id, def] of defs) {
      const ctrl = folder
        .add(proxy, id, def.min, def.max, def.step)
        .name(id === 'chaos' ? 'Chaos  ← spectral flux' : def.label)
        .onChange(v => paramMap.setBase(id, v));
      ctrls[id] = ctrl;
    }
  }

  // ── Audio meters (read-only, driven by .listen()) ─────────────────────────
  // lil-gui polls _meters on its own rAF — no manual update calls needed for
  // the meters themselves.  Call updateMeters(bands, flux) from main.js each frame.
  const _meters = { flux: 0, sub: 0, bass: 0, mid: 0, high: 0 };
  const metersFolder = gui.addFolder('Audio Meters');
  metersFolder.close();

  metersFolder.add(_meters, 'flux',  0, 1, 0.001).name('Spectral Flux').disable().listen();
  metersFolder.add(_meters, 'sub',   0, 1, 0.001).name('Sub (0)').disable().listen();
  metersFolder.add(_meters, 'bass',  0, 1, 0.001).name('Bass (1)').disable().listen();
  metersFolder.add(_meters, 'mid',   0, 1, 0.001).name('Mid (3)').disable().listen();
  metersFolder.add(_meters, 'high',  0, 1, 0.001).name('High (5)').disable().listen();

  // ── Output / Capture ──────────────────────────────────────────────────────
  const outputFolder = gui.addFolder('Output');
  outputFolder.close();

  const outputState = {
    'Stream (OBS/Virtual Cam)': () => {
      if (!capture.isStreaming) {
        const stream = capture.start();
        console.log('[Capture] Stream started:', stream);
      } else {
        capture.stop();
        console.log('[Capture] Stream stopped.');
      }
    },
    'Record WebM': () => {
      if (!capture.isRecording) {
        capture.startRecording();
      } else {
        capture.stopRecording();
        capture.downloadRecording();
      }
    },
  };

  outputFolder.add(outputState, 'Stream (OBS/Virtual Cam)')
    .name('Toggle Stream');
  outputFolder.add(outputState, 'Record WebM')
    .name('Toggle Record + Save');

  outputFolder.add(
    { note: 'Spout/Syphon: see capture.js' }, 'note'
  ).name('').disable();

  // ── Preset helpers ────────────────────────────────────────────────────────
  const presetFolder = gui.addFolder('Presets');
  presetFolder.close();

  const presetActions = {
    'Export Routes (console)': () => {
      console.log('[Router Preset]', JSON.stringify(router.exportPreset(), null, 2));
    },
    'Export Params (console)': () => {
      console.log('[Param Snapshot]', JSON.stringify(paramMap.snapshot(), null, 2));
    },
    'Reset to Defaults': panic,
  };

  for (const [k, fn] of Object.entries(presetActions)) {
    presetFolder.add(presetActions, k).name(k);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Sync all slider displays to the current paramMap base values.
   * Call this after any external change to base (MIDI, preset load, panic).
   * Safe to call during a drag — lil-gui only commits on pointer-up.
   */
  function sync() {
    for (const p of paramMap.all()) {
      proxy[p.id] = p.base;
    }
    for (const ctrl of Object.values(ctrls)) {
      ctrl.updateDisplay();
    }
  }

  /**
   * Write current audio levels into the meters.
   * Called from the render loop — lil-gui's .listen() picks these up automatically.
   * @param {Float32Array} bands  length-8
   * @param {number}       flux
   */
  function updateMeters(bands, flux) {
    _meters.flux = flux;
    _meters.sub  = bands[0];
    _meters.bass = bands[1];
    _meters.mid  = bands[3];
    _meters.high = bands[5];
  }

  /** Toggle panel visibility — bound to the H key in main.js. */
  function toggle() {
    gui._hidden ? gui.show() : gui.hide();
  }

  return { gui, sync, updateMeters, toggle };
}

// ─── Styling helpers ──────────────────────────────────────────────────────────

function applyTheme(gui) {
  const el = gui.domElement;
  // Semi-transparent dark panel — readable over any visual output
  el.style.setProperty('--background-color',     'rgba(10, 10, 15, 0.85)');
  el.style.setProperty('--title-background-color','rgba(20, 20, 30, 0.95)');
  el.style.setProperty('--text-color',            '#e0e0e0');
  el.style.setProperty('--widget-color',          '#2a2a3a');
  el.style.setProperty('--hover-color',           '#3a3a4a');
  el.style.setProperty('--focus-color',           '#4a4aff');
  el.style.setProperty('--number-color',          '#88aaff');
  el.style.setProperty('--string-color',          '#88ffaa');
  el.style.backdropFilter = 'blur(4px)';
}

function stylePanicButton(ctrl) {
  // Wait one microtask so the DOM element is fully attached
  Promise.resolve().then(() => {
    const btn = ctrl.domElement.querySelector('button');
    if (!btn) return;
    Object.assign(btn.style, {
      width:         '100%',
      background:    '#c0392b',
      color:         '#ffffff',
      fontWeight:    'bold',
      letterSpacing: '0.12em',
      fontSize:      '13px',
      border:        'none',
      padding:       '6px 0',
      cursor:        'pointer',
      transition:    'background 0.1s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#e74c3c'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#c0392b'; });
  });
}
