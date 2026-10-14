import type { Script, Step } from './script/schema';
import { stepKey } from './timeline/narration';
import { readingMs, words } from './timeline/reading';
import { outputDurationMs, sourceToOutput } from './timeline/timemap';
import type { StepEvent, Timeline } from './timeline/types';

export interface Issue {
  rule:
    | 'caption-length'
    | 'pause-for-loading'
    | 'show-ignored'
    | 'no-intro'
    | 'caption-too-short'
    | 'video-length'
    | 'narration-stretch';
  level: 'warn' | 'info';
  /** `scene#step` (1-based), `setup#n`, or `script` */
  where: string;
  message: string;
}

const MAX_CAPTION_WORDS = 6;
const LOADING_PAUSE_MS = 1500;
/** Holding the frame this long for a voice is worth a note; twice as long, a warning. */
const STRETCH_INFO_MS = 1500;
const STRETCH_WARN_MS = 3000;
const ACTIONS = new Set<Step['do']>(['click', 'dblclick', 'drag', 'upload', 'press', 'type', 'select']);
const TARGETED = new Set<Step['do']>(['click', 'dblclick', 'drag', 'upload', 'type', 'hover', 'select']);

const hasTarget = (s: Step) => TARGETED.has(s.do) || (s.do === 'scroll' && s.target !== undefined);
export { readingMs };

/** Checks that need only the script. */
export function lintScript(script: Script): Issue[] {
  const issues: Issue[] = [];
  if (!script.meta.title) {
    issues.push({ rule: 'no-intro', level: 'info', where: 'script', message: 'No meta.title, so the video starts without an intro card.' });
  }
  script.setup.forEach((step, i) => {
    if (step.show) {
      issues.push({
        rule: 'show-ignored',
        level: 'warn',
        where: `setup#${i + 1}`,
        message: 'Setup steps run before the camera starts, so their `show` does nothing.',
      });
    }
  });
  for (const scene of script.scenes) {
    scene.steps.forEach((step, i) => {
      const where = `${scene.id}#${i + 1}`;
      const caption = step.show?.caption;
      if (caption && words(caption) > MAX_CAPTION_WORDS) {
        issues.push({
          rule: 'caption-length',
          level: 'warn',
          where,
          message: `Caption has ${words(caption)} words; keep it to ${MAX_CAPTION_WORDS} or fewer: "${caption}"`,
        });
      }
      const zooms = typeof step.show?.zoom === 'number';
      if ((zooms || step.show?.spotlight) && !hasTarget(step)) {
        issues.push({
          rule: 'show-ignored',
          level: 'warn',
          where,
          message: `\`${step.do}\` has no target, so ${zooms ? 'zoom' : 'spotlight'} does nothing here.`,
        });
      }
      const prev = scene.steps[i - 1];
      if (step.do === 'pause' && step.ms >= LOADING_PAUSE_MS && prev && ACTIONS.has(prev.do)) {
        issues.push({
          rule: 'pause-for-loading',
          level: 'warn',
          where,
          message: 'A long pause right after an action usually waits for loading. Use { "do": "wait", "for": "<what appears>" } so it is sped up.',
        });
      }
    });
  }
  return issues;
}

/** Checks on the edited result: caption reading time and overall length (output time). */
export function lintTiming(timeline: Timeline, steps: StepEvent[]): Issue[] {
  const issues: Issue[] = [];
  for (const c of timeline.captions) {
    const shown = sourceToOutput(timeline.segments, c.endMs) - sourceToOutput(timeline.segments, c.startMs);
    const need = readingMs(c.text);
    if (shown < need) {
      const step = steps.find((s) => s.startMs === c.startMs);
      issues.push({
        rule: 'caption-too-short',
        level: 'warn',
        where: step ? `${step.sceneId}#${step.index + 1}` : 'script',
        // Round shown down and needed up, so the numbers never read as equal.
        message: `"${c.text}" is on screen for ${(Math.floor(shown / 100) / 10).toFixed(1)} s but needs about ${(Math.ceil(need / 100) / 10).toFixed(1)} s to read. Add show.hold or slow the step down.`,
      });
    }
  }
  // Each line's holds sit between its step's start and the next narrated step's start.
  const starts = timeline.narration.map((n) => steps.find((s) => stepKey(s.sceneId, s.index) === n.where)?.startMs ?? Infinity);
  timeline.narration.forEach((n, i) => {
    const until = starts[i + 1] ?? Infinity;
    const held = timeline.segments
      .filter((s) => s.speed === 0 && s.srcStartMs >= starts[i] && s.srcStartMs < until)
      .reduce((ms, s) => ms + (s.holdMs ?? 0), 0);
    if (held > STRETCH_INFO_MS) {
      issues.push({
        rule: 'narration-stretch',
        level: held > STRETCH_WARN_MS ? 'warn' : 'info',
        where: n.where,
        message: `"${n.text}" holds the frame for ${(held / 1000).toFixed(1)} s while the voice finishes. Shorten the line or slow the steps.`,
      });
    }
  });
  const totalMs = (timeline.intro?.durationMs ?? 0) + outputDurationMs(timeline.segments) + (timeline.outro?.durationMs ?? 0);
  if (totalMs > 60_000) {
    issues.push({
      rule: 'video-length',
      level: totalMs > 120_000 ? 'warn' : 'info',
      where: 'script',
      message: `The video runs ${Math.round(totalMs / 1000)} s; pitch demos land best under a minute.`,
    });
  }
  return issues;
}
