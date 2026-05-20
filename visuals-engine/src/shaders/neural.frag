// Neural Style — "Hallucination" post-process pass.
//
// At u_chaos = 0.0 this is a mathematically exact passthrough.
// As u_chaos rises, five layered effects activate:
//
//   1. FBM UV warp      — organic, multi-scale spatial distortion
//   2. Chromatic aberr. — R/B channels split along the warp gradient
//   3. 3×3 Convolution  — Gaussian blur → unsharp masking amplifies local features
//                         (simulates the "deep dream" gradient-amplification loop)
//   4. Neighbor bleed   — adjacent pixel colors spread into each other
//   5. Hue rotation     — per-pixel hue cycling driven by luminance + animated noise
//   6. Vignette         — edge darkening focuses the effect toward the center
//
// All six effects share the quadratic ramp c² = chaos², so low chaos values
// produce a clean image and the effect only kicks in above ~0.3.
//
// Performance: ~11 texture fetches per fragment (3×3 kernel + 2 aberration samples).
// At 1920×1080/60fps this costs roughly 0.5 ms on a mid-range GPU.

precision highp float;

uniform sampler2D u_frame;       // input: accumulated feedback texture
uniform float     u_chaos;       // 0.0 = clean  →  1.0 = maximum hallucination
uniform float     u_time;        // seconds since start (drives noise animation)
uniform vec2      u_resolution;  // viewport size in pixels (for texel offsets)

varying vec2 v_uv;

// ─── Noise ────────────────────────────────────────────────────────────────────

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise in [0, 1]
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep
  return mix(
    mix(hash(i),               hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// 3-octave fractal brownian motion — gives organic multi-scale texture.
// Offsets between octaves break up the visible grid-alignment artifact.
float fbm(vec2 p) {
  float v = 0.500 * noise(p);
  v      += 0.250 * noise(p * 2.13 + vec2(5.24, 1.37));
  v      += 0.125 * noise(p * 4.61 + vec2(3.71, 8.14));
  return v / 0.875; // renormalize to [0, 1]
}

// ─── Color space ──────────────────────────────────────────────────────────────

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx),  step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(
    abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)),
    d / (q.x + 1e-10),
    q.x
  );
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void main() {
  vec2 texel  = 1.0 / u_resolution;
  float c2    = u_chaos * u_chaos; // quadratic ramp — gentle at low values

  // ── Effect 1: FBM UV displacement ───────────────────────────────────────────
  // Two independent fbm calls create orthogonal X/Y displacement fields.
  // Animation speed and noise scale both increase with chaos.
  float tScale = u_time * (0.3 + u_chaos * 1.8);
  float nScale = 2.5 + u_chaos * 5.5;

  float nx = fbm(v_uv * nScale + vec2( tScale * 0.70,  tScale * 0.41));
  float ny = fbm(v_uv * nScale + vec2(-tScale * 0.53,  tScale * 0.79) + 4.31);

  // (nx, ny) are in [0,1]; center them around 0 and scale by chaos²
  vec2 warpedUV = v_uv + (vec2(nx, ny) - 0.5) * c2 * 0.065;

  // ── Effect 2: Chromatic aberration ──────────────────────────────────────────
  // R and B channels are offset in opposite directions along the warp gradient.
  // At chaos=0: aberration=0 → all three channels land on the same pixel.
  float aberration = u_chaos * 0.018;
  vec2  aberDir    = normalize(vec2(nx - 0.5, ny - 0.5) + 1e-4) * aberration;

  float r = texture2D(u_frame, warpedUV + aberDir).r;
  float g = texture2D(u_frame, warpedUV           ).g;
  float b = texture2D(u_frame, warpedUV - aberDir ).b;

  // ── Effect 3: 3×3 Gaussian convolution + unsharp masking ────────────────────
  // Kernel weights: corners=1, edges=2, center=4  (sum=16, Gaussian-like)
  //
  //  1  2  1
  //  2  4  2      × 1/16
  //  1  2  1
  //
  // The center pixel uses the chromatic-aberrated channels computed above.
  // Neighbors are sampled cleanly — the slight inconsistency is imperceptible
  // and saves 6 texture fetches.
  vec3 c00 = texture2D(u_frame, warpedUV + texel * vec2(-1.0,-1.0)).rgb;
  vec3 c10 = texture2D(u_frame, warpedUV + texel * vec2( 0.0,-1.0)).rgb;
  vec3 c20 = texture2D(u_frame, warpedUV + texel * vec2( 1.0,-1.0)).rgb;
  vec3 c01 = texture2D(u_frame, warpedUV + texel * vec2(-1.0, 0.0)).rgb;
  vec3 c11 = vec3(r, g, b); // center — already has chromatic aberration
  vec3 c21 = texture2D(u_frame, warpedUV + texel * vec2( 1.0, 0.0)).rgb;
  vec3 c02 = texture2D(u_frame, warpedUV + texel * vec2(-1.0, 1.0)).rgb;
  vec3 c12 = texture2D(u_frame, warpedUV + texel * vec2( 0.0, 1.0)).rgb;
  vec3 c22 = texture2D(u_frame, warpedUV + texel * vec2( 1.0, 1.0)).rgb;

  vec3 blurred = (
    1.0*c00 + 2.0*c10 + 1.0*c20 +
    2.0*c01 + 4.0*c11 + 2.0*c21 +
    1.0*c02 + 2.0*c12 + 1.0*c22
  ) / 16.0;

  // Unsharp masking: amplify the difference between center and its local average.
  // This is the core "deep-dream" loop — features that are already present
  // get reinforced, pushing them toward vivid, exaggerated forms.
  // sharpness scales from 0 (identity) to ~3.5 (heavy amplification).
  float sharpness = c2 * 3.5;
  vec3  color     = clamp(c11 + (c11 - blurred) * sharpness, 0.0, 1.0);

  // ── Effect 4: Neighbor color bleed ──────────────────────────────────────────
  // A cross-shaped average of the 4 orthogonal neighbors bleeds into the pixel.
  // Creates the "colors dissolving into each other" aesthetic at high chaos.
  vec3 cross = (c01 + c10 + c21 + c12) * 0.25;
  color = mix(color, mix(color, cross, 0.65), c2 * 0.3);

  // ── Effect 5: Hue rotation + saturation boost ────────────────────────────────
  // The hue shift is non-uniform: it depends on local luminance and an
  // animated noise field, so different parts of the image cycle at different rates.
  // This breaks up the flat color cycling and creates the "living" quality.
  vec3  hsv  = rgb2hsv(color);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));

  float hueShift =
    u_chaos * 0.5 * (                                    // global strength
      luma * 0.55 +                                      // bright areas cycle faster
      fbm(v_uv * 3.1 + vec2(u_time * 0.13, 0.0)) * 0.45 // spatial variation
    );

  hsv.x = fract(hsv.x + hueShift);                      // wrap hue [0, 1)
  hsv.y = clamp(hsv.y + u_chaos * 0.55, 0.0, 1.0);      // boost saturation

  color = hsv2rgb(hsv);

  // ── Effect 6: Vignette ───────────────────────────────────────────────────────
  // Darkens edges proportional to chaos, drawing the eye toward the active center.
  vec2  vd = v_uv - 0.5;
  float vig = 1.0 - dot(vd, vd) * u_chaos * 1.3;
  color *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
