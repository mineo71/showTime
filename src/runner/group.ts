import type { ChildProcess } from 'node:child_process';

/** Signal a detached child's whole process group, falling back to the child alone. */
export function signalGroup(child: ChildProcess, sig: NodeJS.Signals) {
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
 * While a detached child runs, make sure its process group dies with showTime: on Ctrl+C, a SIGTERM,
 * a closed terminal or `process.exit` elsewhere (a `finally` doesn't run in those cases). Returns the
 * cleanup that removes the guards.
 */
export function guardGroup(child: ChildProcess): () => void {
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
