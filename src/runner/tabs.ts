import type { BrowserContext, Page } from 'playwright';

const LOAD_MS = 15_000;

/**
 * The pages a run acts in, newest on top: a step that opens a tab or popup is followed into it, and
 * when that page closes (by itself, or with closeTab) the one before it comes back.
 */
export class Tabs {
  private readonly stack: Page[];
  private fresh: Page[] = [];

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
    for (const page of opened) if (!page.isClosed() && !this.stack.includes(page)) this.stack.push(page);
    for (let i = this.stack.length - 1; i > 0; i--) if (this.stack[i].isClosed()) this.stack.splice(i, 1);
    const now = this.active;
    if (now === before) return null;
    if (opened.includes(now)) await now.waitForLoadState('load', { timeout: LOAD_MS }).catch(() => undefined);
    await now.bringToFront().catch(() => undefined);
    return now;
  }

  /** Close the active page and return to the one before it. */
  async close(): Promise<Page> {
    if (this.stack.length < 2) throw new Error('no other tab to go back to: closeTab closes a tab or popup that a step opened');
    await this.active.close();
    return (await this.settle()) ?? this.active;
  }
}
