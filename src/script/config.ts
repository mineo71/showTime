import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AudioSchema, formatIssues, MetaSchema, ScriptError, StyleSchema } from './schema';

export const CONFIG_FILE = 'showtime.config.json';

type Json = Record<string, unknown>;

export interface BrandConfig {
  style?: Json;
  meta?: Json;
  audio?: Json;
}

// Validated on its own so mistakes are blamed on this file; the raw values are what get merged.
const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    style: StyleSchema.partial().optional(),
    meta: MetaSchema.partial().optional(),
    audio: AudioSchema.partial().optional(),
  })
  .strict();

/** The nearest showtime.config.json from `dir` upward, or null. */
export function findConfig(dir: string): string | null {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const file = path.join(d, CONFIG_FILE);
    if (existsSync(file)) return file;
    if (path.dirname(d) === d) return null;
  }
}

/**
 * Read a brand file; paths inside it (meta.logo, audio.music.file, …) resolve against its folder.
 * `prepare` (localizing) runs on the raw JSON first.
 */
export async function readConfig(file: string, prepare: (raw: unknown) => unknown = (r) => r): Promise<BrandConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new ScriptError(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
  try {
    raw = prepare(raw);
  } catch (err) {
    throw new ScriptError(`${file}: ${(err as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ScriptError(`Invalid ${file}:\n${formatIssues(parsed.error.issues)}`);
  const { style, meta, audio } = raw as BrandConfig;
  const dir = path.dirname(file);
  return { style: withStyleFrom(style, dir), meta: withLogoFrom(meta, dir), audio: withMusicFrom(audio, dir) };
}

/** meta with `logo` made absolute against `dir` (when it is a string). */
export function withLogoFrom(meta: Json | undefined, dir: string): Json | undefined {
  if (!meta || typeof meta.logo !== 'string') return meta;
  return { ...meta, logo: path.resolve(dir, meta.logo) };
}

/** style with font files and the watermark image made absolute against `dir`. */
export function withStyleFrom(style: Json | undefined, dir: string): Json | undefined {
  if (!style) return style;
  const out: Json = { ...style };
  if (Array.isArray(style.fonts)) {
    out.fonts = style.fonts.map((f) => (isObject(f) && typeof f.file === 'string' ? { ...f, file: path.resolve(dir, f.file) } : f));
  }
  const wm = style.watermark;
  if (isObject(wm) && typeof wm.image === 'string') out.watermark = { ...wm, image: path.resolve(dir, wm.image) };
  return out;
}

/** audio with `music.file`, `clips[].file` and sound files made absolute against `dir` (where they are strings). */
export function withMusicFrom(audio: Json | undefined, dir: string): Json | undefined {
  if (!audio) return audio;
  const out: Json = { ...audio };
  const sounds = audio.sounds;
  if (isObject(sounds)) {
    out.sounds = {
      ...sounds,
      ...(typeof sounds.click === 'string' ? { click: path.resolve(dir, sounds.click) } : {}),
      ...(typeof sounds.key === 'string' ? { key: path.resolve(dir, sounds.key) } : {}),
    };
  }
  const music = audio.music;
  if (isObject(music) && typeof music.file === 'string') out.music = { ...music, file: path.resolve(dir, music.file) };
  if (Array.isArray(audio.clips)) {
    out.clips = audio.clips.map((c) => (isObject(c) && typeof c.file === 'string' ? { ...c, file: path.resolve(dir, c.file) } : c));
  }
  return out;
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Brand defaults under the raw script: the script wins key by key in `style`, `meta` and `audio`. */
export function applyConfig(config: BrandConfig, raw: Json): Json {
  const merged: Json = { ...raw };
  for (const key of ['style', 'meta', 'audio'] as const) {
    const defaults = config[key];
    if (defaults) merged[key] = isObject(raw[key]) ? { ...defaults, ...raw[key] } : (raw[key] ?? defaults);
  }
  return merged;
}
