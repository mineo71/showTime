// Pure parts of network record/replay: what gets stored, how answers are found, and when recorded
// WebSocket frames are sent back.

const SECRETS = new Set(['token', 'access_token', 'key', 'api_key', 'apikey', 'auth', 'sig', 'signature', 'secret', 'client_secret', 'password']);

/** The URL with credential-like query values replaced by "…": stored files never hold them. */
export function stripSecrets(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  let changed = false;
  for (const name of [...u.searchParams.keys()]) {
    if (SECRETS.has(name.toLowerCase())) {
      u.searchParams.set(name, '…');
      changed = true;
    }
  }
  return changed ? u.toString() : url;
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
  text?: string;
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

interface Item {
  frame?: WsFrame;
  close?: number;
  /** client frames recorded before it */
  count: number;
  /** when it followed a client text frame: that text and which occurrence of it */
  anchor: { text: string; occurrence: number } | null;
  /** ms after the client frame (or the open) it followed */
  delay: number;
  released: boolean;
  ready: boolean;
}

export interface WsIo {
  send(message: string | Uint8Array): void;
  close(code?: number): void;
  setTimer(ms: number, fn: () => void): void;
}

/**
 * Plays one recorded connection back to the page. A server frame goes out once the client has sent
 * as many messages as it had when the frame was recorded, after the same delay; one that followed a
 * client command (a text frame) waits for that command. A command also releases everything recorded
 * before it, so a client that sends fewer chunks than recorded still gets every answer. Frames keep
 * their order.
 */
export class WsReplay {
  private items: Item[] = [];
  private head = 0;
  private clientCount = 0;
  private seen = new Map<string, number>();
  /** recorded client frame index of each (text, occurrence) */
  private twins = new Map<string, number>();

  constructor(
    rec: WsRecording,
    private io: WsIo,
  ) {
    let count = 0;
    let lastT = 0;
    let anchor: Item['anchor'] = null;
    const occurrences = new Map<string, number>();
    for (const f of rec.frames) {
      if (f.from === 'client') {
        if (f.text !== undefined) {
          const n = (occurrences.get(f.text) ?? 0) + 1;
          occurrences.set(f.text, n);
          this.twins.set(`${f.text}\u0000${n}`, count);
          anchor = { text: f.text, occurrence: n };
        } else anchor = null;
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
  }

  client(message: string | Uint8Array): void {
    this.clientCount++;
    if (typeof message === 'string') {
      const n = (this.seen.get(message) ?? 0) + 1;
      this.seen.set(message, n);
      const twin = this.twins.get(`${message}\u0000${n}`);
      // A command releases its own answers and everything recorded before it.
      if (twin !== undefined) {
        this.release((it) => it.count <= twin + 1 && (it.anchor === null || it.count <= twin || (it.anchor.text === message && it.anchor.occurrence === n)));
        return;
      }
    }
    this.release((it) => it.anchor === null && it.count <= this.clientCount);
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
