import { describe, expect, it } from 'vitest';
import { lintScript, lintTiming } from '../../src/lint';
import { parseScript } from '../../src/script/schema';
import type { Caption, Segment, StepEvent, Timeline } from '../../src/timeline/types';

const script = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  parseScript({ version: 1, meta: { title: 'T' }, app: { url: 'http://x' }, scenes: [{ id: 's', steps }], ...extra });

const rules = (issues: { rule: string; where: string; level: string }[]) => issues.map((i) => `${i.level} ${i.rule} ${i.where}`);

describe('lintScript', () => {
  it('finds nothing wrong with a tidy script', () => {
    expect(lintScript(script([{ do: 'click', target: '#a', show: { caption: 'Paid in two clicks', spotlight: true } }]))).toEqual([]);
  });

  it('flags captions longer than six words', () => {
    const issues = lintScript(script([{ do: 'click', target: '#a', show: { caption: 'Click here to create a brand new report' } }]));
    expect(rules(issues)).toEqual(['warn caption-length s#1']);
    expect(issues[0].message).toMatch(/8 words/);
  });

  it('flags a long pause right after an action', () => {
    expect(rules(lintScript(script([{ do: 'click', target: '#a' }, { do: 'pause', ms: 2000 }])))).toEqual(['warn pause-for-loading s#2']);
    expect(lintScript(script([{ do: 'click', target: '#a' }, { do: 'pause', ms: 800 }]))).toEqual([]);
    expect(lintScript(script([{ do: 'pause', ms: 2000 }]))).toEqual([]);
  });

  it('flags zoom and spotlight on steps without a target, and show on setup steps', () => {
    const issues = lintScript(
      script(
        [
          { do: 'press', key: 'Enter', show: { spotlight: true } },
          { do: 'scroll', by: 400, show: { zoom: 2 } },
          { do: 'scroll', target: '#a', show: { spotlight: true } },
          { do: 'wait', ms: 100, show: { zoom: false } },
        ],
        { setup: [{ do: 'click', target: '#cookies', show: { caption: 'Hi' } }] },
      ),
    );
    expect(rules(issues)).toEqual(['warn show-ignored setup#1', 'warn show-ignored s#1', 'warn show-ignored s#2']);
  });

  it('notes a missing intro', () => {
    expect(rules(lintScript(script([{ do: 'click', target: '#a' }], { meta: {} })))).toEqual(['info no-intro script']);
  });
});

describe('lintTiming', () => {
  const step: StepEvent = { sceneId: 's', index: 0, do: 'click', startMs: 1000, actionMs: 1200, endMs: 1300, settledMs: 1800 };
  const timeline = (captions: Caption[], segments: Segment[]) =>
    ({ captions, segments, intro: null, outro: null, fps: 30 }) as unknown as Timeline;
  const cap = (startMs: number, endMs: number): Caption => ({ startMs, endMs, text: 'Paid in two clicks', position: 'bottom' });

  it('flags captions on screen too briefly to read, in output time', () => {
    const at1x = [{ srcStartMs: 0, srcEndMs: 10_000, speed: 1 }];
    expect(rules(lintTiming(timeline([cap(1000, 2000)], at1x), [step]))).toEqual(['warn caption-too-short s#1']);
    expect(lintTiming(timeline([cap(1000, 3000)], at1x), [step])).toEqual([]);
    const fast = [{ srcStartMs: 0, srcEndMs: 10_000, speed: 4 }];
    expect(rules(lintTiming(timeline([cap(1000, 5000)], fast), [step]))).toEqual(['warn caption-too-short s#1']);
  });

  it('notes a long video and warns about a very long one', () => {
    const len = (ms: number) => timeline([], [{ srcStartMs: 0, srcEndMs: ms, speed: 1 }]);
    expect(lintTiming(len(30_000), [])).toEqual([]);
    expect(rules(lintTiming(len(70_000), []))).toEqual(['info video-length script']);
    expect(rules(lintTiming(len(130_000), []))).toEqual(['warn video-length script']);
  });
});
