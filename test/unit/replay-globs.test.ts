import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { globKinds, tmpPath } from '../../src/runner/replay';

describe('globKinds', () => {
  it('routes a glob without a scheme as both HTTP and WebSocket', () => {
    expect(globKinds('**/ws')).toEqual({ http: true, ws: true });
    expect(globKinds('**/api/**')).toEqual({ http: true, ws: true });
  });

  it('keeps scheme globs to their own kind', () => {
    expect(globKinds('wss://api.example.com/**')).toEqual({ http: false, ws: true });
    expect(globKinds('WS://127.0.0.1:*/ws')).toEqual({ http: false, ws: true });
    expect(globKinds('https://api.example.com/**')).toEqual({ http: true, ws: false });
    expect(globKinds('http://localhost:3000/api/*')).toEqual({ http: true, ws: false });
  });
});

describe('tmpPath', () => {
  it('names a fresh temporary file beside the target on every call', () => {
    const a = tmpPath('/x/lab.net.json');
    const b = tmpPath('/x/lab.net.json');
    expect(a).not.toBe(b);
    for (const t of [a, b]) {
      expect(path.dirname(t)).toBe('/x');
      expect(path.basename(t)).toMatch(/^lab\.net\.json\..+\.tmp$/);
    }
  });
});
