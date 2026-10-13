import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSession, prepare, type Session } from '../../src/runner/browser';
import { EventLog } from '../../src/runner/events';
import { runStep, type StepContext } from '../../src/runner/steps';
import { parseScript, type Step } from '../../src/script/schema';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

const where = { sceneId: 'a', index: 0 };

/** Open the fixture with extra `app` fields and run steps in check mode. */
async function run(app: Record<string, unknown>, steps: Step[], after?: (ctx: StepContext, session: Session) => Promise<void>) {
  const script = parseScript({
    version: 1,
    app: { url: server.url, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...app },
    scenes: [{ id: 'a', steps: [{ do: 'pause', ms: 0 }] }],
  });
  const session = await openSession(script);
  try {
    const cursor = await prepare(session, script);
    const ctx: StepContext = { page: session.page, mode: 'check', log: new EventLog(), net: session.net, cursor, baseUrl: script.app.url };
    for (const step of steps) await runStep(ctx, step, where);
    await after?.(ctx, session);
  } finally {
    await session.close();
  }
}

describe('app.mock', () => {
  it('answers matching requests with the canned response', async () => {
    await run({ mock: [{ url: '**/api/stats', json: { visitors: 4242 }, delayMs: 200 }] }, [
      { do: 'click', target: '#load-stats' },
      { do: 'wait', for: 'text=Visitors 4242' },
    ]);
  });

  it('answers credentialed cross-origin requests', async () => {
    await run({ mock: [{ url: 'http://api.showtime.test/stats', json: { visitors: 7 } }] }, [
      { do: 'click', target: '#load-remote' },
      { do: 'wait', for: 'text=Remote 7' },
    ]);
  });

  it('lets the first matching mock win', async () => {
    await run({ mock: [{ url: '**/api/stats', json: { visitors: 1 } }, { url: '**/api/*', json: { visitors: 2 } }] }, [
      { do: 'click', target: '#load-stats' },
      { do: 'wait', for: 'text=Visitors 1' },
    ]);
  });

  it('leaves other methods to the network', async () => {
    await run({ mock: [{ url: '**/api/stats', method: 'DELETE', json: { visitors: 1 } }] }, [
      { do: 'click', target: '#load-stats' },
      { do: 'wait', for: 'text=Stats failed' },
    ]);
  });
});

describe('app.clock', () => {
  it('starts the page clock at the given time', async () => {
    await run({ clock: '2030-01-02T10:00:00Z' }, [{ do: 'wait', for: 'text=Today 2030-01-02' }]);
  });

  it('keeps time moving, so Date-based debounce still fires', async () => {
    await run({ clock: '2030-01-02T10:00:00Z' }, [
      { do: 'type', target: '#search', text: 'abc', pace: 'fast', clear: false },
      { do: 'wait', for: 'text=Results for abc' },
    ]);
  });
});

describe('app.dialogs', () => {
  it('accepts confirm dialogs by default', async () => {
    await run({}, [{ do: 'click', target: '#danger' }, { do: 'wait', for: 'text=Deleted' }]);
  });

  it('dismisses them when asked', async () => {
    await run({ dialogs: 'dismiss' }, [{ do: 'click', target: '#danger' }, { do: 'wait', for: 'text=Kept' }]);
  });
});

describe('goto', () => {
  it('resolves a relative URL against app.url', async () => {
    await run({}, [{ do: 'goto', url: '?tab=2' }], async (_ctx, session) => {
      expect(session.page.url()).toBe(`${server.url}?tab=2`);
    });
  });
});

describe('settling', () => {
  it('does not wait for a live event stream to go quiet', async () => {
    await run({}, [{ do: 'click', target: '#live' }, { do: 'wait', for: 'text=/Live \\d+/' }, { do: 'click', target: '#export' }], async (ctx) => {
      const last = ctx.log.steps.at(-1)!;
      expect(last.settledMs - last.endMs).toBeLessThan(1500);
    });
  });
});
