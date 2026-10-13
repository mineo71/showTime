import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHooks, withHooks } from '../../src/runner/hooks';

const append = (text: string) => `node -e "require('fs').appendFileSync('log.txt', '${text}')"`;

async function server(status: number) {
  const seen: { method?: string; body: string; type?: string }[] = [];
  const s = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ method: req.method, body, type: req.headers['content-type'] });
      res.writeHead(status).end(status === 200 ? 'ok' : 'database is locked');
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/reset`, seen, close: () => s.close() };
}

describe('runHooks', () => {
  it('runs shell hooks in order, in the given folder', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'showtime-hooks-'));
    await runHooks([{ run: append('a') }, { run: append('b') }], { cwd, label: 'hooks.before' });
    expect(await readFile(path.join(cwd, 'log.txt'), 'utf8')).toBe('ab');
  });

  it('names the failing hook, its exit code and the end of its output', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'showtime-hooks-'));
    const failing = { run: `node -e "console.log('step 1'); console.error('db down'); process.exit(3)"` };
    await expect(runHooks([{ run: append('a') }, failing], { cwd, label: 'hooks.before' })).rejects.toThrow(
      /hooks\.before\[1\] \(node -e .*\) failed: exit code 3[\s\S]*db down/,
    );
  });

  it('times out a command that hangs', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'showtime-hooks-'));
    const hang = { run: `node -e "setTimeout(() => {}, 20000)"` };
    await expect(runHooks([hang], { cwd, label: 'hooks.before', timeoutMs: 300 })).rejects.toThrow(/timed out after 0\.3 s/);
  });

  it('sends request hooks as JSON and fails on a non-2xx answer', async () => {
    const ok = await server(200);
    try {
      await runHooks([{ request: { url: ok.url, method: 'POST', json: { seed: 'demo' } } }], { cwd: tmpdir(), label: 'hooks.before' });
      expect(ok.seen).toEqual([{ method: 'POST', body: '{"seed":"demo"}', type: 'application/json' }]);
    } finally {
      ok.close();
    }
    const bad = await server(500);
    try {
      await expect(runHooks([{ request: { url: bad.url, method: 'POST' } }], { cwd: tmpdir(), label: 'hooks.after' })).rejects.toThrow(
        /hooks\.after\[0\] \(POST http:.*\/reset\) failed: HTTP 500[\s\S]*database is locked/,
      );
    } finally {
      bad.close();
    }
  });
});

describe('withHooks', () => {
  it('runs before, the work, then after, and runs after even when the work fails', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'showtime-hooks-'));
    const hooks = { before: [{ run: append('[') }], after: [{ run: append(']') }] };
    expect(await withHooks(hooks, cwd, async () => 42)).toBe(42);
    await expect(
      withHooks(hooks, cwd, async () => {
        throw new Error('step failed');
      }),
    ).rejects.toThrow('step failed');
    expect(await readFile(path.join(cwd, 'log.txt'), 'utf8')).toBe('[][]');
  });
});
