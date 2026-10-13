import { describe, expect, it } from 'vitest';
import { clickSamples, keySamples } from '../../src/audio/sfx';

const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('sfx', () => {
  it('synthesizes a short, audible, deterministic click', () => {
    const c = clickSamples(48_000);
    expect(c.length / 48).toBeGreaterThanOrEqual(30);
    expect(c.length / 48).toBeLessThanOrEqual(80);
    expect(peak(c)).toBeGreaterThan(0.2);
    expect(peak(c)).toBeLessThanOrEqual(1);
    expect(clickSamples(48_000)).toEqual(c);
    expect(Math.abs(c[c.length - 1])).toBeLessThan(0.01);
  });

  it('synthesizes shorter keystroke ticks in a few variants', () => {
    const a = keySamples(48_000, 0);
    const b = keySamples(48_000, 1);
    expect(a.length).toBeLessThan(clickSamples(48_000).length);
    expect(peak(a)).toBeGreaterThan(0.1);
    expect(a).not.toEqual(b);
  });
});
