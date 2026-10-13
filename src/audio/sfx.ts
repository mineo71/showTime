// Click and keystroke sounds, synthesized so the package ships no audio files.

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
  noiseDecayMs: number;
  tone: number;
  toneDecayMs: number;
  thump: number;
  peak: number;
}

function synth(rate: number, v: Voice): Float32Array {
  const n = Math.round((v.ms / 1000) * rate);
  const out = new Float32Array(n);
  const rand = prng(v.seed);
  const fade = Math.round(0.005 * rate);
  let low = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // A one-pole low-pass takes the hiss off the noise burst.
    low += 0.35 * (rand() * 2 - 1 - low);
    const s =
      low * Math.exp(-t / (v.noiseDecayMs / 1000)) +
      0.6 * Math.sin(2 * Math.PI * v.tone * t) * Math.exp(-t / (v.toneDecayMs / 1000)) +
      v.thump * Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.012);
    out[i] = s * Math.min(1, (n - 1 - i) / fade);
    max = Math.max(max, Math.abs(out[i]));
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] *= v.peak / max;
  return out;
}

/** A mouse click: a soft tick with a little body, 45 ms. */
export const clickSamples = (rate: number) =>
  synth(rate, { ms: 45, seed: 7, noiseDecayMs: 4, tone: 1800, toneDecayMs: 9, thump: 0.5, peak: 0.9 });

/** A keystroke: a lighter, shorter tick; variants differ a little so typing doesn't drone. */
export const keySamples = (rate: number, variant: number) =>
  synth(rate, { ms: 26, seed: 101 + variant, noiseDecayMs: 3, tone: 2600 + 350 * (variant % 4), toneDecayMs: 5, thump: 0.15, peak: 0.7 });

export const KEY_VARIANTS = 4;
