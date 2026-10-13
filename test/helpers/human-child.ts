// Runs record-human with a scripted click, then waits to be stopped with Ctrl+C (SIGINT).
import { recordHuman } from '../../src/human/record';

const [url, out] = process.argv.slice(2);
await recordHuman(url, {
  out,
  headless: true,
  drive: async (page) => {
    await page.getByText('Inbox 12').click();
    await page.waitForTimeout(300);
    process.stdout.write('clicked\n');
    await new Promise(() => undefined);
  },
});
process.stdout.write('done\n');
