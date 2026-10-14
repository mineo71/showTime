import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspect } from '../../src/inspect';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('inspect', () => {
  it('lists ready targets with how many elements each matches, and saves a screenshot', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-inspect-'));
    const r = await inspect(server.url, { dir });
    expect(r.title).toBeTruthy();
    expect(r.targets).toContainEqual({ role: 'button', name: 'New report', target: 'role=button[name="New report"]', count: 1 });
    expect(r.targets.every((t) => t.count >= 1)).toBe(true);
    expect(existsSync(r.screenshot)).toBe(true);
    expect(r.screenshot.startsWith(path.join(dir, '.showtime', 'inspect'))).toBe(true);
  });
});
