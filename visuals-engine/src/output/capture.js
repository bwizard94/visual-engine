/**
 * CanvasCapture — multi-target output for VJ performance
 *
 * ── Browser targets (available now, no extra software) ──────────────────────
 *   Stream    : canvas.captureStream(fps) → MediaStream
 *               → Feed to OBS Browser Source + Virtual Camera
 *               → Feed to any WebRTC peer (streaming / multi-display)
 *   Record    : MediaRecorder → WebM/VP9 file download
 *
 * ── Desktop integration targets (require Electron host) ─────────────────────
 *   Spout     : Windows GPU texture sharing  (see SpoutSender stub below)
 *               npm: spout-sender / spout2
 *   Syphon    : macOS GPU texture sharing    (see SyphonServer stub below)
 *               npm: node-syphon / syphon-framework
 *
 * ── OBS integration via Browser source ──────────────────────────────────────
 *   1. In OBS: Sources → + → Browser Source → URL: http://localhost:<port>
 *   2. Enable OBS Virtual Camera (Tools → Start Virtual Camera)
 *   3. Select "OBS Virtual Camera" in your VJ app / video mixer
 *   No code changes needed — OBS renders the page at its native frame rate.
 *
 * ── Spout / Syphon quickstart (Electron) ────────────────────────────────────
 *   1. Scaffold an Electron project wrapping this web app
 *   2. npm install spout-sender   (Windows) or node-syphon (macOS)
 *   3. In the Electron main process, call SpoutSender.fromCanvas(webContents)
 *      or SyphonServer.fromCanvas(webContents)
 *   4. The GPU texture is shared directly — zero-copy, no JPEG/WebM encoding
 *
 * Usage (browser)
 * ────────────────
 *   const capture = new CanvasCapture(canvas);
 *   const stream  = capture.start(60);  // returns MediaStream
 *   capture.startRecording();
 *   capture.stopRecording();
 *   capture.downloadRecording('my-set');
 *   capture.stop();
 */
export class CanvasCapture {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {WebGLRenderingContext} [gl]  — optional; required for Spout/Syphon pixel readback
   */
  constructor(canvas, gl = null) {
    this._canvas    = canvas;
    this._gl        = gl;

    /** @type {MediaStream|null} */
    this._stream    = null;
    /** @type {MediaRecorder|null} */
    this._recorder  = null;
    /** @type {Blob[]} */
    this._chunks    = [];
    /** @type {Blob|null} */
    this._lastBlob  = null;

    // Pre-allocated readback buffer — avoids GC in the hot path.
    // Resized lazily in sendElectronFrame() when canvas dimensions change.
    this._pixelBuf  = null;
    this._pixelW    = 0;
    this._pixelH    = 0;

    /** 'spout' | 'syphon' | null — set by startElectronOutput() */
    this._electronTarget = null;
  }

  // ─── Stream (OBS / WebRTC) ────────────────────────────────────────────────

  /**
   * Start capturing the canvas at the given frame rate.
   * Returns the MediaStream — pass it to RTCPeerConnection, a <video> element,
   * or leave it for OBS to consume via Browser Source.
   *
   * @param {number} [fps=60]
   * @returns {MediaStream}
   */
  start(fps = 60) {
    if (this._stream) return this._stream;

    if (typeof this._canvas.captureStream !== 'function') {
      throw new Error('[Capture] canvas.captureStream() is not supported in this browser.');
    }

    this._stream = this._canvas.captureStream(fps);
    console.log(`[Capture] Stream started at ${fps}fps.`);
    console.log('[Capture] To use with OBS: add a Browser Source pointing to this page,');
    console.log('[Capture] then enable OBS Virtual Camera (Tools → Start Virtual Camera).');
    return this._stream;
  }

  /** Stop and release the capture stream. */
  stop() {
    if (!this._stream) return;
    for (const track of this._stream.getTracks()) track.stop();
    this._stream = null;
    console.log('[Capture] Stream stopped.');
  }

  get isStreaming() { return this._stream !== null; }

  // ─── Recording (WebM file) ────────────────────────────────────────────────

  /**
   * Start recording to a WebM/VP9 blob in memory.
   * Automatically starts the capture stream if not already running.
   *
   * @param {object} [opts]
   * @param {string} [opts.mimeType='video/webm;codecs=vp9']
   * @param {number} [opts.videoBitsPerSecond=8_000_000]  8 Mbps default
   */
  startRecording({ mimeType = 'video/webm;codecs=vp9', videoBitsPerSecond = 8_000_000 } = {}) {
    if (this._recorder) {
      console.warn('[Capture] Already recording.');
      return;
    }

    // Ensure stream is live
    if (!this._stream) this.start();

    // Fallback mime type for Firefox (no VP9 encoder by default)
    const useMime = MediaRecorder.isTypeSupported(mimeType)
      ? mimeType
      : 'video/webm';

    this._chunks  = [];
    this._lastBlob = null;
    this._recorder = new MediaRecorder(this._stream, { mimeType: useMime, videoBitsPerSecond });

    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };

    this._recorder.onstop = () => {
      this._lastBlob   = new Blob(this._chunks, { type: useMime });
      this._recorder   = null;
      console.log(`[Capture] Recording complete. Size: ${(this._lastBlob.size / 1e6).toFixed(1)} MB`);
    };

    this._recorder.start(100); // collect a chunk every 100 ms
    console.log(`[Capture] Recording started (${useMime}, ${videoBitsPerSecond / 1e6} Mbps).`);
  }

  /** Stop recording. The blob is then available via downloadRecording(). */
  stopRecording() {
    if (!this._recorder) return;
    this._recorder.stop();
  }

  get isRecording() { return this._recorder !== null && this._recorder.state === 'recording'; }

  /**
   * Trigger a browser download of the last completed recording.
   * @param {string} [filename='visuals-engine']
   */
  downloadRecording(filename = 'visuals-engine') {
    if (!this._lastBlob) {
      console.warn('[Capture] No recording available. Call stopRecording() first.');
      return;
    }
    const url = URL.createObjectURL(this._lastBlob);
    const a   = Object.assign(document.createElement('a'), {
      href:     url,
      download: `${filename}-${_timestamp()}.webm`,
    });
    a.click();
    URL.revokeObjectURL(url);
    console.log(`[Capture] Downloaded "${a.download}".`);
  }

  // ─── Electron GPU texture output (Spout / Syphon) ────────────────────────

  /**
   * Enable Spout (Windows) or Syphon (macOS) output via Electron IPC.
   *
   * Call once after construction. Then call sendElectronFrame() once per
   * animation frame AFTER all gl.drawArrays/drawElements calls complete.
   *
   * Requires:
   *   - Running inside the Electron host (electron/main.js)
   *   - window.electronBridge exposed by preload.js
   *   - gl passed to the CanvasCapture constructor
   *   - spout2 (Windows) or node-syphon (macOS) installed and uncommented in main.js
   *
   * @param {'spout'|'syphon'} target
   */
  startElectronOutput(target = 'syphon') {
    if (!window.electronBridge) {
      console.warn('[Capture] window.electronBridge not found — are you running inside Electron?');
      return;
    }
    if (!this._gl) {
      console.warn('[Capture] Pass the WebGL context to CanvasCapture(canvas, gl) to use Electron output.');
      return;
    }
    this._electronTarget = target;
    console.log(`[Capture] Electron ${target} output armed. Call sendElectronFrame() each frame.`);
  }

  stopElectronOutput() {
    this._electronTarget = null;
  }

  /**
   * Read back a clean frame from the OutputManager's locked FBO and ship it
   * to Spout/Syphon via Electron IPC.
   *
   * The readback comes from the output FBO BEFORE the present pass, so:
   *   ✓ Clean locked resolution (e.g. 1920×1080) — no letterbox bars
   *   ✓ No calibration overlay (drawn after this call)
   *   ✓ No UI elements
   *
   * Performance: gl.readPixels() stalls the GPU pipeline ~0.5–1.5 ms at
   * 1080p on a dedicated GPU. Call once per frame after all off-screen passes.
   *
   * @param {import('./outputManager.js').OutputManager} output
   *   Pass the OutputManager so readback uses its locked FBO, not the canvas.
   */
  sendElectronFrame(output) {
    if (!this._electronTarget || !window.electronBridge) return;

    const w = output.width;
    const h = output.height;

    // Resize pre-allocated buffer lazily when output resolution changes
    if (this._pixelW !== w || this._pixelH !== h) {
      this._pixelBuf = new Uint8Array(w * h * 4);
      this._pixelW   = w;
      this._pixelH   = h;
    }

    // Read from the clean output FBO (not the screen canvas)
    output.readPixels(this._pixelBuf);

    window.electronBridge.sendFrame(this._pixelBuf, w, h, this._electronTarget);
  }

  get isElectronOutputActive() { return this._electronTarget !== null; }

  // ─── Spout (Windows, Electron only) ──────────────────────────────────────

  /**
   * STUB — Spout sender for Windows desktop integration.
   *
   * Spout shares GPU textures between applications with zero CPU copies.
   * Requires running inside an Electron host with the `spout-sender` native
   * module installed (`npm install spout-sender` in the Electron main package).
   *
   * Electron main process (main.js):
   * ─────────────────────────────────
   *   const { SpoutSender } = require('spout-sender');
   *   // After the BrowserWindow is created and the WebGL page is loaded:
   *   const sender = new SpoutSender('VisualsEngine');
   *   // Share the offscreen texture every frame via IPC:
   *   ipcMain.on('spout-frame', (_, textureHandle) => {
   *     sender.sendTexture(textureHandle, width, height);
   *   });
   *
   * Electron renderer (this file, called from main.js):
   * ──────────────────────────────────────────────────
   *   const { ipcRenderer } = require('electron');
   *   // After each gl.drawArrays() call, grab the texture handle and IPC it:
   *   const ext = gl.getExtension('ANGLE_instanced_arrays'); // or similar
   *   ipcRenderer.send('spout-frame', gl.getParameter(gl.FRAMEBUFFER_BINDING));
   *
   * Receiving end (e.g. Resolume Avenue, MadMapper, Touchdesigner):
   *   → Add a Spout Receiver with name "VisualsEngine"
   *
   * @throws {Error} Always — call only from Electron renderer process with spout-sender installed.
   */
  static initSpout() {
    throw new Error(
      '[Capture] Spout requires Electron + spout-sender.\n' +
      'See the JSDoc above for the wiring instructions.'
    );
  }

  // ─── Syphon (macOS, Electron only) ───────────────────────────────────────

  /**
   * STUB — Syphon server for macOS desktop integration.
   *
   * Syphon shares GPU textures between macOS applications (zero-copy, IOSurface).
   * Requires an Electron host with a Syphon Objective-C bridge.
   * Community option: https://github.com/benoitlahoz/node-syphon
   *
   * Electron main process (main.js):
   * ─────────────────────────────────
   *   const SyphonServer = require('node-syphon').SyphonServer;
   *   const server = new SyphonServer('VisualsEngine');
   *   ipcMain.on('syphon-frame', (_, ioSurfaceId) => {
   *     server.publishFrameSurface(ioSurfaceId, { width, height });
   *   });
   *
   * Electron renderer (this file):
   * ─────────────────────────────
   *   const { ipcRenderer } = require('electron');
   *   // WebGL → IOSurface bridge requires ANGLE's EGL surface export,
   *   // available via Electron's --enable-features=UseSkiaRenderer flag.
   *   ipcRenderer.send('syphon-frame', gl.getParameter(/* IOSurface id * /));
   *
   * Receiving end: VDMX5, Resolume, CoGe, MadMapper, Quartz Composer
   *   → Add a Syphon input and select "VisualsEngine"
   *
   * @throws {Error} Always — call only from Electron renderer on macOS with node-syphon installed.
   */
  static initSyphon() {
    throw new Error(
      '[Capture] Syphon requires Electron + node-syphon on macOS.\n' +
      'See the JSDoc above for the wiring instructions.'
    );
  }
}

function _timestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join('-');
}
