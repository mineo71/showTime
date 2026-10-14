import { ScriptError } from './schema';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The script for one locale: every object whose keys are all declared locales becomes its value for
 * `locale`, and `{locale}` in strings becomes the code. Missing a locale names the path.
 */
export function localize(raw: unknown, locales: string[], locale: string, at: string[] = []): unknown {
  if (typeof raw === 'string') return raw.replaceAll('{locale}', locale);
  if (Array.isArray(raw)) return raw.map((v, i) => localize(v, locales, locale, [...at, String(i)]));
  if (!isObject(raw)) return raw;
  const keys = Object.keys(raw);
  if (keys.length && keys.every((k) => locales.includes(k))) {
    if (!(locale in raw)) throw new ScriptError(`${at.join('.') || '(root)'} has no "${locale}" value (it has: ${keys.join(', ')})`);
    return localize(raw[locale], locales, locale, at);
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, k === 'locales' && at.length === 0 ? v : localize(v, locales, locale, [...at, k])]));
}
