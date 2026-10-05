/** Headless probe: open /playtest arm, sample window.__telemetry, dump JSON. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opts = Object.fromEntries(args.map((a) => {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  return [k, rest.join('=') ?? ''];
}));
const url = opts.url;
const seconds = Number(opts.seconds ?? 150);
const out = opts.out ?? '/tmp/smooth-harness/probe-out.json';
const stallAtSec = opts.stallAt ? Number(opts.stallAt) : null;
const stallMs = Number(opts.stallMs ?? 150);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-features=IntensiveWakeUpThrottling',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });

// Wait for telemetry to appear, then run.
await page.waitForFunction(() => typeof window.__telemetry === 'function', null, { timeout: 60000 });
const t0 = await page.evaluate(() => performance.now());
if (stallAtSec !== null) {
  // Inject the deliberate main-thread block for the stall-survival probe.
  const deadline = t0 + stallAtSec * 1000;
  await page.waitForFunction((d) => performance.now() >= d, deadline, { polling: 100, timeout: 0 });
  await page.evaluate((ms) => {
    let sink = 0; const end = performance.now() + ms;
    while (performance.now() < end) sink += Math.sqrt(performance.now());
    return sink;
  }, stallMs);
  console.log('injected stall', stallMs, 'ms');
}

await page.waitForFunction(
  (deadline) => performance.now() >= deadline,
  t0 + seconds * 1000,
  { polling: 1000, timeout: 0 },
);

const snap = await page.evaluate(() => window.__telemetry());
// Page status for debugging.
snap.pageStatus = await page.evaluate(() => document.querySelector('[data-testid=playtest-status]')?.textContent ?? null);
snap.gapTapArmed = await page.evaluate(() => window.__gapTap?.armed() ?? null);
writeFileSync(out, JSON.stringify(snap, null, 2));
const c = snap.counters;
console.log('counters:', JSON.stringify(c));
console.log('samples:', snap.samples.length, 'beats:', snap.beats.length, 'gaps:', snap.gaps.length, 'events:', snap.events.length);
console.log('gapTapArmed:', snap.gapTapArmed, 'status:', snap.pageStatus);
await browser.close();
