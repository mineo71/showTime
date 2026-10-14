// A minimal WebSocket server for tests (no dependencies): text and binary frames, close, no
// fragmentation or extensions.
import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

export interface WsConn {
  send(message: string | Buffer): void;
  close(code?: number): void;
  onMessage(fn: (message: string | Buffer) => void): void;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : null;
  if (!head) {
    const h = Buffer.alloc(10);
    h[0] = 0x80 | opcode;
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(len), 2);
    return Buffer.concat([h, payload]);
  }
  return Buffer.concat([head, payload]);
}

export function attachWs(server: Server, path: string, onConnection: (conn: WsConn, req: IncomingMessage) => void): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    if (!(req.url ?? '').startsWith(path)) return socket.destroy();
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const handlers: Array<(m: string | Buffer) => void> = [];
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 15;
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const masked = (buf[1] & 128) !== 0;
        if (buf.length < off + (masked ? 4 : 0) + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        off += masked ? 4 : 0;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buf = buf.subarray(off + len);
        if (opcode === 8) {
          socket.end(frame(8, payload.subarray(0, 2)));
          return;
        }
        if (opcode === 1) for (const h of handlers) h(payload.toString('utf8'));
        if (opcode === 2) for (const h of handlers) h(payload);
      }
    });
    socket.on('error', () => undefined);
    onConnection(
      {
        send: (m) => socket.write(frame(typeof m === 'string' ? 1 : 2, typeof m === 'string' ? Buffer.from(m) : m)),
        close: (code = 1000) => {
          const c = Buffer.alloc(2);
          c.writeUInt16BE(code);
          socket.end(frame(8, c));
        },
        onMessage: (fn) => handlers.push(fn),
      },
      req,
    );
  });
}
