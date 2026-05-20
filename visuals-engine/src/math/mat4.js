/**
 * Minimal mat4 library — column-major Float32Array, matching WebGL convention.
 * No dependencies. All functions write into an existing out array when provided.
 */

export function identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function perspective(out, fovY, aspect, near, far) {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0]  = f / aspect;
  out[5]  = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(out, eye, center, up) {
  let [ex, ey, ez] = eye;
  let [cx, cy, cz] = center;
  let [ux, uy, uz] = up;

  let fx = cx - ex, fy = cy - ey, fz = cz - ez;
  let fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;

  let sx = fy * uz - fz * uy;
  let sy = fz * ux - fx * uz;
  let sz = fx * uy - fy * ux;
  let sl = Math.hypot(sx, sy, sz);
  sx /= sl; sy /= sl; sz /= sl;

  let bx = sy * fz - sz * fy;
  let by = sz * fx - sx * fz;
  let bz = sx * fy - sy * fx;

  out[0]  = sx;  out[1]  = bx;  out[2]  = -fx; out[3]  = 0;
  out[4]  = sy;  out[5]  = by;  out[6]  = -fy; out[7]  = 0;
  out[8]  = sz;  out[9]  = bz;  out[10] = -fz; out[11] = 0;
  out[12] = -(sx*ex + sy*ey + sz*ez);
  out[13] = -(bx*ex + by*ey + bz*ez);
  out[14] =  (fx*ex + fy*ey + fz*ez);
  out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
