import { BANDS } from './bands.js';

/**
 * AudioAnalyser
 *
 * Wraps Web Audio API's AnalyserNode, runs FFT each frame,
 * and returns 8 normalized band values ready to upload as shader uniforms.
 *
 * Usage:
 *   const audio = new AudioAnalyser();
 *   await audio.connectMic();           // or audio.connect(mediaStream)
 *   // inside render loop:
 *   const bands = audio.getBands();     // Float32Array(8), values 0.0–1.0
 */
export class AudioAnalyser {
  /**
   * @param {object}  [opts]
   * @param {number}  [opts.fftSize=2048]          - Must be power of 2, 32–32768
   * @param {number}  [opts.smoothing=0.8]          - AnalyserNode smoothingTimeConstant
   * @param {number}  [opts.minDecibels=-90]        - Floor for 0.0 mapping
   * @param {number}  [opts.maxDecibels=-10]        - Ceiling for 1.0 mapping
   * @param {number}  [opts.bandSmoothing=0.75]     - Per-band EMA smoothing (0 = off, <1 = smooth)
   * @param {number}  [opts.fluxSmoothing=0.6]      - EMA smoothing applied to spectral flux output
   * @param {number}  [opts.fluxScale=10]            - Multiplier applied before clamping flux to [0,1].
   *                                                   Increase if your source is quiet; decrease if it saturates.
   */
  constructor(opts = {}) {
    this._fftSize        = opts.fftSize        ?? 2048;
    this._smoothing      = opts.smoothing      ?? 0.80;
    this._minDb          = opts.minDecibels    ?? -90;
    this._maxDb          = opts.maxDecibels    ?? -10;
    this._bandSmoothing  = opts.bandSmoothing  ?? 0.75;
    this._fluxSmoothing  = opts.fluxSmoothing  ?? 0.60;
    this._fluxScale      = opts.fluxScale      ?? 10.0;

    /** @type {AudioContext|null} */
    this._ctx     = null;
    /** @type {AnalyserNode|null} */
    this._node    = null;
    /** @type {MediaStreamAudioSourceNode|null} */
    this._source  = null;

    // Pre-allocated read buffer — filled by getByteFrequencyData each frame.
    // Uint8Array matches the API's native output (0–255), zero GC cost per frame.
    this._dataArray = null;

    // Pre-computed bin index ranges for each band (set at connect time).
    // Shape: [{ lo: number, hi: number }, ...]  (inclusive bin indices)
    this._binRanges = null;

    // Output buffer — reused every frame, handed directly to the caller.
    this._bands = new Float32Array(BANDS.length);

    // Per-band EMA state for additional smoothing on top of AnalyserNode's built-in.
    this._smoothed = new Float32Array(BANDS.length);

    // Spectral flux state — allocated at connect() time when binCount is known.
    this._prevData     = null;  // previous frame's FFT snapshot (Uint8Array)
    this._spectralFlux = 0;     // current smoothed flux value [0, 1]

    this._connected = false;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Convenience: request microphone and connect. */
  async connectMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    await this.connect(stream);
  }

  /**
   * Connect to a MediaStream (mic, line-in, or any Web Audio MediaStream).
   * Also accepts an AudioNode directly if you want to tap an existing graph.
   *
   * @param {MediaStream|AudioNode} source
   */
  async connect(source) {
    if (this._connected) this.dispose();

    this._ctx  = new AudioContext();

    this._node = this._ctx.createAnalyser();
    this._node.fftSize              = this._fftSize;
    this._node.smoothingTimeConstant = this._smoothing;
    this._node.minDecibels          = this._minDb;
    this._node.maxDecibels          = this._maxDb;

    if (source instanceof MediaStream) {
      this._source = this._ctx.createMediaStreamSource(source);
      this._source.connect(this._node);
    } else {
      // Treat as an AudioNode
      source.connect(this._node);
    }

    // Resume context — required after a user gesture on most browsers
    if (this._ctx.state === 'suspended') await this._ctx.resume();

    const binCount = this._node.frequencyBinCount; // fftSize / 2
    this._dataArray = new Uint8Array(binCount);
    this._prevData  = new Uint8Array(binCount); // starts as silence (all zeros)

    this._binRanges = this._computeBinRanges(this._ctx.sampleRate, binCount);
    this._connected = true;
  }

  /**
   * Read the current spectrum and return 8 normalized band values.
   * Call this once per render frame — it writes into the same Float32Array
   * each call (no allocation).
   *
   * @returns {Float32Array} length-8 array, values clamped to [0.0, 1.0]
   */
  getBands() {
    if (!this._connected) return this._bands; // returns zeroes before connect

    this._node.getByteFrequencyData(this._dataArray);

    // Spectral flux: computed from this snapshot vs. the previous frame's snapshot,
    // then the current snapshot is saved for next frame.
    this._updateFlux();
    this._prevData.set(this._dataArray);

    const data = this._dataArray;
    const a    = this._bandSmoothing;

    for (let i = 0; i < BANDS.length; i++) {
      const { lo, hi } = this._binRanges[i];
      const raw = this._averageBins(data, lo, hi);

      // Per-band exponential moving average on top of the analyser's built-in:
      //   smoothed = a * previous + (1 - a) * current
      this._smoothed[i] = a * this._smoothed[i] + (1 - a) * raw;
      this._bands[i]    = this._smoothed[i];
    }

    return this._bands;
  }

  /** True once connect() or connectMic() has resolved. */
  get isConnected() { return this._connected; }

  /** Release all Web Audio resources. */
  dispose() {
    this._source?.disconnect();
    this._node?.disconnect();
    this._ctx?.close();
    this._source    = null;
    this._node      = null;
    this._ctx       = null;
    this._connected = false;
  }

  /**
   * Returns the most recently computed spectral flux value.
   *
   * Spectral flux measures the rate of change of the frequency spectrum between
   * consecutive frames — in musical terms, it spikes on transients, beat hits,
   * and sudden timbral shifts, then decays during sustained or silent passages.
   *
   * Value is in [0.0, 1.0].  Call getBands() first each frame; this method
   * returns the cached value computed during that call.
   *
   * @returns {number}
   */
  getSpectralFlux() {
    return this._spectralFlux;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Compute spectral flux from the current vs. previous FFT snapshot and update
   * the smoothed `_spectralFlux` value.
   *
   * Algorithm — half-wave rectified flux:
   *   For each bin k:  diff = max(0, current[k] - previous[k])
   *   flux_raw = sum(diff) / (binCount × 255)   → range [0, ~0.1] for typical audio
   *   flux_scaled = flux_raw × fluxScale         → rescaled so normal music ≈ 0.3–0.8
   *   flux_smoothed = EMA(flux_scaled, α)        → temporally smoothed
   *
   * Half-wave rectification (ignoring energy decreases) focuses the measurement
   * on *onsets* — moments where new energy appears — which is exactly what
   * creates the perceptible "change" in a mix.
   */
  _updateFlux() {
    const curr = this._dataArray;
    const prev = this._prevData;
    const n    = curr.length;
    let   sum  = 0;

    for (let i = 0; i < n; i++) {
      const diff = curr[i] - prev[i];
      if (diff > 0) sum += diff; // only increases count (half-wave rectification)
    }

    // Normalize to [0, 1]: divide by theoretical maximum then scale to useful range.
    const raw    = Math.min(1.0, (sum / (n * 255)) * this._fluxScale);
    const alpha  = this._fluxSmoothing;
    this._spectralFlux = alpha * this._spectralFlux + (1 - alpha) * raw;
  }

  /**
   * Pre-compute the FFT bin index range for each frequency band.
   * Runs once at connect — zero cost at runtime.
   *
   * Bin i corresponds to frequency:  f = i * sampleRate / fftSize
   * Inverse:                         i = f * fftSize / sampleRate
   *
   * We clamp to [0, binCount-1] and guarantee lo <= hi so
   * very-high-frequency bands don't go out of bounds on low sample rates.
   */
  _computeBinRanges(sampleRate, binCount) {
    const fftSize = this._fftSize;
    return BANDS.map(({ lo, hi }) => {
      const loBin = Math.max(0,           Math.floor(lo * fftSize / sampleRate));
      const hiBin = Math.min(binCount - 1, Math.floor(hi * fftSize / sampleRate));
      return { lo: loBin, hi: Math.max(loBin, hiBin) };
    });
  }

  /**
   * Average the Uint8Array values in [loBin, hiBin] and normalize to [0, 1].
   * getByteFrequencyData already maps [minDecibels, maxDecibels] → [0, 255],
   * so we just divide by 255.
   *
   * @param {Uint8Array} data
   * @param {number}     lo   inclusive start bin
   * @param {number}     hi   inclusive end bin
   * @returns {number}        0.0 – 1.0
   */
  _averageBins(data, lo, hi) {
    let sum   = 0;
    const len = hi - lo + 1;
    for (let i = lo; i <= hi; i++) sum += data[i];
    return (sum / len) / 255;
  }
}
