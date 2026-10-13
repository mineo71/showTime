import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { synthesize, voiceKey } from '../../src/audio/tts';
import type { Voice } from '../../src/script/schema';

const TRICKY = `He said "hi" — it's 'fine'\n-v Привіт $(echo pwned) \`whoami\` & ; |`;
const voice = (v: Partial<Voice>): Voice => ({ engine: 'system', speed: 1, ...v }) as Voice;

describe('voiceKey', () => {
  it('is stable and changes with the text and every voice setting', () => {
    const base = voice({ engine: 'openai', name: 'alloy' });
    const k = voiceKey(base, 'Hello');
    expect(voiceKey({ ...base }, 'Hello')).toBe(k);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    const variants: Partial<Voice>[] = [{ engine: 'system' }, { name: 'nova' }, { speed: 1.1 }, { model: 'tts-1' }, { instructions: 'warm' }];
    for (const v of variants) expect(voiceKey({ ...base, ...v }, 'Hello')).not.toBe(k);
    expect(voiceKey(base, 'Hello!')).not.toBe(k);
    expect(voiceKey(voice({ engine: 'command', command: 'a {out}' }), 'x')).not.toBe(voiceKey(voice({ engine: 'command', command: 'b {out}' }), 'x'));
  });
});

describe('command engine', () => {
  const echo = `node -e "require('fs').writeFileSync(process.argv[1], require('fs').readFileSync(0))" {out}`;

  it('gets the text on stdin, untouched by the shell, and writes to {out}', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'showtime-tts-')), 'with space');
    await mkdir(dir);
    const file = await synthesize(voice({ engine: 'command', command: echo }), TRICKY, join(dir, 'v'));
    expect(await readFile(file, 'utf8')).toBe(TRICKY);
  });

  it('fails with the exit code and the command output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'showtime-tts-'));
    const bad = voice({ engine: 'command', command: `node -e "console.error('no model'); process.exit(3)"` });
    await expect(synthesize(bad, 'x', join(dir, 'v'))).rejects.toThrow(/exit code 3[\s\S]*no model/);
  });
});

describe('cloud engines', () => {
  let requests: { method?: string; url?: string; headers: IncomingMessage['headers']; body: string }[] = [];
  let status = 200;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(status, { 'content-type': status === 200 ? 'audio/wav' : 'application/json' });
      res.end(status === 200 ? 'AUDIO' : '{"error":"invalid api key"}');
    });
  });
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  const fresh = async () => {
    requests = [];
    status = 200;
    return join(await mkdtemp(join(tmpdir(), 'showtime-tts-')), 'v');
  };

  it('openai: posts the documented request and saves the WAV', async () => {
    const out = await fresh();
    const env = { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${base}/v1` };
    const file = await synthesize(voice({ engine: 'openai', instructions: 'warm', speed: 1.2 }), TRICKY, out, { env });
    expect(file).toBe(`${out}.wav`);
    expect(await readFile(file, 'utf8')).toBe('AUDIO');
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/v1/audio/speech' });
    expect(requests[0].headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(requests[0].body)).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: TRICKY,
      response_format: 'wav',
      speed: 1.2,
      instructions: 'warm',
    });
  });

  it('elevenlabs: posts to the voice and saves the MP3', async () => {
    const out = await fresh();
    const env = { ELEVENLABS_API_KEY: 'el-test', ELEVENLABS_BASE_URL: base };
    const file = await synthesize(voice({ engine: 'elevenlabs', name: 'abc 123' }), 'Hello', out, { env });
    expect(file).toBe(`${out}.mp3`);
    expect(requests[0].url).toBe('/v1/text-to-speech/abc%20123?output_format=mp3_44100_128');
    expect(requests[0].headers['xi-api-key']).toBe('el-test');
    expect(JSON.parse(requests[0].body)).toEqual({ text: 'Hello', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 1 } });
  });

  it('fails with the HTTP status and the provider message', async () => {
    const out = await fresh();
    status = 401;
    const env = { OPENAI_API_KEY: 'bad', OPENAI_BASE_URL: `${base}/v1` };
    await expect(synthesize(voice({ engine: 'openai' }), 'x', out, { env })).rejects.toThrow(/HTTP 401[\s\S]*invalid api key/);
  });

  it('names the missing key', async () => {
    const out = await fresh();
    await expect(synthesize(voice({ engine: 'openai' }), 'x', out, { env: {} })).rejects.toThrow(/OPENAI_API_KEY is not set/);
    await expect(synthesize(voice({ engine: 'elevenlabs', name: 'v' }), 'x', out, { env: {} })).rejects.toThrow(/ELEVENLABS_API_KEY is not set/);
    expect(requests).toEqual([]);
  });
});
