import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkSkill, SKILL_DIR } from '../../src/setup';

const freshHome = () => mkdtempSync(path.join(tmpdir(), 'showtime-home-'));

describe('linkSkill', () => {
  it('ships the skill folder next to the code', () => {
    expect(existsSync(path.join(SKILL_DIR, 'SKILL.md'))).toBe(true);
  });

  it('links the skill where Claude Code and Codex look for user skills', () => {
    const home = freshHome();
    const claude = path.join(home, '.claude/skills/showtime');
    const codex = path.join(home, '.agents/skills/showtime');
    expect(linkSkill(['claude', 'codex'], home)).toEqual([claude, codex]);
    for (const dest of [claude, codex]) {
      expect(lstatSync(dest).isSymbolicLink()).toBe(true);
      expect(path.resolve(readlinkSync(dest))).toBe(path.resolve(SKILL_DIR));
    }
  });

  it('replaces its own earlier link, so re-running setup after an update is safe', () => {
    const home = freshHome();
    linkSkill(['claude'], home, path.join(home, 'old'));
    linkSkill(['claude'], home);
    expect(path.resolve(readlinkSync(path.join(home, '.claude/skills/showtime')))).toBe(path.resolve(SKILL_DIR));
  });

  it('refuses to replace a real folder someone put there', () => {
    const home = freshHome();
    mkdirSync(path.join(home, '.agents/skills/showtime'), { recursive: true });
    expect(() => linkSkill(['codex'], home)).toThrow(/is not a symlink/);
  });
});
