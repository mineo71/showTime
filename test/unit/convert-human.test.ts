import { describe, expect, it } from 'vitest';
import { toSteps, toTarget } from '../../src/human/convert';

describe('toTarget', () => {
  it('rewrites internal selectors only where the public form matches the same elements', () => {
    // internal:role names match case-insensitive substrings; the public twin of that is name*="…"i.
    expect(toTarget('internal:role=button[name="New report"i]')).toBe('role=button[name*="New report"i]');
    expect(toTarget('internal:role=link[name="Inbox"i]')).toBe('role=link[name*="Inbox"i]');
    expect(toTarget('internal:role=heading[name="Plans"i][level=2]')).toBe('role=heading[name*="Plans"i][level=2]');
    expect(toTarget('internal:text="Export CSV"i')).toBe('text=Export CSV');
    expect(toTarget('internal:testid=[data-testid="save"s]')).toBe('[data-testid="save"]');
    expect(toTarget('internal:role=row[name="INV-2048"i] >> internal:role=button[name="Open"i]')).toBe(
      'role=row[name*="INV-2048"i] >> role=button[name*="Open"i]',
    );
  });

  it('keeps everything else as recorded', () => {
    expect(toTarget('internal:role=button[name="Save"s]')).toBe('internal:role=button[name="Save"s]');
    expect(toTarget('internal:text="Save"s')).toBe('internal:text="Save"s');
    expect(toTarget('internal:text="/a/"i')).toBe('internal:text="/a/"i');
    expect(toTarget("internal:text=\"'Hello'\"i")).toBe("internal:text=\"'Hello'\"i");
    expect(toTarget('internal:label="Period"i')).toBe('internal:label="Period"i');
    expect(toTarget('#create')).toBe('#create');
    expect(toTarget('internal:text="say \\"hi\\""i')).toBe('internal:text="say \\"hi\\""i');
  });
});

describe('toSteps', () => {
  const url = 'http://127.0.0.1:4800/app/';

  it('turns a click followed by a fill on the same field into one type step', () => {
    const { steps, notes } = toSteps(
      [
        { name: 'click', selector: 'internal:role=button[name="New report"i]', button: 'left', clickCount: 1, modifiers: 0 },
        { name: 'click', selector: 'internal:role=textbox[name="Name"i]', button: 'left', clickCount: 1, modifiers: 0 },
        { name: 'fill', selector: 'internal:role=textbox[name="Name"i]', text: 'Q3 revenue' },
        { name: 'select', selector: 'internal:label="Period"i', options: ['30d', '7d'] },
        { name: 'press', selector: 'internal:role=textbox[name="Name"i]', key: 'k', modifiers: 4 | 8 },
        { name: 'check', selector: '#agree' },
      ],
      url,
    );
    expect(steps).toEqual([
      { do: 'click', target: 'role=button[name*="New report"i]' },
      { do: 'type', target: 'role=textbox[name*="Name"i]', text: 'Q3 revenue' },
      { do: 'select', target: 'internal:label="Period"i', value: '30d' },
      { do: 'press', key: 'Meta+Shift+k' },
      { do: 'click', target: '#agree' },
    ]);
    expect(notes).toEqual(['select internal:label="Period"i: picked the first of 2 options (30d)']);
  });

  it('makes same-origin navigations relative and skips what it cannot replay, with a note', () => {
    const { steps, notes } = toSteps(
      [
        { name: 'navigate', url: 'http://127.0.0.1:4800/app/settings?tab=2' },
        { name: 'navigate', url: 'https://other.example/' },
        { name: 'click', selector: '#menu', button: 'right', clickCount: 1, modifiers: 0 },
        { name: 'click', selector: '#row', button: 'left', clickCount: 2, modifiers: 0 },
        { name: 'openPage', url: 'http://127.0.0.1:4800/popup' },
        { name: 'setInputFiles', selector: '#upload' },
        { name: 'fill', selector: '#search', text: '' },
      ],
      url,
    );
    expect(steps).toEqual([
      { do: 'goto', url: '/app/settings?tab=2' },
      { do: 'goto', url: 'https://other.example/' },
      { do: 'click', target: '#row' },
    ]);
    expect(notes).toEqual([
      'click #menu: right clicks are not replayed; skipped',
      'click #row: a double click is replayed as one click',
      'a new tab or popup opened; showTime records one page, so it was skipped',
      'setInputFiles #upload: file uploads are not replayed; skipped',
      'fill #search: clearing a field is not replayed; skipped',
    ]);
  });
});
