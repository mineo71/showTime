import type { BrowserContext, Page } from 'playwright';
import { sleep } from './time';

const LOAD_MS = 15_000;
/** How long a new page may take to commit a URL before it counts as a download's tab. */
const COMMIT_MS = 1000;

/** A link that downloads a file opens a tab that never commits a URL; a browser closes it by itself. */
async function committed(page: Page): Promise<boolean> {
  for (let waited = 0; page.url() === '' && waited < COMMIT_MS; waited += 100) await sleep(100);
  return page.url() !== '';
}

/**
 * The pages a run acts in, newest on top: a step that opens a tab or popup is followed into it, and
 * when that page closes (by itself, or with closeTab) the one before it comes back.
 */
export class Tabs {
  private readonly stack: Page[];
  private fresh: Page[] = [];
  /** pages that went away by themselves lately: a closeTab meant for one of them has nothing left to do */
  private gone = 0;

  constructor(context: BrowserContext, first: Page) {
    this.stack = [first];
    context.on('page', (page) => this.fresh.push(page));
  }

  get active(): Page {
    return this.stack[this.stack.length - 1];
  }

  /** Follow the pages opened since the last call and drop closed ones; returns the active page when it changed. */
  async settle(): Promise<Page | null> {
    const before = this.active;
    const opened = this.fresh.splice(0);
    for (const page of opened) {
      if (page.isClosed() || this.stack.includes(page)) continue;
      if (!(await committed(page))) {
        await page.close().catch(() => undefined);
        this.gone++;
        continue;
      }
      this.stack.push(page);
      this.gone = 0;
    }
    this.dropClosed();
    if (this.active !== before && opened.includes(this.active)) {
      await this.active.waitForLoadState('load', { timeout: LOAD_MS }).catch(() => undefined);
      // It may have closed while loading.
      this.dropClosed();
    }
    const now = this.active;
    if (now === before) return null;
    await now.bringToFront().catch(() => undefined);
    return now;
  }

  /** Start a new step: a page that went away before it is no longer what a closeTab could mean. */
  forgetGone(): void {
    this.gone = 0;
  }

  /** Close the active page and return to the one before it (nothing to do if it just closed itself). */
  async close(): Promise<Page> {
    await this.settle();
    if (this.gone > 0) {
      this.gone--;
      return this.active;
    }
    if (this.stack.length < 2) throw new Error('no other tab to go back to: closeTab closes a tab or popup that a step opened');
    const page = this.stack.pop()!;
    await page.close();
    await this.active.bringToFront().catch(() => undefined);
    return this.active;
  }

  private dropClosed(): void {
    for (let i = this.stack.length - 1; i > 0; i--) {
      if (this.stack[i].isClosed()) {
        this.stack.splice(i, 1);
        this.gone++;
      }
    }
  }
}
