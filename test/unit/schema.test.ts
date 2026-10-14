import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScript, ScriptError, scriptJsonSchema } from '../../src/script/schema';

const minimal = {
  version: 1,
  app: { url: 'http://localhost:3000' },
  scenes: [{ id: 'a', steps: [{ do: 'click', target: 'text=Go' }] }],
};
const withSteps = (steps: unknown[]) => ({ ...minimal, scenes: [{ id: 'a', steps }] });

describe('parseScript', () => {
  it('applies defaults', () => {
    const s = parseScript(minimal);
    expect(s.app.viewport).toEqual({ width: 1440, height: 900 });
    expect(s.app.deviceScaleFactor).toBe(2);
    expect(s.app.mask).toEqual([]);
    expect(s.setup).toEqual([]);
    expect(s.meta).toEqual({});
    expect(s.style).toMatchObject({ autoZoom: true, autoSpeed: true, maxZoom: 1.8, padding: 0.06, radius: 14, shadow: true });
    expect(s.style.background).toContain('gradient');
    expect(s.style.chrome).toBe('browser');
    expect(s.style.address).toBeUndefined();
  });

  it('accepts a window chrome choice and an address-bar override', () => {
    const s = parseScript({ ...minimal, style: { chrome: 'none', address: 'acme.app/reports' } });
    expect(s.style).toMatchObject({ chrome: 'none', address: 'acme.app/reports' });
    expect(() => parseScript({ ...minimal, style: { chrome: 'safari' } })).toThrow(/style\.chrome/);
  });

  it('defaults type pace to human and keeps Unicode text', () => {
    const s = parseScript(withSteps([{ do: 'type', target: '#q', text: 'Привіт' }]));
    expect(s.scenes[0].steps[0]).toMatchObject({ do: 'type', pace: 'human', clear: false, text: 'Привіт' });
  });

  it('rejects an unknown action and names the path', () => {
    expect(() => parseScript(withSteps([{ do: 'jump' }]))).toThrow(/scenes\.0\.steps\.0/);
  });

  it('rejects unknown fields so typos surface', () => {
    expect(() => parseScript(withSteps([{ do: 'click', target: 'x', shwo: {} }]))).toThrow(ScriptError);
  });

  it('requires exactly one of target/by for scroll', () => {
    expect(() => parseScript(withSteps([{ do: 'scroll' }]))).toThrow(/exactly one/);
    expect(() => parseScript(withSteps([{ do: 'scroll', by: 400 }]))).not.toThrow();
  });

  it('requires exactly one of for/ms for wait', () => {
    expect(() => parseScript(withSteps([{ do: 'wait', for: 'text=A', ms: 5 }]))).toThrow(/exactly one/);
    expect(() => parseScript(withSteps([{ do: 'wait', ms: 500 }]))).not.toThrow();
  });

  it('rejects duplicate scene ids', () => {
    expect(() => parseScript({ ...minimal, scenes: [minimal.scenes[0], minimal.scenes[0]] })).toThrow(/duplicate scene id "a"/);
  });

  it('includes the source in the error message', () => {
    expect(() => parseScript({ version: 1 }, '/tmp/demo.json')).toThrow(/Invalid \/tmp\/demo\.json/);
  });
});

describe('scriptJsonSchema', () => {
  it('describes the script object', () => {
    const js = scriptJsonSchema() as { type: string; properties: Record<string, unknown> };
    expect(js.type).toBe('object');
    expect(js.properties.scenes).toBeDefined();
    expect(js.properties.style).toBeDefined();
  });
});

describe('0.3 script fields', () => {
  const full = {
    ...minimal,
    meta: { title: 'T', logo: 'logo.svg', outro: { title: 'Try it', subtitle: 'Free', url: 'acme.com' } },
    app: {
      url: 'http://x',
      mock: [{ url: '**/api/*', json: { ok: true }, delayMs: 300 }],
      clock: '2026-10-13T09:30:00Z',
      dialogs: 'dismiss',
    },
    hooks: { before: [{ run: 'npm run reset' }, { request: { url: 'http://x/reset' } }], after: [{ run: 'echo done' }] },
  };

  it('accepts hooks, mocks, a frozen clock, dialogs, an outro and a logo', () => {
    const s = parseScript(full);
    expect(s.app.mock[0]).toEqual({ url: '**/api/*', json: { ok: true }, delayMs: 300, status: 200 });
    expect(s.app.clock).toBe('2026-10-13T09:30:00Z');
    expect(s.app.dialogs).toBe('dismiss');
    expect(s.hooks.before).toEqual([{ run: 'npm run reset' }, { request: { url: 'http://x/reset', method: 'POST' } }]);
    expect(s.hooks.after).toEqual([{ run: 'echo done' }]);
    expect(s.meta).toEqual({ title: 'T', logo: 'logo.svg', outro: { title: 'Try it', subtitle: 'Free', url: 'acme.com' } });
  });

  it('defaults to no hooks, no mocks and accepted dialogs', () => {
    const s = parseScript(minimal);
    expect(s.hooks).toEqual({ before: [], after: [] });
    expect(s.app.mock).toEqual([]);
    expect(s.app.dialogs).toBe('accept');
    expect(s.app.clock).toBeUndefined();
  });

  it('rejects an unparseable clock, an unknown hook kind and a mock with both json and body', () => {
    expect(() => parseScript({ ...minimal, app: { url: 'http://x', clock: 'yesterday' } })).toThrow(/app\.clock/);
    expect(() => parseScript({ ...minimal, hooks: { before: [{ shell: 'x' }] } })).toThrow(/hooks\.before\.0/);
    expect(() => parseScript({ ...minimal, app: { url: 'http://x', mock: [{ url: '*', json: {}, body: 'x' }] } })).toThrow(/app\.mock\.0/);
  });
});

describe('docs/script.schema.json', () => {
  it('matches the schema the CLI prints (run `npm run schema:write` after changing the format)', () => {
    const shipped = JSON.parse(readFileSync(new URL('../../docs/script.schema.json', import.meta.url), 'utf8'));
    expect(shipped).toEqual(scriptJsonSchema());
  });
});

describe('narration and audio', () => {
  it('accepts show.say and defaults the audio section', () => {
    const s = parseScript(withSteps([{ do: 'click', target: '#a', show: { say: 'Create an invoice in seconds.' } }]));
    expect(s.scenes[0].steps[0].show?.say).toBe('Create an invoice in seconds.');
    expect(s.audio).toEqual({ voice: { engine: 'system', speed: 1 }, sounds: false, subtitles: 'file', clips: [] });
  });

  it('defaults the music volume and accepts every engine setting', () => {
    const s = parseScript({
      ...minimal,
      audio: {
        voice: { engine: 'openai', name: 'alloy', speed: 1.2, model: 'gpt-4o-mini-tts', instructions: 'warm' },
        music: { file: 'bed.mp3' },
        sounds: true,
        subtitles: 'burn',
      },
    });
    expect(s.audio.music).toEqual({ file: 'bed.mp3', volume: 0.25 });
    expect(s.audio.voice).toMatchObject({ engine: 'openai', name: 'alloy', speed: 1.2 });
    expect(s.audio.subtitles).toBe('burn');
  });

  it('needs a voice id for elevenlabs and a command for the command engine', () => {
    expect(() => parseScript({ ...minimal, audio: { voice: { engine: 'elevenlabs' } } })).toThrow(/audio\.voice\.name/);
    expect(() => parseScript({ ...minimal, audio: { voice: { engine: 'command' } } })).toThrow(/audio\.voice\.command/);
    expect(() => parseScript({ ...minimal, audio: { voice: { speed: 3 } } })).toThrow(/audio\.voice\.speed/);
    expect(() => parseScript({ ...minimal, audio: { subtitles: 'yes' } })).toThrow(/audio\.subtitles/);
  });
});

describe('0.6 fields', () => {
  it('defaults hide and clips to empty, and leaves server and reduced motion unset', () => {
    const s = parseScript(minimal);
    expect(s.app.hide).toEqual([]);
    expect(s.app.reducedMotion).toBeUndefined();
    expect(s.server).toBeUndefined();
    expect(s.audio.clips).toEqual([]);
  });

  it('accepts a server, defaulting its timeout, and needs its command', () => {
    expect(parseScript({ ...minimal, server: { run: 'npm run dev' } }).server).toEqual({ run: 'npm run dev', timeoutMs: 60_000 });
    expect(() => parseScript({ ...minimal, server: { url: 'http://x' } })).toThrow(/server\.run/);
    expect(() => parseScript({ ...minimal, server: { run: 'x', timeoutMs: 999_999 } })).toThrow(/server\.timeoutMs/);
  });

  it('accepts a wait timeout only with "for", within 1–300 s', () => {
    const s = parseScript(withSteps([{ do: 'wait', for: '#done', timeoutMs: 60_000 }]));
    expect(s.scenes[0].steps[0]).toMatchObject({ timeoutMs: 60_000 });
    expect(() => parseScript(withSteps([{ do: 'wait', for: '#x', timeoutMs: 500 }]))).toThrow(/timeoutMs/);
    expect(() => parseScript(withSteps([{ do: 'wait', ms: 100, timeoutMs: 5000 }]))).toThrow(/timeoutMs goes with "for"/);
  });

  it('checks clips: a scene#n step, a non-negative offset, a volume of 0–1', () => {
    const s = parseScript({ ...minimal, audio: { clips: [{ file: 'ring.wav', at: 'a#1' }] } });
    expect(s.audio.clips).toEqual([{ file: 'ring.wav', at: 'a#1', offsetMs: 0, volume: 1 }]);
    expect(() => parseScript({ ...minimal, audio: { clips: [{ file: 'x.wav', at: 'a' }] } })).toThrow(/audio\.clips\.0\.at/);
    expect(() => parseScript({ ...minimal, audio: { clips: [{ file: 'x.wav', at: 'a#1', offsetMs: -1 }] } })).toThrow(/offsetMs/);
    expect(() => parseScript({ ...minimal, app: { url: 'http://x', reducedMotion: 'off' } })).toThrow(/app\.reducedMotion/);
  });
});
