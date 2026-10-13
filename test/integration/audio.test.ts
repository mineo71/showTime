import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
