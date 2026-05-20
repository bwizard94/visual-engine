/**
 * The 8 frequency band definitions used by the analyser.
 *
 * Ranges follow standard audio-engineering conventions.
 * Edit lo/hi (Hz) here to retune how the spectrum is sliced —
 * the analyser pre-computes bin indices at connect time so
 * runtime cost is zero.
 *
 * @type {Array<{ name: string, lo: number, hi: number }>}
 */
export const BANDS = [
  { name: 'sub',      lo:    20, hi:    60 },  // 0 — rumble, kick body
  { name: 'bass',     lo:    60, hi:   250 },  // 1 — bass guitar, kick punch
  { name: 'lowMid',   lo:   250, hi:   500 },  // 2 — warmth, lower vocals
  { name: 'mid',      lo:   500, hi:  2000 },  // 3 — core melody, snare
  { name: 'highMid',  lo:  2000, hi:  4000 },  // 4 — upper harmonics, attack
  { name: 'high',     lo:  4000, hi:  8000 },  // 5 — cymbals, hi-hats
  { name: 'presence', lo:  8000, hi: 12000 },  // 6 — brightness, sibilance
  { name: 'air',      lo: 12000, hi: 20000 },  // 7 — shimmer, sparkle
];
