import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../../bin/showtime.mjs', import.meta.url));

async function cli(args: string[], cwd = tmpdir(), env: NodeJS.ProcessEnv = process.env) {
  try {
    const r = await exec(process.execPath, [BIN, ...args], { cwd, env, maxBuffer: 50_000_000 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('showtime CLI', () => {
  it('prints the schema', async () => {
    const r = await cli(['schema']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).properties.scenes).toBeDefined();
    expect((await cli(['schema', '--json'])).code).toBe(0);
  });

  it('documents studio and record-human, and rejects bad input before opening anything', async () => {
    const studio = await cli(['studio', '--help']);
    expect(studio.stdout).toMatch(/--port/);
    expect(studio.stdout).toMatch(/--aspect/);
    expect(studio.stdout).toMatch(/--no-open/);
    const human = await cli(['record-human', '--help']);
    for (const flag of ['--out', '--viewport', '--force']) expect(human.stdout).toContain(flag);
    const badUrl = await cli(['record-human', 'not a url']);
    expect(badUrl.code).toBe(1);
    expect(badUrl.stderr).toMatch(/http/);
    const badSize = await cli(['record-human', 'http://127.0.0.1:1/', '--viewport', 'big']);
    expect(badSize.stderr).toMatch(/--viewport must look like 1440x900/);
    const missing = await cli(['studio', '/definitely/missing.json', '--no-open']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/Cannot read script/);
  });

  it('fails clearly on an invalid script', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-cli-'));
    const file = path.join(dir, 'bad.json');
    await writeFile(file, JSON.stringify({ version: 1, scenes: [] }));
    const r = await cli(['check', file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/✖ Invalid .*bad\.json/);
    expect(r.stderr).toMatch(/app/);
  });

  it('check --json reports failures as JSON with exit code 1', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes = [{ id: 'x', steps: [{ do: 'click', target: '.dup' }] }];
    });
    const r = await cli(['check', loaded.scriptPath, '--json']);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.ok).toBe(false);
    expect(report.failure.sceneId).toBe('x');
  });

  it('make produces the video next to the script, independent of the cwd', async () => {
    const loaded = await fixtureScript(server.url);
    const r = await cli(['make', loaded.scriptPath]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('check passed');
    expect(existsSync(path.join(loaded.dir, 'demo.mp4'))).toBe(true);
  });

  it('lint --json reports script issues and exits 1 on a warning, without needing a take', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes[0].steps[0].show.caption = 'Create a brand new report in just one click';
    });
    const r = await cli(['lint', loaded.scriptPath, '--json']);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.timing).toBe(false);
    expect(out.issues).toContainEqual(expect.objectContaining({ rule: 'caption-length', where: 'report#1', level: 'warn' }));
  });

  it('speaks JSON on every command: make, frames, render, lint with timing', async () => {
    const loaded = await fixtureScript(server.url);
    const made = await cli(['make', loaded.scriptPath, '--json']);
    expect(made.code, made.stderr).toBe(0);
    const m = JSON.parse(made.stdout);
    expect(m.check.ok).toBe(true);
    expect(m.take).toMatchObject({ steps: 8 });
    expect(m.take.durationMs).toBeGreaterThan(5000);
    expect(m.video.video).toBe(path.join(loaded.dir, 'demo.mp4'));
    expect(m.video.durationMs).toBeGreaterThan(m.take.durationMs / 3);

    const frames = JSON.parse((await cli(['frames', loaded.scriptPath, '--json'])).stdout);
    expect(existsSync(frames.sheet)).toBe(true);
    expect(frames.frames).toHaveLength(9);

    const rendered = JSON.parse((await cli(['render', loaded.scriptPath, '--json', '-o', path.join(loaded.dir, 'again.mp4')])).stdout);
    expect(rendered.video).toBe(path.join(loaded.dir, 'again.mp4'));

    const lint = await cli(['lint', loaded.scriptPath, '--json']);
    expect(JSON.parse(lint.stdout).timing).toBe(true);

    const gif = await cli(['render', loaded.scriptPath, '--format', 'gif', '--aspect', '9:16', '--width', '240', '--json']);
    expect(gif.code, gif.stderr).toBe(0);
    const g = JSON.parse(gif.stdout);
    expect(g).toMatchObject({ video: path.join(loaded.dir, 'demo-9x16.gif'), subtitles: null });
    expect(g.durationMs).toBeGreaterThan(1000);
    const head = await readFile(g.video);
    expect(head.toString('ascii', 0, 6)).toBe('GIF89a');
    expect(head.readUInt16LE(6)).toBe(240);

    const webp = await cli(['render', loaded.scriptPath, '-o', path.join(loaded.dir, 'clip.webp'), '--json']);
    expect(webp.code, webp.stderr).toBe(0);
    const w = await readFile(JSON.parse(webp.stdout).video);
    expect(w.toString('ascii', 8, 12)).toBe('WEBP');

    const bad = await cli(['render', loaded.scriptPath, '--aspect', '4:3']);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/--aspect must be 16:9, 9:16 or 1:1/);
  });

  it('record --json describes the take', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes = [{ id: 'a', steps: [{ do: 'click', target: '#new-report' }] }];
    });
    const r = await cli(['record', loaded.scriptPath, '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ take: path.join(loaded.dir, '.showtime', 'demo', 'take'), steps: 1 });
  });

  it('setup --json --no-browsers links the skill for both agents under HOME', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'showtime-home-'));
    const r = await cli(['setup', '--json', '--no-browsers'], tmpdir(), { ...process.env, HOME: home });
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.browsers).toBe(false);
    expect(out.links).toEqual([path.join(home, '.claude/skills/showtime'), path.join(home, '.agents/skills/showtime')]);
    expect((await lstat(out.links[0])).isSymbolicLink()).toBe(true);
  });
});
