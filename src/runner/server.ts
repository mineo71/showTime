import { spawn, type ChildProcess } from 'node:child_process';
import type { Server } from '../script/schema';
import { sleep } from './time';

const POLL_MS = 500;
const STOP_GRACE_MS = 5000;
const KEEP_CHARS = 6000;

const tail = (out: string) => {
  const lines = out.trim().split('\n').slice(-15).join('\n');
  return lines ? `\n${lines}` : '';
};

/** Any HTTP answer counts: a dev server that answers 404 on `/` is still up. */
async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/** Stop the whole process group: a dev server's command usually starts children. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, sig);
    } catch {
      child.kill(sig);
    }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS);
  await exited;
  clearTimeout(timer);
}

/**
 * Run `work` with the app up: reuse a server that already answers at the URL, otherwise start
 * `server.run`, wait until it answers, and stop it (and everything it started) afterwards.
 */
export async function withServer<T>(
  server: Server | undefined,
  appUrl: string,
  cwd: string,
  work: () => Promise<T>,
  log?: (line: string) => void,
): Promise<T> {
  if (!server) return work();
  const url = server.url ?? appUrl;
  if (await answers(url)) {
    log?.(`server: already running at ${url}`);
    return work();
  }
  const what = `server (${server.run})`;
  log?.(`Starting ${what}…`);
  const child = spawn(server.run, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const keep = (d: Buffer) => {
    output = (output + d.toString()).slice(-KEEP_CHARS);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exit: number | null = null;
  child.on('exit', (code) => {
    exit = code ?? -1;
  });
  try {
    const deadline = Date.now() + server.timeoutMs;
    for (;;) {
      if (await answers(url)) break;
      if (exit !== null) throw new Error(`${what} exited with code ${exit} before answering at ${url}.${tail(output)}`);
      if (Date.now() > deadline) {
        throw new Error(`${what} did not answer at ${url} within ${server.timeoutMs / 1000} s. Check the URL, or raise server.timeoutMs.${tail(output)}`);
      }
      await sleep(POLL_MS);
    }
    log?.(`server: up at ${url}`);
    return await work();
  } finally {
    await stop(child);
  }
}
