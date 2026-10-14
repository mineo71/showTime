import type { FontFile } from '../../timeline/types';

/** A CSS identifier sequence: what a family name may be without quotes (no leading digits). */
const IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

/**
 * A `font-family` value with every name CSS would reject unquoted ("Source Sans 3", "Inter 18pt")
 * put in quotes. Quoted names and valid identifiers (generics included) stay as they are.
 */
export function cssFamily(value: string): string {
  return value
    .split(',')
    .map((part) => {
      const name = part.trim();
      if (!name || /^".*"$|^'.*'$/.test(name)) return name;
      if (name.split(/\s+/).every((word) => IDENT.test(word))) return name;
      return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    })
    .join(', ');
}

/** A cheap fingerprint of a (possibly megabytes long) data URI. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/** What identifies a loaded face: family, weight, style and the file itself. */
export const fontKey = (f: FontFile) => `${f.family}|${f.weight ?? 'normal'}|${f.style ?? 'normal'}|${hash(f.src)}`;

/** Fonts to load and faces to drop, given what is loaded (by key) and what the timeline wants. */
export function fontPlan(loaded: Set<string>, wanted: FontFile[]): { add: FontFile[]; remove: string[] } {
  const keys = new Set(wanted.map(fontKey));
  return { add: wanted.filter((f) => !loaded.has(fontKey(f))), remove: [...loaded].filter((k) => !keys.has(k)) };
}
