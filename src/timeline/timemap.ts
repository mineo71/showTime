import type { Interval, Segment } from './types';

export interface SpeedSpan extends Interval {
  speed: number;
}

/** Cover [0, durationMs] with speed segments. Later spans win where spans overlap. */
export function buildSegments(durationMs: number, spans: SpeedSpan[]): Segment[] {
  const clip = (t: number) => Math.min(durationMs, Math.max(0, t));
  const cuts = new Set<number>([0, durationMs]);
  for (const s of spans) {
    cuts.add(clip(s.startMs));
    cuts.add(clip(s.endMs));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const mid = (a + b) / 2;
    let speed = 1;
    for (const s of spans) if (s.startMs <= mid && mid < s.endMs) speed = s.speed;
    const last = out[out.length - 1];
    if (last && last.speed === speed) last.srcEndMs = b;
    else out.push({ srcStartMs: a, srcEndMs: b, speed });
  }
  return out;
}

export function outputDurationMs(segments: Segment[]): number {
  return segments.reduce((acc, s) => acc + (s.srcEndMs - s.srcStartMs) / s.speed, 0);
}

export function outputToSource(segments: Segment[], tOutMs: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = (s.srcEndMs - s.srcStartMs) / s.speed;
    if (tOutMs < acc + len) return s.srcStartMs + Math.max(0, tOutMs - acc) * s.speed;
    acc += len;
  }
  return segments.length ? segments[segments.length - 1].srcEndMs : 0;
}

export function sourceToOutput(segments: Segment[], tSrcMs: number): number {
  let acc = 0;
  for (const s of segments) {
    if (tSrcMs < s.srcEndMs) return acc + Math.max(0, tSrcMs - s.srcStartMs) / s.speed;
    acc += (s.srcEndMs - s.srcStartMs) / s.speed;
  }
  return acc;
}
