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

describe('0.7 look and sound', () => {
  it('defaults to the 0.6 look', () => {
    const s = parseScript(minimal);
    expect(s.style).toMatchObject({ click: 'ripple', spotlightDim: 0.55, captionStyle: 'dark', fonts: [] });
    expect(s.style.watermark).toBeUndefined();
    expect(s.style.captionFont).toBeUndefined();
    expect(s.audio.sounds).toBe(false);
  });

  it('accepts highlight colours, spotlight styles, click animations and voice changes per step', () => {
    const s = parseScript(
      withSteps([
        { do: 'click', target: '#a', show: { highlight: '#f59e0b', spotlight: 'glow', click: 'burst', voice: { name: 'Daniel' } } },
        { do: 'click', target: '#b', show: { spotlight: true } },
      ]),
    );
    expect(s.scenes[0].steps[0].show).toMatchObject({ highlight: '#f59e0b', spotlight: 'glow', click: 'burst', voice: { name: 'Daniel' } });
    expect(() => parseScript(withSteps([{ do: 'click', target: '#a', show: { click: 'explode' } }]))).toThrow(/show\.click/);
    expect(() => parseScript(withSteps([{ do: 'click', target: '#a', show: { spotlight: 'neon' } }]))).toThrow(/show\.spotlight/);
    expect(() => parseScript(withSteps([{ do: 'click', target: '#a', show: { voice: { engine: 'robot' } } }]))).toThrow(/show\.voice\.engine/);
  });

  it('starts a step voice afresh when it switches engine, keeping only the speed', async () => {
    const { voiceFor } = await import('../../src/script/schema');
    const base: { engine: string; name?: string; speed: number; model?: string } = { engine: 'system', name: 'Daniel', speed: 1.1, model: 'x' };
    expect(voiceFor(base, { engine: 'openai' })).toEqual({ engine: 'openai', speed: 1.1 });
    expect(voiceFor(base, { name: 'Samantha' })).toEqual({ ...base, name: 'Samantha' });
    expect(voiceFor(base, { engine: 'system', name: 'Fred' })).toEqual({ ...base, name: 'Fred' });
    expect(voiceFor(base, undefined)).toEqual(base);
  });

  it('keeps a step voice to what it changes (no defaults filled in)', () => {
    const s = parseScript(withSteps([{ do: 'click', target: '#a', show: { voice: { name: 'Daniel' } } }]));
    expect(s.scenes[0].steps[0].show?.voice).toEqual({ name: 'Daniel' });
    expect(parseScript(minimal).audio.voice).toEqual({ engine: 'system', speed: 1 });
  });

  it('accepts a watermark with text or an image, and caption styles and fonts', () => {
    const s = parseScript({
      ...minimal,
      style: {
        click: 'pulse',
        captionStyle: 'outline',
        captionFont: 'Brand Sans',
        titleFont: 'Georgia',
        captionSize: 42,
        fonts: [{ family: 'Brand Sans', file: 'brand.woff2', weight: 700 }],
        watermark: { text: 'acme.com' },
      },
    });
    expect(s.style.watermark).toEqual({ text: 'acme.com', position: 'bottom-right', opacity: 0.6, size: 28 });
    expect(s.style.fonts).toEqual([{ family: 'Brand Sans', file: 'brand.woff2', weight: 700 }]);
    expect(() => parseScript({ ...minimal, style: { watermark: { position: 'top-left' } } })).toThrow(/watermark needs text or an image/);
    expect(() => parseScript({ ...minimal, style: { captionStyle: 'neon' } })).toThrow(/style\.captionStyle/);
    expect(() => parseScript({ ...minimal, style: { captionSize: 200 } })).toThrow(/style\.captionSize/);
  });

  it('takes sound packs by name or as an object with files and volume', () => {
    expect(parseScript({ ...minimal, audio: { sounds: true } }).audio.sounds).toBe(true);
    expect(parseScript({ ...minimal, audio: { sounds: 'mechanical' } }).audio.sounds).toBe('mechanical');
    expect(parseScript({ ...minimal, audio: { sounds: { pack: 'pop', volume: 0.5 } } }).audio.sounds).toEqual({ pack: 'pop', volume: 0.5 });
    expect(parseScript({ ...minimal, audio: { sounds: { click: 'c.wav' } } }).audio.sounds).toEqual({ pack: 'soft', click: 'c.wav', volume: 1 });
    expect(() => parseScript({ ...minimal, audio: { sounds: 'loud' } })).toThrow(/audio\.sounds/);
  });
});

describe('0.8 fields', () => {
  it('accepts replay, locales, caption length and freezes', () => {
    const s = parseScript({
      ...withSteps([{ do: 'click', target: '#a', show: { captionMs: 2500, freezeMs: 800 } }]),
      locales: ['en', 'uk'],
      replay: { file: 'net.json', match: ['**/api/**', 'wss://api.example.com/**'] },
    });
    expect(s.locales).toEqual(['en', 'uk']);
    expect(s.replay).toEqual({ file: 'net.json', match: ['**/api/**', 'wss://api.example.com/**'] });
    expect(s.scenes[0].steps[0].show).toMatchObject({ captionMs: 2500, freezeMs: 800 });
    expect(() => parseScript({ ...minimal, locales: ['en', 'en'] })).toThrow(/locales/);
    expect(() => parseScript({ ...minimal, replay: { file: 'x.json', match: [] } })).toThrow(/replay\.match/);
    expect(() => parseScript(withSteps([{ do: 'click', target: '#a', show: { freezeMs: -1 } }]))).toThrow(/freezeMs/);
  });
});

describe('0.9 fields', () => {
  it('accepts locale tags with a script and a region, and still rejects non-tags', () => {
    expect(parseScript({ ...minimal, locales: ['zh-Hant-TW', 'pt-BR', 'en'] }).locales).toEqual(['zh-Hant-TW', 'pt-BR', 'en']);
    expect(() => parseScript({ ...minimal, locales: ['e'] })).toThrow(/locales/);
    expect(() => parseScript({ ...minimal, locales: ['english language'] })).toThrow(/locales/);
    expect(() => parseScript({ ...minimal, locales: ['en-'] })).toThrow(/locales/);
  });
});

describe('0.9 steps', () => {
  it('accepts double clicks, right and modifier clicks, drags, uploads and closing a tab', () => {
    const s = parseScript(
      withSteps([
        { do: 'dblclick', target: '#a', modifiers: ['Meta'] },
        { do: 'click', target: '#a', button: 'right' },
        { do: 'click', target: '#a', modifiers: ['Shift', 'ControlOrMeta'] },
        { do: 'drag', target: '#card', to: '#done' },
        { do: 'drag', target: '#thumb', by: { x: 120, y: 0 } },
        { do: 'upload', target: '#pick', files: ['a.png', 'b.pdf'] },
        { do: 'closeTab' },
      ]),
    );
    expect(s.scenes[0].steps.map((x) => x.do)).toEqual(['dblclick', 'click', 'click', 'drag', 'drag', 'upload', 'closeTab']);
  });

  it('rejects a drag without exactly one end, an upload without files and an unknown modifier', () => {
    expect(() => parseScript(withSteps([{ do: 'drag', target: '#a' }]))).toThrow(/drag needs exactly one of "to" or "by"/);
    expect(() => parseScript(withSteps([{ do: 'drag', target: '#a', to: '#b', by: { x: 1, y: 1 } }]))).toThrow(/drag needs exactly one/);
    expect(() => parseScript(withSteps([{ do: 'upload', target: '#a', files: [] }]))).toThrow(/files/);
    expect(() => parseScript(withSteps([{ do: 'click', target: '#a', modifiers: ['Hyper'] }]))).toThrow(/modifiers/);
    expect(() => parseScript(withSteps([{ do: 'click', target: '#a', button: 'back' }]))).toThrow(/button/);
  });
});
