# showTime MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `showtime` CLI + Claude Code skill that turns a JSON demo script into a polished 1080p MP4: rehearse (`check`), record (`record`), render (`render`), QA stills (`frames`), all-in-one (`make`).

**Architecture:** A Playwright runner drives Chromium, captures device-pixel frames over CDP screencast and logs every step (timestamps, bounding boxes, cursor moves, clicks, idle time) into `events.json`. A pure `buildTimeline(script, events)` turns script presentation (`show`, `style`, `meta`) plus the log into `timeline.json`. A Remotion composition renders the timeline: background + window frame, camera zoom/pan, synthetic cursor, click ripples, spotlights, captions, intro card, speed segments.

**Tech Stack:** TypeScript 5.9 (ESM, run via tsx), Node ≥ 20, zod 4, commander 14, Playwright 1.64, Remotion 4.0.535, React 19, ffmpeg/ffprobe, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-13-showtime-design.md`

## Global Constraints

- Node ≥ 20 (machine has v20.19.6). No build step: `bin/showtime.mjs` registers tsx and imports `src/cli/main.ts`.
- Exact versions: `remotion`, `@remotion/bundler`, `@remotion/renderer` = `4.0.535` (must all match); `playwright@1.64.0`; `zod@4.6.7`; `commander@14.0.3`; `react@19.3.0`, `react-dom@19.3.0`; dev: `typescript@5.9.3`, `vitest@4.1.11`, `tsx`, `@types/node@20`, `@types/react`, `@types/react-dom`.
- Relative imports are **extensionless** (`./camera`, not `./camera.js`): `tsconfig` uses `moduleResolution: "Bundler"`; the same files are run by tsx and bundled by Remotion's webpack.
- `src/timeline/**` is pure (no `node:` imports, no Playwright): it is bundled into the Remotion browser page.
- Chromium is launched with `--force-device-scale-factor=<dpr>` **and** the context gets `deviceScaleFactor: <dpr>`; only both together give device-pixel screencast frames (verified: 2880×1800 @ 60 fps for 1440×900 @2x).
- All overlay times in `timeline.json` are **source** milliseconds (raw take clock). The renderer maps output frame → source ms through `segments`.
- Output: 1920×1080, 30 fps, H.264 crf 18. Raw take: 30 fps CFR H.264 crf 14, yuv420p.
- Work directory: `.showtime/<script-name>/` next to the script (`check/`, `take/raw.mp4`, `take/events.json`, `timeline.json`, `frames/`). Default video: `<script-name>.mp4` next to the script.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UBDyxd4Jjx8Yc2igStwjPP
  ```

## Review Focus

1. **Selector matches several elements** — the user expects a clear error naming the step and that the selector is ambiguous, not a random click. Pinned in Task 5 (`names ambiguous selectors`).
2. **Target below the fold** — expected to scroll into view before the bounding box is read, so zoom/cursor land on the element. Pinned in Task 6 (export button bbox inside viewport).
3. **Long static stretches with no repaint** (holds, pauses) — screencast emits no frames; the raw video must still last as long as the wall clock. Pinned in Task 6 (ffprobe duration vs event clock, ±200 ms).
4. **Non-ASCII text** (Ukrainian typing and captions) — must type and render correctly. Pinned in Task 5 (`types Unicode text`) and Task 7 (fixture caption in Ukrainian rendered in QA stills).
5. **Script edited after the take** — changing an action must refuse to render with a re-record hint; changing only `show`/`style`/`meta` must render without re-recording. Pinned in Task 7 (`refuses a stale take`, `re-renders after a presentation-only change`).

## File Map

```
bin/showtime.mjs                 tsx entry for the CLI
src/cli/main.ts                  commander commands (schema, check, record, render, frames, make)
src/cli/format.ts                human output for check reports
src/script/schema.ts             zod schema, types, parseScript, JSON Schema export
src/script/load.ts               loadScript(file): read, parse, resolve relative paths
src/script/hash.ts               actionHash(script): detects stale takes
src/paths.ts                     workPaths(loaded): every on-disk location
src/ffmpeg.ts                    run(), assertFfmpeg(), probeVideo()
src/timeline/types.ts            TakeEvents + Timeline contracts (pure)
src/timeline/math.ts             clamp, lerp, easing (pure)
src/timeline/timemap.ts          speed segments, output⇄source time (pure)
src/timeline/camera.ts           zoom depth, camera keyframes, camera evaluation (pure)
src/timeline/cursor.ts           cursor position, press squash, ripples (pure)
src/timeline/build.ts            buildTimeline(script, events) (pure)
src/timeline/frames.ts           frame math for Remotion + QA shot list (pure)
src/timeline/layout.ts           window placement inside the output frame (pure)
src/runner/time.ts               sleep, seeded rng
src/runner/events.ts             EventLog (clock + collected events)
src/runner/browser.ts            openSession, trackNetwork, prepare
src/runner/steps.ts              runStep: resolve, travel, act, settle
src/runner/check.ts              check(): rehearsal report
src/runner/capture.ts            CDP screencast → JPEG frames
src/runner/encode.ts             frames → raw.mp4 via ffmpeg concat
src/runner/record.ts             record(): take/raw.mp4 + take/events.json
src/render/remotion/*.tsx        Remotion root, composition, layers
src/render/render.ts             bundle + renderMedia / renderStill
src/pipeline.ts                  loadTake, timelineFor, renderDemo, renderQaFrames
fixtures/demo-app/index.html     fake SaaS app for tests and the example
fixtures/demo.json               example script for the fixture
test/helpers/serve.ts            static server (also `npm run fixture`)
test/helpers/fixture.ts          temp copy of fixtures/demo.json with a live URL
skill/SKILL.md                   Claude Code skill
scripts/install-skill.mjs        symlink skill into ~/.claude/skills/showtime
```

---

### Task 1: Scaffold, script schema, loader, action hash, `schema` command

**Files:**
- Create: `package.json`, `.gitignore`, `tsconfig.json`, `vitest.config.ts`, `bin/showtime.mjs`
- Create: `src/script/schema.ts`, `src/script/load.ts`, `src/script/hash.ts`, `src/paths.ts`, `src/cli/main.ts`
- Test: `test/unit/schema.test.ts`, `test/unit/load.test.ts`, `test/unit/hash.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseScript(raw: unknown, source?: string): Script` (throws `ScriptError`)
  - `scriptJsonSchema(): Record<string, unknown>`
  - types `Script`, `Step`, `Show`, `Style`, `ScriptInput`; class `ScriptError`
  - `loadScript(file: string): Promise<LoadedScript>`; `interface LoadedScript { script: Script; scriptPath: string; dir: string; name: string }`
  - `actionHash(script: Script): string`
  - `workPaths(loaded: LoadedScript): WorkPaths` with `root, check, take, rawFrames, raw, events, timeline, stills, video`

- [ ] **Step 1: Scaffold the package and install dependencies**

**File:** `package.json`
```json
{
  "name": "showtime",
  "version": "0.1.0",
  "description": "AI-directed product demo videos: JSON script in, polished MP4 out",
  "private": true,
  "type": "module",
  "bin": {
    "showtime": "bin/showtime.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "showtime": "node bin/showtime.mjs",
    "test": "vitest run test/unit",
    "test:int": "vitest run test/integration",
    "typecheck": "tsc --noEmit",
    "fixture": "tsx test/helpers/serve.ts",
    "install-skill": "node scripts/install-skill.mjs"
  }
}
```

**File:** `.gitignore`
```
node_modules/
.showtime/
*.mp4
```

**File:** `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

**File:** `vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
```

**File:** `bin/showtime.mjs`
```js
#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
await import('../src/cli/main.ts');
```

Run:
```bash
chmod +x bin/showtime.mjs
npm i zod@4.6.7 commander@14.0.3 tsx playwright@1.64.0 remotion@4.0.535 @remotion/bundler@4.0.535 @remotion/renderer@4.0.535 react@19.3.0 react-dom@19.3.0
npm i -D typescript@5.9.3 vitest@4.1.11 @types/node@20 @types/react @types/react-dom
npx playwright install chromium
```
Expected: installs succeed; `node_modules/.bin/vitest` exists.

- [ ] **Step 2: Write the failing tests**

**File:** `test/unit/schema.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { parseScript, ScriptError, scriptJsonSchema } from '../../src/script/schema';

const minimal = {
  version: 1,
  app: { url: 'http://localhost:3000' },
  scenes: [{ id: 'a', steps: [{ do: 'click', target: 'text=Go' }] }],
};
const withSteps = (steps: unknown[]) => ({ ...minimal, scenes: [{ id: 'a', steps }] });

describe('parseScript', () => {
  it('applies defaults', () => {
    const s = parseScript(minimal);
    expect(s.app.viewport).toEqual({ width: 1440, height: 900 });
    expect(s.app.deviceScaleFactor).toBe(2);
    expect(s.app.mask).toEqual([]);
    expect(s.setup).toEqual([]);
    expect(s.meta).toEqual({});
    expect(s.style).toMatchObject({ autoZoom: true, autoSpeed: true, maxZoom: 1.8, padding: 0.06, radius: 14, shadow: true });
    expect(s.style.background).toContain('gradient');
  });

  it('defaults type pace to human and keeps Unicode text', () => {
    const s = parseScript(withSteps([{ do: 'type', target: '#q', text: 'Привіт' }]));
    expect(s.scenes[0].steps[0]).toMatchObject({ do: 'type', pace: 'human', clear: false, text: 'Привіт' });
  });

  it('rejects an unknown action and names the path', () => {
    expect(() => parseScript(withSteps([{ do: 'jump' }]))).toThrow(/scenes\.0\.steps\.0/);
  });

  it('rejects unknown fields so typos surface', () => {
    expect(() => parseScript(withSteps([{ do: 'click', target: 'x', shwo: {} }]))).toThrow(ScriptError);
  });

  it('requires exactly one of target/by for scroll', () => {
    expect(() => parseScript(withSteps([{ do: 'scroll' }]))).toThrow(/exactly one/);
    expect(() => parseScript(withSteps([{ do: 'scroll', by: 400 }]))).not.toThrow();
  });

  it('requires exactly one of for/ms for wait', () => {
    expect(() => parseScript(withSteps([{ do: 'wait', for: 'text=A', ms: 5 }]))).toThrow(/exactly one/);
    expect(() => parseScript(withSteps([{ do: 'wait', ms: 500 }]))).not.toThrow();
  });

  it('rejects duplicate scene ids', () => {
    expect(() => parseScript({ ...minimal, scenes: [minimal.scenes[0], minimal.scenes[0]] })).toThrow(/duplicate scene id "a"/);
  });

  it('includes the source in the error message', () => {
    expect(() => parseScript({ version: 1 }, '/tmp/demo.json')).toThrow(/Invalid \/tmp\/demo\.json/);
  });
});

describe('scriptJsonSchema', () => {
  it('describes the script object', () => {
    const js = scriptJsonSchema() as { type: string; properties: Record<string, unknown> };
    expect(js.type).toBe('object');
    expect(js.properties.scenes).toBeDefined();
    expect(js.properties.style).toBeDefined();
  });
});
```

**File:** `test/unit/load.test.ts`
```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workPaths } from '../../src/paths';
import { loadScript } from '../../src/script/load';

const base = { version: 1, app: { url: 'http://x' }, scenes: [{ id: 'a', steps: [{ do: 'click', target: 'text=Go' }] }] };

async function scriptIn(content: string) {
  const dir = await mkdtemp(join(tmpdir(), 'showtime-load-'));
  const file = join(dir, 'demo.json');
  await writeFile(file, content);
  return { dir, file };
}

describe('loadScript', () => {
  it('resolves storageState relative to the script, not the cwd', async () => {
    const { dir, file } = await scriptIn(JSON.stringify({ ...base, app: { url: 'http://x', storageState: './auth/s.json' } }));
    await mkdir(join(dir, 'auth'));
    await writeFile(join(dir, 'auth', 's.json'), '{"cookies":[],"origins":[]}');
    const loaded = await loadScript(file);
    expect(loaded.script.app.storageState).toBe(join(dir, 'auth', 's.json'));
    expect(loaded.name).toBe('demo');
    expect(loaded.dir).toBe(dir);
  });

  it('reports a missing storageState file', async () => {
    const { file } = await scriptIn(JSON.stringify({ ...base, app: { url: 'http://x', storageState: 'nope.json' } }));
    await expect(loadScript(file)).rejects.toThrow(/storageState not found/);
  });

  it('reports invalid JSON with the file path', async () => {
    const { file } = await scriptIn('{ nope');
    await expect(loadScript(file)).rejects.toThrow(/Invalid JSON in .*demo\.json/);
  });

  it('reports a missing file', async () => {
    await expect(loadScript('/definitely/missing.json')).rejects.toThrow(/Cannot read script/);
  });
});

describe('workPaths', () => {
  it('keeps everything under .showtime/<name> next to the script', async () => {
    const { dir, file } = await scriptIn(JSON.stringify(base));
    const p = workPaths(await loadScript(file));
    expect(p.root).toBe(join(dir, '.showtime', 'demo'));
    expect(p.raw).toBe(join(dir, '.showtime', 'demo', 'take', 'raw.mp4'));
    expect(p.events).toBe(join(dir, '.showtime', 'demo', 'take', 'events.json'));
    expect(p.video).toBe(join(dir, 'demo.mp4'));
  });
});
```

**File:** `test/unit/hash.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { actionHash } from '../../src/script/hash';
import { parseScript } from '../../src/script/schema';

const make = (step: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parseScript({ version: 1, app: { url: 'http://x' }, scenes: [{ id: 'a', steps: [step] }], ...extra });

describe('actionHash', () => {
  const base = make({ do: 'click', target: 'text=Go' });

  it('ignores presentation-only changes', () => {
    const styled = make(
      { do: 'click', target: 'text=Go', show: { caption: 'Hi', zoom: 2, spotlight: true, speed: 2 } },
      { meta: { title: 'X' }, style: { accent: '#f00' } },
    );
    expect(actionHash(styled)).toBe(actionHash(base));
  });

  it('changes when an action changes', () => {
    expect(actionHash(make({ do: 'click', target: 'text=Stop' }))).not.toBe(actionHash(base));
  });

  it('changes when hold changes (it is recorded in real time)', () => {
    expect(actionHash(make({ do: 'click', target: 'text=Go', show: { hold: 500 } }))).not.toBe(actionHash(base));
  });

  it('changes when the mask changes (applied at capture)', () => {
    const masked = make({ do: 'click', target: 'text=Go' }, { app: { url: 'http://x', mask: ['.email'] } });
    expect(actionHash(masked)).not.toBe(actionHash(base));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/unit`
Expected: FAIL — cannot resolve `../../src/script/schema`, `../../src/script/load`, `../../src/paths`, `../../src/script/hash`.

- [ ] **Step 4: Implement schema, loader, paths, hash and the `schema` command**

**File:** `src/script/schema.ts`
```ts
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
  })
  .strict();

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
    mask: z.array(z.string().min(1)).default([]),
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
    meta: z.object({ title: z.string().optional(), subtitle: z.string().optional() }).strict().default({}),
    app: AppSchema,
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
```

**File:** `src/script/load.ts`
```ts
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
```

**File:** `src/paths.ts`
```ts
import path from 'node:path';
import type { LoadedScript } from './script/load';

export interface WorkPaths {
  root: string;
  check: string;
  take: string;
  rawFrames: string;
  raw: string;
  events: string;
  timeline: string;
  stills: string;
  video: string;
}

export function workPaths(loaded: LoadedScript): WorkPaths {
  const root = path.join(loaded.dir, '.showtime', loaded.name);
  const take = path.join(root, 'take');
  return {
    root,
    check: path.join(root, 'check'),
    take,
    rawFrames: path.join(take, 'frames'),
    raw: path.join(take, 'raw.mp4'),
    events: path.join(take, 'events.json'),
    timeline: path.join(root, 'timeline.json'),
    stills: path.join(root, 'frames'),
    video: path.join(loaded.dir, `${loaded.name}.mp4`),
  };
}
```

**File:** `src/script/hash.ts`
```ts
import { createHash } from 'node:crypto';
import type { Script, Step } from './schema';

/** Everything that changes what gets recorded: the step minus `show`, plus `show.hold`. */
function actionsOf(step: Step): Record<string, unknown> {
  const { show, ...rest } = step;
  return show?.hold ? { ...rest, hold: show.hold } : rest;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function actionHash(script: Script): string {
  const payload = {
    app: script.app,
    setup: script.setup.map(actionsOf),
    scenes: script.scenes.map((s) => ({ id: s.id, steps: s.steps.map(actionsOf) })),
  };
  return createHash('sha256').update(canonical(payload)).digest('hex');
}
```

**File:** `src/cli/main.ts`
```ts
import { Command } from 'commander';
import { scriptJsonSchema } from '../script/schema';

const program = new Command('showtime')
  .description('AI-directed product demo videos: JSON script in, polished MP4 out')
  .version('0.1.0');

program
  .command('schema')
  .description('print the JSON Schema of demo scripts')
  .action(() => {
    process.stdout.write(`${JSON.stringify(scriptJsonSchema(), null, 2)}\n`);
  });

program.parseAsync().catch((err: Error) => {
  process.stderr.write(`✖ ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Run the tests and the CLI**

Run: `npx vitest run test/unit && npx tsc --noEmit && node bin/showtime.mjs schema | head -5`
Expected: all unit tests PASS, no type errors, schema JSON printed (starts with `{`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: script schema, loader, action hash and schema command"
```

---

### Task 2: Timeline contracts, math and time mapping

**Files:**
- Create: `src/timeline/types.ts`, `src/timeline/math.ts`, `src/timeline/timemap.ts`
- Test: `test/unit/math.test.ts`, `test/unit/timemap.test.ts`

**Interfaces:**
- Consumes: `Step`, `Style` types (Task 1).
- Produces:
  - types `Pt, Rect, CursorKind, Move, Click, Interval, StepEvent, TakeEvents, Segment, CameraKey, Caption, Spotlight, Timeline`
  - `clamp(v, lo, hi)`, `lerp(a, b, t)`, `easeInOutCubic(t)`, `easeOutCubic(t)`
  - `interface SpeedSpan extends Interval { speed: number }`
  - `buildSegments(durationMs: number, spans: SpeedSpan[]): Segment[]` (later spans win)
  - `outputDurationMs(segments): number`, `outputToSource(segments, tOutMs): number`, `sourceToOutput(segments, tSrcMs): number`

- [ ] **Step 1: Write the failing tests**

**File:** `test/unit/math.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { clamp, easeInOutCubic, easeOutCubic, lerp } from '../../src/timeline/math';

describe('math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });
  it('lerps', () => expect(lerp(10, 20, 0.25)).toBe(12.5));
  it('eases in and out symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75));
  });
  it('eases out', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
```

**File:** `test/unit/timemap.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { buildSegments, outputDurationMs, outputToSource, sourceToOutput } from '../../src/timeline/timemap';

describe('buildSegments', () => {
  it('is a single 1x segment without spans', () => {
    expect(buildSegments(10_000, [])).toEqual([{ srcStartMs: 0, srcEndMs: 10_000, speed: 1 }]);
  });

  it('speeds up an idle span', () => {
    const segs = buildSegments(10_000, [{ startMs: 2000, endMs: 5000, speed: 4 }]);
    expect(segs).toEqual([
      { srcStartMs: 0, srcEndMs: 2000, speed: 1 },
      { srcStartMs: 2000, srcEndMs: 5000, speed: 4 },
      { srcStartMs: 5000, srcEndMs: 10_000, speed: 1 },
    ]);
    expect(outputDurationMs(segs)).toBe(2000 + 750 + 5000);
  });

  it('lets later spans override earlier ones', () => {
    const segs = buildSegments(10_000, [
      { startMs: 1000, endMs: 5000, speed: 4 },
      { startMs: 3000, endMs: 4000, speed: 1 },
    ]);
    expect(segs).toEqual([
      { srcStartMs: 0, srcEndMs: 1000, speed: 1 },
      { srcStartMs: 1000, srcEndMs: 3000, speed: 4 },
      { srcStartMs: 3000, srcEndMs: 4000, speed: 1 },
      { srcStartMs: 4000, srcEndMs: 5000, speed: 4 },
      { srcStartMs: 5000, srcEndMs: 10_000, speed: 1 },
    ]);
  });

  it('merges adjacent equal speeds and clips spans to the video', () => {
    expect(buildSegments(10_000, [{ startMs: 0, endMs: 2000, speed: 1 }])).toEqual([
      { srcStartMs: 0, srcEndMs: 10_000, speed: 1 },
    ]);
    expect(buildSegments(1000, [{ startMs: -500, endMs: 5000, speed: 2 }])).toEqual([
      { srcStartMs: 0, srcEndMs: 1000, speed: 2 },
    ]);
  });
});

describe('time mapping', () => {
  const segs = buildSegments(10_000, [{ startMs: 2000, endMs: 6000, speed: 4 }]);

  it('maps output time to source time', () => {
    expect(outputToSource(segs, 0)).toBe(0);
    expect(outputToSource(segs, 1999)).toBe(1999);
    expect(outputToSource(segs, 2500)).toBe(4000);
    expect(outputToSource(segs, 3000)).toBe(6000);
    expect(outputToSource(segs, 999_999)).toBe(10_000);
  });

  it('round-trips through sourceToOutput', () => {
    for (const t of [0, 1500, 2000, 3333, 5999, 6000, 9000]) {
      expect(outputToSource(segs, sourceToOutput(segs, t))).toBeCloseTo(t, 6);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/math.test.ts test/unit/timemap.test.ts`
Expected: FAIL — modules `src/timeline/math`, `src/timeline/timemap` not found.

- [ ] **Step 3: Implement**

**File:** `src/timeline/types.ts`
```ts
import type { Step, Style } from '../script/schema';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CursorKind = 'arrow' | 'pointer' | 'text';

export interface Move {
  startMs: number;
  endMs: number;
  from: Pt;
  to: Pt;
  cursor: CursorKind;
}

export interface Click {
  tMs: number;
  x: number;
  y: number;
}

export interface Interval {
  startMs: number;
  endMs: number;
}

export interface StepEvent {
  sceneId: string;
  index: number;
  do: Step['do'];
  /** step begins (before scroll / cursor travel) */
  startMs: number;
  /** cursor arrived, action performed */
  actionMs: number;
  /** action finished (excludes settle / hold) */
  endMs: number;
  /** after settle + beat + hold */
  settledMs: number;
  /** CSS px, viewport-relative, measured after scrolling */
  target?: Rect;
}

/** Written by `record` to take/events.json. All times: ms since capture start. */
export interface TakeEvents {
  version: 1;
  actionHash: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  video: { file: string; width: number; height: number; fps: number; durationMs: number };
  steps: StepEvent[];
  moves: Move[];
  clicks: Click[];
  idle: Interval[];
}

export interface Segment {
  srcStartMs: number;
  srcEndMs: number;
  speed: number;
}

export interface CameraKey {
  tMs: number;
  scale: number;
  /** focus, 0..1 of stage width */
  cx: number;
  /** focus, 0..1 of stage height */
  cy: number;
}

export interface Caption {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Spotlight {
  startMs: number;
  endMs: number;
  rect: Rect;
}

export type ResolvedStyle = Style;

/** The renderer contract. All overlay times are source ms. */
export interface Timeline {
  version: 1;
  fps: number;
  output: { width: number; height: number };
  stage: { width: number; height: number };
  video: { src: string; durationMs: number };
  intro: { title: string; subtitle?: string; durationMs: number } | null;
  segments: Segment[];
  camera: CameraKey[];
  moves: Move[];
  clicks: Click[];
  captions: Caption[];
  spotlights: Spotlight[];
  style: ResolvedStyle;
}
```

**File:** `src/timeline/math.ts`
```ts
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
```

**File:** `src/timeline/timemap.ts`
```ts
import type { Interval, Segment } from './types';

export interface SpeedSpan extends Interval {
  speed: number;
}

/** Cover [0, durationMs] with speed segments. Later spans win where spans overlap. */
export function buildSegments(durationMs: number, spans: SpeedSpan[]): Segment[] {
  const clip = (t: number) => Math.min(durationMs, Math.max(0, t));
  const cuts = new Set<number>([0, durationMs]);
  for (const s of spans) {
    cuts.add(clip(s.startMs));
    cuts.add(clip(s.endMs));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const mid = (a + b) / 2;
    let speed = 1;
    for (const s of spans) if (s.startMs <= mid && mid < s.endMs) speed = s.speed;
    const last = out[out.length - 1];
    if (last && last.speed === speed) last.srcEndMs = b;
    else out.push({ srcStartMs: a, srcEndMs: b, speed });
  }
  return out;
}

export function outputDurationMs(segments: Segment[]): number {
  return segments.reduce((acc, s) => acc + (s.srcEndMs - s.srcStartMs) / s.speed, 0);
}

export function outputToSource(segments: Segment[], tOutMs: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = (s.srcEndMs - s.srcStartMs) / s.speed;
    if (tOutMs < acc + len) return s.srcStartMs + Math.max(0, tOutMs - acc) * s.speed;
    acc += len;
  }
  return segments.length ? segments[segments.length - 1].srcEndMs : 0;
}

export function sourceToOutput(segments: Segment[], tSrcMs: number): number {
  let acc = 0;
  for (const s of segments) {
    if (tSrcMs < s.srcEndMs) return acc + Math.max(0, tSrcMs - s.srcStartMs) / s.speed;
    acc += (s.srcEndMs - s.srcStartMs) / s.speed;
  }
  return acc;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: timeline contracts, easing and speed-segment time mapping"
```

---

### Task 3: Camera and cursor math

**Files:**
- Create: `src/timeline/camera.ts`, `src/timeline/cursor.ts`
- Test: `test/unit/camera.test.ts`, `test/unit/cursor.test.ts`

**Interfaces:**
- Consumes: `clamp`, `lerp`, `easeInOutCubic` (Task 2); types `CameraKey, Rect, Move, Click, CursorKind` (Task 2).
- Produces:
  - `ZOOM_LEAD_MS = 700`, `CONNECT_GAP_MS = 1500`, `MIN_ZOOM = 1.15`
  - `interface ZoomRegion { startMs; endMs; scale; cx; cy }`
  - `zoomDepth(target: Rect, stage: {width,height}, maxZoom: number): number`
  - `clampFocus(scale, cx, cy): { cx; cy }`
  - `buildCamera(regions: ZoomRegion[]): CameraKey[]`
  - `cameraAt(keys: CameraKey[], tMs: number): CameraKey`
  - `cameraTransform(cam: CameraKey, width: number, height: number): string` (CSS, origin `0 0`)
  - `interface CursorState { x; y; kind: CursorKind; visible: boolean; opacity: number; press: number }`
  - `cursorAt(moves: Move[], clicks: Click[], tMs: number): CursorState`
  - `pressAt(clicks, tMs): number`, `RIPPLE_MS = 450`, `ripplesAt(clicks, tMs): Array<{ x; y; tMs; progress }>`

- [ ] **Step 1: Write the failing tests**

**File:** `test/unit/camera.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { buildCamera, cameraAt, cameraTransform, clampFocus, zoomDepth } from '../../src/timeline/camera';

const stage = { width: 1440, height: 900 };

describe('zoomDepth', () => {
  it('zooms small targets up to maxZoom', () => {
    expect(zoomDepth({ x: 0, y: 0, width: 120, height: 40 }, stage, 1.8)).toBe(1.8);
  });
  it('does not zoom targets that fill the stage', () => {
    expect(zoomDepth({ x: 0, y: 0, width: 1400, height: 880 }, stage, 1.8)).toBe(1);
  });
  it('fits medium targets with margin', () => {
    expect(zoomDepth({ x: 0, y: 0, width: 600, height: 400 }, stage, 3)).toBeCloseTo(900 / 560);
  });
});

describe('clampFocus', () => {
  it('keeps the visible window inside the stage', () => {
    expect(clampFocus(2, 0.1, 0.95)).toEqual({ cx: 0.25, cy: 0.75 });
    expect(clampFocus(1, 0.1, 0.9)).toEqual({ cx: 0.5, cy: 0.5 });
  });
});

describe('buildCamera', () => {
  it('zooms in before and out after a single region', () => {
    const keys = buildCamera([{ startMs: 2000, endMs: 4000, scale: 2, cx: 0.5, cy: 0.5 }]);
    expect(keys).toEqual([
      { tMs: 1300, scale: 1, cx: 0.5, cy: 0.5 },
      { tMs: 2000, scale: 2, cx: 0.5, cy: 0.5 },
      { tMs: 4000, scale: 2, cx: 0.5, cy: 0.5 },
      { tMs: 4700, scale: 1, cx: 0.5, cy: 0.5 },
    ]);
  });

  it('pans between close regions without zooming out', () => {
    const keys = buildCamera([
      { startMs: 2000, endMs: 3000, scale: 2, cx: 0.3, cy: 0.3 },
      { startMs: 4000, endMs: 5000, scale: 1.5, cx: 0.6, cy: 0.6 },
    ]);
    expect(keys.map((k) => k.scale)).toEqual([1, 2, 2, 1.5, 1.5, 1]);
    expect(keys.map((k) => k.tMs)).toEqual([1300, 2000, 3000, 4000, 5000, 5700]);
  });

  it('zooms out between distant regions', () => {
    const keys = buildCamera([
      { startMs: 2000, endMs: 3000, scale: 2, cx: 0.5, cy: 0.5 },
      { startMs: 8000, endMs: 9000, scale: 2, cx: 0.5, cy: 0.5 },
    ]);
    expect(keys.map((k) => k.scale)).toEqual([1, 2, 2, 1, 1, 2, 2, 1]);
  });

  it('never puts a key before 0 and keeps keys monotonic', () => {
    const keys = buildCamera([{ startMs: 300, endMs: 1000, scale: 2, cx: 0.5, cy: 0.5 }]);
    expect(keys[0].tMs).toBe(0);
    for (let i = 1; i < keys.length; i++) expect(keys[i].tMs).toBeGreaterThanOrEqual(keys[i - 1].tMs);
  });

  it('clamps focus into the stage', () => {
    const keys = buildCamera([{ startMs: 2000, endMs: 3000, scale: 2, cx: 0, cy: 1 }]);
    expect(keys[1]).toMatchObject({ cx: 0.25, cy: 0.75 });
  });
});

describe('cameraAt', () => {
  const keys = buildCamera([{ startMs: 2000, endMs: 4000, scale: 2, cx: 0.5, cy: 0.5 }]);

  it('is identity without keys', () => {
    expect(cameraAt([], 123)).toEqual({ tMs: 123, scale: 1, cx: 0.5, cy: 0.5 });
  });
  it('holds the first and last key outside the range', () => {
    expect(cameraAt(keys, 0).scale).toBe(1);
    expect(cameraAt(keys, 99_999).scale).toBe(1);
  });
  it('eases between keys', () => {
    expect(cameraAt(keys, 1650).scale).toBeCloseTo(1.5);
    expect(cameraAt(keys, 3000).scale).toBe(2);
  });
});

describe('cameraTransform', () => {
  it('is the identity at scale 1', () => {
    expect(cameraTransform({ tMs: 0, scale: 1, cx: 0.5, cy: 0.5 }, 100, 50)).toBe('translate(0px, 0px) scale(1)');
  });
  it('puts the focus at the centre', () => {
    expect(cameraTransform({ tMs: 0, scale: 2, cx: 0.75, cy: 0.25 }, 100, 100)).toBe('translate(-100px, 0px) scale(2)');
  });
});
```

**File:** `test/unit/cursor.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { cursorAt, pressAt, ripplesAt } from '../../src/timeline/cursor';
import type { Move } from '../../src/timeline/types';

const moves: Move[] = [
  { startMs: 1000, endMs: 1500, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, cursor: 'pointer' },
  { startMs: 3000, endMs: 3600, from: { x: 100, y: 0 }, to: { x: 100, y: 300 }, cursor: 'text' },
];

describe('cursorAt', () => {
  it('is hidden before the first move', () => {
    expect(cursorAt(moves, [], 500)).toMatchObject({ visible: false, x: 0, y: 0 });
  });
  it('is hidden without moves', () => {
    expect(cursorAt([], [], 500).visible).toBe(false);
  });
  it('starts at the origin and fades in', () => {
    const c = cursorAt(moves, [], 1000);
    expect(c).toMatchObject({ visible: true, x: 0, y: 0, opacity: 0 });
    expect(cursorAt(moves, [], 1200).opacity).toBe(1);
  });
  it('travels on a slight arc and arrives exactly', () => {
    const mid = cursorAt(moves, [], 1250);
    expect(mid.x).toBeCloseTo(50);
    expect(Math.abs(mid.y)).toBeGreaterThan(1);
    expect(cursorAt(moves, [], 1500)).toMatchObject({ x: 100, y: 0, kind: 'pointer' });
  });
  it('holds between moves and switches kind near arrival', () => {
    expect(cursorAt(moves, [], 2500)).toMatchObject({ x: 100, y: 0, kind: 'pointer' });
    expect(cursorAt(moves, [], 3100).kind).toBe('pointer');
    expect(cursorAt(moves, [], 3590).kind).toBe('text');
    expect(cursorAt(moves, [], 5000)).toMatchObject({ x: 100, y: 300, kind: 'text' });
  });
});

describe('pressAt / ripplesAt', () => {
  const clicks = [{ tMs: 1500, x: 100, y: 0 }];
  it('squashes briefly on click', () => {
    expect(pressAt(clicks, 1400)).toBe(1);
    expect(pressAt(clicks, 1570)).toBeCloseTo(0.85);
    expect(pressAt(clicks, 1700)).toBe(1);
  });
  it('emits a ripple for 450 ms', () => {
    expect(ripplesAt(clicks, 1499)).toEqual([]);
    expect(ripplesAt(clicks, 1725)).toEqual([{ x: 100, y: 0, tMs: 1500, progress: 0.5 }]);
    expect(ripplesAt(clicks, 1951)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/camera.test.ts test/unit/cursor.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

**File:** `src/timeline/camera.ts`
```ts
import { clamp, easeInOutCubic, lerp } from './math';
import type { CameraKey, Rect } from './types';

export const ZOOM_LEAD_MS = 700;
export const CONNECT_GAP_MS = 1500;
export const MIN_ZOOM = 1.15;
const ZOOM_MARGIN_PX = 160;

export interface ZoomRegion {
  startMs: number;
  endMs: number;
  scale: number;
  cx: number;
  cy: number;
}

export function zoomDepth(target: Rect, stage: { width: number; height: number }, maxZoom: number): number {
  const fit = Math.min(stage.width / (target.width + ZOOM_MARGIN_PX), stage.height / (target.height + ZOOM_MARGIN_PX));
  return clamp(fit, 1, maxZoom);
}

export function clampFocus(scale: number, cx: number, cy: number): { cx: number; cy: number } {
  const half = 0.5 / scale;
  return { cx: clamp(cx, half, 1 - half), cy: clamp(cy, half, 1 - half) };
}

const rest = (tMs: number): CameraKey => ({ tMs, scale: 1, cx: 0.5, cy: 0.5 });

export function buildCamera(regions: ZoomRegion[]): CameraKey[] {
  const rs = [...regions].sort((a, b) => a.startMs - b.startMs);
  const keys: CameraKey[] = [];
  rs.forEach((r, i) => {
    const prev = rs[i - 1];
    const next = rs[i + 1];
    const start = prev ? Math.max(r.startMs, prev.endMs) : r.startMs;
    const end = Math.max(start, r.endMs);
    const focus = clampFocus(r.scale, r.cx, r.cy);
    if (!prev || start - prev.endMs > CONNECT_GAP_MS) {
      const lastT = keys.length ? keys[keys.length - 1].tMs : 0;
      keys.push(rest(Math.max(lastT, start - ZOOM_LEAD_MS)));
    }
    keys.push({ tMs: start, scale: r.scale, ...focus });
    keys.push({ tMs: end, scale: r.scale, ...focus });
    if (!next || next.startMs - end > CONNECT_GAP_MS) keys.push(rest(end + ZOOM_LEAD_MS));
  });
  return keys;
}

export function cameraAt(keys: CameraKey[], tMs: number): CameraKey {
  if (!keys.length) return { ...rest(tMs) };
  if (tMs <= keys[0].tMs) return { ...keys[0], tMs };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (tMs > b.tMs) continue;
    const a = keys[i - 1];
    if (b.tMs === a.tMs) return { ...b, tMs };
    const e = easeInOutCubic((tMs - a.tMs) / (b.tMs - a.tMs));
    return { tMs, scale: lerp(a.scale, b.scale, e), cx: lerp(a.cx, b.cx, e), cy: lerp(a.cy, b.cy, e) };
  }
  return { ...keys[keys.length - 1], tMs };
}

/** CSS transform (transform-origin 0 0) that puts the focus point at the centre of a width×height box. */
export function cameraTransform(cam: CameraKey, width: number, height: number): string {
  const tx = width / 2 - cam.cx * width * cam.scale;
  const ty = height / 2 - cam.cy * height * cam.scale;
  const r = (v: number) => Math.round(v * 100) / 100 + 0;
  return `translate(${r(tx)}px, ${r(ty)}px) scale(${r(cam.scale * 1000) / 1000})`;
}
```

**File:** `src/timeline/cursor.ts`
```ts
import { clamp, easeInOutCubic } from './math';
import type { Click, CursorKind, Move } from './types';

export const RIPPLE_MS = 450;
const PRESS_MS = 140;
const FADE_IN_MS = 200;
const KIND_SWITCH_AT = 0.9;

export interface CursorState {
  x: number;
  y: number;
  kind: CursorKind;
  visible: boolean;
  opacity: number;
  press: number;
}

export function pressAt(clicks: Click[], tMs: number): number {
  for (const c of clicks) {
    const d = tMs - c.tMs;
    if (d >= 0 && d <= PRESS_MS) return 1 - 0.15 * Math.sin((Math.PI * d) / PRESS_MS);
  }
  return 1;
}

export function ripplesAt(clicks: Click[], tMs: number): Array<{ x: number; y: number; tMs: number; progress: number }> {
  return clicks
    .filter((c) => tMs >= c.tMs && tMs <= c.tMs + RIPPLE_MS)
    .map((c) => ({ x: c.x, y: c.y, tMs: c.tMs, progress: (tMs - c.tMs) / RIPPLE_MS }));
}

export function cursorAt(moves: Move[], clicks: Click[], tMs: number): CursorState {
  if (!moves.length) return { x: 0, y: 0, kind: 'arrow', visible: false, opacity: 0, press: 1 };
  const first = moves[0];
  if (tMs < first.startMs) return { ...first.from, kind: 'arrow', visible: false, opacity: 0, press: 1 };

  let i = 0;
  while (i + 1 < moves.length && moves[i + 1].startMs <= tMs) i++;
  const m = moves[i];
  const prevKind: CursorKind = i > 0 ? moves[i - 1].cursor : 'arrow';

  let { x, y } = m.to;
  let kind = m.cursor;
  if (tMs < m.endMs) {
    const p = clamp((tMs - m.startMs) / Math.max(1, m.endMs - m.startMs), 0, 1);
    const e = easeInOutCubic(p);
    const dx = m.to.x - m.from.x;
    const dy = m.to.y - m.from.y;
    const dist = Math.hypot(dx, dy);
    const arc = Math.sin(Math.PI * p) * Math.min(40, dist * 0.08);
    const nx = dist ? -dy / dist : 0;
    const ny = dist ? dx / dist : 0;
    x = m.from.x + dx * e + nx * arc;
    y = m.from.y + dy * e + ny * arc;
    kind = p < KIND_SWITCH_AT ? prevKind : m.cursor;
  }
  const opacity = clamp((tMs - first.startMs) / FADE_IN_MS, 0, 1);
  return { x, y, kind, visible: true, opacity, press: pressAt(clicks, tMs) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: camera keyframes, cursor path, click press and ripples"
```

---
### Task 4: Build the timeline, frame math, window layout

**Files:**
- Create: `src/timeline/build.ts`, `src/timeline/frames.ts`, `src/timeline/layout.ts`
- Test: `test/unit/build.test.ts`, `test/unit/frames.test.ts`

**Interfaces:**
- Consumes: `parseScript`, `Script`, `Step` (Task 1); `buildSegments`, `outputDurationMs`, `outputToSource`, `sourceToOutput`, `SpeedSpan` (Task 2); `buildCamera`, `zoomDepth`, `MIN_ZOOM`, `ZoomRegion` (Task 3).
- Produces:
  - `buildTimeline(script: Script, ev: TakeEvents, opts?: { fps?: number; output?: { width: number; height: number } }): Timeline`
  - constants `AUTO_SPEED_MIN_IDLE_MS = 800`, `AUTO_SPEED_TARGET_MS = 600`, `INTRO_MS = 2200`, `CAPTION_MIN_MS = 1500`, `SPOTLIGHT_PAD = 8`
  - `interface SegmentPlan { fromFrame; durationInFrames; trimBefore; speed }`, `interface Shot { frame: number; name: string }`
  - `introFrames(t)`, `totalFrames(t)`, `segmentPlan(t): SegmentPlan[]`, `sourceMsAtFrame(t, frame): number | null`, `qaShots(t, steps: StepEvent[]): Shot[]`
  - `interface Box { x; y; width; height }`, `windowLayout(output, stage, padding): Box`

- [ ] **Step 1: Write the failing tests**

**File:** `test/unit/build.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { parseScript } from '../../src/script/schema';
import { buildTimeline } from '../../src/timeline/build';
import type { TakeEvents } from '../../src/timeline/types';

const script = (style: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  parseScript({
    version: 1,
    meta: { title: 'Demo', subtitle: 'Sub' },
    app: { url: 'http://x' },
    style,
    scenes: [
      {
        id: 's',
        steps: [
          { do: 'click', target: '#a', show: { caption: 'Open it' } },
          { do: 'wait', for: 'text=Ready' },
          { do: 'type', target: '#q', text: 'hi', show: { spotlight: true } },
          { do: 'press', key: 'Enter', show: { speed: 2 } },
        ],
      },
    ],
    ...overrides,
  });

const events: TakeEvents = {
  version: 1,
  actionHash: 'x',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  video: { file: 'raw.mp4', width: 2880, height: 1800, fps: 30, durationMs: 12_000 },
  steps: [
    { sceneId: 's', index: 0, do: 'click', startMs: 800, actionMs: 1400, endMs: 1450, settledMs: 1900, target: { x: 100, y: 100, width: 120, height: 40 } },
    { sceneId: 's', index: 1, do: 'wait', startMs: 1900, actionMs: 1900, endMs: 5900, settledMs: 6400 },
    { sceneId: 's', index: 2, do: 'type', startMs: 6400, actionMs: 7000, endMs: 7600, settledMs: 8100, target: { x: 600, y: 400, width: 300, height: 40 } },
    { sceneId: 's', index: 3, do: 'press', startMs: 8100, actionMs: 8100, endMs: 8150, settledMs: 8600 },
  ],
  moves: [
    { startMs: 800, endMs: 1400, from: { x: 720, y: 450 }, to: { x: 160, y: 120 }, cursor: 'pointer' },
    { startMs: 6400, endMs: 7000, from: { x: 160, y: 120 }, to: { x: 750, y: 420 }, cursor: 'text' },
  ],
  clicks: [
    { tMs: 1400, x: 160, y: 120 },
    { tMs: 7000, x: 750, y: 420 },
  ],
  idle: [{ startMs: 1900, endMs: 5900 }],
};

describe('buildTimeline', () => {
  const t = buildTimeline(script(), events);

  it('carries the take and defaults', () => {
    expect(t).toMatchObject({ version: 1, fps: 30, output: { width: 1920, height: 1080 }, stage: { width: 1440, height: 900 } });
    expect(t.video).toEqual({ src: 'raw.mp4', durationMs: 12_000 });
    expect(t.intro).toEqual({ title: 'Demo', subtitle: 'Sub', durationMs: 2200 });
    expect(t.moves).toBe(events.moves);
    expect(t.clicks).toBe(events.clicks);
  });

  it('speeds up idle time and honours explicit speed', () => {
    expect(t.segments).toEqual([
      { srcStartMs: 0, srcEndMs: 1900, speed: 1 },
      { srcStartMs: 1900, srcEndMs: 5900, speed: 4000 / 600 },
      { srcStartMs: 5900, srcEndMs: 8100, speed: 1 },
      { srcStartMs: 8100, srcEndMs: 8600, speed: 2 },
      { srcStartMs: 8600, srcEndMs: 12_000, speed: 1 },
    ]);
  });

  it('builds captions with a minimum duration', () => {
    expect(t.captions).toEqual([{ startMs: 800, endMs: 2300, text: 'Open it' }]);
  });

  it('builds padded spotlights from the action to settle', () => {
    expect(t.spotlights).toEqual([{ startMs: 7000, endMs: 8100, rect: { x: 592, y: 392, width: 316, height: 56 } }]);
  });

  it('zooms on click and type, separately when far apart', () => {
    expect(t.camera.map((k) => k.tMs)).toEqual([700, 1400, 1900, 2600, 6300, 7000, 8100, 8800]);
    expect(t.camera[1]).toMatchObject({ scale: 1.8 });
    expect(t.camera[1].cx).toBeCloseTo(0.5 / 1.8);
  });

  it('skips auto zoom and auto speed when disabled', () => {
    const off = buildTimeline(script({ autoZoom: false, autoSpeed: false }), events);
    expect(off.camera).toEqual([]);
    expect(off.segments.map((s) => s.speed)).toEqual([1, 2, 1]);
  });

  it('respects zoom: false and explicit zoom depth', () => {
    const s = script({}, {});
    s.scenes[0].steps[0] = { do: 'click', target: '#a', show: { zoom: false } };
    s.scenes[0].steps[2] = { do: 'type', target: '#q', text: 'hi', pace: 'human', clear: false, show: { zoom: 1.3 } };
    const z = buildTimeline(s, events);
    expect(z.camera.map((k) => k.scale)).toEqual([1, 1.3, 1.3, 1]);
  });

  it('has no intro without a title', () => {
    expect(buildTimeline(script({}, { meta: {} }), events).intro).toBeNull();
  });

  it('refuses events that do not match the script', () => {
    const bad = { ...events, steps: [{ ...events.steps[0], sceneId: 'nope' }] };
    expect(() => buildTimeline(script(), bad)).toThrow(/does not match the script/);
  });
});
```

**File:** `test/unit/frames.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { introFrames, qaShots, segmentPlan, sourceMsAtFrame, totalFrames } from '../../src/timeline/frames';
import { windowLayout } from '../../src/timeline/layout';
import type { StepEvent, Timeline } from '../../src/timeline/types';

const timeline = (intro: boolean): Timeline =>
  ({
    version: 1,
    fps: 30,
    output: { width: 1920, height: 1080 },
    stage: { width: 1440, height: 900 },
    video: { src: 'raw.mp4', durationMs: 10_000 },
    intro: intro ? { title: 'T', durationMs: 2200 } : null,
    segments: [
      { srcStartMs: 0, srcEndMs: 2000, speed: 1 },
      { srcStartMs: 2000, srcEndMs: 6000, speed: 4 },
      { srcStartMs: 6000, srcEndMs: 10_000, speed: 1 },
    ],
    camera: [],
    moves: [],
    clicks: [],
    captions: [],
    spotlights: [],
    style: {} as Timeline['style'],
  }) as Timeline;

describe('frame math', () => {
  const t = timeline(true);

  it('counts intro and output frames', () => {
    expect(introFrames(t)).toBe(66);
    expect(introFrames(timeline(false))).toBe(0);
    expect(totalFrames(t)).toBe(66 + 210);
  });

  it('plans one sequence per segment, back to back', () => {
    expect(segmentPlan(t)).toEqual([
      { fromFrame: 66, durationInFrames: 60, trimBefore: 0, speed: 1 },
      { fromFrame: 126, durationInFrames: 30, trimBefore: 60, speed: 4 },
      { fromFrame: 156, durationInFrames: 120, trimBefore: 180, speed: 1 },
    ]);
  });

  it('maps frames to source time', () => {
    expect(sourceMsAtFrame(t, 65)).toBeNull();
    expect(sourceMsAtFrame(t, 66)).toBe(0);
    expect(sourceMsAtFrame(t, 66 + 75)).toBeCloseTo(4000);
  });

  it('lists QA shots: intro, then one per step at mid-action', () => {
    const steps: StepEvent[] = [
      { sceneId: 'a', index: 0, do: 'click', startMs: 0, actionMs: 1000, endMs: 1100, settledMs: 1600 },
      { sceneId: 'a', index: 1, do: 'wait', startMs: 1600, actionMs: 1600, endMs: 5600, settledMs: 6400 },
    ];
    expect(qaShots(t, steps)).toEqual([
      { frame: 33, name: '00-intro' },
      { frame: 66 + 39, name: '01-a-1-click' },
      { frame: 66 + Math.round(((2000 + (4000 - 2000) / 4) * 30) / 1000), name: '02-a-2-wait' },
    ]);
  });
});

describe('windowLayout', () => {
  it('fits the stage inside the padded output, centred', () => {
    expect(windowLayout({ width: 1920, height: 1080 }, { width: 1440, height: 900 }, 0.06)).toEqual({
      x: 200,
      y: 65,
      width: 1521,
      height: 950,
    });
  });
  it('fills the output without padding when aspect ratios match', () => {
    expect(windowLayout({ width: 1920, height: 1080 }, { width: 1280, height: 720 }, 0)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });
});
```

Notes on expected numbers (for the implementer): `introFrames = round(2200·30/1000) = 66`; output duration = 2000 + 1000 + 4000 = 7000 ms → 210 frames. QA shot 1: mid = (1000+1600)/2 = 1300 ms → 39 frames. QA shot 2: mid = (1600+6400)/2 = 4000 ms source → 2000 + 2000/4 = 2500 ms output → 75 frames.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/build.test.ts test/unit/frames.test.ts`
Expected: FAIL — modules `build`, `frames`, `layout` not found.

- [ ] **Step 3: Implement**

**File:** `src/timeline/build.ts`
```ts
import type { Script, Step } from '../script/schema';
import { buildCamera, MIN_ZOOM, zoomDepth, type ZoomRegion } from './camera';
import { clamp } from './math';
import { buildSegments, type SpeedSpan } from './timemap';
import type { Caption, Rect, Spotlight, StepEvent, TakeEvents, Timeline } from './types';

export const AUTO_SPEED_MIN_IDLE_MS = 800;
export const AUTO_SPEED_TARGET_MS = 600;
export const INTRO_MS = 2200;
export const CAPTION_MIN_MS = 1500;
export const SPOTLIGHT_PAD = 8;

const ZOOMABLE = new Set<Step['do']>(['click', 'type', 'select', 'hover']);

export interface BuildOptions {
  fps?: number;
  output?: { width: number; height: number };
}

function stepOf(script: Script, e: StepEvent): Step {
  const step = script.scenes.find((s) => s.id === e.sceneId)?.steps[e.index];
  if (!step) throw new Error(`Take does not match the script: no step ${e.index + 1} in scene "${e.sceneId}"`);
  return step;
}

const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, width: r.width + 2 * p, height: r.height + 2 * p });

export function buildTimeline(script: Script, ev: TakeEvents, opts: BuildOptions = {}): Timeline {
  const { style } = script;
  const stage = ev.viewport;
  const pairs = ev.steps.map((e) => ({ e, step: stepOf(script, e) }));

  // Speed: auto idle first, explicit `show.speed` next, pauses last (later spans win).
  const spans: SpeedSpan[] = [];
  if (style.autoSpeed) {
    for (const i of ev.idle) {
      const len = i.endMs - i.startMs;
      if (len > AUTO_SPEED_MIN_IDLE_MS) spans.push({ ...i, speed: clamp(len / AUTO_SPEED_TARGET_MS, 2, 8) });
    }
  }
  for (const { e, step } of pairs) {
    if (step.show?.speed !== undefined) spans.push({ startMs: e.startMs, endMs: e.settledMs, speed: step.show.speed });
  }
  for (const { e, step } of pairs) {
    if (step.do === 'pause') spans.push({ startMs: e.startMs, endMs: e.endMs, speed: 1 });
  }

  const regions: ZoomRegion[] = [];
  const captions: Caption[] = [];
  const spotlights: Spotlight[] = [];
  for (const { e, step } of pairs) {
    const zoom = step.show?.zoom;
    const wantsZoom = typeof zoom === 'number' || (zoom === undefined && style.autoZoom && ZOOMABLE.has(step.do));
    if (e.target && wantsZoom) {
      const scale = typeof zoom === 'number' ? zoom : zoomDepth(e.target, stage, style.maxZoom);
      if (scale >= MIN_ZOOM) {
        regions.push({
          startMs: e.actionMs,
          endMs: e.settledMs,
          scale,
          cx: (e.target.x + e.target.width / 2) / stage.width,
          cy: (e.target.y + e.target.height / 2) / stage.height,
        });
      }
    }
    if (step.show?.caption) {
      captions.push({ startMs: e.startMs, endMs: Math.max(e.settledMs, e.startMs + CAPTION_MIN_MS), text: step.show.caption });
    }
    if (step.show?.spotlight && e.target) {
      spotlights.push({ startMs: e.actionMs, endMs: e.settledMs, rect: pad(e.target, SPOTLIGHT_PAD) });
    }
  }

  return {
    version: 1,
    fps: opts.fps ?? 30,
    output: opts.output ?? { width: 1920, height: 1080 },
    stage,
    video: { src: ev.video.file, durationMs: ev.video.durationMs },
    intro: script.meta.title ? { title: script.meta.title, subtitle: script.meta.subtitle, durationMs: INTRO_MS } : null,
    segments: buildSegments(ev.video.durationMs, spans),
    camera: buildCamera(regions),
    moves: ev.moves,
    clicks: ev.clicks,
    captions,
    spotlights,
    style,
  };
}
```

**File:** `src/timeline/frames.ts`
```ts
import { outputDurationMs, outputToSource, sourceToOutput } from './timemap';
import type { StepEvent, Timeline } from './types';

export interface SegmentPlan {
  fromFrame: number;
  durationInFrames: number;
  /** source frame where this segment starts */
  trimBefore: number;
  speed: number;
}

export interface Shot {
  frame: number;
  name: string;
}

const toFrames = (ms: number, fps: number) => Math.round((ms * fps) / 1000);

export function introFrames(t: Timeline): number {
  return t.intro ? toFrames(t.intro.durationMs, t.fps) : 0;
}

export function totalFrames(t: Timeline): number {
  return Math.max(1, introFrames(t) + toFrames(outputDurationMs(t.segments), t.fps));
}

export function segmentPlan(t: Timeline): SegmentPlan[] {
  const intro = introFrames(t);
  const plan: SegmentPlan[] = [];
  let outMs = 0;
  for (const s of t.segments) {
    const startF = toFrames(outMs, t.fps);
    outMs += (s.srcEndMs - s.srcStartMs) / s.speed;
    const endF = toFrames(outMs, t.fps);
    if (endF > startF) {
      plan.push({ fromFrame: intro + startF, durationInFrames: endF - startF, trimBefore: toFrames(s.srcStartMs, t.fps), speed: s.speed });
    }
  }
  return plan;
}

/** Source ms shown at a composition frame, or null during the intro. */
export function sourceMsAtFrame(t: Timeline, frame: number): number | null {
  const f = frame - introFrames(t);
  if (f < 0) return null;
  return outputToSource(t.segments, (f * 1000) / t.fps);
}

export function qaShots(t: Timeline, steps: StepEvent[]): Shot[] {
  const intro = introFrames(t);
  const last = totalFrames(t) - 1;
  const shots: Shot[] = [];
  if (t.intro) shots.push({ frame: Math.floor(intro / 2), name: '00-intro' });
  steps.forEach((s, i) => {
    const mid = (s.actionMs + s.settledMs) / 2;
    const frame = Math.min(last, intro + toFrames(sourceToOutput(t.segments, mid), t.fps));
    shots.push({ frame, name: `${String(i + 1).padStart(2, '0')}-${s.sceneId}-${s.index + 1}-${s.do}` });
  });
  return shots;
}
```

**File:** `src/timeline/layout.ts`
```ts
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the recorded viewport ("window") sits inside the output frame. */
export function windowLayout(
  output: { width: number; height: number },
  stage: { width: number; height: number },
  padding: number,
): Box {
  const availW = output.width * (1 - 2 * padding);
  const availH = output.height * (1 - 2 * padding);
  const k = Math.min(availW / stage.width, availH / stage.height);
  const width = Math.round(stage.width * k);
  const height = Math.round(stage.height * k);
  return { x: Math.round((output.width - width) / 2), y: Math.round((output.height - height) / 2), width, height };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: buildTimeline (speed, zoom, captions, spotlights) and frame math"
```

---

### Task 5: Fixture app, browser session, step runner, `check`

**Files:**
- Create: `fixtures/demo-app/index.html`, `fixtures/demo.json`
- Create: `test/helpers/serve.ts`, `test/helpers/fixture.ts`
- Create: `src/runner/time.ts`, `src/runner/events.ts`, `src/runner/browser.ts`, `src/runner/steps.ts`, `src/runner/check.ts`
- Test: `test/unit/time.test.ts`, `test/integration/check.test.ts`

**Interfaces:**
- Consumes: `LoadedScript`, `loadScript`, `Script`, `Step` (Task 1); `workPaths` (Task 1); `Pt, Rect, CursorKind, StepEvent, Move, Click, Interval` (Task 2); `clamp`, `easeInOutCubic` (Task 2).
- Produces:
  - `sleep(ms): Promise<void>`, `rng(seed: string): () => number`
  - `class EventLog { steps; moves; clicks; idle; constructor(t0?: number); now(): number }`
  - `interface NetworkTracker { idle(quietMs: number, capMs: number): Promise<void> }`
  - `interface Session { browser; context; page; net: NetworkTracker; close(): Promise<void> }`
  - `openSession(script, opts?: { headed?: boolean }): Promise<Session>`
  - `prepare(session, script): Promise<Pt>` — opens `app.url`, runs `setup`, parks the mouse at the viewport centre and returns it
  - `type Mode = 'record' | 'check'`; `interface StepContext { page; mode; log: EventLog; net: NetworkTracker; cursor: Pt }`
  - `class StepError extends Error { where: { sceneId; index }; step: Step }`
  - `runStep(ctx, step, where): Promise<void>`, `describeStep(step): string`
  - constants `STEP_TIMEOUT_MS = 10_000`, `WAIT_TIMEOUT_MS = 15_000`, `BEAT_MS = 450`
  - `interface RunOptions { headed?: boolean; log?: (line: string) => void }`
  - `check(loaded, opts?): Promise<CheckReport>`; `CheckReport { ok; steps: CheckStep[]; failure: CheckFailure | null }`
  - test helpers: `serveDir(dir, port?): Promise<{ url: string; close(): Promise<void> }>`, `FIXTURES`, `fixtureScript(url, mutate?): Promise<LoadedScript>`

- [ ] **Step 1: Create the fixture app, example script and test helpers**

**File:** `fixtures/demo-app/index.html`
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Acme Analytics</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 15px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; background: #f6f7fb; color: #0f172a; }
      header { display: flex; align-items: center; gap: 24px; padding: 16px 32px; background: #fff; border-bottom: 1px solid #e5e7eb; }
      header b { font-size: 18px; }
      nav a { color: #475569; margin-right: 16px; text-decoration: none; }
      main { padding: 32px; max-width: 1100px; margin: 0 auto; }
      .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
      .card .v { font-size: 28px; font-weight: 700; }
      button { font: inherit; padding: 10px 16px; border-radius: 8px; border: 0; background: #4f46e5; color: #fff; cursor: pointer; }
      button.secondary { background: #e2e8f0; color: #0f172a; }
      input, select { font: inherit; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; width: 100%; background: #fff; }
      label { display: grid; gap: 6px; }
      .modal-bg { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: none; align-items: center; justify-content: center; }
      .modal-bg.open { display: flex; }
      .modal { background: #fff; border-radius: 14px; padding: 24px; width: 420px; display: grid; gap: 14px; }
      .spinner { width: 28px; height: 28px; border: 3px solid #c7d2fe; border-top-color: #4f46e5; border-radius: 50%; animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .far { margin-top: 1400px; }
    </style>
  </head>
  <body>
    <header>
      <b>Acme Analytics</b>
      <nav><a href="#">Dashboard</a><a href="#">Reports</a><a href="#">Settings</a></nav>
      <span style="margin-left: auto" class="customer-email">olena@example.com</span>
    </header>
    <main>
      <div style="display: flex; align-items: center; justify-content: space-between">
        <h1 style="margin: 0">Dashboard</h1>
        <button id="new-report">New report</button>
      </div>
      <div class="cards">
        <div class="card"><div>Revenue</div><div class="v">₴ 1 284 000</div></div>
        <div class="card"><div>Orders</div><div class="v">3 912</div></div>
        <div class="card cashback"><div>Cashback paid</div><div class="v">₴ 42 300</div></div>
      </div>
      <div class="card" style="display: grid; gap: 8px">
        <label for="note">Note</label>
        <input id="note" placeholder="Type a note" />
        <div>Preview: <span id="echo"></span></div>
        <div><button class="secondary dup">Share</button> <button class="secondary dup">Share</button></div>
      </div>
      <div id="status" style="margin-top: 24px"></div>
      <div class="far card"><button id="export">Export CSV</button></div>
    </main>
    <div class="modal-bg" id="modal">
      <div class="modal" role="dialog" aria-label="New report">
        <h2 style="margin: 0">New report</h2>
        <label>Name <input id="report-name" /></label>
        <label>Period
          <select id="period">
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </label>
        <div style="display: flex; gap: 8px; justify-content: flex-end">
          <button class="secondary" id="cancel">Cancel</button>
          <button id="create">Create</button>
        </div>
      </div>
    </div>
    <script>
      const $ = (s) => document.querySelector(s);
      $('#new-report').onclick = () => $('#modal').classList.add('open');
      $('#cancel').onclick = () => $('#modal').classList.remove('open');
      $('#note').addEventListener('input', (e) => { $('#echo').textContent = e.target.value; });
      $('#create').onclick = () => {
        const name = $('#report-name').value || 'Untitled';
        const period = $('#period').value;
        $('#modal').classList.remove('open');
        $('#status').replaceChildren(Object.assign(document.createElement('div'), { className: 'spinner' }));
        setTimeout(() => {
          const card = document.createElement('div');
          card.className = 'card';
          card.textContent = `Report ready: ${name} (${period})`;
          $('#status').replaceChildren(card);
        }, 2000);
      };
      $('#export').onclick = () => { $('#export').textContent = 'Exported ✓'; };
    </script>
  </body>
</html>
```

**File:** `fixtures/demo.json`
```json
{
  "version": 1,
  "meta": { "title": "Acme Analytics", "subtitle": "Reports in two clicks" },
  "app": {
    "url": "http://127.0.0.1:4777/",
    "viewport": { "width": 1280, "height": 800 },
    "mask": [".customer-email"]
  },
  "scenes": [
    {
      "id": "report",
      "steps": [
        { "do": "click", "target": "role=button[name='New report']", "show": { "caption": "Create a report in one click" } },
        { "do": "type", "target": "#report-name", "text": "Q3 revenue" },
        { "do": "select", "target": "#period", "value": "30d" },
        { "do": "click", "target": "#create" },
        { "do": "wait", "for": "text=Report ready" },
        { "do": "hover", "target": ".cashback", "show": { "spotlight": true, "caption": "Кешбек видно одразу", "hold": 1200 } }
      ]
    },
    {
      "id": "export",
      "steps": [
        { "do": "click", "target": "#export", "show": { "caption": "Export anywhere" } },
        { "do": "pause", "ms": 600 }
      ]
    }
  ]
}
```

**File:** `test/helpers/serve.ts`
```ts
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

export async function serveDir(dir: string, port = 0): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(dir, path.normalize(rel));
    if (!file.startsWith(dir)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await serveDir(path.join(FIXTURES, 'demo-app'), 4777);
  process.stdout.write(`Fixture app on ${url} (Ctrl+C to stop)\n`);
}
```

**File:** `test/helpers/fixture.ts`
```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadScript, type LoadedScript } from '../../src/script/load';
import { FIXTURES } from './serve';

/** Copy fixtures/demo.json into a fresh temp dir, pointed at a live server. */
export async function fixtureScript(url: string, mutate?: (raw: any) => void): Promise<LoadedScript> {
  const raw = JSON.parse(await readFile(path.join(FIXTURES, 'demo.json'), 'utf8'));
  raw.app.url = url;
  mutate?.(raw);
  const dir = await mkdtemp(path.join(tmpdir(), 'showtime-'));
  const file = path.join(dir, 'demo.json');
  await writeFile(file, JSON.stringify(raw, null, 2));
  return loadScript(file);
}
```

- [ ] **Step 2: Write the failing tests**

**File:** `test/unit/time.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { rng } from '../../src/runner/time';

describe('rng', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = rng('Q3 revenue');
    const b = rng('Q3 revenue');
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(rng('other')()).not.toBe(xs[0]);
  });
});
```

**File:** `test/integration/check.test.ts`
```ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { check } from '../../src/runner/check';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('check', () => {
  it('passes the demo script and writes a screenshot per step', async () => {
    const report = await check(await fixtureScript(server.url));
    expect(report.failure).toBeNull();
    expect(report.ok).toBe(true);
    expect(report.steps).toHaveLength(8);
    for (const s of report.steps) expect(existsSync(s.screenshot!)).toBe(true);
  });

  it('reports a missing target with a screenshot and an ARIA snapshot', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes[0].steps[0] = { do: 'click', target: "role=button[name='Nope']" };
    });
    const report = await check(loaded);
    expect(report.ok).toBe(false);
    expect(report.failure).toMatchObject({ sceneId: 'report', index: 0 });
    expect(report.failure!.error).toMatch(/Scene "report" step 1 \(click role=button\[name='Nope'\]\)/);
    expect(report.failure!.aria).toContain('New report');
    expect(existsSync(report.failure!.screenshot)).toBe(true);
    expect(report.steps.at(-1)).toMatchObject({ ok: false });
  });

  it('names ambiguous selectors', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes[0].steps = [{ do: 'click', target: '.dup' }];
    });
    const report = await check(loaded);
    expect(report.ok).toBe(false);
    expect(report.failure!.error).toMatch(/strict mode violation|resolved to 2 elements/);
  });

  it('types Unicode text', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes = [
        {
          id: 'uk',
          steps: [
            { do: 'type', target: '#note', text: 'Привіт, світ' },
            { do: 'wait', for: '#echo:has-text("Привіт, світ")' },
          ],
        },
      ];
    });
    const report = await check(loaded);
    expect(report.failure).toBeNull();
  });

  it('fails clearly when the app is unreachable', async () => {
    const loaded = await fixtureScript('http://127.0.0.1:9/');
    await expect(check(loaded)).rejects.toThrow(/Cannot open app\.url/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/unit/time.test.ts test/integration/check.test.ts`
Expected: FAIL — `src/runner/time`, `src/runner/check` not found.

- [ ] **Step 4: Implement the runner**

**File:** `src/runner/time.ts`
```ts
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Deterministic PRNG (mulberry32) seeded from a string, so re-takes type with the same rhythm. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

**File:** `src/runner/events.ts`
```ts
import type { Click, Interval, Move, StepEvent } from '../timeline/types';

/** Collects what happened during a run, timed relative to capture start. */
export class EventLog {
  readonly steps: StepEvent[] = [];
  readonly moves: Move[] = [];
  readonly clicks: Click[] = [];
  readonly idle: Interval[] = [];

  constructor(private readonly t0: number = Date.now()) {}

  now(): number {
    return Date.now() - this.t0;
  }
}
```

**File:** `src/runner/browser.ts`
```ts
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Script } from '../script/schema';
import type { Pt } from '../timeline/types';
import { EventLog } from './events';
import { runStep, STEP_TIMEOUT_MS, type StepContext } from './steps';
import { sleep } from './time';

export interface NetworkTracker {
  /** Resolve once no request has been in flight for `quietMs` (counted from now), or after `capMs`. */
  idle(quietMs: number, capMs: number): Promise<void>;
}

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  net: NetworkTracker;
  close(): Promise<void>;
}

export function trackNetwork(page: Page): NetworkTracker {
  let inflight = 0;
  let lastChange = Date.now();
  const up = () => {
    inflight++;
    lastChange = Date.now();
  };
  const down = () => {
    inflight = Math.max(0, inflight - 1);
    lastChange = Date.now();
  };
  page.on('request', up);
  page.on('requestfinished', down);
  page.on('requestfailed', down);
  return {
    async idle(quietMs, capMs) {
      const start = Date.now();
      while (Date.now() - start < capMs) {
        if (inflight === 0 && Date.now() - Math.max(lastChange, start) >= quietMs) return;
        await sleep(50);
      }
    },
  };
}

const maskCss = (selectors: string[]) => `${selectors.join(',\n')} { filter: blur(10px) !important; }`;

export async function openSession(script: Script, opts: { headed?: boolean } = {}): Promise<Session> {
  const { app } = script;
  const browser = await chromium.launch({
    headless: !opts.headed,
    // Both the flag and the context DPR are needed for device-pixel screencast frames.
    args: [`--force-device-scale-factor=${app.deviceScaleFactor}`, '--hide-scrollbars'],
  });
  try {
    const context = await browser.newContext({
      viewport: app.viewport,
      deviceScaleFactor: app.deviceScaleFactor,
      storageState: app.storageState,
      colorScheme: app.colorScheme,
      locale: app.locale,
      timezoneId: app.timezoneId,
    });
    if (app.mask.length) {
      await context.addInitScript((css: string) => {
        const add = () => {
          const el = document.createElement('style');
          el.textContent = css;
          document.documentElement.appendChild(el);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
        else add();
      }, maskCss(app.mask));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    return { browser, context, page, net: trackNetwork(page), close: () => browser.close() };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/** Open app.url, run setup steps (fast, unlogged), park the mouse at the centre. */
export async function prepare(session: Session, script: Script): Promise<Pt> {
  const { page } = session;
  try {
    await page.goto(script.app.url, { waitUntil: 'load', timeout: 30_000 });
  } catch (err) {
    throw new Error(`Cannot open app.url ${script.app.url}: ${(err as Error).message.split('\n')[0]}`);
  }
  const centre = { x: Math.round(script.app.viewport.width / 2), y: Math.round(script.app.viewport.height / 2) };
  const ctx: StepContext = { page, mode: 'check', log: new EventLog(), net: session.net, cursor: centre };
  for (const [index, step] of script.setup.entries()) await runStep(ctx, step, { sceneId: 'setup', index });
  await page.mouse.move(centre.x, centre.y);
  return centre;
}
```

**File:** `src/runner/steps.ts`
```ts
import type { Locator, Page } from 'playwright';
import type { Step } from '../script/schema';
import { clamp, easeInOutCubic } from '../timeline/math';
import type { CursorKind, Pt, Rect } from '../timeline/types';
import type { NetworkTracker } from './browser';
import type { EventLog } from './events';
import { rng, sleep } from './time';

export type Mode = 'record' | 'check';

export interface StepContext {
  page: Page;
  mode: Mode;
  log: EventLog;
  net: NetworkTracker;
  cursor: Pt;
}

export interface StepWhere {
  sceneId: string;
  index: number;
}

export const STEP_TIMEOUT_MS = 10_000;
export const WAIT_TIMEOUT_MS = 15_000;
export const BEAT_MS = 450;
const NET_QUIET_MS = 300;
const NET_CAP_MS = 3000;
const IDLE_GRACE_MS = 300;

export class StepError extends Error {
  constructor(
    message: string,
    readonly where: StepWhere,
    readonly step: Step,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

export function describeStep(step: Step): string {
  if ('target' in step && step.target) return `${step.do} ${step.target}`;
  if (step.do === 'wait') return step.for ? `wait ${step.for}` : `wait ${step.ms} ms`;
  if (step.do === 'goto') return `goto ${step.url}`;
  if (step.do === 'press') return `press ${step.key}`;
  if (step.do === 'pause') return `pause ${step.ms} ms`;
  if (step.do === 'scroll') return `scroll ${step.by}px`;
  return step.do;
}

export async function runStep(ctx: StepContext, step: Step, where: StepWhere): Promise<void> {
  try {
    await perform(ctx, step, where);
  } catch (err) {
    if (err instanceof StepError) throw err;
    const message = (err as Error).message.split('\n').filter(Boolean).slice(0, 4).join('\n');
    throw new StepError(`Scene "${where.sceneId}" step ${where.index + 1} (${describeStep(step)}): ${message}`, where, step);
  }
}

const centre = (r: Rect): Pt => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

async function perform(ctx: StepContext, step: Step, where: StepWhere): Promise<void> {
  const { page, log } = ctx;
  const startMs = log.now();
  let actionMs = startMs;
  let target: Rect | undefined;

  switch (step.do) {
    case 'goto':
      await page.goto(step.url, { waitUntil: 'load', timeout: WAIT_TIMEOUT_MS });
      break;
    case 'click':
    case 'hover':
    case 'select':
    case 'type': {
      const r = await resolve(ctx, step.target, false);
      target = r.box;
      const point = centre(r.box);
      await travel(ctx, point, r.cursor);
      actionMs = log.now();
      if (step.do !== 'hover') log.clicks.push({ tMs: actionMs, ...point });
      if (step.do === 'click') await r.loc.click({ timeout: STEP_TIMEOUT_MS });
      if (step.do === 'select') await r.loc.selectOption(step.value, { timeout: STEP_TIMEOUT_MS });
      if (step.do === 'type') {
        await r.loc.click({ timeout: STEP_TIMEOUT_MS });
        if (step.clear) await r.loc.fill('');
        await typeText(ctx, step.text, step.pace);
      }
      break;
    }
    case 'press':
      await page.keyboard.press(step.key);
      break;
    case 'scroll':
      if (step.target) target = (await resolve(ctx, step.target, true)).box;
      else await wheel(ctx, step.by ?? 0);
      break;
    case 'wait':
      if (step.for) await page.locator(step.for).waitFor({ state: 'visible', timeout: WAIT_TIMEOUT_MS });
      else await sleep(step.ms ?? 0);
      break;
    case 'pause':
      if (ctx.mode === 'record') await sleep(step.ms);
      break;
  }

  const endMs = log.now();
  if (step.do === 'wait' || step.do === 'goto') log.idle.push({ startMs, endMs });
  await settle(ctx, step);
  log.steps.push({ ...where, do: step.do, startMs, actionMs, endMs, settledMs: log.now(), target });
}

async function resolve(ctx: StepContext, selector: string, forceScroll: boolean) {
  const loc = ctx.page.locator(selector);
  await loc.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  const inView = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  });
  if (forceScroll || !inView) {
    const smooth = ctx.mode === 'record';
    await loc.evaluate(
      (el, s) => el.scrollIntoView({ behavior: (s ? 'smooth' : 'instant') as ScrollBehavior, block: 'center', inline: 'nearest' }),
      smooth,
    );
  }
  const box = await stableBox(loc);
  const css = await loc.evaluate((el) => getComputedStyle(el).cursor);
  const cursor: CursorKind = css === 'text' ? 'text' : css === 'pointer' ? 'pointer' : 'arrow';
  return { loc, box, cursor };
}

/** Wait (max ~2 s) until the element stops moving, e.g. after smooth scrolling or an opening animation. */
async function stableBox(loc: Locator): Promise<Rect> {
  let prev = await loc.boundingBox();
  for (let i = 0; i < 40; i++) {
    await sleep(50);
    const next = await loc.boundingBox();
    if (prev && next && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.width - next.width) < 0.5) {
      return next;
    }
    prev = next;
  }
  if (!prev) throw new Error('element has no bounding box (hidden or detached)');
  return prev;
}

async function travel(ctx: StepContext, to: Pt, cursor: CursorKind): Promise<void> {
  const from = ctx.cursor;
  if (ctx.mode === 'check') {
    await ctx.page.mouse.move(to.x, to.y);
    ctx.cursor = to;
    return;
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = clamp(350 + dist * 0.35, 350, 900);
  const startMs = ctx.log.now();
  const t0 = Date.now();
  const n = Math.max(2, Math.round(duration / 16));
  for (let i = 1; i <= n; i++) {
    const e = easeInOutCubic(i / n);
    await ctx.page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    const wait = t0 + (duration * i) / n - Date.now();
    if (wait > 0) await sleep(wait);
  }
  ctx.log.moves.push({ startMs, endMs: ctx.log.now(), from, to, cursor });
  ctx.cursor = to;
}

async function typeText(ctx: StepContext, text: string, pace: 'human' | 'fast' | number): Promise<void> {
  if (ctx.mode === 'check' || pace === 'fast') {
    await ctx.page.keyboard.type(text);
    return;
  }
  const rand = rng(text);
  for (const ch of text) {
    await ctx.page.keyboard.type(ch);
    await sleep(typeof pace === 'number' ? pace : 45 + rand() * 65);
  }
}

async function wheel(ctx: StepContext, by: number): Promise<void> {
  if (ctx.mode === 'check') {
    await ctx.page.mouse.wheel(0, by);
    await sleep(100);
    return;
  }
  const n = 14;
  for (let i = 0; i < n; i++) {
    await ctx.page.mouse.wheel(0, by / n);
    await sleep(40);
  }
}

async function settle(ctx: StepContext, step: Step): Promise<void> {
  const s = ctx.log.now();
  await ctx.net.idle(NET_QUIET_MS, NET_CAP_MS);
  const waited = ctx.log.now() - s;
  if (waited > IDLE_GRACE_MS) ctx.log.idle.push({ startMs: s + IDLE_GRACE_MS, endMs: s + waited });
  if (ctx.mode === 'record') await sleep(BEAT_MS + (step.show?.hold ?? 0));
}
```

**File:** `src/runner/check.ts`
```ts
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from '../paths';
import type { LoadedScript } from '../script/load';
import { openSession, prepare } from './browser';
import { EventLog } from './events';
import { describeStep, runStep, StepError, type StepContext } from './steps';

export interface RunOptions {
  headed?: boolean;
  log?: (line: string) => void;
}

export interface CheckStep {
  sceneId: string;
  index: number;
  action: string;
  ok: boolean;
  screenshot?: string;
  error?: string;
}

export interface CheckFailure {
  sceneId: string;
  index: number;
  error: string;
  screenshot: string;
  aria: string;
}

export interface CheckReport {
  ok: boolean;
  steps: CheckStep[];
  failure: CheckFailure | null;
}

const ARIA_LIMIT = 8000;

export async function check(loaded: LoadedScript, opts: RunOptions = {}): Promise<CheckReport> {
  const { script } = loaded;
  const paths = workPaths(loaded);
  await rm(paths.check, { recursive: true, force: true });
  await mkdir(paths.check, { recursive: true });

  const report: CheckReport = { ok: true, steps: [], failure: null };
  const session = await openSession(script, opts);
  try {
    const cursor = await prepare(session, script);
    const ctx: StepContext = { page: session.page, mode: 'check', log: new EventLog(), net: session.net, cursor };
    let n = 0;
    for (const scene of script.scenes) {
      for (const [index, step] of scene.steps.entries()) {
        await runStep(ctx, step, { sceneId: scene.id, index });
        const screenshot = path.join(paths.check, `${String(++n).padStart(2, '0')}-${scene.id}-${index + 1}-${step.do}.png`);
        await session.page.screenshot({ path: screenshot, scale: 'css' });
        report.steps.push({ sceneId: scene.id, index, action: describeStep(step), ok: true, screenshot });
        opts.log?.(`✓ ${scene.id} #${index + 1} ${describeStep(step)}`);
      }
    }
  } catch (err) {
    if (!(err instanceof StepError)) throw err;
    const screenshot = path.join(paths.check, 'failure.png');
    await session.page.screenshot({ path: screenshot, scale: 'css' }).catch(() => undefined);
    const aria = await session.page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '');
    report.ok = false;
    report.failure = { sceneId: err.where.sceneId, index: err.where.index, error: err.message, screenshot, aria: aria.slice(0, ARIA_LIMIT) };
    report.steps.push({ sceneId: err.where.sceneId, index: err.where.index, action: describeStep(err.step), ok: false, error: err.message });
    opts.log?.(`✗ ${err.message}`);
  } finally {
    await session.close();
  }
  return report;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit test/integration/check.test.ts && npx tsc --noEmit`
Expected: PASS (the missing-target test takes ~10 s: the step timeout), no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Playwright step runner and check (rehearsal) with fixture app"
```

---

### Task 6: Capture, encode, `record`

**Files:**
- Create: `src/ffmpeg.ts`, `src/runner/capture.ts`, `src/runner/encode.ts`, `src/runner/record.ts`
- Test: `test/unit/encode.test.ts`, `test/integration/record.test.ts`

**Interfaces:**
- Consumes: `openSession`, `prepare`, `runStep`, `describeStep`, `StepError`, `StepContext`, `EventLog`, `sleep`, `RunOptions` (Task 5); `actionHash` (Task 1); `workPaths` (Task 1); `TakeEvents` (Task 2).
- Produces:
  - `run(cmd: string, args: string[]): Promise<string>`, `assertFfmpeg(): Promise<void>`, `probeVideo(file): Promise<{ width; height; durationMs }>`
  - `interface Frame { file: string; tMs: number }`; `startCapture(page, dir, size: {width,height}): Promise<{ t0: number; stop(): Promise<Frame[]> }>`
  - `concatList(frames: Frame[], durationMs: number): string`; `encodeFrames(frames, out, { fps, durationMs }): Promise<void>`
  - `ESTABLISH_MS = 800`, `TAIL_MS = 800`, `TAKE_FPS = 30`
  - `interface RecordOptions extends RunOptions { keepFrames?: boolean }`; `record(loaded, opts?): Promise<TakeEvents>` — writes `take/raw.mp4` and `take/events.json`

- [ ] **Step 1: Write the failing tests**

**File:** `test/unit/encode.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { concatList } from '../../src/runner/encode';

describe('concatList', () => {
  it('starts the first frame at 0 and runs the last frame to the end', () => {
    const list = concatList(
      [
        { file: '/a/1.jpg', tMs: 20 },
        { file: '/a/2.jpg', tMs: 520 },
      ],
      1000,
    );
    expect(list).toBe(
      ['ffconcat version 1.0', "file '/a/1.jpg'", 'duration 0.520000', "file '/a/2.jpg'", 'duration 0.480000', "file '/a/2.jpg'", ''].join('\n'),
    );
  });

  it('escapes single quotes in paths', () => {
    expect(concatList([{ file: "/it's/1.jpg", tMs: 0 }], 100)).toContain("file '/it'\\''s/1.jpg'");
  });

  it('never emits zero durations', () => {
    const list = concatList(
      [
        { file: '/1.jpg', tMs: 10 },
        { file: '/2.jpg', tMs: 10 },
      ],
      10,
    );
    expect(list).not.toMatch(/duration 0\.000000/);
  });
});
```

**File:** `test/integration/record.test.ts`
```ts
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeVideo } from '../../src/ffmpeg';
import { workPaths } from '../../src/paths';
import { record } from '../../src/runner/record';
import { actionHash } from '../../src/script/hash';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('record', () => {
  it('records a take: device-pixel raw video, wall-clock duration, consistent events', async () => {
    const loaded = await fixtureScript(server.url);
    const ev = await record(loaded);
    const paths = workPaths(loaded);

    expect(existsSync(paths.raw)).toBe(true);
    expect(existsSync(paths.rawFrames)).toBe(false);
    const probe = await probeVideo(paths.raw);
    expect(probe.width).toBe(2560);
    expect(probe.height).toBe(1600);
    expect(Math.abs(probe.durationMs - ev.video.durationMs)).toBeLessThan(200);

    expect(ev.actionHash).toBe(actionHash(loaded.script));
    expect(ev.steps).toHaveLength(8);
    for (const s of ev.steps) {
      expect(s.startMs).toBeLessThanOrEqual(s.actionMs);
      expect(s.actionMs).toBeLessThanOrEqual(s.endMs);
      expect(s.endMs).toBeLessThanOrEqual(s.settledMs);
    }
    for (let i = 1; i < ev.steps.length; i++) expect(ev.steps[i].startMs).toBeGreaterThanOrEqual(ev.steps[i - 1].settledMs);
    expect(ev.steps[0].startMs).toBeGreaterThanOrEqual(800);
    expect(ev.video.durationMs).toBeGreaterThanOrEqual(ev.steps.at(-1)!.settledMs + 800);

    // click, type, select, click, click → 5 clicks; hover adds a move but no click
    expect(ev.clicks).toHaveLength(5);
    expect(ev.moves.length).toBeGreaterThanOrEqual(6);

    const wait = ev.steps.find((s) => s.do === 'wait')!;
    expect(wait.endMs - wait.startMs).toBeGreaterThan(800);
    expect(ev.idle.some((i) => i.startMs === wait.startMs && i.endMs === wait.endMs)).toBe(true);

    // below-the-fold target was scrolled into view before measuring
    const exp = ev.steps.find((s) => s.sceneId === 'export' && s.do === 'click')!;
    expect(exp.target!.y).toBeGreaterThanOrEqual(0);
    expect(exp.target!.y + exp.target!.height).toBeLessThanOrEqual(800);

    const saved = JSON.parse(await readFile(paths.events, 'utf8'));
    expect(saved).toEqual(ev);
  });

  it('aborts with a check hint when a step fails', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes[1].steps[0] = { do: 'click', target: '#missing' };
    });
    await expect(record(loaded)).rejects.toThrow(/showtime check/);
    expect(existsSync(path.join(workPaths(loaded).take, 'failure.png'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/encode.test.ts test/integration/record.test.ts`
Expected: FAIL — `src/runner/encode`, `src/ffmpeg`, `src/runner/record` not found.

- [ ] **Step 3: Implement**

**File:** `src/ffmpeg.ts`
```ts
import { spawn } from 'node:child_process';

export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(-2000)}`)),
    );
  });
}

export async function assertFfmpeg(): Promise<void> {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
  } catch {
    throw new Error('ffmpeg/ffprobe not found on PATH. Install it: brew install ffmpeg (macOS) or apt install ffmpeg (Linux).');
  }
}

export interface VideoProbe {
  width: number;
  height: number;
  durationMs: number;
}

export async function probeVideo(file: string): Promise<VideoProbe> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    file,
  ]);
  const j = JSON.parse(out) as { streams: Array<{ width: number; height: number }>; format: { duration: string } };
  return { width: j.streams[0].width, height: j.streams[0].height, durationMs: Math.round(Number(j.format.duration) * 1000) };
}
```

**File:** `src/runner/capture.ts`
```ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

export interface Frame {
  file: string;
  /** ms since t0 */
  tMs: number;
}

export interface Capture {
  t0: number;
  stop(): Promise<Frame[]>;
}

/** CDP screencast → numbered JPEGs. Chrome only sends frames when something repaints. */
export async function startCapture(page: Page, dir: string, size: { width: number; height: number }): Promise<Capture> {
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const writes: Promise<void>[] = [];
  let n = 0;
  let stopped: Promise<Frame[]> | null = null;
  const t0 = Date.now();

  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    const tMs = metadata.timestamp ? metadata.timestamp * 1000 - t0 : Date.now() - t0;
    const file = path.join(dir, `${String(++n).padStart(6, '0')}.jpg`);
    frames.push({ file, tMs: Math.max(0, tMs) });
    writes.push(writeFile(file, Buffer.from(data, 'base64')));
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: size.width,
    maxHeight: size.height,
    everyNthFrame: 1,
  });

  return {
    t0,
    stop() {
      stopped ??= (async () => {
        await cdp.send('Page.stopScreencast').catch(() => undefined);
        await Promise.all(writes);
        await cdp.detach().catch(() => undefined);
        return frames.sort((a, b) => a.tMs - b.tMs);
      })();
      return stopped;
    },
  };
}
```

**File:** `src/runner/encode.ts`
```ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../ffmpeg';
import type { Frame } from './capture';

const quote = (file: string) => `'${file.replace(/'/g, "'\\''")}'`;

/**
 * ffconcat list where each frame lasts until the next one, so static stretches keep wall-clock time.
 * The first frame starts at 0; the last one runs to `durationMs` (and is repeated: concat ignores the
 * last entry's duration otherwise).
 */
export function concatList(frames: Frame[], durationMs: number): string {
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const start = i === 0 ? 0 : f.tMs;
    const end = i + 1 < frames.length ? frames[i + 1].tMs : durationMs;
    const seconds = Math.max(end - start, 1) / 1000;
    lines.push(`file ${quote(f.file)}`, `duration ${seconds.toFixed(6)}`);
  });
  lines.push(`file ${quote(frames[frames.length - 1].file)}`, '');
  return lines.join('\n');
}

export async function encodeFrames(frames: Frame[], out: string, opts: { fps: number; durationMs: number }): Promise<void> {
  if (!frames.length) throw new Error('No frames were captured (did the page render anything?)');
  const list = path.join(path.dirname(frames[0].file), 'frames.ffconcat');
  await writeFile(list, concatList(frames, opts.durationMs));
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-fps_mode', 'cfr', '-r', String(opts.fps),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14',
    '-movflags', '+faststart',
    out,
  ]);
}
```

**File:** `src/runner/record.ts`
```ts
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertFfmpeg, probeVideo } from '../ffmpeg';
import { workPaths } from '../paths';
import { actionHash } from '../script/hash';
import type { LoadedScript } from '../script/load';
import type { TakeEvents } from '../timeline/types';
import { openSession, prepare, type Session } from './browser';
import { startCapture, type Frame } from './capture';
import type { RunOptions } from './check';
import { encodeFrames } from './encode';
import { EventLog } from './events';
import { describeStep, runStep, StepError, type StepContext } from './steps';
import { sleep } from './time';

export const ESTABLISH_MS = 800;
export const TAIL_MS = 800;
export const TAKE_FPS = 30;

export interface RecordOptions extends RunOptions {
  keepFrames?: boolean;
}

interface Shot {
  frames: Frame[];
  durationMs: number;
  log: EventLog;
}

async function shoot(session: Session, loaded: LoadedScript, framesDir: string, opts: RecordOptions): Promise<Shot> {
  const { script } = loaded;
  const { viewport, deviceScaleFactor } = script.app;
  const cursor = await prepare(session, script);
  const capture = await startCapture(session.page, framesDir, {
    width: viewport.width * deviceScaleFactor,
    height: viewport.height * deviceScaleFactor,
  });
  const log = new EventLog(capture.t0);
  const ctx: StepContext = { page: session.page, mode: 'record', log, net: session.net, cursor };
  try {
    await sleep(ESTABLISH_MS);
    for (const scene of script.scenes) {
      for (const [index, step] of scene.steps.entries()) {
        opts.log?.(`● ${scene.id} #${index + 1} ${describeStep(step)}`);
        await runStep(ctx, step, { sceneId: scene.id, index });
      }
    }
    await sleep(TAIL_MS);
  } catch (err) {
    await capture.stop();
    throw err;
  }
  const durationMs = log.now();
  const frames = await capture.stop();
  return { frames, durationMs, log };
}

export async function record(loaded: LoadedScript, opts: RecordOptions = {}): Promise<TakeEvents> {
  const { script } = loaded;
  await assertFfmpeg();
  const paths = workPaths(loaded);
  await rm(paths.take, { recursive: true, force: true });
  await mkdir(paths.rawFrames, { recursive: true });

  const session = await openSession(script, opts);
  let shot: Shot;
  try {
    shot = await shoot(session, loaded, paths.rawFrames, opts);
  } catch (err) {
    if (err instanceof StepError) {
      await session.page.screenshot({ path: path.join(paths.take, 'failure.png'), scale: 'css' }).catch(() => undefined);
      throw new Error(`${err.message}\nRecording aborted. Run \`showtime check ${loaded.scriptPath}\` to debug.`);
    }
    throw err;
  } finally {
    await session.close();
  }

  opts.log?.('Encoding raw.mp4…');
  await encodeFrames(shot.frames, paths.raw, { fps: TAKE_FPS, durationMs: shot.durationMs });
  const probe = await probeVideo(paths.raw);
  const events: TakeEvents = {
    version: 1,
    actionHash: actionHash(script),
    viewport: script.app.viewport,
    deviceScaleFactor: script.app.deviceScaleFactor,
    video: { file: 'raw.mp4', width: probe.width, height: probe.height, fps: TAKE_FPS, durationMs: shot.durationMs },
    steps: shot.log.steps,
    moves: shot.log.moves,
    clicks: shot.log.clicks,
    idle: shot.log.idle,
  };
  await writeFile(paths.events, JSON.stringify(events, null, 2));
  if (!opts.keepFrames) await rm(paths.rawFrames, { recursive: true, force: true });
  return events;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit test/integration/record.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. Open `.showtime/demo/take/raw.mp4` from the temp dir printed on failure if a duration assertion fails.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: CDP screencast capture, ffmpeg encode and record command core"
```

---
### Task 7: Remotion composition, render, take loading, QA stills

**Files:**
- Create: `src/take.ts`, `src/pipeline.ts`, `src/render/render.ts`
- Create: `src/render/remotion/index.ts`, `src/render/remotion/Root.tsx`, `src/render/remotion/ShowtimeVideo.tsx`, `src/render/remotion/Overlays.tsx`, `src/render/remotion/Cursor.tsx`, `src/render/remotion/Intro.tsx`
- Test: `test/unit/take.test.ts`, `test/integration/render.test.ts`

**Interfaces:**
- Consumes: `loadScript`, `LoadedScript`, `actionHash`, `workPaths` (Task 1); `Timeline`, `TakeEvents` (Task 2); `cameraAt`, `cameraTransform`, `cursorAt`, `ripplesAt`, `clamp`, `easeOutCubic` (Tasks 2–3); `buildTimeline`, `introFrames`, `totalFrames`, `segmentPlan`, `sourceMsAtFrame`, `qaShots`, `Shot`, `windowLayout` (Task 4); `record` (Task 6, tests only); `probeVideo` (Task 6).
- Produces:
  - `loadTake(loaded): Promise<TakeEvents>` — errors: `No take found…`, `Actions changed since the take…`, `…raw.mp4 is missing…`
  - `timelineFor(loaded): Promise<{ timeline: Timeline; events: TakeEvents }>` (also writes `timeline.json`)
  - `renderDemo(loaded, opts?: { out?: string; onProgress?: (p: number) => void }): Promise<string>`
  - `renderQaFrames(loaded): Promise<string[]>`
  - `renderVideo(timeline, publicDir, out, onProgress?)`, `renderStills(timeline, publicDir, outDir, shots): Promise<string[]>`
  - Remotion composition id `ShowtimeVideo`, props `{ timeline: Timeline }`

- [ ] **Step 1: Write the failing tests**

**File:** `test/unit/take.test.ts`
```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workPaths } from '../../src/paths';
import { actionHash } from '../../src/script/hash';
import { loadScript } from '../../src/script/load';
import { loadTake } from '../../src/take';
import type { TakeEvents } from '../../src/timeline/types';

describe('loadTake', () => {
  it('explains each way a take can be unusable, then loads it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-take-'));
    const file = path.join(dir, 'demo.json');
    await writeFile(file, JSON.stringify({ version: 1, app: { url: 'http://x' }, scenes: [{ id: 'a', steps: [{ do: 'click', target: '#a' }] }] }));
    const loaded = await loadScript(file);
    const paths = workPaths(loaded);

    await expect(loadTake(loaded)).rejects.toThrow(/No take found.*showtime record/s);

    const ev: TakeEvents = {
      version: 1,
      actionHash: 'stale',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      video: { file: 'raw.mp4', width: 2880, height: 1800, fps: 30, durationMs: 1000 },
      steps: [],
      moves: [],
      clicks: [],
      idle: [],
    };
    await mkdir(paths.take, { recursive: true });
    await writeFile(paths.events, JSON.stringify(ev));
    await expect(loadTake(loaded)).rejects.toThrow(/Actions changed since the take.*showtime record/s);

    ev.actionHash = actionHash(loaded.script);
    await writeFile(paths.events, JSON.stringify(ev));
    await expect(loadTake(loaded)).rejects.toThrow(/raw\.mp4 is missing/);

    await writeFile(paths.raw, '');
    await expect(loadTake(loaded)).resolves.toEqual(ev);
  });
});
```

**File:** `test/integration/render.test.ts`
```ts
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeVideo } from '../../src/ffmpeg';
import { workPaths } from '../../src/paths';
import { renderDemo, renderQaFrames, timelineFor } from '../../src/pipeline';
import { record } from '../../src/runner/record';
import { loadScript, type LoadedScript } from '../../src/script/load';
import { totalFrames } from '../../src/timeline/frames';
import type { Timeline } from '../../src/timeline/types';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

let server: Awaited<ReturnType<typeof serveDir>>;
let loaded: LoadedScript;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
  loaded = await fixtureScript(server.url);
  await record(loaded);
});
afterAll(() => server.close());

async function editScript(mutate: (raw: any) => void): Promise<LoadedScript> {
  const raw = JSON.parse(await readFile(loaded.scriptPath, 'utf8'));
  mutate(raw);
  await writeFile(loaded.scriptPath, JSON.stringify(raw, null, 2));
  return loadScript(loaded.scriptPath);
}

describe('render', () => {
  it('renders a 1080p MP4 whose length matches the timeline', async () => {
    const out = await renderDemo(loaded);
    expect(out).toBe(workPaths(loaded).video);
    const probe = await probeVideo(out);
    expect(probe).toMatchObject({ width: 1920, height: 1080 });
    const tl = JSON.parse(await readFile(workPaths(loaded).timeline, 'utf8')) as Timeline;
    expect(Math.abs(probe.durationMs - (totalFrames(tl) * 1000) / tl.fps)).toBeLessThan(100);
    expect(tl.segments.some((s) => s.speed > 1)).toBe(true);
    expect(tl.camera.length).toBeGreaterThan(0);
    expect(tl.captions.map((c) => c.text)).toContain('Кешбек видно одразу');
  });

  it('renders QA stills: intro + one per step', async () => {
    const files = await renderQaFrames(loaded);
    expect(files).toHaveLength(9);
    for (const f of files) expect(existsSync(f)).toBe(true);
    expect(path.basename(files[0])).toBe('00-intro.png');
    expect(path.basename(files[6])).toBe('06-report-6-hover.png');
  });

  it('re-renders after a presentation-only change without re-recording', async () => {
    const edited = await editScript((raw) => {
      raw.scenes[0].steps[0].show.caption = 'Новий підпис';
      raw.style = { accent: '#ef4444' };
    });
    const { timeline } = await timelineFor(edited);
    expect(timeline.captions[0].text).toBe('Новий підпис');
    expect(timeline.style.accent).toBe('#ef4444');
  });

  it('refuses a stale take after an action change', async () => {
    const edited = await editScript((raw) => {
      raw.scenes[0].steps[1].text = 'Q4 revenue';
    });
    await expect(timelineFor(edited)).rejects.toThrow(/Actions changed since the take/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/take.test.ts test/integration/render.test.ts`
Expected: FAIL — `src/take`, `src/pipeline` not found.

- [ ] **Step 3: Implement take loading and the pipeline**

**File:** `src/take.ts`
```ts
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from './paths';
import { actionHash } from './script/hash';
import type { LoadedScript } from './script/load';
import type { TakeEvents } from './timeline/types';

export async function loadTake(loaded: LoadedScript): Promise<TakeEvents> {
  const paths = workPaths(loaded);
  let text: string;
  try {
    text = await readFile(paths.events, 'utf8');
  } catch {
    throw new Error(`No take found for "${loaded.name}". Run: showtime record ${loaded.scriptPath}`);
  }
  const events = JSON.parse(text) as TakeEvents;
  if (events.actionHash !== actionHash(loaded.script)) {
    throw new Error(`Actions changed since the take (presentation-only edits are fine). Run: showtime record ${loaded.scriptPath}`);
  }
  const video = path.join(paths.take, events.video.file);
  if (!existsSync(video)) throw new Error(`${video} is missing. Run: showtime record ${loaded.scriptPath}`);
  return events;
}
```

**File:** `src/pipeline.ts`
```ts
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workPaths } from './paths';
import { renderStills, renderVideo } from './render/render';
import type { LoadedScript } from './script/load';
import { loadTake } from './take';
import { buildTimeline } from './timeline/build';
import { qaShots } from './timeline/frames';
import type { TakeEvents, Timeline } from './timeline/types';

export async function timelineFor(loaded: LoadedScript): Promise<{ timeline: Timeline; events: TakeEvents }> {
  const events = await loadTake(loaded);
  const timeline = buildTimeline(loaded.script, events);
  const paths = workPaths(loaded);
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.timeline, JSON.stringify(timeline, null, 2));
  return { timeline, events };
}

export async function renderDemo(
  loaded: LoadedScript,
  opts: { out?: string; onProgress?: (progress: number) => void } = {},
): Promise<string> {
  const { timeline } = await timelineFor(loaded);
  const paths = workPaths(loaded);
  const out = path.resolve(opts.out ?? paths.video);
  await mkdir(path.dirname(out), { recursive: true });
  await renderVideo(timeline, paths.take, out, opts.onProgress);
  return out;
}

export async function renderQaFrames(loaded: LoadedScript): Promise<string[]> {
  const { timeline, events } = await timelineFor(loaded);
  const paths = workPaths(loaded);
  await rm(paths.stills, { recursive: true, force: true });
  await mkdir(paths.stills, { recursive: true });
  return renderStills(timeline, paths.take, paths.stills, qaShots(timeline, events.steps));
}
```

- [ ] **Step 4: Implement the Remotion renderer**

**File:** `src/render/render.ts`
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Shot } from '../timeline/frames';
import type { Timeline } from '../timeline/types';

const ENTRY = fileURLToPath(new URL('./remotion/index.ts', import.meta.url));
const COMPOSITION_ID = 'ShowtimeVideo';

/** Bundle the composition with the take directory as public dir, so the raw video is staticFile('raw.mp4'). */
async function prepare(timeline: Timeline, publicDir: string) {
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir, symlinkPublicDir: true });
  const inputProps = { timeline };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, logLevel: 'error' });
  return { serveUrl, inputProps, composition };
}

export async function renderVideo(
  timeline: Timeline,
  publicDir: string,
  out: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const r = await prepare(timeline, publicDir);
  await renderMedia({
    ...r,
    codec: 'h264',
    crf: 18,
    outputLocation: out,
    overwrite: true,
    logLevel: 'error',
    onProgress: ({ progress }) => onProgress?.(progress),
  });
}

export async function renderStills(timeline: Timeline, publicDir: string, outDir: string, shots: Shot[]): Promise<string[]> {
  const r = await prepare(timeline, publicDir);
  const files: string[] = [];
  for (const shot of shots) {
    const output = path.join(outDir, `${shot.name}.png`);
    await renderStill({ ...r, frame: shot.frame, output, imageFormat: 'png', overwrite: true, logLevel: 'error' });
    files.push(output);
  }
  return files;
}
```

**File:** `src/render/remotion/index.ts`
```ts
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
```

**File:** `src/render/remotion/Root.tsx`
```tsx
import { Composition } from 'remotion';
import { totalFrames } from '../../timeline/frames';
import { ShowtimeVideo, type ShowtimeVideoProps } from './ShowtimeVideo';

export const RemotionRoot = () => (
  <Composition
    id="ShowtimeVideo"
    component={ShowtimeVideo}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={{} as ShowtimeVideoProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: totalFrames(props.timeline),
      fps: props.timeline.fps,
      width: props.timeline.output.width,
      height: props.timeline.output.height,
    })}
  />
);
```

**File:** `src/render/remotion/ShowtimeVideo.tsx`
```tsx
import type { FC } from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { cameraAt, cameraTransform } from '../../timeline/camera';
import { introFrames, segmentPlan, sourceMsAtFrame } from '../../timeline/frames';
import { windowLayout } from '../../timeline/layout';
import type { Timeline } from '../../timeline/types';
import { Cursor } from './Cursor';
import { Intro } from './Intro';
import { Captions, Ripples, Spotlights } from './Overlays';

export type ShowtimeVideoProps = { timeline: Timeline };

const SHADOW = '0 30px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.25)';

export const ShowtimeVideo: FC<ShowtimeVideoProps> = ({ timeline: t }) => {
  const frame = useCurrentFrame();
  if (frame < introFrames(t)) return <Intro timeline={t} frame={frame} />;

  const src = sourceMsAtFrame(t, frame) ?? 0;
  const win = windowLayout(t.output, t.stage, t.style.padding);
  const cam = cameraAt(t.camera, src);
  const k = win.width / t.stage.width;

  return (
    <AbsoluteFill style={{ background: t.style.background, fontFamily: t.style.font }}>
      <div
        style={{
          position: 'absolute',
          left: win.x,
          top: win.y,
          width: win.width,
          height: win.height,
          borderRadius: t.style.radius,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: t.style.shadow ? SHADOW : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: win.width,
            height: win.height,
            transformOrigin: '0 0',
            transform: cameraTransform(cam, win.width, win.height),
          }}
        >
          {segmentPlan(t).map((p) => (
            <Sequence key={p.fromFrame} from={p.fromFrame} durationInFrames={p.durationInFrames} layout="none">
              <OffthreadVideo
                src={staticFile(t.video.src)}
                trimBefore={p.trimBefore}
                playbackRate={p.speed}
                muted
                style={{ position: 'absolute', left: 0, top: 0, width: win.width, height: win.height }}
              />
            </Sequence>
          ))}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: t.stage.width,
              height: t.stage.height,
              transformOrigin: '0 0',
              transform: `scale(${k})`,
            }}
          >
            <Spotlights timeline={t} srcMs={src} />
            <Ripples timeline={t} srcMs={src} />
            <Cursor timeline={t} srcMs={src} />
          </div>
        </div>
      </div>
      <Captions timeline={t} srcMs={src} />
    </AbsoluteFill>
  );
};
```

**File:** `src/render/remotion/Overlays.tsx`
```tsx
import type { FC } from 'react';
import { ripplesAt } from '../../timeline/cursor';
import { clamp, easeOutCubic } from '../../timeline/math';
import type { Timeline } from '../../timeline/types';

type LayerProps = { timeline: Timeline; srcMs: number };

/** 0 → 1 → 0 over [start, end] with `ms` ramps. */
const envelope = (t: number, start: number, end: number, ms: number) => clamp(Math.min((t - start) / ms, (end - t) / ms), 0, 1);

export const Spotlights: FC<LayerProps> = ({ timeline, srcMs }) => (
  <>
    {timeline.spotlights
      .filter((s) => srcMs >= s.startMs && srcMs <= s.endMs)
      .map((s) => (
        <div
          key={s.startMs}
          style={{
            position: 'absolute',
            left: s.rect.x,
            top: s.rect.y,
            width: s.rect.width,
            height: s.rect.height,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.55)',
            outline: `3px solid ${timeline.style.accent}`,
            outlineOffset: 2,
            opacity: envelope(srcMs, s.startMs, s.endMs, 250),
          }}
        />
      ))}
  </>
);

export const Ripples: FC<LayerProps> = ({ timeline, srcMs }) => (
  <>
    {ripplesAt(timeline.clicks, srcMs).map((r) => {
      const radius = 6 + 42 * easeOutCubic(r.progress);
      return (
        <div
          key={r.tMs}
          style={{
            position: 'absolute',
            left: r.x - radius,
            top: r.y - radius,
            width: radius * 2,
            height: radius * 2,
            borderRadius: '50%',
            border: `3px solid ${timeline.style.accent}`,
            opacity: 1 - r.progress,
          }}
        />
      );
    })}
  </>
);

export const Captions: FC<LayerProps> = ({ timeline, srcMs }) => {
  const active = timeline.captions.filter((c) => srcMs >= c.startMs && srcMs <= c.endMs);
  const c = active[active.length - 1];
  if (!c) return null;
  const o = envelope(srcMs, c.startMs, c.endMs, 220);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: Math.round(timeline.output.height * 0.075),
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '18px 34px',
          borderRadius: 22,
          background: 'rgba(15, 23, 42, 0.9)',
          color: '#fff',
          fontFamily: timeline.style.font,
          fontSize: 36,
          fontWeight: 600,
          lineHeight: 1.25,
          textAlign: 'center',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
          opacity: o,
          transform: `translateY(${(1 - o) * 12}px)`,
        }}
      >
        {c.text}
      </div>
    </div>
  );
};
```

**File:** `src/render/remotion/Cursor.tsx`
```tsx
import type { FC } from 'react';
import { cursorAt } from '../../timeline/cursor';
import type { Timeline } from '../../timeline/types';

const SIZE = 30;
const ARROW = 'M5 2 L5 24 L10.6 18.9 L14.3 26.7 L18.1 25.1 L14.4 17.4 L21.7 17.4 Z';
const IBEAM = 'M10 4.5 H13 Q14 4.5 14 5.5 Q14 4.5 15 4.5 H18 M14 5.5 V22.5 M10 23.5 H13 Q14 23.5 14 22.5 Q14 23.5 15 23.5 H18';
const HOTSPOT = { arrow: { x: 5, y: 2 }, text: { x: 14, y: 14 } } as const;

export const Cursor: FC<{ timeline: Timeline; srcMs: number }> = ({ timeline, srcMs }) => {
  const c = cursorAt(timeline.moves, timeline.clicks, srcMs);
  if (!c.visible) return null;
  const shape = c.kind === 'text' ? 'text' : 'arrow';
  const hs = HOTSPOT[shape];
  const scale = (SIZE / 28) * c.press;
  return (
    <div
      style={{
        position: 'absolute',
        left: c.x,
        top: c.y,
        opacity: c.opacity,
        transformOrigin: '0 0',
        transform: `scale(${scale}) translate(${-hs.x}px, ${-hs.y}px)`,
        filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35))',
      }}
    >
      <svg width={28} height={28} viewBox="0 0 28 28">
        {shape === 'arrow' ? (
          <path d={ARROW} fill="#0b0b0f" stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
        ) : (
          <g fill="none" strokeLinecap="round">
            <path d={IBEAM} stroke="#fff" strokeWidth={4.5} />
            <path d={IBEAM} stroke="#0b0b0f" strokeWidth={2} />
          </g>
        )}
      </svg>
    </div>
  );
};
```

**File:** `src/render/remotion/Intro.tsx`
```tsx
import type { FC } from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import { introFrames } from '../../timeline/frames';
import type { Timeline } from '../../timeline/types';

export const Intro: FC<{ timeline: Timeline; frame: number }> = ({ timeline: t, frame }) => {
  const total = introFrames(t);
  const clampBoth = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const enter = interpolate(frame, [0, 18], [0, 1], { ...clampBoth, easing: Easing.out(Easing.cubic) });
  const exit = interpolate(frame, [Math.max(1, total - 10), Math.max(2, total)], [1, 0], clampBoth);
  return (
    <AbsoluteFill
      style={{
        background: t.style.background,
        fontFamily: t.style.font,
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        textAlign: 'center',
      }}
    >
      <div style={{ opacity: Math.min(enter, exit), transform: `scale(${0.94 + 0.06 * enter})` }}>
        <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -1.5 }}>{t.intro?.title}</div>
        {t.intro?.subtitle ? <div style={{ marginTop: 18, fontSize: 36, opacity: 0.75 }}>{t.intro.subtitle}</div> : null}
        <div style={{ margin: '28px auto 0', width: 72, height: 6, borderRadius: 3, background: t.style.accent }} />
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit test/integration/render.test.ts && npx tsc --noEmit`
Expected: PASS (first run downloads Remotion's headless Chrome), no type errors. Look at `.showtime/demo/frames/*.png` in the temp dir once: zoom on the clicked control, cursor visible, captions legible, intro card.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Remotion renderer (camera, cursor, ripples, spotlights, captions, intro) and QA stills"
```

---

### Task 8: CLI commands

**Files:**
- Modify: `src/cli/main.ts` (full replacement below)
- Create: `src/cli/format.ts`
- Test: `test/integration/cli.test.ts`

**Interfaces:**
- Consumes: `loadScript` (Task 1), `scriptJsonSchema` (Task 1), `workPaths` (Task 1), `check`, `CheckReport` (Task 5), `record` (Task 6), `renderDemo`, `renderQaFrames` (Task 7).
- Produces: `formatCheck(report: CheckReport): string`; commands `schema`, `check [--json] [--headed]`, `record [--headed] [--keep-frames]`, `render [-o]`, `frames`, `make [-o] [--headed]`. Exit code 1 on any failure; errors printed as `✖ <message>` on stderr.

- [ ] **Step 1: Write the failing test**

**File:** `test/integration/cli.test.ts`
```ts
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureScript } from '../helpers/fixture';
import { FIXTURES, serveDir } from '../helpers/serve';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../../bin/showtime.mjs', import.meta.url));

async function cli(args: string[], cwd = tmpdir()) {
  try {
    const r = await exec(process.execPath, [BIN, ...args], { cwd, maxBuffer: 50_000_000 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

let server: Awaited<ReturnType<typeof serveDir>>;
beforeAll(async () => {
  server = await serveDir(path.join(FIXTURES, 'demo-app'));
});
afterAll(() => server.close());

describe('showtime CLI', () => {
  it('prints the schema', async () => {
    const r = await cli(['schema']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).properties.scenes).toBeDefined();
  });

  it('fails clearly on an invalid script', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showtime-cli-'));
    const file = path.join(dir, 'bad.json');
    await writeFile(file, JSON.stringify({ version: 1, scenes: [] }));
    const r = await cli(['check', file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/✖ Invalid .*bad\.json/);
    expect(r.stderr).toMatch(/app/);
  });

  it('check --json reports failures as JSON with exit code 1', async () => {
    const loaded = await fixtureScript(server.url, (raw) => {
      raw.scenes = [{ id: 'x', steps: [{ do: 'click', target: '.dup' }] }];
    });
    const r = await cli(['check', loaded.scriptPath, '--json']);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.ok).toBe(false);
    expect(report.failure.sceneId).toBe('x');
  });

  it('make produces the video next to the script, independent of the cwd', async () => {
    const loaded = await fixtureScript(server.url);
    const r = await cli(['make', loaded.scriptPath]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('check passed');
    expect(existsSync(path.join(loaded.dir, 'demo.mp4'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration/cli.test.ts`
Expected: FAIL — `check`/`make` are unknown commands (`error: unknown command 'check'`).

- [ ] **Step 3: Implement**

**File:** `src/cli/format.ts`
```ts
import path from 'node:path';
import type { CheckReport } from '../runner/check';

const ARIA_LINES = 80;

export function formatCheck(report: CheckReport): string {
  if (report.ok) {
    const dir = report.steps[0]?.screenshot ? path.dirname(report.steps[0].screenshot) : '';
    return `✓ all ${report.steps.length} steps passed — screenshots in ${dir}`;
  }
  const f = report.failure!;
  const aria = f.aria.split('\n').slice(0, ARIA_LINES);
  return [
    `✗ ${f.error}`,
    `  screenshot: ${f.screenshot}`,
    '  page (ARIA snapshot) — pick a selector from here:',
    ...aria.map((line) => `    ${line}`),
  ].join('\n');
}
```

**File:** `src/cli/main.ts`
```ts
import { Command } from 'commander';
import { workPaths } from '../paths';
import { loadScript } from '../script/load';
import { scriptJsonSchema } from '../script/schema';
import { formatCheck } from './format';

const say = (line: string) => process.stdout.write(`${line}\n`);
const progress = (p: number) => {
  if (process.stdout.isTTY) process.stdout.write(`\rRendering ${Math.round(p * 100)}%`);
};

const program = new Command('showtime')
  .description('AI-directed product demo videos: JSON script in, polished MP4 out')
  .version('0.1.0');

program
  .command('schema')
  .description('print the JSON Schema of demo scripts')
  .action(() => {
    say(JSON.stringify(scriptJsonSchema(), null, 2));
  });

program
  .command('check <script>')
  .description('rehearse: run every step fast, screenshot each, report the first failure')
  .option('--json', 'print the machine-readable report')
  .option('--headed', 'show the browser')
  .action(async (file: string, o: { json?: boolean; headed?: boolean }) => {
    const loaded = await loadScript(file);
    const { check } = await import('../runner/check');
    const report = await check(loaded, { headed: o.headed, log: o.json ? undefined : say });
    say(o.json ? JSON.stringify(report, null, 2) : formatCheck(report));
    if (!report.ok) process.exitCode = 1;
  });

program
  .command('record <script>')
  .description('record a take (raw video + event log) into .showtime/<name>/take')
  .option('--headed', 'show the browser')
  .option('--keep-frames', 'keep the captured JPEG frames')
  .action(async (file: string, o: { headed?: boolean; keepFrames?: boolean }) => {
    const loaded = await loadScript(file);
    const { record } = await import('../runner/record');
    const ev = await record(loaded, { headed: o.headed, keepFrames: o.keepFrames, log: say });
    say(`✓ take: ${(ev.video.durationMs / 1000).toFixed(1)} s, ${ev.steps.length} steps → ${workPaths(loaded).take}`);
  });

program
  .command('render <script>')
  .description('render the polished video from the last take (no re-recording)')
  .option('-o, --out <file>', 'output MP4 (default: <script-name>.mp4 next to the script)')
  .action(async (file: string, o: { out?: string }) => {
    const loaded = await loadScript(file);
    const { renderDemo } = await import('../pipeline');
    const out = await renderDemo(loaded, { out: o.out, onProgress: progress });
    say(`\n✓ ${out}`);
  });

program
  .command('frames <script>')
  .description('render QA stills (intro + one per step) for visual review')
  .action(async (file: string) => {
    const loaded = await loadScript(file);
    const { renderQaFrames } = await import('../pipeline');
    const files = await renderQaFrames(loaded);
    say(files.join('\n'));
  });

program
  .command('make <script>')
  .description('check → record → render')
  .option('-o, --out <file>', 'output MP4 (default: <script-name>.mp4 next to the script)')
  .option('--headed', 'show the browser')
  .action(async (file: string, o: { out?: string; headed?: boolean }) => {
    const loaded = await loadScript(file);
    const { check } = await import('../runner/check');
    const report = await check(loaded, { headed: o.headed });
    if (!report.ok) {
      say(formatCheck(report));
      process.exitCode = 1;
      return;
    }
    say(`✓ check passed (${report.steps.length} steps)`);
    const { record } = await import('../runner/record');
    const ev = await record(loaded, { headed: o.headed, log: say });
    say(`✓ take: ${(ev.video.durationMs / 1000).toFixed(1)} s`);
    const { renderDemo } = await import('../pipeline');
    const out = await renderDemo(loaded, { out: o.out, onProgress: progress });
    say(`\n✓ ${out}`);
  });

program.parseAsync().catch((err: Error) => {
  process.stderr.write(`✖ ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/integration/cli.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: showtime CLI (check, record, render, frames, make)"
```

---

### Task 9: Claude Code skill, README, skill installer

**Files:**
- Create: `skill/SKILL.md`, `README.md`, `scripts/install-skill.mjs`
- Test: `test/unit/skill.test.ts`

**Interfaces:**
- Consumes: `parseScript` (Task 1).
- Produces: a skill named `showtime`; `npm run install-skill` symlinks `skill/` to `~/.claude/skills/showtime`.

- [ ] **Step 1: Write the failing test**

**File:** `test/unit/skill.test.ts`
```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseScript } from '../../src/script/schema';

const SKILL = new URL('../../skill/SKILL.md', import.meta.url);

describe('skill/SKILL.md', () => {
  it('has frontmatter with a name and a trigger description', async () => {
    const text = await readFile(SKILL, 'utf8');
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    expect(front).toMatch(/^name: showtime$/m);
    expect(front).toMatch(/^description: Use when .+/m);
  });

  it('ships an example script that is valid', async () => {
    const text = await readFile(SKILL, 'utf8');
    const json = text.match(/```json\n([\s\S]*?)\n```/)?.[1];
    expect(json).toBeDefined();
    expect(() => parseScript(JSON.parse(json!))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/skill.test.ts`
Expected: FAIL — ENOENT `skill/SKILL.md`.

- [ ] **Step 3: Write the skill, README and installer**

**File:** `skill/SKILL.md`
````markdown
---
name: showtime
description: Use when the user wants a product demo video, walkthrough, screencast or feature recording of a web app (for a pitch, talk, README or social post). Write a showTime JSON script, rehearse it, record it and render a polished MP4 with auto-zoom, smooth cursor, captions and sped-up loading via the `showtime` CLI.
---

# showTime — scripted demo videos

`showtime` turns a JSON script into a polished 1080p MP4. You are the director: you write the
script; the CLI clicks through the app, records it and edits it (zoom, cursor, ripples,
spotlights, captions, speed-ups, intro card).

## Workflow

1. **Story first.** Settle the audience, target length (30–120 s), the 2–4 moments that sell the
   product, and the URL of a running app (a local dev server is best). Read the pitch, PRD or
   routes if they exist. Plan one scene per moment.
2. **Explore the app** with the Playwright MCP (`browser_navigate`, `browser_snapshot`) to learn
   the flow and pick selectors from the accessibility snapshot. Prefer
   `role=button[name='Save']`, `text=…`, `#id`, `[data-testid=…]` over long CSS chains.
3. **Write the script** in the project, e.g. `demo/pitch.json`. Run `showtime schema` for the
   complete format.
4. **Rehearse:** `showtime check demo/pitch.json`. On failure read the error, the ARIA snapshot it
   prints and `.showtime/<name>/check/failure.png`; fix the selector or add a `wait`, repeat until
   green.
5. **Record:** `showtime record demo/pitch.json` (runs in real time).
6. **Render:** `showtime render demo/pitch.json` → `demo/pitch.mp4`.
7. **QA:** `showtime frames demo/pitch.json`, then Read the PNGs it lists. Check that zoom lands on
   the right control, captions are legible and do not hide the action, and pacing feels right.
8. **Iterate:** edits to `show`, `style` or `meta` only need `render`. Edits to actions (`do`,
   targets, text, `hold`, `app`) need `record` again — `render` refuses a stale take.

`showtime make <script>` runs check → record → render in one go.

## Example

```json
{
  "version": 1,
  "meta": { "title": "Acme Analytics", "subtitle": "Reports in two clicks" },
  "app": {
    "url": "http://localhost:3000/",
    "viewport": { "width": 1440, "height": 900 },
    "mask": [".customer-email"]
  },
  "setup": [{ "do": "click", "target": "text=Accept cookies" }],
  "style": { "accent": "#6366f1" },
  "scenes": [
    {
      "id": "report",
      "steps": [
        { "do": "click", "target": "role=button[name='New report']", "show": { "caption": "A report in one click" } },
        { "do": "type", "target": "#report-name", "text": "Q3 revenue" },
        { "do": "select", "target": "#period", "value": "30d" },
        { "do": "click", "target": "role=button[name='Create']" },
        { "do": "wait", "for": "text=Report ready" },
        { "do": "hover", "target": ".cashback", "show": { "spotlight": true, "caption": "Cashback at a glance", "hold": 1500 } }
      ]
    }
  ]
}
```

## Reference

- **Actions (`do`):** `goto {url}` · `click {target}` · `type {target, text, pace?: human|fast|ms, clear?}` ·
  `press {key}` · `hover {target}` · `select {target, value}` · `scroll {target} | {by}` ·
  `wait {for} | {ms}` · `pause {ms}`
- **`show` (per step):** `zoom` (number, or `false`), `caption`, `spotlight`, `hold` (ms, real time),
  `speed`.
- **`style`:** `background` (any CSS background), `padding`, `radius`, `shadow`, `font`, `accent`,
  `autoZoom`, `autoSpeed`, `maxZoom`.
- **`app`:** `url`, `viewport`, `deviceScaleFactor`, `storageState` (Playwright storage-state JSON,
  path relative to the script), `colorScheme`, `locale`, `timezoneId`, `mask` (CSS selectors to blur).
- Output lands next to the script; working files in `.showtime/<script-name>/`.

## Direction tips

- One idea per caption, at most ~6 words. Caption the benefit ("Paid in two clicks"), not the
  click ("Click Pay").
- After a payoff screen add `hold` (800–2000 ms) so viewers can read it; put `spotlight` on the one
  number that matters.
- Never `pause` to wait for loading — use `wait {for}`; auto-speed compresses the loader.
- Use `setup` for cookie banners and onboarding, `app.storageState` to start logged in, `app.mask`
  to blur personal data.
- Keep the default 1440×900 viewport at `deviceScaleFactor` 2 for crisp 16:9 zooms.
````

**File:** `README.md`
````markdown
# showTime

AI-directed product demo videos. Claude writes a JSON script; `showtime` rehearses it, records the
web app with Playwright and renders a polished MP4 with Remotion: auto-zoom on the action, a
smooth synthetic cursor, click ripples, spotlights, captions, sped-up loading and an intro card.
Change a caption and re-render in seconds; change the UI and re-take with one command.

```
demo.json ─► check  ─► fix selectors (Claude)
demo.json ─► record ─► take/raw.mp4 + take/events.json
script + events ─► timeline.json ─► Remotion ─► demo.mp4
```

## Install

Requirements: Node ≥ 20 and ffmpeg (`brew install ffmpeg`).

```bash
npm install
npx playwright install chromium
npm link                # puts `showtime` on your PATH
npm run install-skill   # links the Claude Code skill to ~/.claude/skills/showtime
```

## Try it

```bash
npm run fixture                    # demo app on http://127.0.0.1:4777
showtime make fixtures/demo.json   # → fixtures/demo.mp4
```

## Commands

| command | what it does |
|---|---|
| `showtime schema` | print the script JSON Schema |
| `showtime check <script> [--json] [--headed]` | rehearse; screenshot per step; first failure with ARIA snapshot |
| `showtime record <script> [--headed] [--keep-frames]` | record a take into `.showtime/<name>/take` |
| `showtime render <script> [-o out.mp4]` | render from the last take (no re-recording) |
| `showtime frames <script>` | QA stills: intro + one per step |
| `showtime make <script> [-o out.mp4]` | check → record → render |

The script format and the director's workflow are documented in [`skill/SKILL.md`](skill/SKILL.md);
the design is in [`docs/superpowers/specs/2026-10-13-showtime-design.md`](docs/superpowers/specs/2026-10-13-showtime-design.md).

## Development

```bash
npm test            # unit tests (fast)
npm run test:int    # Playwright + ffmpeg + Remotion integration tests (slow)
npm run typecheck
```

## Licensing note

Remotion is free for individuals and companies of up to 3 people; larger companies need a
Remotion company licence. The renderer only consumes `timeline.json`, so it can be swapped.
````

**File:** `scripts/install-skill.mjs`
```js
import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../skill', import.meta.url));
const skills = path.join(homedir(), '.claude', 'skills');
const dest = path.join(skills, 'showtime');

mkdirSync(skills, { recursive: true });
const existing = lstatSync(dest, { throwIfNoEntry: false });
if (existing) {
  if (!existing.isSymbolicLink()) {
    console.error(`${dest} exists and is not a symlink — move it away first.`);
    process.exit(1);
  }
  unlinkSync(dest);
}
symlinkSync(source, dest);
console.log(`Linked ${dest} → ${source}`);
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: Claude Code skill, README and skill installer"
```

---

## Final verification

- [ ] `npm test && npm run test:int && npm run typecheck` — all green.
- [ ] `npm run fixture` in one terminal, `node bin/showtime.mjs make fixtures/demo.json` in another; watch `fixtures/demo.mp4`.
- [ ] Whole-branch review against the spec and the Review Focus list.
