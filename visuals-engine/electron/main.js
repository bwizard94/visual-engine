/**
 * Electron main process — visuals-engine host.
 *
 * Run with:
 *   npx electron electron/main.js
 *   (or "start": "electron electron/main.js" in package.json)
 *
 * ── Spout (Windows) ──────────────────────────────────────────────────────────
 *   npm install spout2
 *   Uncomment the Spout section below.
 *
 * ── Syphon (macOS) ───────────────────────────────────────────────────────────
 *   npm install node-syphon
 *   Uncomment the Syphon section below.
 *
 * ── Latency best practices ───────────────────────────────────────────────────
 *   - Use offscreen rendering (webPreferences.offscreen: true) only if you
 *     need pixel access without a visible window. It adds ~1 frame of copy
 *     latency but removes the display dependency.
 *   - For a live performance window, keep offscreen: false. The canvas
 *     renders directly to the screen; pixel readback is the only overhead.
 *   - frameRate cap: set to your target fps (60 or 120) to avoid excess wakes.
 *   - powerPreference: 'high-performance' is already set in src/main.js.
 *   - --disable-frame-rate-limit flag (see app.commandLine below) unlocks
 *     Chromium's renderer above 60fps on capable hardware.
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// ── Optional: unlock renderer frame rate above 60fps ────────────────────────
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

// ── Optional: Spout (Windows only) ──────────────────────────────────────────
// let spoutSender;
// const { SpoutSender } = require('spout2');

// ── Optional: Syphon (macOS only) ───────────────────────────────────────────
// let syphonServer;
// const SyphonServer = require('node-syphon').default;

// ─────────────────────────────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    fullscreen:      true,
    backgroundColor: '#000000',
    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      // offscreen: false  — renders to screen directly (lowest latency)
      // Set to true only if you need headless pixel access (Spout/Syphon
      // via readPixels) without a visible window.
    },
  });

  // Load the app — serve via a local HTTP server for correct MIME types
  // (ES modules require http:// not file://  when using fetch())
  // Simple option: use 'serve' or 'http-server':
  //   npx serve . -l 3000
  //   then load 'http://localhost:3000'
  //
  // Or use Electron's custom protocol to serve from disk:
  mainWindow.loadURL('http://localhost:3000');

  // Remove menu bar in production
  mainWindow.setMenuBarVisibility(false);

  // ── Spout setup ────────────────────────────────────────────────────────
  // Uncomment to enable Spout output (Windows only):
  //
  // spoutSender = new SpoutSender();
  // spoutSender.CreateSender('VisualsEngine', width, height, 0);
  // console.log('[Spout] Sender "VisualsEngine" created.');
  //
  // ipcMain.on('spout-frame', (_event, { buffer, width: w, height: h }) => {
  //   // buffer is a Uint8Array (RGBA, width × height) from gl.readPixels
  //   spoutSender.SendImage(Buffer.from(buffer), w, h, 0x1908 /* GL_RGBA */);
  // });

  // ── Syphon setup ───────────────────────────────────────────────────────
  // Uncomment to enable Syphon output (macOS only):
  //
  // syphonServer = new SyphonServer('VisualsEngine');
  // console.log('[Syphon] Server "VisualsEngine" started.');
  //
  // ipcMain.on('syphon-frame', (_event, { buffer, width: w, height: h }) => {
  //   // Syphon requires an IOSurface or Metal texture. For a pure-JS bridge,
  //   // pixel readback via readPixels + publishPixels is the simplest path:
  //   syphonServer.publishPixels(Buffer.from(buffer), w, h);
  // });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Spout / Syphon cleanup
  // spoutSender?.ReleaseSender();
  // syphonServer?.stop();

  if (process.platform !== 'darwin') app.quit();
});
