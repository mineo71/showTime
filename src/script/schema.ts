import { z } from 'zod';

const target = z
  .string()
  .min(1)
  .describe("Playwright selector, e.g. role=button[name='Save'], text=Save, #id, [data-testid=x], CSS");

export const CLICK_KINDS = ['ripple', 'pulse', 'burst', 'ring', 'none'] as const;
export const SOUND_PACKS = ['soft', 'mechanical', 'pop', 'tap', 'typewriter'] as const;

const VoiceFields = z
  .object({
    engine: z
      .enum(['system', 'openai', 'elevenlabs', 'command'])
      .default('system')
      .describe('system: macOS say / Linux espeak-ng; openai and elevenlabs read OPENAI_API_KEY / ELEVENLABS_API_KEY'),
    name: z.string().min(1).optional().describe('Voice name (system, openai) or voice id (elevenlabs)'),
    speed: z.number().min(0.5).max(2).default(1),
    model: z.string().min(1).optional().describe('openai: gpt-4o-mini-tts by default; elevenlabs: eleven_multilingual_v2'),
    instructions: z.string().min(1).optional().describe('openai only: how to speak, e.g. "warm and confident"'),
    command: z
      .string()
      .min(1)
      .optional()
      .describe('command engine: shell command that reads the text on stdin and writes audio to {out}'),
  })
  .strict();

/** What a voice needs beyond its fields: an id for elevenlabs, a command for command. */
export function voiceProblems(v: { engine?: string; name?: string; command?: string }): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  if (v.engine === 'elevenlabs' && !v.name) out.push({ path: 'name', message: 'elevenlabs needs a voice id in "name"' });
  if (v.engine === 'command' && !v.command) out.push({ path: 'command', message: 'the command engine needs "command"' });
  return out;
}

export const VoiceSchema = VoiceFields.superRefine((v, ctx) => {
  for (const p of voiceProblems(v)) ctx.addIssue({ code: 'custom', path: [p.path], message: p.message });
});

export const ShowSchema = z
  .object({
    zoom: z
      .union([z.number().min(1).max(4), z.literal(false)])
      .optional()
      .describe('Zoom depth for this step, or false to disable auto-zoom'),
    caption: z.string().min(1).optional().describe('Caption shown while this step plays'),
    spotlight: z
      .union([z.boolean(), z.enum(['dim', 'ring', 'glow'])])
      .optional()
      .describe('Point at the target: dim (everything else darkens, true), ring, or glow'),
    highlight: z.string().min(1).optional().describe("CSS colour for this step's click animation and spotlight"),
    click: z.enum(CLICK_KINDS).optional().describe('Click animation for this step'),
    voice: VoiceFields.partial().optional().describe('Changes to audio.voice for this step\'s line'),
    hold: z.number().int().min(0).max(30_000).optional().describe('Extra real-time ms after the step'),
    speed: z.number().min(0.25).max(16).optional().describe('Playback speed for this step'),
    say: z
      .string()
      .min(1)
      .optional()
      .describe('Narration spoken from the start of this step; the video waits for it before the next narrated step'),
  })
  .strict();

const show = ShowSchema.optional();

const exactlyOne = (a: string, b: string) => (s: Record<string, unknown>) =>
  (s[a] === undefined) !== (s[b] === undefined);

export const StepSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('goto'), url: z.string().min(1), show }).strict(),
  z.object({ do: z.literal('click'), target, show }).strict(),
  z
    .object({
      do: z.literal('type'),
      target,
      text: z.string(),
      pace: z.union([z.enum(['human', 'fast']), z.number().int().min(0).max(1000)]).default('human'),
      clear: z.boolean().default(false),
      show,
    })
    .strict(),
  z.object({ do: z.literal('press'), key: z.string().min(1), show }).strict(),
  z.object({ do: z.literal('hover'), target, show }).strict(),
  z.object({ do: z.literal('select'), target, value: z.string(), show }).strict(),
  z
    .object({ do: z.literal('scroll'), target: target.optional(), by: z.number().int().optional(), show })
    .strict()
    .refine(exactlyOne('target', 'by'), { message: 'scroll needs exactly one of "target" or "by"' }),
  z
    .object({
      do: z.literal('wait'),
      for: target.optional(),
      ms: z.number().int().min(0).max(60_000).optional(),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(300_000)
        .optional()
        .describe('How long to wait "for" the target (default 15000), for slow backends'),
      show,
    })
    .strict()
    .refine(exactlyOne('for', 'ms'), { message: 'wait needs exactly one of "for" or "ms"' })
    .refine((s) => s.timeoutMs === undefined || s.for !== undefined, { message: 'timeoutMs goes with "for"', path: ['timeoutMs'] }),
  z.object({ do: z.literal('pause'), ms: z.number().int().min(0).max(60_000), show }).strict(),
]);

export const StyleSchema = z
  .object({
    background: z.string().default('linear-gradient(135deg, #0f172a 0%, #312e81 100%)'),
    padding: z.number().min(0).max(0.3).default(0.06),
    radius: z.number().min(0).max(64).default(14),
    shadow: z.boolean().default(true),
    font: z.string().default('Inter, -apple-system, "Segoe UI", system-ui, sans-serif'),
    accent: z.string().default('#6366f1'),
    autoZoom: z.boolean().default(true),
    autoSpeed: z.boolean().default(true),
    maxZoom: z.number().min(1).max(4).default(1.8),
    chrome: z
      .enum(['browser', 'none'])
      .default('browser')
      .describe('Frame the recording in a browser window with an address bar, or show the bare viewport'),
    address: z.string().optional().describe('Address-bar text; defaults to the app URL without its scheme'),
    click: z.enum(CLICK_KINDS).default('ripple').describe('Click animation'),
    spotlightDim: z.number().min(0).max(1).default(0.55).describe('How dark a dim spotlight makes the rest'),
    captionStyle: z.enum(['dark', 'light', 'accent', 'outline', 'bar']).default('dark'),
    captionFont: z.string().min(1).optional().describe('Font family of captions and subtitles (default: font)'),
    titleFont: z.string().min(1).optional().describe('Font family of the intro and outro cards (default: font)'),
    captionSize: z.number().int().min(20).max(80).optional().describe('Caption text size in px at 1080p'),
    fonts: z
      .array(
        z
          .object({
            family: z.string().min(1),
            file: z.string().min(1).describe('woff2/woff/ttf/otf, relative to the file that names it'),
            weight: z.union([z.number().int().min(100).max(900), z.string().min(1)]).optional(),
            style: z.enum(['normal', 'italic']).optional(),
          })
          .strict(),
      )
      .default([])
      .describe('Font files embedded into the video'),
    watermark: z
      .object({
        text: z.string().min(1).optional(),
        image: z.string().min(1).optional().describe('SVG/PNG/JPEG/WebP, relative to the file that names it'),
        position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-right'),
        opacity: z.number().min(0).max(1).default(0.6),
        size: z.number().int().min(12).max(200).default(28),
      })
      .strict()
      .refine((w) => w.text !== undefined || w.image !== undefined, { message: 'watermark needs text or an image' })
      .optional(),
  })
  .strict();

const headers = z.record(z.string(), z.string());

export const MockSchema = z
  .object({
    url: z.string().min(1).describe('Playwright URL glob of the requests to answer, e.g. **/api/reports*'),
    method: z.string().min(1).optional().describe('Only answer this HTTP method; others go to the network'),
    status: z.number().int().min(100).max(599).default(200),
    json: z.unknown().optional().describe('Response body, sent as application/json'),
    body: z.string().optional().describe('Raw response body'),
    headers: headers.optional(),
    delayMs: z.number().int().min(0).max(30_000).optional().describe('Wait this long before answering'),
  })
  .strict()
  .refine((m) => m.json === undefined || m.body === undefined, { message: 'a mock takes "json" or "body", not both' });

export const AppSchema = z
  .object({
    url: z.string().min(1),
    viewport: z
      .object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160) })
      .strict()
      .default({ width: 1440, height: 900 }),
    deviceScaleFactor: z.number().min(1).max(3).default(2),
    storageState: z.string().optional(),
    colorScheme: z.enum(['light', 'dark']).optional(),
    locale: z.string().optional(),
    timezoneId: z.string().optional(),
    mask: z
      .array(z.string().min(1))
      .default([])
      .describe('CSS selectors (not Playwright selectors) of elements to blur in the recording'),
    hide: z
      .array(z.string().min(1))
      .default([])
      .describe('CSS selectors of elements to hide in every take (dev badges, chat widgets, banners)'),
    reducedMotion: z
      .enum(['reduce', 'no-preference'])
      .optional()
      .describe('prefers-reduced-motion for the page: "reduce" shows scroll-reveal content at once'),
    mock: z.array(MockSchema).default([]).describe('Answer matching network requests with canned responses; the first match wins'),
    clock: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'must be an ISO date-time, e.g. 2026-10-13T09:30:00Z' })
      .optional()
      .describe('Start the page clock at this ISO date-time; it then runs normally'),
    dialogs: z.enum(['accept', 'dismiss']).default('accept').describe('How to answer alert/confirm/prompt dialogs'),
  })
  .strict();

export const HookSchema = z.union([
  z.object({ run: z.string().min(1).describe('Shell command, run in the script folder') }).strict(),
  z
    .object({
      request: z
        .object({
          url: z.string().min(1),
          method: z.string().min(1).default('POST'),
          json: z.unknown().optional(),
          headers: headers.optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const HooksSchema = z
  .object({
    before: z.array(HookSchema).default([]).describe('Run before every check and record, e.g. to reset demo data'),
    after: z.array(HookSchema).default([]).describe('Run after every check and record, even when it failed'),
  })
  .strict();

export const MetaSchema = z
  .object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    logo: z.string().min(1).optional().describe('SVG/PNG/JPEG/WebP shown on the intro and outro cards'),
    outro: z
      .object({ title: z.string().min(1), subtitle: z.string().optional(), url: z.string().optional() })
      .strict()
      .optional()
      .describe('Closing card after the video'),
  })
  .strict();

export const AudioSchema = z
  .object({
    voice: VoiceSchema.prefault({}).describe('Text-to-speech for show.say'),
    music: z
      .object({
        file: z.string().min(1).describe('Audio file, relative to the file that names it'),
        volume: z.number().min(0).max(1).default(0.25),
      })
      .strict()
      .optional()
      .describe('Music bed under the whole video; ducks while the voice speaks'),
    sounds: z
      .union([
        z.boolean(),
        z.enum(SOUND_PACKS),
        z
          .object({
            pack: z.enum(SOUND_PACKS).default('soft'),
            click: z.string().min(1).optional().describe('Audio file for clicks, relative to the file that names it'),
            key: z.string().min(1).optional().describe('Audio file for keystrokes'),
            volume: z.number().min(0).max(1).default(1),
          })
          .strict(),
      ])
      .default(false)
      .describe('Click and keystroke sounds: true (soft), a pack name, or { pack, click?, key?, volume? }'),
    clips: z
      .array(
        z
          .object({
            file: z.string().min(1).describe('Audio file, relative to the file that names it'),
            at: z
              .string()
              .regex(/^[A-Za-z0-9_-]+#\d+$/, 'must name a scene step, e.g. "surge#3"')
              .describe('The step whose start the clip plays from (scene#n)'),
            offsetMs: z.number().int().min(0).max(600_000).default(0),
            volume: z.number().min(0).max(1).default(1),
          })
          .strict(),
      )
      .default([])
      .describe("The app's own sounds, which the screen capture can't hear (a ringing phone, a caller)"),
    subtitles: z
      .enum(['off', 'file', 'burn'])
      .default('file')
      .describe('Narration subtitles: an .srt next to the video (file), also drawn on the video (burn), or none'),
  })
  .strict();

export const ServerSchema = z
  .object({
    run: z.string().min(1).describe('Shell command that starts the app, run in the script folder'),
    url: z.string().min(1).optional().describe('Polled until it answers (default: app.url)'),
    timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
  })
  .strict();

export const SceneSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'scene id may contain letters, digits, "-" and "_"'),
    steps: z.array(StepSchema).min(1),
  })
  .strict();

export const ScriptSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    meta: MetaSchema.default({}),
    app: AppSchema,
    hooks: HooksSchema.prefault({}),
    server: ServerSchema.optional().describe('Start the app for check and record (reused when it already answers)'),
    setup: z.array(StepSchema).default([]),
    style: StyleSchema.prefault({}),
    audio: AudioSchema.prefault({}),
    scenes: z.array(SceneSchema).min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    s.scenes.forEach((scene, i) => {
      if (seen.has(scene.id)) {
        ctx.addIssue({ code: 'custom', path: ['scenes', i, 'id'], message: `duplicate scene id "${scene.id}"` });
      }
      seen.add(scene.id);
    });
  });

export type Script = z.output<typeof ScriptSchema>;
export type ScriptInput = z.input<typeof ScriptSchema>;
export type Step = z.output<typeof StepSchema>;
export type Show = z.output<typeof ShowSchema>;
export type Style = z.output<typeof StyleSchema>;
export type Hook = z.output<typeof HookSchema>;
export type Mock = z.output<typeof MockSchema>;
export type Audio = z.output<typeof AudioSchema>;
export type Voice = z.output<typeof VoiceSchema>;
export type ClickKind = (typeof CLICK_KINDS)[number];
export type SoundPack = (typeof SOUND_PACKS)[number];
export type Server = z.output<typeof ServerSchema>;

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

export function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((i) => `  - ${i.path.length ? i.path.map(String).join('.') : '(root)'}: ${i.message}`).join('\n');
}

export function parseScript(raw: unknown, source = 'script'): Script {
  const result = ScriptSchema.safeParse(raw);
  if (!result.success) throw new ScriptError(`Invalid ${source}:\n${formatIssues(result.error.issues)}`);
  return result.data;
}

export function scriptJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ScriptSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}
