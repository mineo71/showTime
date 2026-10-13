import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../skill', import.meta.url));
const skills = path.join(homedir(), '.claude', 'skills');
const dest = path.join(skills, 'showtime');

mkdirSync(skills, { recursive: true });
const existing = lstatSync(dest, { throwIfNoEntry: false });
if (existing) {
  if (!existing.isSymbolicLink()) {
    console.error(`${dest} exists and is not a symlink — move it away first.`);
    process.exit(1);
  }
  unlinkSync(dest);
}
symlinkSync(source, dest);
console.log(`Linked ${dest} → ${source}`);
