import path from 'node:path';
import type { LoadedScript } from './script/load';

export interface WorkPaths {
  root: string;
  check: string;
  take: string;
  /** a take being recorded; swapped in for `take` only when it succeeds */
  takeTmp: string;
  rawFrames: string;
  raw: string;
  events: string;
  timeline: string;
  stills: string;
  /** contact sheet of the stills */
  sheet: string;
  video: string;
}

export function workPaths(loaded: LoadedScript): WorkPaths {
  const root = path.join(loaded.dir, '.showtime', loaded.name);
  const take = path.join(root, 'take');
  return {
    root,
    check: path.join(root, 'check'),
    take,
    takeTmp: path.join(root, 'take.tmp'),
    rawFrames: path.join(take, 'frames'),
    raw: path.join(take, 'raw.mp4'),
    events: path.join(take, 'events.json'),
    timeline: path.join(root, 'timeline.json'),
    stills: path.join(root, 'frames'),
    sheet: path.join(root, 'frames', 'sheet.png'),
    video: path.join(loaded.dir, `${loaded.name}.mp4`),
  };
}
