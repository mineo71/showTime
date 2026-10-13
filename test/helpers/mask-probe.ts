// Run under tsx (the CLI runtime): opens a session on argv[2] with a mask and prints the computed filter.
import { openSession } from '../../src/runner/browser';
import { parseScript } from '../../src/script/schema';

const script = parseScript({
  version: 1,
  app: { url: process.argv[2], mask: ['.customer-email'] },
  scenes: [{ id: 'a', steps: [{ do: 'pause', ms: 0 }] }],
});
const session = await openSession(script);
try {
  await session.page.goto(script.app.url);
  const filter = await session.page.evaluate(() => getComputedStyle(document.querySelector('.customer-email')!).filter);
  process.stdout.write(`${filter}\n`);
} finally {
  await session.close();
}
