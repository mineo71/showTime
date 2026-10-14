// What a drag on the timeline means for the script: pure, so the page and the tests share it.

export interface StepSpan {
  /** source ms the step's speed applies to (start to settled) */
  srcMs: number;
  /** output ms of holds inside it (narration, freezes): they keep their length */
  holdMs: number;
  /** frames from the step's start to its settled end, as shown now */
  stepFrames: number;
  /** frames of its block on the timeline (to the next step's start) */
  blockFrames: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The `show.speed` that makes a step's block `frames` long (0.25–16×). */
export function speedFor(step: StepSpan, frames: number, fps: number): number {
  const tail = step.blockFrames - step.stepFrames;
  const outMs = ((frames - tail) * 1000) / fps - step.holdMs;
  if (outMs <= 0) return 16;
  return Math.min(16, Math.max(0.25, round2(step.srcMs / outMs)));
}

/** The `show.captionMs` of a caption bar `frames` long (200 ms to a minute). */
export const captionMsFor = (frames: number, fps: number): number => Math.min(60_000, Math.max(200, Math.round((frames * 1000) / fps)));
