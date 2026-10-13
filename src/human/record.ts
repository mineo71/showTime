import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { formatScript } from '../studio/edit';
import { toSteps, toTarget, type HumanStep, type RecordedAction } from './convert';

export const SCHEMA_URL = 'https://raw.githubusercontent.com/mineo71/showTime/main/docs/script.schema.json';

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
  const actions: RecordedAction[] = [];
  const pageNotes: string[] = [];
  let title = '';
  try {
    const context = (await browser.newContext({ viewport })) as Recordable;
    if (typeof context._startRecording !== 'function') {
      throw new Error('This Playwright version has no programmatic recorder. Install the Playwright version showTime ships with.');
    }
    const page = await context.newPage();
    await page.goto(url);
    title = await page.title();
    const say = (a: RecordedAction) => opts.log?.(`● ${a.name}${a.selector ? ` ${toTarget(a.selector)}` : ''}${a.text ? ` "${a.text}"` : ''}`);
    // showTime films one page: actions in popups and new tabs are left out, with a note.
    const otherPage = () => {
      if (!pageNotes.length) pageNotes.push('actions in a popup or new tab were skipped; showTime records one page');
    };
    await context._startRecording(
      { language: 'jsonl' },
      {
        actionAdded: (from, action) => {
          if (from !== page) return otherPage();
          actions.push(action);
          say(action);
        },
        // Typing into a field arrives as one fill, updated keystroke by keystroke.
        actionUpdated: (from, action) => {
          if (from === page && actions.length) actions[actions.length - 1] = action;
        },
        signalAdded: (_from, signal) => {
          if ((signal as { name?: string }).name === 'popup') otherPage();
        },
      },
    );
    await orInterrupt(opts.drive ? opts.drive(page) : untilClosed(context));
    await context._stopRecording?.().catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
  }

  const converted = toSteps(actions, url);
  const steps = converted.steps;
  const notes = [...converted.notes, ...pageNotes];
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
