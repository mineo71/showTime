import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from 'playwright';
import { ScriptError, type Mock, type Script } from '../script/schema';
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

/** Event streams never finish; counting them would hold every step for the full settle cap. */
const isStream = (r: Request) => r.resourceType() === 'eventsource' || (r.headers().accept ?? '').includes('text/event-stream');

export function trackNetwork(page: Page): NetworkTracker {
  let inflight = 0;
  const counted = new Set<Request>();
  let lastChange = Date.now();
  const up = () => {
    inflight++;
    lastChange = Date.now();
  };
  const down = () => {
    inflight = Math.max(0, inflight - 1);
    lastChange = Date.now();
  };
  page.on('request', (r) => {
    if (isStream(r)) return;
    counted.add(r);
    up();
  });
  const done = (r: Request) => {
    if (counted.delete(r)) down();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
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

/**
 * Init script that blurs `selectors`. Built as a string on purpose: a function would be serialized
 * with whatever helpers the transpiler injected (tsx adds `__name(...)`), which are undefined in the page.
 */
export function maskScript(selectors: string[]): string {
  // One rule per selector: an invalid selector only drops its own rule.
  const css = JSON.stringify(selectors.map((s) => `${s} { filter: blur(10px) !important; }`).join('\n'));
  return `(() => {
  const css = ${css};
  const add = () => {
    const el = document.createElement('style');
    el.textContent = css;
    document.documentElement.appendChild(el);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
})();`;
}

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
    if (app.mask.length) await context.addInitScript({ content: maskScript(app.mask) });
    if (app.clock) await context.clock.setFixedTime(app.clock);
    for (const mock of app.mock) await context.route(mock.url, (route) => answer(route, mock));
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.on('dialog', (dialog) => {
      (app.dialogs === 'accept' ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    });
    const invalid = await page.evaluate(
      (selectors) =>
        selectors.map((s) => {
          try {
            document.querySelector(s);
            return false;
          } catch {
            return true;
          }
        }),
      app.mask,
    );
    const bad = invalid.indexOf(true);
    if (bad >= 0) {
      throw new ScriptError(
        `app.mask[${bad}] "${app.mask[bad]}" is not a valid CSS selector — masks take CSS selectors (.email, #card), not Playwright ones like text= or role=`,
      );
    }
    return { browser, context, page, net: trackNetwork(page), close: () => browser.close() };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' };

/** Fulfil a request from an `app.mock` entry (cross-origin friendly). */
async function answer(route: Route, mock: Mock): Promise<void> {
  const method = route.request().method().toUpperCase();
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS }).catch(() => undefined);
  if (mock.method && method !== mock.method.toUpperCase()) return route.fallback();
  if (mock.delayMs) await sleep(mock.delayMs);
  const json = mock.json !== undefined;
  // The page may have navigated away while we waited: a closed route is not an error.
  await route
    .fulfill({
      status: mock.status,
      headers: { ...CORS, ...(json ? { 'content-type': 'application/json' } : {}), ...mock.headers },
      body: json ? JSON.stringify(mock.json) : (mock.body ?? ''),
    })
    .catch(() => undefined);
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
  const ctx: StepContext = { page, mode: 'check', log: new EventLog(), net: session.net, cursor: centre, baseUrl: script.app.url };
  for (const [index, step] of script.setup.entries()) await runStep(ctx, step, { sceneId: 'setup', index });
  await page.mouse.move(centre.x, centre.y);
  return centre;
}
