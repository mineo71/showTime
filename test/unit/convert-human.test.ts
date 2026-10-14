import { describe, expect, it } from 'vitest';
import { followPages, toSteps, toTarget } from '../../src/human/convert';

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
        { name: 'openPage', url: 'http://127.0.0.1:4800/popup' },
        { name: 'closePage' },
        { name: 'fill', selector: '#search', text: '' },
        { name: 'setInputFiles', selector: '#upload', files: [] },
        { name: 'assertText', selector: '#x' },
      ],
      url,
    );
    expect(steps).toEqual([
      { do: 'goto', url: '/app/settings?tab=2' },
      { do: 'goto', url: 'https://other.example/' },
    ]);
    expect(notes).toEqual([
      'fill #search: clearing a field is not replayed; skipped',
      'setInputFiles #upload: clearing a file input is not replayed; skipped',
      'assertText #x: not replayed; skipped',
    ]);
  });

  it('keeps double, right, middle and modifier clicks', () => {
    const { steps, notes } = toSteps(
      [
        { name: 'click', selector: '#row', button: 'left', clickCount: 2, modifiers: 0 },
        { name: 'click', selector: '#row', button: 'left', clickCount: 2, modifiers: 4 },
        { name: 'click', selector: '#menu', button: 'right', clickCount: 1, modifiers: 0 },
        { name: 'click', selector: '#tab', button: 'middle', clickCount: 1, modifiers: 0 },
        { name: 'click', selector: '#r3', button: 'left', clickCount: 1, modifiers: 8 },
        { name: 'click', selector: '#r4', button: 'left', clickCount: 1, modifiers: 1 | 2 },
      ],
      url,
    );
    expect(steps).toEqual([
      { do: 'dblclick', target: '#row' },
      { do: 'dblclick', target: '#row', modifiers: ['Meta'] },
      { do: 'click', target: '#menu', button: 'right' },
      { do: 'click', target: '#tab', button: 'middle' },
      { do: 'click', target: '#r3', modifiers: ['Shift'] },
      { do: 'click', target: '#r4', modifiers: ['Alt', 'Control'] },
    ]);
    expect(notes).toEqual([]);
  });

  it('turns a file pick into an upload, asking to check the paths, and a closed tab into closeTab', () => {
    const { steps, notes } = toSteps(
      [
        { name: 'click', selector: '#pick', button: 'left', clickCount: 1, modifiers: 0 },
        { name: 'setInputFiles', selector: '#file', files: ['logo.png', 'terms.pdf'] },
        { name: 'closeTab' },
      ],
      url,
    );
    expect(steps).toEqual([
      { do: 'upload', target: '#pick', files: ['logo.png', 'terms.pdf'] },
      { do: 'closeTab' },
    ]);
    expect(notes).toEqual(['upload #pick: the recorder knows only file names (logo.png, terms.pdf); check the paths, relative to the script']);
  });
});

describe('followPages', () => {
  const a = (selector: string) => ({ name: 'click', selector, button: 'left', clickCount: 1, modifiers: 0 });

  it('follows a newer page, and closes it with closeTab when the flow goes back', () => {
    const out = followPages(
      [
        { page: 0, action: a('#open') },
        { page: 1, action: a('#in-popup') },
        { page: 0, action: a('#back') },
      ],
      new Set(),
    );
    expect(out.map((x) => x.selector ?? x.name)).toEqual(['#open', '#in-popup', 'closeTab', '#back']);
  });

  it('adds no closeTab for a page that closed itself', () => {
    const out = followPages(
      [
        { page: 0, action: a('#oauth') },
        { page: 1, action: a('#allow') },
        { page: 0, action: a('#next') },
      ],
      new Set([1]),
    );
    expect(out.map((x) => x.selector ?? x.name)).toEqual(['#oauth', '#allow', '#next']);
  });

  it('closes every newer page when the flow jumps back past them', () => {
    const out = followPages(
      [
        { page: 0, action: a('#a') },
        { page: 1, action: a('#b') },
        { page: 2, action: a('#c') },
        { page: 0, action: a('#d') },
      ],
      new Set(),
    );
    expect(out.map((x) => x.selector ?? x.name)).toEqual(['#a', '#b', '#c', 'closeTab', 'closeTab', '#d']);
  });

  it('closes a tab that was opened but never used, unless it closed itself', () => {
    const opened = { page: 0, action: a('#docs'), opens: 1 };
    expect(followPages([opened, { page: 0, action: a('#next') }], new Set()).map((x) => x.selector ?? x.name)).toEqual(['#docs', 'closeTab', '#next']);
    expect(followPages([opened, { page: 0, action: a('#next') }], new Set([1])).map((x) => x.selector ?? x.name)).toEqual(['#docs', '#next']);
    // used later: followed as usual
    expect(followPages([opened, { page: 1, action: a('#in') }, { page: 0, action: a('#next') }], new Set()).map((x) => x.selector ?? x.name)).toEqual([
      '#docs',
      '#in',
      'closeTab',
      '#next',
    ]);
  });
});
