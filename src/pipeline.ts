import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mixSoundtrack } from './audio/soundtrack';
import { ensureVoices, type VoiceClip } from './audio/tts';
import { ANIMATION_WIDTH, defaultOutput, formatOf, toGif, toWebp, type Format } from './convert';
import { probeVideo } from './ffmpeg';
import { logoDataUri } from './logo';
import { stillsFor, workPaths } from './paths';
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
  /** default: `<name>[-9x16|-1x1].<format>` next to the script */
  out?: string;
  /** default: from `out`'s extension, else mp4 */
  format?: Format;
  /** GIF/WebP width in px */
  width?: number;
  onProgress?: (progress: number) => void;
  /** false: no soundtrack, even with narration, music or sounds */
  audio?: boolean;
}

export interface RenderResult {
  video: string;
  durationMs: number;
  /** the .srt written next to an MP4 with narration subtitles */
  subtitles: string | null;
}

export async function renderDemo(loaded: LoadedScript, opts: RenderOptions = {}): Promise<RenderResult> {
  const aspect = opts.aspect ?? '16:9';
  const format = opts.format ?? formatOf(opts.out);
  const out = path.resolve(opts.out ?? defaultOutput(loaded, aspect, format));
  const { timeline, clips } = await timelineFor(loaded, opts);
  const paths = workPaths(loaded);
  await mkdir(path.dirname(out), { recursive: true });

  if (format !== 'mp4') {
    // GIF and WebP are cut from a silent MP4 render.
    const mp4 = path.join(paths.root, `render-${aspect.replace(':', 'x')}.mp4`);
    await renderVideo(timeline, paths.root, mp4, opts.onProgress);
    const width = opts.width ?? ANIMATION_WIDTH[aspect];
    await (format === 'gif' ? toGif(mp4, out, width) : toWebp(mp4, out, width));
    return { video: out, durationMs: (await probeVideo(mp4)).durationMs, subtitles: null };
  }

  if (opts.audio !== false) {
    const src = await mixSoundtrack(loaded, timeline, clips);
    if (src) {
      timeline.audio = { src };
      await writeTimeline(loaded, timeline);
    }
  }
  await renderVideo(timeline, paths.root, out, opts.onProgress);
  let subtitles: string | null = null;
  if (timeline.subtitles.length) {
    subtitles = out.replace(/\.[^./\\]+$/, '') + '.srt';
    await writeFile(subtitles, toSrt(timeline.subtitles, (introFrames(timeline) * 1000) / timeline.fps));
  }
  return { video: out, durationMs: (await probeVideo(out)).durationMs, subtitles };
}

/** QA stills (intro, one per step, outro) and a contact sheet of all of them. */
export async function renderQaFrames(loaded: LoadedScript, opts: TimelineOptions = {}): Promise<{ sheet: string; frames: string[] }> {
  const { timeline, events } = await timelineFor(loaded, opts);
  const paths = workPaths(loaded);
  const stills = stillsFor(paths, timeline.aspect);
  await rm(stills.dir, { recursive: true, force: true });
  await mkdir(stills.dir, { recursive: true });
  const frames = await renderStills(timeline, paths.root, stills.dir, qaShots(timeline, events.steps));
  const sheet = await contactSheet(
    frames.map((file) => ({ file, label: path.basename(file, '.png') })),
    stills.sheet,
  );
  return { sheet, frames };
}
