import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSession } from '../../src/runner/browser';
import { parseScript } from '../../src/script/schema';
import { FIXTURES, serveDir } from '../helpers/serve';

const exec = promisify(execFile);
const PROBE = fileURLToPath(new URL('../helpers/mask-probe.ts', import.meta.url));

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('app.mask', () => {
  it('blurs masked elements in the CLI runtime (tsx)', async () => {
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', PROBE, server.url]);
    expect(stdout.trim()).toBe('blur(10px)');
  });

  it('rejects a non-CSS mask selector instead of silently masking nothing', async () => {
    const script = parseScript({
      version: 1,
      app: { url: server.url, mask: ['.customer-email', 'text=Secret'] },
      scenes: [{ id: 'a', steps: [{ do: 'pause', ms: 0 }] }],
    });
    await expect(openSession(script)).rejects.toThrow(/app\.mask\[1\] "text=Secret" is not a valid CSS selector/);
  });
});
