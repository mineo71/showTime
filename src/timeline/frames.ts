import { outputDurationMs, outputToSource, segLength, sourceToOutput } from './timemap';
import type { StepEvent, Timeline } from './types';

export interface SegmentPlan {
  fromFrame: number;
  durationInFrames: number;
  /** source frame where this segment starts */
  trimBefore: number;
  /** 0: a hold, showing the `trimBefore` frame throughout */
  speed: number;
}

export interface Shot {
  frame: number;
  name: string;
}

const toFrames = (ms: number, fps: number) => Math.round((ms * fps) / 1000);

export function introFrames(t: Timeline): number {
  return t.intro ? toFrames(t.intro.durationMs, t.fps) : 0;
}

export function outroFrames(t: Timeline): number {
  return t.outro ? toFrames(t.outro.durationMs, t.fps) : 0;
}

/** First frame after the video (where the outro starts). */
export function videoEndFrame(t: Timeline): number {
  return introFrames(t) + toFrames(outputDurationMs(t.segments), t.fps);
}

export function totalFrames(t: Timeline): number {
  return Math.max(1, videoEndFrame(t) + outroFrames(t));
}

export function segmentPlan(t: Timeline): SegmentPlan[] {
  const intro = introFrames(t);
  const plan: SegmentPlan[] = [];
  let outMs = 0;
  for (const s of t.segments) {
    const startF = toFrames(outMs, t.fps);
    outMs += segLength(s);
    const endF = toFrames(outMs, t.fps);
    if (endF > startF) {
      plan.push({ fromFrame: intro + startF, durationInFrames: endF - startF, trimBefore: toFrames(s.srcStartMs, t.fps), speed: s.speed });
    }
  }
  return plan;
}

/** Source ms shown at a composition frame, or null during the intro. */
export function sourceMsAtFrame(t: Timeline, frame: number): number | null {
  const f = frame - introFrames(t);
  if (f < 0) return null;
  return outputToSource(t.segments, (f * 1000) / t.fps);
}

export function qaShots(t: Timeline, steps: StepEvent[]): Shot[] {
  const intro = introFrames(t);
  const last = Math.max(0, videoEndFrame(t) - 1);
  const shots: Shot[] = [];
  if (t.intro) shots.push({ frame: Math.floor(intro / 2), name: '00-intro' });
  steps.forEach((s, i) => {
    const mid = (s.actionMs + s.settledMs) / 2;
    const frame = Math.min(last, intro + toFrames(sourceToOutput(t.segments, mid), t.fps));
    shots.push({ frame, name: `${String(i + 1).padStart(2, '0')}-${s.sceneId}-${s.index + 1}-${s.do}` });
  });
  if (t.outro) shots.push({ frame: videoEndFrame(t) + Math.round(outroFrames(t) * 0.6), name: '99-outro' });
  return shots;
}
