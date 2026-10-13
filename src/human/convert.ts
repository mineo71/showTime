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
}

export type HumanStep =
  | { do: 'click'; target: string }
  | { do: 'type'; target: string; text: string }
  | { do: 'select'; target: string; value: string }
  | { do: 'press'; key: string }
  | { do: 'goto'; url: string };

/** One part of a selector chain, rewritten to its public form when it has one. */
function part(p: string): string {
  if (p.startsWith('internal:role=')) return p.slice('internal:'.length);
  const text = /^internal:text="([^"\\]*)"([is])$/.exec(p);
  if (text) return text[2] === 'i' ? `text=${text[1]}` : `text="${text[1]}"`;
  const testid = /^internal:testid=\[([\w-]+)="([^"\\]*)"s\]$/.exec(p);
  if (testid) return `[${testid[1]}="${testid[2]}"]`;
  return p;
}

/** A recorded selector as a readable target; anything without a public twin stays as recorded. */
export const toTarget = (selector: string): string => selector.split(' >> ').map(part).join(' >> ');

const MODIFIERS: Array<[bit: number, name: string]> = [
  [1, 'Alt'],
  [2, 'Control'],
  [4, 'Meta'],
  [8, 'Shift'],
];

const keyCombo = (key: string, modifiers = 0) => [...MODIFIERS.filter(([bit]) => modifiers & bit).map(([, n]) => n), key].join('+');

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
        if (a.button && a.button !== 'left') {
          notes.push(`${what}: ${a.button} clicks are not replayed; skipped`);
          break;
        }
        if ((a.clickCount ?? 1) > 1) notes.push(`${what}: a double click is replayed as one click`);
        steps.push({ do: 'click', target });
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
      case 'openPage':
        if (steps.length || actions.indexOf(a) > 0) notes.push('a new tab or popup opened; showTime records one page, so it was skipped');
        break;
      case 'closePage':
        break;
      case 'setInputFiles':
        notes.push(`${what}: file uploads are not replayed; skipped`);
        break;
      default:
        notes.push(`${what}: not replayed; skipped`);
    }
  }
  return { steps, notes };
}
