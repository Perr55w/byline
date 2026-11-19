// temporary profiling helper (map owner); deleted before finishing
import { loadPlaywright, openPage, gotoRoute, setHash, sleep, loafSince, summarizeLoaf } from './lib/browser.mjs';
import { PHONE } from './lib/selectors.mjs';
const base = 'http://127.0.0.1:' + (process.argv[2] || 4462);
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const P = await openPage(browser, { profile: PHONE, throttle: 4 });
await gotoRoute(P.page, base, 'today', { settle: 2500 });
for (const key of ['feed', 'map', 'search', 'map']) {
  const t0 = await setHash(P.page, `#/${key}`);
  await sleep(1600);
  const l = await loafSince(P.page, t0);
  if (true) { console.log(key, JSON.stringify(summarizeLoaf(l))); for (const e of l) console.log('  ', Math.round(e.start - t0), Math.round(e.duration), 'block', Math.round(e.blocking), e.scripts.map(s => `${s.invoker||s.fn} ${s.src} ${s.dur}`).join(' | ')); }
}
await P.close(); await browser.close();
