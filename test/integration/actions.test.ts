import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSession, prepare } from '../../src/runner/browser';
import { check } from '../../src/runner/check';
import { record } from '../../src/runner/record';
import { EventLog } from '../../src/runner/events';
import { runStep, type StepContext } from '../../src/runner/steps';
import { loadScript } from '../../src/script/load';
import { parseScript, type Step } from '../../src/script/schema';
import { isPink, pixelAt } from '../helpers/pixel';
import { FIXTURES, serveDir, type Served } from '../helpers/serve';

const APP = path.join(FIXTURES, 'actions-app');
let server: Served;
beforeAll(async () => {
  server = await serveDir(APP);
});
afterAll(() => server.close());

/** Rehearse `steps` on the actions page; the script sits in the fixture folder, so `files/…` resolve. */
async function rehearse(steps: object[]) {
  return check(await actionsScript(steps));
}

async function actionsScript(steps: object[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'showtime-actions-'));
  const file = path.join(dir, 'actions.json');
  const raw = {
    version: 1,
    app: { url: server.url, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    scenes: [{ id: 'a', steps }],
  };
  await writeFile(file, JSON.stringify(raw));
  const loaded = await loadScript(file);
  loaded.dir = APP;
  return loaded;
}

/** Run steps in record mode and return the event log. */
async function recordSteps(steps: Step[]) {
  const script = parseScript({
    version: 1,
    app: { url: server.url, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    scenes: [{ id: 'a', steps: [{ do: 'pause', ms: 0 }] }],
  });
  const session = await openSession(script);
  try {
    const cursor = await prepare(session, script);
    const log = new EventLog();
    const ctx: StepContext = { page: session.page, mode: 'record', log, net: session.net, cursor, dir: APP };
    for (const [index, step] of steps.entries()) await runStep(ctx, step, { sceneId: 'a', index });
    return { log, page: session.page, close: () => session.close() };
  } catch (err) {
    await session.close();
    throw err;
  }
}

describe('new actions (check)', () => {
  it('double clicks, right clicks and Shift-clicks', async () => {
    const report = await rehearse([
      { do: 'dblclick', target: '#dbl' },
      { do: 'wait', for: '#dbl:has-text("double")', timeoutMs: 2000 },
      { do: 'click', target: 'text=Row 1' },
      { do: 'click', target: 'text=Row 3', modifiers: ['Shift'] },
      { do: 'wait', for: '#rows li.selected >> nth=2', timeoutMs: 2000 },
      { do: 'click', target: 'text=Row 4', button: 'right' },
      { do: 'wait', for: '#menu', timeoutMs: 2000 },
    ]);
    expect(report.ok, report.failure?.error).toBe(true);
  });

  it('drags a card onto a column and a slider thumb by an offset', async () => {
    const report = await rehearse([
      { do: 'drag', target: '#card', to: '#done' },
      { do: 'wait', for: '#done-count:has-text("done: 1")', timeoutMs: 2000 },
      { do: 'drag', target: '#thumb', by: { x: 120, y: 0 } },
      { do: 'wait', for: '#value:has-text("value: 120")', timeoutMs: 2000 },
    ]);
    expect(report.ok, report.failure?.error).toBe(true);
  });

  it('refuses a drag whose end is off screen', async () => {
    const report = await rehearse([{ do: 'drag', target: '#card', to: '#far' }]);
    expect(report.ok).toBe(false);
    expect(report.failure?.error).toMatch(/#far is off screen/);
  });

  it('uploads through the button a person clicks, and straight into a hidden input', async () => {
    const report = await rehearse([
      { do: 'upload', target: '#pick', files: ['files/note.txt', 'files/other.txt'] },
      { do: 'wait', for: '#files:has-text("note.txt, other.txt")', timeoutMs: 2000 },
      { do: 'upload', target: '#hidden-input', files: ['files/other.txt'] },
      { do: 'wait', for: '#files:has-text("other.txt")', timeoutMs: 2000 },
    ]);
    expect(report.ok, report.failure?.error).toBe(true);
  });

  it('names a missing upload file, and a target that opens no file chooser', async () => {
    const missing = await rehearse([{ do: 'upload', target: '#pick', files: ['files/nope.txt'] }]);
    expect(missing.failure?.error).toMatch(/nope\.txt/);
    const started = Date.now();
    const nothing = await rehearse([{ do: 'upload', target: '#nothing', files: ['files/note.txt'] }]);
    expect(nothing.failure?.error).toMatch(/opened no file chooser/);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('presses a shortcut', async () => {
    const report = await rehearse([
      { do: 'press', key: 'ControlOrMeta+k' },
      { do: 'wait', for: '#palette', timeoutMs: 2000 },
    ]);
    expect(report.ok, report.failure?.error).toBe(true);
  });
});

describe('new actions (record)', () => {
  it('logs two clicks for a double click, a press and a drag spanning both ends', async () => {
    const run = await recordSteps([
      { do: 'dblclick', target: '#dbl' },
      { do: 'press', key: 'Escape' },
      { do: 'drag', target: '#card', to: '#done' },
    ] as Step[]);
    try {
      const { log } = run;
      const [dbl, press, drag] = log.steps;
      expect(log.clicks.filter((c) => c.tMs >= dbl.startMs && c.tMs <= dbl.settledMs)).toHaveLength(2);
      expect(log.keys.some((k) => k >= press.startMs && k <= press.settledMs)).toBe(true);
      expect(log.drags).toHaveLength(1);
      expect(log.drags[0].startMs).toBeGreaterThanOrEqual(drag.actionMs);
      expect(log.drags[0].endMs).toBeLessThanOrEqual(drag.endMs);
      const card = (await run.page.locator('#done').boundingBox())!;
      // The step's target covers the card where it started and the column it was dropped on.
      expect(drag.target!.y + drag.target!.height).toBeGreaterThanOrEqual(card.y + card.height - 1);
      expect(await run.page.locator('#done-count').textContent()).toBe('done: 1');
    } finally {
      await run.close();
    }
  });
});

describe('tabs and popups', () => {
  it('follows a popup, acts in it, and comes back when closeTab closes it', async () => {
    const report = await rehearse([
      { do: 'click', target: '#open-popup' },
      { do: 'click', target: '#in-popup' },
      { do: 'wait', for: '#popup-out:has-text("clicked")', timeoutMs: 2000 },
      { do: 'closeTab' },
      { do: 'click', target: 'text=Row 1' },
      { do: 'wait', for: '#rows li.selected', timeoutMs: 2000 },
    ]);
    expect(report.ok, report.failure?.error).toBe(true);
    // Screenshots come from the page the step acted in.
    expect(isPink(await pixelAt(report.steps[1].screenshot!, 5, 5))).toBe(true);
    expect(isPink(await pixelAt(report.steps[4].screenshot!, 5, 5))).toBe(false);
  });

  it('follows a link that opens a new tab', async () => {
    const report = await rehearse([
      { do: 'click', target: '#new-tab' },
      { do: 'wait', for: '#tab-title', timeoutMs: 2000 },
      { do: 'closeTab' },
      { do: 'click', target: 'text=Row 2' },
    ]);
    expect(report.ok, report.failure?.error).toBe(true);
  });

  it('comes back by itself when a popup closes itself, as OAuth consent screens do', async () => {
    const report = await rehearse([
      { do: 'click', target: '#oauth' },
      { do: 'click', target: '#allow' },
      { do: 'wait', for: '#status:has-text("allowed")', timeoutMs: 3000 },
    ]);
    expect(report.ok, report.failure?.error).toBe(true);
  });

  it('refuses closeTab when only one page is open', async () => {
    const report = await rehearse([{ do: 'closeTab' }]);
    expect(report.failure?.error).toMatch(/no other tab/);
  });

  it('films the popup: its frames reach the take', async () => {
    const loaded = await actionsScript([
      { do: 'click', target: '#open-popup' },
      { do: 'hover', target: '#in-popup' },
      { do: 'closeTab' },
      { do: 'hover', target: 'text=Row 1' },
    ]);
    const ev = await record(loaded);
    const raw = path.join(loaded.dir, '.showtime', loaded.name, 'take', 'raw.mp4');
    const inPopup = ev.steps[1];
    expect(isPink(await pixelAt(raw, 5, 5, (inPopup.actionMs + inPopup.settledMs) / 2))).toBe(true);
    const back = ev.steps[3];
    expect(isPink(await pixelAt(raw, 5, 5, (back.actionMs + back.settledMs) / 2))).toBe(false);
  }, 120_000);
});
