import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = fileURLToPath(new URL('../skill', import.meta.url));

/** Where each agent looks for user skills (relative to the home folder). Codex reads the shared ~/.agents/skills. */
export const SKILL_HOMES = { claude: '.claude/skills', codex: '.agents/skills' } as const;
export type Agent = keyof typeof SKILL_HOMES;
export const AGENTS = Object.keys(SKILL_HOMES) as Agent[];

/** Symlink the skill into each agent's skills folder; returns the links. Re-linking our own link is fine. */
export function linkSkill(agents: Agent[], home = homedir(), source = SKILL_DIR): string[] {
  return agents.map((agent) => {
    const dir = path.join(home, SKILL_HOMES[agent]);
    const dest = path.join(dir, 'showtime');
    mkdirSync(dir, { recursive: true });
    const existing = lstatSync(dest, { throwIfNoEntry: false });
    if (existing && !existing.isSymbolicLink()) throw new Error(`${dest} exists and is not a symlink — move it away first.`);
    if (existing) unlinkSync(dest);
    symlinkSync(source, dest, 'junction');
    return dest;
  });
}

/** Download the Chromium build this copy of Playwright drives, and Remotion's headless shell. */
export async function installBrowsers(): Promise<void> {
  // Our own Playwright CLI: a bare `npx playwright` may resolve another version with another Chromium.
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`playwright install chromium exited with code ${code}`))));
  });
  const { ensureBrowser } = await import('@remotion/renderer');
  await ensureBrowser();
}
