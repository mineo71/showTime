// Pure parts of network record/replay: what gets stored, how answers are found, and when recorded
// WebSocket frames are sent back.
import { createHash } from 'node:crypto';

/** Words that make a query parameter a credential, wherever they sit in its name (X-Amz-Signature, xi_api_key, accessToken). */
const SECRET_WORDS = new Set(['token', 'key', 'apikey', 'auth', 'authorization', 'sig', 'signature', 'secret', 'password', 'passwd', 'pass', 'credential', 'credentials', 'jwt', 'session']);

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const isSecret = (name: string) => words(name).some((w) => SECRET_WORDS.has(w));

/** The URL with credential-like query values replaced by "…" and no user:password: stored files never hold them. */
export function stripSecrets(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  let changed = false;
  if (u.username || u.password) {
    u.username = '';
    u.password = '';
    changed = true;
  }
  for (const name of [...u.searchParams.keys()]) {
    if (isSecret(name)) {
      u.searchParams.set(name, '…');
      changed = true;
    }
  }
  return changed ? u.toString() : url;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * How a client text frame is stored: a hash (it may carry a key, as some APIs take one in the first
 * message) and its shape, a JSON object's sorted keys, so a command whose values change between runs
 * (a fresh context id) still finds its twin.
 */
export function clientText(text: string): { hash: string; shape: string } {
  let shape = `=${sha(text)}`;
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) shape = `{${Object.keys(v).sort().join(',')}}`;
  } catch {
    // not JSON: only the same text matches
  }
  return { hash: sha(text), shape };
}

export interface HttpEntry {
  method: string;
  /** with secrets stripped */
  url: string;
  /** hash of the request body */
  body: string;
  status: number;
  /** response content type */
  type: string;
  /** response body, base64 */
  data: string;
  /** recorded latency */
  ms: number;
}

/** Recorded answers, handed out in order: exact matches first, then by URL, then the last one re-served. */
export class HttpStore {
  private used: boolean[];

  constructor(readonly entries: HttpEntry[]) {
    this.used = entries.map(() => false);
  }

  take(method: string, url: string, bodyHash: string): HttpEntry | null {
    const key = stripSecrets(url);
    const same = (e: HttpEntry) => e.method === method && e.url === key;
    const pick = (test: (e: HttpEntry, i: number) => boolean) => {
      const i = this.entries.findIndex(test);
      if (i < 0) return null;
      this.used[i] = true;
      return this.entries[i];
    };
    return (
      pick((e, i) => !this.used[i] && same(e) && e.body === bodyHash) ??
      pick((e, i) => !this.used[i] && same(e)) ??
      // Nothing unused left: the last answer to the same request again, else the last for the URL.
      [...this.entries].reverse().find((e) => same(e) && e.body === bodyHash) ??
      [...this.entries].reverse().find(same) ??
      null
    );
  }
}

export interface WsFrame {
  from: 'client' | 'server';
  /** ms since the connection opened */
  t: number;
  /** server text frames (and hand-written client ones) */
  text?: string;
  /** client text frames: `clientText` */
  hash?: string;
  shape?: string;
  /** client binary frames: their size only */
  size?: number;
  /** server binary frames: base64 */
  data?: string;
}

export interface WsRecording {
  /** with secrets stripped */
  url: string;
  frames: WsFrame[];
  close?: { by: 'client' | 'server'; t: number; code?: number };
}

/** A recorded client text frame (a command): the answers that followed it wait for its twin. */
interface Command {
  hash: string;
  shape: string;
  /** client frames recorded before it */
  count: number;
  used: boolean;
}

interface Item {
  frame?: WsFrame;
  close?: number;
  /** client frames recorded before it */
  count: number;
  /** the command it followed, if it followed one */
  anchor: Command | null;
  /** ms after the client frame (or the open) it followed */
  delay: number;
  released: boolean;
  ready: boolean;
}

/** How long the client must be quiet before the answers to chunks it never sent go out. */
export const QUIET_MS = 1000;

export interface WsIo {
  send(message: string | Uint8Array): void;
  close(code?: number): void;
  setTimer(ms: number, fn: () => void): void;
}

/**
 * Plays one recorded connection back to the page. A server frame goes out once the client has sent
 * as many messages as it had when the frame was recorded, after the same delay; one that followed a
 * client command (a text frame) waits for that command, matched by its text, else by its shape. A
 * command also releases everything recorded before it, and when the client goes quiet everything up
 * to the next command goes out, so a client that sends fewer chunks than recorded still gets every
 * answer. Frames keep their order.
 */
export class WsReplay {
  private items: Item[] = [];
  private commands: Command[] = [];
  private head = 0;
  private clientCount = 0;
  /** bumped by every client message: a quiet timer from before it is stale */
  private generation = 0;
  /** client text frames that matched no recorded command */
  misses = 0;

  constructor(
    rec: WsRecording,
    private io: WsIo,
  ) {
    let count = 0;
    let lastT = 0;
    let anchor: Command | null = null;
    for (const f of rec.frames) {
      if (f.from === 'client') {
        const stored = f.hash && f.shape ? { hash: f.hash, shape: f.shape } : f.text !== undefined ? clientText(f.text) : null;
        anchor = stored ? { ...stored, count, used: false } : null;
        if (anchor) this.commands.push(anchor);
        count++;
        lastT = f.t;
        continue;
      }
      this.items.push({ frame: f, count, anchor, delay: Math.max(0, f.t - lastT), released: false, ready: false });
    }
    if (rec.close?.by === 'server') {
      this.items.push({ close: rec.close.code ?? 1000, count, anchor, delay: Math.max(0, rec.close.t - lastT), released: false, ready: false });
    }
  }

  open(): void {
    this.release((it) => it.count === 0 && it.anchor === null);
    this.waitQuiet();
  }

  client(message: string | Uint8Array): void {
    this.clientCount++;
    this.waitQuiet();
    if (typeof message === 'string') {
      const { hash, shape } = clientText(message);
      const twin = this.commands.find((c) => !c.used && c.hash === hash) ?? this.commands.find((c) => !c.used && c.shape === shape);
      if (twin) {
        twin.used = true;
        // A command releases its own answers and everything recorded before it.
        this.release((it) => it.count <= twin.count + 1 && (it.anchor === null || it.anchor === twin || it.anchor.used));
        return;
      }
      this.misses++;
    }
    this.release((it) => it.anchor === null && it.count <= this.clientCount);
  }

  /** Once the client has been quiet for QUIET_MS, send everything up to the next command's answers. */
  private waitQuiet(): void {
    const generation = ++this.generation;
    this.io.setTimer(QUIET_MS, () => {
      if (generation !== this.generation) return;
      const next = this.items.findIndex((it) => !it.released && it.anchor !== null && !it.anchor.used);
      const upTo = next < 0 ? this.items.length : next;
      this.release((it) => this.items.indexOf(it) < upTo && (it.anchor === null || it.anchor.used));
    });
  }

  private release(test: (it: Item) => boolean): void {
    for (const it of this.items) {
      if (it.released || !test(it)) continue;
      it.released = true;
      this.io.setTimer(it.delay, () => {
        it.ready = true;
        this.flush();
      });
    }
  }

  private flush(): void {
    while (this.head < this.items.length && this.items[this.head].ready) {
      const it = this.items[this.head++];
      if (it.close !== undefined) this.io.close(it.close);
      else if (it.frame?.text !== undefined) this.io.send(it.frame.text);
      else if (it.frame?.data !== undefined) this.io.send(Uint8Array.from(Buffer.from(it.frame.data, 'base64')));
    }
  }
}
