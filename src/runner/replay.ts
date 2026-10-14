// Network record and replay (script.replay): Playwright routes that store the answers of matching
// requests and WebSockets, or serve them back from the file.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Request, Route, WebSocketRoute } from 'playwright';
import type { Script } from '../script/schema';
import { clientText, HttpStore, stripSecrets, WsReplay, type HttpEntry, type WsRecording } from './replay-core';
import { sleep } from './time';

export type NetMode = 'auto' | 'live' | 'record' | 'replay';

export interface NetReport {
  mode: 'record' | 'replay';
  file: string;
  /** requests the file did not hold, sent to the network instead */
  misses: number;
}

export interface NetSession {
  report(): NetReport;
  /** Write what was recorded (record mode only); call once the run has succeeded. */
  save(): Promise<void>;
  /** Stop pending WebSocket timers. */
  dispose(): void;
}

interface NetFile {
  version: 1;
  http: HttpEntry[];
  ws: WsRecording[];
}

const isWs = (glob: string) => /^wss?:\/\//i.test(glob);
/** Event streams never end: waiting for their whole body would stall them, so they stay live. */
const isStream = (request: Request) => request.resourceType() === 'eventsource' || (request.headers().accept ?? '').includes('text/event-stream');
const bodyHash = (body: Buffer | null) => (body?.length ? createHash('sha256').update(body).digest('hex').slice(0, 16) : '');
const withoutQuery = (url: string) => url.split('?')[0];
/** WebSocket close codes a page may be sent; the reserved ones (1005, 1006…) become a normal close. */
const closeCode = (code: number | undefined) => (code === 1000 || (code !== undefined && code >= 3000 && code <= 4999) ? code : 1000);

/** Which mode a run uses, checked before the browser starts. */
export function netMode(script: Script, mode: NetMode = 'auto'): 'live' | 'record' | 'replay' {
  if (mode === 'live') return 'live';
  if (!script.replay) {
    if (mode === 'auto') return 'live';
    throw new Error(`--net ${mode}: the script has no "replay" section; add "replay": { "file": "…", "match": ["**/api/**"] }`);
  }
  if (mode === 'record') return 'record';
  if (existsSync(script.replay.file)) return 'replay';
  if (mode === 'replay') {
    throw new Error(`--net replay: no recorded traffic at ${script.replay.file}; run once with --net record (or the default auto) first`);
  }
  return 'record';
}

/** Route the script's replay globs in `context`. Call before the mocks are routed, so mocks win. */
export async function attachNet(context: BrowserContext, script: Script, mode: NetMode = 'auto'): Promise<NetSession | null> {
  const chosen = netMode(script, mode);
  if (chosen === 'live' || !script.replay) return null;
  const { file, match } = script.replay;
  const timers = new Set<NodeJS.Timeout>();
  const players: WsReplay[] = [];
  let misses = 0;
  const report = (): NetReport => ({ mode: chosen, file, misses: misses + players.reduce((n, p) => n + p.misses, 0) });
  const dispose = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  if (chosen === 'replay') {
    let saved: NetFile;
    try {
      saved = JSON.parse(await readFile(file, 'utf8')) as NetFile;
      if (!Array.isArray(saved.http) || !Array.isArray(saved.ws)) throw new Error('missing "http" or "ws"');
    } catch (err) {
      throw new Error(`Cannot read the recorded traffic ${file}: ${(err as Error).message}. Re-record it with --net record.`);
    }
    const store = new HttpStore(saved.http);
    const queues = new Map<string, WsRecording[]>();
    for (const rec of saved.ws) queues.set(withoutQuery(rec.url), [...(queues.get(withoutQuery(rec.url)) ?? []), rec]);
    for (const glob of match) {
      if (isWs(glob)) {
        await context.routeWebSocket(glob, (ws) => {
          const rec = queues.get(withoutQuery(stripSecrets(ws.url())))?.shift();
          if (!rec) {
            misses++;
            ws.connectToServer();
            return;
          }
          players.push(playBack(ws, rec, timers));
        });
      } else {
        await context.route(glob, async (route) => {
          const request = route.request();
          if (isStream(request)) return route.fallback();
          const entry = store.take(request.method(), request.url(), bodyHash(request.postDataBuffer()));
          if (!entry) {
            misses++;
            return route.fallback();
          }
          await serve(route, entry);
        });
      }
    }
    return { report, save: async () => undefined, dispose };
  }

  // Record: entries keep the order requests were made in, filled in as their answers arrive.
  const http: Array<HttpEntry | null> = [];
  const ws: WsRecording[] = [];
  for (const glob of match) {
    if (isWs(glob)) await context.routeWebSocket(glob, (route) => ws.push(tap(route)));
    else {
      await context.route(glob, async (route) => {
        const request = route.request();
        if (isStream(request)) return route.fallback();
        const slot = http.push(null) - 1;
        const t0 = Date.now();
        const response = await route.fetch().catch(() => null);
        if (!response) return route.abort().catch(() => undefined);
        const body = await response.body().catch(() => Buffer.alloc(0));
        http[slot] = {
          method: request.method(),
          url: stripSecrets(request.url()),
          body: bodyHash(request.postDataBuffer()),
          status: response.status(),
          type: response.headers()['content-type'] ?? '',
          data: body.toString('base64'),
          ms: Date.now() - t0,
        };
        await route.fulfill({ response, body }).catch(() => undefined);
      });
    }
  }
  return {
    report,
    dispose,
    async save() {
      const data: NetFile = { version: 1, http: http.filter((e): e is HttpEntry => e !== null), ws };
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 1)}\n`);
      await rename(tmp, file);
    },
  };
}

/** Answer from a recorded entry after its recorded latency; cross-origin answers echo the origin. */
async function serve(route: Route, entry: HttpEntry): Promise<void> {
  const origin = route.request().headers().origin;
  const cors: Record<string, string> = origin
    ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
    : {};
  await sleep(entry.ms);
  await route
    .fulfill({ status: entry.status, headers: { ...cors, ...(entry.type ? { 'content-type': entry.type } : {}) }, body: Buffer.from(entry.data, 'base64') })
    .catch(() => undefined);
}

/** Pass a WebSocket through to its server and keep every frame. */
function tap(route: WebSocketRoute): WsRecording {
  const server = route.connectToServer();
  const t0 = Date.now();
  const rec: WsRecording = { url: stripSecrets(route.url()), frames: [] };
  const t = () => Date.now() - t0;
  route.onMessage((m) => {
    // Client text is kept as a hash and a shape: some APIs take the key in a message.
    rec.frames.push(typeof m === 'string' ? { from: 'client', t: t(), ...clientText(m) } : { from: 'client', t: t(), size: m.length });
    server.send(m);
  });
  server.onMessage((m) => {
    rec.frames.push(typeof m === 'string' ? { from: 'server', t: t(), text: m } : { from: 'server', t: t(), data: m.toString('base64') });
    route.send(m);
  });
  route.onClose((code, reason) => {
    rec.close ??= { by: 'client', t: t(), code };
    server.close({ code: closeCode(code), reason }).catch(() => undefined);
  });
  server.onClose((code, reason) => {
    rec.close ??= { by: 'server', t: t(), code };
    route.close({ code: closeCode(code), reason }).catch(() => undefined);
  });
  return rec;
}

/** Act as the server of a recorded connection. */
function playBack(route: WebSocketRoute, rec: WsRecording, timers: Set<NodeJS.Timeout>): WsReplay {
  let closed = false;
  const player = new WsReplay(rec, {
    send: (m) => {
      if (!closed) route.send(typeof m === 'string' ? m : Buffer.from(m));
    },
    close: (code) => {
      closed = true;
      route.close({ code: closeCode(code) }).catch(() => undefined);
    },
    setTimer: (ms, fn) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    },
  });
  route.onMessage((m) => player.client(typeof m === 'string' ? m : new Uint8Array(m)));
  // A close handler stops Playwright's own handling: the page's close must be answered here, or the
  // socket stays CLOSING and the page never hears it closed.
  route.onClose((code, reason) => {
    if (closed) return;
    closed = true;
    route.close({ code: closeCode(code), reason }).catch(() => undefined);
  });
  player.open();
  return player;
}
