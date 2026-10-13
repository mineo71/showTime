import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from './paths';
import { actionHash } from './script/hash';
import type { LoadedScript } from './script/load';
import type { TakeEvents } from './timeline/types';

export async function loadTake(loaded: LoadedScript): Promise<TakeEvents> {
  const paths = workPaths(loaded);
  let text: string;
  try {
    text = await readFile(paths.events, 'utf8');
  } catch {
    throw new Error(`No take found for "${loaded.name}". Run: showtime record ${loaded.scriptPath}`);
  }
  const events = JSON.parse(text) as TakeEvents;
  if (events.actionHash !== actionHash(loaded.script)) {
    throw new Error(`Actions changed since the take (presentation-only edits are fine). Run: showtime record ${loaded.scriptPath}`);
  }
  const video = path.join(paths.take, events.video.file);
  if (!existsSync(video)) throw new Error(`${video} is missing. Run: showtime record ${loaded.scriptPath}`);
  return events;
}
