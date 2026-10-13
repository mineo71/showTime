import { describe, expect, it } from 'vitest';
import { parseScript } from '../../src/script/schema';
import { buildTimeline } from '../../src/timeline/build';
import { NARRATION_GAP_MS } from '../../src/timeline/narration';
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
    expect(t.video).toEqual({ src: 'take/raw.mp4', durationMs: 12_000 });
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
    expect(t.captions).toEqual([{ startMs: 800, endMs: 2300, text: 'Open it', position: 'bottom' }]);
  });

  it('ends a caption when the next one starts, so they never overlap', () => {
    const s = script();
    s.scenes[0].steps[1] = { do: 'wait', for: 'text=Ready', show: { caption: 'Loading' } };
    const c = buildTimeline(s, events).captions;
    expect(c.map((x) => [x.startMs, x.endMs, x.text])).toEqual([
      [800, 1900, 'Open it'],
      [1900, 6400, 'Loading'],
    ]);
  });

  it('moves a caption to the top when its target sits where bottom captions go', () => {
    const low = { ...events, steps: events.steps.map((e, i) => (i === 0 ? { ...e, target: { x: 600, y: 830, width: 200, height: 40 } } : e)) };
    expect(buildTimeline(script(), low).captions[0].position).toBe('top');
    const none = script();
    none.scenes[0].steps[3] = { do: 'press', key: 'Enter', show: { caption: 'Go' } };
    expect(buildTimeline(none, events).captions.find((c) => c.text === 'Go')?.position).toBe('bottom');
  });

  it('carries the outro card and the logo', () => {
    expect(t.outro).toBeNull();
    expect(t.logo).toBeNull();
    const s = script({}, { meta: { title: 'Demo', outro: { title: 'Try it', url: 'acme.com' } } });
    const o = buildTimeline(s, events, { logo: 'data:image/svg+xml;base64,PHN2Zy8+' });
    expect(o.outro).toEqual({ title: 'Try it', url: 'acme.com', durationMs: 2600 });
    expect(o.logo).toBe('data:image/svg+xml;base64,PHN2Zy8+');
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

  it('frames the take in a browser window showing the app address', () => {
    expect(t.chrome).toEqual({ address: 'x', dark: false });
    const app = (extra: Record<string, unknown>) => ({ app: { url: 'http://127.0.0.1:4800/fennel/', ...extra } });
    expect(buildTimeline(script({}, app({})), events).chrome).toEqual({ address: '127.0.0.1:4800/fennel', dark: false });
    expect(buildTimeline(script({ address: 'fennel.app' }, app({ colorScheme: 'dark' })), events).chrome).toEqual({ address: 'fennel.app', dark: true });
    expect(buildTimeline(script({ chrome: 'none' }), events).chrome).toBeNull();
  });

  it('has no intro without a title', () => {
    expect(buildTimeline(script({}, { meta: {} }), events).intro).toBeNull();
  });

  it('refuses events that do not match the script', () => {
    const bad = { ...events, steps: [{ ...events.steps[0], sceneId: 'nope' }] };
    expect(() => buildTimeline(script(), bad)).toThrow(/does not match the script/);
  });
});

describe('buildTimeline: sound', () => {
  const voiced = (audio: Record<string, unknown> = {}) => {
    const s = script({}, { audio });
    s.scenes[0].steps[0] = { do: 'click', target: '#a', show: { caption: 'Open it', say: 'Open the reports page and look around.' } };
    s.scenes[0].steps[2] = { do: 'type', target: '#q', text: 'hi', pace: 'human', clear: false, show: { say: 'Search.' } };
    return s;
  };
  const voices = { 's#1': 7000, 's#3': 1000 };

  it('holds the frame until a line ends, just before the next narrated step', () => {
    const t = buildTimeline(voiced(), events, { voices });
    expect(t.segments.find((s) => s.speed === 0)).toMatchObject({ srcStartMs: 6399 });
    expect(t.narration.map((n) => n.where)).toEqual(['s#1', 's#3']);
    expect(t.narration[0]).toMatchObject({ text: 'Open the reports page and look around.', atMs: 800, durationMs: 7000 });
    expect(t.narration[1].atMs - t.narration[0].atMs).toBe(7000 + NARRATION_GAP_MS);
  });

  it('skips lines without a synthesized voice, and adds no holds then', () => {
    const t = buildTimeline(voiced(), events);
    expect(t.narration).toEqual([]);
    expect(t.segments.some((s) => s.speed === 0)).toBe(false);
    expect(t.subtitles).toEqual([]);
  });

  it('builds subtitle cues from the lines, and burns them in on request with captions on top', () => {
    const file = buildTimeline(voiced(), events, { voices });
    expect(file.subtitles.map((c) => c.text)).toEqual(['Open the reports page and look around.', 'Search.']);
    expect(file.subtitles[0]).toMatchObject({ startMs: 800, endMs: 7800 });
    expect(file.subtitlesBurned).toBe(false);
    expect(file.captions[0].position).toBe('bottom');
    const burn = buildTimeline(voiced({ subtitles: 'burn' }), events, { voices });
    expect(burn.subtitlesBurned).toBe(true);
    expect(burn.captions[0].position).toBe('top');
    expect(buildTimeline(voiced({ subtitles: 'off' }), events, { voices }).subtitles).toEqual([]);
  });

  it('adds click and key sounds when asked, keys spread over the type step for older takes', () => {
    expect(buildTimeline(voiced(), events).sounds).toEqual([]);
    const s = buildTimeline(voiced({ sounds: true }), events).sounds;
    expect(s.filter((e) => e.kind === 'click')).toHaveLength(2);
    expect(s.filter((e) => e.kind === 'key')).toHaveLength(2);
    const logged = buildTimeline(voiced({ sounds: true }), { ...events, keys: [7100, 7200, 7300] }).sounds;
    expect(logged.filter((e) => e.kind === 'key')).toHaveLength(3);
  });

  it('carries the music volume; the mix file is set later by the pipeline', () => {
    const t = buildTimeline(voiced({ music: { file: '/m.mp3', volume: 0.4 } }), events);
    expect(t.music).toEqual({ volume: 0.4 });
    expect(t.audio).toBeNull();
    expect(buildTimeline(voiced(), events).music).toBeNull();
  });
});
