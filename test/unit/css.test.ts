import { describe, expect, it } from 'vitest';
import { cssFamily, fontKey, fontPlan } from '../../src/render/remotion/css';

describe('cssFamily', () => {
  it('quotes family names CSS would reject unquoted, and leaves valid lists alone', () => {
    expect(cssFamily('Source Sans 3')).toBe('"Source Sans 3"');
    expect(cssFamily('Inter 18pt, sans-serif')).toBe('"Inter 18pt", sans-serif');
    expect(cssFamily('Brand Sans')).toBe('Brand Sans');
    const defaults = 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif';
    expect(cssFamily(defaults)).toBe(defaults);
    expect(cssFamily('Odd "Name" 2')).toBe('"Odd \\"Name\\" 2"');
  });
});

describe('fontPlan', () => {
  const a = { family: 'A', src: 'data:font/ttf;base64,AAAA' };
  const b = { family: 'B', src: 'data:font/ttf;base64,BBBB', weight: 700 };
  it('adds only fonts not loaded yet and removes the ones no longer listed', () => {
    expect(fontPlan(new Set(), [a, b])).toEqual({ add: [a, b], remove: [] });
    const loaded = new Set([fontKey(a), fontKey(b)]);
    expect(fontPlan(loaded, [{ ...a }, { ...b }])).toEqual({ add: [], remove: [] });
    expect(fontPlan(loaded, [a])).toEqual({ add: [], remove: [fontKey(b)] });
    expect(fontKey({ ...a, src: 'data:font/ttf;base64,AAAB' })).not.toBe(fontKey(a));
  });
});
