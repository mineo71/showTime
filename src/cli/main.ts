import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { workPaths } from '../paths';
import { loadScript, type LoadedScript } from '../script/load';
import { NET_MODES, type NetMode } from '../runner/replay';
import { scriptJsonSchema } from '../script/schema';
import type { TakeEvents } from '../timeline/types';
import { aspectOf, formatOf } from '../convert';
import { formatCheck, formatLint } from './format';

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
/** With --json, stdout carries exactly one JSON document. */
const emit = (data: unknown): void => say(JSON.stringify(data, null, 2));
const progressFor = (json?: boolean) =>
  json
    ? undefined
    : (p: number) => {
        if (process.stdout.isTTY) process.stdout.write(`\rRendering ${Math.round(p * 100)}%`);
      };

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const takeSummary = (loaded: LoadedScript, ev: TakeEvents) => ({
  take: workPaths(loaded).take,
  durationMs: ev.video.durationMs,
  steps: ev.steps.length,
});

interface RenderFlags {
  out?: string;
  json?: boolean;
  aspect: string;
  format?: string;
  width?: string;
  fps?: string;
  scenes?: string;
  audio: boolean;
}

/** Validate the output flags up front, before any recording or rendering starts. */
function renderOptions(o: RenderFlags) {
  const width = o.width === undefined ? undefined : Number(o.width);
  if (width !== undefined && !(Number.isInteger(width) && width >= 16 && width <= 3840)) {
    throw new Error(`--width must be a whole number of pixels between 16 and 3840 (got "${o.width}")`);
  }
  const fps = o.fps === undefined ? undefined : Number(o.fps);
  if (fps !== undefined && !(Number.isInteger(fps) && fps >= 5 && fps <= 30)) {
    throw new Error(`--fps must be a whole number from 5 to 30 (got "${o.fps}")`);
  }
  const scenes = o.scenes?.split(',').map((s) => s.trim()).filter(Boolean);
  return { out: o.out, aspect: aspectOf(o.aspect), format: formatOf(o.out, o.format), width, fps, scenes, audio: o.audio };
}

/** Scene ids are checked before any recording or rendering starts. */
function checkScenes(loaded: LoadedScript, scenes: string[] | undefined) {
  const ids = loaded.script.scenes.map((s) => s.id);
  for (const id of scenes ?? []) {
    if (!ids.includes(id)) throw new Error(`--scenes: no scene "${id}" (scenes: ${ids.join(', ')})`);
  }
}

type Net = NetMode;
const NET_HELP = 'network for script.replay: auto (replay the file if it exists, else record it), live, record or replay';
function netOf(value: string | undefined): Net | undefined {
  if (value === undefined) return undefined;
  if (!(NET_MODES as readonly string[]).includes(value)) throw new Error(`--net must be auto, live, record or replay (got "${value}")`);
  return value as Net;
}

const LOCALE_HELP = 'one of the script\'s locales (default: the first)';
const LOCALES_HELP = 'run several locales one after the other: all, or a list such as en,uk';

/** --locale loads one; --locales (render, make) loads several, every one checked before anything runs. */
async function loadLocales(file: string, o: { locale?: string; locales?: string; out?: string }): Promise<LoadedScript[]> {
  if (o.locales === undefined) return [await loadScript(file, { locale: o.locale })];
  if (o.locale) throw new Error('--locale and --locales: give one or the other');
  if (o.out) throw new Error('--out cannot be used with --locales: each locale writes <name>.<locale>.<format> next to the script');
  const first = await loadScript(file);
  const all = first.script.locales;
  if (!all) throw new Error(`--locales: ${first.scriptPath} has no "locales"`);
  const codes = o.locales === 'all' ? all : o.locales.split(',').map((s) => s.trim()).filter(Boolean);
  if (!codes.length) throw new Error('--locales needs all or a list such as en,uk');
  const unknown = codes.find((c) => !all.includes(c));
  if (unknown) throw new Error(`--locales: ${unknown} is not one of: ${all.join(', ')}`);
  return Promise.all(codes.map((locale) => loadScript(file, { locale })));
}

const withRenderFlags = (c: Command) =>
  c
    .option('-o, --out <file>', 'output file (default: <script-name>[-9x16|-1x1].<format> next to the script)')
    .option('--aspect <ratio>', '16:9, 9:16 or 1:1', '16:9')
    .option('--format <format>', 'mp4, gif or webp (default: from --out, else mp4)')
    .option('--width <px>', 'GIF/WebP width (default: 960, 540 or 720 by aspect)')
    .option('--fps <n>', 'GIF/WebP frames per second (default: 15 GIF, 20 WebP)')
    .option('--scenes <ids>', 'render only these scenes, comma-separated (no intro or outro)')
    .option('--no-audio', 'leave out narration, music and sounds (narration still paces burned-in subtitles)');

async function render(loaded: LoadedScript, o: RenderFlags) {
  const { renderDemo } = await import('../pipeline');
  return renderDemo(loaded, { ...renderOptions(o), onProgress: progressFor(o.json), log: o.json ? undefined : say });
}

const sayRendered = (r: { video: string; subtitles: string | null }) => {
  say(`\n✓ ${r.video}`);
  if (r.subtitles) say(`✓ subtitles: ${r.subtitles}`);
};

const program = new Command('showtime')
  .description('AI-directed product demo videos: JSON script in, polished MP4 out')
  .version(version);

program
  .command('setup')
  .description('download the browsers showTime records with and link the skill into Claude Code and Codex')
  .option('--agent <agent>', 'claude, codex or all', 'all')
  .option('--no-browsers', 'only link the skill')
  .option('--json', 'print the result as JSON')
  .action(async (o: { agent: string; browsers: boolean; json?: boolean }) => {
    const { AGENTS, installBrowsers, linkSkill } = await import('../setup');
    const agents = o.agent === 'all' ? AGENTS : AGENTS.filter((a) => a === o.agent);
    if (!agents.length) throw new Error(`--agent must be ${AGENTS.join(', ')} or all`);
    if (o.browsers) {
      if (!o.json) say('Downloading Chromium and the Remotion renderer browser…');
      await installBrowsers({ quiet: o.json });
    }
    const links = linkSkill(agents);
    if (o.json) return emit({ links, browsers: o.browsers });
    for (const dest of links) say(`✓ skill linked: ${dest}`);
    say('Ready. Ask your agent for a demo, or run `showtime make <script>`.');
  });

program
  .command('schema')
  .description('print the JSON Schema of demo scripts')
  .option('--json', 'accepted for symmetry; the output is always JSON')
  .action(() => {
    emit(scriptJsonSchema());
  });

program
  .command('check <script>')
  .description('rehearse: run every step fast, screenshot each, report the first failure')
  .option('--json', 'print the machine-readable report')
  .option('--headed', 'show the browser')
  .option('--until <step>', 'rehearse only up to and including this step (scene#n)')
  .option('--net <mode>', NET_HELP)
  .option('--locale <code>', LOCALE_HELP)
  .action(async (file: string, o: { json?: boolean; headed?: boolean; until?: string; net?: string; locale?: string }) => {
    const net = netOf(o.net);
    const loaded = await loadScript(file, { locale: o.locale });
    const { check } = await import('../runner/check');
    const report = await check(loaded, { headed: o.headed, until: o.until, net, log: o.json ? undefined : say });
    if (o.json) emit(report);
    else say(formatCheck(report));
    if (!report.ok) process.exitCode = 1;
  });

program
  .command('lint <script>')
  .description('flag script problems, and timing problems when a fresh take exists')
  .option('--json', 'print { issues, timing } as JSON')
  .option('--locale <code>', LOCALE_HELP)
  .action(async (file: string, o: { json?: boolean; locale?: string }) => {
    const loaded = await loadScript(file, { locale: o.locale });
    const { lintScript, lintTiming } = await import('../lint');
    const issues = lintScript(loaded.script);
    const { loadTake } = await import('../take');
    const events = await loadTake(loaded).catch(() => null);
    if (events) {
      // The timeline as rendered: narration is synthesized (cached) so its holds count.
      const { timelineFor } = await import('../pipeline');
      const { timeline } = await timelineFor(loaded, { log: o.json ? undefined : say });
      issues.push(...lintTiming(timeline, events.steps));
    }
    if (o.json) emit({ issues, timing: events !== null });
    else say(formatLint(issues, events !== null));
    if (issues.some((i) => i.level === 'warn')) process.exitCode = 1;
  });

program
  .command('record <script>')
  .description('record a take (raw video + event log) into .showtime/<name>/take')
  .option('--headed', 'show the browser')
  .option('--keep-frames', 'keep the captured JPEG frames')
  .option('--json', 'print { take, durationMs, steps } as JSON')
  .option('--net <mode>', NET_HELP)
  .option('--locale <code>', LOCALE_HELP)
  .action(async (file: string, o: { headed?: boolean; keepFrames?: boolean; json?: boolean; net?: string; locale?: string }) => {
    const net = netOf(o.net);
    const loaded = await loadScript(file, { locale: o.locale });
    const { record } = await import('../runner/record');
    const ev = await record(loaded, { headed: o.headed, keepFrames: o.keepFrames, net, log: o.json ? undefined : say });
    const take = takeSummary(loaded, ev);
    if (o.json) emit(take);
    else say(`✓ take: ${(take.durationMs / 1000).toFixed(1)} s, ${take.steps} steps → ${take.take}`);
  });

withRenderFlags(
  program.command('render <script>').description('render the polished video from the last take (no re-recording)'),
)
  .option('--json', 'print { video, durationMs, subtitles } as JSON (with --locales: { runs: [{ locale, … }] })')
  .option('--locale <code>', LOCALE_HELP)
  .option('--locales <list>', LOCALES_HELP)
  .action(async (file: string, o: RenderFlags & { locale?: string; locales?: string }) => {
    const options = renderOptions(o);
    const all = await loadLocales(file, o);
    for (const loaded of all) checkScenes(loaded, options.scenes);
    if (o.locales === undefined) {
      const result = await render(all[0], o);
      if (o.json) emit(result);
      else sayRendered(result);
      return;
    }
    const runs = [];
    for (const loaded of all) {
      if (!o.json) say(`── ${loaded.locale} ──`);
      const result = await render(loaded, o);
      runs.push({ locale: loaded.locale, ...result });
      if (!o.json) sayRendered(result);
    }
    if (o.json) emit({ runs });
  });

program
  .command('frames <script>')
  .description('render QA stills (intro, one per step, outro) and a contact sheet of them')
  .option('--aspect <ratio>', '16:9, 9:16 or 1:1', '16:9')
  .option('--json', 'print { sheet, frames } as JSON')
  .option('--locale <code>', LOCALE_HELP)
  .action(async (file: string, o: { aspect: string; json?: boolean; locale?: string }) => {
    const aspect = aspectOf(o.aspect);
    const loaded = await loadScript(file, { locale: o.locale });
    const { renderQaFrames } = await import('../pipeline');
    const { sheet, frames } = await renderQaFrames(loaded, { aspect, log: o.json ? undefined : say });
    if (o.json) return emit({ sheet, frames });
    say(`sheet: ${sheet}`);
    say(frames.join('\n'));
  });

withRenderFlags(program.command('make <script>').description('check → record → render'))
  .option('--headed', 'show the browser')
  .option('--json', 'print { check, take, video } as JSON (with --locales: { runs: [{ locale, … }] })')
  .option('--net <mode>', NET_HELP)
  .option('--locale <code>', LOCALE_HELP)
  .option('--locales <list>', LOCALES_HELP)
  .action(async (file: string, o: RenderFlags & { headed?: boolean; net?: string; locale?: string; locales?: string }) => {
    const options = renderOptions(o);
    const net = netOf(o.net);
    const all = await loadLocales(file, o);
    for (const loaded of all) checkScenes(loaded, options.scenes);
    if (o.locales === undefined) {
      const run = await makeOne(all[0], o, net);
      if (o.json) emit(run);
      if (!run.video) process.exitCode = 1;
      return;
    }
    // Every locale runs and is reported, even after one fails.
    const runs = [];
    for (const loaded of all) {
      if (!o.json) say(`── ${loaded.locale} ──`);
      try {
        const run = await makeOne(loaded, o, net);
        if (!run.video) process.exitCode = 1;
        runs.push({ locale: loaded.locale, ...run });
      } catch (err) {
        process.exitCode = 1;
        runs.push({ locale: loaded.locale, error: (err as Error).message });
        if (!o.json) process.stderr.write(`✖ ${loaded.locale}: ${(err as Error).message}\n`);
      }
    }
    if (o.json) emit({ runs });
  });

/** check → record → render for one loaded script; prints progress unless --json. */
async function makeOne(loaded: LoadedScript, o: RenderFlags & { headed?: boolean }, net: Net | undefined) {
  const log = o.json ? undefined : say;
  const { check } = await import('../runner/check');
  const { record } = await import('../runner/record');
  const { withServer } = await import('../runner/server');
  // One server for the rehearsal and the take: check and record find it running and reuse it.
  const shot = await withServer(
    loaded.script.server,
    loaded.script.app.url,
    loaded.dir,
    async () => {
      const report = await check(loaded, { headed: o.headed, net });
      if (!report.ok) return { report, take: null };
      log?.(`✓ check passed (${report.steps.length} steps)`);
      // The rehearsal recorded the traffic (or replayed it): the take replays the same answers.
      const takeNet = net === 'record' ? 'replay' : net;
      return { report, take: takeSummary(loaded, await record(loaded, { headed: o.headed, net: takeNet, log })) };
    },
    log,
  );
  const { report, take } = shot;
  if (!take) {
    if (!o.json) say(formatCheck(report));
    return { check: report };
  }
  log?.(`✓ take: ${(take.durationMs / 1000).toFixed(1)} s`);
  const video = await render(loaded, o);
  if (!o.json) sayRendered(video);
  return { check: report, take, video };
}

/** Open a URL in the default browser; best effort. */
function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

program
  .command('voices')
  .description('list the voices of a TTS engine, or try one')
  .option('--engine <engine>', 'system, openai or elevenlabs', 'system')
  .option('--lang <code>', 'only voices of this language (uk, en-gb, …)')
  .option('--try <text>', 'speak this text and save it as a WAV')
  .option('--voice <name>', 'the voice to try (name, or voice id for elevenlabs)')
  .option('--play', 'play the sample (macOS)')
  .option('--json', 'print { engine, voices } (or { file } with --try) as JSON')
  .action(async (o: { engine: string; lang?: string; try?: string; voice?: string; play?: boolean; json?: boolean }) => {
    if (!['system', 'openai', 'elevenlabs'].includes(o.engine)) throw new Error(`--engine must be system, openai or elevenlabs (got "${o.engine}")`);
    const engine = o.engine as 'system' | 'openai' | 'elevenlabs';
    const voices = await import('../voices');
    if (o.try) {
      const { VoiceSchema } = await import('../script/schema');
      const parsed = VoiceSchema.safeParse({ engine, name: o.voice });
      if (!parsed.success) throw new Error('--try with elevenlabs needs --voice <voice id> (list them with showtime voices --engine elevenlabs)');
      const file = await voices.tryVoice(parsed.data, o.try);
      if (o.play && process.platform === 'darwin') spawn('afplay', [file], { stdio: 'ignore' }).on('error', () => undefined);
      if (o.json) return emit({ file });
      return say(`✓ ${file}`);
    }
    const list = voices.filterVoices(await voices.listVoices(engine), o.lang);
    if (o.json) return emit({ engine, voices: list });
    for (const v of list) say(`  ${v.name.padEnd(28)} ${(v.language ?? '').padEnd(7)} ${v.id ?? v.sample ?? ''}`);
    say(`${list.length} voice${list.length === 1 ? '' : 's'}. Try one: showtime voices --try "Hello there" --voice "${list[0]?.id ?? list[0]?.name ?? 'name'}"`);
  });

program
  .command('inspect <url>')
  .description('list what a script can act on: every named control with a ready target, and a screenshot')
  .option('--viewport <WxH>', 'browser size', '1440x900')
  .option('--json', 'print { url, title, targets, screenshot } as JSON')
  .action(async (url: string, o: { viewport: string; json?: boolean }) => {
    const size = /^(\d{3,4})x(\d{3,4})$/.exec(o.viewport);
    if (!size) throw new Error(`--viewport must look like 1440x900 (got "${o.viewport}")`);
    const { inspect } = await import('../inspect');
    const r = await inspect(url, { viewport: { width: Number(size[1]), height: Number(size[2]) } });
    if (o.json) return emit(r);
    say(`${r.title || '(no title)'} — ${r.url}`);
    for (const t of r.targets) say(`  ${t.role.padEnd(9)} ${t.target}${t.count > 1 ? `  (matches ${t.count})` : ''}`);
    say(`screenshot: ${r.screenshot}`);
  });

program
  .command('studio <script>')
  .description('open the studio: a live preview, a step timeline and an inspector that saves to the script')
  .option('--port <n>', 'port on 127.0.0.1', '4848')
  .option('--aspect <ratio>', 'preview 16:9, 9:16 or 1:1', '16:9')
  .option('--no-open', 'print the URL without opening the browser')
  .option('--locale <code>', LOCALE_HELP)
  .action(async (file: string, o: { port: string; aspect: string; open: boolean; locale?: string }) => {
    const port = Number(o.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be a port number (got "${o.port}")`);
    const aspect = aspectOf(o.aspect);
    if (!existsSync(file)) throw new Error(`Cannot read script: ${path.resolve(file)}`);
    const { startStudio } = await import('../studio/server');
    const studio = await startStudio(file, { port, aspect, locale: o.locale, log: say });
    say(`Studio: ${studio.url}  (Ctrl+C to stop)`);
    if (o.open) openBrowser(studio.url);
    await new Promise((resolve) => process.once('SIGINT', resolve));
    await studio.close();
  });

program
  .command('record-human <url>')
  .description('click through your app in a browser; closing the window writes a script of what you did')
  .option('-o, --out <file>', 'the script to write', 'demo.json')
  .option('--viewport <WxH>', 'browser size', '1440x900')
  .option('--force', 'overwrite the script if it exists')
  .option('--json', 'print { file, steps, notes } as JSON')
  .action(async (url: string, o: { out: string; viewport: string; force?: boolean; json?: boolean }) => {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      // reported below
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) throw new Error(`record-human needs an http(s) URL (got "${url}")`);
    const size = /^(\d{3,4})x(\d{3,4})$/.exec(o.viewport);
    if (!size) throw new Error(`--viewport must look like 1440x900 (got "${o.viewport}")`);
    const { recordHuman } = await import('../human/record');
    if (!o.json) say('Recording. Click through the flow, then close the browser window (or press Ctrl+C here).');
    const r = await recordHuman(url, {
      out: o.out,
      viewport: { width: Number(size[1]), height: Number(size[2]) },
      force: o.force,
      log: o.json ? undefined : say,
    });
    if (o.json) return emit({ file: r.file, steps: r.steps.length, notes: r.notes });
    say(`✓ ${r.steps.length} steps → ${r.file}`);
    say(`Next: add captions (or ask your agent), then \`showtime check ${r.file}\`.`);
  });

program.parseAsync().catch((err: Error) => {
  process.stderr.write(`✖ ${err.message}\n`);
  process.exit(1);
});
