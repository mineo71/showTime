import { describe, expect, it } from 'vitest';
import { rng } from '../../src/runner/time';

describe('rng', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = rng('Q3 revenue');
    const b = rng('Q3 revenue');
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(rng('other')()).not.toBe(xs[0]);
  });
});
