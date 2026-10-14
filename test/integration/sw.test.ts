import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { check } from '../../src/runner/check';
import { parseLoaded } from '../../src/script/load';
import { FIXTURES, serveDir, type Served } from '../helpers/serve';

let server: Served;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'sw-app'));
});
afterAll(() => server.close());

describe('service workers', () => {
  it('are blocked when the script mocks requests, so the mock answers instead of the worker', async () => {
    const raw = {
      version: 1,
      app: { url: server.url, mock: [{ url: '**/api/count', json: { n: 'mock' } }] },
      scenes: [
        {
          id: 'a',
          steps: [
            { do: 'wait', for: 'body[data-ready="1"] #count' },
            { do: 'click', target: '#count' },
            { do: 'wait', for: '#out:has-text("n=mock")', timeoutMs: 3000 },
          ],
        },
      ],
    };
    const report = await check(await parseLoaded(raw, path.join(FIXTURES, 'sw.json')));
    expect(report.ok, report.failure?.error).toBe(true);
  });
});
