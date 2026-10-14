import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CDPSession, Page } from 'playwright';

export interface Frame {
  file: string;
  /** ms since t0 */
  tMs: number;
}

export interface Capture {
  t0: number;
  /** Film another page from now on (a tab or popup the run moved to). */
  follow(page: Page): Promise<void>;
  stop(): Promise<Frame[]>;
}

/** CDP screencast → numbered JPEGs. Chrome only sends frames when something repaints. */
export async function startCapture(page: Page, dir: string, size: { width: number; height: number }): Promise<Capture> {
  const frames: Frame[] = [];
  const writes: Promise<void>[] = [];
  let n = 0;
  let stopped: Promise<Frame[]> | null = null;
  let cdp: CDPSession | null = null;
  const t0 = Date.now();

  const attach = async (p: Page) => {
    const session = await p.context().newCDPSession(p);
    session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      session.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
      const tMs = metadata.timestamp ? metadata.timestamp * 1000 - t0 : Date.now() - t0;
      const file = path.join(dir, `${String(++n).padStart(6, '0')}.jpg`);
      frames.push({ file, tMs: Math.max(0, tMs) });
      writes.push(writeFile(file, Buffer.from(data, 'base64')));
    });
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: size.width,
      maxHeight: size.height,
      everyNthFrame: 1,
    });
    cdp = session;
  };
  const detach = async () => {
    const session = cdp;
    cdp = null;
    if (!session) return;
    await session.send('Page.stopScreencast').catch(() => undefined);
    await session.detach().catch(() => undefined);
  };

  await attach(page);
  return {
    t0,
    async follow(next) {
      await detach();
      await attach(next);
    },
    stop() {
      stopped ??= (async () => {
        await detach();
        await Promise.all(writes);
        return frames.sort((a, b) => a.tMs - b.tMs);
      })();
      return stopped;
    },
  };
}
