import { readFile } from 'node:fs/promises';
import path from 'node:path';

const IMAGES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const FONTS: Record<string, string> = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const IMAGE_BYTES = 2_000_000;
const FONT_BYTES = 5_000_000;

async function dataUri(file: string, field: string, types: Record<string, string>, kinds: string, maxBytes: number): Promise<string> {
  const type = types[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`${field} must be ${kinds} file: ${file}`);
  const data = await readFile(file);
  if (data.length > maxBytes) throw new Error(`${field} is larger than ${maxBytes / 1_000_000} MB: ${file}`);
  return `data:${type};base64,${data.toString('base64')}`;
}

/** An image (logo, watermark) as a data URI, so timeline.json carries it to the renderer. */
export const imageDataUri = (file: string, field: string) => dataUri(file, field, IMAGES, 'an SVG, PNG, JPEG or WebP', IMAGE_BYTES);

/** A font file as a data URI, embedded into the video whether or not the machine has the font. */
export const fontDataUri = (file: string, field: string) => dataUri(file, field, FONTS, 'a woff2, woff, ttf or otf', FONT_BYTES);
