import { describe, expect, it } from 'vitest';
import { BROWSER_BAR, OUTPUT_SIZES, projectRect, viewLayout, windowLayout, type View } from '../../src/timeline/layout';

const stage = { width: 1440, height: 900 };
const win = { x: 100, y: 50, width: 1440, height: 900, bar: 0 };

describe('projectRect', () => {
  it('offsets by the window when the camera is at rest', () => {
    expect(projectRect({ x: 10, y: 20, width: 30, height: 40 }, { scale: 1, cx: 0.5, cy: 0.5 }, stage, win)).toEqual({
      x: 110,
      y: 70,
      width: 30,
      height: 40,
    });
  });

  it('scales around the camera focus', () => {
    expect(projectRect({ x: 700, y: 440, width: 40, height: 20 }, { scale: 2, cx: 0.5, cy: 0.5 }, stage, win)).toEqual({
      x: 780,
      y: 480,
      width: 80,
      height: 40,
    });
  });

  it('follows the window scale when the window is smaller than the stage', () => {
    const half = { x: 0, y: 0, width: 720, height: 450, bar: 0 };
    expect(projectRect({ x: 100, y: 100, width: 100, height: 100 }, { scale: 1, cx: 0.5, cy: 0.5 }, stage, half)).toEqual({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    });
  });
});

describe('viewLayout', () => {
  const out = OUTPUT_SIZES;
  const covers = (v: View) => {
    expect(v.content.width).toBeGreaterThanOrEqual(v.width);
    expect(v.content.height).toBeGreaterThanOrEqual(v.height);
  };

  it('is the 0.3 window for 16:9, with content the size of the window', () => {
    const v = viewLayout(out['16:9'], stage, 0.06, BROWSER_BAR, '16:9');
    expect(v).toEqual({ ...windowLayout(out['16:9'], stage, 0.06, BROWSER_BAR), content: { width: v.width, height: v.height } });
  });

  it('fills the padded square for 1:1, the viewport covering it', () => {
    const v = viewLayout(out['1:1'], stage, 0.06, BROWSER_BAR, '1:1');
    expect(v.width).toBe(950);
    expect(v.height + v.bar).toBe(950);
    expect(v.x).toBe(65);
    covers(v);
    expect(v.content.width / v.width).toBeGreaterThan(1.4);
  });

  it('puts a window 1.3× taller than wide in the middle of 9:16, covering it', () => {
    const v = viewLayout(out['9:16'], stage, 0.06, BROWSER_BAR, '9:16');
    expect(v.width).toBe(950);
    expect(v.height + v.bar).toBe(1235);
    expect(v.y - v.bar).toBe(Math.round((1920 - 1235) / 2));
    covers(v);
    expect(Math.abs(v.content.height - v.height)).toBeLessThanOrEqual(1);
  });

  it('covers the window with a portrait (mobile) viewport too', () => {
    covers(viewLayout(out['9:16'], { width: 390, height: 844 }, 0.06, BROWSER_BAR, '9:16'));
    covers(viewLayout(out['1:1'], { width: 390, height: 844 }, 0.06, 0, '1:1'));
  });

  it('projects through cropped content', () => {
    const v: View = { x: 0, y: 0, width: 500, height: 500, bar: 0, content: { width: 1000, height: 500 } };
    // Focus at the left quarter: content x 250 sits at the window centre.
    expect(projectRect({ x: 360, y: 0, width: 144, height: 90 }, { scale: 1, cx: 0.25, cy: 0.5 }, { width: 1440, height: 900 }, v)).toEqual({
      x: 250,
      y: 0,
      width: 100,
      height: 50,
    });
  });
});

describe('viewLayout with a band reserved under the window', () => {
  it('shrinks and lifts the window in 16:9 and 1:1, leaving the band free', () => {
    for (const aspect of ['16:9', '1:1'] as const) {
      const out = OUTPUT_SIZES[aspect];
      const plain = viewLayout(out, stage, 0.06, BROWSER_BAR, aspect);
      const band = 119;
      const v = viewLayout(out, stage, 0.06, BROWSER_BAR, aspect, band);
      expect(v.height).toBeLessThan(plain.height);
      expect(v.y + v.height).toBeLessThanOrEqual(out.height - band);
    }
  });

  it('ignores the band in 9:16, which has bands already', () => {
    const out = OUTPUT_SIZES['9:16'];
    expect(viewLayout(out, stage, 0.06, BROWSER_BAR, '9:16', 119)).toEqual(viewLayout(out, stage, 0.06, BROWSER_BAR, '9:16'));
  });
});
