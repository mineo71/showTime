import { readFile } from 'node:fs/promises';
import { runWithInput } from '../ffmpeg';
import type { Frame } from './capture';

/**
 * Resample the variable-rate screencast to constant fps: output frame k shows the latest frame
 * captured at or before k/fps (the first frame also covers the time before it arrived).
 * Yields exactly round(duration × fps) frames, so static stretches keep wall-clock time.
 */
export function sampleFrames(frames: Frame[], durationMs: number, fps: number): string[] {
  const n = Math.max(1, Math.round((durationMs * fps) / 1000));
  const out: string[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (k * 1000) / fps;
    while (j + 1 < frames.length && frames[j + 1].tMs <= t) j++;
    out.push(frames[j].file);
  }
  return out;
}

export async function encodeFrames(frames: Frame[], out: string, opts: { fps: number; durationMs: number }): Promise<void> {
  if (!frames.length) throw new Error('No frames were captured (did the page render anything?)');
  const files = sampleFrames(frames, opts.durationMs, opts.fps);
  const fps = String(opts.fps);
  await runWithInput(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-r', fps,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14',
      '-movflags', '+faststart',
      out,
    ],
    async (write) => {
      let lastFile = '';
      let lastData = Buffer.alloc(0);
      for (const file of files) {
        if (file !== lastFile) {
          lastData = await readFile(file);
          lastFile = file;
        }
        await write(lastData);
      }
    },
  );
}
