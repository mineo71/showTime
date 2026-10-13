// CHANGELOG.md helpers for releases (see "Releasing" in CONTRIBUTING.md).
//
//   tsx scripts/changelog.ts check            # preversion: there is something to release
//   tsx scripts/changelog.ts release          # version: "## Unreleased" → "## <version> — <today>"
//   tsx scripts/changelog.ts notes [version]  # release workflow: print one version's notes
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Body of a "## …" section: everything up to the next "## " heading or the end of the file. */
const section = (heading: string) => new RegExp(`^## ${heading}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');

export function releaseChangelog(text: string, version: string, date: string): string {
  const unreleased = text.match(section('Unreleased'));
  if (!unreleased) throw new Error('CHANGELOG.md has no "## Unreleased" section: list the changes there first.');
  if (!unreleased[1].trim()) throw new Error('The "## Unreleased" section of CHANGELOG.md is empty: list the changes there first.');
  return text.replace(/^## Unreleased[ \t]*$/m, `## ${version} — ${date}`);
}

export function releaseNotes(text: string, version: string): string {
  const found = text.match(section(`${version.replace(/\./g, '\\.')}(?: .*)?`));
  if (!found) throw new Error(`CHANGELOG.md has no section for ${version}`);
  return found[1].trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = new URL('../CHANGELOG.md', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const [command, arg] = process.argv.slice(2);
  try {
    const text = readFileSync(file, 'utf8');
    if (command === 'check') releaseChangelog(text, version, '');
    else if (command === 'release') writeFileSync(file, releaseChangelog(text, version, new Date().toISOString().slice(0, 10)));
    else if (command === 'notes') process.stdout.write(`${releaseNotes(text, arg ?? version)}\n`);
    else throw new Error('usage: tsx scripts/changelog.ts check | release | notes [version]');
  } catch (err) {
    process.stderr.write(`✖ ${(err as Error).message}\n`);
    process.exit(1);
  }
}
