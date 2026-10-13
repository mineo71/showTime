import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from '../paths';
import type { LoadedScript } from '../script/load';
import { openSession, prepare } from './browser';
import { EventLog } from './events';
import { describeStep, runStep, StepError, type StepContext } from './steps';

export interface RunOptions {
  headed?: boolean;
  log?: (line: string) => void;
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
}

const ARIA_LIMIT = 8000;

export async function check(loaded: LoadedScript, opts: RunOptions = {}): Promise<CheckReport> {
  const { script } = loaded;
  const paths = workPaths(loaded);
  await rm(paths.check, { recursive: true, force: true });
  await mkdir(paths.check, { recursive: true });

  const report: CheckReport = { ok: true, steps: [], failure: null };
  const session = await openSession(script, opts);
  try {
    const cursor = await prepare(session, script);
    const ctx: StepContext = { page: session.page, mode: 'check', log: new EventLog(), net: session.net, cursor };
    let n = 0;
    for (const scene of script.scenes) {
      for (const [index, step] of scene.steps.entries()) {
        await runStep(ctx, step, { sceneId: scene.id, index });
        const screenshot = path.join(paths.check, `${String(++n).padStart(2, '0')}-${scene.id}-${index + 1}-${step.do}.png`);
        await session.page.screenshot({ path: screenshot, scale: 'css' });
        report.steps.push({ sceneId: scene.id, index, action: describeStep(step), ok: true, screenshot });
        opts.log?.(`✓ ${scene.id} #${index + 1} ${describeStep(step)}`);
      }
    }
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
  return report;
}
