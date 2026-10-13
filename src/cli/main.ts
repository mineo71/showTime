import { createRequire } from 'node:module';
import { Command } from 'commander';
import { workPaths } from '../paths';
import { loadScript, type LoadedScript } from '../script/load';
import { scriptJsonSchema } from '../script/schema';
import type { TakeEvents } from '../timeline/types';
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

async function render(loaded: LoadedScript, o: { out?: string; json?: boolean }) {
  const { renderDemo } = await import('../pipeline');
  const { probeVideo } = await import('../ffmpeg');
  const { video, subtitles } = await renderDemo(loaded, { out: o.out, onProgress: progressFor(o.json) });
  return { video, durationMs: (await probeVideo(video)).durationMs, subtitles };
}

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
  .action(async (file: string, o: { json?: boolean; headed?: boolean }) => {
    const loaded = await loadScript(file);
    const { check } = await import('../runner/check');
    const report = await check(loaded, { headed: o.headed, log: o.json ? undefined : say });
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
      const { buildTimeline } = await import('../timeline/build');
      issues.push(...lintTiming(buildTimeline(loaded.script, events), events.steps));
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

program
  .command('render <script>')
  .description('render the polished video from the last take (no re-recording)')
  .option('-o, --out <file>', 'output MP4 (default: <script-name>.mp4 next to the script)')
  .option('--json', 'print { video, durationMs } as JSON')
  .action(async (file: string, o: { out?: string; json?: boolean }) => {
    const result = await render(await loadScript(file), o);
    if (o.json) emit(result);
    else say(`\n✓ ${result.video}`);
  });

program
  .command('frames <script>')
  .description('render QA stills (intro, one per step, outro) and a contact sheet of them')
  .option('--json', 'print { sheet, frames } as JSON')
  .action(async (file: string, o: { json?: boolean }) => {
    const { renderQaFrames } = await import('../pipeline');
    const { sheet, frames } = await renderQaFrames(await loadScript(file));
    if (o.json) return emit({ sheet, frames });
    say(`sheet: ${sheet}`);
    say(frames.join('\n'));
  });

program
  .command('make <script>')
  .description('check → record → render')
  .option('-o, --out <file>', 'output MP4 (default: <script-name>.mp4 next to the script)')
  .option('--headed', 'show the browser')
  .option('--json', 'print { check, take, video } as JSON')
  .action(async (file: string, o: { out?: string; headed?: boolean; json?: boolean }) => {
    const loaded = await loadScript(file);
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
    else say(`\n✓ ${video.video}`);
  });

program.parseAsync().catch((err: Error) => {
  process.stderr.write(`✖ ${err.message}\n`);
  process.exit(1);
});
