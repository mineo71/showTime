/** Words in a caption or line. */
export const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Reading time for a caption: half a second to notice it, a quarter per word, never under 1.2 s. */
export const readingMs = (text: string) => Math.max(1200, 500 + 250 * words(text));
