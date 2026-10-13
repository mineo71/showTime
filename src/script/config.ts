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

/** Read a brand file; paths inside it (meta.logo, audio.music.file) resolve against its folder. */
export async function readConfig(file: string): Promise<BrandConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new ScriptError(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ScriptError(`Invalid ${file}:\n${formatIssues(parsed.error.issues)}`);
  const { style, meta, audio } = raw as BrandConfig;
  const dir = path.dirname(file);
  return { style, meta: withLogoFrom(meta, dir), audio: withMusicFrom(audio, dir) };
}

/** meta with `logo` made absolute against `dir` (when it is a string). */
export function withLogoFrom(meta: Json | undefined, dir: string): Json | undefined {
  if (!meta || typeof meta.logo !== 'string') return meta;
  return { ...meta, logo: path.resolve(dir, meta.logo) };
}

/** audio with `music.file` made absolute against `dir` (when it is a string). */
export function withMusicFrom(audio: Json | undefined, dir: string): Json | undefined {
  const music = audio?.music;
  if (!isObject(music) || typeof music.file !== 'string') return audio;
  return { ...audio, music: { ...music, file: path.resolve(dir, music.file) } };
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
