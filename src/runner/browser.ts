import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Script } from '../script/schema';
import type { Pt } from '../timeline/types';
import { EventLog } from './events';
import { runStep, STEP_TIMEOUT_MS, type StepContext } from './steps';
import { sleep } from './time';

export interface NetworkTracker {
  /** Resolve once no request has been in flight for `quietMs` (counted from now), or after `capMs`. */
  idle(quietMs: number, capMs: number): Promise<void>;
}

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  net: NetworkTracker;
  close(): Promise<void>;
}

export function trackNetwork(page: Page): NetworkTracker {
  let inflight = 0;
  let lastChange = Date.now();
  const up = () => {
    inflight++;
    lastChange = Date.now();
  };
  const down = () => {
    inflight = Math.max(0, inflight - 1);
    lastChange = Date.now();
  };
  page.on('request', up);
  page.on('requestfinished', down);
  page.on('requestfailed', down);
  return {
    async idle(quietMs, capMs) {
      const start = Date.now();
      while (Date.now() - start < capMs) {
        if (inflight === 0 && Date.now() - Math.max(lastChange, start) >= quietMs) return;
        await sleep(50);
      }
    },
  };
}

const maskCss = (selectors: string[]) => `${selectors.join(',\n')} { filter: blur(10px) !important; }`;

export async function openSession(script: Script, opts: { headed?: boolean } = {}): Promise<Session> {
  const { app } = script;
  const browser = await chromium.launch({
    headless: !opts.headed,
    // Both the flag and the context DPR are needed for device-pixel screencast frames.
    args: [`--force-device-scale-factor=${app.deviceScaleFactor}`, '--hide-scrollbars'],
  });
  try {
    const context = await browser.newContext({
      viewport: app.viewport,
      deviceScaleFactor: app.deviceScaleFactor,
      storageState: app.storageState,
      colorScheme: app.colorScheme,
      locale: app.locale,
      timezoneId: app.timezoneId,
    });
    if (app.mask.length) {
      await context.addInitScript((css: string) => {
        const add = () => {
          const el = document.createElement('style');
          el.textContent = css;
          document.documentElement.appendChild(el);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
        else add();
      }, maskCss(app.mask));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    return { browser, context, page, net: trackNetwork(page), close: () => browser.close() };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/** Open app.url, run setup steps (fast, unlogged), park the mouse at the centre. */
export async function prepare(session: Session, script: Script): Promise<Pt> {
  const { page } = session;
  try {
    await page.goto(script.app.url, { waitUntil: 'load', timeout: 30_000 });
  } catch (err) {
    throw new Error(`Cannot open app.url ${script.app.url}: ${(err as Error).message.split('\n')[0]}`);
  }
  const centre = { x: Math.round(script.app.viewport.width / 2), y: Math.round(script.app.viewport.height / 2) };
  const ctx: StepContext = { page, mode: 'check', log: new EventLog(), net: session.net, cursor: centre };
  for (const [index, step] of script.setup.entries()) await runStep(ctx, step, { sceneId: 'setup', index });
  await page.mouse.move(centre.x, centre.y);
  return centre;
}
