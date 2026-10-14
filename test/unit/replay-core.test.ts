import { describe, expect, it } from 'vitest';
import { HttpStore, stripSecrets, WsReplay, type WsRecording } from '../../src/runner/replay-core';

describe('stripSecrets', () => {
  it('hides credential-like query values and keeps the rest', () => {
    expect(stripSecrets('wss://api.x/ws?access_token=abc&language=en')).toBe('wss://api.x/ws?access_token=%E2%80%A6&language=en');
    expect(stripSecrets('https://x/api?q=1&API_KEY=z&sig=y')).toBe('https://x/api?q=1&API_KEY=%E2%80%A6&sig=%E2%80%A6');
    expect(stripSecrets('https://x/plain')).toBe('https://x/plain');
  });
});

describe('HttpStore', () => {
  const entry = (n: number, body = 'b1', status = 200) => ({ method: 'POST', url: 'https://x/api/extract', body, status, type: 'application/json', data: Buffer.from(`{"n":${n}}`).toString('base64'), ms: 10 });

  it('serves exact matches in recorded order, then same-URL entries, then re-serves the last', () => {
    const store = new HttpStore([entry(1, 'b1', 429), entry(2, 'b1'), entry(3, 'b2')]);
    expect(store.take('POST', 'https://x/api/extract', 'b2')?.data).toBe(entry(3).data);
    expect(store.take('POST', 'https://x/api/extract', 'b1')?.status).toBe(429);
    expect(store.take('POST', 'https://x/api/extract', 'b1')?.status).toBe(200);
    // Nothing exact left: the last entry for the URL is served again.
    expect(store.take('POST', 'https://x/api/extract', 'b1')?.data).toBe(entry(2).data);
    expect(store.take('GET', 'https://x/api/other', '')).toBeNull();
  });

  it('matches ignoring credential values in the query', () => {
    const store = new HttpStore([{ ...entry(1), url: stripSecrets('https://x/api/extract?key=old') }]);
    expect(store.take('POST', 'https://x/api/extract?key=new', 'b1')).not.toBeNull();
  });
});

describe('WsReplay', () => {
  // Recorded: open; server hello at 5 ms; client sent 2 binary chunks; server partial 20 ms after
  // the 2nd; client "finalize"; server final 30 ms after it; server closed.
  const rec: WsRecording = {
    url: 'wss://x/stt',
    frames: [
      { from: 'server', t: 5, text: 'hello' },
      { from: 'client', t: 100, size: 320 },
      { from: 'client', t: 200, size: 320 },
      { from: 'server', t: 220, text: 'partial' },
      { from: 'client', t: 300, text: 'finalize' },
      { from: 'server', t: 330, text: 'final' },
    ],
    close: { by: 'server', t: 400, code: 1000 },
  };

  function run(actions: Array<['client', string | number] | ['wait', number]>) {
    const sent: Array<[number, string]> = [];
    let now = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const replay = new WsReplay(rec, {
      send: (m) => sent.push([now, String(m)]),
      close: (code) => sent.push([now, `close ${code}`]),
      setTimer: (ms, fn) => void timers.push({ at: now + ms, fn }),
    });
    const advance = (to: number) => {
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > to) break;
        timers.shift();
        now = next.at;
        next.fn();
      }
      now = to;
    };
    replay.open();
    for (const [kind, v] of actions) {
      if (kind === 'wait') advance(now + (v as number));
      else replay.client(typeof v === 'number' ? new Uint8Array(v) : v);
    }
    advance(now + 1000);
    return sent;
  }

  it('replays server frames after the client messages they followed, with their delays', () => {
    expect(run([['wait', 50], ['client', 320], ['wait', 50], ['client', 320], ['wait', 50], ['client', 'finalize']])).toEqual([
      [5, 'hello'],
      [120, 'partial'],
      [180, 'final'],
      [250, 'close 1000'],
    ]);
  });

  it('lets a command release what came before it when the client sent fewer chunks', () => {
    const sent = run([['wait', 50], ['client', 320], ['wait', 50], ['client', 'finalize']]);
    expect(sent.map(([, m]) => m)).toEqual(['hello', 'partial', 'final', 'close 1000']);
  });

  it('is not held back by extra chunks', () => {
    const sent = run([['client', 320], ['client', 320], ['client', 320], ['client', 'finalize']]);
    expect(sent.map(([, m]) => m)).toEqual(['hello', 'partial', 'final', 'close 1000']);
  });
});
