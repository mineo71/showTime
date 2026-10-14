import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from '../paths';
import { stepKey } from '../timeline/narration';
import type { LoadedScript } from '../script/load';
import { openSession, prepare } from './browser';
import { EventLog } from './events';
import { withHooks } from './hooks';
import { withServer } from './server';
import { netMode, type NetMode, type NetReport } from './replay';
import { describeStep, runStep, StepError, type StepContext } from './steps';

export interface RunOptions {
  headed?: boolean;
  log?: (line: string) => void;
  /** Non-fatal problems, such as a failing after hook (default: stderr). */
  warn?: (line: string) => void;
  /** script.replay: auto (default), live, record or replay */
  net?: NetMode;
}

export interface CheckOptions extends RunOptions {
  /** rehearse only up to and including this step (`scene#n`) */
  until?: string;
}

export interface CheckStep {
  sceneId: string;
  index: number;
  action: string;
  ok: boolean;
  screenshot?: string;
  error?: string;
}

export interface CheckFailure {
  sceneId: string;
  index: number;
  error: string;
  screenshot: string;
  aria: string;
}

export interface CheckReport {
  ok: boolean;
  steps: CheckStep[];
  failure: CheckFailure | null;
  /** recorded or replayed traffic, null when live */
  net: NetReport | null;
}

const ARIA_LIMIT = 8000;

export async function check(loaded: LoadedScript, opts: CheckOptions = {}): Promise<CheckReport> {
  const { script } = loaded;
  const paths = workPaths(loaded);
  if (opts.until && !script.scenes.some((s) => s.steps.some((_, i) => stepKey(s.id, i) === opts.until))) {
    throw new Error(`--until ${opts.until} names no step; use scene#n, e.g. ${stepKey(script.scenes[0].id, 0)}.`);
  }
  netMode(script, opts.net);
  await rm(paths.check, { recursive: true, force: true });
  await mkdir(paths.check, { recursive: true });

  return withServer(script.server, script.app.url, loaded.dir, () => withHooks(script.hooks, loaded.dir, () => rehearse(loaded, opts), opts.warn), opts.log);
}

async function rehearse(loaded: LoadedScript, opts: CheckOptions): Promise<CheckReport> {
  const { script } = loaded;
  const paths = workPaths(loaded);
  const report: CheckReport = { ok: true, steps: [], failure: null, net: null };
  const session = await openSession(script, opts);
  announceNet(session.replay?.report(), opts);
  try {
    const cursor = await prepare(session, script);
    const ctx: StepContext = { page: session.page, mode: 'check', log: new EventLog(), net: session.net, cursor, baseUrl: script.app.url };
    let n = 0;
    let done = false;
    for (const scene of script.scenes) {
      if (done) break;
      for (const [index, step] of scene.steps.entries()) {
        await runStep(ctx, step, { sceneId: scene.id, index });
        const screenshot = path.join(paths.check, `${String(++n).padStart(2, '0')}-${scene.id}-${index + 1}-${step.do}.png`);
        await session.page.screenshot({ path: screenshot, scale: 'css' });
        report.steps.push({ sceneId: scene.id, index, action: describeStep(step), ok: true, screenshot });
        opts.log?.(`✓ ${scene.id} #${index + 1} ${describeStep(step)}`);
        if (stepKey(scene.id, index) === opts.until) {
          done = true;
          break;
        }
      }
    }
    // A partial rehearsal would leave later requests out of the file.
    if (!opts.until) await session.replay?.save();
  } catch (err) {
    if (!(err instanceof StepError)) throw err;
    const screenshot = path.join(paths.check, 'failure.png');
    await session.page.screenshot({ path: screenshot, scale: 'css' }).catch(() => undefined);
    const aria = await session.page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '');
    report.ok = false;
    report.failure = { sceneId: err.where.sceneId, index: err.where.index, error: err.message, screenshot, aria: aria.slice(0, ARIA_LIMIT) };
    report.steps.push({ sceneId: err.where.sceneId, index: err.where.index, action: describeStep(err.step), ok: false, error: err.message });
    opts.log?.(`✗ ${err.message}`);
  } finally {
    await session.close();
  }
  report.net = session.replay?.report() ?? null;
  warnMisses(report.net, opts);
  return report;
}

export function announceNet(net: NetReport | undefined, opts: RunOptions): void {
  if (net) opts.log?.(net.mode === 'replay' ? `Network: replaying ${net.file}` : `Network: recording to ${net.file}`);
}

export function warnMisses(net: NetReport | null, opts: RunOptions): void {
  if (!net?.misses) return;
  const warn = opts.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
  warn(`${net.misses} request(s) matching replay.match were not in ${net.file} and went to the network; re-record with --net record to add them.`);
}
