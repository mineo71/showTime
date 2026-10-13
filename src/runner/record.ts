import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertFfmpeg, probeVideo } from '../ffmpeg';
import { workPaths } from '../paths';
import { actionHash } from '../script/hash';
import type { LoadedScript } from '../script/load';
import type { TakeEvents } from '../timeline/types';
import { openSession, prepare, type Session } from './browser';
import { startCapture, type Frame } from './capture';
import type { RunOptions } from './check';
import { encodeFrames } from './encode';
import { EventLog } from './events';
import { withHooks } from './hooks';
import { describeStep, runStep, StepError, type StepContext } from './steps';
import { sleep } from './time';

export const ESTABLISH_MS = 800;
export const TAIL_MS = 800;
export const TAKE_FPS = 30;

export interface RecordOptions extends RunOptions {
  keepFrames?: boolean;
}

interface Shot {
  frames: Frame[];
  durationMs: number;
  log: EventLog;
}

async function shoot(session: Session, loaded: LoadedScript, framesDir: string, opts: RecordOptions): Promise<Shot> {
  const { script } = loaded;
  const { viewport, deviceScaleFactor } = script.app;
  const cursor = await prepare(session, script);
  const capture = await startCapture(session.page, framesDir, {
    width: viewport.width * deviceScaleFactor,
    height: viewport.height * deviceScaleFactor,
  });
  const log = new EventLog(capture.t0);
  const ctx: StepContext = { page: session.page, mode: 'record', log, net: session.net, cursor, baseUrl: script.app.url };
  try {
    await sleep(ESTABLISH_MS);
    for (const scene of script.scenes) {
      for (const [index, step] of scene.steps.entries()) {
        opts.log?.(`● ${scene.id} #${index + 1} ${describeStep(step)}`);
        await runStep(ctx, step, { sceneId: scene.id, index });
      }
    }
    await sleep(TAIL_MS);
  } catch (err) {
    await capture.stop();
    throw err;
  }
  const durationMs = log.now();
  const frames = await capture.stop();
  return { frames, durationMs, log };
}

export async function record(loaded: LoadedScript, opts: RecordOptions = {}): Promise<TakeEvents> {
  const { script } = loaded;
  await assertFfmpeg();
  const paths = workPaths(loaded);
  // Record into take.tmp; the previous take is replaced only once this one is complete.
  const tmp = paths.takeTmp;
  const frames = path.join(tmp, 'frames');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });

  // After hooks run once the take is saved, so a failing one cannot cost the take.
  return withHooks(
    script.hooks,
    loaded.dir,
    async () => {
      const session = await openSession(script, opts);
      let shot: Shot;
      try {
        shot = await shoot(session, loaded, frames, opts);
      } catch (err) {
        if (err instanceof StepError) {
          const failure = path.join(tmp, 'failure.png');
          await session.page.screenshot({ path: failure, scale: 'css' }).catch(() => undefined);
          throw new Error(
            `${err.message}\nRecording aborted; the previous take is untouched (failure screenshot: ${failure}). Run \`showtime check ${loaded.scriptPath}\` to debug.`,
          );
        }
        throw err;
      } finally {
        await session.close();
      }

      opts.log?.('Encoding raw.mp4…');
      const raw = path.join(tmp, 'raw.mp4');
      await encodeFrames(shot.frames, raw, { fps: TAKE_FPS, durationMs: shot.durationMs });
      const probe = await probeVideo(raw);
      const events: TakeEvents = {
        version: 1,
        actionHash: actionHash(script),
        viewport: script.app.viewport,
        deviceScaleFactor: script.app.deviceScaleFactor,
        video: { file: 'raw.mp4', width: probe.width, height: probe.height, fps: TAKE_FPS, durationMs: shot.durationMs },
        steps: shot.log.steps,
        moves: shot.log.moves,
        clicks: shot.log.clicks,
        idle: shot.log.idle,
        keys: shot.log.keys,
      };
      await writeFile(path.join(tmp, 'events.json'), JSON.stringify(events, null, 2));
      if (!opts.keepFrames) await rm(frames, { recursive: true, force: true });
      await rm(paths.take, { recursive: true, force: true });
      await rename(tmp, paths.take);
      return events;
    },
    opts.warn,
  );
}
