import { spawn } from 'node:child_process';
import type { Hook } from '../script/schema';

export const RUN_TIMEOUT_MS = 120_000;
export const REQUEST_TIMEOUT_MS = 30_000;
const TAIL_LINES = 20;
const KEEP_CHARS = 8000;

export interface HookOptions {
  /** Folder shell hooks run in (the script's folder). */
  cwd: string;
  /** Prefix for errors, e.g. "hooks.before". */
  label: string;
  timeoutMs?: number;
}

const describeHook = (h: Hook) => ('run' in h ? h.run : `${h.request.method} ${h.request.url}`);

/** The last lines of a command's output, on their own lines after the message. */
const tail = (out: string) => {
  const lines = out.trim().split('\n').slice(-TAIL_LINES).join('\n');
  return lines ? `\n${lines}` : '';
};

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Own process group, so a timeout kills whatever the shell started too.
    const child = spawn(command, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-KEEP_CHARS);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      reject(new Error(`timed out after ${timeoutMs / 1000} s${tail(output)}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}${tail(output)}`));
    });
  });
}

async function runRequest(r: Extract<Hook, { request: unknown }>['request'], timeoutMs: number): Promise<void> {
  const hasJson = r.json !== undefined;
  const res = await fetch(r.url, {
    method: r.method,
    headers: { ...(hasJson ? { 'content-type': 'application/json' } : {}), ...r.headers },
    body: hasJson ? JSON.stringify(r.json) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}${tail(await res.text().catch(() => ''))}`);
}

/** Run hooks in order; the first failure stops the run and names the hook. */
export async function runHooks(hooks: Hook[], opts: HookOptions): Promise<void> {
  for (const [i, hook] of hooks.entries()) {
    try {
      if ('run' in hook) await runCommand(hook.run, opts.cwd, opts.timeoutMs ?? RUN_TIMEOUT_MS);
      else await runRequest(hook.request, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    } catch (err) {
      throw new Error(`${opts.label}[${i}] (${describeHook(hook)}) failed: ${(err as Error).message}`);
    }
  }
}

/**
 * `before` hooks, then the work, then `after` hooks, which run even when the work fails. When both
 * fail, the work's error wins and the hook's is passed to `log`.
 */
export async function withHooks<T>(
  hooks: { before: Hook[]; after: Hook[] },
  cwd: string,
  work: () => Promise<T>,
  log?: (line: string) => void,
): Promise<T> {
  await runHooks(hooks.before, { cwd, label: 'hooks.before' });
  let result: T;
  try {
    result = await work();
  } catch (err) {
    await runHooks(hooks.after, { cwd, label: 'hooks.after' }).catch((hookErr: Error) => log?.(`✖ ${hookErr.message}`));
    throw err;
  }
  await runHooks(hooks.after, { cwd, label: 'hooks.after' });
  return result;
}
