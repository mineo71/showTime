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

  it('changes when the mask changes (applied at capture)', () => {
    const masked = make({ do: 'click', target: 'text=Go' }, { app: { url: 'http://x', mask: ['.email'] } });
    expect(actionHash(masked)).not.toBe(actionHash(base));
  });
});
