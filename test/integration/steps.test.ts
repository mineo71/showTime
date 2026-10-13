import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSession, prepare } from '../../src/runner/browser';
import { EventLog } from '../../src/runner/events';
import { runStep, type StepContext } from '../../src/runner/steps';
import { parseScript } from '../../src/script/schema';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('runStep (record mode)', () => {
  it('scrolls a target clipped by an inner scroll container before measuring it', async () => {
    const script = parseScript({
      version: 1,
      app: { url: server.url, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
      scenes: [{ id: 'a', steps: [{ do: 'pause', ms: 0 }] }],
    });
    const session = await openSession(script);
    try {
      const cursor = await prepare(session, script);
      // an item inside the browser window but hidden below the list's visible area
      const id = await session.page.evaluate(() => {
        const list = document.querySelector('#side')!.getBoundingClientRect();
        const hidden = Array.from(document.querySelectorAll('#side button')).find((b) => {
          const r = b.getBoundingClientRect();
          return r.top >= list.bottom && r.bottom <= window.innerHeight;
        });
        return hidden ? hidden.id : null;
      });
      expect(id).not.toBeNull();

      const log = new EventLog();
      const ctx: StepContext = { page: session.page, mode: 'record', log, net: session.net, cursor };
      await runStep(ctx, { do: 'click', target: `#${id}` }, { sceneId: 'a', index: 0 });

      const actual = (await session.page.locator(`#${id}`).boundingBox())!;
      expect(Math.abs(log.steps[0].target!.y - actual.y)).toBeLessThan(2);
      expect(log.clicks[0].y).toBeGreaterThanOrEqual(actual.y);
      expect(log.clicks[0].y).toBeLessThanOrEqual(actual.y + actual.height);
    } finally {
      await session.close();
    }
  });
});
