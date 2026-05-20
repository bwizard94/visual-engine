import { createProgram } from '../gl/program.js';

// ─── Shaders ──────────────────────────────────────────────────────────────────

const CALIB_VERT = /* glsl */`
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying   vec2 v_uv;
  void main() {
    v_uv        = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

/**
 * GLSL ES 1.00 calibration fragment shader.
 *
 * Modes (composited in priority order — crosshair elements win over checker):
 *
 *  Checkerboard  (u_checker > 0.5)
 *    Alternating black/white tiles at u_checkSize px, 55 % opacity.
 *    Tiles are screen-pixel-aligned (uses gl_FragCoord directly).
 *
 *  Crosshair     (u_crosshair > 0.5)
 *    Priority (high → low):
 *      1. Center white dot  — 4 px radius.
 *      2. Full-span center cross  — cyan-green (#00ffaa), 2 px wide.
 *      3. Corner L-brackets — 5 % margin, 8 % arm, 2 px thick, cyan-green.
 *      4. Outer border  — 2 px inset, cyan-green at 55 % opacity.
 *      5. Rule-of-thirds — lines at 1/3 & 2/3, gray at 40 % opacity.
 *    Checkerboard is below all crosshair elements.
 *
 * `u_res` is the VIEWPORT size (lb.w × lb.h), not the output FBO size.
 * gl_FragCoord is always relative to the current viewport origin, so tile
 * alignment and px calculations are consistent with what's on screen.
 */
const CALIB_FRAG = /* glsl */`
  precision mediump float;

  uniform vec2  u_res;        // viewport size in pixels (letterbox w × h)
  uniform float u_crosshair;  // 1.0 = draw crosshair / grid layer
  uniform float u_checker;    // 1.0 = draw checkerboard layer
  uniform float u_checkSize;  // checkerboard tile width/height in pixels
  uniform float u_opacity;    // global opacity multiplier [0,1]

  void main() {
    // Pixel coords from bottom-left of current viewport (gl_FragCoord origin)
    vec2 px = gl_FragCoord.xy;
    // Normalised UV [0,1]
    vec2 uv = px / u_res;

    // Per-pixel line half-widths (2 physical pixels)
    float lx = 2.0 / u_res.x;
    float ly = 2.0 / u_res.y;

    vec4 color = vec4(0.0);

    // ── Layer 6 (lowest): Checkerboard ───────────────────────────────────────
    if (u_checker > 0.5) {
      float tx  = floor(px.x / u_checkSize);
      float ty  = floor(px.y / u_checkSize);
      float chk = mod(tx + ty, 2.0);   // 0.0 or 1.0
      float c   = (chk > 0.5) ? 1.0 : 0.0;
      color = vec4(c, c, c, 0.55 * u_opacity);
    }

    // ── Crosshair layers (5 → 1, each overwrites lower priority) ─────────────
    if (u_crosshair > 0.5) {
      vec3 cyan = vec3(0.0, 1.0, 0.667);   // #00ffaa
      vec3 gray = vec3(0.5);

      // ── Layer 5: Rule-of-thirds grid ────────────────────────────────────────
      {
        float v3a = 1.0 - step(lx, abs(uv.x - (1.0 / 3.0)));
        float v3b = 1.0 - step(lx, abs(uv.x - (2.0 / 3.0)));
        float h3a = 1.0 - step(ly, abs(uv.y - (1.0 / 3.0)));
        float h3b = 1.0 - step(ly, abs(uv.y - (2.0 / 3.0)));
        float hit = max(max(v3a, v3b), max(h3a, h3b));
        if (hit > 0.5) {
          color = vec4(gray, 0.4 * u_opacity);
        }
      }

      // ── Layer 4: Outer border (2 px inset) ──────────────────────────────────
      {
        float bx = 2.0 / u_res.x;
        float by = 2.0 / u_res.y;
        float hit = max(
          max(step(uv.x,       bx), step(1.0 - bx, uv.x)),
          max(step(uv.y,       by), step(1.0 - by, uv.y))
        );
        if (hit > 0.5) {
          color = vec4(cyan, 0.55 * u_opacity);
        }
      }

      // ── Layer 3: Corner L-brackets ──────────────────────────────────────────
      // 5 % margin from edge, 8 % arm length, 2 px thick — all in screen pixels.
      {
        float shortSide = min(u_res.x, u_res.y);
        float margin    = 0.05 * shortSide;
        float arm       = 0.08 * shortSide;
        float thick     = 2.0;

        float hit = 0.0;

        // ── Bottom-left ──────────────────────────────────────────────────────
        {
          float ox = margin;
          float oy = margin;
          // vertical arm: x ∈ [ox, ox+thick), y ∈ [oy, oy+arm)
          hit = max(hit, step(ox, px.x) * step(px.x, ox + thick)
                       * step(oy, px.y) * step(px.y, oy + arm));
          // horizontal arm: x ∈ [ox, ox+arm), y ∈ [oy, oy+thick)
          hit = max(hit, step(ox, px.x) * step(px.x, ox + arm)
                       * step(oy, px.y) * step(px.y, oy + thick));
        }

        // ── Bottom-right ─────────────────────────────────────────────────────
        {
          float ox = u_res.x - margin;
          float oy = margin;
          // vertical arm: x ∈ [ox-thick, ox), y ∈ [oy, oy+arm)
          hit = max(hit, step(ox - thick, px.x) * step(px.x, ox)
                       * step(oy,         px.y) * step(px.y, oy + arm));
          // horizontal arm: x ∈ [ox-arm, ox), y ∈ [oy, oy+thick)
          hit = max(hit, step(ox - arm,   px.x) * step(px.x, ox)
                       * step(oy,         px.y) * step(px.y, oy + thick));
        }

        // ── Top-right ────────────────────────────────────────────────────────
        {
          float ox = u_res.x - margin;
          float oy = u_res.y - margin;
          // vertical arm: x ∈ [ox-thick, ox), y ∈ [oy-arm, oy)
          hit = max(hit, step(ox - thick, px.x) * step(px.x, ox)
                       * step(oy - arm,   px.y) * step(px.y, oy));
          // horizontal arm: x ∈ [ox-arm, ox), y ∈ [oy-thick, oy)
          hit = max(hit, step(ox - arm,   px.x) * step(px.x, ox)
                       * step(oy - thick, px.y) * step(px.y, oy));
        }

        // ── Top-left ─────────────────────────────────────────────────────────
        {
          float ox = margin;
          float oy = u_res.y - margin;
          // vertical arm: x ∈ [ox, ox+thick), y ∈ [oy-arm, oy)
          hit = max(hit, step(ox,         px.x) * step(px.x, ox + thick)
                       * step(oy - arm,   px.y) * step(px.y, oy));
          // horizontal arm: x ∈ [ox, ox+arm), y ∈ [oy-thick, oy)
          hit = max(hit, step(ox,         px.x) * step(px.x, ox + arm)
                       * step(oy - thick, px.y) * step(px.y, oy));
        }

        if (hit > 0.5) {
          color = vec4(cyan, u_opacity);
        }
      }

      // ── Layer 2: Full-span center cross ─────────────────────────────────────
      {
        float onH = 1.0 - step(ly, abs(uv.y - 0.5));
        float onV = 1.0 - step(lx, abs(uv.x - 0.5));
        if (max(onH, onV) > 0.5) {
          color = vec4(cyan, u_opacity);
        }
      }

      // ── Layer 1 (highest): Center white dot, 4 px radius ────────────────────
      {
        vec2 pxOffset = px - (u_res * 0.5);
        if (length(pxOffset) < 4.0) {
          color = vec4(1.0, 1.0, 1.0, u_opacity);
        }
      }
    }

    gl_FragColor = color;
  }
`;

// ─── CalibrationOverlay ───────────────────────────────────────────────────────

/**
 * Renders a calibration overlay to the screen canvas letterbox area —
 * NEVER into the output FBO.
 *
 * Call `draw(output.letterbox)` AFTER `output.present()`.
 * The overlay is composited over the scene via alpha blending, so the
 * scene remains visible through transparent regions.
 *
 * Keyboard shortcuts wired in main.js:
 *   C — toggle crosshair/grid
 *   B — toggle checkerboard
 *
 * Console API:
 *   engine.calibration.toggleCrosshair()
 *   engine.calibration.toggleCheckerboard()
 *   engine.calibration.setCheckSize(64)
 *   engine.calibration.setOpacity(0.8)
 */
export class CalibrationOverlay {
  /** @param {WebGLRenderingContext} gl */
  constructor(gl) {
    this._gl = gl;

    this._showCrosshair = false;
    this._showChecker   = false;
    this._checkSize     = 32;
    this._opacity       = 1.0;

    this._program = createProgram(gl, CALIB_VERT, CALIB_FRAG,
      ['u_res', 'u_crosshair', 'u_checker', 'u_checkSize', 'u_opacity'],
      ['a_pos', 'a_uv']);
    this._vbo = this._buildQuad();
  }

  // ─── Controls ──────────────────────────────────────────────────────────────

  /** Toggle crosshair + grid layer. Returns new state. */
  toggleCrosshair() {
    this._showCrosshair = !this._showCrosshair;
    return this._showCrosshair;
  }

  /** Toggle checkerboard layer. Returns new state. */
  toggleCheckerboard() {
    this._showChecker = !this._showChecker;
    return this._showChecker;
  }

  /**
   * Set checkerboard tile size.
   * @param {number} px — tile width/height in screen pixels (min 1)
   */
  setCheckSize(px) { this._checkSize = Math.max(1, px); }

  /**
   * Global opacity for both layers.
   * @param {number} v — [0, 1]
   */
  setOpacity(v) { this._opacity = Math.max(0, Math.min(1, v)); }

  /** True when at least one overlay layer is enabled. */
  get isVisible() { return this._showCrosshair || this._showChecker; }
  get crosshairEnabled()  { return this._showCrosshair; }
  get checkerEnabled()    { return this._showChecker; }

  // ─── Per-frame ─────────────────────────────────────────────────────────────

  /**
   * Draw the calibration overlay into the letterbox region of the screen.
   * Must be called AFTER `OutputManager.present()`.
   *
   * @param {{ x:number, y:number, w:number, h:number }} lb
   *   From `OutputManager.letterbox` — bottom-left origin, screen pixels.
   */
  draw(lb) {
    if (!this.isVisible) return;

    const gl = this._gl;
    const { program, uniforms, attributes } = this._program;

    // Draw into letterboxed area only (matches the present pass viewport)
    gl.viewport(lb.x, lb.y, lb.w, lb.h);

    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(program);
    gl.uniform2f(uniforms.u_res,       lb.w, lb.h);
    gl.uniform1f(uniforms.u_crosshair, this._showCrosshair ? 1.0 : 0.0);
    gl.uniform1f(uniforms.u_checker,   this._showChecker   ? 1.0 : 0.0);
    gl.uniform1f(uniforms.u_checkSize, this._checkSize);
    gl.uniform1f(uniforms.u_opacity,   this._opacity);

    const posLoc = attributes.a_pos;
    const uvLoc  = attributes.a_uv;

    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    if (posLoc >= 0) { gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0); }
    if (uvLoc  >= 0) { gl.enableVertexAttribArray(uvLoc);  gl.vertexAttribPointer(uvLoc,  2, gl.FLOAT, false, 16, 8); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (posLoc >= 0) gl.disableVertexAttribArray(posLoc);
    if (uvLoc  >= 0) gl.disableVertexAttribArray(uvLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.disable(gl.BLEND);
  }

  // ─── Teardown ──────────────────────────────────────────────────────────────

  dispose() {
    this._gl.deleteProgram(this._program.program);
    this._gl.deleteBuffer(this._vbo);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _buildQuad() {
    const gl  = this._gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
       1,  1,  1, 1,
    ]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vbo;
  }
}
