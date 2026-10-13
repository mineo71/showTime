import { describe, expect, it } from 'vitest';
import { projectRect } from '../../src/timeline/layout';

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
