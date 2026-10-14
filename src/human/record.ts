import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { formatScript } from '../studio/edit';
import { followPages, toSteps, toTarget, type HumanStep, type RecordedAction } from './convert';

export const SCHEMA_URL = 'https://raw.githubusercontent.com/mineo71/showTime/main/docs/script.schema.json';
/** How long a page that closes itself stays open, so its last action is reported. */
const SELF_CLOSE_GRACE_MS = 1000;

export interface RecordHumanOptions {
  /** where the script goes */
  out: string;
  viewport?: { width: number; height: number };
  /** overwrite `out` if it exists */
  force?: boolean;
  /** tests: no window */
  headless?: boolean;
  /** tests: perform the flow, then the recording ends (instead of waiting for the window to close) */
  drive?: (page: Page) => Promise<void>;
  log?: (line: string) => void;
}

type Recordable = BrowserContext & {
  _startRecording?: (
    params: { language: string },
    sink: {
      actionAdded: (page: unknown, action: RecordedAction) => void;
      actionUpdated: (page: unknown, action: RecordedAction) => void;
      signalAdded: (page: unknown, signal: unknown) => void;
    },
  ) => Promise<void>;
  _stopRecording?: () => Promise<void>;
};

/** Resolves when every page of the context is closed: the person closed the window. */
function untilClosed(context: BrowserContext): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!context.pages().length) resolve();
    };
    const watch = (page: Page) => page.on('close', check);
    context.pages().forEach(watch);
    context.on('page', watch);
    context.on('close', () => resolve());
  });
}

/** Resolves on Ctrl+C, and stops listening once `work` settles. */
async function orInterrupt(work: Promise<void>): Promise<void> {
  let stop = () => undefined as void;
  const interrupted = new Promise<void>((resolve) => {
    stop = () => {
      process.off('SIGINT', stop);
      resolve();
    };
    process.on('SIGINT', stop);
  });
  try {
    await Promise.race([work, interrupted]);
  } finally {
    process.off('SIGINT', stop);
  }
}

/**
 * Open a browser at `url`, record what the person does with Playwright's recorder, and write a
 * script of those steps when the window closes.
 */
export async function recordHuman(url: string, opts: RecordHumanOptions): Promise<{ file: string; steps: HumanStep[]; notes: string[] }> {
  const file = path.resolve(opts.out);
  if (existsSync(file) && !opts.force) throw new Error(`${file} exists. Pass --force to overwrite it, or -o to write somewhere else.`);
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  // Playwright would close the browser and exit on Ctrl+C itself; showTime handles it, so the script gets written.
  const browser = await chromium.launch({ headless: opts.headless ?? false, handleSIGINT: false });
  const entries: Array<{ page: number; action: RecordedAction; opens?: number; opensGuid?: string }> = [];
  // Pages that closed themselves (an OAuth popup): they will again when the script runs, so no closeTab.
  const selfClosed = new Set<number>();
  let title = '';
  try {
    const context = (await browser.newContext({ viewport })) as Recordable;
    if (typeof context._startRecording !== 'function') {
      throw new Error('This Playwright version has no programmatic recorder. Install the Playwright version showTime ships with.');
    }
    const page = await context.newPage();
    const say = (a: RecordedAction) => opts.log?.(`● ${a.name}${a.selector ? ` ${toTarget(a.selector)}` : ''}${a.text ? ` "${a.text}"` : ''}`);
    // Every page the flow touches, in the order they opened: actions are kept with their page and
    // put in one line once recording ends (the recorder may report a click after the popup it opened).
    const pages: unknown[] = [page];
    const indexOf = (p: unknown) => {
      if (!pages.includes(p)) pages.push(p);
      return pages.indexOf(p);
    };
    context.on('page', (p) => indexOf(p));
    // A page closing itself tells showTime first, and stays open a moment: the recorder reports an
    // action about half a second after it happens, and a closed page's last click would be lost.
    await context.exposeBinding('__showtimeClosing', async (source) => {
      selfClosed.add(indexOf(source.page));
      await new Promise((resolve) => setTimeout(resolve, SELF_CLOSE_GRACE_MS));
    });
    await context.addInitScript({
      content: `(() => {
  const close = window.close.bind(window);
  window.close = () => {
    Promise.resolve(window.__showtimeClosing && window.__showtimeClosing()).catch(() => undefined).finally(() => close());
  };
})();`,
    });
    await page.goto(url);
    title = await page.title();
    await context._startRecording(
      { language: 'jsonl' },
      {
        actionAdded: (from, action) => {
          if (action.name === 'openPage' || action.name === 'closePage') return;
          entries.push({ page: indexOf(from), action });
          say(action);
        },
        // Typing into a field arrives as one fill, updated keystroke by keystroke.
        actionUpdated: (from, action) => {
          const n = indexOf(from);
          for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].page === n) {
              entries[i] = { page: n, action };
              break;
            }
          }
        },
        // The action that opened a page: it gets a closeTab when nothing in that page is used.
        signalAdded: (from, signal) => {
          const s = signal as { name?: string; popupPageGuid?: string };
          if (s.name !== 'popup' || !s.popupPageGuid) return;
          const n = indexOf(from);
          for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].page === n) {
              entries[i].opensGuid = s.popupPageGuid;
              break;
            }
          }
        },
      },
    );
    await orInterrupt(opts.drive ? opts.drive(page) : untilClosed(context));
    await context._stopRecording?.().catch(() => undefined);
    // Signals name pages by Playwright's internal guid.
    const guidOf = (p: unknown) => (p as { _guid?: string })._guid;
    for (const e of entries) {
      const opened = e.opensGuid ? pages.findIndex((p) => guidOf(p) === e.opensGuid) : -1;
      if (opened > 0) e.opens = opened;
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const { steps, notes } = toSteps(followPages(entries, selfClosed), url);
  for (const note of notes) opts.log?.(`⚠ ${note}`);
  if (!steps.length) throw new Error('Nothing was recorded, so no script was written.');
  const script = {
    $schema: SCHEMA_URL,
    version: 1,
    meta: { title: title || 'Demo' },
    app: { url, viewport },
    scenes: [{ id: 'flow', steps }],
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, formatScript(script));
  return { file, steps, notes };
}
