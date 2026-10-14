import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { utimes } from 'node:fs/promises';
import { musicSamples } from '../../src/audio/decode';
import { ensureVoices } from '../../src/audio/tts';
import { readWav } from '../../src/audio/wav';
import { fixtureScript } from '../helpers/fixture';

/** A command voice that ignores the text and writes a sine of `seconds`, counting its runs. */
const sine = (seconds: number, counter: string) =>
  `echo x >> '${counter}'; ffmpeg -v error -f lavfi -i sine=frequency=440:duration=${seconds} -f wav -y {out}`;

describe('ensureVoices', () => {
  it('synthesizes each line once, normalised to mono 48 kHz, and reuses the cache', async () => {
    let counter = '';
    const loaded = await fixtureScript('http://127.0.0.1:1/', (raw) => {
      raw.scenes[0].steps[0].show.say = 'Create a report in one click.';
      raw.scenes[1].steps[0].show.say = 'Export it anywhere.';
    });
    counter = path.join(loaded.dir, 'runs.txt');
    loaded.script.audio.voice = { engine: 'command', speed: 1, command: sine(1.5, counter) };
    const clips = await ensureVoices(loaded);
    expect(Object.keys(clips)).toEqual(['report#1', 'export#1']);
    expect(clips['report#1'].durationMs).toBeGreaterThan(1450);
    expect(clips['report#1'].durationMs).toBeLessThan(1600);
    const wav = await readWav(clips['report#1'].file);
    expect(wav.rate).toBe(48_000);
    expect(wav.channels).toHaveLength(1);
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(2);

    await ensureVoices(loaded);
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('lets two runs synthesize the same new line at once', async () => {
    const loaded = await fixtureScript('http://127.0.0.1:1/', (raw) => {
      raw.scenes[1].steps[0].show.say = 'Both at once.';
    });
    loaded.script.audio.voice = { engine: 'command', speed: 1, command: 'sleep 0.3; ffmpeg -v error -f lavfi -i sine=duration=0.5 -f wav -y {out}' };
    const [a, b] = await Promise.all([ensureVoices(loaded), ensureVoices(loaded)]);
    expect(a['export#1'].durationMs).toBeGreaterThan(400);
    expect(b['export#1'].file).toBe(a['export#1'].file);
  });

  it('decodes a music file once until it changes', async () => {
    const loaded = await fixtureScript('http://127.0.0.1:1/');
    const music = path.join(loaded.dir, 'bed.wav');
    await new Promise<void>((resolve, reject) => {
      import('node:child_process').then(({ execFile }) =>
        execFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-y', music], (err) => (err ? reject(err) : resolve())),
      );
    });
    const first = await musicSamples(music, -20);
    expect(await musicSamples(music, -20)).toBe(first);
    await utimes(music, new Date(), new Date(Date.now() + 5000));
    expect(await musicSamples(music, -20)).not.toBe(first);
  });

  it('speaks a step with its own voice changes, cached apart', async () => {
    const loaded = await fixtureScript('http://127.0.0.1:1/', (raw) => {
      raw.scenes[0].steps[0].show.say = 'First narrator.';
      raw.scenes[1].steps[0].show = { say: 'Second narrator.', voice: { command: 'ffmpeg -v error -f lavfi -i sine=duration=1.5 -f wav -y {out}' } };
    });
    loaded.script.audio.voice = { engine: 'command', speed: 1, command: 'ffmpeg -v error -f lavfi -i sine=duration=0.5 -f wav -y {out}' };
    const clips = await ensureVoices(loaded);
    expect(clips['report#1'].durationMs).toBeLessThan(700);
    expect(clips['export#1'].durationMs).toBeGreaterThan(1400);
  });

  it('mixes your own click file at the pack volume', async () => {
    const { mixSoundtrack, CLICK_GAIN } = await import('../../src/audio/soundtrack');
    const { buildTimeline } = await import('../../src/timeline/build');
    const { introFrames } = await import('../../src/timeline/frames');
    const loaded = await fixtureScript('http://127.0.0.1:1/');
    const click = path.join(loaded.dir, 'click.wav');
    const { writeWav: write } = await import('../../src/audio/wav');
    await write(click, [new Float32Array(4800).fill(0.8)], 48_000);
    loaded.script.audio.sounds = { pack: 'soft', click, volume: 0.5 };
    const events = {
      version: 1 as const,
      actionHash: 'x',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      video: { file: 'raw.mp4', width: 1280, height: 800, fps: 30, durationMs: 3000 },
      steps: [{ sceneId: 'report', index: 0, do: 'click' as const, startMs: 0, actionMs: 1000, endMs: 1100, settledMs: 1500 }],
      moves: [],
      clicks: [{ tMs: 1000, x: 10, y: 10 }],
      idle: [],
    };
    loaded.script.scenes = [{ id: 'report', steps: [{ do: 'click', target: '#a' }] }];
    const t = buildTimeline(loaded.script, events);
    const src = await mixSoundtrack(loaded, t, {});
    const mix = await readWav(path.join(loaded.dir, '.showtime', 'demo', src!));
    const at = Math.round(((introFrames(t) * 1000) / t.fps + 1000 + 20) * 48);
    expect(mix.channels[0][at]).toBeCloseTo(0.8 * CLICK_GAIN * 0.5, 2);
  });

  it('names the step whose line failed', async () => {
    const loaded = await fixtureScript('http://127.0.0.1:1/', (raw) => {
      raw.scenes[1].steps[0].show.say = 'Export it anywhere.';
    });
    loaded.script.audio.voice = { engine: 'command', speed: 1, command: 'echo "no voice model" >&2; exit 3' };
    await expect(ensureVoices(loaded)).rejects.toThrow(/audio\.voice \(command\) failed for export#1: exit code 3[\s\S]*no voice model/);
  });

  it.runIf(process.platform === 'darwin')('speaks with the macOS system voice', async () => {
    const loaded = await fixtureScript('http://127.0.0.1:1/', (raw) => {
      raw.scenes[1].steps[0].show.say = `It's "fine" — Привіт.`;
    });
    const clips = await ensureVoices(loaded);
    expect(clips['export#1'].durationMs).toBeGreaterThan(300);
    await writeFile(path.join(loaded.dir, 'ok'), '');
  });
});
