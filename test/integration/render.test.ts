import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeVideo } from '../../src/ffmpeg';
import { workPaths } from '../../src/paths';
import { renderDemo, renderQaFrames, timelineFor } from '../../src/pipeline';
import { record } from '../../src/runner/record';
import { loadScript, type LoadedScript } from '../../src/script/load';
import { totalFrames } from '../../src/timeline/frames';
import type { Timeline } from '../../src/timeline/types';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
let loaded: LoadedScript;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
  loaded = await fixtureScript(server.url);
  await record(loaded);
});
afterAll(() => server.close());

async function editScript(mutate: (raw: any) => void): Promise<LoadedScript> {
  const raw = JSON.parse(await readFile(loaded.scriptPath, 'utf8'));
  mutate(raw);
  await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
  return loadScript(loaded.scriptPath);
}

describe('render', () => {
  it('renders a 1080p MP4 whose length matches the timeline', async () => {
    const out = await renderDemo(loaded);
    expect(out).toBe(workPaths(loaded).video);
    const probe = await probeVideo(out);
    expect(probe).toMatchObject({ width: 1920, height: 1080 });
    const tl = JSON.parse(await readFile(workPaths(loaded).timeline, 'utf8')) as Timeline;
    expect(Math.abs(probe.durationMs - (totalFrames(tl) * 1000) / tl.fps)).toBeLessThan(100);
    expect(tl.segments.some((s) => s.speed > 1)).toBe(true);
    expect(tl.camera.length).toBeGreaterThan(0);
    expect(tl.captions.map((c) => c.text)).toContain('Кешбек видно одразу');
  });

  it('renders QA stills: intro + one per step, plus a contact sheet', async () => {
    const { sheet, frames: files } = await renderQaFrames(loaded);
    expect(sheet).toBe(path.join(workPaths(loaded).stills, 'sheet.png'));
    expect((await readFile(sheet)).readUInt32BE(16)).toBe(1920);
    expect(files).toHaveLength(9);
    for (const f of files) expect(existsSync(f)).toBe(true);
    expect(path.basename(files[0])).toBe('00-intro.png');
    expect(path.basename(files[6])).toBe('06-report-6-hover.png');
  });

  it('re-renders after a presentation-only change without re-recording', async () => {
    const edited = await editScript((raw) => {
      raw.scenes[0].steps[0].show.caption = 'Новий підпис';
      raw.style = { accent: '#ef4444' };
    });
    const { timeline } = await timelineFor(edited);
    expect(timeline.captions[0].text).toBe('Новий підпис');
    expect(timeline.style.accent).toBe('#ef4444');
  });

  it('ends on an outro card with the logo after the video', async () => {
    await writeFile(
      path.join(loaded.dir, 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#16a34a"/></svg>',
    );
    const edited = await editScript((raw) => {
      raw.meta = { ...raw.meta, logo: 'logo.svg', outro: { title: 'Try Acme', url: 'acme.example' } };
    });
    const { timeline } = await timelineFor(edited);
    expect(timeline.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(timeline.outro).toEqual({ title: 'Try Acme', url: 'acme.example', durationMs: 2600 });
    const { frames: files } = await renderQaFrames(edited);
    expect(path.basename(files.at(-1)!)).toBe('99-outro.png');
    expect(existsSync(files.at(-1)!)).toBe(true);
  });

  it('refuses a stale take after an action change', async () => {
    const edited = await editScript((raw) => {
      raw.scenes[0].steps[1].text = 'Q4 revenue';
    });
    await expect(timelineFor(edited)).rejects.toThrow(/Actions changed since the take/);
  });
});
