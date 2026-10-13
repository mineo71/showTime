#!/usr/bin/env node
// Tiny static server for the examples: `node scripts/serve.mjs [dir] [port]`.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const dir = path.resolve(process.argv[2] ?? 'examples');
const port = Number(process.argv[3] ?? 4800);

createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(dir, path.normalize(rel));
  if (!file.startsWith(dir)) return void res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) return void res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Serving ${path.relative(process.cwd(), dir) || '.'} on http://127.0.0.1:${port}/ (Ctrl+C to stop)\n`);
});
