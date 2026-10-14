import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyConfig, findConfig, readConfig, withLogoFrom, withMusicFrom } from './config';
import { parseScript, ScriptError, type Script } from './schema';

export interface LoadedScript {
  script: Script;
  scriptPath: string;
  dir: string;
  name: string;
  /** The showtime.config.json whose defaults were applied, if any. */
  config: string | null;
}

export async function loadScript(file: string): Promise<LoadedScript> {
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
  return parseLoaded(raw, scriptPath);
}

/** Validate a script's JSON as if it were read from `file`: brand file, relative paths, checks. */
export async function parseLoaded(json: unknown, file: string): Promise<LoadedScript> {
  const scriptPath = path.resolve(file);
  let raw = structuredClone(json);
  const dir = path.dirname(scriptPath);
  const config = findConfig(dir);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const own = raw as Record<string, unknown>;
    if (own.meta && typeof own.meta === 'object') own.meta = withLogoFrom(own.meta as Record<string, unknown>, dir);
    if (own.audio && typeof own.audio === 'object') own.audio = withMusicFrom(own.audio as Record<string, unknown>, dir);
    if (config) raw = applyConfig(await readConfig(config), own);
  }
  const script = parseScript(raw, scriptPath);
  if (script.meta.logo && !existsSync(script.meta.logo)) throw new ScriptError(`meta.logo not found: ${script.meta.logo}`);
  const music = script.audio.music?.file;
  if (music && !existsSync(music)) throw new ScriptError(`audio.music.file not found: ${music}`);
  script.audio.clips.forEach((clip, i) => {
    if (!existsSync(clip.file)) throw new ScriptError(`audio.clips[${i}].file not found: ${clip.file}`);
  });
  if (script.app.storageState) {
    script.app.storageState = path.resolve(dir, script.app.storageState);
    if (!existsSync(script.app.storageState)) {
      throw new ScriptError(`app.storageState not found: ${script.app.storageState}`);
    }
  }
  return { script, scriptPath, dir, name: path.basename(scriptPath).replace(/\.json$/i, ''), config };
}
