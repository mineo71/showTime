import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

export interface Frame {
  file: string;
  /** ms since t0 */
  tMs: number;
}

export interface Capture {
  t0: number;
  stop(): Promise<Frame[]>;
}

/** CDP screencast → numbered JPEGs. Chrome only sends frames when something repaints. */
export async function startCapture(page: Page, dir: string, size: { width: number; height: number }): Promise<Capture> {
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const writes: Promise<void>[] = [];
  let n = 0;
  let stopped: Promise<Frame[]> | null = null;
  const t0 = Date.now();

  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    const tMs = metadata.timestamp ? metadata.timestamp * 1000 - t0 : Date.now() - t0;
    const file = path.join(dir, `${String(++n).padStart(6, '0')}.jpg`);
    frames.push({ file, tMs: Math.max(0, tMs) });
    writes.push(writeFile(file, Buffer.from(data, 'base64')));
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: size.width,
    maxHeight: size.height,
    everyNthFrame: 1,
  });

  return {
    t0,
    stop() {
      stopped ??= (async () => {
        await cdp.send('Page.stopScreencast').catch(() => undefined);
        await Promise.all(writes);
        await cdp.detach().catch(() => undefined);
        return frames.sort((a, b) => a.tMs - b.tMs);
      })();
      return stopped;
    },
  };
}
