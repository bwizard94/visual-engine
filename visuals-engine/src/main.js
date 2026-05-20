import { createProgram }                            from './gl/program.js';
import { createGrid }                               from './gl/grid.js';
import { createFullscreenQuad, bindFullscreenQuad } from './gl/quad.js';
import { createFBO, destroyFBO }                    from './gl/fbo.js';
import { setUniform }                               from './gl/uniforms.js';
import * as mat4                                    from './math/mat4.js';
import { AudioAnalyser }                            from './audio/analyser.js';
import { MidiInput }                                from './midi/midi.js';
import { ParamMap }                                 from './params/paramMap.js';
import { ModRouter }                                from './params/modRouter.js';
import { createPane }                               from './ui/pane.js';
import { CanvasCapture }                            from './output/capture.js';
import { OutputManager }                            from './output/outputManager.js';
import { CalibrationOverlay }                       from './gl/calibration.js';
import { MacroController }                          from './macro/MacroController.js';
import { PresetManager }                            from './macro/PresetManager.js';

// ─── Shader sources (parallel fetch) ─────────────────────────────────────────
const [GRID_VERT, GRID_FRAG, FB_VERT, FB_FRAG, NEURAL_FRAG] = await Promise.all([
  fetch('./src/shaders/grid.vert').then(r => r.text()),
  fetch('./src/shaders/grid.frag').then(r => r.text()),
  fetch('./src/shaders/feedback.vert').then(r => r.text()),
  fetch('./src/shaders/feedback.frag').then(r => r.text()),
  fetch('./src/shaders/neural.frag').then(r => r.text()),
]);

// ─── Constant (geometry baked at startup) ────────────────────────────────────
const GRID_SIZE = 200;

// ─── Canvas + WebGL context ───────────────────────────────────────────────────
const canvas = document.getElementById('glCanvas');

const gl = canvas.getContext('webgl', {
  antialias:             false,
  alpha:                 false,
  depth:                 true,
  stencil:               false,
  preserveDrawingBuffer: true,  // true: required for captureStream() to work correctly
  powerPreference:       'high-performance',
});

if (!gl) throw new Error('WebGL not supported');
if (!gl.getExtension('OES_element_index_uint')) throw new Error('OES_element_index_uint not supported');

// ─── Output manager (resolution lock + present pass + clean readback) ─────────
// Starts unlocked, matching the canvas size. Call output.lock() or set a preset
// via the Projection Setup panel to pin to a fixed resolution.
const output = new OutputManager(gl, canvas);

// ─── Calibration overlay ───────────────────────────────────────────────────────
// Drawn on screen only, never into the output FBO — invisible to Spout/Syphon.
// Toggle: C = crosshair, B = checkerboard
const calibration = new CalibrationOverlay(gl);

// ─── Parameter map ────────────────────────────────────────────────────────────
const paramMap = new ParamMap();

// ─── Macro controller + preset manager ───────────────────────────────────────
const macro   = new MacroController();
const presets = new PresetManager();

// ─── Modulation router ────────────────────────────────────────────────────────
const router = new ModRouter();

router.addRoute({ bandIndex: 1, paramId: 'displacementScale', sensitivity: 0.9  });
router.addRoute({ bandIndex: 3, paramId: 'feedbackStrength',  sensitivity: 0.15 });
router.addRoute({ bandIndex: 5, paramId: 'colorB',            sensitivity: 0.6  });
router.addRoute({ bandIndex: 0, paramId: 'colorR',            sensitivity: 0.5  });
router.addRoute({ bandIndex: 6, paramId: 'feedbackRotation',  sensitivity: 0.4  });
router.addRoute({ source: 'flux', paramId: 'chaos',           sensitivity: 1.1  });

// ─── Audio ────────────────────────────────────────────────────────────────────
const audio = new AudioAnalyser({ fftSize: 2048, smoothing: 0.80, bandSmoothing: 0.75 });

// ─── MIDI ─────────────────────────────────────────────────────────────────────
const midi = new MidiInput();

// ─── Shader programs ──────────────────────────────────────────────────────────
const gridProg = createProgram(
  gl, GRID_VERT, GRID_FRAG,
  ['u_mvp', 'u_gridSize', 'u_cellScale', 'u_time',
   'u_color', 'u_bands[0]', 'u_displacement_scale'],
  ['a_gridCoord'],
);

const feedbackProg = createProgram(
  gl, FB_VERT, FB_FRAG,
  ['u_currentFrame', 'u_prevFrame',
   'u_feedback_strength', 'u_feedback_scale', 'u_feedback_rotation'],
  ['a_position', 'a_uv'],
);

const neuralProg = createProgram(
  gl, FB_VERT, NEURAL_FRAG,
  ['u_frame', 'u_chaos', 'u_time', 'u_resolution'],
  ['a_position', 'a_uv'],
);

// ─── Geometry ─────────────────────────────────────────────────────────────────
const { vbo: gridVBO, ibo: gridIBO, indexCount } = createGrid(gl, GRID_SIZE);
const quadVBO = createFullscreenQuad(gl);

// ─── FBO setup ────────────────────────────────────────────────────────────────
function buildFBOs(w, h) {
  return {
    geo:  createFBO(gl, w, h),
    ping: createFBO(gl, w, h),
    pong: createFBO(gl, w, h),
  };
}

// FBOs are always sized to the output resolution (not the canvas).
// When the output is locked, FBOs stay fixed even if the window resizes.
let fbos          = buildFBOs(output.width, output.height);
let feedbackRead  = fbos.ping;
let feedbackWrite = fbos.pong;

// ─── Panic ────────────────────────────────────────────────────────────────────
/**
 * Emergency reset. Clears the accumulated feedback buffers to black and restores
 * every parameter to its default value. Safe to call at any time including
 * mid-frame (changes take effect on the next rAF tick).
 *
 * Triggered by: Space key, GUI PANIC button, or engine.panic() from the console.
 */
function panic() {
  // 1. Flush both feedback FBOs to solid black
  for (const fb of [feedbackRead, feedbackWrite]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // 2. Reset macro vibe to neutral (all macros to 0)
  macro.reset();

  // 3. Reset all parameter base values to defaults
  paramMap.resetAll();

  // 4. Sync the GUI sliders to show the reset values
  //    (ui may not exist yet if panic is somehow called before GUI init)
  ui?.sync();

  console.log('%c[Engine] PANIC — buffers cleared, parameters reset.', 'color:#e74c3c;font-weight:bold');
}

// ─── Resize handling ──────────────────────────────────────────────────────────
function resizeToDisplay() {
  const dpr = window.devicePixelRatio || 1;
  const w   = Math.floor(canvas.clientWidth  * dpr);
  const h   = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width === w && canvas.height === h) return;

  canvas.width  = w;
  canvas.height = h;
  // Viewport is set per-pass in the frame loop; no global gl.viewport here.

  // Notify OutputManager: if locked, only recomputes letterbox;
  // if unlocked, rebuilds the output FBO and returns true.
  const fbosDirty = output.onCanvasResize(w, h);

  if (fbosDirty) {
    // Output resolution changed — rebuild render FBOs to match.
    _rebuildRenderFBOs();
  }
}

/** Rebuild geometry / feedback FBOs at the current output resolution. */
function _rebuildRenderFBOs() {
  destroyFBO(gl, fbos.geo);
  destroyFBO(gl, fbos.ping);
  destroyFBO(gl, fbos.pong);
  fbos          = buildFBOs(output.width, output.height);
  feedbackRead  = fbos.ping;
  feedbackWrite = fbos.pong;

  for (const fb of [feedbackRead, feedbackWrite]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Listen for resolution changes from the Projection Setup panel
window.addEventListener('ve-output-resize', () => _rebuildRenderFBOs());

resizeToDisplay();
window.addEventListener('resize', resizeToDisplay);

// ─── Output capture ───────────────────────────────────────────────────────────
// Pass gl so capture.sendElectronFrame() can call gl.readPixels() each frame.
const capture = new CanvasCapture(canvas, gl);

// ─── GUI overlay ──────────────────────────────────────────────────────────────
// Declared with `let` so panic() can call ui?.sync() before this assignment.
let ui = createPane({ paramMap, macro, router, presets, audio, capture, panic, output, calibration });

// ─── MIDI — connect and forward CC to paramMap (+ sync GUI) ─────────────────
midi.connect().then(() => {
  midi.onCC((cc, value) => {
    // Route to macros first; if unhandled, fall through to individual params.
    const macroHit = macro.applyCC(cc, value);
    if (!macroHit && paramMap.applyCC(cc, value)) {
      // Reflect MIDI-driven changes in the slider display
      ui.sync();
    }
  });
});

// ─── Audio — arm on first user gesture (browser autoplay policy) ─────────────
canvas.addEventListener('click', async () => {
  if (!audio.isConnected) {
    await audio.connectMic();
    console.log('[Audio] Microphone connected.');
  }
}, { once: true });

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  // Don't steal keys from text inputs (e.g. browser console)
  if (e.target.matches('input, textarea, select')) return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      panic();
      break;
    case 'KeyH':
      ui.toggle();
      break;
    case 'KeyC':
      calibration.toggleCrosshair();
      break;
    case 'KeyB':
      calibration.toggleCheckerboard();
      break;
    case 'KeyM':
      // Mute/unmute audio modulation by clearing all routes temporarily
      // (hold M to suppress, release to restore — handled with keyup below)
      router.clearRoutes();
      break;
  }
});

// ─── Pre-allocated scratch buffers ────────────────────────────────────────────
const proj     = new Float32Array(16);
const view     = new Float32Array(16);
const mvp      = new Float32Array(16);
const colorBuf = new Float32Array(4);
colorBuf[3]    = 1.0;
const resBuf   = new Float32Array(2);

// ─── Render loop ──────────────────────────────────────────────────────────────
const startTime = performance.now();

function frame(now) {
  const elapsed = (now - startTime) * 0.001;

  // ── 1. Audio + modulation ──────────────────────────────────────────────────
  const bands = audio.getBands();
  const flux  = audio.getSpectralFlux();

  // Macros set base values first — audio modulation accumulates on top.
  macro.apply(paramMap, elapsed);
  router.process(bands, paramMap, flux);
  ui.updateMeters(bands, flux);

  // ── 2. Snapshot modulated values (one read per param, no repeated lookups) ──
  const cellScale         = paramMap.value('cellScale');
  const displacementScale = paramMap.value('displacementScale');
  const feedbackStrength  = paramMap.value('feedbackStrength');
  const feedbackScale     = paramMap.value('feedbackScale');
  const feedbackRotation  = paramMap.value('feedbackRotation');
  const chaos             = paramMap.value('chaos');
  const cameraHeight      = paramMap.value('cameraHeight');
  const cameraDepth       = paramMap.value('cameraDepth');

  colorBuf[0] = paramMap.value('colorR');
  colorBuf[1] = paramMap.value('colorG');
  colorBuf[2] = paramMap.value('colorB');

  // ── Pass 1: Geometry → geoFBO ──────────────────────────────────────────────
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.geo.fbo);
  gl.viewport(0, 0, fbos.geo.width, fbos.geo.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  // Use output resolution for perspective + neural shader — not the canvas size.
  // This keeps the geometry consistent regardless of the display window.
  const aspect = output.width / output.height;
  mat4.perspective(proj, Math.PI / 3, aspect, 0.01, 100);
  mat4.lookAt(view, [0, cameraHeight, cameraDepth], [0, 0, 0], [0, 1, 0]);
  mat4.multiply(mvp, proj, view);

  gl.useProgram(gridProg.program);
  setUniform.mat4(gl, gridProg.uniforms['u_mvp'],               mvp);
  setUniform.f  (gl, gridProg.uniforms['u_time'],               elapsed);
  setUniform.f  (gl, gridProg.uniforms['u_gridSize'],           GRID_SIZE);
  setUniform.f  (gl, gridProg.uniforms['u_cellScale'],          cellScale);
  setUniform.v4 (gl, gridProg.uniforms['u_color'],              colorBuf);
  setUniform.f  (gl, gridProg.uniforms['u_displacement_scale'], displacementScale);
  if (gridProg.uniforms['u_bands[0]'] !== null) {
    gl.uniform1fv(gridProg.uniforms['u_bands[0]'], bands);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, gridVBO);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIBO);
  const gridCoordLoc = gridProg.attributes['a_gridCoord'];
  gl.enableVertexAttribArray(gridCoordLoc);
  gl.vertexAttribPointer(gridCoordLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);

  gl.disable(gl.DEPTH_TEST);

  // ── Pass 2: Feedback composite → feedbackWrite ─────────────────────────────
  gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackWrite.fbo);
  gl.viewport(0, 0, feedbackWrite.width, feedbackWrite.height);

  gl.useProgram(feedbackProg.program);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fbos.geo.texture);
  setUniform.i(gl, feedbackProg.uniforms['u_currentFrame'], 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, feedbackRead.texture);
  setUniform.i(gl, feedbackProg.uniforms['u_prevFrame'], 1);

  setUniform.f(gl, feedbackProg.uniforms['u_feedback_strength'], feedbackStrength);
  setUniform.f(gl, feedbackProg.uniforms['u_feedback_scale'],    feedbackScale);
  setUniform.f(gl, feedbackProg.uniforms['u_feedback_rotation'], feedbackRotation);

  bindFullscreenQuad(gl, quadVBO,
    feedbackProg.attributes['a_position'],
    feedbackProg.attributes['a_uv'],
  );
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // ── Pass 3: Neural Style → output FBO (locked resolution) ─────────────────
  // Renders into the clean output buffer at the locked resolution.
  // The screen canvas is NOT touched here — present() handles that next.
  gl.bindFramebuffer(gl.FRAMEBUFFER, output.fbo.fbo);
  gl.viewport(0, 0, output.width, output.height);

  resBuf[0] = output.width;
  resBuf[1] = output.height;

  gl.useProgram(neuralProg.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, feedbackWrite.texture);
  setUniform.i  (gl, neuralProg.uniforms['u_frame'],      0);
  setUniform.f  (gl, neuralProg.uniforms['u_chaos'],      chaos);
  setUniform.f  (gl, neuralProg.uniforms['u_time'],       elapsed);
  setUniform.v2 (gl, neuralProg.uniforms['u_resolution'], resBuf);

  bindFullscreenQuad(gl, quadVBO,
    neuralProg.attributes['a_position'],
    neuralProg.attributes['a_uv'],
  );
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // ── Swap ping-pong ─────────────────────────────────────────────────────────
  [feedbackRead, feedbackWrite] = [feedbackWrite, feedbackRead];

  // ── Spout / Syphon readback — BEFORE present pass ─────────────────────────
  // Reads from output.fbo: clean locked-resolution RGBA, no letterbox bars,
  // no calibration overlay, no Tweakpane chrome.
  capture.sendElectronFrame(output);

  // ── Pass 4: Present output FBO → screen (letterboxed) ──────────────────────
  output.present();

  // ── Pass 5: Calibration overlay → screen only ──────────────────────────────
  // Drawn AFTER readback so it never reaches Spout/Syphon.
  calibration.draw(output.letterbox);

  requestAnimationFrame(frame);
}

// ─── Console API — live performance surface ───────────────────────────────────
window.engine = { paramMap, router, audio, midi, capture, ui, panic, macro, presets, output, calibration };

requestAnimationFrame(frame);
