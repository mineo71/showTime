import { clamp, easeInOutCubic } from './math';
import type { Click, CursorKind, Move } from './types';

export const RIPPLE_MS = 450;
const PRESS_MS = 140;
const FADE_IN_MS = 200;
const KIND_SWITCH_AT = 0.9;

export interface CursorState {
  x: number;
  y: number;
  kind: CursorKind;
  visible: boolean;
  opacity: number;
  press: number;
}

export function pressAt(clicks: Click[], tMs: number): number {
  for (const c of clicks) {
    const d = tMs - c.tMs;
    if (d >= 0 && d <= PRESS_MS) return 1 - 0.15 * Math.sin((Math.PI * d) / PRESS_MS);
  }
  return 1;
}

export function ripplesAt(clicks: Click[], tMs: number): Array<{ x: number; y: number; tMs: number; progress: number }> {
  return clicks
    .filter((c) => tMs >= c.tMs && tMs <= c.tMs + RIPPLE_MS)
    .map((c) => ({ x: c.x, y: c.y, tMs: c.tMs, progress: (tMs - c.tMs) / RIPPLE_MS }));
}

export function cursorAt(moves: Move[], clicks: Click[], tMs: number): CursorState {
  if (!moves.length) return { x: 0, y: 0, kind: 'arrow', visible: false, opacity: 0, press: 1 };
  const first = moves[0];
  if (tMs < first.startMs) return { ...first.from, kind: 'arrow', visible: false, opacity: 0, press: 1 };

  let i = 0;
  while (i + 1 < moves.length && moves[i + 1].startMs <= tMs) i++;
  const m = moves[i];
  const prevKind: CursorKind = i > 0 ? moves[i - 1].cursor : 'arrow';

  let { x, y } = m.to;
  let kind = m.cursor;
  if (tMs < m.endMs) {
    const p = clamp((tMs - m.startMs) / Math.max(1, m.endMs - m.startMs), 0, 1);
    const e = easeInOutCubic(p);
    const dx = m.to.x - m.from.x;
    const dy = m.to.y - m.from.y;
    const dist = Math.hypot(dx, dy);
    const arc = Math.sin(Math.PI * p) * Math.min(40, dist * 0.08);
    const nx = dist ? -dy / dist : 0;
    const ny = dist ? dx / dist : 0;
    x = m.from.x + dx * e + nx * arc;
    y = m.from.y + dy * e + ny * arc;
    kind = p < KIND_SWITCH_AT ? prevKind : m.cursor;
  }
  const opacity = clamp((tMs - first.startMs) / FADE_IN_MS, 0, 1);
  return { x, y, kind, visible: true, opacity, press: pressAt(clicks, tMs) };
}
