import { describe, expect, it } from 'vitest';
import { captionMsFor, speedFor } from '../../src/studio/client/drag';

describe('timeline dragging', () => {
  const step = { srcMs: 1000, holdMs: 0, stepFrames: 30, blockFrames: 30 };

  it('sets the speed that makes the step take the dragged length, within 0.25–16×', () => {
    expect(speedFor(step, 60, 30)).toBe(0.5);
    expect(speedFor(step, 15, 30)).toBe(2);
    expect(speedFor(step, 1, 30)).toBe(16);
    expect(speedFor(step, 0, 30)).toBe(16);
    expect(speedFor(step, 10_000, 30)).toBe(0.25);
  });

  it('keeps holds inside the step and the gap after it at their length', () => {
    // 1000 ms of source plus a 500 ms freeze, dragged to 2 s: the source part gets 1.5 s.
    expect(speedFor({ srcMs: 1000, holdMs: 500, stepFrames: 45, blockFrames: 45 }, 60, 30)).toBe(0.67);
    // A 10-frame tail before the next step stays 10 frames.
    expect(speedFor({ srcMs: 1000, holdMs: 0, stepFrames: 30, blockFrames: 40 }, 70, 30)).toBe(0.5);
  });

  it('turns a caption bar length into captionMs, from 200 ms to a minute', () => {
    expect(captionMsFor(45, 30)).toBe(1500);
    expect(captionMsFor(1, 30)).toBe(200);
    expect(captionMsFor(1e6, 30)).toBe(60_000);
  });
});
