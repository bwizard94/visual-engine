/**
 * Plane fragment shader — GLSL 3.00 ES
 *
 * In GLSL 3, gl_FragColor is removed. Declare your own output variable.
 * Three.js's OutputPass (added after RenderPass in the composer) handles
 * the final tone-mapping and color-space conversion for the screen.
 *
 * This shader is intentionally minimal — a reactive color ramp ready for you
 * to replace or extend. Every uniform is available if you want to add
 * noise, feedback, or procedural texturing directly in the fragment stage.
 */

export default /* glsl */`

// Required in GLSL 3: declare the fragment color output explicitly.
out vec4 fragColor;

// ─── In varyings ← vertex shader ────────────────────────────────────────────
in vec2  vUv;
in float vFreqEnergy;
in vec3  vWorldPos;
in float vDisplacement;

// ─── Custom uniforms ─────────────────────────────────────────────────────────
uniform float uTime;
uniform float uFrequencyData[128];
uniform vec2  uResolution;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Smooth HSV → RGB (no branching).
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // ── Per-fragment frequency lookup ─────────────────────────────────────────
  // Sample the frequency bin that corresponds to this fragment's X position.
  // Matches the vertex lookup so color and displacement are in sync.
  int   freqIndex = int(vUv.x * 127.0);
  float energy    = uFrequencyData[freqIndex];

  // ── Color ramp ────────────────────────────────────────────────────────────
  // Hue sweeps from cool blue (low energy) → hot red/orange (high energy).
  // The uv.x offset creates a lateral gradient across the mesh.
  float hue        = mix(0.60, 0.02, energy)            // 0.60=blue, 0.02=red
                   - vUv.x * 0.08                        // subtle lateral drift
                   + uTime * 0.015;                      // slow time animation
  float saturation = 0.75 + energy * 0.25;              // desaturates at low E
  float brightness = 0.15 + energy * 0.85;              // dark floor, bright peak

  vec3 color = hsv2rgb(vec3(fract(hue), saturation, brightness));

  // ── Edge glow ─────────────────────────────────────────────────────────────
  // Brighten displaced geometry edges so the mesh topology reads clearly.
  color += vec3(clamp(vDisplacement * 0.4, 0.0, 0.5));

  // ── Output ────────────────────────────────────────────────────────────────
  fragColor = vec4(color, 1.0);
}

`; // end of shader source
