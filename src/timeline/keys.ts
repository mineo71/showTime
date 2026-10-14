// Keys on screen: how a `press` combo (Playwright's "Meta+Shift+K") is drawn as keycaps.

/** How long keycaps stay up, in output ms (the next ones replace them sooner). */
export const KEYS_MS = 1400;
/** Their fade in and out. */
export const KEYS_FADE_MS = 150;

const MODIFIER_NAMES = new Set(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift']);

const NAMED: Record<string, string> = {
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  ' ': 'Space',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** The parts of a combo: "Shift++" is Shift and the plus key. */
function parts(combo: string): string[] {
  if (combo === '+') return ['+'];
  if (combo.endsWith('++')) return [...combo.slice(0, -2).split('+'), '+'];
  return combo.split('+');
}

function modifier(name: string, mac: boolean): string {
  switch (name) {
    case 'Meta':
      return '⌘';
    case 'ControlOrMeta':
      return mac ? '⌘' : 'Ctrl';
    case 'Control':
      return mac ? '⌃' : 'Ctrl';
    case 'Alt':
      return mac ? '⌥' : 'Alt';
    default:
      return '⇧';
  }
}

function key(name: string): string {
  if (NAMED[name]) return NAMED[name];
  const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(name);
  if (code) return code[1] ?? code[2];
  return name.length === 1 ? name.toUpperCase() : name;
}

/** Keycaps for a combo: modifiers as Mac symbols on macOS and as words elsewhere. */
export function keyCaps(combo: string, platform: string = process.platform): string[] {
  const mac = platform === 'darwin';
  return parts(combo).map((p) => (MODIFIER_NAMES.has(p) ? modifier(p, mac) : key(p)));
}

/** Whether a combo holds a modifier ("Meta+K"), as opposed to a single key ("Enter"). */
export const hasModifier = (combo: string) => parts(combo).slice(0, -1).some((p) => MODIFIER_NAMES.has(p));
