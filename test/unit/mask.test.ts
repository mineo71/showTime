import { describe, expect, it } from 'vitest';
import { maskScript } from '../../src/runner/browser';

describe('maskScript', () => {
  it('emits one rule per selector so one bad selector cannot disable the others', () => {
    const script = maskScript(['.a', '#b']);
    expect(script).toContain('.a { filter: blur(10px) !important; }');
    expect(script).toContain('#b { filter: blur(10px) !important; }');
  });
});
