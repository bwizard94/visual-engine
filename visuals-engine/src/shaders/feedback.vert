// Fullscreen quad passthrough vertex shader.
// Used by both the feedback compositor and the final screen blit.
//
// Vertex layout: vec2 position (NDC), vec2 uv
// Draw as TRIANGLE_STRIP with 4 vertices:
//   (-1,-1,  0,0), (1,-1,  1,0), (-1,1,  0,1), (1,1,  1,1)

attribute vec2 a_position;
attribute vec2 a_uv;

varying vec2 v_uv;

void main() {
  v_uv        = a_uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
