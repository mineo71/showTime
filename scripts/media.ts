// Rebuilds the README media in docs/media from the Fennel example take.
//
//   npm run example                                       # terminal 1: serves examples/ on :4800
//   showtime make examples/fennel/demo.json               # terminal 2: record + render
//   showtime frames examples/fennel/demo.json             #             QA stills
//   showtime frames examples/fennel/demo.json --aspect 9:16
//   showtime frames examples/fennel/demo.json --aspect 1:1
//   npm run media                                         #             → docs/media
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { toWebp } from '../src/convert';
import { run } from '../src/ffmpeg';
import { startStudio } from '../src/studio/server';
import { qaShots, sourceMsAtFrame } from '../src/timeline/frames';
import { BROWSER_BAR, windowLayout } from '../src/timeline/layout';
import type { TakeEvents, Timeline } from '../src/timeline/types';

const root = fileURLToPath(new URL('..', import.meta.url));
const example = path.join(root, 'examples/fennel');
const work = path.join(example, '.showtime/demo');
const out = path.join(root, 'docs/media');

type Crop = 'window' | 'centre';
/** README still name → the QA shot it is cut from, and how tightly (feature cards are small). */
const STILLS: Record<string, { shot: string; crop: Crop }> = {
  intro: { shot: '00-intro', crop: 'centre' },
  zoom: { shot: '01-overview-1-hover', crop: 'window' },
  typing: { shot: '03-invoice-2-type', crop: 'window' },
  spotlight: { shot: '09-invoice-8-hover', crop: 'window' },
  speed: { shot: '10-invoice-9-click', crop: 'window' },
  tracked: { shot: '12-tracked-1-scroll', crop: 'window' },
  outro: { shot: '99-outro', crop: 'centre' },
};
const MARGIN = 48;
/** The formats image: this shot in 16:9, 9:16 and 1:1, side by side. */
const FORMATS_SHOT = '03-invoice-2-type';
/** The before/after pair: the raw take and the render at the same source moment. */
const COMPARE = '01-overview-1-hover';

const need = (file: string) => {
  if (!existsSync(file)) throw new Error(`Missing ${path.relative(root, file)} — run showtime make + frames first (see the header of this script).`);
  return file;
};

async function main() {
  mkdirSync(out, { recursive: true });
  const video = need(path.join(example, 'demo.mp4'));
  const frames = path.join(work, 'frames');
  const timeline = JSON.parse(readFileSync(need(path.join(work, 'timeline.json')), 'utf8')) as Timeline;
  const events = JSON.parse(readFileSync(need(path.join(work, 'take/events.json')), 'utf8')) as TakeEvents;

  copyFileSync(video, path.join(out, 'demo.mp4'));

  process.stdout.write('hero.webp (animated, slow)…\n');
  await toWebp(video, path.join(out, 'hero.webp'), 1200);

  const { width: W, height: H } = timeline.output;
  const win = windowLayout(timeline.output, timeline.stage, timeline.style.padding, timeline.chrome ? BROWSER_BAR : 0);
  const cw = win.width + 2 * MARGIN;
  const ch = win.height + win.bar + 2 * MARGIN;
  // The centre crop keeps the window crop's aspect ratio so feature cards line up.
  const iw = Math.round(W * 0.62);
  const ih = Math.round((iw * ch) / cw);
  const crops: Record<Crop, string> = {
    window: `crop=${cw}:${ch}:${win.x - MARGIN}:${win.y - win.bar - MARGIN},`,
    centre: `crop=${iw}:${ih}:${Math.round((W - iw) / 2)}:${Math.round((H - ih) / 2)},`,
  };
  const jpeg = (src: string, dest: string, crop = '') =>
    run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `${crop}scale=1280:-1:flags=lanczos`, '-q:v', '3', path.join(out, dest)]);

  for (const [name, { shot, crop }] of Object.entries(STILLS)) await jpeg(need(path.join(frames, `${shot}.png`)), `${name}.jpg`, crops[crop]);
  await jpeg(need(path.join(frames, 'sheet.png')), 'sheet.jpg');

  const cut = (dir: string) => need(path.join(work, dir, `${FORMATS_SHOT}.png`));
  const tile = (i: number) => `[${i}]scale=-2:640:flags=lanczos,pad=iw+40:ih:20:0:color=0x0b1120[t${i}]`;
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-i', cut('frames'), '-i', cut('frames-9x16'), '-i', cut('frames-1x1'),
    '-filter_complex', `${tile(0)};${tile(1)};${tile(2)};[t0][t1][t2]hstack=inputs=3,pad=iw+40:ih+40:20:20:color=0x0b1120,scale=1280:-2:flags=lanczos`,
    '-q:v', '3', path.join(out, 'formats.jpg'),
  ]);

  const shot = qaShots(timeline, events.steps).find((s) => s.name === COMPARE);
  if (!shot) throw new Error(`No QA shot named ${COMPARE}`);
  const srcMs = sourceMsAtFrame(timeline, shot.frame) ?? 0;
  const raw = path.join(work, 'take/raw.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', (srcMs / 1000).toFixed(3), '-i', need(raw), '-frames:v', '1', '-vf', 'scale=1280:-1:flags=lanczos', '-q:v', '3', path.join(out, 'before.jpg')]);
  await jpeg(path.join(frames, `${COMPARE}.png`), 'after.jpg');

  process.stdout.write('studio.jpg…\n');
  const studio = await startStudio(path.join(example, 'demo.json'), { port: 0 });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(studio.url);
    await page.locator('[data-where="invoice#2"]').click();
    await page.locator('video').first().waitFor();
    await page.waitForTimeout(2000);
    const png = path.join(work, 'studio.png');
    await page.screenshot({ path: png });
    await run('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'scale=1280:-1:flags=lanczos', '-q:v', '3', path.join(out, 'studio.jpg')]);
  } finally {
    await browser.close();
    await studio.close();
  }

  process.stdout.write(`✓ media in ${path.relative(process.cwd(), out)}\n`);
}

await main();
