/**
 * Creates a fullscreen quad VBO for post-process passes.
 *
 * Layout (interleaved, 4 bytes each component):
 *   [ x, y, u, v ]  — 4 floats × 4 vertices = 64 bytes total
 *
 * Draw with: gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
 *
 * Attribute offsets (stride = 16 bytes):
 *   a_position : offset 0,  size 2
 *   a_uv       : offset 8,  size 2
 */
export function createFullscreenQuad(gl) {
  // NDC position (x, y) + UV (u, v)
  // TRIANGLE_STRIP order: BL → BR → TL → TR
  const verts = new Float32Array([
    -1, -1,   0, 0,   // bottom-left
     1, -1,   1, 0,   // bottom-right
    -1,  1,   0, 1,   // top-left
     1,  1,   1, 1,   // top-right
  ]);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return vbo;
}

/**
 * Binds the quad VBO and sets up vertex attribute pointers for a_position and a_uv.
 * Call this before each fullscreen draw pass.
 *
 * @param {WebGLRenderingContext} gl
 * @param {WebGLBuffer} vbo
 * @param {number} posLoc   - attribute location of a_position
 * @param {number} uvLoc    - attribute location of a_uv
 */
export function bindFullscreenQuad(gl, vbo, posLoc, uvLoc) {
  const STRIDE = 16; // 4 floats × 4 bytes
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

  if (posLoc >= 0) {
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, STRIDE, 0);
  }
  if (uvLoc >= 0) {
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, STRIDE, 8);
  }
}
