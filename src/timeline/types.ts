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
  /** keystroke times (human-paced typing, presses); missing in takes recorded before 0.4 */
  keys?: number[];
  /** while a drag held the mouse button; missing in takes recorded before 0.9 */
  drags?: Interval[];
}

export interface Segment {
  srcStartMs: number;
  srcEndMs: number;
  /** 0 for a hold: the frame at srcStartMs (= srcEndMs) stays on screen for `holdMs` */
  speed: number;
  holdMs?: number;
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
  /** the step it belongs to (`scene#n`), for the studio */
  where?: string;
}

export interface Spotlight {
  startMs: number;
  endMs: number;
  rect: Rect;
  /** dim: everything else darkens; ring: a ring only; glow: a soft coloured glow */
  kind: 'dim' | 'ring' | 'glow';
  color: string;
}

/** A click as drawn: where, when, which animation and colour (source ms, CSS px). */
export interface ClickFx {
  tMs: number;
  x: number;
  y: number;
  kind: 'ripple' | 'pulse' | 'burst' | 'ring';
  color: string;
}

export interface FontFile {
  family: string;
  /** data URI */
  src: string;
  weight?: number | string;
  style?: 'normal' | 'italic';
}

export interface Watermark {
  text?: string;
  /** data URI */
  image?: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number;
  size: number;
}

/** A subtitle cue, in output ms from the start of the video. */
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Sound {
  kind: 'click' | 'key';
  /** output ms from the start of the video */
  atMs: number;
}

export interface NarrationLine {
  /** `scene#n` */
  where: string;
  text: string;
  /** output ms from the start of the video */
  atMs: number;
  durationMs: number;
}

export type ResolvedStyle = Style;

export type Aspect = '16:9' | '9:16' | '1:1';

/** The renderer contract. Overlay times are source ms; sound and subtitle times are output ms from the video start. */
export interface Timeline {
  version: 1;
  fps: number;
  aspect: Aspect;
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
  /** click animations; `clicks` still drives the cursor press */
  clickFx: ClickFx[];
  /** font files embedded for captions, cards and the watermark */
  fonts: FontFile[];
  watermark: Watermark | null;
  narration: NarrationLine[];
  subtitles: Cue[];
  /** Subtitles drawn on the video. */
  subtitlesBurned: boolean;
  /** Height (px) of the band under the window that burned subtitles sit in; 0 without one (9:16 has bands anyway). */
  subtitleBand: number;
  /** `audio.clips` placed in output ms from the video start; `index` points into the script's list. */
  clips: { index: number; atMs: number; volume: number }[];
  sounds: Sound[];
  music: { volume: number } | null;
  /** The mixed soundtrack, relative to the renderer's public folder; set by the pipeline. */
  audio: { src: string } | null;
  style: ResolvedStyle;
}
