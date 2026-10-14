import { spawn } from 'node:child_process';
import type { Hook } from '../script/schema';
import { guardGroup } from './group';

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
    // Ctrl+C while it runs stops it too: its own group doesn't get the terminal's signal.
    const unguard = guardGroup(child);
    let output = '';
    let settled = false;
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-KEEP_CHARS);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unguard();
      // A background process the hook started (a dev server, say) may hold the pipes open: let go.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish(new Error(`timed out after ${timeoutMs / 1000} s${tail(output)}`));
    }, timeoutMs);
    child.on('error', (err) => finish(err));
    // Done when the shell exits, not when every process holding its output does.
    child.on('exit', (code) => {
      if (code === 0) return finish();
      const fail = () => finish(new Error(`exit code ${code}${tail(output)}`));
      child.on('close', fail); // the last output usually arrives right after exit
      setTimeout(fail, 500);
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

const toStderr = (line: string) => {
  process.stderr.write(`${line}\n`);
};

/**
 * `before` hooks, then the work, then `after` hooks, which run even when the work fails. A failing
 * `before` hook aborts; a failing `after` hook is only a warning, so it never undoes the work's
 * result (a saved take, a check report).
 */
export async function withHooks<T>(
  hooks: { before: Hook[]; after: Hook[] },
  cwd: string,
  work: () => Promise<T>,
  warn: (line: string) => void = toStderr,
): Promise<T> {
  await runHooks(hooks.before, { cwd, label: 'hooks.before' });
  const after = () => runHooks(hooks.after, { cwd, label: 'hooks.after' }).catch((err: Error) => warn(`⚠ ${err.message}`));
  try {
    return await work();
  } finally {
    await after();
  }
}
