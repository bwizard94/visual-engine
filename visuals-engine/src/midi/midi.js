/**
 * MidiInput
 *
 * Thin wrapper around the Web MIDI API. Listens to ALL connected inputs and
 * fires registered callbacks for every Control Change (CC) message received.
 *
 * Automatically handles hot-plug: controllers connected after `connect()` is
 * called are attached without any extra work from the caller.
 *
 * Usage:
 *   const midi = new MidiInput();
 *   await midi.connect();
 *   const unsub = midi.onCC((cc, value, channel) => { ... });
 *   // later:
 *   unsub();          // remove that specific listener
 *   midi.dispose();   // tear down everything
 */
export class MidiInput {
  constructor() {
    /** @type {MIDIAccess|null} */
    this._access    = null;
    /** @type {Set<Function>} */
    this._listeners = new Set();
    this._connected = false;
  }

  /**
   * Request MIDI access and attach to all current inputs.
   * Safe to call multiple times — subsequent calls are no-ops.
   * Returns false (instead of throwing) when the API is unavailable,
   * so the rest of the engine keeps running without MIDI.
   *
   * @returns {Promise<boolean>}
   */
  async connect() {
    if (this._connected) return true;

    if (!navigator.requestMIDIAccess) {
      console.warn('[MIDI] Web MIDI API not available in this browser.');
      return false;
    }

    try {
      this._access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      console.warn('[MIDI] Access denied:', err.message);
      return false;
    }

    // Attach to all inputs that are already connected
    for (const input of this._access.inputs.values()) {
      this._attachPort(input);
    }

    // Hot-plug: attach to inputs that connect later
    this._access.onstatechange = (event) => {
      const port = event.port;
      if (port.type !== 'input') return;
      if (port.state === 'connected') {
        this._attachPort(port);
        console.log(`[MIDI] Device connected: "${port.name}"`);
      }
      if (port.state === 'disconnected') {
        console.log(`[MIDI] Device disconnected: "${port.name}"`);
      }
    };

    const names = [...this._access.inputs.values()].map(i => `"${i.name}"`);
    console.log(`[MIDI] Ready. Inputs: ${names.length ? names.join(', ') : 'none detected'}`);
    this._connected = true;
    return true;
  }

  /**
   * Register a callback for all incoming CC messages.
   *
   * @param {(cc: number, value: number, channel: number) => void} fn
   *   cc      — MIDI CC number (0–127)
   *   value   — raw value (0–127)
   *   channel — MIDI channel (0–15, zero-indexed)
   * @returns {() => void}  Call the returned function to unsubscribe.
   */
  onCC(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  get isConnected() { return this._connected; }

  /** Detach all MIDI message handlers. */
  dispose() {
    if (this._access) {
      for (const input of this._access.inputs.values()) {
        input.onmidimessage = null;
      }
    }
    this._listeners.clear();
    this._connected = false;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  _attachPort(input) {
    input.onmidimessage = (event) => {
      const [status, data1, data2] = event.data;
      const type = status & 0xF0;
      if (type !== 0xB0) return; // Only CC messages (ignore note on/off, pitch, etc.)
      const channel = status & 0x0F;
      for (const fn of this._listeners) fn(data1, data2, channel);
    };
  }
}
