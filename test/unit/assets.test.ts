import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontDataUri, imageDataUri } from '../../src/assets';

describe('embedded assets', () => {
  it('embeds font files by type, refusing other types and files over 5 MB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'showtime-assets-'));
    for (const [ext, type] of [['woff2', 'font/woff2'], ['woff', 'font/woff'], ['ttf', 'font/ttf'], ['otf', 'font/otf']]) {
      await writeFile(join(dir, `f.${ext}`), 'abc');
      expect(await fontDataUri(join(dir, `f.${ext}`), 'style.fonts[0].file')).toBe(`data:${type};base64,YWJj`);
    }
    await writeFile(join(dir, 'f.eot'), 'x');
    await expect(fontDataUri(join(dir, 'f.eot'), 'style.fonts[0].file')).rejects.toThrow(/style\.fonts\[0\]\.file must be a woff2, woff, ttf or otf file/);
    await writeFile(join(dir, 'big.ttf'), Buffer.alloc(5_000_001));
    await expect(fontDataUri(join(dir, 'big.ttf'), 'style.fonts[1].file')).rejects.toThrow(/style\.fonts\[1\]\.file is larger than 5 MB/);
  });

  it('names the field in image errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'showtime-assets-'));
    await writeFile(join(dir, 'w.gif'), 'x');
    await expect(imageDataUri(join(dir, 'w.gif'), 'style.watermark.image')).rejects.toThrow(/style\.watermark\.image must be an SVG, PNG, JPEG or WebP/);
  });
});
