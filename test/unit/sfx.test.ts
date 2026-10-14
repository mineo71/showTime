import { describe, expect, it } from 'vitest';
import { clickSamples, keySamples } from '../../src/audio/sfx';
import { SOUND_PACKS } from '../../src/script/schema';

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

describe('sound packs', () => {
  it('keeps soft as the 0.4 sound', () => {
    expect(clickSamples(48_000, 'soft')).toEqual(clickSamples(48_000));
    expect(keySamples(48_000, 2, 'soft')).toEqual(keySamples(48_000, 2));
  });

  it('gives every pack its own audible click and key', () => {
    const clicks = SOUND_PACKS.map((p) => clickSamples(48_000, p));
    const keys = SOUND_PACKS.map((p) => keySamples(48_000, 0, p));
    for (const s of [...clicks, ...keys]) {
      expect(peak(s)).toBeGreaterThan(0.1);
      expect(peak(s)).toBeLessThanOrEqual(1);
      expect(Math.abs(s[s.length - 1])).toBeLessThan(0.02);
    }
    const distinct = (list: Float32Array[]) => new Set(list.map((s) => `${s.length}:${s.slice(0, 64).join(',')}`)).size;
    expect(distinct(clicks)).toBe(SOUND_PACKS.length);
    expect(distinct(keys)).toBe(SOUND_PACKS.length);
  });
});

describe('soundSettings', () => {
  it('reads true, a pack name or an object as one shape', async () => {
    const { soundSettings } = await import('../../src/audio/soundtrack');
    expect(soundSettings(true)).toEqual({ pack: 'soft', volume: 1 });
    expect(soundSettings('pop')).toEqual({ pack: 'pop', volume: 1 });
    expect(soundSettings({ pack: 'tap', key: '/k.wav', volume: 0.4 })).toEqual({ pack: 'tap', key: '/k.wav', volume: 0.4 });
  });
});
