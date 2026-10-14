import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Shot } from '../timeline/frames';
import type { Timeline } from '../timeline/types';

const ENTRY = fileURLToPath(new URL('./remotion/index.ts', import.meta.url));
const COMPOSITION_ID = 'ShowtimeVideo';

/** Bundle the composition with `.showtime/<name>/` as public dir: the take is staticFile('take/raw.mp4'). */
async function prepare(timeline: Timeline, publicDir: string) {
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir, symlinkPublicDir: true });
  const inputProps = { timeline };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, logLevel: 'error' });
  return { serveUrl, inputProps, composition };
}

export async function renderVideo(
  timeline: Timeline,
  publicDir: string,
  out: string,
  onProgress?: (progress: number) => void,
  /** inclusive composition frames, for a --scenes cut */
  range?: { from: number; to: number },
): Promise<void> {
  const r = await prepare(timeline, publicDir);
  await renderMedia({
    ...r,
    frameRange: range ? [range.from, range.to] : null,
    codec: 'h264',
    crf: 18,
    outputLocation: out,
    overwrite: true,
    logLevel: 'error',
    onProgress: ({ progress }) => onProgress?.(progress),
  });
}

export async function renderStills(timeline: Timeline, publicDir: string, outDir: string, shots: Shot[]): Promise<string[]> {
  const r = await prepare(timeline, publicDir);
  const files: string[] = [];
  for (const shot of shots) {
    const output = path.join(outDir, `${shot.name}.png`);
    await renderStill({ ...r, frame: shot.frame, output, imageFormat: 'png', overwrite: true, logLevel: 'error' });
    files.push(output);
  }
  return files;
}
