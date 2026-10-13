import { describe, expect, it } from 'vitest';
import { sampleFrames } from '../../src/runner/encode';

describe('sampleFrames', () => {
  const frames = [
    { file: 'a', tMs: 20 },
    { file: 'b', tMs: 520 },
  ];

  it('picks the latest captured frame for every output frame, first frame from 0', () => {
    expect(sampleFrames(frames, 1000, 10)).toEqual(['a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
  });

  it('yields exactly duration × fps frames, so static stretches keep wall-clock time', () => {
    expect(sampleFrames(frames, 16_700, 30)).toHaveLength(501);
  });

  it('always yields at least one frame', () => {
    expect(sampleFrames(frames, 10, 30)).toEqual(['a']);
  });
});
