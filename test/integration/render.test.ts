import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasAudio, probeVideo } from '../../src/ffmpeg';
import { workPaths } from '../../src/paths';
import { renderDemo, renderQaFrames, timelineFor } from '../../src/pipeline';
import { record } from '../../src/runner/record';
import { loadScript, type LoadedScript } from '../../src/script/load';
import { renderStills } from '../../src/render/render';
import { introFrames, sourceMsAtFrame, totalFrames } from '../../src/timeline/frames';
import { BROWSER_BAR, viewLayout } from '../../src/timeline/layout';
import type { Timeline } from '../../src/timeline/types';
import { fixtureScript } from '../helpers/fixture';
import { pixelsDiffering } from '../helpers/pixel';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
let loaded: LoadedScript;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
  loaded = await fixtureScript(server.url);
  await record(loaded);
});
afterAll(() => server.close());

async function editScript(mutate: (raw: any) => void): Promise<LoadedScript> {
  const raw = JSON.parse(await readFile(loaded.scriptPath, 'utf8'));
  mutate(raw);
  await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
  return loadScript(loaded.scriptPath);
}

describe('render', () => {
  it('renders a 1080p MP4 whose length matches the timeline', async () => {
    const { video: out, subtitles } = await renderDemo(loaded);
    expect(out).toBe(workPaths(loaded).video);
    expect(subtitles).toBeNull();
    expect(await hasAudio(out)).toBe(false);
    const probe = await probeVideo(out);
    expect(probe).toMatchObject({ width: 1920, height: 1080 });
    const tl = JSON.parse(await readFile(workPaths(loaded).timeline, 'utf8')) as Timeline;
    expect(Math.abs(probe.durationMs - (totalFrames(tl) * 1000) / tl.fps)).toBeLessThan(100);
    expect(tl.segments.some((s) => s.speed > 1)).toBe(true);
    expect(tl.camera.length).toBeGreaterThan(0);
    expect(tl.captions.map((c) => c.text)).toContain('Кешбек видно одразу');
  });

  it('draws keycaps inside the window, near its bottom', async () => {
    const { timeline } = await timelineFor(loaded);
    const frame = introFrames(timeline) + 20;
    const src = sourceMsAtFrame(timeline, frame)!;
    const plain: Timeline = { ...timeline, captions: [], keys: [] };
    const keyed: Timeline = { ...plain, keys: [{ startMs: src - 1000, endMs: src + 1000, caps: ['⌘', '⇧', 'K'] }] };
    const out = path.join(workPaths(loaded).root, 'keys-test');
    const [a] = await renderStills(plain, workPaths(loaded).root, out, [{ frame, name: 'plain' }]);
    const [b] = await renderStills(keyed, workPaths(loaded).root, out, [{ frame, name: 'keyed' }]);
    const win = viewLayout(timeline.output, timeline.stage, timeline.style.padding, timeline.chrome ? BROWSER_BAR : 0, timeline.aspect, timeline.subtitleBand);
    const bottom = Math.round(win.y + win.height);
    const band = { x: 860, y: bottom - 140, width: 200, height: 130 };
    expect(await pixelsDiffering(a, b, band)).toBeGreaterThan(500);
    // and nothing outside the window changed
    expect(await pixelsDiffering(a, b, { x: 860, y: bottom + 4, width: 200, height: 20 })).toBe(0);
  });

  it('leaves no Remotion bundle behind in the temp folder', async () => {
    const bundles = async () => (await readdir(tmpdir())).filter((n) => n.startsWith('remotion-webpack-bundle-')).length;
    const before = await bundles();
    await renderQaFrames(loaded);
    expect(await bundles()).toBe(before);
  });

  it('renders QA stills: intro + one per step, plus a contact sheet', async () => {
    const { sheet, frames: files } = await renderQaFrames(loaded);
    expect(sheet).toBe(path.join(workPaths(loaded).stills, 'sheet.png'));
    expect((await readFile(sheet)).readUInt32BE(16)).toBe(1920);
    expect(files).toHaveLength(9);
    for (const f of files) expect(existsSync(f)).toBe(true);
    expect(path.basename(files[0])).toBe('00-intro.png');
    expect(path.basename(files[6])).toBe('06-report-6-hover.png');
  });

  it('re-renders after a presentation-only change without re-recording', async () => {
    const edited = await editScript((raw) => {
      raw.scenes[0].steps[0].show.caption = 'Новий підпис';
      raw.style = { accent: '#ef4444' };
    });
    const { timeline } = await timelineFor(edited);
    expect(timeline.captions[0].text).toBe('Новий підпис');
    expect(timeline.style.accent).toBe('#ef4444');
  });

  it('ends on an outro card with the logo after the video', async () => {
    await writeFile(
      path.join(loaded.dir, 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#16a34a"/></svg>',
    );
    const edited = await editScript((raw) => {
      raw.meta = { ...raw.meta, logo: 'logo.svg', outro: { title: 'Try Acme', url: 'acme.example' } };
    });
    const { timeline } = await timelineFor(edited);
    expect(timeline.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(timeline.outro).toEqual({ title: 'Try Acme', url: 'acme.example', durationMs: 2600 });
    const { frames: files } = await renderQaFrames(edited);
    expect(path.basename(files.at(-1)!)).toBe('99-outro.png');
    expect(existsSync(files.at(-1)!)).toBe(true);
  });

  it('speaks narration, waits for it, mixes sounds and writes subtitles; a 0.3 take (no keys) still renders', async () => {
    const events = JSON.parse(await readFile(workPaths(loaded).events, 'utf8'));
    delete events.keys;
    await writeFile(workPaths(loaded).events, JSON.stringify(events));
    const edited = await editScript((raw) => {
      raw.scenes[1].steps[1].show = { say: 'That is all. Thanks for watching!' };
      raw.audio = {
        voice: { engine: 'command', command: 'ffmpeg -nostdin -v error -f lavfi -i sine=frequency=330:duration=3 -f wav -y {out}' },
        sounds: true,
        subtitles: 'burn',
      };
    });
    const { video, subtitles } = await renderDemo(edited);
    const tl = JSON.parse(await readFile(workPaths(loaded).timeline, 'utf8')) as Timeline;
    expect(tl.narration).toHaveLength(1);
    expect(tl.segments.at(-1)).toMatchObject({ speed: 0 });
    expect(tl.sounds.some((s) => s.kind === 'key')).toBe(true);
    expect(tl.audio).toEqual({ src: 'audio/mix.wav' });
    expect(await hasAudio(video)).toBe(true);
    const probe = await probeVideo(video);
    expect(Math.abs(probe.durationMs - (totalFrames(tl) * 1000) / tl.fps)).toBeLessThan(100);
    expect(subtitles).toBe(video.replace(/\.mp4$/, '.srt'));
    expect(await readFile(subtitles!, 'utf8')).toMatch(/^1\n\d\d:\d\d:\d\d,\d{3} --> .*\nThat is all\./);
  });

  it('renders without a soundtrack on request', async () => {
    const { video } = await renderDemo(await loadScript(loaded.scriptPath), { audio: false });
    expect(await hasAudio(video)).toBe(false);
  });

  it('cuts 9:16 from the same take, video and stills', async () => {
    const current = await loadScript(loaded.scriptPath);
    const out = path.join(loaded.dir, 'demo-9x16.mp4');
    const { video } = await renderDemo(current, { aspect: '9:16', out, audio: false });
    expect(await probeVideo(video)).toMatchObject({ width: 1080, height: 1920 });
    const { frames: files, sheet } = await renderQaFrames(current, { aspect: '9:16' });
    expect(path.dirname(sheet)).toBe(path.join(workPaths(loaded).root, 'frames-9x16'));
    expect(existsSync(path.join(workPaths(loaded).stills, '00-intro.png'))).toBe(true); // 16:9 stills stay
    const png = await readFile(files[1]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);
  });

  it('renders 1:1 stills', async () => {
    const { frames: files } = await renderQaFrames(await loadScript(loaded.scriptPath), { aspect: '1:1' });
    const png = await readFile(files[1]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  });

  it('cuts a scene with its subtitles, honours GIF fps, and mixes app sound clips', async () => {
    const full = await probeVideo(workPaths(loaded).video);
    await new Promise<void>((resolve, reject) =>
      execFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-y', path.join(loaded.dir, 'ring.wav')], (err) =>
        err ? reject(err) : resolve(),
      ),
    );
    const edited = await editScript((raw) => {
      raw.audio = { ...raw.audio, clips: [{ file: 'ring.wav', at: 'export#1', offsetMs: 200 }] };
    });
    const cut = await renderDemo(edited, { scenes: ['export'] });
    expect(cut.video).toBe(path.join(loaded.dir, 'demo-export.mp4'));
    expect(cut.durationMs).toBeLessThan(full.durationMs - 3000);
    expect(await hasAudio(cut.video)).toBe(true);
    const tl = JSON.parse(await readFile(workPaths(loaded).timeline, 'utf8')) as Timeline;
    expect(tl.clips).toHaveLength(1);
    const srt = await readFile(cut.subtitles!, 'utf8');
    const first = /^1\n(\d\d):(\d\d):(\d\d),(\d{3})/.exec(srt)!;
    expect(Number(first[3]) + Number(first[4]) / 1000).toBeLessThan(cut.durationMs / 1000);

    const gif = await renderDemo(edited, { scenes: ['export'], format: 'gif', width: 160, fps: 8 });
    const rate = await new Promise<string>((resolve, reject) =>
      execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', gif.video], (err, out) =>
        err ? reject(err) : resolve(out.trim()),
      ),
    );
    // GIF frame delays are whole centiseconds, so 8 fps comes out as 25/3.
    const [num, den] = rate.split('/').map(Number);
    expect(Math.abs(num / den - 8)).toBeLessThan(0.5);
    await expect(renderDemo(edited, { scenes: ['nope'] })).rejects.toThrow(/--scenes: no scene "nope" \(scenes: report, export\)/);
  });

  it('needs no voice for silent outputs unless subtitles are burned in', async () => {
    const failing = (subtitles: string) =>
      editScript((raw) => {
        raw.scenes[1].steps[1].show = { say: 'That is all. Thanks for watching!' };
        raw.audio = { voice: { engine: 'command', command: 'echo "no voice here" >&2; exit 3' }, subtitles };
      });
    const edited = await failing('file');
    const gif = await renderDemo(edited, { format: 'gif', width: 160 });
    expect(gif.subtitles).toBeNull();
    const tl = JSON.parse(await readFile(workPaths(loaded).timeline, 'utf8')) as Timeline;
    expect(tl.narration).toEqual([]);
    expect(tl.segments.some((s) => s.speed === 0)).toBe(false);
    const mute = await renderDemo(edited, { audio: false, out: path.join(loaded.dir, 'mute.mp4') });
    expect(await hasAudio(mute.video)).toBe(false);
    expect(mute.subtitles).toBeNull();
    await expect(renderDemo(await failing('burn'), { format: 'gif', width: 160 })).rejects.toThrow(
      /audio\.voice \(command\) failed for export#2/,
    );
  });

  it('refuses a stale take after an action change', async () => {
    const edited = await editScript((raw) => {
      raw.scenes[0].steps[1].text = 'Q4 revenue';
    });
    await expect(timelineFor(edited)).rejects.toThrow(/Actions changed since the take/);
  });
});
