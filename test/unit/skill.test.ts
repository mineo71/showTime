import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseScript } from '../../src/script/schema';

const SKILL = new URL('../../skill/SKILL.md', import.meta.url);

describe('skill/SKILL.md', () => {
  it('has frontmatter with a name and a trigger description', async () => {
    const text = await readFile(SKILL, 'utf8');
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    expect(front).toMatch(/^name: showtime$/m);
    expect(front).toMatch(/^description: Use when .+/m);
  });

  it('ships an example script that is valid', async () => {
    const text = await readFile(SKILL, 'utf8');
    const json = text.match(/```json\n([\s\S]*?)\n```/)?.[1];
    expect(json).toBeDefined();
    expect(() => parseScript(JSON.parse(json!))).not.toThrow();
  });

  it('tells Claude to run long commands with a long timeout or in the background', async () => {
    const text = await readFile(SKILL, 'utf8');
    expect(text).toMatch(/timeout: 600000/);
    expect(text).toMatch(/run_in_background/);
  });

  it('warns that check performs every action for real', async () => {
    const text = await readFile(SKILL, 'utf8');
    expect(text).toMatch(/performs every action for real/);
  });
});
