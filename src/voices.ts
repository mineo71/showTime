import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizeVoice } from './audio/decode';
import { synthesize, voiceKey } from './audio/tts';
import { run } from './ffmpeg';
import type { Voice } from './script/schema';

export interface VoiceInfo {
  name: string;
  /** e.g. en_US */
  language?: string;
  /** elevenlabs voice id (what `name` takes for that engine) */
  id?: string;
  sample?: string;
}

/** OpenAI's built-in TTS voices. */
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

/** `say -v '?'` lines: `Eddy (English (US)) en_US    # Hello! My name is Eddy.` */
export function parseSayVoices(out: string): VoiceInfo[] {
  return out.split('\n').flatMap((line) => {
    const m = /^(.+?)\s+([a-z]{2,3}_[A-Z0-9]{2,3})\s+#\s?(.*)$/.exec(line.trimEnd());
    return m ? [{ name: m[1].trim(), language: m[2], sample: m[3] }] : [];
  });
}

/** `espeak-ng --voices`: `Pty Language Age/Gender VoiceName File Other Languages`. */
function parseEspeakVoices(out: string): VoiceInfo[] {
  return out
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const cols = line.trim().split(/\s+/);
      return cols.length >= 4 ? [{ name: cols[3], language: cols[1] }] : [];
    });
}

/** Voices whose language starts with `lang` (uk, en-gb, pt_BR…), all when no language is given. */
export function filterVoices(voices: VoiceInfo[], lang?: string): VoiceInfo[] {
  if (!lang) return voices;
  const norm = (s: string) => s.toLowerCase().replace(/-/g, '_');
  return voices.filter((v) => v.language && norm(v.language).startsWith(norm(lang)));
}

/** The voices an engine offers. */
export async function listVoices(engine: Voice['engine'], env: NodeJS.ProcessEnv = process.env): Promise<VoiceInfo[]> {
  switch (engine) {
    case 'system':
      if (process.platform === 'darwin') return parseSayVoices(await run('say', ['-v', '?']));
      if (process.platform === 'linux') {
        try {
          return parseEspeakVoices(await run('espeak-ng', ['--voices']));
        } catch {
          throw new Error('espeak-ng not found. Install it (apt install espeak-ng) to list and use system voices.');
        }
      }
      throw new Error('The system voice works on macOS and Linux.');
    case 'openai':
      return OPENAI_VOICES.map((name) => ({ name }));
    case 'elevenlabs': {
      const key = env.ELEVENLABS_API_KEY;
      if (!key) throw new Error('ELEVENLABS_API_KEY is not set. Export it to list the account\'s voices.');
      const root = (env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io').replace(/\/$/, '');
      const res = await fetch(`${root}/v1/voices`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`elevenlabs voices: HTTP ${res.status}`);
      const data = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: { language?: string } }[] };
      return (data.voices ?? []).map((v) => ({ name: v.name, id: v.voice_id, language: v.labels?.language }));
    }
    case 'command':
      throw new Error('The command engine has no voice list: its voices are whatever your command offers.');
  }
}

/** Speak `text` with `voice` into `<dir>/.showtime/voices/` and return the WAV. */
export async function tryVoice(voice: Voice, text: string, dir = process.cwd()): Promise<string> {
  const out = path.join(path.resolve(dir), '.showtime', 'voices');
  await mkdir(out, { recursive: true });
  const label = (voice.name ?? voice.engine).replace(/[^\w.-]+/g, '-');
  const file = path.join(out, `${label}-${voiceKey(voice, text).slice(0, 8)}.wav`);
  const raw = await synthesize(voice, text, path.join(out, `tmp-${process.pid}`));
  await normalizeVoice(raw, file);
  return file;
}
