import { describe, expect, it } from 'vitest';
import { releaseChangelog, releaseNotes } from '../../scripts/changelog';

const log = `# Changelog

## Unreleased

- New thing.
- Fixed thing.

## 0.2.0 — 2026-10-13

- Published to npm.
`;

describe('releaseChangelog', () => {
  it('turns the Unreleased section into the new version, dated', () => {
    expect(releaseChangelog(log, '0.3.0', '2026-11-02')).toBe(log.replace('## Unreleased', '## 0.3.0 — 2026-11-02'));
  });

  it('refuses to release without an Unreleased section', () => {
    expect(() => releaseChangelog(log.replace('## Unreleased', '## 0.2.1 — 2026-10-20'), '0.3.0', '2026-11-02')).toThrow(/## Unreleased/);
  });

  it('refuses to release an empty Unreleased section', () => {
    expect(() => releaseChangelog(log.replace(/- New thing\.\n- Fixed thing\.\n/, ''), '0.3.0', '2026-11-02')).toThrow(/empty/);
  });
});

describe('releaseNotes', () => {
  it('returns the body of one version section', () => {
    expect(releaseNotes(log, '0.2.0')).toBe('- Published to npm.');
  });

  it('fails loudly for a version the changelog does not mention', () => {
    expect(() => releaseNotes(log, '9.9.9')).toThrow(/9\.9\.9/);
  });
});
