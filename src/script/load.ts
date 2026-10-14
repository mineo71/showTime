import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyConfig, findConfig, readConfig, withLogoFrom, withMusicFrom, withStyleFrom } from './config';
import { localize } from './locales';
import { parseScript, ScriptError, voiceFor, voiceProblems, type Script } from './schema';

export interface LoadedScript {
  script: Script;
  scriptPath: string;
  dir: string;
  /** the work and output name: the file's name, plus `.<locale>` for a localized script */
  name: string;
  /** the locale this script was loaded in, when it declares `locales` */
  locale: string | null;
  /** The showtime.config.json whose defaults were applied, if any. */
  config: string | null;
}

export interface LoadOptions {
  /** one of the script's `locales` (default: the first) */
  locale?: string;
}

export async function loadScript(file: string, opts: LoadOptions = {}): Promise<LoadedScript> {
  const scriptPath = path.resolve(file);
  let text: string;
  try {
    text = await readFile(scriptPath, 'utf8');
  } catch {
    throw new ScriptError(`Cannot read script: ${scriptPath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ScriptError(`Invalid JSON in ${scriptPath}: ${(err as Error).message}`);
  }
  return parseLoaded(raw, scriptPath, opts);
}

/** The script's declared locales (null without any) and the one to load: `locale`, else the first. */
export function pickLocale(json: unknown, file: string, locale?: string): { locales: string[] | null; locale: string | null } {
  const declared = (json as { locales?: unknown } | null)?.locales;
  const locales = Array.isArray(declared) && declared.every((l) => typeof l === 'string') ? (declared as string[]) : null;
  if (locale && !locales) throw new ScriptError(`--locale ${locale}: ${path.resolve(file)} has no "locales".`);
  if (!locales) return { locales: null, locale: null };
  if (locale && !locales.includes(locale)) throw new ScriptError(`--locale ${locale} is not one of: ${locales.join(', ')}`);
  return { locales, locale: locale ?? locales[0] };
}

/** Validate a script's JSON as if it were read from `file`: brand file, relative paths, checks. */
export async function parseLoaded(json: unknown, file: string, opts: LoadOptions = {}): Promise<LoadedScript> {
  const scriptPath = path.resolve(file);
  const dir = path.dirname(scriptPath);
  // A localized script is loaded for one locale; everything below sees plain values.
  const { locales, locale } = pickLocale(json, scriptPath, opts.locale);
  const prepare = (value: unknown) => (locales && locale ? localize(value, locales, locale) : value);
  let raw = prepare(structuredClone(json));
  const config = findConfig(dir);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const own = raw as Record<string, unknown>;
    if (own.meta && typeof own.meta === 'object') own.meta = withLogoFrom(own.meta as Record<string, unknown>, dir);
    if (own.audio && typeof own.audio === 'object') own.audio = withMusicFrom(own.audio as Record<string, unknown>, dir);
    if (own.style && typeof own.style === 'object') own.style = withStyleFrom(own.style as Record<string, unknown>, dir);
    if (own.replay && typeof own.replay === 'object' && typeof (own.replay as { file?: unknown }).file === 'string') {
      own.replay = { ...(own.replay as object), file: path.resolve(dir, (own.replay as { file: string }).file) };
    }
    if (config) raw = applyConfig(await readConfig(config, prepare), own);
  }
  const script = parseScript(raw, scriptPath);
  if (script.meta.logo && !existsSync(script.meta.logo)) throw new ScriptError(`meta.logo not found: ${script.meta.logo}`);
  const music = script.audio.music?.file;
  if (music && !existsSync(music)) throw new ScriptError(`audio.music.file not found: ${music}`);
  const mustExist = (file: string | undefined, what: string) => {
    if (file && !existsSync(file)) throw new ScriptError(`${what} not found: ${file}`);
  };
  script.style.fonts.forEach((f, i) => mustExist(f.file, `style.fonts[${i}].file`));
  mustExist(script.style.watermark?.image, 'style.watermark.image');
  if (typeof script.audio.sounds === 'object') {
    mustExist(script.audio.sounds.click, 'audio.sounds.click');
    mustExist(script.audio.sounds.key, 'audio.sounds.key');
  }
  // A step's voice changes are checked merged over audio.voice.
  for (const scene of script.scenes) {
    scene.steps.forEach((step, i) => {
      if (!step.show?.voice) return;
      const problem = voiceProblems(voiceFor(script.audio.voice, step.show.voice as Partial<typeof script.audio.voice>))[0];
      if (problem) throw new ScriptError(`${scene.id}#${i + 1} show.voice: ${problem.message}`);
    });
  }
  const steps = new Set(script.scenes.flatMap((s) => s.steps.map((_, i) => `${s.id}#${i + 1}`)));
  script.audio.clips.forEach((clip, i) => {
    if (!existsSync(clip.file)) throw new ScriptError(`audio.clips[${i}].file not found: ${clip.file}`);
    if (!steps.has(clip.at)) throw new ScriptError(`audio.clips[${i}].at: no step ${clip.at} in the script (scene ids and step numbers, e.g. ${[...steps][0]})`);
  });
  if (script.app.storageState) {
    script.app.storageState = path.resolve(dir, script.app.storageState);
    if (!existsSync(script.app.storageState)) {
      throw new ScriptError(`app.storageState not found: ${script.app.storageState}`);
    }
  }
  const base = path.basename(scriptPath).replace(/\.json$/i, '');
  return { script, scriptPath, dir, name: locale ? `${base}.${locale}` : base, locale, config };
}
