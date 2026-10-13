import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { logoDataUri } from '../../src/logo';

describe('logoDataUri', () => {
  it('embeds an image as a data URI typed by its extension', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-logo-'));
    const file = path.join(dir, 'Logo.SVG');
    await writeFile(file, '<svg/>');
    expect(await logoDataUri(file)).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);
  });

  it('rejects formats the renderer cannot show', async () => {
    await expect(logoDataUri('/x/logo.gif')).rejects.toThrow(/SVG, PNG, JPEG or WebP/);
  });
});
