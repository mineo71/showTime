// Click and keystroke sounds, synthesized so the package ships no audio files.
import type { SoundPack } from '../script/schema';

/** Small deterministic PRNG (mulberry32), so every render sounds the same. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Voice {
  ms: number;
  seed: number;
  /** level of the filtered noise burst (1 = the 0.4 sound) */
  noise?: number;
  noiseDecayMs: number;
  tone: number;
  /** the tone glides to this frequency over the sound (a pop) */
  toneEnd?: number;
  toneDecayMs: number;
  thump: number;
  /** a second, quieter transient this long after the first (a key's spring) */
  echoMs?: number;
  echoGain?: number;
  peak: number;
}

function synth(rate: number, v: Voice): Float32Array {
  const n = Math.round((v.ms / 1000) * rate);
  const out = new Float32Array(n);
  const rand = prng(v.seed);
  const fade = Math.round(0.005 * rate);
  const noise = v.noise ?? 1;
  let low = 0;
  let phase = 0;
  let max = 0;
  const transient = (t: number) => Math.exp(-t / (v.noiseDecayMs / 1000));
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // A one-pole low-pass takes the hiss off the noise burst.
    low += 0.35 * (rand() * 2 - 1 - low);
    const f = v.toneEnd === undefined ? v.tone : v.tone + (v.toneEnd - v.tone) * Math.min(1, i / n);
    const echoT = v.echoMs === undefined ? -1 : t - v.echoMs / 1000;
    const echo = echoT >= 0 ? (v.echoGain ?? 0.5) * transient(echoT) : 0;
    const s =
      noise * low * (transient(t) + echo) +
      0.6 * Math.sin(phase) * Math.exp(-t / (v.toneDecayMs / 1000)) +
      v.thump * Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.012);
    phase += (2 * Math.PI * f) / rate;
    out[i] = s * Math.min(1, (n - 1 - i) / fade);
    max = Math.max(max, Math.abs(out[i]));
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] *= v.peak / max;
  return out;
}

const PACKS: Record<SoundPack, { click: Voice; key: (variant: number) => Voice }> = {
  // The 0.4 sounds.
  soft: {
    click: { ms: 45, seed: 7, noiseDecayMs: 4, tone: 1800, toneDecayMs: 9, thump: 0.5, peak: 0.9 },
    key: (v) => ({ ms: 26, seed: 101 + v, noiseDecayMs: 3, tone: 2600 + 350 * (v % 4), toneDecayMs: 5, thump: 0.15, peak: 0.7 }),
  },
  mechanical: {
    click: { ms: 60, seed: 11, noise: 1.4, noiseDecayMs: 6, tone: 2400, toneDecayMs: 6, thump: 0.9, peak: 0.95 },
    key: (v) => ({ ms: 58, seed: 201 + v, noise: 1.6, noiseDecayMs: 5, tone: 3200 - 250 * (v % 4), toneDecayMs: 4, thump: 0.6, echoMs: 18, echoGain: 0.55, peak: 0.85 }),
  },
  pop: {
    click: { ms: 90, seed: 13, noise: 0, noiseDecayMs: 1, tone: 900, toneEnd: 280, toneDecayMs: 25, thump: 0, peak: 0.85 },
    key: (v) => ({ ms: 50, seed: 301 + v, noise: 0, noiseDecayMs: 1, tone: 1400 + 120 * (v % 4), toneEnd: 600, toneDecayMs: 12, thump: 0, peak: 0.6 }),
  },
  tap: {
    click: { ms: 28, seed: 17, noise: 0.8, noiseDecayMs: 2, tone: 1200, toneDecayMs: 3, thump: 0.2, peak: 0.7 },
    key: (v) => ({ ms: 18, seed: 401 + v, noise: 0.7, noiseDecayMs: 1.5, tone: 2000 + 200 * (v % 4), toneDecayMs: 2, thump: 0.05, peak: 0.5 }),
  },
  typewriter: {
    click: { ms: 120, seed: 19, noise: 1.2, noiseDecayMs: 10, tone: 160, toneDecayMs: 30, thump: 1, peak: 0.95 },
    key: (v) => ({ ms: 72, seed: 501 + v, noise: 2, noiseDecayMs: 5, tone: 1100 - 80 * (v % 4), toneDecayMs: 8, thump: 0.7, echoMs: 25, echoGain: 0.6, peak: 0.9 }),
  },
};

/** A mouse click in a pack (soft: a soft tick with a little body, 45 ms). */
export const clickSamples = (rate: number, pack: SoundPack = 'soft') => synth(rate, PACKS[pack].click);

/** A keystroke in a pack; variants differ a little so typing doesn't drone. */
export const keySamples = (rate: number, variant: number, pack: SoundPack = 'soft') => synth(rate, PACKS[pack].key(variant));

export const KEY_VARIANTS = 4;
