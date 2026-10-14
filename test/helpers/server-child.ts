// Runs withServer around work that never ends, so the test can stop it with a signal.
import { withServer } from '../../src/runner/server';

const [run, url] = process.argv.slice(2);
await withServer({ run, url, timeoutMs: 20_000 }, url, process.cwd(), async () => {
  process.stdout.write('ready\n');
  await new Promise(() => undefined);
});
