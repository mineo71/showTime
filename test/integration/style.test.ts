import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeVideo } from '../../src/ffmpeg';
import { renderDemo, renderQaFrames, timelineFor } from '../../src/pipeline';
import { record } from '../../src/runner/record';
import { loadScript, type LoadedScript } from '../../src/script/load';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

const FONT_DIR = '/System/Library/Fonts/Supplemental';
const systemFont = existsSync(FONT_DIR) ? readdirSync(FONT_DIR).find((f) => f.endsWith('.ttf')) : undefined;

let server: Awaited<ReturnType<typeof serveDir>>;
let loaded: LoadedScript;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
  loaded = await fixtureScript(server.url, (raw) => {
    raw.scenes = [
      {
        id: 'a',
        steps: [
          { do: 'click', target: '#new-report', show: { click: 'burst', highlight: '#ef4444', caption: 'Burst in red' } },
          { do: 'type', target: '#report-name', text: 'Q3', show: { click: 'pulse', spotlight: 'glow', highlight: '#f59e0b' } },
          { do: 'select', target: '#period', value: '30d', show: { click: 'ring', spotlight: 'ring' } },
        ],
      },
    ];
  });
  await record(loaded);
}, 180_000);
afterAll(() => server.close());

async function withStyle(style: Record<string, unknown>): Promise<LoadedScript> {
  const raw = JSON.parse(await readFile(loaded.scriptPath, 'utf8'));
  raw.style = style;
  await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
  return loadScript(loaded.scriptPath);
}

describe('look', () => {
  it.runIf(systemFont)('embeds a font file and a watermark image, and renders every click animation and caption style', async () => {
    copyFileSync(path.join(FONT_DIR, systemFont!), path.join(loaded.dir, 'brand.ttf'));
    await writeFile(path.join(loaded.dir, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>');
    const styled = await withStyle({
      fonts: [{ family: 'Brand', file: 'brand.ttf' }],
      captionFont: 'Brand',
      titleFont: 'Brand',
      captionStyle: 'accent',
      watermark: { text: 'acme.com', image: 'mark.svg', position: 'top-right' },
    });
    const { timeline } = await timelineFor(styled);
    expect(timeline.fonts[0].src).toMatch(/^data:font\/ttf;base64,/);
    expect(timeline.watermark?.image).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(timeline.clickFx.map((c) => c.kind)).toEqual(['burst', 'pulse', 'ring']);
    const { frames } = await renderQaFrames(styled);
    for (const f of frames) expect(existsSync(f)).toBe(true);
    for (const captionStyle of ['light', 'outline', 'bar']) {
      const { frames: more } = await renderQaFrames(await withStyle({ captionStyle }));
      expect(existsSync(more[1])).toBe(true);
    }
    const { video } = await renderDemo(styled);
    expect((await probeVideo(video)).width).toBe(1920);
  }, 300_000);

  it('fails with the family named when a font file is not a font', async () => {
    await writeFile(path.join(loaded.dir, 'broken.ttf'), 'not a font');
    const broken = await withStyle({ fonts: [{ family: 'Broken', file: 'broken.ttf' }], captionFont: 'Broken' });
    await expect(renderQaFrames(broken)).rejects.toThrow(/style\.fonts: "Broken" could not be loaded/);
  }, 120_000);
});
