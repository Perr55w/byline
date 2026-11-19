// Browser/page helpers shared by every gate: Playwright loading, device profiles, CDP throttling and
// Performance.getMetrics deltas, route navigation that waits on the app's own byline:routed event.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROBE = path.join(HERE, 'probe.js');
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const tries = ['playwright', '/opt/node-tools/node_modules/playwright', ...(process.env.NODE_PATH || '').split(':').filter(Boolean).map(p => path.join(p, 'playwright'))];
  for (const t of tries) { try { return req(t); } catch { /* next */ } }
  throw new Error('playwright is not installed (tried: ' + tries.join(', ') + ')');
}

/**
 * Open a fresh context + page with the probe installed.
 * opts: { profile, theme: 'proof'|'night', collapsed: bool, reducedMotion: 'reduce'|'no-preference', throttle: number }
 */
export async function openPage(browser, opts = {}) {
  const { profile, theme = 'proof', collapsed = false, reducedMotion = 'no-preference', throttle = 1 } = opts;
  const context = await browser.newContext({ ...profile, reducedMotion, serviceWorkers: 'block', colorScheme: theme === 'night' ? 'dark' : 'light' });
  context.setDefaultTimeout(15000);
  await context.addInitScript({ path: PROBE });
  await context.addInitScript(({ theme, collapsed }) => {
    try {
      if (!sessionStorage.getItem('__e2e_seeded')) {
        localStorage.clear();
        localStorage.setItem('byline-theme', theme === 'night' ? 'night' : 'light');
        localStorage.setItem('byline-rail', collapsed ? 'collapsed' : 'expanded');
        sessionStorage.setItem('__e2e_seeded', '1');
      }
    } catch (e) { /* storage blocked */ }
  }, { theme, collapsed });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  return { context, page, cdp, consoleErrors, close: () => context.close().catch(() => {}) };
}

export async function setThrottle(cdp, rate) { await cdp.send('Emulation.setCPUThrottlingRate', { rate }); }

/** CDP Performance.getMetrics as a plain object (TaskDuration in ms). */
export async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const o = Object.fromEntries(m.map(x => [x.name, x.value]));
  return { TaskDuration: (o.TaskDuration || 0) * 1000, ScriptDuration: (o.ScriptDuration || 0) * 1000, LayoutCount: o.LayoutCount || 0, RecalcStyleCount: o.RecalcStyleCount || 0, LayoutDuration: (o.LayoutDuration || 0) * 1000, RecalcStyleDuration: (o.RecalcStyleDuration || 0) * 1000 };
}
export function delta(a, b) { const d = {}; for (const k of Object.keys(b)) d[k] = +(b[k] - a[k]).toFixed(2); return d; }

export const pageNow = (page) => page.evaluate(() => performance.now());
export const bgStats = (page) => page.evaluate(() => (window.__byline && window.__byline.bg && typeof window.__byline.bg.stats === 'function') ? window.__byline.bg.stats() : null);

/** Wait for the app's byline:routed event for `key` after time t0 (page clock). Returns true if seen. */
export async function waitRouted(page, key, t0 = 0, timeout = 8000) {
  try {
    await page.waitForFunction(({ key, t0 }) => (window.__e2e?.events || []).some(e => e.type === 'byline:routed' && e.t >= t0 && (!key || e.key === key)), { key, t0 }, { timeout, polling: 100 });
    return true;
  } catch { return false; }
}

/** Load a route from scratch: base/?query#/key. Waits for load + routed (or timeout) + settle ms. */
export async function gotoRoute(page, base, key, { query = '', settle = 0, timeout = 8000 } = {}) {
  await page.goto(`${base}/${query ? '?' + query.replace(/^\?/, '') : ''}#/${key}`, { waitUntil: 'load', timeout: 20000 });
  const routed = await waitRouted(page, key, 0, timeout);
  if (settle) await sleep(settle);
  return routed;
}

/** Tab change by setting the hash (E §5 gate 1). Returns the page time the change started. */
export async function setHash(page, hash) {
  return page.evaluate((h) => { const t = performance.now(); location.hash = h; return t; }, hash);
}

export const loafSince = (page, t0, t1 = Infinity) => page.evaluate(({ t0, t1 }) => window.__e2e.loaf.filter(e => e.start >= t0 && e.start <= t1), { t0, t1 });
export const shiftsSince = (page, t0) => page.evaluate((t0) => window.__e2e.shifts.filter(e => e.start >= t0), t0);
export const rafCount = (page) => page.evaluate(() => window.__e2e.raf);

export function summarizeLoaf(list) {
  const longest = list.reduce((m, e) => Math.max(m, e.duration), 0);
  const blocking = list.reduce((s, e) => s + e.blocking, 0);
  const forcedMax = list.reduce((m, e) => Math.max(m, e.forced), 0);
  const worst = list.slice().sort((a, b) => b.duration - a.duration)[0];
  return { count: list.length, longest: Math.round(longest), blocking: Math.round(blocking), forcedMax: Math.round(forcedMax), worst: worst ? worst.scripts.map(s => `${s.invoker || s.fn || '?'} ${s.src} ${s.dur}ms${s.forced ? ` (forced ${s.forced})` : ''}`).join(' | ') : '' };
}

/** Does the page have something matching sel (visible)? */
export async function hasVisible(page, sel) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }), sel);
}

/**
 * Count forced (script-triggered) layouts in a Chrome trace recorded with TRACE_CATS: Layout events on the page's
 * renderer main thread that carry a JS stack (beginData.stackTrace, from devtools.timeline.stack). This is the
 * same signal DevTools uses for its "Forced reflow" warning. Returns { layouts, forced, forcedMs, where[] }.
 */
export const TRACE_CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'v8.execute'];
export function forcedLayoutsFromTrace(buf) {
  let events;
  try { const j = JSON.parse(buf.toString()); events = Array.isArray(j) ? j : j.traceEvents; } catch { return null; }
  const mains = new Set(events.filter(e => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map(e => `${e.pid}:${e.tid}`));
  const byThread = new Map();
  for (const e of events) { const k = `${e.pid}:${e.tid}`; if (mains.has(k) && e.name === 'Layout') { if (!byThread.has(k)) byThread.set(k, []); byThread.get(k).push(e); } }
  let layouts = [];
  for (const list of byThread.values()) if (list.length > layouts.length) layouts = list;
  // a layout forced by Playwright's own injected script (no URL on any frame: e.g. computeElementStyleVisibility from
  // waitForSelector's visibility check) is the harness measuring itself, not the app (round 1)
  const appFrame = (l) => (l.args?.beginData?.stackTrace || []).some(f => f.url && !/^(pptr|playwright|__playwright)/.test(f.url));
  const forced = layouts.filter(l => (l.args?.beginData?.stackTrace || []).length && appFrame(l));
  const where = forced.map(l => { const f = l.args.beginData.stackTrace[0]; return `${(f.url || '').replace(/^https?:\/\/[^/]+/, '')}:${(f.lineNumber ?? 0) + 1} ${f.functionName || '(anonymous)'} ${((l.dur || 0) / 1000).toFixed(1)}ms`; });
  return { layouts: layouts.length, forced: forced.length, forcedMs: +(forced.reduce((s, e) => s + (e.dur || 0), 0) / 1000).toFixed(1), where };
}
