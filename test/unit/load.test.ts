import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stillsFor, workPaths } from '../../src/paths';
import { loadScript, parseLoaded } from '../../src/script/load';

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

  it('validates raw JSON for a script path the same way loadScript reads it', async () => {
    const { file } = await scriptIn(JSON.stringify(base));
    expect(await parseLoaded(base, file)).toEqual(await loadScript(file));
    await expect(parseLoaded({ ...base, scenes: [] }, file)).rejects.toThrow(/Invalid .*demo\.json/);
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

describe('audio paths and brand audio', () => {
  async function project() {
    const root = await mkdtemp(join(tmpdir(), 'showtime-audio-'));
    await mkdir(join(root, 'brand'));
    await mkdir(join(root, 'demos'));
    await writeFile(join(root, 'brand', 'bed.mp3'), 'x');
    await writeFile(join(root, 'demos', 'own.mp3'), 'x');
    return root;
  }

  it('resolves the script\'s music against the script folder', async () => {
    const root = await project();
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify({ ...base, audio: { music: { file: 'own.mp3' } } }));
    const loaded = await loadScript(file);
    expect(loaded.script.audio.music?.file).toBe(join(root, 'demos', 'own.mp3'));
  });

  it('takes audio defaults from the brand file, music resolved against its folder, voice replaced as a whole', async () => {
    const root = await project();
    const config = { audio: { voice: { engine: 'openai', name: 'alloy' }, music: { file: 'brand/bed.mp3', volume: 0.1 }, sounds: true } };
    await writeFile(join(root, 'showtime.config.json'), JSON.stringify(config));
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify({ ...base, audio: { voice: { engine: 'system' }, subtitles: 'burn' } }));
    const { script } = await loadScript(file);
    expect(script.audio).toEqual({
      voice: { engine: 'system', speed: 1 },
      music: { file: join(root, 'brand', 'bed.mp3'), volume: 0.1 },
      sounds: true,
      subtitles: 'burn',
      clips: [],
    });
  });

  it('resolves clip files like music, and reports a missing one by index', async () => {
    const root = await project();
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify({ ...base, audio: { clips: [{ file: 'own.mp3', at: 'a#1' }] } }));
    expect((await loadScript(file)).script.audio.clips[0].file).toBe(join(root, 'demos', 'own.mp3'));
    await writeFile(file, JSON.stringify({ ...base, audio: { clips: [{ file: 'own.mp3', at: 'a#1' }, { file: 'gone.wav', at: 'a#1' }] } }));
    await expect(loadScript(file)).rejects.toThrow(/audio\.clips\[1\]\.file not found: .*gone\.wav/);
    await writeFile(file, JSON.stringify({ ...base, audio: { clips: [{ file: 'own.mp3', at: 'b#7' }] } }));
    await expect(loadScript(file)).rejects.toThrow(/audio\.clips\[0\]\.at: no step b#7/);
  });

  it('reports a missing music file', async () => {
    const root = await project();
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify({ ...base, audio: { music: { file: 'nope.mp3' } } }));
    await expect(loadScript(file)).rejects.toThrow(/audio\.music\.file not found: .*nope\.mp3/);
  });

  it('blames the brand file for a bad audio value', async () => {
    const root = await project();
    await writeFile(join(root, 'showtime.config.json'), JSON.stringify({ audio: { voice: { engine: 'robot' } } }));
    const file = join(root, 'demos', 'a.json');
    await writeFile(file, JSON.stringify(base));
    await expect(loadScript(file)).rejects.toThrow(/showtime\.config\.json[\s\S]*audio\.voice\.engine/);
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

  it('keeps the stills of each cropped format in their own folder', async () => {
    const { dir, file } = await scriptIn(JSON.stringify(base));
    const p = workPaths(await loadScript(file));
    expect(stillsFor(p, '16:9')).toEqual({ dir: p.stills, sheet: p.sheet });
    expect(stillsFor(p, '9:16')).toEqual({
      dir: join(dir, '.showtime', 'demo', 'frames-9x16'),
      sheet: join(dir, '.showtime', 'demo', 'frames-9x16', 'sheet.png'),
    });
  });
});
