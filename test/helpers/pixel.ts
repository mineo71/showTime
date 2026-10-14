import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** The RGB colour at (x, y) of an image, or of a video frame at `atMs` (a 2×2 crop: yuv420 video has no 1×1). */
export async function pixelAt(file: string, x: number, y: number, atMs?: number): Promise<[number, number, number]> {
  const seek = atMs === undefined ? [] : ['-ss', (atMs / 1000).toFixed(3)];
  const { stdout } = await exec('ffmpeg', ['-v', 'error', ...seek, '-i', file, '-vf', `crop=2:2:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    encoding: 'buffer',
  });
  return [stdout[0], stdout[1], stdout[2]];
}

/** Close to the popup fixture's #ff00aa. */
export const isPink = ([r, g, b]: number[]) => r > 200 && g < 60 && b > 130;

/** How many pixels differ (by more than a little) between the same region of two images. */
export async function pixelsDiffering(a: string, b: string, r: { x: number; y: number; width: number; height: number }): Promise<number> {
  const crop = async (file: string) =>
    (
      await exec('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=${r.width}:${r.height}:${r.x}:${r.y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
        encoding: 'buffer',
        maxBuffer: 50_000_000,
      })
    ).stdout;
  const [pa, pb] = await Promise.all([crop(a), crop(b)]);
  let n = 0;
  for (let i = 0; i < pa.length; i += 3) {
    if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 60) n++;
  }
  return n;
}
