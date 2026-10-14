import { describe, expect, it } from 'vitest';
import { actionHash } from '../../src/script/hash';
import { parseScript } from '../../src/script/schema';

const make = (step: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parseScript({ version: 1, app: { url: 'http://x' }, scenes: [{ id: 'a', steps: [step] }], ...extra });

describe('actionHash', () => {
  const base = make({ do: 'click', target: 'text=Go' });

  it('ignores presentation-only changes', () => {
    const styled = make(
      { do: 'click', target: 'text=Go', show: { caption: 'Hi', zoom: 2, spotlight: true, speed: 2 } },
      { meta: { title: 'X' }, style: { accent: '#f00' } },
    );
    expect(actionHash(styled)).toBe(actionHash(base));
  });

  it('ignores narration and the audio section', () => {
    const voiced = make(
      { do: 'click', target: 'text=Go', show: { say: 'Go!' } },
      { audio: { voice: { engine: 'openai' }, music: { file: 'a.mp3' }, sounds: true, subtitles: 'burn' } },
    );
    expect(actionHash(voiced)).toBe(actionHash(base));
  });

  it('counts hide, reduced motion and wait timeouts only when set; never server or clips', () => {
    const plain = make({ do: 'wait', for: '#done' });
    expect(actionHash(make({ do: 'wait', for: '#done' }, { app: { url: 'http://x', hide: [] } }))).toBe(actionHash(plain));
    expect(actionHash(make({ do: 'wait', for: '#done' }, { app: { url: 'http://x', hide: ['nextjs-portal'] } }))).not.toBe(actionHash(plain));
    expect(actionHash(make({ do: 'wait', for: '#done' }, { app: { url: 'http://x', reducedMotion: 'reduce' } }))).not.toBe(actionHash(plain));
    expect(actionHash(make({ do: 'wait', for: '#done', timeoutMs: 60_000 }))).not.toBe(actionHash(plain));
    const infra = make({ do: 'wait', for: '#done' }, { server: { run: 'npm run dev' }, audio: { clips: [{ file: 'a.wav', at: 'a#1' }] } });
    expect(actionHash(infra)).toBe(actionHash(plain));
  });

  it('ignores every 0.7 look-and-sound field', () => {
    const plain = make({ do: 'click', target: 'text=Go' });
    const styled = make(
      { do: 'click', target: 'text=Go', show: { highlight: '#f00', spotlight: 'glow', click: 'burst', voice: { name: 'Daniel' } } },
      { style: { click: 'pulse', captionStyle: 'bar', watermark: { text: 'x' } }, audio: { sounds: 'pop' } },
    );
    expect(actionHash(styled)).toBe(actionHash(plain));
  });

  it('ignores replay, caption length and freezes', () => {
    const plain = make({ do: 'click', target: 'text=Go' });
    const more = make({ do: 'click', target: 'text=Go', show: { captionMs: 3000, freezeMs: 500 } }, { replay: { file: 'n.json', match: ['**/api/**'] } });
    expect(actionHash(more)).toBe(actionHash(plain));
  });

  it('changes when an action changes', () => {
    expect(actionHash(make({ do: 'click', target: 'text=Stop' }))).not.toBe(actionHash(base));
  });

  it('changes when hold changes (it is recorded in real time)', () => {
    expect(actionHash(make({ do: 'click', target: 'text=Go', show: { hold: 500 } }))).not.toBe(actionHash(base));
  });

  it('keeps takes recorded by 0.2 valid: new app fields at their defaults leave the hash alone', () => {
    const s = parseScript({
      version: 1,
      app: { url: 'http://x', mask: ['.email'] },
      setup: [{ do: 'click', target: '#ok' }],
      scenes: [{ id: 'a', steps: [{ do: 'click', target: 'text=Go', show: { hold: 300 } }] }],
    });
    // computed by showTime 0.2.1 for the same script
    expect(actionHash(s)).toBe('8ba22beab7c929ec2ca97641f84ac3d265bb346e2dea685902146c7f32bddf1a');
  });

  it('changes when dialogs are dismissed instead of accepted', () => {
    expect(actionHash(make({ do: 'click', target: 'text=Go' }, { app: { url: 'http://x', dialogs: 'dismiss' } }))).not.toBe(actionHash(base));
  });

  it('ignores hooks (they prepare the world, they are not recorded)', () => {
    expect(actionHash(make({ do: 'click', target: 'text=Go' }, { hooks: { before: [{ run: 'reset' }] } }))).toBe(actionHash(base));
  });

  it('changes when a network mock changes (it shapes what is recorded)', () => {
    const mocked = make({ do: 'click', target: 'text=Go' }, { app: { url: 'http://x', mock: [{ url: '**/api', json: {} }] } });
    expect(actionHash(mocked)).not.toBe(actionHash(base));
  });

  it('changes when the mask changes (applied at capture)', () => {
    const masked = make({ do: 'click', target: 'text=Go' }, { app: { url: 'http://x', mask: ['.email'] } });
    expect(actionHash(masked)).not.toBe(actionHash(base));
  });
});
