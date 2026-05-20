/**
 * main.js — composition root and render loop.
 *
 * Responsibilities:
 *   1. Wire up SceneMesh → Renderer
 *   2. Connect the Web Audio API and feed frequency data each frame
 *   3. Update uniforms once per tick before composer.render()
 *
 * To inject a post-processing pass (e.g. bloom):
 *   import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
 *   import * as THREE from 'three';
 *   renderer.injectPass(
 *     new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.2, 0.6, 0.85),
 *     1 // insert at index 1 — after RenderPass, before OutputPass
 *   );
 */

import * as THREE  from 'three';
import { SceneMesh }  from './core/SceneMesh.js';
import { Renderer }   from './core/Renderer.js';
import { tickTime, tickFrequency, FREQUENCY_BINS } from './core/Uniforms.js';

// ─── Scene + Renderer ─────────────────────────────────────────────────────────
const canvas    = document.getElementById('c');
const sceneMesh = new SceneMesh();
const renderer  = new Renderer(canvas, sceneMesh.scene, sceneMesh.camera);

// ─── Audio ────────────────────────────────────────────────────────────────────
// The Web Audio pipeline is intentionally decoupled so you can swap in
// a different source (file, line-in, synthetic oscillator) without changing
// the render loop.  Click the canvas to request microphone access.

/** @type {AnalyserNode|null} */
let analyser    = null;
/** @type {Uint8Array} */
let freqRaw     = new Uint8Array(FREQUENCY_BINS); // reused every frame

async function initAudio() {
  try {
    const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx      = new AudioContext();
    const source   = ctx.createMediaStreamSource(stream);

    analyser              = ctx.createAnalyser();
    analyser.fftSize      = FREQUENCY_BINS * 2; // gives FREQUENCY_BINS bins
    analyser.smoothingTimeConstant = 0.8;

    source.connect(analyser);

    // Resize the read buffer to match the actual bin count
    freqRaw = new Uint8Array(analyser.frequencyBinCount);

    console.log('[Audio] Microphone connected. Bins:', analyser.frequencyBinCount);
  } catch (err) {
    console.warn('[Audio] Mic access denied or unavailable:', err.message);
  }
}

canvas.addEventListener('click', initAudio, { once: true });

// ─── Clock ────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

// ─── Render loop ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  // getDelta() must be called BEFORE getElapsedTime() each frame —
  // internally both read the same timestamp so order matters.
  const delta   = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // 1. Update time uniforms
  tickTime(elapsed, delta);

  // 2. Feed frequency data (raw Uint8Array → normalised Float32Array in tickFrequency)
  if (analyser) {
    analyser.getByteFrequencyData(freqRaw);
    tickFrequency(freqRaw, true); // true = divide by 255 internally
  }

  // 3. Optional: animate the mesh itself each frame
  //    sceneMesh.mesh.rotation.z += delta * 0.05;

  // 4. Render all composer passes
  renderer.render();
}

animate();

// ─── Global dev surface ───────────────────────────────────────────────────────
// Reach anything from the browser console during a session:
//   vj.sceneMesh.setWireframe(false)
//   vj.renderer.injectPass(new UnrealBloomPass(...), 1)
window.vj = { sceneMesh, renderer, clock };
