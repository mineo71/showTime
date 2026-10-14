import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStudio } from '../../src/studio/server';
import { FIXTURES, serveDir, type Served } from '../helpers/serve';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../../bin/showtime.mjs', import.meta.url));

async function cli(args: string[]) {
  try {
    const r = await exec(process.execPath, [BIN, ...args], { cwd: tmpdir(), maxBuffer: 50_000_000 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

let server: Served;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'i18n-app'));
});
afterAll(() => server.close());

/** fixtures/i18n.json in a fresh folder, pointed at the fixture server. */
async function i18n(): Promise<{ dir: string; file: string }> {
  const raw = JSON.parse(await readFile(path.join(FIXTURES, 'i18n.json'), 'utf8'));
  raw.app.url = `${server.url}{locale}/`;
  const dir = await mkdtemp(path.join(tmpdir(), 'showtime-i18n-'));
  const file = path.join(dir, 'i18n.json');
  await writeFile(file, JSON.stringify(raw, null, 2));
  return { dir, file };
}

describe('locales on the command line', () => {
  it('check --locale picks the targets of that language, and refuses an unknown one', async () => {
    const { file } = await i18n();
    const uk = await cli(['check', file, '--locale', 'uk', '--json']);
    expect(uk.code, uk.stderr).toBe(0);
    expect(JSON.parse(uk.stdout).steps[0].action).toContain('Привітатися');
    const en = await cli(['check', file, '--json']);
    expect(JSON.parse(en.stdout).steps[0].action).toContain('Say hello');
    for (const cmd of ['check', 'record', 'render', 'frames', 'lint', 'make']) {
      const bad = await cli([cmd, file, '--locale', 'de']);
      expect(bad.code).toBe(1);
      expect(bad.stderr).toMatch(/--locale de is not one of: en, uk/);
    }
  });

  it('make --locales writes one video per locale, after checking every locale exists', async () => {
    const { dir, file } = await i18n();
    const bad = await cli(['make', file, '--locales', 'en,de']);
    expect(bad.stderr).toMatch(/--locales: de is not one of: en, uk/);
    expect(existsSync(path.join(dir, '.showtime'))).toBe(false);
    expect((await cli(['make', file, '--locales', 'all', '-o', 'x.mp4'])).stderr).toMatch(/--out cannot be used with --locales/);
    expect((await cli(['check', file, '--locale', 'en', '--locales', 'uk'])).stderr).toMatch(/unknown option '--locales'/);

    const r = await cli(['make', file, '--locales', 'en,uk']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(path.join(dir, 'i18n.en.mp4'))).toBe(true);
    expect(existsSync(path.join(dir, 'i18n.uk.mp4'))).toBe(true);
    expect(r.stdout).toMatch(/── en ──[\s\S]*── uk ──/);

    const again = await cli(['render', file, '--locales', 'uk', '--json']);
    expect(again.code, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout).runs).toEqual([expect.objectContaining({ locale: 'uk', video: path.join(dir, 'i18n.uk.mp4') })]);
  }, 300_000);

  it('refuses --locales on a script without locales', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-i18n-'));
    const file = path.join(dir, 'plain.json');
    await writeFile(file, JSON.stringify({ version: 1, app: { url: server.url }, scenes: [{ id: 'a', steps: [{ do: 'pause', ms: 10 }] }] }));
    expect((await cli(['make', file, '--locales', 'all'])).stderr).toMatch(/--locales: .*plain\.json has no "locales"/);
  });

  it('opens the studio in a locale', async () => {
    const { file } = await i18n();
    const studio = await startStudio(file, { port: 0, locale: 'uk' });
    try {
      const state = await (await fetch(new URL('/api/state', studio.url), { headers: { 'x-showtime-token': studio.token } })).json();
      expect(state.error).toBeNull();
      expect(state.name).toBe('i18n.uk');
      expect(state.steps[0].label).toContain('Привітатися');
      // The look panel shows the open locale's title, not the object holding every locale's.
      expect(state.meta).toMatchObject({ title: 'Привіт' });
    } finally {
      await studio.close();
    }
    await expect(startStudio(file, { port: 0, locale: 'de' })).rejects.toThrow(/--locale de is not one of: en, uk/);
  });
});
