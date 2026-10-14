// The soundtrack mixer: voices, a looped music bed that ducks under them, and click/key sounds.

/** Music level while a voice plays. */
export const DUCK = 0.3;
export const DUCK_RAMP_MS = 300;
export const MUSIC_FADE_IN_MS = 800;
export const MUSIC_FADE_OUT_MS = 2000;
/** Peak the finished track is scaled under when parts overlap. */
const CEILING = 0.98;

export interface MixPlan {
  rate: number;
  totalMs: number;
  /** mono voice clips; `atMs` from the start of the track */
  voices: { samples: Float32Array; atMs: number }[];
  /** one or two channels, looped */
  music?: { channels: Float32Array[]; volume: number };
  sounds: { samples: Float32Array; atMs: number; gain: number }[];
  /** the app's own sounds (one or two channels); music ducks under them as under a voice */
  clips?: { channels: Float32Array[]; atMs: number; gain: number }[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Music gain (before its volume) at `tMs`: fade in, fade out, and ducking around voice spans. */
export function musicGain(tMs: number, spans: { startMs: number; endMs: number }[], totalMs: number): number {
  const fade = Math.min(clamp01(tMs / MUSIC_FADE_IN_MS), clamp01((totalMs - tMs) / MUSIC_FADE_OUT_MS));
  let duck = 0;
  for (const s of spans) {
    duck = Math.max(duck, clamp01(Math.min((tMs - (s.startMs - DUCK_RAMP_MS)) / DUCK_RAMP_MS, (s.endMs + DUCK_RAMP_MS - tMs) / DUCK_RAMP_MS)));
  }
  return fade * (1 - (1 - DUCK) * duck);
}

function addMono(into: Float32Array[], samples: Float32Array, at: number, gain: number) {
  const end = Math.min(into[0].length, at + samples.length);
  for (let i = Math.max(0, at); i < end; i++) {
    const v = samples[i - at] * gain;
    into[0][i] += v;
    into[1][i] += v;
  }
}

/** Mix the plan into a stereo track of `totalMs`. */
export function mixTrack(plan: MixPlan): Float32Array[] {
  const { rate } = plan;
  const n = Math.round((plan.totalMs / 1000) * rate);
  const out = [new Float32Array(n), new Float32Array(n)];
  const at = (ms: number) => Math.round((ms / 1000) * rate);

  if (plan.music && plan.music.channels[0]?.length) {
    const src = plan.music.channels;
    const len = src[0].length;
    const spans = [
      ...plan.voices.map((v) => ({ startMs: v.atMs, endMs: v.atMs + (v.samples.length / rate) * 1000 })),
      ...(plan.clips ?? []).map((c) => ({ startMs: c.atMs, endMs: c.atMs + ((c.channels[0]?.length ?? 0) / rate) * 1000 })),
    ];
    // Gain per millisecond is plenty for ramps of hundreds of ms.
    const gains = Float32Array.from({ length: Math.ceil(plan.totalMs) + 1 }, (_, ms) => musicGain(ms, spans, plan.totalMs) * plan.music!.volume);
    for (let i = 0; i < n; i++) {
      const g = gains[Math.floor((i / rate) * 1000)];
      const j = i % len;
      out[0][i] += src[0][j] * g;
      out[1][i] += (src[1] ?? src[0])[j] * g;
    }
  }
  for (const v of plan.voices) addMono(out, v.samples, at(v.atMs), 1);
  for (const s of plan.sounds) addMono(out, s.samples, at(s.atMs), s.gain);
  for (const c of plan.clips ?? []) {
    const start = at(c.atMs);
    const [left, right = left] = c.channels;
    const end = Math.min(n, start + (left?.length ?? 0));
    for (let i = Math.max(0, start); i < end; i++) {
      out[0][i] += left[i - start] * c.gain;
      out[1][i] += right[i - start] * c.gain;
    }
  }

  let peak = 0;
  for (const ch of out) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > CEILING) {
    const k = CEILING / peak;
    for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= k;
  }
  return out;
}
