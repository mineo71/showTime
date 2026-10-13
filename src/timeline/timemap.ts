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

export interface Hold {
  /** source ms whose frame stays on screen */
  atMs: number;
  holdMs: number;
}

/** Output length of one segment. */
export const segLength = (s: Segment): number => (s.speed === 0 ? (s.holdMs ?? 0) : (s.srcEndMs - s.srcStartMs) / s.speed);

/** Insert still-frame holds, splitting the segment each one falls in; holds at one point merge. */
export function insertHolds(segments: Segment[], holds: Hold[]): Segment[] {
  const at = new Map<number, number>();
  for (const h of holds) if (h.holdMs > 0) at.set(h.atMs, (at.get(h.atMs) ?? 0) + h.holdMs);
  const points = [...at.keys()].sort((a, b) => a - b);
  const hold = (t: number): Segment => ({ srcStartMs: t, srcEndMs: t, speed: 0, holdMs: at.get(t) });
  const out: Segment[] = [];
  let p = 0;
  for (const s of segments) {
    if (s.speed === 0) {
      out.push(s);
      continue;
    }
    let start = s.srcStartMs;
    for (; p < points.length && points[p] < s.srcEndMs; p++) {
      const t = Math.max(points[p], start);
      if (t > start) out.push({ ...s, srcStartMs: start, srcEndMs: t });
      out.push(hold(points[p]));
      start = t;
    }
    out.push({ ...s, srcStartMs: start });
  }
  for (; p < points.length; p++) out.push(hold(points[p]));
  return out;
}

export function outputDurationMs(segments: Segment[]): number {
  return segments.reduce((acc, s) => acc + segLength(s), 0);
}

export function outputToSource(segments: Segment[], tOutMs: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = segLength(s);
    if (tOutMs < acc + len) return s.speed === 0 ? s.srcStartMs : s.srcStartMs + Math.max(0, tOutMs - acc) * s.speed;
    acc += len;
  }
  return segments.length ? segments[segments.length - 1].srcEndMs : 0;
}

export function sourceToOutput(segments: Segment[], tSrcMs: number): number {
  let acc = 0;
  for (const s of segments) {
    if (s.speed !== 0 && tSrcMs < s.srcEndMs) return acc + Math.max(0, tSrcMs - s.srcStartMs) / s.speed;
    acc += segLength(s);
  }
  return acc;
}
