import type { Step, Style } from '../script/schema';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CursorKind = 'arrow' | 'pointer' | 'text';

export interface Move {
  startMs: number;
  endMs: number;
  from: Pt;
  to: Pt;
  cursor: CursorKind;
}

export interface Click {
  tMs: number;
  x: number;
  y: number;
}

export interface Interval {
  startMs: number;
  endMs: number;
}

export interface StepEvent {
  sceneId: string;
  index: number;
  do: Step['do'];
  /** step begins (before scroll / cursor travel) */
  startMs: number;
  /** cursor arrived, action performed */
  actionMs: number;
  /** action finished (excludes settle / hold) */
  endMs: number;
  /** after settle + beat + hold */
  settledMs: number;
  /** CSS px, viewport-relative, measured after scrolling */
  target?: Rect;
}

/** Written by `record` to take/events.json. All times: ms since capture start. */
export interface TakeEvents {
  version: 1;
  actionHash: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  video: { file: string; width: number; height: number; fps: number; durationMs: number };
  steps: StepEvent[];
  moves: Move[];
  clicks: Click[];
  idle: Interval[];
}

export interface Segment {
  srcStartMs: number;
  srcEndMs: number;
  speed: number;
}

export interface CameraKey {
  tMs: number;
  scale: number;
  /** focus, 0..1 of stage width */
  cx: number;
  /** focus, 0..1 of stage height */
  cy: number;
}

export interface Caption {
  startMs: number;
  endMs: number;
  text: string;
  /** Bottom unless the step's target would sit under a bottom caption. */
  position: 'bottom' | 'top';
}

export interface Spotlight {
  startMs: number;
  endMs: number;
  rect: Rect;
}

export type ResolvedStyle = Style;

/** The renderer contract. All overlay times are source ms. */
export interface Timeline {
  version: 1;
  fps: number;
  output: { width: number; height: number };
  stage: { width: number; height: number };
  video: { src: string; durationMs: number };
  intro: { title: string; subtitle?: string; durationMs: number } | null;
  /** Browser window around the take, or null for the bare viewport. */
  chrome: { address: string; dark: boolean } | null;
  /** Closing card after the video. */
  outro: { title: string; subtitle?: string; url?: string; durationMs: number } | null;
  /** Logo for the intro and outro cards, as a data URI. */
  logo: string | null;
  segments: Segment[];
  camera: CameraKey[];
  moves: Move[];
  clicks: Click[];
  captions: Caption[];
  spotlights: Spotlight[];
  style: ResolvedStyle;
}
