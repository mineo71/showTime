import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { workPaths } from '../paths';
import { loadScript, type LoadedScript } from '../script/load';
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
  .action(async (file: string, o: { json?: boolean; headed?: boolean; until?: string }) => {
    const loaded = await loadScript(file);
    const { check } = await import('../runner/check');
    const report = await check(loaded, { headed: o.headed, until: o.until, log: o.json ? undefined : say });
    if (o.json) emit(report);
    else say(formatCheck(report));
    if (!report.ok) process.exitCode = 1;
  });

program
  .command('lint <script>')
  .description('flag script problems, and timing problems when a fresh take exists')
  .option('--json', 'print { issues, timing } as JSON')
  .action(async (file: string, o: { json?: boolean }) => {
    const loaded = await loadScript(file);
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
  .action(async (file: string, o: { headed?: boolean; keepFrames?: boolean; json?: boolean }) => {
    const loaded = await loadScript(file);
    const { record } = await import('../runner/record');
    const ev = await record(loaded, { headed: o.headed, keepFrames: o.keepFrames, log: o.json ? undefined : say });
    const take = takeSummary(loaded, ev);
    if (o.json) emit(take);
    else say(`✓ take: ${(take.durationMs / 1000).toFixed(1)} s, ${take.steps} steps → ${take.take}`);
  });

withRenderFlags(
  program.command('render <script>').description('render the polished video from the last take (no re-recording)'),
)
  .option('--json', 'print { video, durationMs, subtitles } as JSON')
  .action(async (file: string, o: RenderFlags) => {
    const loaded = await loadScript(file);
    checkScenes(loaded, renderOptions(o).scenes);
    const result = await render(loaded, o);
    if (o.json) emit(result);
    else sayRendered(result);
  });

program
  .command('frames <script>')
  .description('render QA stills (intro, one per step, outro) and a contact sheet of them')
  .option('--aspect <ratio>', '16:9, 9:16 or 1:1', '16:9')
  .option('--json', 'print { sheet, frames } as JSON')
  .action(async (file: string, o: { aspect: string; json?: boolean }) => {
    const aspect = aspectOf(o.aspect);
    const { renderQaFrames } = await import('../pipeline');
    const { sheet, frames } = await renderQaFrames(await loadScript(file), { aspect, log: o.json ? undefined : say });
    if (o.json) return emit({ sheet, frames });
    say(`sheet: ${sheet}`);
    say(frames.join('\n'));
  });

withRenderFlags(program.command('make <script>').description('check → record → render'))
  .option('--headed', 'show the browser')
  .option('--json', 'print { check, take, video } as JSON')
  .action(async (file: string, o: RenderFlags & { headed?: boolean }) => {
    const options = renderOptions(o);
    const loaded = await loadScript(file);
    checkScenes(loaded, options.scenes);
    const log = o.json ? undefined : say;
    const { check } = await import('../runner/check');
    const report = await check(loaded, { headed: o.headed });
    if (!report.ok) {
      if (o.json) emit({ check: report });
      else say(formatCheck(report));
      process.exitCode = 1;
      return;
    }
    log?.(`✓ check passed (${report.steps.length} steps)`);
    const { record } = await import('../runner/record');
    const take = takeSummary(loaded, await record(loaded, { headed: o.headed, log }));
    log?.(`✓ take: ${(take.durationMs / 1000).toFixed(1)} s`);
    const video = await render(loaded, o);
    if (o.json) emit({ check: report, take, video });
    else sayRendered(video);
  });

/** Open a URL in the default browser; best effort. */
function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

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
  .action(async (file: string, o: { port: string; aspect: string; open: boolean }) => {
    const port = Number(o.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be a port number (got "${o.port}")`);
    const aspect = aspectOf(o.aspect);
    if (!existsSync(file)) throw new Error(`Cannot read script: ${path.resolve(file)}`);
    const { startStudio } = await import('../studio/server');
    const studio = await startStudio(file, { port, aspect, log: say });
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
