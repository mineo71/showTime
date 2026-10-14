// Playwright's recorded actions → showTime steps.

/** An action as Playwright's recorder reports it (the fields showTime uses). */
export interface RecordedAction {
  name: string;
  selector?: string;
  text?: string;
  key?: string;
  /** Alt 1, Control 2, Meta 4, Shift 8 */
  modifiers?: number;
  options?: string[];
  button?: string;
  clickCount?: number;
  url?: string;
  /** setInputFiles: file names only (the recorder never sees paths) */
  files?: string[];
}

type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export type HumanStep =
  | { do: 'click'; target: string; button?: 'right' | 'middle'; modifiers?: Modifier[] }
  | { do: 'dblclick'; target: string; modifiers?: Modifier[] }
  | { do: 'upload'; target: string; files: string[] }
  | { do: 'closeTab' }
  | { do: 'type'; target: string; text: string }
  | { do: 'select'; target: string; value: string }
  | { do: 'press'; key: string }
  | { do: 'goto'; url: string };

/**
 * One part of a selector chain, rewritten to its public form only where that form matches the same
 * elements. The recorder's role names and `i` texts are case-insensitive substrings (it shortens long
 * names); exact (`s`) matches have no public twin with the same meaning, so they stay as recorded.
 */
function part(p: string): string {
  const role = /^internal:role=(\w+)((?:\[[^\]]*\])*)$/.exec(p);
  if (role && !/"s\]/.test(role[2])) return `role=${role[1]}${role[2].replace(/\[name="/g, '[name*="')}`;
  const text = /^internal:text="([^"\\]*)"i$/.exec(p);
  // `text=/x/` would be a regex and `text='x'` an exact match: those stay as recorded.
  if (text && !/^[/'"\s]/.test(text[1]) && !/\s$/.test(text[1])) return `text=${text[1]}`;
  const testid = /^internal:testid=\[([\w-]+)="([^"\\]*)"s\]$/.exec(p);
  if (testid) return `[${testid[1]}="${testid[2]}"]`;
  return p;
}

/** A recorded selector as a readable target; anything without a public twin stays as recorded. */
export const toTarget = (selector: string): string => selector.split(' >> ').map(part).join(' >> ');

const MODIFIERS: Array<[bit: number, name: Modifier]> = [
  [1, 'Alt'],
  [2, 'Control'],
  [4, 'Meta'],
  [8, 'Shift'],
];

const modifierNames = (modifiers = 0) => MODIFIERS.filter(([bit]) => modifiers & bit).map(([, n]) => n);
const keyCombo = (key: string, modifiers = 0) => [...modifierNames(modifiers), key].join('+');

/** A navigation as a goto: relative to the app when it stays on the app's origin. */
function gotoUrl(url: string, appUrl: string): string {
  try {
    const to = new URL(url);
    return to.origin === new URL(appUrl).origin ? `${to.pathname}${to.search}${to.hash}` : url;
  } catch {
    return url;
  }
}

/** Convert recorded actions to steps, with a note for everything that can't be replayed as recorded. */
export function toSteps(actions: RecordedAction[], appUrl: string): { steps: HumanStep[]; notes: string[] } {
  const steps: HumanStep[] = [];
  const notes: string[] = [];
  for (const a of actions) {
    const target = a.selector ? toTarget(a.selector) : '';
    const what = `${a.name} ${a.selector ?? ''}`.trim();
    switch (a.name) {
      case 'click': {
        const modifiers = modifierNames(a.modifiers);
        const mods = modifiers.length ? { modifiers } : {};
        if ((a.clickCount ?? 1) > 1) steps.push({ do: 'dblclick', target, ...mods });
        else if (a.button === 'right' || a.button === 'middle') steps.push({ do: 'click', target, button: a.button, ...mods });
        else steps.push({ do: 'click', target, ...mods });
        break;
      }
      case 'check':
      case 'uncheck':
        steps.push({ do: 'click', target });
        break;
      case 'fill': {
        if (!a.text) {
          notes.push(`${what}: clearing a field is not replayed; skipped`);
          break;
        }
        // `type` clicks the field itself, so a click on it just before is folded in.
        const prev = steps.at(-1);
        if (prev?.do === 'click' && prev.target === target) steps.pop();
        steps.push({ do: 'type', target, text: a.text });
        break;
      }
      case 'select': {
        const options = a.options ?? [];
        if (!options.length) break;
        if (options.length > 1) notes.push(`${what}: picked the first of ${options.length} options (${options[0]})`);
        steps.push({ do: 'select', target, value: options[0] });
        break;
      }
      case 'press':
        if (a.key) steps.push({ do: 'press', key: keyCombo(a.key, a.modifiers) });
        break;
      case 'navigate':
        if (a.url) steps.push({ do: 'goto', url: gotoUrl(a.url, appUrl) });
        break;
      // A step that opens a page is followed into it; the recorder decides when a closed one needs closeTab.
      case 'openPage':
      case 'closePage':
        break;
      case 'closeTab':
        steps.push({ do: 'closeTab' });
        break;
      case 'setInputFiles': {
        const files = a.files ?? [];
        if (!files.length) {
          notes.push(`${what}: clearing a file input is not replayed; skipped`);
          break;
        }
        // The click that opened the file chooser is what a person does: the upload targets it.
        const prev = steps.at(-1);
        const opener = prev?.do === 'click' && !prev.button && !prev.modifiers ? (steps.pop() as { target: string }).target : target;
        steps.push({ do: 'upload', target: opener, files });
        notes.push(`upload ${opener}: the recorder knows only file names (${files.join(', ')}); check the paths, relative to the script`);
        break;
      }
      default:
        notes.push(`${what}: not replayed; skipped`);
    }
  }
  return { steps, notes };
}

/**
 * Actions recorded across pages (0 = the first page, higher = opened later), in one line a script
 * can replay: a newer page is followed into (the runner does that by itself), and going back to an
 * older page closes the newer ones with closeTab, except those that closed themselves.
 */
export function followPages(entries: Array<{ page: number; action: RecordedAction }>, selfClosed: ReadonlySet<number>): RecordedAction[] {
  const stack = [0];
  const out: RecordedAction[] = [];
  for (const { page, action } of entries) {
    if (stack.includes(page)) {
      while (stack[stack.length - 1] !== page) {
        const closed = stack.pop()!;
        if (!selfClosed.has(closed)) out.push({ name: 'closeTab' });
      }
    } else stack.push(page);
    out.push(action);
  }
  return out;
}
