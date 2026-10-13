import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
      { do: 'click', target: 'role=button[name*="New report"i]' },
      { do: 'type', target: 'role=textbox[name*="Name"i]', text: 'Q3 revenue' },
      { do: 'select', target: expect.stringMatching(/^internal:label=/), value: '30d' },
      { do: 'click', target: 'role=button[name*="Create"i]' },
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

describe('record-human on real-world labels, popups and Ctrl+C', () => {
  let app: Awaited<ReturnType<typeof serveDir>>;
  beforeAll(async () => {
    app = await serveDir(path.join(FIXTURES, 'human-app'));
  });
  afterAll(() => app.close());

  it('writes selectors that still find the clicked elements, and leaves popup actions out with a note', async () => {
    const out = path.join(await mkdtemp(path.join(tmpdir(), 'showtime-human-')), 'flow.json');
    const result = await recordHuman(app.url, {
      out,
      headless: true,
      drive: async (page) => {
        await page.getByText('Inbox 12').click();
        await page.locator('#long').click();
        await page.locator('#plain-save').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByText('Open the popup').click()]);
        await popup.waitForLoadState();
        await popup.getByText('Confirm in popup').click();
        await page.waitForTimeout(300);
      },
    });
    const targets = result.steps.map((s) => ('target' in s ? s.target : ''));
    expect(targets.some((t) => /Confirm in popup/.test(t))).toBe(false);
    expect(result.notes.join('\n')).toMatch(/popup or new tab/);
    const report = await check(await loadScript(out));
    expect(report.failure ?? null).toBeNull();
    expect(report.ok).toBe(true);
  });

  it('writes the script when stopped with Ctrl+C', async () => {
    const out = path.join(await mkdtemp(path.join(tmpdir(), 'showtime-human-')), 'flow.json');
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(FIXTURES, '..', 'test', 'helpers', 'human-child.ts'), app.url, out], {
      cwd: path.join(FIXTURES, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    await expect.poll(() => output, { timeout: 60_000 }).toContain('clicked');
    child.kill('SIGINT');
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code, output).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(await readFile(out, 'utf8')).scenes[0].steps).toEqual([{ do: 'click', target: 'role=link[name*="Inbox"i]' }]);
  });
});
