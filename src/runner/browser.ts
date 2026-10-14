import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from 'playwright';
import { ScriptError, type Mock, type Script } from '../script/schema';
import type { Pt } from '../timeline/types';
import { EventLog } from './events';
import { attachNet, type NetMode, type NetSession } from './replay';
import { runStep, STEP_TIMEOUT_MS, type StepContext } from './steps';
import { Tabs } from './tabs';
import { sleep } from './time';

export interface NetworkTracker {
  /** Resolve once no request has been in flight for `quietMs` (counted from now), or after `capMs`. */
  idle(quietMs: number, capMs: number): Promise<void>;
}

export interface Session {
  browser: Browser;
  context: BrowserContext;
  /** the page steps act in now (a tab or popup a step opened, else the first) */
  readonly page: Page;
  tabs: Tabs;
  net: NetworkTracker;
  /** recorded or replayed traffic (script.replay), null when live */
  replay: NetSession | null;
  close(): Promise<void>;
}

/** Event streams never finish; counting them would hold every step for the full settle cap. */
const isStream = (r: Request) => r.resourceType() === 'eventsource' || (r.headers().accept ?? '').includes('text/event-stream');

/** Requests of every page in the context: a popup's requests count too. */
export function trackNetwork(page: Pick<BrowserContext, 'on'>): NetworkTracker {
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

/** Init script that blurs `selectors` (app.mask). */
export const maskScript = (selectors: string[]) => styleScript(selectors, 'filter: blur(10px) !important;');

/** Init script that hides `selectors` without moving the layout (app.hide). */
export const hideScript = (selectors: string[]) => styleScript(selectors, 'visibility: hidden !important;');

/**
 * Init script that adds `declarations` to every element matching `selectors`. Built as a string on
 * purpose: a function would be serialized with whatever helpers the transpiler injected (tsx adds
 * `__name(...)`), which are undefined in the page.
 */
function styleScript(selectors: string[], declarations: string): string {
  // One rule per selector: an invalid selector only drops its own rule.
  const css = JSON.stringify(selectors.map((s) => `${s} { ${declarations} }`).join('\n'));
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

export async function openSession(script: Script, opts: { headed?: boolean; net?: NetMode } = {}): Promise<Session> {
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
      reducedMotion: app.reducedMotion,
      // A service worker could answer requests itself, out of reach of the mocks and the replay.
      serviceWorkers: app.mock.length || script.replay ? 'block' : 'allow',
    });
    if (app.mask.length) await context.addInitScript({ content: maskScript(app.mask) });
    if (app.hide.length) await context.addInitScript({ content: hideScript(app.hide) });
    // Starts the page clock at app.clock and lets it run: frozen time would stall Date-based debounce.
    if (app.clock) await context.clock.install({ time: app.clock });
    // Replay routes go first: Playwright tries the most recently added route first, so mocks win.
    const replay = await attachNet(context, script, opts.net);
    // Reversed, the first matching mock wins.
    for (const mock of [...app.mock].reverse()) await context.route(mock.url, (route) => answer(route, mock));
    // Every page, popups too: the same size (frames of one take share it), timeout and dialog answers.
    context.on('page', (p) => {
      p.setDefaultTimeout(STEP_TIMEOUT_MS);
      if (!p.viewportSize() || p.viewportSize()!.width !== app.viewport.width || p.viewportSize()!.height !== app.viewport.height) {
        p.setViewportSize(app.viewport).catch(() => undefined);
      }
    });
    context.on('dialog', (dialog) => {
      (app.dialogs === 'accept' ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    });
    const page = await context.newPage();
    const tabs = new Tabs(context, page);
    for (const field of ['mask', 'hide'] as const) {
      const selectors = app[field];
      const invalid = await page.evaluate(
        (list) =>
          list.map((s) => {
            try {
              document.querySelector(s);
              return false;
            } catch {
              return true;
            }
          }),
        selectors,
      );
      const bad = invalid.indexOf(true);
      if (bad >= 0) {
        throw new ScriptError(
          `app.${field}[${bad}] "${selectors[bad]}" is not a valid CSS selector — app.${field} takes CSS selectors (.email, #card), not Playwright ones like text= or role=`,
        );
      }
    }
    return {
      browser,
      context,
      get page() {
        return tabs.active;
      },
      tabs,
      net: trackNetwork(context),
      replay,
      close: () => {
        replay?.dispose();
        return browser.close();
      },
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * Fulfil a request from an `app.mock` entry. Cross-origin answers echo the page's origin and allow
 * credentials (a wildcard is refused for cookie-authenticated calls); Playwright answers preflights.
 */
async function answer(route: Route, mock: Mock): Promise<void> {
  const request = route.request();
  if (mock.method && request.method().toUpperCase() !== mock.method.toUpperCase()) return route.fallback();
  const origin = request.headers().origin;
  const cors: Record<string, string> = origin
    ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
    : {};
  if (mock.delayMs) await sleep(mock.delayMs);
  const json = mock.json !== undefined;
  // The page may have navigated away while we waited: a closed route is not an error.
  await route
    .fulfill({
      status: mock.status,
      headers: { ...cors, ...(json ? { 'content-type': 'application/json' } : {}), ...mock.headers },
      body: json ? JSON.stringify(mock.json) : (mock.body ?? ''),
    })
    .catch(() => undefined);
}

/** Open app.url, run setup steps (fast, unlogged), park the mouse at the centre. */
export async function prepare(session: Session, script: Script, dir?: string): Promise<Pt> {
  const { page } = session;
  try {
    await page.goto(script.app.url, { waitUntil: 'load', timeout: 30_000 });
  } catch (err) {
    throw new Error(`Cannot open app.url ${script.app.url}: ${(err as Error).message.split('\n')[0]}`);
  }
  const centre = { x: Math.round(script.app.viewport.width / 2), y: Math.round(script.app.viewport.height / 2) };
  const ctx: StepContext = { page, mode: 'check', log: new EventLog(), net: session.net, cursor: centre, baseUrl: script.app.url, dir, tabs: session.tabs };
  for (const [index, step] of script.setup.entries()) await runStep(ctx, step, { sceneId: 'setup', index });
  await ctx.page.mouse.move(centre.x, centre.y);
  return centre;
}
