// What a drag on the timeline means for the script: pure, so the page and the tests share it.

export interface StepSpan {
  /** source ms the step's speed applies to (start to settled) */
  srcMs: number;
  /** output ms of the step's freeze: it keeps its length */
  freezeMs: number;
  /** output ms of narration holds inside it: they shrink as the step gets longer, and grow as it gets shorter */
  narrationMs: number;
  /** frames from the step's start to its settled end, as shown now */
  stepFrames: number;
  /** frames of its block on the timeline (to the next step's start) */
  blockFrames: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const tail = (step: StepSpan) => step.blockFrames - step.stepFrames;

/**
 * The `show.speed` that makes a step's block `frames` long (0.25–16×), or null when no speed can: a
 * step held for a narration line is as short as it gets.
 */
export function speedFor(step: StepSpan, frames: number, fps: number): number | null {
  if (step.narrationMs > 0 && frames <= step.blockFrames) return null;
  const outMs = ((frames - tail(step)) * 1000) / fps - step.freezeMs;
  if (outMs <= 0) return 16;
  return Math.min(16, Math.max(0.25, round2(step.srcMs / outMs)));
}

/** The block lengths (frames) a drag can reach: 16× to 0.25×, never shorter than a narration hold allows. */
export function dragRange(step: StepSpan, fps: number): { min: number; max: number } {
  const at = (speed: number) => Math.round(tail(step) + ((step.srcMs / speed + step.freezeMs) * fps) / 1000);
  return { min: step.narrationMs > 0 ? step.blockFrames : Math.max(1, at(16)), max: at(0.25) };
}

/** The `show.captionMs` of a caption bar `frames` long (200 ms to a minute). */
export const captionMsFor = (frames: number, fps: number): number => Math.min(60_000, Math.max(200, Math.round((frames * 1000) / fps)));
