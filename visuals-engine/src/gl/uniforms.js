/**
 * Uniform upload helpers.
 * All functions take (gl, location, value) and upload nothing if location is null.
 *
 * Usage:
 *   setUniform.f(gl, locs.u_time, elapsed);
 *   setUniform.v4(gl, locs.u_color, [1, 0, 0, 1]);
 *   setUniform.mat4(gl, locs.u_mvp, mvpArray);
 */
export const setUniform = {
  f:    (gl, loc, v)    => loc !== null && gl.uniform1f(loc, v),
  i:    (gl, loc, v)    => loc !== null && gl.uniform1i(loc, v),
  v2:   (gl, loc, v)    => loc !== null && gl.uniform2fv(loc, v),
  v3:   (gl, loc, v)    => loc !== null && gl.uniform3fv(loc, v),
  v4:   (gl, loc, v)    => loc !== null && gl.uniform4fv(loc, v),
  mat3: (gl, loc, v)    => loc !== null && gl.uniformMatrix3fv(loc, false, v),
  mat4: (gl, loc, v)    => loc !== null && gl.uniformMatrix4fv(loc, false, v),
};
