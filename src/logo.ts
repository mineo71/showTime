import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const MAX_BYTES = 2_000_000;

/** The logo file as a data URI, so timeline.json carries it to the renderer without extra files. */
export async function logoDataUri(file: string): Promise<string> {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`meta.logo must be an SVG, PNG, JPEG or WebP file: ${file}`);
  const data = await readFile(file);
  if (data.length > MAX_BYTES) throw new Error(`meta.logo is larger than 2 MB: ${file}`);
  return `data:${type};base64,${data.toString('base64')}`;
}
