import { createHash } from 'node:crypto';
import type { Script, Step } from './schema';

/** Everything that changes what gets recorded: the step minus `show`, plus `show.hold`. */
function actionsOf(step: Step): Record<string, unknown> {
  const { show, ...rest } = step;
  return show?.hold ? { ...rest, hold: show.hold } : rest;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** `app` without fields that sit at their defaults, so adding a field never invalidates older takes. */
function appOf(app: Script['app']): Record<string, unknown> {
  const { mock, dialogs, ...rest } = app;
  return { ...rest, ...(mock.length ? { mock } : {}), ...(dialogs !== 'accept' ? { dialogs } : {}) };
}

export function actionHash(script: Script): string {
  const payload = {
    app: appOf(script.app),
    setup: script.setup.map(actionsOf),
    scenes: script.scenes.map((s) => ({ id: s.id, steps: s.steps.map(actionsOf) })),
  };
  return createHash('sha256').update(canonical(payload)).digest('hex');
}
