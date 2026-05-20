// Grid geometry pass — writes the current-frame "source" content into geoFBO.
// The feedback compositor reads this texture every frame.
//
// Color output:
//   Base color (u_color) brightened by the per-vertex band energy passed from
//   the vertex shader. High-energy vertices glow toward white; silent vertices
//   render in the raw base color.

precision highp float;

uniform vec4  u_color;
uniform float u_time;
uniform float u_bands[8];

varying vec3  v_worldPos;
varying vec2  v_uv;
varying float v_bandEnergy;  // 0.0–1.0 radial band energy from vertex shader

void main() {
  // Brighten the base color toward white proportional to band energy.
  // Squaring the energy creates a punchy, threshold-like response.
  float glow   = v_bandEnergy * v_bandEnergy;
  vec3  color  = mix(u_color.rgb, vec3(1.0), glow * 0.6);

  gl_FragColor = vec4(color, u_color.a);
}
