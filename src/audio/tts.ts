import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from '../paths';
import type { LoadedScript } from '../script/load';
import type { Voice } from '../script/schema';
import { stepKey } from '../timeline/narration';
import { normalizeVoice } from './decode';
import { wavDurationMs } from './wav';

export const TTS_TIMEOUT_MS = 120_000;
/** `say` and `espeak-ng` speak at about this many words per minute at speed 1. */
const BASE_WPM = 175;

export interface EngineOptions {
  /** Where API keys and base URLs come from (process.env by default). */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface VoiceClip {
  /** normalised mono 48 kHz WAV in the voice cache */
  file: string;
  durationMs: number;
}

/** Cache key of a line: every voice setting plus the text. */
export function voiceKey(voice: Voice, text: string): string {
  const parts = [voice.engine, voice.name ?? null, voice.speed, voice.model ?? null, voice.instructions ?? null, voice.command ?? null, text];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

const tail = (s: string) => {
  const t = s.trim().slice(-600);
  return t ? `\n${t}` : '';
};

/** Run a program (or a shell command) with optional stdin; reject with the exit code and output tail. */
function exec(cmd: string, args: string[], o: { input?: string; shell?: boolean; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: o.shell ?? false, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const keep = (d: Buffer) => {
      output = (output + d.toString()).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out after ${o.timeoutMs / 1000} s${tail(output)}`));
    }, o.timeoutMs);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new Error(`${cmd} not found`) : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}${tail(output)}`));
    });
    child.stdin.on('error', () => undefined); // a command that ignores stdin is fine
    child.stdin.end(o.input ?? '');
  });
}

const quote = (s: string) => (process.platform === 'win32' ? `"${s}"` : `'${s.replace(/'/g, `'\\''`)}'`);

async function post(url: string, headers: Record<string, string>, body: unknown, out: string, timeoutMs: number): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}${tail(await res.text().catch(() => ''))}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

function keyFrom(env: NodeJS.ProcessEnv, name: string): string {
  const key = env[name];
  if (!key) throw new Error(`${name} is not set. Export it in the shell that runs showtime.`);
  return key;
}

/**
 * Speak `text` with the voice's engine into `<base>.<ext>` and return that path. The text never
 * reaches a command line: `say`/`espeak-ng` read it from a file, `command` from stdin.
 */
export async function synthesize(voice: Voice, text: string, base: string, opts: EngineOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? TTS_TIMEOUT_MS;
  switch (voice.engine) {
    case 'system': {
      const txt = `${base}.txt`;
      await writeFile(txt, text);
      const rate = voice.speed === 1 ? [] : [String(Math.round(BASE_WPM * voice.speed))];
      if (process.platform === 'darwin') {
        const out = `${base}.aiff`;
        const args = ['-f', txt, '-o', out, ...(voice.name ? ['-v', voice.name] : []), ...(rate.length ? ['-r', ...rate] : [])];
        await exec('say', args, { timeoutMs, env });
        return out;
      }
      if (process.platform === 'linux') {
        const out = `${base}.wav`;
        const args = ['-f', txt, '-w', out, ...(voice.name ? ['-v', voice.name] : []), ...(rate.length ? ['-s', ...rate] : [])];
        await exec('espeak-ng', args, { timeoutMs, env }).catch((err: Error) => {
          throw new Error(`${err.message}. Install espeak-ng (apt install espeak-ng) or set audio.voice.engine to openai, elevenlabs or command.`);
        });
        return out;
      }
      throw new Error('the system voice works on macOS and Linux; set audio.voice.engine to openai, elevenlabs or command.');
    }
    case 'openai': {
      const key = keyFrom(env, 'OPENAI_API_KEY');
      const url = `${(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/speech`;
      const out = `${base}.wav`;
      const body = {
        model: voice.model ?? 'gpt-4o-mini-tts',
        voice: voice.name ?? 'alloy',
        input: text,
        response_format: 'wav',
        speed: voice.speed,
        ...(voice.instructions ? { instructions: voice.instructions } : {}),
      };
      await post(url, { authorization: `Bearer ${key}` }, body, out, timeoutMs);
      return out;
    }
    case 'elevenlabs': {
      const key = keyFrom(env, 'ELEVENLABS_API_KEY');
      const root = (env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io').replace(/\/$/, '');
      const url = `${root}/v1/text-to-speech/${encodeURIComponent(voice.name ?? '')}?output_format=mp3_44100_128`;
      const out = `${base}.mp3`;
      const body = { text, model_id: voice.model ?? 'eleven_multilingual_v2', voice_settings: { speed: Math.min(1.2, Math.max(0.7, voice.speed)) } };
      await post(url, { 'xi-api-key': key }, body, out, timeoutMs);
      return out;
    }
    case 'command': {
      // .wav so tools that pick the format from the extension (say -o, sox) write something ffmpeg reads.
      const out = `${base}.wav`;
      const command = (voice.command ?? '').replaceAll('{out}', quote(out));
      await exec(command, [], { shell: true, input: text, env: { ...env, SHOWTIME_OUT: out }, timeoutMs });
      return out;
    }
  }
}

/**
 * Synthesize every `show.say` line that is not cached yet, and return all lines by step. Lines are
 * normalised (loudness, mono 48 kHz WAV) into `.showtime/<name>/audio/voice-<key>.wav`.
 */
export async function ensureVoices(
  loaded: LoadedScript,
  opts: EngineOptions & { log?: (line: string) => void } = {},
): Promise<Record<string, VoiceClip>> {
  const dir = workPaths(loaded).audio;
  const clips: Record<string, VoiceClip> = {};
  for (const scene of loaded.script.scenes) {
    for (const [index, step] of scene.steps.entries()) {
      const text = step.show?.say;
      if (!text) continue;
      // A step may change the voice for its own line (a second narrator, another language).
      const voice = { ...loaded.script.audio.voice, ...step.show?.voice } as Voice;
      const where = stepKey(scene.id, index);
      const key = voiceKey(voice, text);
      const file = path.join(dir, `voice-${key}.wav`);
      if (!existsSync(file)) {
        await mkdir(dir, { recursive: true });
        opts.log?.(`Voice for ${where}…`);
        // Per-run names: two runs (the studio and a render, say) may synthesize the same line at once.
        const run = `${process.pid}-${randomBytes(4).toString('hex')}`;
        const base = path.join(dir, `tmp-${key}-${run}`);
        const part = `${file}.${run}.part`;
        try {
          const raw = await synthesize(voice, text, base, opts);
          await normalizeVoice(raw, part);
          await rename(part, file);
        } catch (err) {
          throw new Error(`audio.voice (${voice.engine}) failed for ${where}: ${(err as Error).message}`);
        } finally {
          for (const ext of ['.txt', '.aiff', '.wav', '.mp3']) await rm(`${base}${ext}`, { force: true });
          await rm(part, { force: true });
        }
      }
      clips[where] = { file, durationMs: await wavDurationMs(file) };
    }
  }
  return clips;
}
