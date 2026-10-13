import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mixSoundtrack } from './audio/soundtrack';
import { ensureVoices, type VoiceClip } from './audio/tts';
import { logoDataUri } from './logo';
import { workPaths } from './paths';
import { renderStills, renderVideo } from './render/render';
import { contactSheet } from './sheet';
import type { LoadedScript } from './script/load';
import { loadTake } from './take';
import { buildTimeline } from './timeline/build';
import { introFrames, qaShots } from './timeline/frames';
import { toSrt } from './timeline/narration';
import type { Aspect, TakeEvents, Timeline } from './timeline/types';

export interface TimelineOptions {
  log?: (line: string) => void;
  aspect?: Aspect;
}

/** The timeline for the last take, with narration synthesized (cached) and its holds in place. */
export async function timelineFor(
  loaded: LoadedScript,
  opts: TimelineOptions = {},
): Promise<{ timeline: Timeline; events: TakeEvents; clips: Record<string, VoiceClip> }> {
  const events = await loadTake(loaded);
  const clips = await ensureVoices(loaded, { log: opts.log });
  const { logo } = loaded.script.meta;
  const timeline = buildTimeline(loaded.script, events, {
    aspect: opts.aspect,
    logo: logo ? await logoDataUri(logo) : undefined,
    voices: Object.fromEntries(Object.entries(clips).map(([where, c]) => [where, c.durationMs])),
  });
  await writeTimeline(loaded, timeline);
  return { timeline, events, clips };
}

async function writeTimeline(loaded: LoadedScript, timeline: Timeline) {
  const paths = workPaths(loaded);
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.timeline, JSON.stringify(timeline, null, 2));
}

export interface RenderOptions extends TimelineOptions {
  out?: string;
  onProgress?: (progress: number) => void;
  /** false: no soundtrack, even with narration, music or sounds */
  audio?: boolean;
}

export interface RenderResult {
  video: string;
  /** the .srt written next to the video, if the video has narration subtitles */
  subtitles: string | null;
}

export async function renderDemo(loaded: LoadedScript, opts: RenderOptions = {}): Promise<RenderResult> {
  const { timeline, clips } = await timelineFor(loaded, opts);
  const paths = workPaths(loaded);
  if (opts.audio !== false) {
    const src = await mixSoundtrack(loaded, timeline, clips);
    if (src) {
      timeline.audio = { src };
      await writeTimeline(loaded, timeline);
    }
  }
  const out = path.resolve(opts.out ?? paths.video);
  await mkdir(path.dirname(out), { recursive: true });
  await renderVideo(timeline, paths.root, out, opts.onProgress);
  let subtitles: string | null = null;
  if (timeline.subtitles.length) {
    subtitles = out.replace(/\.[^./\\]+$/, '') + '.srt';
    await writeFile(subtitles, toSrt(timeline.subtitles, (introFrames(timeline) * 1000) / timeline.fps));
  }
  return { video: out, subtitles };
}

/** QA stills (intro, one per step, outro) and a contact sheet of all of them. */
export async function renderQaFrames(loaded: LoadedScript, opts: TimelineOptions = {}): Promise<{ sheet: string; frames: string[] }> {
  const { timeline, events } = await timelineFor(loaded, opts);
  const paths = workPaths(loaded);
  await rm(paths.stills, { recursive: true, force: true });
  await mkdir(paths.stills, { recursive: true });
  const frames = await renderStills(timeline, paths.root, paths.stills, qaShots(timeline, events.steps));
  const sheet = await contactSheet(
    frames.map((file) => ({ file, label: path.basename(file, '.png') })),
    paths.sheet,
  );
  return { sheet, frames };
}
