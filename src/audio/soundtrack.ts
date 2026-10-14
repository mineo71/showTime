import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from '../paths';
import type { LoadedScript } from '../script/load';
import { introFrames, totalFrames } from '../timeline/frames';
import type { Timeline } from '../timeline/types';
import { musicSamples } from './decode';
import { mixTrack } from './mix';
import { clickSamples, KEY_VARIANTS, keySamples } from './sfx';
import type { VoiceClip } from './tts';
import { RATE, readWav, writeWav } from './wav';

export const CLICK_GAIN = 0.5;
export const KEY_GAIN = 0.2;
/** Music is normalised to this loudness before its volume applies (voices sit at -16 LUFS). */
const MUSIC_LUFS = -20;
/** The app's own sounds sit a little under the narration. */
const CLIP_LUFS = -18;

/**
 * Mix narration, music and sounds into `out` (default `.showtime/<name>/audio/mix.wav`), as long as
 * the whole video (cards included). Returns its path relative to the renderer's public folder, or
 * null when the video has no sound.
 */
export async function mixSoundtrack(
  loaded: LoadedScript,
  t: Timeline,
  clips: Record<string, VoiceClip>,
  out = workPaths(loaded).mix,
): Promise<string | null> {
  const music = loaded.script.audio.music;
  if (!t.narration.length && !t.sounds.length && !music && !t.clips.length) return null;
  const frameMs = 1000 / t.fps;
  const introMs = introFrames(t) * frameMs;
  const voices = await Promise.all(
    t.narration.map(async (n) => ({ samples: (await readWav(clips[n.where].file)).channels[0], atMs: introMs + n.atMs })),
  );
  const click = clickSamples(RATE);
  const keys = Array.from({ length: KEY_VARIANTS }, (_, i) => keySamples(RATE, i));
  const sounds = t.sounds.map((s, i) =>
    s.kind === 'click'
      ? { samples: click, atMs: introMs + s.atMs, gain: CLICK_GAIN }
      : { samples: keys[i % KEY_VARIANTS], atMs: introMs + s.atMs, gain: KEY_GAIN },
  );
  const appSounds = await Promise.all(
    t.clips.map(async (c) => ({
      channels: await musicSamples(loaded.script.audio.clips[c.index].file, CLIP_LUFS),
      atMs: introMs + c.atMs,
      gain: c.volume,
    })),
  );
  const track = mixTrack({
    rate: RATE,
    totalMs: totalFrames(t) * frameMs,
    voices,
    sounds,
    clips: appSounds,
    music: music ? { channels: await musicSamples(music.file, MUSIC_LUFS), volume: music.volume } : undefined,
  });
  const paths = workPaths(loaded);
  await mkdir(paths.audio, { recursive: true });
  await writeWav(out, track);
  return path.relative(paths.root, out).split(path.sep).join('/');
}
