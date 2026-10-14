import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
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
async function answers(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/** Something accepts connections on the URL's port: a server is running, even if it is still busy compiling. */
function listening(url: string): Promise<boolean> {
  const u = new URL(url);
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  return new Promise((resolve) => {
    const socket = connect({ host: u.hostname, port, timeout: 1000 });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Whether any process of the group is still alive. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(child: ChildProcess, sig: NodeJS.Signals) {
  try {
    process.kill(-child.pid!, sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
      // already gone
    }
  }
}

/**
 * Stop everything the command started: the whole process group, not just the shell, which may have
 * exited already (`npm run dev &`). SIGTERM first, SIGKILL for whatever is left after the grace period.
 */
async function stop(child: ChildProcess): Promise<void> {
  const pgid = child.pid!;
  const wait = async (ms: number) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (!groupAlive(pgid)) return true;
      await sleep(100);
    }
    return !groupAlive(pgid);
  };
  signalGroup(child, 'SIGTERM');
  if (!(await wait(STOP_GRACE_MS))) {
    signalGroup(child, 'SIGKILL');
    await wait(2000);
  }
  // Orphans may have held the pipes open; let go so the CLI can exit.
  child.stdout?.destroy();
  child.stderr?.destroy();
}

/**
 * While the server runs, make sure it dies with showTime: on Ctrl+C, a SIGTERM, a closed terminal or
 * `process.exit` elsewhere (a `finally` doesn't run in those cases). Returns the cleanup that removes the guards.
 */
function guard(child: ChildProcess): () => void {
  const kill = () => signalGroup(child, 'SIGTERM');
  const exitWith = (code: number) => () => {
    kill();
    process.exit(code);
  };
  const handlers: Array<[NodeJS.Signals, () => void]> = [
    ['SIGINT', exitWith(130)],
    ['SIGTERM', exitWith(143)],
    ['SIGHUP', exitWith(129)],
  ];
  process.on('exit', kill);
  for (const [sig, h] of handlers) process.on(sig, h);
  return () => {
    process.off('exit', kill);
    for (const [sig, h] of handlers) process.off(sig, h);
  };
}

/**
 * Run `work` with the app up: reuse a server that is already listening at the URL, otherwise start
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
  // Relative URLs resolve against app.url, like relative gotos.
  const url = new URL(server.url ?? appUrl, appUrl).href;
  const deadline = Date.now() + server.timeoutMs;
  const answered = async () => {
    for (;;) {
      if (await answers(url, Math.max(1000, Math.min(10_000, deadline - Date.now())))) return true;
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
  };

  if (await listening(url)) {
    // Already running, maybe still compiling its first page: wait for it, don't start another.
    log?.(`server: already running at ${url}`);
    if (!(await answered())) throw new Error(`server: something listens at ${url} but did not answer within ${server.timeoutMs / 1000} s.`);
    return work();
  }

  const what = `server (${server.run})`;
  log?.(`Starting ${what}…`);
  const child = spawn(server.run, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const unguard = guard(child);
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
    for (;;) {
      if (await answers(url)) break;
      // The shell may exit while what it started keeps running (`npm run dev &`): only a dead group is a failure.
      if (exit !== null && !groupAlive(child.pid!)) {
        const hint = exit === 0 ? ' `run` must keep the server running in the foreground.' : '';
        throw new Error(`${what} exited with code ${exit} before answering at ${url}.${hint}${tail(output)}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`${what} did not answer at ${url} within ${server.timeoutMs / 1000} s. Check the URL, or raise server.timeoutMs.${tail(output)}`);
      }
      await sleep(POLL_MS);
    }
    log?.(`server: up at ${url}`);
    return await work();
  } finally {
    await stop(child);
    unguard();
  }
}
