import { insertHolds, sourceToOutput, type Hold } from './timemap';
import type { Click, Cue, Segment, Sound } from './types';

export type { Cue, Sound };

/** Silence after a line before the next narrated step starts. */
export const NARRATION_GAP_MS = 400;
/** Two subtitle lines of 42 characters. */
export const CUE_MAX_CHARS = 84;
const LINE_CHARS = 42;
/** Keystroke sounds closer than this (output time) are dropped, so sped-up typing doesn't buzz. */
export const KEY_MIN_GAP_MS = 40;

/** `scene#n`, 1-based: how lint, errors and the voice cache name a step. */
export const stepKey = (sceneId: string, index: number) => `${sceneId}#${index + 1}`;

export interface Line {
  /** source ms the step starts */
  startMs: number;
  durationMs: number;
}

/**
 * Holds that let every line finish (plus a gap) before the next narrated step starts, or before
 * the video ends. `lines` are in source order; the hold sits just before the window closes.
 */
export function narrationHolds(lines: Line[], segments: Segment[], endMs: number): Hold[] {
  const holds: Hold[] = [];
  lines.forEach((line, i) => {
    const next = lines[i + 1];
    const until = next ? next.startMs : endMs;
    const available = sourceToOutput(segments, until) - sourceToOutput(segments, line.startMs);
    const short = line.durationMs + NARRATION_GAP_MS - available;
    if (short > 0) holds.push({ atMs: next ? Math.max(line.startMs, next.startMs - 1) : endMs, holdMs: Math.round(short) });
  });
  return holds;
}

/** Segments with the narration holds in place. */
export const withNarration = (segments: Segment[], lines: Line[], endMs: number) =>
  insertHolds(segments, narrationHolds(lines, segments, endMs));

/** Greedily join pieces with spaces into chunks of at most CUE_MAX_CHARS. */
function pack(pieces: string[]): string[] {
  const out: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (!cur) cur = p;
    else if (cur.length + 1 + p.length <= CUE_MAX_CHARS) cur += ` ${p}`;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** A sentence as cue texts: whole if it fits, else at commas, else between words. */
function sentenceChunks(sentence: string): string[] {
  if (sentence.length <= CUE_MAX_CHARS) return [sentence];
  const out: string[] = [];
  let clauses: string[] = [];
  for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
    if (clause.length <= CUE_MAX_CHARS) {
      clauses.push(clause);
      continue;
    }
    out.push(...pack(clauses), ...pack(clause.split(' ')));
    clauses = [];
  }
  return [...out, ...pack(clauses)];
}

/** Subtitle cues for one line, timed in proportion to their length and back to back. */
export function subtitleCues(text: string, atMs: number, durationMs: number): Cue[] {
  const chunks = text
    .trim()
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .flatMap(sentenceChunks);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let done = 0;
  return chunks.map((chunk) => {
    const startMs = atMs + Math.round((durationMs * done) / total);
    done += chunk.length;
    return { startMs, endMs: atMs + Math.round((durationMs * done) / total), text: chunk };
  });
}

const stamp = (ms: number) => {
  const t = Math.max(0, Math.round(ms));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
};

/** Break a cue over two lines at the space nearest its middle. */
function wrap(text: string): string {
  if (text.length <= LINE_CHARS) return text;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (best < 0 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2))) best = i;
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** SubRip text; `offsetMs` shifts video-relative cues to file time (the intro card). */
export function toSrt(cues: Cue[], offsetMs: number): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.startMs + offsetMs)} --> ${stamp(c.endMs + offsetMs)}\n${wrap(c.text)}\n`).join('\n');
}

export interface Typing {
  startMs: number;
  endMs: number;
  chars: number;
}

/**
 * Click and keystroke sounds in output time. Takes without a keystroke log (before 0.4) spread
 * each `type` step's keys evenly over its typing time.
 */
export function soundEvents(ev: { clicks: Click[]; keys?: number[] }, typing: Typing[], segments: Segment[]): Sound[] {
  const keys =
    ev.keys ?? typing.flatMap((t) => Array.from({ length: t.chars }, (_, i) => t.startMs + ((t.endMs - t.startMs) * (i + 0.5)) / t.chars));
  const out: Sound[] = ev.clicks.map((c) => ({ kind: 'click', atMs: sourceToOutput(segments, c.tMs) }));
  let last = -Infinity;
  for (const k of [...keys].sort((a, b) => a - b)) {
    const atMs = sourceToOutput(segments, k);
    if (atMs - last < KEY_MIN_GAP_MS) continue;
    out.push({ kind: 'key', atMs });
    last = atMs;
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}
