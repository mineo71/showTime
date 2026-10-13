import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../../bin/showtime.mjs', import.meta.url));

async function cli(args: string[], cwd = tmpdir()) {
  try {
    const r = await exec(process.execPath, [BIN, ...args], { cwd, maxBuffer: 50_000_000 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('showtime CLI', () => {
  it('prints the schema', async () => {
    const r = await cli(['schema']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).properties.scenes).toBeDefined();
  });

  it('fails clearly on an invalid script', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-cli-'));
    const file = path.join(dir, 'bad.json');
    await writeFile(file, JSON.stringify({ version: 1, scenes: [] }));
    const r = await cli(['check', file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/✖ Invalid .*bad\.json/);
    expect(r.stderr).toMatch(/app/);
  });

  it('check --json reports failures as JSON with exit code 1', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes = [{ id: 'x', steps: [{ do: 'click', target: '.dup' }] }];
    });
    const r = await cli(['check', loaded.scriptPath, '--json']);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.ok).toBe(false);
    expect(report.failure.sceneId).toBe('x');
  });

  it('make produces the video next to the script, independent of the cwd', async () => {
    const loaded = await fixtureScript(server.url);
    const r = await cli(['make', loaded.scriptPath]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('check passed');
    expect(existsSync(path.join(loaded.dir, 'demo.mp4'))).toBe(true);
  });
});
