// Passthrough blit — copies a texture directly to the output framebuffer.
// Used as the final screen pass after the feedback compositor writes to its FBO.

precision mediump float;

uniform sampler2D u_texture;

varying vec2 v_uv;

void main() {
  gl_FragColor = texture2D(u_texture, v_uv);
}
