/**
 * Uniforms — single source of truth for every GPU value.
 *
 * Three.js ShaderMaterial reads `.value` from each entry and uploads it
 * on every render call when the value has changed. Because the objects
 * are passed by reference, updating `.value` here is immediately visible
 * to the material — no need to reassign or notify anything.
 *
 * Naming convention
 * ─────────────────
 * All custom uniforms are prefixed with 'u' to distinguish them from
 * Three.js built-ins (projectionMatrix, etc.) in the shader source.
 *
 * Adding a new uniform
 * ────────────────────
 * 1. Add an entry here:   myParam: { value: 0 }
 * 2. Declare it in the shader:  uniform float myParam;
 * 3. Update it each frame via updateUniforms() or directly.
 * No ShaderMaterial rebuild required — Three.js handles new uniforms lazily.
 */

import * as THREE from 'three';

// Number of FFT bins passed to the shader.
// Must match the array size declared in plane.vert.js / plane.frag.js.
export const FREQUENCY_BINS = 128;

// ─── Uniform registry ─────────────────────────────────────────────────────────
export const uniforms = {
  // ── Time ──────────────────────────────────────────────────────────────────
  uTime:       { value: 0.0 },   // seconds since page load
  uDeltaTime:  { value: 0.0 },   // frame delta (seconds) — useful for physics

  // ── Audio ─────────────────────────────────────────────────────────────────
  uFrequencyData: { value: new Float32Array(FREQUENCY_BINS) },
  // Values must be normalised 0.0–1.0 before being written here.
  // Feed them from Web Audio API's AnalyserNode.getByteFrequencyData(),
  // divided by 255, or from a higher-level AudioAnalyser module.

  // ── Displacement ──────────────────────────────────────────────────────────
  uAmplitude:  { value: 1.5 },   // world-space displacement scale

  // ── Screen ────────────────────────────────────────────────────────────────
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
};

// ─── Per-frame update helpers ─────────────────────────────────────────────────

/**
 * Synchronise time uniforms from a THREE.Clock.
 * Call once at the top of the render loop.
 *
 * @param {number} elapsed  - clock.getElapsedTime()
 * @param {number} delta    - clock.getDelta()  (call getDelta AFTER getElapsed)
 */
export function tickTime(elapsed, delta) {
  uniforms.uTime.value      = elapsed;
  uniforms.uDeltaTime.value = delta;
}

/**
 * Copy external frequency data into the GPU-bound Float32Array.
 *
 * Writes in-place so no allocation occurs on the hot path.
 * If the source array is longer than FREQUENCY_BINS, only the first
 * FREQUENCY_BINS values are used (down-sampling is the caller's job).
 *
 * @param {Float32Array | Uint8Array} data
 *   Normalised 0.0–1.0 Float32Array, or raw 0–255 Uint8Array.
 * @param {boolean} [raw=false]
 *   Pass true when feeding a raw Uint8Array; values are divided by 255.
 */
export function tickFrequency(data, raw = false) {
  const dst = uniforms.uFrequencyData.value;
  const len = Math.min(data.length, FREQUENCY_BINS);
  if (raw) {
    for (let i = 0; i < len; i++) dst[i] = data[i] / 255;
  } else {
    dst.set(data.subarray ? data.subarray(0, len) : data.slice(0, len));
  }
}
