import path from 'node:path';
import { run } from './ffmpeg';
import type { Aspect } from './timeline/types';

export type Format = 'mp4' | 'gif' | 'webp';
const FORMATS: readonly Format[] = ['mp4', 'gif', 'webp'];
const ASPECTS: readonly Aspect[] = ['16:9', '9:16', '1:1'];

/** GIF/WebP width when --width is not given. */
export const ANIMATION_WIDTH: Record<Aspect, number> = { '16:9': 960, '9:16': 540, '1:1': 720 };
const GIF_FPS = 15;
const WEBP_FPS = 20;
const WEBP_QUALITY = 76;

export function aspectOf(flag = '16:9'): Aspect {
  if (!(ASPECTS as readonly string[]).includes(flag)) throw new Error(`--aspect must be 16:9, 9:16 or 1:1 (got "${flag}")`);
  return flag as Aspect;
}

/** The --format flag, else the extension of -o, else mp4. */
export function formatOf(out?: string, flag?: string): Format {
  if (flag !== undefined) {
    if (!(FORMATS as readonly string[]).includes(flag)) throw new Error(`--format must be mp4, gif or webp (got "${flag}")`);
    return flag as Format;
  }
  if (!out) return 'mp4';
  const ext = path.extname(out).slice(1).toLowerCase();
  if ((FORMATS as readonly string[]).includes(ext)) return ext as Format;
  throw new Error(`Cannot tell the format from "${out}": name it .mp4, .gif or .webp, or pass --format`);
}

/** `<name>.mp4`, `<name>-9x16.mp4`, `<name>-1x1.gif`, `<name>-quote.gif` (a --scenes cut)… next to the script. */
export function defaultOutput(loaded: { dir: string; name: string }, aspect: Aspect, format: Format, scenes?: string[]): string {
  const crop = aspect === '16:9' ? '' : `-${aspect.replace(':', 'x')}`;
  const cut = scenes?.length ? `-${scenes.join('+')}` : '';
  return path.join(loaded.dir, `${loaded.name}${crop}${cut}.${format}`);
}

/** An MP4 as a looping GIF with one palette for the whole clip. */
export async function toGif(src: string, out: string, width: number, fps = GIF_FPS): Promise<void> {
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', vf, '-loop', '0', out]);
}

/** An MP4 as a looping animated WebP. */
export async function toWebp(src: string, out: string, width: number, fps = WEBP_FPS): Promise<void> {
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', vf, '-c:v', 'libwebp_anim', '-quality', String(WEBP_QUALITY), '-loop', '0', out]);
}
