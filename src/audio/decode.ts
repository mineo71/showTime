import { stat } from 'node:fs/promises';
import { run, runBuffer } from '../ffmpeg';
import { RATE } from './wav';

const LOUDNORM = (lufs: number) => `loudnorm=I=${lufs}:TP=-1.5:LRA=11`;

/** A synthesized line as a loudness-normalised mono 48 kHz 16-bit WAV. */
export async function normalizeVoice(src: string, dest: string): Promise<void> {
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', LOUDNORM(-16), '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', '-f', 'wav', dest]);
}

/** Any audio file ffmpeg reads, as float channels at 48 kHz (optionally loudness-normalised). */
export async function decodeAudio(file: string, o: { channels: 1 | 2; lufs?: number }): Promise<Float32Array[]> {
  const af = o.lufs === undefined ? [] : ['-af', LOUDNORM(o.lufs)];
  const raw = await runBuffer('ffmpeg', ['-v', 'error', '-i', file, ...af, '-ac', String(o.channels), '-ar', String(RATE), '-f', 'f32le', '-']);
  const n = Math.floor(raw.length / 4 / o.channels);
  const channels = Array.from({ length: o.channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < o.channels; c++) channels[c][i] = raw.readFloatLE((i * o.channels + c) * 4);
  return channels;
}

const musicCache = new Map<string, Promise<Float32Array[]>>();

/**
 * A music bed as stereo samples, decoded (and loudness-normalised, which reads the whole file) once
 * per file version: the studio remixes on every edit.
 */
export async function musicSamples(file: string, lufs?: number, channels: 1 | 2 = 2): Promise<Float32Array[]> {
  const { mtimeMs, size } = await stat(file);
  const key = `${file}|${mtimeMs}|${size}|${lufs ?? 'raw'}|${channels}`;
  let samples = musicCache.get(key);
  if (!samples) {
    for (const k of musicCache.keys()) if (k.startsWith(`${file}|`)) musicCache.delete(k);
    samples = decodeAudio(file, { channels, lufs });
    samples.catch(() => musicCache.delete(key));
    musicCache.set(key, samples);
  }
  return samples;
}
