import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { pipeline } from 'node:stream';
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { mixSoundtrack } from '../audio/soundtrack';
import { aspectOf, formatOf } from '../convert';
import { workPaths } from '../paths';
import { renderDemo, timelineFor } from '../pipeline';
import { record } from '../runner/record';
import { describeStep } from '../runner/steps';
import { CONFIG_FILE } from '../script/config';
import { parseLoaded, pickLocale, type LoadedScript } from '../script/load';
import { loadTake } from '../take';
import { stepFrames } from '../timeline/frames';
import { stepKey } from '../timeline/narration';
import type { Audio, Style } from '../script/schema';
import type { Aspect, Timeline } from '../timeline/types';
import { bundleClient } from './bundle';
import { STYLES } from './client/styles';
import { applyEdit, formatScript, parseEdit, StaleStepError, stepId } from './edit';
import { filePath, hostAllowed, originAllowed, tokenOk } from './guard';

type Json = Record<string, unknown>;

export interface StudioOptions {
  port?: number;
  aspect?: Aspect;
  /** one of the script's locales (default: the first) */
  locale?: string;
  log?: (line: string) => void;
}

export interface Studio {
  url: string;
  token: string;
  close(): Promise<void>;
}

export interface StepInfo {
  where: string;
  /** what the step does (`stepId`): edits carry it, so they never land on a step that moved */
  id: string;
  do: string;
  label: string;
  show: Json;
  /** composition frames, when there is a take */
  startFrame: number | null;
  endFrame: number | null;
  /** source ms from the step's start to its settled end (what `show.speed` applies to), when there is a take */
  srcMs: number | null;
  /** output ms of narration holds inside it (its freeze not counted) */
  narrationMs: number;
}

export interface Job {
  kind: 'render' | 'record';
  status: 'running' | 'done' | 'failed';
  progress: number;
  lines: string[];
  /** the rendered file */
  result: string | null;
  error: string | null;
}

export interface StudioState {
  name: string;
  file: string;
  aspect: Aspect;
  take: 'ok' | 'missing' | 'stale';
  /** why the script or the preview could not be built; the last good preview stays */
  error: string | null;
  script: Json | null;
  /** the script's look with brand-file defaults, whatever the state of the take */
  style: Style | null;
  /** audio.sounds as resolved (brand file applied) */
  sounds: Audio['sounds'] | null;
  /** the intro card's text in the open locale */
  meta: { title?: string; subtitle?: string } | null;
  steps: StepInfo[];
  timeline: Timeline | null;
  job: Job | null;
  version: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};
const MAX_BODY = 1_000_000;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Write through a temp file and a rename, so readers never see half a script. */
async function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

function page(name: string, token: string): string {
  const safe = name.replace(/[<>&"]/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safe} · showTime studio</title>
<style>${STYLES}</style>
</head>
<body>
<div id="root"></div>
<script>window.__SHOWTIME__ = ${JSON.stringify({ token, name: safe })};</script>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'The request body is not JSON.');
  }
}

/** Serve a file, honouring a single `Range: bytes=a-b` so video can seek. */
async function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  // Open before answering, so a file that can't be read gets an error status, not a cut-off body.
  const fh = await open(file, 'r').catch(() => null);
  if (!fh) throw new HttpError(404, 'Not found.');
  const info = await fh.stat().catch(() => null);
  if (!info?.isFile()) {
    await fh.close();
    throw new HttpError(404, 'Not found.');
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, info.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      await fh.close();
      res.writeHead(416, { 'content-range': `bytes */${info.size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
    stream(fh.createReadStream({ start, end }), res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  stream(fh.createReadStream(), res);
}

/** Pipe a file, closing both ends on an error or an aborted request (a seeking video aborts a lot). */
function stream(from: NodeJS.ReadableStream, res: ServerResponse) {
  pipeline(from, res, (err) => {
    if (err) res.destroy();
  });
}

/**
 * The studio: a local server for one script. It rebuilds the preview whenever the script (or its
 * brand file) changes on disk, applies edits from the page, and runs renders and takes.
 */
export async function startStudio(scriptFile: string, opts: StudioOptions = {}): Promise<Studio> {
  const file = path.resolve(scriptFile);
  const dir = path.dirname(file);
  // The locale is settled once: its take and outputs are the ones this studio works on.
  let first: unknown = null;
  try {
    first = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // an unreadable script is reported in the page
  }
  const locale = first === null ? opts.locale : (pickLocale(first, file, opts.locale).locale ?? undefined);
  const base = path.basename(file).replace(/\.json$/i, '');
  const name = locale ? `${base}.${locale}` : base;
  const root = path.join(dir, '.showtime', name);
  const token = randomBytes(18).toString('base64url');
  const client = await bundleClient();
  const state: StudioState = {
    name,
    file,
    aspect: opts.aspect ?? '16:9',
    take: 'missing',
    error: null,
    script: null,
    style: null,
    sounds: null,
    meta: null,
    steps: [],
    timeline: null,
    job: null,
    version: 0,
  };
  let loaded: LoadedScript | null = null;
  let lastText: string | null = null;
  const streams = new Set<ServerResponse>();

  const send = (event: string, data: unknown) => {
    for (const res of streams) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const changed = () => {
    state.version++;
    send('state', { version: state.version });
  };

  // Rebuilds and edits run one at a time, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };

  const rawStep = (raw: Json, sceneIndex: number, index: number): unknown => {
    const scenes = raw.scenes as Array<{ steps?: unknown[] }> | undefined;
    return scenes?.[sceneIndex]?.steps?.[index];
  };
  const stepsOf = (l: LoadedScript, raw: Json): StepInfo[] =>
    l.script.scenes.flatMap((scene, sceneIndex) =>
      scene.steps.map((step, index) => ({
        where: stepKey(scene.id, index),
        id: stepId(rawStep(raw, sceneIndex, index)),
        do: step.do,
        label: describeStep(step),
        show: (step.show ?? {}) as Json,
        startFrame: null,
        endFrame: null,
        srcMs: null,
        narrationMs: 0,
      })),
    );

  async function rebuild(): Promise<void> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      lastText = null;
      state.error = `Cannot read ${file}.`;
      return changed();
    }
    lastText = text;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      state.error = `Invalid JSON in ${file}: ${message(err)}`;
      return changed();
    }
    try {
      loaded = await parseLoaded(raw, file, { locale });
    } catch (err) {
      state.error = message(err);
      return changed();
    }
    state.script = raw as Json;
    state.style = loaded.script.style;
    state.meta = { title: loaded.script.meta.title, subtitle: loaded.script.meta.subtitle };
    state.sounds = loaded.script.audio.sounds;
    state.error = null;
    state.steps = stepsOf(loaded, raw as Json);
    let steps;
    try {
      steps = (await loadTake(loaded)).steps;
    } catch (err) {
      // A stale take keeps the last good preview; a missing one has none.
      state.take = /Actions changed/.test(message(err)) ? 'stale' : 'missing';
      if (state.take === 'missing') state.timeline = null;
      return changed();
    }
    state.take = 'ok';
    try {
      const { timeline, clips } = await timelineFor(loaded, { aspect: state.aspect, log: opts.log });
      // The preview has its own mix: a render running meanwhile writes mix.wav.
      const src = await mixSoundtrack(loaded, timeline, clips, workPaths(loaded).preview);
      // A fresh query string, so the page doesn't play a cached mix.
      if (src) timeline.audio = { src: `${src}?v=${state.version + 1}` };
      const frames = new Map(stepFrames(timeline, steps).map((f) => [f.where, f]));
      const holds = timeline.segments.filter((g) => g.speed === 0);
      const freezeOf = new Map(state.steps.map((s) => [s.where, typeof s.show.freezeMs === 'number' ? s.show.freezeMs : 0]));
      const spans = new Map(
        steps.map((e) => {
          const where = stepKey(e.sceneId, e.index);
          // A freeze and a narration hold at one point merge: the narration part is what's left.
          const held = holds.filter((h) => h.srcStartMs >= e.startMs && h.srcStartMs < e.settledMs).reduce((n, h) => n + (h.holdMs ?? 0), 0);
          return [where, { srcMs: e.settledMs - e.startMs, narrationMs: Math.max(0, held - (freezeOf.get(where) ?? 0)) }];
        }),
      );
      state.steps = state.steps.map((s) => ({
        ...s,
        startFrame: frames.get(s.where)?.startFrame ?? null,
        endFrame: frames.get(s.where)?.endFrame ?? null,
        srcMs: spans.get(s.where)?.srcMs ?? null,
        narrationMs: spans.get(s.where)?.narrationMs ?? 0,
      }));
      state.timeline = timeline;
    } catch (err) {
      state.error = message(err);
    }
    changed();
  }

  async function edit(body: unknown): Promise<StudioState> {
    let change;
    try {
      change = parseEdit(body);
    } catch (err) {
      throw new HttpError(400, message(err));
    }
    await enqueue(async () => {
      let raw: Json;
      try {
        raw = JSON.parse(await readFile(file, 'utf8')) as Json;
      } catch {
        throw new HttpError(409, `${file} is not valid JSON right now; fix it, then edit again.`);
      }
      let next: Json;
      try {
        next = applyEdit(raw, change, locale);
        await parseLoaded(next, file, { locale });
      } catch (err) {
        throw new HttpError(err instanceof StaleStepError ? 409 : 400, message(err));
      }
      await writeAtomic(file, formatScript(next));
      await rebuild();
    });
    return state;
  }

  const pushJob = () => send('job', state.job);
  function startJob(kind: Job['kind'], work: (job: Job) => Promise<string | null>) {
    if (state.job?.status === 'running') throw new HttpError(409, `A ${state.job.kind} is already running.`);
    if (!loaded) throw new HttpError(409, state.error ?? 'The script is not loaded yet.');
    const job: Job = { kind, status: 'running', progress: 0, lines: [], result: null, error: null };
    state.job = job;
    pushJob();
    work(job).then(
      (result) => {
        job.status = 'done';
        job.result = result;
        pushJob();
      },
      (err) => {
        job.status = 'failed';
        job.error = message(err);
        pushJob();
      },
    );
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, route: string) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data));
    };
    if (req.method === 'GET' && route === '/api/state') return json(200, state);
    if (req.method === 'GET' && route === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ version: state.version })}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (req.method !== 'POST') throw new HttpError(404, 'Not found.');
    const body = await readBody(req);
    if (route === '/api/edit') return json(200, await edit(body));
    if (route === '/api/aspect') {
      let aspect: Aspect;
      try {
        aspect = aspectOf(String((body as Json).aspect));
      } catch (err) {
        throw new HttpError(400, message(err));
      }
      state.aspect = aspect;
      await enqueue(rebuild);
      return json(200, state);
    }
    if (route === '/api/render') {
      let format;
      try {
        format = formatOf(undefined, String((body as Json).format ?? 'mp4'));
      } catch (err) {
        throw new HttpError(400, message(err));
      }
      startJob('render', async (job) => {
        const { video } = await renderDemo(loaded!, {
          aspect: state.aspect,
          format,
          onProgress: (p) => {
            if (p - job.progress >= 0.02 || p === 1) {
              job.progress = p;
              pushJob();
            }
          },
        });
        return video;
      });
      return json(202, state.job);
    }
    if (route === '/api/record') {
      startJob('record', async (job) => {
        await record(loaded!, {
          log: (line) => {
            job.lines.push(line);
            pushJob();
          },
        });
        await enqueue(rebuild);
        return null;
      });
      return json(202, state.job);
    }
    throw new HttpError(404, 'Not found.');
  }

  let port = opts.port ?? 4848;
  const server = createServer((req, res) => {
    const route = new URL(req.url ?? '/', 'http://studio').pathname;
    (async () => {
      if (!hostAllowed(req.headers.host, port)) throw new HttpError(403, 'Forbidden.');
      if (route === '/' || route === '/index.html') {
        // Never inside another site's frame: it could click Record, which runs the script's hooks.
        res
          .writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-options': 'DENY',
            'content-security-policy': "frame-ancestors 'none'",
          })
          .end(page(name, token));
        return;
      }
      if (route === '/app.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(client);
        return;
      }
      if (route.startsWith('/files/')) {
        const target = filePath(root, req.url ?? '');
        if (!target) throw new HttpError(404, 'Not found.');
        return sendFile(req, res, target);
      }
      if (route.startsWith('/api/')) {
        if (!originAllowed(req.headers.origin, port) || !tokenOk(req.headers, req.url ?? '', token)) throw new HttpError(403, 'Forbidden.');
        return handleApi(req, res, route);
      }
      throw new HttpError(404, 'Not found.');
    })().catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message(err) }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use. Pass --port <n> to pick another.`) : err),
    );
    server.listen(port, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  await enqueue(rebuild);

  // Watch folders, not files: editors and the studio itself save by replacing the file.
  const watched = [file, loaded ? (loaded as LoadedScript).config : null].filter((f): f is string => !!f);
  let timer: NodeJS.Timeout | undefined;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      enqueue(async () => {
        const text = await readFile(file, 'utf8').catch(() => null);
        if (text !== lastText || configTouched) await rebuild();
        configTouched = false;
      }).catch(() => undefined);
    }, 150);
  };
  let configTouched = false;
  const watchers: FSWatcher[] = [...new Set(watched.map((f) => path.dirname(f)))].map((d) =>
    watch(d, (_event, changedName) => {
      if (!changedName) return;
      const full = path.join(d, changedName.toString());
      if (full === file) onChange();
      else if (path.basename(full) === CONFIG_FILE && watched.includes(full)) {
        configTouched = true;
        onChange();
      }
    }),
  );
  const keepAlive = setInterval(() => {
    for (const res of streams) res.write(': keep-alive\n\n');
  }, 15_000);

  return {
    url: `http://127.0.0.1:${port}/`,
    token,
    async close() {
      clearInterval(keepAlive);
      clearTimeout(timer);
      for (const w of watchers) w.close();
      for (const res of streams) res.end();
      streams.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
