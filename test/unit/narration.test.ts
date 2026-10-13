import { describe, expect, it } from 'vitest';
import { NARRATION_GAP_MS, narrationHolds, soundEvents, stepKey, stillPoint, subtitleCues, toSrt } from '../../src/timeline/narration';
import { buildSegments } from '../../src/timeline/timemap';

describe('narrationHolds', () => {
  const segs = buildSegments(10_000, [{ startMs: 2000, endMs: 4000, speed: 4 }]);

  it('holds the difference plus a gap just before the next narrated step', () => {
    // Window 1000 → 5000 is 1000 + 500 + 1000 = 2500 ms of output; the line needs 3000 + gap.
    const holds = narrationHolds(
      [
        { startMs: 1000, durationMs: 3000 },
        { startMs: 5000, durationMs: 500 },
      ],
      segs,
      10_000,
    );
    expect(holds).toEqual([{ atMs: 4999, holdMs: 3000 + NARRATION_GAP_MS - 2500 }]);
  });

  it('adds nothing when the line fits its window', () => {
    expect(narrationHolds([{ startMs: 5000, durationMs: 2000 }], segs, 10_000)).toEqual([]);
  });

  it('runs the last window to the end of the video', () => {
    expect(narrationHolds([{ startMs: 9000, durationMs: 1500 }], segs, 10_000)).toEqual([{ atMs: 10_000, holdMs: 1500 + NARRATION_GAP_MS - 1000 }]);
  });

  it('moves the hold back to the last moment nothing is moving', () => {
    const lines = [
      { startMs: 1000, durationMs: 3000 },
      { startMs: 5000, durationMs: 500 },
    ];
    const holds = narrationHolds(lines, segs, 10_000, [
      { startMs: 4300, endMs: 5600 },
      { startMs: 3900, endMs: 4400 },
    ]);
    expect(holds).toEqual([{ atMs: 3900, holdMs: 3000 + NARRATION_GAP_MS - 2500 }]);
  });

  it('finds the latest still point in a window, or the window end when everything moves', () => {
    expect(stillPoint(1000, 4999, [])).toBe(4999);
    expect(stillPoint(1000, 4999, [{ startMs: 4000, endMs: 6000 }])).toBe(4000);
    expect(stillPoint(1000, 4999, [{ startMs: 4000, endMs: 4999 }])).toBe(4999); // a move that just ended
    expect(stillPoint(1000, 4999, [{ startMs: 500, endMs: 6000 }])).toBe(4999);
  });

  it('names steps scene#n, 1-based', () => {
    expect(stepKey('intro', 0)).toBe('intro#1');
  });
});

describe('subtitleCues', () => {
  it('keeps a short line as one cue over the whole line', () => {
    expect(subtitleCues('Create an invoice in seconds.', 1000, 2000)).toEqual([{ startMs: 1000, endMs: 3000, text: 'Create an invoice in seconds.' }]);
  });

  it('splits at sentence ends first, then commas, then words, with contiguous proportional times', () => {
    const text =
      'Fennel keeps every client in one place. Pick a client, add the line items you billed for this month, and send the invoice before lunch. Then watch the dashboard update itself in real time while your clients pay their invoices online without calling you.';
    const cues = subtitleCues(text, 0, 10_000);
    expect(cues.map((c) => c.text)).toEqual([
      'Fennel keeps every client in one place.',
      'Pick a client, add the line items you billed for this month,',
      'and send the invoice before lunch.',
      'Then watch the dashboard update itself in real time while your clients pay their',
      'invoices online without calling you.',
    ]);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(84);
    expect(cues[0].startMs).toBe(0);
    expect(cues.at(-1)!.endMs).toBe(10_000);
    cues.slice(1).forEach((c, i) => expect(c.startMs).toBe(cues[i].endMs));
    const share = (cues[0].endMs - cues[0].startMs) / 10_000;
    expect(share).toBeCloseTo(cues[0].text.length / cues.reduce((n, c) => n + c.text.length, 0), 2);
  });
});

describe('subtitleCues: short sentences', () => {
  it('packs short sentences together instead of flashing them', () => {
    expect(subtitleCues('OK. Now we send the invoice to the client.', 0, 3000).map((c) => c.text)).toEqual([
      'OK. Now we send the invoice to the client.',
    ]);
  });
});

describe('toSrt', () => {
  it('numbers cues, offsets them and wraps long ones on two lines', () => {
    const srt = toSrt(
      [
        { startMs: 0, endMs: 1250, text: 'Hi.' },
        { startMs: 1250, endMs: 61_000, text: 'Pick a client, add the line items you billed for this month,' },
      ],
      2200,
    );
    expect(srt).toBe(
      '1\n00:00:02,200 --> 00:00:03,450\nHi.\n\n' +
        '2\n00:00:03,450 --> 00:01:03,200\nPick a client, add the line\nitems you billed for this month,\n',
    );
  });
});

describe('soundEvents', () => {
  const segs = buildSegments(10_000, [{ startMs: 5000, endMs: 9000, speed: 4 }]);

  it('places a click per click and a key per logged keystroke, in output time', () => {
    const s = soundEvents({ clicks: [{ tMs: 1000, x: 0, y: 0 }, { tMs: 6000, x: 0, y: 0 }], keys: [2000, 2100] }, [], segs);
    expect(s).toEqual([
      { kind: 'click', atMs: 1000 },
      { kind: 'key', atMs: 2000 },
      { kind: 'key', atMs: 2100 },
      { kind: 'click', atMs: 5250 },
    ]);
  });

  it('spreads keys evenly over type steps when the take has no keystroke log', () => {
    const s = soundEvents({ clicks: [] }, [{ startMs: 1000, endMs: 1400, chars: 4 }], segs);
    expect(s).toEqual([1050, 1150, 1250, 1350].map((atMs) => ({ kind: 'key', atMs })));
  });

  it('drops keys closer than 40 ms apart in output time', () => {
    const s = soundEvents({ clicks: [], keys: [6000, 6100, 6200, 6300] }, [], segs);
    expect(s.map((e) => e.atMs)).toEqual([5250, 5300]);
  });
});
