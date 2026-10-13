import type { Script, Step } from '../script/schema';
import { buildCamera, MIN_ZOOM, zoomDepth, type ZoomRegion } from './camera';
import { clamp } from './math';
import { buildSegments, type SpeedSpan } from './timemap';
import type { Caption, Rect, Spotlight, StepEvent, TakeEvents, Timeline } from './types';

export const AUTO_SPEED_MIN_IDLE_MS = 800;
export const AUTO_SPEED_TARGET_MS = 600;
export const INTRO_MS = 2200;
export const CAPTION_MIN_MS = 1500;
export const SPOTLIGHT_PAD = 8;

const ZOOMABLE = new Set<Step['do']>(['click', 'type', 'select', 'hover']);

export interface BuildOptions {
  fps?: number;
  output?: { width: number; height: number };
}

function stepOf(script: Script, e: StepEvent): Step {
  const step = script.scenes.find((s) => s.id === e.sceneId)?.steps[e.index];
  if (!step) throw new Error(`Take does not match the script: no step ${e.index + 1} in scene "${e.sceneId}"`);
  return step;
}

const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, width: r.width + 2 * p, height: r.height + 2 * p });

export function buildTimeline(script: Script, ev: TakeEvents, opts: BuildOptions = {}): Timeline {
  const { style } = script;
  const stage = ev.viewport;
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
  const captions: Caption[] = [];
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
      captions.push({ startMs: e.startMs, endMs: Math.max(e.settledMs, e.startMs + CAPTION_MIN_MS), text: step.show.caption });
    }
    if (step.show?.spotlight && e.target) {
      spotlights.push({ startMs: e.actionMs, endMs: e.settledMs, rect: pad(e.target, SPOTLIGHT_PAD) });
    }
  }

  return {
    version: 1,
    fps: opts.fps ?? 30,
    output: opts.output ?? { width: 1920, height: 1080 },
    stage,
    video: { src: ev.video.file, durationMs: ev.video.durationMs },
    intro: script.meta.title ? { title: script.meta.title, subtitle: script.meta.subtitle, durationMs: INTRO_MS } : null,
    segments: buildSegments(ev.video.durationMs, spans),
    camera: buildCamera(regions),
    moves: ev.moves,
    clicks: ev.clicks,
    captions,
    spotlights,
    style,
  };
}
