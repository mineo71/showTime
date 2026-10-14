import { describe, expect, it } from 'vitest';
import { hasModifier, keyCaps } from '../../src/timeline/keys';

describe('keyCaps', () => {
  it('draws modifiers as the Mac symbols on macOS and as words elsewhere', () => {
    expect(keyCaps('Meta+Shift+K', 'darwin')).toEqual(['⌘', '⇧', 'K']);
    expect(keyCaps('Control+s', 'linux')).toEqual(['Ctrl', 'S']);
    expect(keyCaps('Control+s', 'darwin')).toEqual(['⌃', 'S']);
    expect(keyCaps('Alt+Tab', 'win32')).toEqual(['Alt', 'Tab']);
    expect(keyCaps('Alt+Tab', 'darwin')).toEqual(['⌥', 'Tab']);
  });

  it("draws ControlOrMeta as the platform's own", () => {
    expect(keyCaps('ControlOrMeta+Enter', 'darwin')).toEqual(['⌘', 'Enter']);
    expect(keyCaps('ControlOrMeta+Enter', 'linux')).toEqual(['Ctrl', 'Enter']);
  });

  it('names special keys briefly and capitalises letters', () => {
    expect(keyCaps('Escape')).toEqual(['Esc']);
    expect(keyCaps('ArrowDown')).toEqual(['↓']);
    expect(keyCaps('Backspace')).toEqual(['⌫']);
    expect(keyCaps('KeyA')).toEqual(['A']);
    expect(keyCaps('Digit7')).toEqual(['7']);
    expect(keyCaps(' ')).toEqual(['Space']);
    expect(keyCaps('F5')).toEqual(['F5']);
  });

  it('reads a plus key after a modifier', () => {
    expect(keyCaps('Shift++', 'linux')).toEqual(['⇧', '+']);
    expect(keyCaps('+')).toEqual(['+']);
  });
});

describe('hasModifier', () => {
  it('tells combos from single keys', () => {
    expect(hasModifier('Meta+K')).toBe(true);
    expect(hasModifier('ControlOrMeta+Enter')).toBe(true);
    expect(hasModifier('Enter')).toBe(false);
    expect(hasModifier('+')).toBe(false);
  });
});
