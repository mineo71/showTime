import { describe, expect, it } from 'vitest';
import { captionMsFor, dragRange, speedFor } from '../../src/studio/client/drag';

describe('timeline dragging', () => {
  const step = { srcMs: 1000, freezeMs: 0, narrationMs: 0, stepFrames: 30, blockFrames: 30 };

  it('sets the speed that makes the step take the dragged length, within 0.25–16×', () => {
    expect(speedFor(step, 60, 30)).toBe(0.5);
    expect(speedFor(step, 15, 30)).toBe(2);
    expect(speedFor(step, 1, 30)).toBe(16);
    expect(speedFor(step, 0, 30)).toBe(16);
    expect(speedFor(step, 10_000, 30)).toBe(0.25);
    expect(dragRange(step, 30)).toEqual({ min: 2, max: 120 });
  });

  it('keeps a freeze inside the step and the gap after it at their length', () => {
    // 1000 ms of source plus a 500 ms freeze, dragged to 2 s: the source part gets 1.5 s.
    expect(speedFor({ ...step, freezeMs: 500, stepFrames: 45, blockFrames: 45 }, 60, 30)).toBe(0.67);
    // A 10-frame tail before the next step stays 10 frames.
    expect(speedFor({ ...step, blockFrames: 40 }, 70, 30)).toBe(0.5);
  });

  it('cannot shorten a step held by narration; lengthening it takes the hold\'s place', () => {
    // 1000 ms of source held 2000 ms more for a narration line: 3 s on screen.
    const narrated = { ...step, narrationMs: 2000, stepFrames: 90, blockFrames: 90 };
    expect(speedFor(narrated, 60, 30)).toBeNull();
    expect(speedFor(narrated, 90, 30)).toBeNull();
    expect(speedFor(narrated, 120, 30)).toBe(0.25);
    expect(speedFor(narrated, 100, 30)).toBe(0.3);
    expect(dragRange(narrated, 30).min).toBe(90);
  });

  it('turns a caption bar length into captionMs, from 200 ms to a minute', () => {
    expect(captionMsFor(45, 30)).toBe(1500);
    expect(captionMsFor(1, 30)).toBe(200);
    expect(captionMsFor(1e6, 30)).toBe(60_000);
  });
});
