import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workPaths } from '../../src/paths';
import { loadScript } from '../../src/script/load';

const base = { version: 1, app: { url: 'http://x' }, scenes: [{ id: 'a', steps: [{ do: 'click', target: 'text=Go' }] }] };

async function scriptIn(content: string) {
  const dir = await mkdtemp(join(tmpdir(), 'showtime-load-'));
  const file = join(dir, 'demo.json');
  await writeFile(file, content);
  return { dir, file };
}

describe('loadScript', () => {
  it('resolves storageState relative to the script, not the cwd', async () => {
    const { dir, file } = await scriptIn(JSON.stringify({ ...base, app: { url: 'http://x', storageState: './auth/s.json' } }));
    await mkdir(join(dir, 'auth'));
    await writeFile(join(dir, 'auth', 's.json'), '{"cookies":[],"origins":[]}');
    const loaded = await loadScript(file);
    expect(loaded.script.app.storageState).toBe(join(dir, 'auth', 's.json'));
    expect(loaded.name).toBe('demo');
    expect(loaded.dir).toBe(dir);
  });

  it('reports a missing storageState file', async () => {
    const { file } = await scriptIn(JSON.stringify({ ...base, app: { url: 'http://x', storageState: 'nope.json' } }));
    await expect(loadScript(file)).rejects.toThrow(/storageState not found/);
  });

  it('reports invalid JSON with the file path', async () => {
    const { file } = await scriptIn('{ nope');
    await expect(loadScript(file)).rejects.toThrow(/Invalid JSON in .*demo\.json/);
  });

  it('reports a missing file', async () => {
    await expect(loadScript('/definitely/missing.json')).rejects.toThrow(/Cannot read script/);
  });
});

describe('brand file and logo', () => {
  async function project() {
    const root = await mkdtemp(join(tmpdir(), 'showtime-brand-'));
    await mkdir(join(root, 'brand'));
    await mkdir(join(root, 'demos'));
    await writeFile(join(root, 'brand', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    return root;
  }

  it('applies the nearest showtime.config.json as defaults, the script winning key by key', async () => {
    const root = await project();
    const config = {
      style: { accent: '#111111', radius: 20 },
      meta: { logo: 'brand/logo.svg', outro: { title: 'Try Acme' } },
    };
    await writeFile(join(root, 'showtime.config.json'), JSON.stringify(config));
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify({ ...base, style: { accent: '#222222' }, meta: { title: 'A' } }));
    const loaded = await loadScript(file);
    expect(loaded.config).toBe(join(root, 'showtime.config.json'));
    expect(loaded.script.style).toMatchObject({ accent: '#222222', radius: 20 });
    expect(loaded.script.meta).toEqual({ title: 'A', logo: join(root, 'brand', 'logo.svg'), outro: { title: 'Try Acme' } });
  });

  it('resolves the script\'s own logo against the script folder', async () => {
    const root = await project();
    await writeFile(join(root, 'demos', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify({ ...base, meta: { logo: 'mark.svg' } }));
    const loaded = await loadScript(file);
    expect(loaded.script.meta.logo).toBe(join(root, 'demos', 'mark.svg'));
    expect(loaded.config).toBeNull();
  });

  it('reports a missing logo file', async () => {
    const root = await project();
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify({ ...base, meta: { logo: 'nope.svg' } }));
    await expect(loadScript(file)).rejects.toThrow(/meta\.logo not found: .*nope\.svg/);
  });

  it('blames the brand file, not the script, for a bad value inside it', async () => {
    const root = await project();
    await writeFile(join(root, 'showtime.config.json'), JSON.stringify({ style: { accentColor: '#f00', padding: 0.5 } }));
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify(base));
    const err = (await loadScript(file).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/^Invalid .*showtime\.config\.json/);
    expect(err.message).toMatch(/style\.padding/);
    expect(err.message).toMatch(/accentColor/);
  });

  it('rejects unknown keys in the brand file and names it', async () => {
    const root = await project();
    await writeFile(join(root, 'showtime.config.json'), JSON.stringify({ colours: {} }));
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify(base));
    await expect(loadScript(file)).rejects.toThrow(/showtime\.config\.json[\s\S]*colours/);
  });
});

describe('workPaths', () => {
  it('keeps everything under .showtime/<name> next to the script', async () => {
    const { dir, file } = await scriptIn(JSON.stringify(base));
    const p = workPaths(await loadScript(file));
    expect(p.root).toBe(join(dir, '.showtime', 'demo'));
    expect(p.raw).toBe(join(dir, '.showtime', 'demo', 'take', 'raw.mp4'));
    expect(p.events).toBe(join(dir, '.showtime', 'demo', 'take', 'events.json'));
    expect(p.video).toBe(join(dir, 'demo.mp4'));
  });
});
