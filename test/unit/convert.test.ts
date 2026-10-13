import { describe, expect, it } from 'vitest';
import { aspectOf, defaultOutput, formatOf } from '../../src/convert';

const loaded = { dir: '/p', name: 'demo' };

describe('output naming and formats', () => {
  it('names outputs by aspect and format next to the script', () => {
    expect(defaultOutput(loaded, '16:9', 'mp4')).toBe('/p/demo.mp4');
    expect(defaultOutput(loaded, '9:16', 'mp4')).toBe('/p/demo-9x16.mp4');
    expect(defaultOutput(loaded, '1:1', 'gif')).toBe('/p/demo-1x1.gif');
    expect(defaultOutput(loaded, '16:9', 'webp')).toBe('/p/demo.webp');
  });

  it('takes the format from the flag, else the extension, else mp4', () => {
    expect(formatOf()).toBe('mp4');
    expect(formatOf('out/clip.GIF')).toBe('gif');
    expect(formatOf('clip.webp')).toBe('webp');
    expect(formatOf('clip.mp4', 'gif')).toBe('gif');
    expect(() => formatOf('clip.mov')).toThrow(/Cannot tell the format from "clip\.mov".*--format/);
    expect(() => formatOf(undefined, 'avi')).toThrow(/--format must be mp4, gif or webp/);
  });

  it('accepts the three aspect ratios', () => {
    expect(aspectOf()).toBe('16:9');
    expect(aspectOf('9:16')).toBe('9:16');
    expect(() => aspectOf('4:3')).toThrow(/--aspect must be 16:9, 9:16 or 1:1/);
  });
});
