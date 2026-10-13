import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { formatIssues, MetaSchema, ScriptError, StyleSchema } from './schema';

export const CONFIG_FILE = 'showtime.config.json';

type Json = Record<string, unknown>;

export interface BrandConfig {
  style?: Json;
  meta?: Json;
}

// Validated on its own so mistakes are blamed on this file; the raw values are what get merged.
const ConfigSchema = z
  .object({ $schema: z.string().optional(), style: StyleSchema.partial().optional(), meta: MetaSchema.partial().optional() })
  .strict();

/** The nearest showtime.config.json from `dir` upward, or null. */
export function findConfig(dir: string): string | null {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const file = path.join(d, CONFIG_FILE);
    if (existsSync(file)) return file;
    if (path.dirname(d) === d) return null;
  }
}

/** Read a brand file; paths inside it (meta.logo) resolve against its folder. */
export async function readConfig(file: string): Promise<BrandConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new ScriptError(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ScriptError(`Invalid ${file}:\n${formatIssues(parsed.error.issues)}`);
  const { style, meta } = raw as BrandConfig;
  return { style, meta: withLogoFrom(meta, path.dirname(file)) };
}

/** meta with `logo` made absolute against `dir` (when it is a string). */
export function withLogoFrom(meta: Json | undefined, dir: string): Json | undefined {
  if (!meta || typeof meta.logo !== 'string') return meta;
  return { ...meta, logo: path.resolve(dir, meta.logo) };
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Brand defaults under the raw script: the script wins key by key in `style` and `meta`. */
export function applyConfig(config: BrandConfig, raw: Json): Json {
  const merged: Json = { ...raw };
  if (config.style) merged.style = isObject(raw.style) ? { ...config.style, ...raw.style } : (raw.style ?? config.style);
  if (config.meta) merged.meta = isObject(raw.meta) ? { ...config.meta, ...raw.meta } : (raw.meta ?? config.meta);
  return merged;
}
