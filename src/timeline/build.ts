import type { Script, Step } from '../script/schema';
import { buildCamera, cameraAt, MIN_ZOOM, zoomDepth, type ZoomRegion } from './camera';
import { BROWSER_BAR, projectRect, windowLayout, type Box } from './layout';
import { clamp } from './math';
import { soundEvents, stepKey, subtitleCues, withNarration, type Typing } from './narration';
import { buildSegments, sourceToOutput, type SpeedSpan } from './timemap';
import type { CameraKey, Caption, NarrationLine, Rect, Spotlight, StepEvent, TakeEvents, Timeline } from './types';

export const AUTO_SPEED_MIN_IDLE_MS = 800;
export const AUTO_SPEED_TARGET_MS = 600;
export const INTRO_MS = 2200;
export const CAPTION_MIN_MS = 1500;
export const SPOTLIGHT_PAD = 8;
export const OUTRO_MS = 2600;
/** Bottom captions own the output below this fraction of its height. */
export const CAPTION_BAND = 0.78;
const DEFAULT_OUTPUT = { width: 1920, height: 1080 };

const ZOOMABLE = new Set<Step['do']>(['click', 'type', 'select', 'hover']);

export interface BuildOptions {
  fps?: number;
  output?: { width: number; height: number };
  /** Logo as a data URI. */
  logo?: string;
  /** Length of each synthesized `show.say` line, by step (`scene#n`); lines without one are left out. */
  voices?: Record<string, number>;
}

function stepOf(script: Script, e: StepEvent): Step {
  const step = script.scenes.find((s) => s.id === e.sceneId)?.steps[e.index];
  if (!step) throw new Error(`Take does not match the script: no step ${e.index + 1} in scene "${e.sceneId}"`);
  return step;
}

/** "https://app.acme.com/reports/" → "app.acme.com/reports". */
function displayAddress(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Top when the target, at any of the caption's start/middle/end, reaches into the bottom caption band. */
function captionPosition(
  target: Rect | undefined,
  c: { startMs: number; endMs: number },
  camera: CameraKey[],
  stage: { width: number; height: number },
  win: Box,
  output: { width: number; height: number },
): Caption['position'] {
  if (!target) return 'bottom';
  const band = output.height * CAPTION_BAND;
  const low = [c.startMs, (c.startMs + c.endMs) / 2, c.endMs].some((tMs) => {
    const r = projectRect(target, cameraAt(camera, tMs), stage, win);
    return r.y + r.height > band;
  });
  return low ? 'top' : 'bottom';
}

const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, width: r.width + 2 * p, height: r.height + 2 * p });

export function buildTimeline(script: Script, ev: TakeEvents, opts: BuildOptions = {}): Timeline {
  const { style } = script;
  const stage = ev.viewport;
  const output = opts.output ?? DEFAULT_OUTPUT;
  const pairs = ev.steps.map((e) => ({ e, step: stepOf(script, e) }));

  // Speed: auto idle first, explicit `show.speed` next, pauses last (later spans win).
  const spans: SpeedSpan[] = [];
  if (style.autoSpeed) {
    for (const i of ev.idle) {
      const len = i.endMs - i.startMs;
      if (len > AUTO_SPEED_MIN_IDLE_MS) spans.push({ ...i, speed: clamp(len / AUTO_SPEED_TARGET_MS, 2, 8) });
    }
  }
  for (const { e, step } of pairs) {
    if (step.show?.speed !== undefined) spans.push({ startMs: e.startMs, endMs: e.settledMs, speed: step.show.speed });
  }
  for (const { e, step } of pairs) {
    if (step.do === 'pause') spans.push({ startMs: e.startMs, endMs: e.endMs, speed: 1 });
  }

  const regions: ZoomRegion[] = [];
  const drafts: { startMs: number; endMs: number; text: string; target?: Rect }[] = [];
  const spotlights: Spotlight[] = [];
  for (const { e, step } of pairs) {
    const zoom = step.show?.zoom;
    const wantsZoom = typeof zoom === 'number' || (zoom === undefined && style.autoZoom && ZOOMABLE.has(step.do));
    if (e.target && wantsZoom) {
      const scale = typeof zoom === 'number' ? zoom : zoomDepth(e.target, stage, style.maxZoom);
      if (scale >= MIN_ZOOM) {
        regions.push({
          startMs: e.actionMs,
          endMs: e.settledMs,
          scale,
          cx: (e.target.x + e.target.width / 2) / stage.width,
          cy: (e.target.y + e.target.height / 2) / stage.height,
        });
      }
    }
    if (step.show?.caption) {
      drafts.push({ startMs: e.startMs, endMs: Math.max(e.settledMs, e.startMs + CAPTION_MIN_MS), text: step.show.caption, target: e.target });
    }
    if (step.show?.spotlight && e.target) {
      spotlights.push({ startMs: e.actionMs, endMs: e.settledMs, rect: pad(e.target, SPOTLIGHT_PAD) });
    }
  }

  const lines = pairs.flatMap(({ e, step }) => {
    const where = stepKey(e.sceneId, e.index);
    const durationMs = opts.voices?.[where];
    return step.show?.say && durationMs !== undefined ? [{ where, text: step.show.say, startMs: e.startMs, durationMs }] : [];
  });
  const segments = withNarration(buildSegments(ev.video.durationMs, spans), lines, ev.video.durationMs);
  const narration: NarrationLine[] = lines.map((l) => ({
    where: l.where,
    text: l.text,
    atMs: Math.round(sourceToOutput(segments, l.startMs)),
    durationMs: l.durationMs,
  }));
  const subtitles = script.audio.subtitles === 'off' ? [] : narration.flatMap((n) => subtitleCues(n.text, n.atMs, n.durationMs));
  const subtitlesBurned = script.audio.subtitles === 'burn' && subtitles.length > 0;
  const typing: Typing[] = pairs.flatMap(({ e, step }) =>
    step.do === 'type' && step.pace !== 'fast' ? [{ startMs: e.actionMs, endMs: e.endMs, chars: [...step.text].length }] : [],
  );

  const camera = buildCamera(regions);
  const win = windowLayout(output, stage, style.padding, style.chrome === 'browser' ? BROWSER_BAR : 0);
  // A caption ends when the next one starts: no overlap, so captions dip instead of colliding.
  drafts.sort((a, b) => a.startMs - b.startMs);
  drafts.forEach((d, i) => {
    const next = drafts[i + 1];
    if (next) d.endMs = Math.min(d.endMs, next.startMs);
  });
  const captions: Caption[] = drafts
    .filter((d) => d.endMs > d.startMs)
    .map((d) => ({
      startMs: d.startMs,
      endMs: d.endMs,
      text: d.text,
      position: subtitlesBurned ? 'top' : captionPosition(d.target, d, camera, stage, win, output),
    }));

  return {
    version: 1,
    fps: opts.fps ?? 30,
    output,
    stage,
    video: { src: ev.video.file, durationMs: ev.video.durationMs },
    intro: script.meta.title ? { title: script.meta.title, subtitle: script.meta.subtitle, durationMs: INTRO_MS } : null,
    chrome:
      style.chrome === 'browser'
        ? { address: style.address ?? displayAddress(script.app.url), dark: script.app.colorScheme === 'dark' }
        : null,
    outro: script.meta.outro ? { ...script.meta.outro, durationMs: OUTRO_MS } : null,
    logo: opts.logo ?? null,
    segments,
    camera,
    moves: ev.moves,
    clicks: ev.clicks,
    captions,
    spotlights,
    narration,
    subtitles,
    subtitlesBurned,
    sounds: script.audio.sounds ? soundEvents(ev, typing, segments) : [],
    music: script.audio.music ? { volume: script.audio.music.volume } : null,
    audio: null,
    style,
  };
}
