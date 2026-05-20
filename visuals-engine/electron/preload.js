/**
 * preload.js — contextBridge API surface.
 *
 * Exposes a minimal `window.electronBridge` object to the renderer so the
 * WebGL canvas can send frames to Spout/Syphon without direct Node access.
 *
 * Security model:
 *   - contextIsolation: true (enforced in main.js webPreferences)
 *   - Only the sendFrame channel is exposed — no arbitrary IPC
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBridge', {
  /**
   * Send a raw RGBA pixel buffer to the main process for Spout/Syphon.
   *
   * Call this from your render loop (see src/capture.js or src/main.js).
   * Recommended: call at most once per animation frame — the readPixels call
   * is the bottleneck, not the IPC transfer.
   *
   * @param {Uint8Array} buffer  — RGBA pixel data from gl.readPixels()
   * @param {number}     width
   * @param {number}     height
   * @param {'spout'|'syphon'} target
   */
  sendFrame(buffer, width, height, target = 'syphon') {
    // Transferring a SharedArrayBuffer would be zero-copy but requires COOP/COEP
    // headers. A regular ArrayBuffer copy via IPC is ~1ms for 1080p RGBA — fast
    // enough for 60fps output.
    ipcRenderer.send(`${target}-frame`, { buffer, width, height });
  },

  /** True when running inside Electron (useful for conditional code paths). */
  isElectron: true,
});
