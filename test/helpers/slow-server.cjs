// A server for the server tests: `node slow-server.cjs <port> [delayMs] [stubborn]`.
// Answers after delayMs; with "stubborn" it ignores SIGTERM, so only SIGKILL stops it.
const http = require('node:http');
const [port, delay = '0', mode] = process.argv.slice(2);
if (mode === 'stubborn') process.on('SIGTERM', () => undefined);
http.createServer((_req, res) => setTimeout(() => res.end('ok'), Number(delay))).listen(Number(port), '127.0.0.1');
