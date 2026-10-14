import { describe, expect, it } from 'vitest';
import { parseWholeMs } from '../../src/studio/client/numbers';

describe('parseWholeMs', () => {
  it('reads a whole number of ms, and empty as "remove"', () => {
    expect(parseWholeMs('1500')).toBe(1500);
    expect(parseWholeMs(' 0 ')).toBe(0);
    expect(parseWholeMs('')).toBeNull();
    expect(parseWholeMs('  ')).toBeNull();
  });

  it('calls anything else invalid instead of turning it into nothing', () => {
    for (const text of ['abc', '-5', '1.5', '12px', 'NaN', '1e3']) expect(parseWholeMs(text)).toBe('invalid');
  });
});
