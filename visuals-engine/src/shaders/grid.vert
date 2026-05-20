// High-density flat 3D grid — Y-axis displacement driven by audio frequency bands.
// Grid lives on the XZ plane. Displacement pushes vertices up along the Y axis.
//
// Band-to-space mapping (radial):
//   Distance 0.0 (center) → band 0 (sub)
//   Distance 1.0 (edge)   → band 7 (air)
// This mirrors how a speaker physically moves air — low frequencies radiate from the core.

attribute vec2 a_gridCoord; // (col, row) indices, range [0, GRID_SIZE]

uniform mat4  u_mvp;
uniform float u_gridSize;
uniform float u_cellScale;
uniform float u_time;
uniform float u_bands[8];          // [sub, bass, lowMid, mid, highMid, high, presence, air]
uniform float u_displacement_scale; // world-space height multiplier, e.g. 1.5

varying vec3  v_worldPos;
varying vec2  v_uv;
varying float v_bandEnergy;        // passes per-vertex energy to the fragment shader

// ─── Safe band lookup (GLSL ES 1.00 cannot dynamically index uniform arrays) ─
float getBand(int i) {
  if      (i == 0) return u_bands[0];
  else if (i == 1) return u_bands[1];
  else if (i == 2) return u_bands[2];
  else if (i == 3) return u_bands[3];
  else if (i == 4) return u_bands[4];
  else if (i == 5) return u_bands[5];
  else if (i == 6) return u_bands[6];
  else             return u_bands[7];
}

// Linearly interpolate across the 8 bands using a normalized position t ∈ [0, 1].
float sampleBands(float t) {
  float pos = clamp(t, 0.0, 1.0) * 7.0;
  int   lo  = int(pos);
  int   hi  = int(pos) + 1;
  return mix(getBand(lo), getBand(hi < 8 ? hi : 7), fract(pos));
}

void main() {
  float halfGrid = u_gridSize * 0.5;
  float x = (a_gridCoord.x - halfGrid) * u_cellScale;
  float z = (a_gridCoord.y - halfGrid) * u_cellScale;

  // Normalized radial distance from grid center [0, 1].
  // Divide by sqrt(0.5) ≈ 0.7071 so the corner of the grid maps to ~1.0, not ~1.414.
  vec2  centered  = (a_gridCoord / u_gridSize) - 0.5;
  float dist      = clamp(length(centered) / 0.7071, 0.0, 1.0);

  // Interpolate band energy at this vertex's radial position.
  float energy = sampleBands(dist);

  // Y displacement: band energy × scale.
  // Squaring sharpens the response — quiet signals stay flat, loud signals spike.
  float y = energy * energy * u_displacement_scale;

  vec3 worldPos = vec3(x, y, z);
  v_worldPos  = worldPos;
  v_uv        = a_gridCoord / u_gridSize;
  v_bandEnergy = energy;

  gl_Position = u_mvp * vec4(worldPos, 1.0);
}
