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
