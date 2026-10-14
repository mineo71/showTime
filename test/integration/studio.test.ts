import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('refuses an edit aimed at a step that moved, and writes nothing', async () => {
    const state = await (await api('/api/state')).json();
    const before = await readFile(loaded.scriptPath, 'utf8');
    const wrong = state.steps[1].id;
    const res = await api('/api/edit', { method: 'POST', body: JSON.stringify({ where: 'report#1', step: wrong, show: { caption: 'x' } }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed on disk/);
    expect(await readFile(loaded.scriptPath, 'utf8')).toBe(before);
  });

  it('forbids framing the page', async () => {
    const page = await fetch(studio.url);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
  });

  it('survives a file it cannot read', async () => {
    const locked = path.join(loaded.dir, '.showtime', loaded.name, 'locked.png');
    await writeFile(locked, 'x');
    await chmod(locked, 0o000);
    const res = await fetch(new URL('/files/locked.png', studio.url));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await fetch(studio.url)).status).toBe(200);
  });

  it('keeps the look panel on the script, even with a stale take', async () => {
    await api('/api/edit', { method: 'POST', body: JSON.stringify({ where: 'report#6', show: { hold: 1500 } }) });
    const stale = await (await api('/api/state')).json();
    expect(stale.take).toBe('stale');
    const res = await api('/api/edit', { method: 'POST', body: JSON.stringify({ style: { accent: '#ff0000' } }) });
    expect((await res.json()).style.accent).toBe('#ff0000');
    await api('/api/edit', { method: 'POST', body: JSON.stringify({ where: 'report#6', show: { hold: 1200 } }) });
    expect((await (await api('/api/state')).json()).take).toBe('ok');
  });

  it('mixes the preview soundtrack apart from the render one', async () => {
    const raw = JSON.parse(await readFile(loaded.scriptPath, 'utf8'));
    raw.audio = { sounds: true };
    await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
    await expect
      .poll(async () => (await (await api('/api/state')).json()).timeline?.audio?.src ?? '', { timeout: 20_000 })
      .toMatch(/^audio\/preview\.wav\?v=\d+$/);
  });

  it('tells a page from an earlier studio session to reload, and keeps other refusals plain', async () => {
    const old = await fetch(new URL('/api/state', studio.url), { headers: { 'x-showtime-token': 'from-yesterday' } });
    expect(old.status).toBe(403);
    expect((await old.json()).error).toMatch(/earlier studio session\. Reload it/);
    const crossSite = await api('/api/state', { headers: { origin: 'https://evil.example' } });
    expect((await crossSite.json()).error).toBe('Forbidden.');
  });

  it('records with the network mode the page picked, and refuses an unknown one', async () => {
    expect((await (await api('/api/state')).json()).replay).toBe(false);
    const bogus = await api('/api/record', { method: 'POST', body: JSON.stringify({ net: 'offline' }) });
    expect(bogus.status).toBe(400);
    expect((await bogus.json()).error).toMatch(/auto, live, record or replay/);
    // The demo has no replay section: --net record fails at once, which shows the mode reached record().
    const res = await api('/api/record', { method: 'POST', body: JSON.stringify({ net: 'record' }) });
    expect(res.status).toBe(202);
    await expect
      .poll(async () => (await (await api('/api/state')).json()).job?.error ?? '', { timeout: 20_000 })
      .toMatch(/--net record: the script has no "replay" section/);
  });

  it('refuses to render or record an invalid script instead of using the last good one', async () => {
    const good = await readFile(loaded.scriptPath, 'utf8');
    const raw = JSON.parse(good);
    raw.scenes[0].steps[0].show = { zoom: 99 };
    await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
    try {
      await expect.poll(async () => (await (await api('/api/state')).json()).error ?? '', { timeout: 20_000 }).toMatch(/zoom/);
      for (const route of ['/api/render', '/api/record']) {
        const res = await api(route, { method: 'POST', body: '{}' });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/zoom/);
      }
    } finally {
      await writeFile(loaded.scriptPath, good);
      await expect.poll(async () => (await (await api('/api/state')).json()).error, { timeout: 20_000 }).toBeNull();
    }
  });

  it('still records when only the preview failed (a voice that does not work), not the script', async () => {
    const good = await readFile(loaded.scriptPath, 'utf8');
    const raw = JSON.parse(good);
    raw.scenes[0].steps[0].show = { say: 'Hello there.' };
    raw.audio = { voice: { engine: 'command', command: 'echo "no voice model" >&2; exit 3' } };
    await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
    try {
      await expect.poll(async () => (await (await api('/api/state')).json()).error ?? '', { timeout: 20_000 }).toMatch(/no voice model|exit/);
      // --net record on a script without replay fails at once: enough to see the job was let through.
      const res = await api('/api/record', { method: 'POST', body: JSON.stringify({ net: 'record' }) });
      expect(res.status).toBe(202);
      await expect.poll(async () => (await (await api('/api/state')).json()).job?.status, { timeout: 20_000 }).toBe('failed');
    } finally {
      await writeFile(loaded.scriptPath, good);
      await expect.poll(async () => (await (await api('/api/state')).json()).error, { timeout: 20_000 }).toBeNull();
    }
  });

  it('picks up a brand file created after it started, and its removal', async () => {
    const brand = path.join(loaded.dir, 'showtime.config.json');
    await writeFile(brand, JSON.stringify({ style: { radius: 31 } }));
    try {
      await expect.poll(async () => (await (await api('/api/state')).json()).style?.radius, { timeout: 20_000 }).toBe(31);
    } finally {
      await rm(brand, { force: true });
    }
    await expect.poll(async () => (await (await api('/api/state')).json()).style?.radius, { timeout: 20_000 }).toBe(14);
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

      // A zoom the agent wrote that isn't in the list still shows as itself.
      await api('/api/edit', { method: 'POST', body: JSON.stringify({ where: 'report#3', show: { zoom: 1.6 } }) });
      await page.locator('[data-where="report#3"]').click();
      await expect.poll(() => page.locator('[data-field=zoom]').inputValue()).toBe('1.6');

      // Dragging through the colour picker saves once, when the pick is done.
      const before = await readFile(loaded.scriptPath, 'utf8');
      await page.locator('[data-field=accent]').evaluate((el: HTMLInputElement) => {
        el.value = '#123456';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(1500);
      expect(await readFile(loaded.scriptPath, 'utf8')).toBe(before);
      await page.locator('[data-field=accent]').evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('change', { bubbles: true })));
      await expect.poll(async () => (await readFile(loaded.scriptPath, 'utf8')).includes('#123456'), { timeout: 20_000 }).toBe(true);
      // The 0.7 look: a click animation and a highlight for a step, a caption style and a sound pack.
      await page.locator('[data-where="report#1"]').click();
      const untouched = await readFile(loaded.scriptPath, 'utf8');
      await page.locator('[data-field=highlight]').focus();
      await page.locator('[data-field=caption]').focus();
      await page.waitForTimeout(1500);
      expect(await readFile(loaded.scriptPath, 'utf8')).toBe(untouched);
      await page.locator('[data-field=click]').selectOption('burst');
      await page.locator('[data-field=spotlightKind]').selectOption('glow');
      await expect.poll(async () => (await readFile(loaded.scriptPath, 'utf8')).includes('"click": "burst"'), { timeout: 20_000 }).toBe(true);
      await expect.poll(async () => (await readFile(loaded.scriptPath, 'utf8')).includes('"spotlight": "glow"'), { timeout: 20_000 }).toBe(true);
      await page.locator('[data-field=captionStyle]').selectOption('bar');
      await expect.poll(async () => (await readFile(loaded.scriptPath, 'utf8')).includes('"captionStyle": "bar"'), { timeout: 20_000 }).toBe(true);
      await page.locator('[data-field=sounds]').selectOption('pop');
      await expect.poll(async () => (await readFile(loaded.scriptPath, 'utf8')).includes('"sounds": "pop"'), { timeout: 20_000 }).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('sets speed and caption length by dragging, and freezes a step from the inspector', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(studio.url);
      await page.locator('[data-testid=player]').waitFor();
      const show = async (where: string) => {
        const raw = JSON.parse(await readFile(loaded.scriptPath, 'utf8'));
        const [id, n] = where.split('#');
        return (raw.scenes.find((x: { id: string }) => x.id === id).steps[Number(n) - 1].show ?? {}) as Record<string, number>;
      };
      const drag = async (selector: string, dx: number) => {
        const box = (await page.locator(selector).boundingBox())!;
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 6 });
        await page.mouse.up();
      };

      // Twice as long: slower than real time, never below 0.25×.
      const block = (await page.locator('[data-where="report#2"]').boundingBox())!;
      await drag('[data-where="report#2"] [data-grip]', block.width);
      await expect.poll(async () => (await show('report#2')).speed ?? 99, { timeout: 20_000 }).toBeLessThan(1);
      expect((await show('report#2')).speed).toBeGreaterThanOrEqual(0.25);

      // A caption bar dragged longer sets how long it stays up.
      await expect.poll(() => page.locator('[data-caption="export#1"]').count()).toBe(1);
      await drag('[data-caption="export#1"] [data-grip]', 120);
      await expect.poll(async () => (await show('export#1')).captionMs ?? 0, { timeout: 20_000 }).toBeGreaterThan(1200);

      // A freeze, set in the inspector, shows striped on the timeline.
      await page.locator('[data-where="report#4"]').click();
      const freeze = page.locator('[data-field=freezeMs]');
      await freeze.fill('1500');
      await freeze.press('Enter');
      await expect.poll(async () => (await show('report#4')).freezeMs, { timeout: 20_000 }).toBe(1500);
      await expect.poll(() => page.locator('[data-freeze="report#4"]').count(), { timeout: 20_000 }).toBe(1);
      // Text that isn't a whole number is refused in place; the freeze stays.
      await freeze.fill('abc');
      await freeze.press('Enter');
      await expect.poll(() => freeze.getAttribute('aria-invalid')).toBe('true');
      await page.waitForTimeout(1500);
      expect((await show('report#4')).freezeMs).toBe(1500);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
