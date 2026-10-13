import { describe, expect, it } from 'vitest';
import { parseScript } from '../../src/script/schema';
import { buildTimeline } from '../../src/timeline/build';
import type { TakeEvents } from '../../src/timeline/types';

const script = (style: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  parseScript({
    version: 1,
    meta: { title: 'Demo', subtitle: 'Sub' },
    app: { url: 'http://x' },
    style,
    scenes: [
      {
        id: 's',
        steps: [
          { do: 'click', target: '#a', show: { caption: 'Open it' } },
          { do: 'wait', for: 'text=Ready' },
          { do: 'type', target: '#q', text: 'hi', show: { spotlight: true } },
          { do: 'press', key: 'Enter', show: { speed: 2 } },
        ],
      },
    ],
    ...overrides,
  });

const events: TakeEvents = {
  version: 1,
  actionHash: 'x',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  video: { file: 'raw.mp4', width: 2880, height: 1800, fps: 30, durationMs: 12_000 },
  steps: [
    { sceneId: 's', index: 0, do: 'click', startMs: 800, actionMs: 1400, endMs: 1450, settledMs: 1900, target: { x: 100, y: 100, width: 120, height: 40 } },
    { sceneId: 's', index: 1, do: 'wait', startMs: 1900, actionMs: 1900, endMs: 5900, settledMs: 6400 },
    { sceneId: 's', index: 2, do: 'type', startMs: 6400, actionMs: 7000, endMs: 7600, settledMs: 8100, target: { x: 600, y: 400, width: 300, height: 40 } },
    { sceneId: 's', index: 3, do: 'press', startMs: 8100, actionMs: 8100, endMs: 8150, settledMs: 8600 },
  ],
  moves: [
    { startMs: 800, endMs: 1400, from: { x: 720, y: 450 }, to: { x: 160, y: 120 }, cursor: 'pointer' },
    { startMs: 6400, endMs: 7000, from: { x: 160, y: 120 }, to: { x: 750, y: 420 }, cursor: 'text' },
  ],
  clicks: [
    { tMs: 1400, x: 160, y: 120 },
    { tMs: 7000, x: 750, y: 420 },
  ],
  idle: [{ startMs: 1900, endMs: 5900 }],
};

describe('buildTimeline', () => {
  const t = buildTimeline(script(), events);

  it('carries the take and defaults', () => {
    expect(t).toMatchObject({ version: 1, fps: 30, output: { width: 1920, height: 1080 }, stage: { width: 1440, height: 900 } });
    expect(t.video).toEqual({ src: 'raw.mp4', durationMs: 12_000 });
    expect(t.intro).toEqual({ title: 'Demo', subtitle: 'Sub', durationMs: 2200 });
    expect(t.moves).toBe(events.moves);
    expect(t.clicks).toBe(events.clicks);
  });

  it('speeds up idle time and honours explicit speed', () => {
    expect(t.segments).toEqual([
      { srcStartMs: 0, srcEndMs: 1900, speed: 1 },
      { srcStartMs: 1900, srcEndMs: 5900, speed: 4000 / 600 },
      { srcStartMs: 5900, srcEndMs: 8100, speed: 1 },
      { srcStartMs: 8100, srcEndMs: 8600, speed: 2 },
      { srcStartMs: 8600, srcEndMs: 12_000, speed: 1 },
    ]);
  });

  it('builds captions with a minimum duration', () => {
    expect(t.captions).toEqual([{ startMs: 800, endMs: 2300, text: 'Open it' }]);
  });

  it('builds padded spotlights from the action to settle', () => {
    expect(t.spotlights).toEqual([{ startMs: 7000, endMs: 8100, rect: { x: 592, y: 392, width: 316, height: 56 } }]);
  });

  it('zooms on click and type, separately when far apart', () => {
    expect(t.camera.map((k) => k.tMs)).toEqual([700, 1400, 1900, 2600, 6300, 7000, 8100, 8800]);
    expect(t.camera[1]).toMatchObject({ scale: 1.8 });
    expect(t.camera[1].cx).toBeCloseTo(0.5 / 1.8);
  });

  it('skips auto zoom and auto speed when disabled', () => {
    const off = buildTimeline(script({ autoZoom: false, autoSpeed: false }), events);
    expect(off.camera).toEqual([]);
    expect(off.segments.map((s) => s.speed)).toEqual([1, 2, 1]);
  });

  it('respects zoom: false and explicit zoom depth', () => {
    const s = script({}, {});
    s.scenes[0].steps[0] = { do: 'click', target: '#a', show: { zoom: false } };
    s.scenes[0].steps[2] = { do: 'type', target: '#q', text: 'hi', pace: 'human', clear: false, show: { zoom: 1.3 } };
    const z = buildTimeline(s, events);
    expect(z.camera.map((k) => k.scale)).toEqual([1, 1.3, 1.3, 1]);
  });

  it('has no intro without a title', () => {
    expect(buildTimeline(script({}, { meta: {} }), events).intro).toBeNull();
  });

  it('refuses events that do not match the script', () => {
    const bad = { ...events, steps: [{ ...events.steps[0], sceneId: 'nope' }] };
    expect(() => buildTimeline(script(), bad)).toThrow(/does not match the script/);
  });
});
