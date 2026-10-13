import { randomBytes } from 'node:crypto';
import { open, readFile, rename, writeFile } from 'node:fs/promises';

/** Sample rate of everything showTime mixes. */
export const RATE = 48_000;
const HEADER = 44;

/** 16-bit PCM WAV from channels of float samples in [-1, 1] (out-of-range samples clip). */
export function encodeWav(channels: Float32Array[], rate = RATE): Buffer {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const data = n * ch * 2;
  const buf = Buffer.alloc(HEADER + data);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data, 40);
  let o = HEADER;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return buf;
}

interface Format {
  channels: number;
  rate: number;
  dataStart: number;
  dataBytes: number;
}

/** Find the fmt and data chunks of a 16-bit PCM WAV. */
function parseHeader(buf: Buffer): Format {
  const bad = () => new Error('not a 16-bit PCM WAV file');
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw bad();
  let o = 12;
  let fmt: Omit<Format, 'dataStart' | 'dataBytes'> | null = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      if (buf.readUInt16LE(o + 8) !== 1 || buf.readUInt16LE(o + 22) !== 16) throw bad();
      fmt = { channels: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12) };
    } else if (id === 'data') {
      if (!fmt) throw bad();
      return { ...fmt, dataStart: o + 8, dataBytes: Math.min(size, buf.length - o - 8) };
    }
    o += 8 + size + (size % 2);
  }
  throw bad();
}

export function decodeWav(buf: Buffer): { rate: number; channels: Float32Array[] } {
  const f = parseHeader(buf);
  const n = Math.floor(f.dataBytes / (2 * f.channels));
  const channels = Array.from({ length: f.channels }, () => new Float32Array(n));
  let o = f.dataStart;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < f.channels; c++) {
      channels[c][i] = buf.readInt16LE(o) / 32767;
      o += 2;
    }
  }
  return { rate: f.rate, channels };
}

/** Write a WAV through a temp file and a rename, so a reader never sees half of it. */
export async function writeWav(file: string, channels: Float32Array[], rate = RATE): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, encodeWav(channels, rate));
  await rename(tmp, file);
}

export const readWav = async (file: string) => decodeWav(await readFile(file));

/** Length of a WAV file from its header alone. */
export async function wavDurationMs(file: string): Promise<number> {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    const f = parseHeader(head.subarray(0, bytesRead));
    const { size } = await fh.stat();
    const bytes = Math.min(size - f.dataStart, head.readUInt32LE(f.dataStart - 4));
    return Math.round((bytes / (2 * f.channels) / f.rate) * 1000);
  } finally {
    await fh.close();
  }
}
