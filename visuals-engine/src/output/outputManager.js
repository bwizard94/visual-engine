import { createFBO, destroyFBO }  from '../gl/fbo.js';
import { createProgram }          from '../gl/program.js';

// ─── Output presets ───────────────────────────────────────────────────────────

/** @type {Record<string, [number, number]>} */
export const OUTPUT_PRESETS = {
  '1920×1080': [1920, 1080],
  '1280×720':  [1280,  720],
  '1600×900':  [1600,  900],
  '1024×768':  [1024,  768],
  '800×600':   [ 800,  600],
};

// ─── Shaders ──────────────────────────────────────────────────────────────────

const PRESENT_VERT = /* glsl */`
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying   vec2 v_uv;
  void main() {
    v_uv        = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const PRESENT_FRAG = /* glsl */`
  precision mediump float;
  uniform sampler2D u_frame;
  varying vec2      v_uv;
  void main() {
    gl_FragColor = texture2D(u_frame, v_uv);
  }
`;

// ─── OutputManager ────────────────────────────────────────────────────────────

/**
 * Manages a resolution-locked output FBO that is independent of the browser
 * window size.  The FBO is the canonical "clean" render target:
 *   - All visual passes render into it at the locked resolution.
 *   - `present()` blits it letterboxed to the screen canvas (black bars).
 *   - `readPixels(buf)` reads from it — no UI chrome, no black bars.
 *
 * Projection-mapping workflow
 * ────────────────────────────
 *   1. output.setResolution(1920, 1080);  output.lock();
 *   2. All passes render to output.fbo.fbo at 1920×1080.
 *   3. Spout/Syphon readback via output.readPixels() — always 1920×1080 RGBA.
 *   4. output.present() blits to screen with letterbox bars for monitoring.
 *   5. calibration.draw(output.letterbox) adds alignment guides over the
 *      letterboxed area — never touches the clean FBO.
 *
 * Usage
 * ─────
 *   const om = new OutputManager(gl, canvas);
 *   om.setResolution(1920, 1080);
 *   om.lock();
 *
 *   // Each frame, after all draw calls into om.fbo.fbo:
 *   om.readPixels(cleanBuf);   // for Spout/Syphon — clean, no letterbox
 *   om.present();              // blit to screen with black bars
 */
export class OutputManager {
  /**
   * @param {WebGLRenderingContext} gl
   * @param {HTMLCanvasElement}     canvas
   */
  constructor(gl, canvas) {
    this._gl      = gl;
    this._canvas  = canvas;
    this._locked  = false;

    this._outW    = canvas.width  || 1920;
    this._outH    = canvas.height || 1080;

    this._canvasW = canvas.width;
    this._canvasH = canvas.height;

    /** @type {{ x:number, y:number, w:number, h:number }} */
    this._lb = { x: 0, y: 0, w: 0, h: 0 };

    this._fbo     = createFBO(gl, this._outW, this._outH);
    this._program = createProgram(gl, PRESENT_VERT, PRESENT_FRAG,
      ['u_frame'], ['a_pos', 'a_uv']);
    this._vbo     = this._buildQuad();

    this._computeLetterbox();
  }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  /**
   * The output FBO object.  Bind `fbo.fbo` as the framebuffer before all
   * visual draw calls.
   * @returns {{ fbo: WebGLFramebuffer, texture: WebGLTexture, width: number, height: number }}
   */
  get fbo()      { return this._fbo; }

  /** Locked output width in pixels. */
  get width()    { return this._outW; }

  /** Locked output height in pixels. */
  get height()   { return this._outH; }

  /** Whether the output resolution is currently locked. */
  get isLocked() { return this._locked; }

  /**
   * Letterbox viewport rect in screen-canvas pixels (bottom-left origin).
   * Pass directly to `CalibrationOverlay.draw()`.
   * @returns {{ x: number, y: number, w: number, h: number }}
   */
  get letterbox() { return this._lb; }

  // ─── Resolution management ─────────────────────────────────────────────────

  /**
   * Change the output resolution and rebuild the output FBO.
   *
   * @param {number} w
   * @param {number} h
   * @returns {boolean} true — FBO was rebuilt; callers should also rebuild
   *                    their geometry/feedback FBOs to match.
   */
  setResolution(w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this._outW && h === this._outH) return false;

    destroyFBO(this._gl, this._fbo);
    this._outW = w;
    this._outH = h;
    this._fbo  = createFBO(this._gl, w, h);
    this._computeLetterbox();
    console.log(`[Output] Resolution → ${w}×${h}`);
    return true;
  }

  /** Freeze the output resolution — window resize will no longer change it. */
  lock() {
    this._locked = true;
    console.log(`[Output] Locked at ${this._outW}×${this._outH}.`);
  }

  /** Release the lock — window resize will update the output resolution again. */
  unlock() {
    this._locked = false;
    console.log('[Output] Resolution lock released.');
  }

  /**
   * Forward window/canvas resize events here.
   * When unlocked, rebuilds the output FBO to match the new canvas size.
   *
   * @param {number} canvasW  — canvas.width  (device pixels)
   * @param {number} canvasH  — canvas.height
   * @returns {boolean}  true if the output FBO was rebuilt (callers must
   *                     rebuild their render FBOs to match output.width/height)
   */
  onCanvasResize(canvasW, canvasH) {
    this._canvasW = canvasW;
    this._canvasH = canvasH;

    if (!this._locked) {
      return this.setResolution(canvasW, canvasH);
    }
    // Locked — only recompute the letterbox mapping, not the FBO
    this._computeLetterbox();
    return false;
  }

  // ─── Per-frame API ─────────────────────────────────────────────────────────

  /**
   * Blit the output FBO to the screen canvas, letterboxed.
   *
   * Clears the full canvas to black first (the bars are always solid black).
   * Restores `gl.viewport` to the full canvas after drawing.
   *
   * Call AFTER all off-screen rendering and AFTER `readPixels()`.
   */
  present() {
    const gl = this._gl;
    const lb = this._lb;
    const { program, uniforms, attributes } = this._program;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Letterbox bars
    gl.viewport(0, 0, this._canvasW, this._canvasH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Letterboxed content area
    gl.viewport(lb.x, lb.y, lb.w, lb.h);

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._fbo.texture);
    gl.uniform1i(uniforms.u_frame, 0);

    this._drawQuad(attributes);

    gl.bindTexture(gl.TEXTURE_2D, null);

    // Restore full-canvas viewport for any subsequent screen-space passes
    gl.viewport(0, 0, this._canvasW, this._canvasH);
  }

  /**
   * Read pixels from the output FBO into `buf`.
   *
   * This is the clean Spout/Syphon path: `outW × outH` RGBA with no
   * letterbox bars and no UI overlay — exactly what the projection mapper
   * should receive.
   *
   * Allocate the buffer once:
   *   `const buf = new Uint8Array(output.width * output.height * 4);`
   *
   * @param {Uint8Array} buf
   */
  readPixels(buf) {
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo.fbo);
    gl.readPixels(0, 0, this._outW, this._outH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ─── Teardown ──────────────────────────────────────────────────────────────

  dispose() {
    const gl = this._gl;
    destroyFBO(gl, this._fbo);
    gl.deleteProgram(this._program.program);
    gl.deleteBuffer(this._vbo);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _computeLetterbox() {
    const scale = Math.min(this._canvasW / this._outW, this._canvasH / this._outH);
    const fw    = Math.round(this._outW * scale);
    const fh    = Math.round(this._outH * scale);
    this._lb = {
      x: Math.round((this._canvasW - fw) / 2),
      y: Math.round((this._canvasH - fh) / 2),
      w: fw,
      h: fh,
    };
  }

  _buildQuad() {
    const gl   = this._gl;
    const data = new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
       1,  1,  1, 1,
    ]);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vbo;
  }

  _drawQuad(attributes) {
    const gl     = this._gl;
    const posLoc = attributes.a_pos;
    const uvLoc  = attributes.a_uv;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    if (posLoc >= 0) { gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0); }
    if (uvLoc  >= 0) { gl.enableVertexAttribArray(uvLoc);  gl.vertexAttribPointer(uvLoc,  2, gl.FLOAT, false, 16, 8); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (posLoc >= 0) gl.disableVertexAttribArray(posLoc);
    if (uvLoc  >= 0) gl.disableVertexAttribArray(uvLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}
