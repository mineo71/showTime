/** A whole, non-negative number of ms as typed: null for empty (remove the value), 'invalid' for anything else. */
export function parseWholeMs(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : 'invalid';
}
