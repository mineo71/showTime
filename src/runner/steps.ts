import type { Locator, Page } from 'playwright';
import type { Step } from '../script/schema';
import { clamp, easeInOutCubic } from '../timeline/math';
import type { CursorKind, Pt, Rect } from '../timeline/types';
import type { NetworkTracker } from './browser';
import type { EventLog } from './events';
import { rng, sleep } from './time';

export type Mode = 'record' | 'check';

export interface StepContext {
  page: Page;
  mode: Mode;
  log: EventLog;
  net: NetworkTracker;
  cursor: Pt;
}

export interface StepWhere {
  sceneId: string;
  index: number;
}

export const STEP_TIMEOUT_MS = 10_000;
export const WAIT_TIMEOUT_MS = 15_000;
export const BEAT_MS = 450;
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

async function perform(ctx: StepContext, step: Step, where: StepWhere): Promise<void> {
  const { page, log } = ctx;
  const startMs = log.now();
  let actionMs = startMs;
  let target: Rect | undefined;

  switch (step.do) {
    case 'goto':
      await page.goto(step.url, { waitUntil: 'load', timeout: WAIT_TIMEOUT_MS });
      break;
    case 'click':
    case 'hover':
    case 'select':
    case 'type': {
      const r = await resolve(ctx, step.target, false);
      target = r.box;
      const point = centre(r.box);
      await travel(ctx, point, r.cursor);
      actionMs = log.now();
      if (step.do !== 'hover') log.clicks.push({ tMs: actionMs, ...point });
      if (step.do === 'click') await r.loc.click({ timeout: STEP_TIMEOUT_MS });
      if (step.do === 'select') await r.loc.selectOption(step.value, { timeout: STEP_TIMEOUT_MS });
      if (step.do === 'type') {
        await r.loc.click({ timeout: STEP_TIMEOUT_MS });
        if (step.clear) await r.loc.fill('');
        await typeText(ctx, step.text, step.pace);
      }
      break;
    }
    case 'press':
      await page.keyboard.press(step.key);
      break;
    case 'scroll':
      if (step.target) target = (await resolve(ctx, step.target, true)).box;
      else await wheel(ctx, step.by ?? 0);
      break;
    case 'wait':
      if (step.for) await page.locator(step.for).waitFor({ state: 'visible', timeout: WAIT_TIMEOUT_MS });
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
  const inView = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  });
  if (forceScroll || !inView) {
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

async function travel(ctx: StepContext, to: Pt, cursor: CursorKind): Promise<void> {
  const from = ctx.cursor;
  if (ctx.mode === 'check') {
    await ctx.page.mouse.move(to.x, to.y);
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

async function settle(ctx: StepContext, step: Step): Promise<void> {
  const s = ctx.log.now();
  await ctx.net.idle(NET_QUIET_MS, NET_CAP_MS);
  const waited = ctx.log.now() - s;
  if (waited > IDLE_GRACE_MS) ctx.log.idle.push({ startMs: s + IDLE_GRACE_MS, endMs: s + waited });
  if (ctx.mode === 'record') await sleep(BEAT_MS + (step.show?.hold ?? 0));
}
