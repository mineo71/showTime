import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { check } from '../../src/runner/check';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('check', () => {
  it('stops after the step named by until', async () => {
    const report = await check(await fixtureScript(server.url), { until: 'report#2' });
    expect(report.ok).toBe(true);
    expect(report.steps.map((s) => `${s.sceneId}#${s.index + 1}`)).toEqual(['report#1', 'report#2']);
    expect(report.until).toBe('report#2');
    await expect(check(await fixtureScript(server.url), { until: 'report#99' })).rejects.toThrow(/--until report#99 names no step/);
  });

  it('passes the demo script and writes a screenshot per step', async () => {
    const report = await check(await fixtureScript(server.url));
    expect(report.failure).toBeNull();
    expect(report.ok).toBe(true);
    expect(report.steps).toHaveLength(8);
    expect(report.until).toBeUndefined();
    for (const s of report.steps) expect(existsSync(s.screenshot!)).toBe(true);
  });

  it('reports a missing target with a screenshot and an ARIA snapshot', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes[0].steps[0] = { do: 'click', target: "role=button[name='Nope']" };
    });
    const report = await check(loaded);
    expect(report.ok).toBe(false);
    expect(report.failure).toMatchObject({ sceneId: 'report', index: 0 });
    expect(report.failure!.error).toMatch(/Scene "report" step 1 \(click role=button\[name='Nope'\]\)/);
    expect(report.failure!.aria).toContain('New report');
    expect(existsSync(report.failure!.screenshot)).toBe(true);
    expect(report.steps.at(-1)).toMatchObject({ ok: false });
  });

  it('names ambiguous selectors', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes[0].steps = [{ do: 'click', target: '.dup' }];
    });
    const report = await check(loaded);
    expect(report.ok).toBe(false);
    expect(report.failure!.error).toMatch(/strict mode violation|resolved to 2 elements/);
  });

  it('types Unicode text', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes = [
        {
          id: 'uk',
          steps: [
            { do: 'type', target: '#note', text: 'Привіт, світ' },
            { do: 'wait', for: '#echo:has-text("Привіт, світ")' },
          ],
        },
      ];
    });
    const report = await check(loaded);
    expect(report.failure).toBeNull();
  });

  it('fails clearly when the app is unreachable', async () => {
    const loaded = await fixtureScript('http://127.0.0.1:9/');
    await expect(check(loaded)).rejects.toThrow(/Cannot open app\.url/);
  });
});

describe('check with hooks', () => {
  it('runs before hooks first and after hooks last, in the script folder', async () => {
    const append = (text: string) => `node -e "require('fs').appendFileSync('hooks.log', '${text}')"`;
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.hooks = { before: [{ run: append('before,') }], after: [{ run: append('after') }] };
      raw.scenes = [{ id: 'a', steps: [{ do: 'click', target: '#new-report' }] }];
    });
    const report = await check(loaded);
    expect(report.ok).toBe(true);
    expect(await readFile(path.join(loaded.dir, 'hooks.log'), 'utf8')).toBe('before,after');
  });
});
