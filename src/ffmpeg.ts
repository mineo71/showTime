import { spawn } from 'node:child_process';

export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(-2000)}`)),
    );
  });
}

/** Run a command and stream data into its stdin; `feed` awaits back-pressure through `write`. */
export function runWithInput(
  cmd: string,
  args: string[],
  feed: (write: (chunk: Buffer) => Promise<void>) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(-2000)}`)),
    );
    child.stdin.on('error', () => undefined); // surfaced through the exit code
    const write = (chunk: Buffer) =>
      new Promise<void>((done) => {
        if (child.stdin.write(chunk)) done();
        else child.stdin.once('drain', done);
      });
    feed(write).then(
      () => child.stdin.end(),
      (e) => {
        child.kill();
        reject(e);
      },
    );
  });
}

export async function assertFfmpeg(): Promise<void> {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
  } catch {
    throw new Error('ffmpeg/ffprobe not found on PATH. Install it: brew install ffmpeg (macOS) or apt install ffmpeg (Linux).');
  }
}

export interface VideoProbe {
  width: number;
  height: number;
  durationMs: number;
}

export async function probeVideo(file: string): Promise<VideoProbe> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    file,
  ]);
  const j = JSON.parse(out) as { streams: Array<{ width: number; height: number }>; format: { duration: string } };
  return { width: j.streams[0].width, height: j.streams[0].height, durationMs: Math.round(Number(j.format.duration) * 1000) };
}
