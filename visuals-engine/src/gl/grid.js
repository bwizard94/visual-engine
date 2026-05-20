/**
 * Builds a flat grid mesh on the XZ plane.
 *
 * @param {WebGLRenderingContext} gl
 * @param {number} size  - number of cells per axis (e.g. 200 → 200×200 grid)
 * @returns {{ vbo, ibo, indexCount }}
 */
export function createGrid(gl, size) {
  const vertCount = (size + 1) * (size + 1);

  // Two floats per vertex: (col, row)
  const vertices = new Float32Array(vertCount * 2);
  let vi = 0;
  for (let row = 0; row <= size; row++) {
    for (let col = 0; col <= size; col++) {
      vertices[vi++] = col;
      vertices[vi++] = row;
    }
  }

  // Triangle list: 2 tris per cell, 6 indices each
  const indexCount = size * size * 6;
  // Use Uint32Array — grids > ~200 need >65535 indices
  const indices = new Uint32Array(indexCount);
  let ii = 0;
  const stride = size + 1;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const tl = row * stride + col;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      // Triangle 1
      indices[ii++] = tl;
      indices[ii++] = bl;
      indices[ii++] = tr;
      // Triangle 2
      indices[ii++] = tr;
      indices[ii++] = bl;
      indices[ii++] = br;
    }
  }

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  // Unbind to avoid accidental mutation
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

  return { vbo, ibo, indexCount };
}
