import { describe, expect, it } from 'vitest';
import { introFrames, outroFrames, qaShots, segmentPlan, sourceMsAtFrame, totalFrames, videoEndFrame } from '../../src/timeline/frames';
import { windowLayout } from '../../src/timeline/layout';
import type { StepEvent, Timeline } from '../../src/timeline/types';

const timeline = (intro: boolean, outro = false): Timeline =>
  ({
    version: 1,
    fps: 30,
    aspect: '16:9',
    output: { width: 1920, height: 1080 },
    stage: { width: 1440, height: 900 },
    video: { src: 'raw.mp4', durationMs: 10_000 },
    intro: intro ? { title: 'T', durationMs: 2200 } : null,
    chrome: null,
    outro: outro ? { title: 'Try it', durationMs: 2600 } : null,
    logo: null,
    segments: [
      { srcStartMs: 0, srcEndMs: 2000, speed: 1 },
      { srcStartMs: 2000, srcEndMs: 6000, speed: 4 },
      { srcStartMs: 6000, srcEndMs: 10_000, speed: 1 },
    ],
    camera: [],
    moves: [],
    clicks: [],
    captions: [],
    spotlights: [],
    narration: [],
    subtitles: [],
    subtitlesBurned: false,
    sounds: [],
    music: null,
    audio: null,
    style: {} as Timeline['style'],
  }) as Timeline;

describe('frame math', () => {
  const t = timeline(true);

  it('counts intro and output frames', () => {
    expect(introFrames(t)).toBe(66);
    expect(introFrames(timeline(false))).toBe(0);
    expect(totalFrames(t)).toBe(66 + 210);
  });

  it('plans one sequence per segment, back to back', () => {
    expect(segmentPlan(t)).toEqual([
      { fromFrame: 66, durationInFrames: 60, trimBefore: 0, speed: 1 },
      { fromFrame: 126, durationInFrames: 30, trimBefore: 60, speed: 4 },
      { fromFrame: 156, durationInFrames: 120, trimBefore: 180, speed: 1 },
    ]);
  });

  it('plans a hold as a frozen sequence at the hold point', () => {
    const held = {
      ...t,
      segments: [
        { srcStartMs: 0, srcEndMs: 2000, speed: 1 },
        { srcStartMs: 2000, srcEndMs: 2000, speed: 0, holdMs: 1000 },
        { srcStartMs: 2000, srcEndMs: 4000, speed: 1 },
      ],
    } as Timeline;
    expect(segmentPlan(held)).toEqual([
      { fromFrame: 66, durationInFrames: 60, trimBefore: 0, speed: 1 },
      { fromFrame: 126, durationInFrames: 30, trimBefore: 60, speed: 0 },
      { fromFrame: 156, durationInFrames: 60, trimBefore: 60, speed: 1 },
    ]);
    expect(totalFrames(held)).toBe(66 + 150);
    expect(sourceMsAtFrame(held, 140)).toBe(2000);
  });

  it('maps frames to source time', () => {
    expect(sourceMsAtFrame(t, 65)).toBeNull();
    expect(sourceMsAtFrame(t, 66)).toBe(0);
    expect(sourceMsAtFrame(t, 66 + 75)).toBeCloseTo(4000);
  });

  it('adds the outro after the video', () => {
    const o = timeline(true, true);
    expect(outroFrames(o)).toBe(78);
    expect(videoEndFrame(o)).toBe(66 + 210);
    expect(totalFrames(o)).toBe(66 + 210 + 78);
    expect(qaShots(o, []).at(-1)).toEqual({ frame: 66 + 210 + 47, name: '99-outro' });
    expect(outroFrames(t)).toBe(0);
  });

  it('lists QA shots: intro, then one per step at mid-action', () => {
    const steps: StepEvent[] = [
      { sceneId: 'a', index: 0, do: 'click', startMs: 0, actionMs: 1000, endMs: 1100, settledMs: 1600 },
      { sceneId: 'a', index: 1, do: 'wait', startMs: 1600, actionMs: 1600, endMs: 5600, settledMs: 6400 },
    ];
    expect(qaShots(t, steps)).toEqual([
      { frame: 33, name: '00-intro' },
      { frame: 66 + 39, name: '01-a-1-click' },
      { frame: 66 + Math.round(((2000 + (4000 - 2000) / 4) * 30) / 1000), name: '02-a-2-wait' },
    ]);
  });
});

describe('windowLayout', () => {
  it('fits the stage inside the padded output, centred', () => {
    expect(windowLayout({ width: 1920, height: 1080 }, { width: 1440, height: 900 }, 0.06)).toEqual({
      x: 200,
      y: 65,
      width: 1521,
      height: 950,
      bar: 0,
    });
  });
  it('fills the output without padding when aspect ratios match', () => {
    expect(windowLayout({ width: 1920, height: 1080 }, { width: 1280, height: 720 }, 0)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      bar: 0,
    });
  });
  it('fits a browser bar above the viewport and returns the viewport box', () => {
    // k = min(1689.6 / 1440, 950.4 / 944) = 1.00678 → viewport 1450×906, bar 44, block 950 tall at y 65
    expect(windowLayout({ width: 1920, height: 1080 }, { width: 1440, height: 900 }, 0.06, 44)).toEqual({
      x: 235,
      y: 109,
      width: 1450,
      height: 906,
      bar: 44,
    });
  });
});
