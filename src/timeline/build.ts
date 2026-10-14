import type { Script, Step } from '../script/schema';
import { buildCamera, cameraAt, MIN_ZOOM, zoomDepth, type ZoomRegion } from './camera';
import { BROWSER_BAR, OUTPUT_SIZES, projectRect, viewLayout, visibleFraction, type View } from './layout';
import { clamp } from './math';
import { RIPPLE_MS } from './cursor';
import { CAPTION_FADE_MS, SPOTLIGHT_FADE_MS } from './fades';
import { soundEvents, stepKey, subtitleCues, withNarration, type Span, type Typing } from './narration';
import { readingMs } from './reading';
import { buildSegments, outputToSource, sourceToOutput, type SpeedSpan } from './timemap';
import type { Aspect, CameraKey, Caption, ClickFx, FontFile, NarrationLine, Rect, Spotlight, StepEvent, TakeEvents, Timeline, Watermark } from './types';

export const AUTO_SPEED_MIN_IDLE_MS = 800;
export const AUTO_SPEED_TARGET_MS = 600;
export const INTRO_MS = 2200;
export const CAPTION_MIN_MS = 1500;
export const SPOTLIGHT_PAD = 8;
export const OUTRO_MS = 2600;
/** Bottom captions own the output below this fraction of its height. */
export const CAPTION_BAND = 0.78;
/** Burned subtitles get a band of this fraction of the output height under the window (16:9, 1:1). */
export const SUBTITLE_BAND = 0.11;

const ZOOMABLE = new Set<Step['do']>(['click', 'type', 'select', 'hover']);

export interface BuildOptions {
  fps?: number;
  /** 16:9 by default; 9:16 and 1:1 crop the viewport and follow the action. */
  aspect?: Aspect;
  /** Logo as a data URI. */
  logo?: string;
  /** Length of each synthesized `show.say` line, by step (`scene#n`); lines without one are left out. */
  voices?: Record<string, number>;
  /** `style.fonts` as data URIs */
  fonts?: FontFile[];
  /** `style.watermark` with its image as a data URI */
  watermark?: Watermark;
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
  win: View,
  output: { width: number; height: number },
): Caption['position'] {
  if (!target) return 'bottom';
  // Bottom captions sit just above the window's bottom edge (above the subtitle band when there is one).
  const band = Math.min(output.height * CAPTION_BAND, win.y + win.height - output.height * 0.15);
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
  const aspect = opts.aspect ?? '16:9';
  const output = OUTPUT_SIZES[aspect];
  const pairs = ev.steps.map((e) => ({ e, step: stepOf(script, e) }));
  const lines = pairs.flatMap(({ e, step }) => {
    const where = stepKey(e.sceneId, e.index);
    const durationMs = opts.voices?.[where];
    return step.show?.say && durationMs !== undefined ? [{ where, text: step.show.say, startMs: e.startMs, durationMs }] : [];
  });
  const subtitlesBurned = script.audio.subtitles === 'burn' && lines.length > 0;
  // Burned subtitles get their own band under the window, so they never cover the app (9:16 has bands already).
  const subtitleBand = subtitlesBurned && aspect !== '9:16' ? Math.round(output.height * SUBTITLE_BAND) : 0;
  const win = viewLayout(output, stage, style.padding, style.chrome === 'browser' ? BROWSER_BAR : 0, aspect, subtitleBand);
  const visible = visibleFraction(win);
  // Cropped formats follow every target; a zoom only adds what the crop doesn't already magnify.
  const crop = aspect !== '16:9';
  const cropDepth = Math.min(visible.x, visible.y);

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
  const base = buildSegments(ev.video.durationMs, spans);
  /** Source time at which `text`, shown from `startMs`, has been readable for long enough (output time). */
  const readEnd = (startMs: number, text: string) =>
    outputToSource(base, sourceToOutput(base, startMs) + Math.max(CAPTION_MIN_MS, readingMs(text)));

  const regions: ZoomRegion[] = [];
  const drafts: { startMs: number; endMs: number; text: string; target?: Rect }[] = [];
  const spotlights: Spotlight[] = [];
  for (const { e, step } of pairs) {
    const zoom = step.show?.zoom;
    const wantsZoom = typeof zoom === 'number' || (zoom === undefined && style.autoZoom && ZOOMABLE.has(step.do));
    if (e.target && (wantsZoom || crop)) {
      const depth = wantsZoom ? (typeof zoom === 'number' ? zoom : zoomDepth(e.target, stage, style.maxZoom)) : 1;
      const scale = crop ? Math.max(1, depth * cropDepth) : depth;
      if (scale >= MIN_ZOOM || crop) {
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
      drafts.push({ startMs: e.startMs, endMs: Math.max(e.settledMs, readEnd(e.startMs, step.show.caption)), text: step.show.caption, target: e.target });
    }
    if (step.show?.spotlight && e.target) {
      spotlights.push({
        startMs: e.actionMs,
        endMs: e.settledMs,
        rect: pad(e.target, SPOTLIGHT_PAD),
        kind: step.show.spotlight === true ? 'dim' : step.show.spotlight,
        color: step.show.highlight ?? style.accent,
      });
    }
  }

  const camera = buildCamera(regions, { visible, hold: crop });
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
      // 9:16 captions sit in the band under the window, clear of the action.
      position: aspect === '9:16' ? (subtitlesBurned ? 'top' : 'bottom') : captionPosition(d.target, d, camera, stage, win, output),
    }));

  // Narration holds freeze the frame, so they go where nothing is moving: not during an action,
  // a cursor move, a ripple, a camera move or a fade.
  const fades = (x: { startMs: number; endMs: number }, ms: number) => [
    { startMs: x.startMs, endMs: x.startMs + ms },
    { startMs: x.endMs - ms, endMs: x.endMs },
  ];
  const busy: Span[] = [
    ...pairs.filter(({ step }) => step.do !== 'pause').map(({ e }) => ({ startMs: e.startMs, endMs: e.endMs })),
    ...ev.moves,
    ...ev.clicks.map((c) => ({ startMs: c.tMs, endMs: c.tMs + RIPPLE_MS })),
    ...camera.slice(1).flatMap((b, i) => {
      const a = camera[i];
      return a.scale !== b.scale || a.cx !== b.cx || a.cy !== b.cy ? [{ startMs: a.tMs, endMs: b.tMs }] : [];
    }),
    ...captions.flatMap((c) => fades(c, CAPTION_FADE_MS)),
    ...spotlights.flatMap((s) => fades(s, SPOTLIGHT_FADE_MS)),
  ];
  const segments = withNarration(base, lines, ev.video.durationMs, busy);
  const narration: NarrationLine[] = lines.map((l) => ({
    where: l.where,
    text: l.text,
    atMs: Math.round(sourceToOutput(segments, l.startMs)),
    durationMs: l.durationMs,
  }));
  const subtitles = script.audio.subtitles === 'off' ? [] : narration.flatMap((n) => subtitleCues(n.text, n.atMs, n.durationMs));
  // Each click takes its step's animation and colour (a click is logged when its step acts).
  const clickFx: ClickFx[] = ev.clicks.flatMap((c) => {
    const step = pairs.find(({ e }) => e.startMs <= c.tMs && c.tMs <= e.settledMs)?.step;
    const kind = step?.show?.click ?? style.click;
    return kind === 'none' ? [] : [{ tMs: c.tMs, x: c.x, y: c.y, kind, color: step?.show?.highlight ?? style.accent }];
  });
  const clips = script.audio.clips.flatMap((clip, index) => {
    const at = pairs.find(({ e }) => stepKey(e.sceneId, e.index) === clip.at);
    return at ? [{ index, atMs: Math.round(sourceToOutput(segments, at.e.startMs)) + clip.offsetMs, volume: clip.volume }] : [];
  });
  const typing: Typing[] = pairs.flatMap(({ e, step }) =>
    step.do === 'type' && step.pace !== 'fast' ? [{ startMs: e.actionMs, endMs: e.endMs, chars: [...step.text].length }] : [],
  );

  return {
    version: 1,
    fps: opts.fps ?? 30,
    aspect,
    output,
    stage,
    video: { src: `take/${ev.video.file}`, durationMs: ev.video.durationMs },
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
    clickFx,
    fonts: opts.fonts ?? [],
    watermark: opts.watermark ?? null,
    narration,
    subtitles,
    subtitlesBurned,
    subtitleBand,
    clips,
    sounds: script.audio.sounds ? soundEvents(ev, typing, segments) : [],
    music: script.audio.music ? { volume: script.audio.music.volume } : null,
    audio: null,
    style,
  };
}
