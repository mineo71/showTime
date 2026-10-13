import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseScript, ScriptError, type Script } from './schema';

export interface LoadedScript {
  script: Script;
  scriptPath: string;
  dir: string;
  name: string;
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
  const script = parseScript(raw, scriptPath);
  const dir = path.dirname(scriptPath);
  if (script.app.storageState) {
    script.app.storageState = path.resolve(dir, script.app.storageState);
    if (!existsSync(script.app.storageState)) {
      throw new ScriptError(`app.storageState not found: ${script.app.storageState}`);
    }
  }
  return { script, scriptPath, dir, name: path.basename(scriptPath).replace(/\.json$/i, '') };
}
