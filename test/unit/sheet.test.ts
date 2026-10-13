import { describe, expect, it } from 'vitest';
import { SHEET_COLUMNS, sheetHtml } from '../../src/sheet';

describe('sheetHtml', () => {
  const html = sheetHtml([
    { file: '/abs/frames/00-intro.png', label: '00-intro' },
    { file: '/abs/frames/01 a<b>.png', label: '01-a-<b>&"c"' },
  ]);

  it('lays the stills out in a fixed number of columns', () => {
    expect(SHEET_COLUMNS).toBe(4);
    expect(html).toContain('grid-template-columns: repeat(4, 1fr)');
  });

  it('references images by file name, so the page loads them from its own folder', () => {
    expect(html).toContain('src="00-intro.png"');
    expect(html).toContain('src="01%20a%3Cb%3E.png"');
    expect(html).not.toContain('/abs/frames');
  });

  it('escapes labels', () => {
    expect(html).toContain('01-a-&lt;b&gt;&amp;&quot;c&quot;');
  });
});
