import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logoDataUri } from './logo';
import { workPaths } from './paths';
import { renderStills, renderVideo } from './render/render';
import type { LoadedScript } from './script/load';
import { loadTake } from './take';
import { buildTimeline } from './timeline/build';
import { qaShots } from './timeline/frames';
import type { TakeEvents, Timeline } from './timeline/types';

export async function timelineFor(loaded: LoadedScript): Promise<{ timeline: Timeline; events: TakeEvents }> {
  const events = await loadTake(loaded);
  const { logo } = loaded.script.meta;
  const timeline = buildTimeline(loaded.script, events, { logo: logo ? await logoDataUri(logo) : undefined });
  const paths = workPaths(loaded);
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.timeline, JSON.stringify(timeline, null, 2));
  return { timeline, events };
}

export async function renderDemo(
  loaded: LoadedScript,
  opts: { out?: string; onProgress?: (progress: number) => void } = {},
): Promise<string> {
  const { timeline } = await timelineFor(loaded);
  const paths = workPaths(loaded);
  const out = path.resolve(opts.out ?? paths.video);
  await mkdir(path.dirname(out), { recursive: true });
  await renderVideo(timeline, paths.take, out, opts.onProgress);
  return out;
}

export async function renderQaFrames(loaded: LoadedScript): Promise<string[]> {
  const { timeline, events } = await timelineFor(loaded);
  const paths = workPaths(loaded);
  await rm(paths.stills, { recursive: true, force: true });
  await mkdir(paths.stills, { recursive: true });
  return renderStills(timeline, paths.take, paths.stills, qaShots(timeline, events.steps));
}
