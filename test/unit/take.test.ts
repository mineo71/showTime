import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workPaths } from '../../src/paths';
import { actionHash } from '../../src/script/hash';
import { loadScript } from '../../src/script/load';
import { loadTake } from '../../src/take';
import type { TakeEvents } from '../../src/timeline/types';

describe('loadTake', () => {
  it('explains each way a take can be unusable, then loads it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-take-'));
    const file = path.join(dir, 'demo.json');
    await writeFile(file, JSON.stringify({ version: 1, app: { url: 'http://x' }, scenes: [{ id: 'a', steps: [{ do: 'click', target: '#a' }] }] }));
    const loaded = await loadScript(file);
    const paths = workPaths(loaded);

    await expect(loadTake(loaded)).rejects.toThrow(/No take found.*showtime record/s);

    const ev: TakeEvents = {
      version: 1,
      actionHash: 'stale',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      video: { file: 'raw.mp4', width: 2880, height: 1800, fps: 30, durationMs: 1000 },
      steps: [],
      moves: [],
      clicks: [],
      idle: [],
    };
    await mkdir(paths.take, { recursive: true });
    await writeFile(paths.events, JSON.stringify(ev));
    await expect(loadTake(loaded)).rejects.toThrow(/Actions changed since the take.*showtime record/s);

    ev.actionHash = actionHash(loaded.script);
    await writeFile(paths.events, JSON.stringify(ev));
    await expect(loadTake(loaded)).rejects.toThrow(/raw\.mp4 is missing/);

    await writeFile(paths.raw, '');
    await expect(loadTake(loaded)).resolves.toEqual(ev);
  });
});
