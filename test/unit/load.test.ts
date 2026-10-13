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
