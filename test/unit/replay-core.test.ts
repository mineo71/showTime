import { describe, expect, it } from 'vitest';
import { HttpStore, QUIET_MS, stripSecrets, WsReplay, type WsRecording } from '../../src/runner/replay-core';

describe('stripSecrets', () => {
  it('hides credential-like query values and keeps the rest', () => {
    expect(stripSecrets('wss://api.x/ws?access_token=abc&language=en')).toBe('wss://api.x/ws?access_token=%E2%80%A6&language=en');
    expect(stripSecrets('https://x/api?q=1&API_KEY=z&sig=y')).toBe('https://x/api?q=1&API_KEY=%E2%80%A6&sig=%E2%80%A6');
    expect(stripSecrets('https://x/plain')).toBe('https://x/plain');
  });

  it('knows credentials by any part of their name, and drops user:password', () => {
    for (const name of ['X-Amz-Signature', 'X-Amz-Credential', 'X-Amz-Security-Token', 'jwt', 'authorization', 'xi_api_key', 'api-key', 'accessToken', 'client_secret', 'passwd']) {
      expect(stripSecrets(`https://x/a?${name}=s3cr3t&q=1`), name).not.toContain('s3cr3t');
    }
    for (const name of ['keyword', 'design', 'monkey', 'q']) expect(stripSecrets(`https://x/a?${name}=v`)).toBe(`https://x/a?${name}=v`);
    expect(stripSecrets('https://bob:hunter2@x/a')).not.toMatch(/bob|hunter2/);
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

  function run(actions: Array<['client', string | number] | ['wait', number]>, recording: WsRecording = rec) {
    const sent: Array<[number, string]> = [];
    let now = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const replay = new WsReplay(recording, {
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

  it('pairs a command whose values changed since the recording with the recorded one of the same shape', () => {
    const tts: WsRecording = {
      url: 'wss://x/tts',
      frames: [
        { from: 'client', t: 10, text: '{"context_id":"aaa","transcript":"Hi"}' },
        { from: 'server', t: 40, text: 'chunk1' },
        { from: 'server', t: 60, text: 'chunk2' },
      ],
    };
    expect(run([['client', '{"transcript":"Hi","context_id":"bbb"}']], tts).map(([, m]) => m)).toEqual(['chunk1', 'chunk2']);
    // A message it never saw (a keep-alive) releases no command's answers.
    expect(run([['client', 'ping'], ['wait', 3000]], tts)).toEqual([]);
  });

  it('sends what followed the last chunk once the client goes quiet, when it sent fewer', () => {
    const stt: WsRecording = {
      url: 'wss://x/stt',
      frames: [
        ...[100, 200, 300, 400, 500].map((t) => ({ from: 'client' as const, t, size: 320 })),
        { from: 'server', t: 900, text: 'final' },
      ],
    };
    const sent = run([['client', 320], ['wait', 100], ['client', 320], ['wait', 100], ['client', 320], ['wait', 3000]], stt);
    expect(sent.map(([, m]) => m)).toEqual(['final']);
    // not before the client has been quiet for a while
    expect(sent[0][0]).toBeGreaterThanOrEqual(200 + QUIET_MS);
  });

  it('keeps a command\'s answers for the command, even when the client goes quiet', () => {
    const sent = run([['client', 320], ['wait', 3000]]);
    expect(sent.map(([, m]) => m)).toEqual(['hello', 'partial']);
  });

  it('is not held back by extra chunks', () => {
    const sent = run([['client', 320], ['client', 320], ['client', 320], ['client', 'finalize']]);
    expect(sent.map(([, m]) => m)).toEqual(['hello', 'partial', 'final', 'close 1000']);
  });
});
