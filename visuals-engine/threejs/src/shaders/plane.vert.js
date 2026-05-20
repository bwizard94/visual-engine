/**
 * Plane vertex shader — GLSL 3.00 ES
 *
 * Three.js injects the following builtins before this source runs,
 * so do NOT redeclare them:
 *
 *   Uniforms  : projectionMatrix, modelViewMatrix, modelMatrix,
 *               viewMatrix, normalMatrix, cameraPosition
 *   Attributes: position (vec3), normal (vec3), uv (vec2),
 *               uv1 (vec2), color (vec3), tangent (vec4)
 *
 * Dynamic array indexing (uFrequencyData[int expr]) is legal in
 * GLSL 3 — this is why we use glslVersion: THREE.GLSL3.
 */

export default /* glsl */`

// ─── Out varyings → fragment shader ─────────────────────────────────────────
out vec2  vUv;
out float vFreqEnergy;   // band energy at this vertex's X position
out vec3  vWorldPos;
out float vDisplacement; // signed displacement amount (for fragment FX)

// ─── Custom uniforms ─────────────────────────────────────────────────────────
uniform float uTime;
uniform float uFrequencyData[128]; // normalized 0.0–1.0 per bin
uniform float uAmplitude;          // world-space displacement scale
uniform vec2  uResolution;

void main() {
  vUv = uv;

  // ── Frequency lookup ───────────────────────────────────────────────────────
  // Map UV.x [0,1] to a bin index [0,127].
  // Dynamic int indexing is valid in GLSL 3 — no if/else chain needed.
  int   freqIndex = int(uv.x * 127.0);
  float energy    = uFrequencyData[freqIndex];
  vFreqEnergy     = energy;

  // ── Displacement ──────────────────────────────────────────────────────────
  // Push vertices along their normal (Z-axis for a default PlaneGeometry).
  // Squaring energy makes silent passages stay flat and loud peaks spike sharply.
  float disp   = energy * energy * uAmplitude;
  // Add a gentle time-based ripple on top so the mesh stays alive at zero input.
  disp        += sin(uv.x * 12.0 + uTime * 2.0) * 0.02
               + sin(uv.y * 8.0  - uTime * 1.5) * 0.015;
  vDisplacement = disp;

  vec3 displaced = position + normal * disp;
  vWorldPos      = (modelMatrix * vec4(displaced, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}

`; // end of shader source
