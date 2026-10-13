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

/** Resolves when every page of the context is closed (the person closed the window) or on Ctrl+C. */
function untilClosed(context: BrowserContext): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off('SIGINT', done);
      resolve();
    };
    const check = () => {
      if (!context.pages().length) done();
    };
    const watch = (page: Page) => page.on('close', check);
    context.pages().forEach(watch);
    context.on('page', watch);
    context.on('close', done);
    process.on('SIGINT', done);
  });
}

/**
 * Open a browser at `url`, record what the person does with Playwright's recorder, and write a
 * script of those steps when the window closes.
 */
export async function recordHuman(url: string, opts: RecordHumanOptions): Promise<{ file: string; steps: HumanStep[]; notes: string[] }> {
  const file = path.resolve(opts.out);
  if (existsSync(file) && !opts.force) throw new Error(`${file} exists. Pass --force to overwrite it, or -o to write somewhere else.`);
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  const browser = await chromium.launch({ headless: opts.headless ?? false });
  const actions: RecordedAction[] = [];
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
    await context._startRecording(
      { language: 'jsonl' },
      {
        actionAdded: (_page, action) => {
          actions.push(action);
          say(action);
        },
        // Typing into a field arrives as one fill, updated keystroke by keystroke.
        actionUpdated: (_page, action) => {
          actions[actions.length - 1] = action;
        },
        signalAdded: () => undefined,
      },
    );
    if (opts.drive) await opts.drive(page);
    else await untilClosed(context);
    await context._stopRecording?.().catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
  }

  const { steps, notes } = toSteps(actions, url);
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
