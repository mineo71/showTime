import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { check } from '../../src/runner/check';
import { withServer } from '../../src/runner/server';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES } from '../helpers/serve';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVE = path.join(ROOT, 'scripts', 'serve.mjs');
const SLOW = path.join(ROOT, 'test', 'helpers', 'slow-server.cjs');

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

const answers = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(1000) }).then(
    () => true,
    () => false,
  );

describe('server', () => {
  it('starts the app, runs the work, and stops it afterwards', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/demo-app/`;
    const seen = await withServer({ run: `node "${SERVE}" "${FIXTURES}" ${port}`, url, timeoutMs: 20_000 }, url, ROOT, async () => answers(url));
    expect(seen).toBe(true);
    expect(await answers(url)).toBe(false);
  });

  it('reuses a server that already answers and leaves it running', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const { spawn } = await import('node:child_process');
    const own = spawn(process.execPath, [SERVE, FIXTURES, String(port)], { stdio: 'ignore' });
    try {
      await expect.poll(() => answers(url), { timeout: 10_000 }).toBe(true);
      await withServer({ run: 'node -e "process.exit(9)"', url, timeoutMs: 5000 }, url, ROOT, async () => undefined);
      expect(await answers(url)).toBe(true);
    } finally {
      own.kill();
    }
  });

  it('fails with the output when the command exits before answering', async () => {
    const url = `http://127.0.0.1:${await freePort()}/`;
    const run = `node -e "console.error('missing env DATABASE_URI'); process.exit(2)"`;
    await expect(withServer({ run, timeoutMs: 10_000 }, url, ROOT, async () => undefined)).rejects.toThrow(
      /server \(.*\) exited with code 2 before answering[\s\S]*missing env DATABASE_URI/,
    );
  });

  it('times out a server that never answers, and stops it', async () => {
    const url = `http://127.0.0.1:${await freePort()}/`;
    const marker = `showtime-hang-${Date.now()}`;
    const run = `node -e "setInterval(() => {}, 1000)" ${marker}`;
    await expect(withServer({ run, timeoutMs: 1500 }, url, ROOT, async () => undefined)).rejects.toThrow(/did not answer at .* within 1\.5 s/);
    const { execSync } = await import('node:child_process');
    await expect.poll(() => execSync(`ps ax -o command`).toString().includes(marker), { timeout: 5000 }).toBe(false);
  });

  it('runs around check, so a script can start its own app', async () => {
    const port = await freePort();
    const loaded = await fixtureScript(`http://127.0.0.1:${port}/demo-app/`, (raw) => {
      raw.scenes = [{ id: 'a', steps: [{ do: 'click', target: '#new-report' }] }];
      raw.server = { run: `node "${SERVE}" "${FIXTURES}" ${port}`, timeoutMs: 20_000 };
    });
    const report = await check(loaded);
    expect(report.ok).toBe(true);
    expect(await answers(`http://127.0.0.1:${port}/demo-app/`)).toBe(false);
  });

  it('stops servers the command put in the background, even ones that ignore SIGTERM', async () => {
    const a = await freePort();
    const urlA = `http://127.0.0.1:${a}/`;
    const seen = await withServer({ run: `node "${SLOW}" ${a} &`, timeoutMs: 20_000 }, urlA, ROOT, async () => answers(urlA));
    expect(seen).toBe(true);
    await expect.poll(() => answers(urlA), { timeout: 8000 }).toBe(false);

    const b = await freePort();
    const urlB = `http://127.0.0.1:${b}/`;
    await withServer({ run: `node "${SLOW}" ${b} 0 stubborn & wait`, timeoutMs: 20_000 }, urlB, ROOT, async () => undefined);
    await expect.poll(() => answers(urlB), { timeout: 10_000 }).toBe(false);
  }, 30_000);

  it('stops the server when showtime is interrupted with Ctrl+C', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'test', 'helpers', 'server-child.ts'), `node "${SLOW}" ${port}`, url], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    await expect.poll(() => out, { timeout: 30_000 }).toContain('ready');
    child.kill('SIGINT');
    await new Promise((resolve) => child.on('exit', resolve));
    await expect.poll(() => answers(url), { timeout: 8000 }).toBe(false);
  }, 60_000);

  it('reuses a running server that is slow to answer its first request', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const { spawn } = await import('node:child_process');
    const own = spawn(process.execPath, [SLOW, String(port), '3500'], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 500));
      const res = await withServer({ run: 'node -e "process.exit(9)"', timeoutMs: 20_000 }, url, ROOT, async () => 'worked');
      expect(res).toBe('worked');
    } finally {
      own.kill();
    }
  }, 30_000);
});
