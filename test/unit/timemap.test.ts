import { describe, expect, it } from 'vitest';
import { buildSegments, insertHolds, outputDurationMs, outputToSource, segLength, sourceToOutput } from '../../src/timeline/timemap';

describe('buildSegments', () => {
  it('is a single 1x segment without spans', () => {
    expect(buildSegments(10_000, [])).toEqual([{ srcStartMs: 0, srcEndMs: 10_000, speed: 1 }]);
  });

  it('speeds up an idle span', () => {
    const segs = buildSegments(10_000, [{ startMs: 2000, endMs: 5000, speed: 4 }]);
    expect(segs).toEqual([
      { srcStartMs: 0, srcEndMs: 2000, speed: 1 },
      { srcStartMs: 2000, srcEndMs: 5000, speed: 4 },
      { srcStartMs: 5000, srcEndMs: 10_000, speed: 1 },
    ]);
    expect(outputDurationMs(segs)).toBe(2000 + 750 + 5000);
  });

  it('lets later spans override earlier ones', () => {
    const segs = buildSegments(10_000, [
      { startMs: 1000, endMs: 5000, speed: 4 },
      { startMs: 3000, endMs: 4000, speed: 1 },
    ]);
    expect(segs).toEqual([
      { srcStartMs: 0, srcEndMs: 1000, speed: 1 },
      { srcStartMs: 1000, srcEndMs: 3000, speed: 4 },
      { srcStartMs: 3000, srcEndMs: 4000, speed: 1 },
      { srcStartMs: 4000, srcEndMs: 5000, speed: 4 },
      { srcStartMs: 5000, srcEndMs: 10_000, speed: 1 },
    ]);
  });

  it('merges adjacent equal speeds and clips spans to the video', () => {
    expect(buildSegments(10_000, [{ startMs: 0, endMs: 2000, speed: 1 }])).toEqual([
      { srcStartMs: 0, srcEndMs: 10_000, speed: 1 },
    ]);
    expect(buildSegments(1000, [{ startMs: -500, endMs: 5000, speed: 2 }])).toEqual([
      { srcStartMs: 0, srcEndMs: 1000, speed: 2 },
    ]);
  });
});

describe('time mapping', () => {
  const segs = buildSegments(10_000, [{ startMs: 2000, endMs: 6000, speed: 4 }]);

  it('maps output time to source time', () => {
    expect(outputToSource(segs, 0)).toBe(0);
    expect(outputToSource(segs, 1999)).toBe(1999);
    expect(outputToSource(segs, 2500)).toBe(4000);
    expect(outputToSource(segs, 3000)).toBe(6000);
    expect(outputToSource(segs, 999_999)).toBe(10_000);
  });

  it('round-trips through sourceToOutput', () => {
    for (const t of [0, 1500, 2000, 3333, 5999, 6000, 9000]) {
      expect(outputToSource(segs, sourceToOutput(segs, t))).toBeCloseTo(t, 6);
    }
  });
});

describe('holds', () => {
  const segs = [
    { srcStartMs: 0, srcEndMs: 2000, speed: 1 },
    { srcStartMs: 2000, srcEndMs: 6000, speed: 2 },
    { srcStartMs: 6000, srcEndMs: 10_000, speed: 1 },
  ];

  it('splits the segment at the hold point and adds the hold to the output length', () => {
    const held = insertHolds(segs, [{ atMs: 3000, holdMs: 1500 }]);
    expect(held).toEqual([
      { srcStartMs: 0, srcEndMs: 2000, speed: 1 },
      { srcStartMs: 2000, srcEndMs: 3000, speed: 2 },
      { srcStartMs: 3000, srcEndMs: 3000, speed: 0, holdMs: 1500 },
      { srcStartMs: 3000, srcEndMs: 6000, speed: 2 },
      { srcStartMs: 6000, srcEndMs: 10_000, speed: 1 },
    ]);
    expect(outputDurationMs(held)).toBe(outputDurationMs(segs) + 1500);
    expect(segLength(held[2])).toBe(1500);
  });

  it('shows the hold point for the whole hold and shifts what comes after', () => {
    const held = insertHolds(segs, [{ atMs: 3000, holdMs: 1500 }]);
    expect(outputToSource(held, 2500)).toBe(3000);
    expect(outputToSource(held, 3900)).toBe(3000);
    expect(outputToSource(held, 4000)).toBe(3000);
    expect(outputToSource(held, 4100)).toBe(3200);
    expect(sourceToOutput(held, 2998)).toBe(2499);
    expect(sourceToOutput(held, 3000)).toBe(4000);
    expect(sourceToOutput(held, 4000)).toBe(4500);
  });

  it('inserts at a segment boundary without splitting, merges holds at one point, ignores empty holds', () => {
    const held = insertHolds(segs, [
      { atMs: 6000, holdMs: 1000 },
      { atMs: 6000, holdMs: 500 },
      { atMs: 8000, holdMs: 0 },
    ]);
    expect(held).toEqual([
      segs[0],
      segs[1],
      { srcStartMs: 6000, srcEndMs: 6000, speed: 0, holdMs: 1500 },
      segs[2],
    ]);
  });

  it('holds the last frame at the end of the video', () => {
    const held = insertHolds(segs, [{ atMs: 10_000, holdMs: 800 }]);
    expect(held[held.length - 1]).toEqual({ srcStartMs: 10_000, srcEndMs: 10_000, speed: 0, holdMs: 800 });
    expect(outputToSource(held, outputDurationMs(held) - 1)).toBe(10_000);
  });
});
