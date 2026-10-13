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
