import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachWs } from './ws';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

export interface Served {
  url: string;
  /** API and WebSocket messages answered (the replay tests check nothing reached the network) */
  hits(): number;
  close(): Promise<void>;
}

export async function serveDir(dir: string, port = 0): Promise<Served> {
  // A counter that changes with every call: replayed answers must not.
  let counter = 0;
  let hits = 0;
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (rel === '/api/count') {
      hits++;
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ n: ++counter }));
    }
    if (rel === '/api/echo' && req.method === 'POST') {
      hits++;
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ got: JSON.parse(body || '{}'), n: ++counter })));
      return;
    }
    if (rel === '/sse') {
      // A never-ending event stream, like a live dashboard.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      let n = 0;
      const timer = setInterval(() => res.write(`data: ${++n}\n\n`), 200);
      req.on('close', () => clearInterval(timer));
      return;
    }
    let file = path.join(dir, path.normalize(rel));
    if (!file.startsWith(dir)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  // A speech-to-text-like socket: an answer per audio chunk, a final one on "finalize".
  attachWs(server, '/ws', (conn) => {
    conn.onMessage((m) => {
      hits++;
      if (typeof m === 'string') conn.send(m === 'finalize' ? `final #${++counter}` : `echo ${m}`);
      else conn.send(`heard ${m.length} #${++counter}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}/`,
    hits: () => hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections(); // open event streams would keep close() waiting
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await serveDir(path.join(FIXTURES, 'demo-app'), 4777);
  process.stdout.write(`Fixture app on ${url} (Ctrl+C to stop)\n`);
}
