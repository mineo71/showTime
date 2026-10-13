import { describe, expect, it } from 'vitest';
import { buildSegments, outputDurationMs, outputToSource, sourceToOutput } from '../../src/timeline/timemap';

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
