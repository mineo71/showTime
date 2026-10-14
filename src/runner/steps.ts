import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import type { Step } from '../script/schema';
import { clamp, easeInOutCubic } from '../timeline/math';
import type { CursorKind, Pt, Rect } from '../timeline/types';
import type { NetworkTracker } from './browser';
import type { EventLog } from './events';
import type { Tabs } from './tabs';
import { rng, sleep } from './time';

export type Mode = 'record' | 'check';

export interface StepContext {
  page: Page;
  mode: Mode;
  log: EventLog;
  net: NetworkTracker;
  cursor: Pt;
  /** Relative `goto` URLs resolve against this (app.url); the current page when absent. */
  baseUrl?: string;
  /** `upload` files resolve against this (the script's folder); the working directory when absent. */
  dir?: string;
  /** Pages to follow: a step that opens a tab or popup moves `page` to it. Without it, one page. */
  tabs?: Tabs;
  /** Called when `page` changes (the recorder moves its screencast). */
  onPage?: (page: Page) => Promise<void>;
}

export interface StepWhere {
  sceneId: string;
  index: number;
}

export const STEP_TIMEOUT_MS = 10_000;
export const WAIT_TIMEOUT_MS = 15_000;
export const BEAT_MS = 450;
/** A double click is drawn as two clicks this far apart. */
export const DOUBLE_CLICK_GAP_MS = 120;
/** How long a clicked upload target has to open a file chooser. */
export const FILE_CHOOSER_MS = 5000;
const NET_QUIET_MS = 300;
const NET_CAP_MS = 3000;
const IDLE_GRACE_MS = 300;

export class StepError extends Error {
  constructor(
    message: string,
    readonly where: StepWhere,
    readonly step: Step,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

export function describeStep(step: Step): string {
  if (step.do === 'drag') return `drag ${step.target} → ${step.to ?? `${step.by!.x},${step.by!.y} px`}`;
  if (step.do === 'upload') return `upload ${step.target} (${step.files.length} file${step.files.length === 1 ? '' : 's'})`;
  if ('target' in step && step.target) return `${step.do} ${step.target}`;
  if (step.do === 'wait') return step.for ? `wait ${step.for}` : `wait ${step.ms} ms`;
  if (step.do === 'goto') return `goto ${step.url}`;
  if (step.do === 'press') return `press ${step.key}`;
  if (step.do === 'pause') return `pause ${step.ms} ms`;
  if (step.do === 'scroll') return `scroll ${step.by}px`;
  return step.do;
}

export async function runStep(ctx: StepContext, step: Step, where: StepWhere): Promise<void> {
  try {
    await perform(ctx, step, where);
  } catch (err) {
    if (err instanceof StepError) throw err;
    const message = (err as Error).message.split('\n').filter(Boolean).slice(0, 4).join('\n');
    throw new StepError(`Scene "${where.sceneId}" step ${where.index + 1} (${describeStep(step)}): ${message}`, where, step);
  }
}

const centre = (r: Rect): Pt => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/** Bring the cursor to a target (scrolling it into view) and follow it if the page shifted meanwhile. */
async function reach(ctx: StepContext, selector: string) {
  const r = await resolve(ctx, selector, false);
  let box = r.box;
  let point = centre(box);
  await travel(ctx, point, r.cursor);
  // The page may have shifted during travel (late layout, animation): follow the element.
  const now = await r.loc.boundingBox();
  if (now && (Math.abs(now.x - box.x) > 2 || Math.abs(now.y - box.y) > 2)) {
    box = now;
    point = centre(now);
    await travel(ctx, point, r.cursor);
  }
  return { loc: r.loc, box, point, cursor: r.cursor };
}

async function perform(ctx: StepContext, step: Step, where: StepWhere): Promise<void> {
  // A popup may have closed itself since the last step.
  if (ctx.page.isClosed()) await follow(ctx);
  const { page, log } = ctx;
  const startMs = log.now();
  let actionMs = startMs;
  let target: Rect | undefined;

  switch (step.do) {
    case 'goto':
      await page.goto(new URL(step.url, ctx.baseUrl ?? page.url()).href, { waitUntil: 'load', timeout: WAIT_TIMEOUT_MS });
      break;
    case 'click':
    case 'dblclick':
    case 'hover':
    case 'select':
    case 'type': {
      const r = await reach(ctx, step.target);
      target = r.box;
      const point = r.point;
      actionMs = log.now();
      if (step.do !== 'hover') log.clicks.push({ tMs: actionMs, ...point });
      // A click may close its own page (an OAuth popup's "Allow"): that is not a failure.
      if (step.do === 'click') await r.loc.click({ timeout: STEP_TIMEOUT_MS, button: step.button, modifiers: step.modifiers }).catch(closedIsFine(page));
      if (step.do === 'dblclick') {
        log.clicks.push({ tMs: actionMs + DOUBLE_CLICK_GAP_MS, ...point });
        await r.loc.dblclick({ timeout: STEP_TIMEOUT_MS, modifiers: step.modifiers });
      }
      if (step.do === 'select') await r.loc.selectOption(step.value, { timeout: STEP_TIMEOUT_MS });
      if (step.do === 'type') {
        await r.loc.click({ timeout: STEP_TIMEOUT_MS });
        if (step.clear) await r.loc.fill('');
        await typeText(ctx, step.text, step.pace);
      }
      break;
    }
    case 'drag': {
      const r = await reach(ctx, step.target);
      let end: Pt;
      let toBox: Rect;
      if (step.to) {
        // Not scrolled: scrolling to the drop would move the target the cursor is about to grab.
        const to = page.locator(step.to);
        await to.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        toBox = await stableBox(to);
        end = centre(toBox);
        const view = page.viewportSize();
        if (view && (end.x < 0 || end.y < 0 || end.x > view.width || end.y > view.height)) {
          throw new Error(`${step.to} is off screen; both ends of a drag must be on screen together (scroll first, or drag "by" an offset)`);
        }
      } else {
        end = { x: r.point.x + step.by!.x, y: r.point.y + step.by!.y };
        toBox = { x: r.box.x + step.by!.x, y: r.box.y + step.by!.y, width: r.box.width, height: r.box.height };
      }
      target = union(r.box, toBox);
      actionMs = log.now();
      log.clicks.push({ tMs: actionMs, ...r.point });
      await page.mouse.down();
      const heldMs = log.now();
      await travel(ctx, end, r.cursor, true);
      await page.mouse.up();
      log.drags.push({ startMs: heldMs, endMs: log.now() });
      break;
    }
    case 'upload': {
      const files = step.files.map((f) => path.resolve(ctx.dir ?? process.cwd(), f));
      const missing = files.find((f) => !existsSync(f));
      if (missing) throw new Error(`no file at ${missing}`);
      const loc = page.locator(step.target);
      await loc.waitFor({ state: 'attached', timeout: STEP_TIMEOUT_MS });
      const isInput = await loc.evaluate((el) => el instanceof HTMLInputElement && el.type === 'file');
      // A hidden file input has nothing to point at: fill it directly.
      if (isInput && !(await loc.isVisible())) {
        await loc.setInputFiles(files);
        break;
      }
      const r = await reach(ctx, step.target);
      target = r.box;
      actionMs = log.now();
      log.clicks.push({ tMs: actionMs, ...r.point });
      const chooser = page.waitForEvent('filechooser', { timeout: FILE_CHOOSER_MS }).catch(() => null);
      await r.loc.click({ timeout: STEP_TIMEOUT_MS });
      const picked = await chooser;
      if (!picked) {
        throw new Error(`clicking ${step.target} opened no file chooser; target the button or drop zone a person clicks to pick files, or the file input`);
      }
      await picked.setFiles(files);
      break;
    }
    case 'closeTab': {
      if (!ctx.tabs) throw new Error('closeTab needs a browser session that follows tabs');
      ctx.page = await ctx.tabs.close();
      await ctx.onPage?.(ctx.page);
      break;
    }
    case 'press':
      if (ctx.mode === 'record') log.keys.push(log.now());
      await page.keyboard.press(step.key);
      break;
    case 'scroll':
      if (step.target) target = (await resolve(ctx, step.target, true)).box;
      else await wheel(ctx, step.by ?? 0);
      break;
    case 'wait':
      if (step.for) await page.locator(step.for).waitFor({ state: 'visible', timeout: step.timeoutMs ?? WAIT_TIMEOUT_MS });
      else await sleep(step.ms ?? 0);
      break;
    case 'pause':
      if (ctx.mode === 'record') await sleep(step.ms);
      break;
  }

  const endMs = log.now();
  if (step.do === 'wait' || step.do === 'goto') log.idle.push({ startMs, endMs });
  await settle(ctx, step);
  log.steps.push({ ...where, do: step.do, startMs, actionMs, endMs, settledMs: log.now(), target });
}

async function resolve(ctx: StepContext, selector: string, forceScroll: boolean) {
  const loc = ctx.page.locator(selector);
  await loc.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  // Visible fraction within the viewport, clipped by scrollable ancestors (a list or modal body too).
  const visible = await loc.evaluate(
    (el) =>
      new Promise<number>((done) => {
        const io = new IntersectionObserver((entries) => {
          io.disconnect();
          done(entries[0].intersectionRatio);
        });
        io.observe(el);
      }),
  );
  if (forceScroll || visible < 0.99) {
    const smooth = ctx.mode === 'record';
    await loc.evaluate(
      (el, s) => el.scrollIntoView({ behavior: (s ? 'smooth' : 'instant') as ScrollBehavior, block: 'center', inline: 'nearest' }),
      smooth,
    );
  }
  const box = await stableBox(loc);
  const css = await loc.evaluate((el) => getComputedStyle(el).cursor);
  const cursor: CursorKind = css === 'text' ? 'text' : css === 'pointer' ? 'pointer' : 'arrow';
  return { loc, box, cursor };
}

/** Wait (max ~2 s) until the element stops moving, e.g. after smooth scrolling or an opening animation. */
async function stableBox(loc: Locator): Promise<Rect> {
  let prev = await loc.boundingBox();
  for (let i = 0; i < 40; i++) {
    await sleep(50);
    const next = await loc.boundingBox();
    if (prev && next && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.width - next.width) < 0.5) {
      return next;
    }
    prev = next;
  }
  if (!prev) throw new Error('element has no bounding box (hidden or detached)');
  return prev;
}

/** Move the cursor to `to`; `held` (a drag) sends a stream of moves in check mode too, which drag libraries need. */
async function travel(ctx: StepContext, to: Pt, cursor: CursorKind, held = false): Promise<void> {
  const from = ctx.cursor;
  if (ctx.mode === 'check') {
    await ctx.page.mouse.move(to.x, to.y, { steps: held ? 12 : 1 });
    ctx.cursor = to;
    return;
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = clamp(350 + dist * 0.35, 350, 900);
  const startMs = ctx.log.now();
  const t0 = Date.now();
  const n = Math.max(2, Math.round(duration / 16));
  for (let i = 1; i <= n; i++) {
    const e = easeInOutCubic(i / n);
    await ctx.page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    const wait = t0 + (duration * i) / n - Date.now();
    if (wait > 0) await sleep(wait);
  }
  ctx.log.moves.push({ startMs, endMs: ctx.log.now(), from, to, cursor });
  ctx.cursor = to;
}

async function typeText(ctx: StepContext, text: string, pace: 'human' | 'fast' | number): Promise<void> {
  if (ctx.mode === 'check' || pace === 'fast') {
    await ctx.page.keyboard.type(text);
    return;
  }
  const rand = rng(text);
  for (const ch of text) {
    await ctx.page.keyboard.type(ch);
    ctx.log.keys.push(ctx.log.now());
    await sleep(typeof pace === 'number' ? pace : 45 + rand() * 65);
  }
}

async function wheel(ctx: StepContext, by: number): Promise<void> {
  if (ctx.mode === 'check') {
    await ctx.page.mouse.wheel(0, by);
    await sleep(100);
    return;
  }
  const n = 14;
  for (let i = 0; i < n; i++) {
    await ctx.page.mouse.wheel(0, by / n);
    await sleep(40);
  }
}

const closedIsFine = (page: Page) => (err: unknown) => {
  if (!page.isClosed()) throw err;
};

/** Move to the page the run should act in now: a tab or popup the step opened, or the one before a closed one. */
async function follow(ctx: StepContext): Promise<void> {
  const next = await ctx.tabs?.settle();
  if (!next) return;
  ctx.page = next;
  await ctx.onPage?.(next);
}

async function settle(ctx: StepContext, step: Step): Promise<void> {
  const s = ctx.log.now();
  await ctx.net.idle(NET_QUIET_MS, NET_CAP_MS);
  const waited = ctx.log.now() - s;
  if (waited > IDLE_GRACE_MS) ctx.log.idle.push({ startMs: s + IDLE_GRACE_MS, endMs: s + waited });
  // Followed before the beat, so the new page is on screen while the viewer takes it in.
  await follow(ctx);
  if (ctx.mode === 'record') await sleep(BEAT_MS + (step.show?.hold ?? 0));
}
