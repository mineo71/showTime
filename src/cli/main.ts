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
