import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav, readWav, wavDurationMs, writeWav } from '../../src/audio/wav';

describe('wav', () => {
  const left = Float32Array.from([0, 0.5, -0.5, 1, -1]);
  const right = Float32Array.from([0.25, -0.25, 0, 0.75, -0.75]);

  it('writes 16-bit PCM with a valid header and reads it back', () => {
    const buf = encodeWav([left, right], 48_000);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.readUInt16LE(22)).toBe(2);
    expect(buf.readUInt32LE(24)).toBe(48_000);
    expect(buf.length).toBe(44 + 5 * 2 * 2);
    const back = decodeWav(buf);
    expect(back.rate).toBe(48_000);
    expect(back.channels).toHaveLength(2);
    back.channels[0].forEach((v, i) => expect(v).toBeCloseTo(left[i], 3));
    back.channels[1].forEach((v, i) => expect(v).toBeCloseTo(right[i], 3));
  });

  it('clips out-of-range samples instead of wrapping', () => {
    const back = decodeWav(encodeWav([Float32Array.from([1.7, -3])], 8000));
    expect(back.channels[0][0]).toBeCloseTo(1, 3);
    expect(back.channels[0][1]).toBeCloseTo(-1, 3);
  });

  it('round-trips through a file and knows its duration', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'showtime-wav-')), 'a.wav');
    await writeWav(file, [new Float32Array(24_000)], 48_000);
    expect((await readWav(file)).channels[0]).toHaveLength(24_000);
    expect(await wavDurationMs(file)).toBe(500);
  });

  it('rejects files that are not 16-bit PCM WAV', () => {
    expect(() => decodeWav(Buffer.from('nope'))).toThrow(/not a 16-bit PCM WAV/);
  });
});
