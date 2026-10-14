import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from '../paths';
import type { LoadedScript } from '../script/load';
import type { Audio, SoundPack } from '../script/schema';
import { introFrames, totalFrames } from '../timeline/frames';
import type { Timeline } from '../timeline/types';
import { musicSamples } from './decode';
import { mixTrack } from './mix';
import { clickSamples, KEY_VARIANTS, keySamples } from './sfx';
import type { VoiceClip } from './tts';
import { RATE, readWav, writeWav } from './wav';

/** `audio.sounds` in one shape: a pack, optional own files, a volume. */
export function soundSettings(sounds: Audio['sounds']): { pack: SoundPack; click?: string; key?: string; volume: number } {
  if (typeof sounds === 'object') return sounds;
  return { pack: typeof sounds === 'string' ? sounds : 'soft', volume: 1 };
}

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
  const sfx = soundSettings(loaded.script.audio.sounds);
  // Your own files win over the pack; they play as recorded (no loudness normalising on a click).
  const own = async (file: string | undefined) => (file ? (await musicSamples(file))[0] : null);
  const click = (await own(sfx.click)) ?? clickSamples(RATE, sfx.pack);
  const ownKey = await own(sfx.key);
  const keys = Array.from({ length: KEY_VARIANTS }, (_, i) => ownKey ?? keySamples(RATE, i, sfx.pack));
  const sounds = t.sounds.map((s, i) =>
    s.kind === 'click'
      ? { samples: click, atMs: introMs + s.atMs, gain: CLICK_GAIN * sfx.volume }
      : { samples: keys[i % KEY_VARIANTS], atMs: introMs + s.atMs, gain: KEY_GAIN * sfx.volume },
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
