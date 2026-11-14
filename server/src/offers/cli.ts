/**
 * `npm run offers:refresh` — collect once and print what happened.
 *
 * Separate from the server process because collection is a periodic job, not a
 * request handler: it takes minutes, it is rate-limited by politeness rather
 * than by capacity, and it should be schedulable by cron without a web server
 * running at all.
 *
 * The report is verbose on purpose. A collector that prints "done" tells the
 * operator nothing about the difference between "the sources had no new offers"
 * and "the sources changed their markup and we now read zero". Those need
 * different responses, so the run says which one happened.
 */

import { formatReport, refreshOffers } from './index.ts';

const verbose = process.argv.includes('--verbose');

const report = await refreshOffers(verbose ? (m) => console.log(`  ${m}`) : () => undefined);
console.log(formatReport(report));

// A run where every source failed is a failure, and cron should hear about it.
const anyUsable = report.sources.some((s) => s.status === 'ok' && s.accepted > 0);
if (!anyUsable && report.sources.length > 0) {
  console.error('\nNo source produced a usable offer this run.');
  process.exitCode = 1;
}
