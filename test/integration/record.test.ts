import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeVideo } from '../../src/ffmpeg';
import { workPaths } from '../../src/paths';
import { record } from '../../src/runner/record';
import { actionHash } from '../../src/script/hash';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('record', () => {
  it('records a take: device-pixel raw video, wall-clock duration, consistent events', async () => {
    const loaded = await fixtureScript(server.url);
    const ev = await record(loaded);
    const paths = workPaths(loaded);

    expect(existsSync(paths.raw)).toBe(true);
    expect(existsSync(paths.rawFrames)).toBe(false);
    const probe = await probeVideo(paths.raw);
    expect(probe.width).toBe(2560);
    expect(probe.height).toBe(1600);
    expect(Math.abs(probe.durationMs - ev.video.durationMs)).toBeLessThan(200);

    expect(ev.actionHash).toBe(actionHash(loaded.script));
    expect(ev.steps).toHaveLength(8);
    for (const s of ev.steps) {
      expect(s.startMs).toBeLessThanOrEqual(s.actionMs);
      expect(s.actionMs).toBeLessThanOrEqual(s.endMs);
      expect(s.endMs).toBeLessThanOrEqual(s.settledMs);
    }
    for (let i = 1; i < ev.steps.length; i++) expect(ev.steps[i].startMs).toBeGreaterThanOrEqual(ev.steps[i - 1].settledMs);
    expect(ev.steps[0].startMs).toBeGreaterThanOrEqual(800);
    expect(ev.video.durationMs).toBeGreaterThanOrEqual(ev.steps.at(-1)!.settledMs + 800);

    // click, type, select, click, click → 5 clicks; hover adds a move but no click
    expect(ev.clicks).toHaveLength(5);
    expect(ev.moves.length).toBeGreaterThanOrEqual(6);

    const wait = ev.steps.find((s) => s.do === 'wait')!;
    expect(wait.endMs - wait.startMs).toBeGreaterThan(800);
    expect(ev.idle.some((i) => i.startMs === wait.startMs && i.endMs === wait.endMs)).toBe(true);

    // below-the-fold target was scrolled into view before measuring
    const exp = ev.steps.find((s) => s.sceneId === 'export' && s.do === 'click')!;
    expect(exp.target!.y).toBeGreaterThanOrEqual(0);
    expect(exp.target!.y + exp.target!.height).toBeLessThanOrEqual(800);

    const saved = JSON.parse(await readFile(paths.events, 'utf8'));
    expect(saved).toEqual(ev);
  });

  it('aborts with a check hint when a step fails', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes[1].steps[0] = { do: 'click', target: '#missing' };
    });
    await expect(record(loaded)).rejects.toThrow(/showtime check/);
    expect(existsSync(path.join(workPaths(loaded).take, 'failure.png'))).toBe(true);
  });
});
