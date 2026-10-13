import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { record } from '../../src/runner/record';
import type { LoadedScript } from '../../src/script/load';
import { startStudio, type Studio } from '../../src/studio/server';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
let loaded: LoadedScript;
let studio: Studio;
const api = (p: string, init: RequestInit = {}) =>
  fetch(new URL(p, studio.url), { ...init, headers: { 'x-showtime-token': studio.token, 'content-type': 'application/json', ...init.headers } });

beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
  loaded = await fixtureScript(server.url);
  await record(loaded);
  studio = await startStudio(loaded.scriptPath, { port: 0 });
}, 180_000);
afterAll(async () => {
  await studio?.close();
  server.close();
});

describe('studio server', () => {
  it('serves the page with its token and the bundled client', async () => {
    const page = await fetch(studio.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(studio.token);
    const app = await fetch(new URL('/app.js', studio.url));
    expect(app.headers.get('content-type')).toMatch(/javascript/);
    expect((await app.text()).length).toBeGreaterThan(10_000);
  });

  it('reports the timeline and where each step sits', async () => {
    const state = await (await api('/api/state')).json();
    expect(state.take).toBe('ok');
    expect(state.error).toBeNull();
    expect(state.timeline.output).toEqual({ width: 1920, height: 1080 });
    expect(state.steps.map((s: { where: string }) => s.where)).toEqual([
      'report#1', 'report#2', 'report#3', 'report#4', 'report#5', 'report#6', 'export#1', 'export#2',
    ]);
    expect(state.steps[0].startFrame).toBeGreaterThan(0);
  });

  it('saves an edit to the file, formatted, and returns the new state', async () => {
    const res = await api('/api/edit', { method: 'POST', body: JSON.stringify({ where: 'report#1', show: { caption: 'Нова назва' } }) });
    expect(res.status).toBe(200);
    const state = await res.json();
    expect(state.timeline.captions[0].text).toBe('Нова назва');
    const text = await readFile(loaded.scriptPath, 'utf8');
    expect(text).toContain('{ "do": "click", "target": "role=button[name=\'New report\']", "show": { "caption": "Нова назва" } }');
  });

  it('writes nothing for an invalid edit', async () => {
    const before = await readFile(loaded.scriptPath, 'utf8');
    const res = await api('/api/edit', { method: 'POST', body: JSON.stringify({ where: 'report#1', show: { zoom: 9 } }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/zoom/);
    const unknown = await api('/api/edit', { method: 'POST', body: JSON.stringify({ app: { url: 'http://evil' } }) });
    expect(unknown.status).toBe(400);
    expect(await readFile(loaded.scriptPath, 'utf8')).toBe(before);
  });

  it('refuses requests without the token, from another host or origin', async () => {
    expect((await fetch(new URL('/api/state', studio.url))).status).toBe(403);
    // fetch() won't send a forged Host header; a raw request does, like a DNS-rebinding page would.
    const { port } = new URL(studio.url);
    const rebinding = await new Promise<number>((resolve, reject) =>
      request({ host: '127.0.0.1', port, path: '/api/state', headers: { host: `evil.example:${port}`, 'x-showtime-token': studio.token } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
        .on('error', reject)
        .end(),
    );
    expect(rebinding).toBe(403);
    const crossSite = await api('/api/edit', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
    expect(crossSite.status).toBe(403);
  });

  it('serves the take with range requests, and nothing outside the work folder', async () => {
    const part = await fetch(new URL('/files/take/raw.mp4', studio.url), { headers: { range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toMatch(/^bytes 0-99\//);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await fetch(new URL('/files/..%2Fdemo.json', studio.url))).status).toBe(404);
  });

  it('pushes a state event when the script changes on disk', async () => {
    const events = await fetch(new URL(`/api/events?token=${studio.token}`, studio.url));
    const reader = events.body!.getReader();
    const raw = JSON.parse(await readFile(loaded.scriptPath, 'utf8'));
    raw.scenes[1].steps[0].show.caption = 'Edited by the agent';
    await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
    let seen = '';
    const deadline = Date.now() + 20_000;
    while (!seen.includes('event: state') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(seen).toContain('event: state');
    const state = await (await api('/api/state')).json();
    expect(state.timeline.captions.map((c: { text: string }) => c.text)).toContain('Edited by the agent');
  });

  it('says when there is no take yet', async () => {
    const fresh = await fixtureScript(server.url);
    const other = await startStudio(fresh.scriptPath, { port: 0 });
    try {
      const res = await fetch(new URL('/api/state', other.url), { headers: { 'x-showtime-token': other.token } });
      const state = await res.json();
      expect(state.take).toBe('missing');
      expect(state.timeline).toBeNull();
      expect(state.steps).toHaveLength(8);
    } finally {
      await other.close();
    }
  });
});

describe('studio page', () => {
  it('previews the video, lists the steps, and saves an inspector edit to the file', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(studio.url);
      await page.locator('[data-testid=player]').waitFor();
      await expect.poll(() => page.locator('[data-where]').count()).toBe(8);
      await page.locator('[data-where="report#2"]').click();
      await expect.poll(() => page.locator('video').first().getAttribute('src')).toMatch(/^\/files\/take\/raw\.mp4/);
      const caption = page.locator('[data-field=caption]');
      await caption.fill('Typed in the studio');
      await caption.press('Enter');
      await expect
        .poll(async () => (await readFile(loaded.scriptPath, 'utf8')).includes('"caption": "Typed in the studio"'), { timeout: 20_000 })
        .toBe(true);
      await expect.poll(() => page.locator('[data-where="report#2"] [data-icon=caption]').count()).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
