// Video Feedback Loop compositor.
//
// Each frame this shader:
//   1. Samples the previous accumulated frame (u_prevFrame) through a
//      scale + rotation transform centered on the screen.
//   2. Samples the current geometry frame (u_currentFrame) without transform.
//   3. Mixes them: result = mix(current, transformedPrev, u_feedback_strength)
//
// The transform creates the characteristic feedback tunnel:
//   u_feedback_scale    > 1.0  → inward zoom (converging vortex)
//   u_feedback_scale    < 1.0  → outward zoom (expanding bloom)
//   u_feedback_rotation ≠ 0.0  → rotation (spiral)
//
// u_feedback_strength controls decay:
//   0.0 → no persistence, only current frame visible
//   0.9 → heavy trails, content lingers ~10 frames
//   1.0 → no decay, infinite persistence (use carefully — will saturate)

precision highp float;

uniform sampler2D u_currentFrame;   // geometry pass output (geoFBO texture)
uniform sampler2D u_prevFrame;      // accumulated feedback from previous frame
uniform float     u_feedback_strength;  // 0.0–1.0
uniform float     u_feedback_scale;     // zoom: 1.005 = subtle inward pull
uniform float     u_feedback_rotation;  // radians: 0.003 = slow spiral

varying vec2 v_uv;

void main() {
  // ── Transform the UV used to sample the previous frame ────────────────────
  // All operations are centered on (0.5, 0.5) — the screen center.
  vec2 centered = v_uv - 0.5;

  // Rotation matrix (2D)
  float s = sin(u_feedback_rotation);
  float c = cos(u_feedback_rotation);
  vec2 rotated = vec2(
    centered.x * c - centered.y * s,
    centered.x * s + centered.y * c
  );

  // Scale: dividing shrinks the sampling window → content appears to zoom in.
  // u_feedback_scale > 1.0 means we sample a smaller region of the prev frame,
  // which when displayed at full size creates a magnifying / zooming-in effect.
  vec2 transformedUV = (rotated / u_feedback_scale) + 0.5;

  // ── Sample both textures ───────────────────────────────────────────────────
  // CLAMP_TO_EDGE on both textures keeps the edges from wrapping/bleeding.
  vec4 prevColor     = texture2D(u_prevFrame,     transformedUV);
  vec4 currentColor  = texture2D(u_currentFrame,  v_uv);

  // ── Blend ─────────────────────────────────────────────────────────────────
  // mix(a, b, t) = a*(1-t) + b*t
  // At t=u_feedback_strength:
  //   - Previous frame contributes u_feedback_strength of the output
  //   - Current frame contributes (1 - u_feedback_strength)
  // This means each frame the previous content decays by (1 - u_feedback_strength).
  vec4 result = mix(currentColor, prevColor, u_feedback_strength);

  // Clamp to prevent runaway saturation if strength approaches 1.0
  gl_FragColor = clamp(result, 0.0, 1.0);
}
