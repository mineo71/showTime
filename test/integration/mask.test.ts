import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});
