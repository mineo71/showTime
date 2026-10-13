import { describe, expect, it } from 'vitest';
import { buildCamera, cameraAt, cameraTransform, clampFocus, zoomDepth } from '../../src/timeline/camera';

const stage = { width: 1440, height: 900 };

describe('zoomDepth', () => {
  it('zooms small targets up to maxZoom', () => {
    expect(zoomDepth({ x: 0, y: 0, width: 120, height: 40 }, stage, 1.8)).toBe(1.8);
  });
  it('does not zoom targets that fill the stage', () => {
    expect(zoomDepth({ x: 0, y: 0, width: 1400, height: 880 }, stage, 1.8)).toBe(1);
  });
  it('fits medium targets with margin', () => {
    expect(zoomDepth({ x: 0, y: 0, width: 600, height: 400 }, stage, 3)).toBeCloseTo(900 / 560);
  });
});

describe('clampFocus', () => {
  it('keeps the visible window inside the stage', () => {
    expect(clampFocus(2, 0.1, 0.95)).toEqual({ cx: 0.25, cy: 0.75 });
    expect(clampFocus(1, 0.1, 0.9)).toEqual({ cx: 0.5, cy: 0.5 });
  });
});

describe('buildCamera', () => {
  it('zooms in before and out after a single region', () => {
    const keys = buildCamera([{ startMs: 2000, endMs: 4000, scale: 2, cx: 0.5, cy: 0.5 }]);
    expect(keys).toEqual([
      { tMs: 1300, scale: 1, cx: 0.5, cy: 0.5 },
      { tMs: 2000, scale: 2, cx: 0.5, cy: 0.5 },
      { tMs: 4000, scale: 2, cx: 0.5, cy: 0.5 },
      { tMs: 4700, scale: 1, cx: 0.5, cy: 0.5 },
    ]);
  });

  it('pans between close regions without zooming out', () => {
    const keys = buildCamera([
      { startMs: 2000, endMs: 3000, scale: 2, cx: 0.3, cy: 0.3 },
      { startMs: 4000, endMs: 5000, scale: 1.5, cx: 0.6, cy: 0.6 },
    ]);
    expect(keys.map((k) => k.scale)).toEqual([1, 2, 2, 1.5, 1.5, 1]);
    expect(keys.map((k) => k.tMs)).toEqual([1300, 2000, 3000, 4000, 5000, 5700]);
  });

  it('zooms out between distant regions', () => {
    const keys = buildCamera([
      { startMs: 2000, endMs: 3000, scale: 2, cx: 0.5, cy: 0.5 },
      { startMs: 8000, endMs: 9000, scale: 2, cx: 0.5, cy: 0.5 },
    ]);
    expect(keys.map((k) => k.scale)).toEqual([1, 2, 2, 1, 1, 2, 2, 1]);
  });

  it('never puts a key before 0 and keeps keys monotonic', () => {
    const keys = buildCamera([{ startMs: 300, endMs: 1000, scale: 2, cx: 0.5, cy: 0.5 }]);
    expect(keys[0].tMs).toBe(0);
    for (let i = 1; i < keys.length; i++) expect(keys[i].tMs).toBeGreaterThanOrEqual(keys[i - 1].tMs);
  });

  it('clamps focus into the stage', () => {
    const keys = buildCamera([{ startMs: 2000, endMs: 3000, scale: 2, cx: 0, cy: 1 }]);
    expect(keys[1]).toMatchObject({ cx: 0.25, cy: 0.75 });
  });
});

describe('cameraAt', () => {
  const keys = buildCamera([{ startMs: 2000, endMs: 4000, scale: 2, cx: 0.5, cy: 0.5 }]);

  it('is identity without keys', () => {
    expect(cameraAt([], 123)).toEqual({ tMs: 123, scale: 1, cx: 0.5, cy: 0.5 });
  });
  it('holds the first and last key outside the range', () => {
    expect(cameraAt(keys, 0).scale).toBe(1);
    expect(cameraAt(keys, 99_999).scale).toBe(1);
  });
  it('eases between keys', () => {
    expect(cameraAt(keys, 1650).scale).toBeCloseTo(1.5);
    expect(cameraAt(keys, 3000).scale).toBe(2);
  });
});

describe('cameraTransform', () => {
  it('is the identity at scale 1', () => {
    expect(cameraTransform({ tMs: 0, scale: 1, cx: 0.5, cy: 0.5 }, 100, 50)).toBe('translate(0px, 0px) scale(1)');
  });
  it('puts the focus at the centre', () => {
    expect(cameraTransform({ tMs: 0, scale: 2, cx: 0.75, cy: 0.25 }, 100, 100)).toBe('translate(-100px, 0px) scale(2)');
  });
});
