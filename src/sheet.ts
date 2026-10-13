import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const SHEET_COLUMNS = 4;
export const SHEET_WIDTH = 1920;

export interface SheetItem {
  file: string;
  label: string;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ENTITIES[c]);

/** A page laying the stills out in a labelled grid; images load by file name from the page's own folder. */
export function sheetHtml(items: SheetItem[]): string {
  const figures = items
    .map((i) => `<figure><img src="${encodeURIComponent(path.basename(i.file))}"><figcaption>${esc(i.label)}</figcaption></figure>`)
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #0b0f17; color: #e2e8f0; font: 600 18px/1.3 -apple-system, "Segoe UI", system-ui, sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(${SHEET_COLUMNS}, 1fr); gap: 16px; padding: 24px; width: ${SHEET_WIDTH}px; box-sizing: border-box; }
  figure { margin: 0; }
  img { display: block; width: 100%; border-radius: 6px; }
  figcaption { margin-top: 8px; }
</style></head><body><div class="grid">
${figures}
</div></body></html>`;
}

/** Render the stills (all in one folder) into one labelled PNG at `out`, next to them. */
export async function contactSheet(items: SheetItem[], out: string): Promise<string> {
  const html = path.join(path.dirname(out), 'sheet.html');
  await writeFile(html, sheetHtml(items));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SHEET_WIDTH, height: 600 } });
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
    await page.screenshot({ path: out, fullPage: true });
  } finally {
    await browser.close();
  }
  return out;
}
