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
