import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filePath, hostAllowed, originAllowed, tokenOk } from '../../src/studio/guard';

describe('studio guard', () => {
  it('accepts only its own host and port (no DNS rebinding)', () => {
    expect(hostAllowed('127.0.0.1:4848', 4848)).toBe(true);
    expect(hostAllowed('localhost:4848', 4848)).toBe(true);
    expect(hostAllowed('evil.example:4848', 4848)).toBe(false);
    expect(hostAllowed('127.0.0.1:9999', 4848)).toBe(false);
    expect(hostAllowed(undefined, 4848)).toBe(false);
  });

  it('accepts the token from the header, or the query for event streams', () => {
    expect(tokenOk({ 'x-showtime-token': 'abc' }, '/api/state', 'abc')).toBe(true);
    expect(tokenOk({}, '/api/events?token=abc', 'abc')).toBe(true);
    expect(tokenOk({}, '/api/state', 'abc')).toBe(false);
    expect(tokenOk({ 'x-showtime-token': 'abd' }, '/api/state', 'abc')).toBe(false);
  });

  it('refuses requests from other origins', () => {
    expect(originAllowed(undefined, 4848)).toBe(true);
    expect(originAllowed('http://127.0.0.1:4848', 4848)).toBe(true);
    expect(originAllowed('https://evil.example', 4848)).toBe(false);
  });

  it('maps /files paths inside the work folder only', () => {
    const root = path.resolve('/w/.showtime/demo');
    expect(filePath(root, '/files/take/raw.mp4')).toBe(path.join(root, 'take', 'raw.mp4'));
    expect(filePath(root, '/files/audio/mix.wav?v=3')).toBe(path.join(root, 'audio', 'mix.wav'));
    expect(filePath(root, '/files/../demo.json')).toBeNull();
    expect(filePath(root, '/files/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(filePath(root, '/files/')).toBeNull();
  });
});

describe('STALE_PAGE', () => {
  it('tells the person to reload instead of a bare refusal', async () => {
    const { STALE_PAGE } = await import('../../src/studio/guard');
    expect(STALE_PAGE).toMatch(/earlier studio session/);
    expect(STALE_PAGE).toMatch(/Reload/);
  });
});
