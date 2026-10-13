import { describe, expect, it } from 'vitest';
import { cursorAt, pressAt, ripplesAt } from '../../src/timeline/cursor';
import type { Move } from '../../src/timeline/types';

const moves: Move[] = [
  { startMs: 1000, endMs: 1500, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, cursor: 'pointer' },
  { startMs: 3000, endMs: 3600, from: { x: 100, y: 0 }, to: { x: 100, y: 300 }, cursor: 'text' },
];

describe('cursorAt', () => {
  it('is hidden before the first move', () => {
    expect(cursorAt(moves, [], 500)).toMatchObject({ visible: false, x: 0, y: 0 });
  });
  it('is hidden without moves', () => {
    expect(cursorAt([], [], 500).visible).toBe(false);
  });
  it('starts at the origin and fades in', () => {
    const c = cursorAt(moves, [], 1000);
    expect(c).toMatchObject({ visible: true, x: 0, y: 0, opacity: 0 });
    expect(cursorAt(moves, [], 1200).opacity).toBe(1);
  });
  it('travels on a slight arc and arrives exactly', () => {
    const mid = cursorAt(moves, [], 1250);
    expect(mid.x).toBeCloseTo(50);
    expect(Math.abs(mid.y)).toBeGreaterThan(1);
    expect(cursorAt(moves, [], 1500)).toMatchObject({ x: 100, y: 0, kind: 'pointer' });
  });
  it('holds between moves and switches kind near arrival', () => {
    expect(cursorAt(moves, [], 2500)).toMatchObject({ x: 100, y: 0, kind: 'pointer' });
    expect(cursorAt(moves, [], 3100).kind).toBe('pointer');
    expect(cursorAt(moves, [], 3590).kind).toBe('text');
    expect(cursorAt(moves, [], 5000)).toMatchObject({ x: 100, y: 300, kind: 'text' });
  });
});

describe('pressAt / ripplesAt', () => {
  const clicks = [{ tMs: 1500, x: 100, y: 0 }];
  it('squashes briefly on click', () => {
    expect(pressAt(clicks, 1400)).toBe(1);
    expect(pressAt(clicks, 1570)).toBeCloseTo(0.85);
    expect(pressAt(clicks, 1700)).toBe(1);
  });
  it('emits a ripple for 450 ms', () => {
    expect(ripplesAt(clicks, 1499)).toEqual([]);
    expect(ripplesAt(clicks, 1725)).toEqual([{ x: 100, y: 0, tMs: 1500, progress: 0.5 }]);
    expect(ripplesAt(clicks, 1951)).toEqual([]);
  });
});
