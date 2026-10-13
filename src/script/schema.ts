import { z } from 'zod';

const target = z
  .string()
  .min(1)
  .describe("Playwright selector, e.g. role=button[name='Save'], text=Save, #id, [data-testid=x], CSS");

export const ShowSchema = z
  .object({
    zoom: z
      .union([z.number().min(1).max(4), z.literal(false)])
      .optional()
      .describe('Zoom depth for this step, or false to disable auto-zoom'),
    caption: z.string().min(1).optional().describe('Caption shown while this step plays'),
    spotlight: z.boolean().optional().describe('Dim everything except the target'),
    hold: z.number().int().min(0).max(30_000).optional().describe('Extra real-time ms after the step'),
    speed: z.number().min(0.25).max(16).optional().describe('Playback speed for this step'),
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
    .object({ do: z.literal('wait'), for: target.optional(), ms: z.number().int().min(0).max(60_000).optional(), show })
    .strict()
    .refine(exactlyOne('for', 'ms'), { message: 'wait needs exactly one of "for" or "ms"' }),
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
    setup: z.array(StepSchema).default([]),
    style: StyleSchema.prefault({}),
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
