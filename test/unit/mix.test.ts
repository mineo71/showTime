import { describe, expect, it } from 'vitest';
import { DUCK, mixTrack, musicGain } from '../../src/audio/mix';

const fill = (n: number, v: number) => new Float32Array(n).fill(v);
const RATE = 1000; // one sample per ms keeps indices readable

describe('musicGain', () => {
  const spans = [{ startMs: 1800, endMs: 2300 }];
  it('fades in, ducks under the voice with ramps, and fades out', () => {
    expect(musicGain(0, [], 5000)).toBe(0);
    expect(musicGain(400, [], 5000)).toBeCloseTo(0.5);
    expect(musicGain(1000, spans, 5000)).toBe(1);
    expect(musicGain(1650, spans, 5000)).toBeCloseTo(1 - (1 - DUCK) * 0.5);
    expect(musicGain(2000, spans, 5000)).toBeCloseTo(DUCK);
    expect(musicGain(2450, spans, 5000)).toBeCloseTo(1 - (1 - DUCK) * 0.5);
    expect(musicGain(4000, [], 5000)).toBeCloseTo(0.5);
    expect(musicGain(5000, [], 5000)).toBe(0);
  });
});

describe('mixTrack', () => {
  it('places a voice at its offset on both channels', () => {
    const [l, r] = mixTrack({ rate: RATE, totalMs: 2000, voices: [{ samples: fill(100, 0.5), atMs: 500 }], sounds: [] });
    expect(l).toHaveLength(2000);
    expect(l[499]).toBe(0);
    expect(l[500]).toBeCloseTo(0.5);
    expect(r[599]).toBeCloseTo(0.5);
    expect(l[600]).toBe(0);
  });

  it('loops the music under the whole track at its volume, ducked while a voice plays', () => {
    const music = { channels: [fill(300, 1), fill(300, 1)], volume: 0.5 };
    const [l] = mixTrack({ rate: RATE, totalMs: 5000, music, voices: [{ samples: fill(500, 0), atMs: 1800 }], sounds: [] });
    expect(l[1000]).toBeCloseTo(0.5);
    expect(l[1299]).toBeCloseTo(0.5); // past the end of the 300-sample loop
    expect(l[2000]).toBeCloseTo(0.5 * DUCK);
    expect(l[4999]).toBeLessThan(0.01);
  });

  it('upmixes mono music', () => {
    const [l, r] = mixTrack({ rate: RATE, totalMs: 3000, music: { channels: [fill(3000, 1)], volume: 0.5 }, voices: [], sounds: [] });
    expect(l[900]).toBeCloseTo(0.5);
    expect(r[900]).toBeCloseTo(0.5);
  });

  it('adds sounds with their gain, and stops at the end of the track', () => {
    const [l] = mixTrack({ rate: RATE, totalMs: 1000, voices: [], sounds: [{ samples: fill(50, 1), atMs: 980, gain: 0.25 }] });
    expect(l[980]).toBeCloseTo(0.25);
    expect(l).toHaveLength(1000);
  });

  it('scales the track down when overlapping parts would clip', () => {
    const voices = [
      { samples: fill(100, 0.8), atMs: 0 },
      { samples: fill(100, 0.8), atMs: 50 },
    ];
    const [l, r] = mixTrack({ rate: RATE, totalMs: 200, voices, sounds: [] });
    const peak = Math.max(...l.map(Math.abs), ...r.map(Math.abs));
    expect(peak).toBeLessThan(0.99);
    expect(l[25] / l[75]).toBeCloseTo(0.5);
  });
});

describe('mixTrack: clips', () => {
  it('places a stereo clip at its offset with its gain, and ducks the music under it', () => {
    const clip = { channels: [fill(200, 0.4), fill(200, -0.4)], atMs: 2000, gain: 0.5 };
    const music = { channels: [fill(5000, 1)], volume: 0.5 };
    const [l, r] = mixTrack({ rate: RATE, totalMs: 5000, music, voices: [], sounds: [], clips: [clip] });
    expect(l[1000]).toBeCloseTo(0.5);
    expect(l[2100]).toBeCloseTo(0.4 * 0.5 + 0.5 * DUCK);
    expect(r[2100]).toBeCloseTo(-0.4 * 0.5 + 0.5 * DUCK);
  });
});
