import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

/** Roles a demo step can act on. */
const ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'slider', 'spinbutton']);

export interface Target {
  role: string;
  name: string;
  /** ready for a step's `target` */
  target: string;
  /** how many elements it matches on the page (1 is what you want) */
  count: number;
}

export interface InspectResult {
  url: string;
  title: string;
  targets: Target[];
  screenshot: string;
}

/** Named interactive elements in an ARIA snapshot, in page order, each (role, name) once. */
export function parseSnapshot(snapshot: string): { role: string; name: string }[] {
  const seen = new Set<string>();
  const out: { role: string; name: string }[] = [];
  for (const line of snapshot.split('\n')) {
    // `- button "Save"`, or YAML-quoted when the name has a colon: `- 'button "Language: EN"': EN`
    const m = /^\s*-\s+'?([a-z]+)\s+"((?:[^"\\]|\\.)*)"/.exec(line);
    if (!m || !ROLES.has(m[1])) continue;
    let name = m[2];
    try {
      name = JSON.parse(`"${m[2]}"`) as string;
    } catch {
      // keep it as written
    }
    const key = `${m[1]}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: m[1], name });
  }
  return out;
}

/** `role=button[name="Save"]`, or with `exact` the case-sensitive whole-name form `[name="Save"s]`. */
export const roleTarget = (role: string, name: string, exact = false) =>
  `role=${role}[name="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"${exact ? 's' : ''}]`;

/**
 * Open a page and list what a script can act on: every named interactive element with a target and
 * how many elements that target matches (an exact form is tried when the loose one is ambiguous),
 * plus a full-page screenshot in `<dir>/.showtime/inspect/`.
 */
export async function inspect(url: string, opts: { dir?: string; viewport?: { width: number; height: number } } = {}): Promise<InspectResult> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: opts.viewport ?? { width: 1440, height: 900 } });
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    } catch (err) {
      throw new Error(`Cannot open ${url}: ${(err as Error).message.split('\n')[0]}. Is the app running?`);
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    const targets: Target[] = [];
    for (const { role, name } of parseSnapshot(await page.locator('body').ariaSnapshot())) {
      let target = roleTarget(role, name);
      let count = await page.locator(target).count();
      if (count > 1) {
        const exact = roleTarget(role, name, true);
        const exactCount = await page.locator(exact).count();
        if (exactCount >= 1 && exactCount < count) [target, count] = [exact, exactCount];
      }
      if (count > 0) targets.push({ role, name, target, count });
    }
    const dir = path.join(path.resolve(opts.dir ?? process.cwd()), '.showtime', 'inspect');
    await mkdir(dir, { recursive: true });
    const host = new URL(page.url()).host.replace(/[^\w.-]+/g, '-');
    const screenshot = path.join(dir, `${host}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    return { url: page.url(), title: await page.title(), targets, screenshot };
  } finally {
    await browser.close();
  }
}
