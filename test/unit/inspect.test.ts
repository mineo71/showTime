import { describe, expect, it } from 'vitest';
import { parseSnapshot, roleTarget } from '../../src/inspect';

const SNAPSHOT = `- banner:
  - link "Lviv-Pak":
    - /url: /en
  - 'button "Language: EN"': EN
  - button "Request a Quote"
- main:
  - heading "One of the leading manufacturers" [level=1]
  - textbox "Name":
    - /placeholder: " "
  - combobox "Country":
    - option "Austria"
  - button "Say \\"hi\\""
  - button "Request a Quote"
  - tab "Pallets" [selected]
  - checkbox "Anonymous" [checked]
  - img "Forest"`;

describe('parseSnapshot', () => {
  it('lists interactive elements once each, with names unquoted', () => {
    expect(parseSnapshot(SNAPSHOT)).toEqual([
      { role: 'link', name: 'Lviv-Pak' },
      { role: 'button', name: 'Language: EN' },
      { role: 'button', name: 'Request a Quote' },
      { role: 'textbox', name: 'Name' },
      { role: 'combobox', name: 'Country' },
      { role: 'button', name: 'Say "hi"' },
      { role: 'tab', name: 'Pallets' },
      { role: 'checkbox', name: 'Anonymous' },
    ]);
  });
});

describe('roleTarget', () => {
  it('builds a role target, escaping quotes and backslashes, optionally exact', () => {
    expect(roleTarget('button', 'Request a Quote')).toBe('role=button[name="Request a Quote"]');
    expect(roleTarget('button', 'Say "hi"')).toBe('role=button[name="Say \\"hi\\""]');
    expect(roleTarget('link', 'Inbox', true)).toBe('role=link[name="Inbox"s]');
  });
});
