import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordHuman } from '../../src/human/record';
import { check } from '../../src/runner/check';
import { loadScript } from '../../src/script/load';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('record-human', () => {
  it('turns a recorded flow into a script that passes check', async () => {
    const out = path.join(await mkdtemp(path.join(tmpdir(), 'showtime-human-')), 'flow.json');
    const lines: string[] = [];
    const result = await recordHuman(server.url, {
      out,
      headless: true,
      log: (l) => lines.push(l),
      drive: async (page) => {
        await page.click('#new-report');
        await page.click('#report-name');
        await page.keyboard.type('Q3 revenue', { delay: 15 });
        await page.selectOption('#period', '30d');
        await page.click('#create');
        await page.waitForTimeout(300);
      },
    });
    expect(result.file).toBe(out);
    const script = JSON.parse(await readFile(out, 'utf8'));
    expect(script.app).toEqual({ url: server.url, viewport: { width: 1440, height: 900 } });
    expect(script.meta.title).toBeTruthy();
    expect(script.scenes[0].steps).toEqual([
      { do: 'click', target: 'role=button[name="New report"i]' },
      { do: 'type', target: 'role=textbox[name="Name"i]', text: 'Q3 revenue' },
      { do: 'select', target: expect.stringMatching(/^internal:label=/), value: '30d' },
      { do: 'click', target: 'role=button[name="Create"i]' },
    ]);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const report = await check(await loadScript(out));
    expect(report.failure ?? null).toBeNull();
    expect(report.ok).toBe(true);
  });

  it('never overwrites an existing file without force', async () => {
    const out = path.join(await mkdtemp(path.join(tmpdir(), 'showtime-human-')), 'flow.json');
    await writeFile(out, '{}');
    await expect(recordHuman(server.url, { out, headless: true, drive: async () => undefined })).rejects.toThrow(/exists.*--force/);
    expect(await readFile(out, 'utf8')).toBe('{}');
  });
});
