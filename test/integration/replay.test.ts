import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { check } from '../../src/runner/check';
import { record } from '../../src/runner/record';
import { loadScript } from '../../src/script/load';
import { FIXTURES, serveDir, type Served } from '../helpers/serve';

let server: Served;
let dir: string;
beforeEach(async () => {
  server = await serveDir(path.join(FIXTURES, 'replay-app'));
  dir = await mkdtemp(path.join(tmpdir(), 'showtime-replay-'));
});
afterEach(() => server.close());

const netFile = () => path.join(dir, 'lab.net.json');

/** The lab script: counter API, echo API and a WebSocket session; `texts` pins what the page must show. */
async function lab(texts: { count?: string; echo?: string; talk?: string } = {}, extra: object[] = []) {
  const raw = {
    version: 1,
    app: { url: server.url, viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 },
    replay: { file: 'lab.net.json', match: ['**/api/**', 'ws://127.0.0.1:*/ws**'] },
    scenes: [
      {
        id: 'lab',
        steps: [
          { do: 'click', target: '#count' },
          { do: 'wait', for: `#count-out:has-text("${texts.count ?? 'count'}")` },
          { do: 'click', target: '#echo' },
          { do: 'wait', for: `#echo-out:has-text("${texts.echo ?? 'echo hello'}")` },
          { do: 'click', target: '#talk' },
          { do: 'wait', for: `#talk-out[data-done="1"]:has-text("${texts.talk ?? 'final'}")` },
          ...extra,
        ],
      },
    ],
  };
  const file = path.join(dir, 'lab.json');
  await writeFile(file, JSON.stringify(raw));
  return loadScript(file);
}

const recorded = { count: 'count 1', echo: 'echo hello 2', talk: 'final #5' };

describe('network replay', () => {
  it('records the first run, then replays it without touching the server', async () => {
    const first = await check(await lab(recorded));
    expect(first.ok).toBe(true);
    expect(first.net).toMatchObject({ mode: 'record', file: netFile() });
    expect(server.hits()).toBe(5);
    expect(existsSync(netFile())).toBe(true);

    // The server's counter would now say 6, 7, …: the recorded answers come back instead.
    const second = await check(await lab(recorded));
    expect(second.ok, second.failure?.error).toBe(true);
    expect(second.net).toMatchObject({ mode: 'replay', misses: 0 });
    expect(server.hits()).toBe(5);
  });

  it('keeps credentials and request headers out of the file', async () => {
    await check(await lab());
    const text = await readFile(netFile(), 'utf8');
    expect(text).not.toContain('secret123');
    expect(text).toContain('language=en');
    const file = JSON.parse(text);
    expect(file.ws[0].frames.filter((f: { from: string }) => f.from === 'client').map((f: { size?: number; text?: string }) => f.size ?? f.text)).toEqual([100, 50, 'finalize']);
  });

  it('goes live with --net live and re-records with --net record', async () => {
    await check(await lab());
    const before = await readFile(netFile(), 'utf8');
    const live = await check(await lab({ count: 'count 6' }), { net: 'live' });
    expect(live.ok, live.failure?.error).toBe(true);
    expect(live.net).toBeNull();
    expect(server.hits()).toBe(10);
    expect(await readFile(netFile(), 'utf8')).toBe(before);

    const again = await check(await lab({ count: 'count 11' }), { net: 'record' });
    expect(again.ok, again.failure?.error).toBe(true);
    expect(await readFile(netFile(), 'utf8')).toContain(Buffer.from('{"n":11}').toString('base64'));
  });

  it('refuses --net replay without a file, and record/replay without a replay section', async () => {
    await expect(check(await lab(), { net: 'replay' })).rejects.toThrow(/--net replay: no recorded traffic at .*lab\.net\.json/);
    const plain = path.join(dir, 'plain.json');
    await writeFile(plain, JSON.stringify({ version: 1, app: { url: server.url }, scenes: [{ id: 'a', steps: [{ do: 'click', target: '#count' }] }] }));
    await expect(check(await loadScript(plain), { net: 'record' })).rejects.toThrow(/has no "replay"/);
    expect((await check(await loadScript(plain), { net: 'live' })).ok).toBe(true);
  });

  it('leaves the file untouched when a run fails', async () => {
    const failing = [{ do: 'click', target: '#nope' }];
    // auto with no file: a failed run writes nothing
    const failed = await check(await lab({}, failing));
    expect(failed.ok).toBe(false);
    expect(existsSync(netFile())).toBe(false);

    await check(await lab());
    const before = await readFile(netFile(), 'utf8');
    expect((await check(await lab({}, failing), { net: 'record' })).ok).toBe(false);
    expect(await readFile(netFile(), 'utf8')).toBe(before);
    // and a partial rehearsal (--until) does not write one either
    expect((await check(await lab(), { net: 'record', until: 'lab#2' })).ok).toBe(true);
    expect(await readFile(netFile(), 'utf8')).toBe(before);
  });

  it('record replays what check recorded', async () => {
    expect((await check(await lab(recorded))).ok).toBe(true);
    await record(await lab(recorded));
    expect(server.hits()).toBe(5);
  }, 60_000);
});
