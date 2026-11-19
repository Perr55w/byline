import { loadPlaywright, openPage, gotoRoute, setHash, sleep } from './lib/browser.mjs';
import { PHONE } from './lib/selectors.mjs';
const base = 'http://127.0.0.1:' + (process.argv[2] || 4462);
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const P = await openPage(browser, { profile: PHONE, throttle: 4 });
await gotoRoute(P.page, base, 'today', { settle: 2500 });
await setHash(P.page, '#/feed'); await sleep(1500);
await P.cdp.send('Profiler.enable'); await P.cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await P.cdp.send('Profiler.start');
await setHash(P.page, '#/map'); await sleep(1000);
const { profile } = await P.cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const self = new Map(); const dt = profile.timeDeltas; 
const counts = new Map(); profile.samples.forEach((s, i) => counts.set(s, (counts.get(s) || 0) + (dt[i] || 0)));
for (const [id, t] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + t); }
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, t]) => `${(t / 1000).toFixed(1)}ms ${k}`).join('\n'));
await P.close(); await browser.close();
