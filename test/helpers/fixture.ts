import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadScript, type LoadedScript } from '../../src/script/load';
import { FIXTURES } from './serve';

/** Copy fixtures/demo.json into a fresh temp dir, pointed at a live server. */
export async function fixtureScript(url: string, mutate?: (raw: any) => void): Promise<LoadedScript> {
  const raw = JSON.parse(await readFile(path.join(FIXTURES, 'demo.json'), 'utf8'));
  raw.app.url = url;
  mutate?.(raw);
  const dir = await mkdtemp(path.join(tmpdir(), 'showtime-'));
  const file = path.join(dir, 'demo.json');
  await writeFile(file, JSON.stringify(raw, null, 2));
  return loadScript(file);
}
