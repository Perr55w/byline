// C amendment 6 motion harness (council round0-C-motion-overall.md §6.6) plus the DECISIONS motion bans that
// can be checked mechanically: the banned expo curve and the animated-property whitelist.
// The C assertions "tab switch: no long task > 50 ms at 4×" (→ E1), "dossier.left ≥ rail.right every frame"
// (→ E2) and "reduced motion: getAnimations().length === 0 50 ms after load" (→ E7) run inside those gates.
import { SEL, DESKTOP } from '../lib/selectors.mjs';
import { openPage, sleep, gotoRoute, setHash, bgStats, waitRouted } from '../lib/browser.mjs';
import { openDossier, closeDossier, toggleRail, waitRailSettled, sampleAnimations } from '../lib/flows.mjs';
import { newGate, check } from '../lib/result.mjs';

const samplerCfg = (name, ms, scopes = ['#view', '.topbar']) => ({ name, ms, h1Sel: SEL.pageH1, opSel: SEL.opacitySample, scopes, maxEls: 300, swapSel: '[data-shared], .dossier-panel, .dossier-fill, .dossier-frost, .dossier-bar, .dossier-scroll, .dossier-body', limit: 0.35 });

/** Run the in-page sampler while `action` runs. */
async function sampleDuring(page, cfg, action) {
  await page.evaluate((cfg) => { window.__e2e.pending = window.__e2e.startSampler(cfg); }, cfg);
  if (action) await action();
  return page.evaluate(() => window.__e2e.pending);
}

function reportScenario(g, scope, res, { h1 = true } = {}) {
  if (!res) { check(g, 'sampler ran', false, 'true', true, { scope }); return; }
  check(g, 'max opacity jump per frame', res.maxJump, '<=', 0.35, { scope, detail: `${res.frames} frames; largest raw frame-to-frame change ${res.maxRaw ? `${res.maxRaw.d} over ${res.maxRaw.dt} ms` : '—'}; ${res.jumpCount} jumps > .35/vsync` + (res.jumps.length ? `; worst: ${res.jumps.slice(0, 3).map(j => `${j.kind} ${j.from}→${j.to}${j.dt ? ` in ${j.dt}ms` : ''} ${j.el}`).join(' | ')}` : '') });
  if (!h1) return;
  if (!res.h1s.length) { check(g, 'page h1 seen during entrance', false, 'true', true, { scope, detail: `no ${SEL.pageH1}` }); return; }
  for (const h of res.h1s) {
    check(g, 'h1 height change during entrance', +(h.maxH - h.minH).toFixed(1), '<=', 1, { unit: 'px', scope, detail: `${h.desc.slice(0, 50)}: lines ${h.lines.join('/')}, .ln spans ${h.ln}, ${h.frames} frames` });
    check(g, 'h1 line counts seen', h.lines.length, '==', 1, { scope, detail: `line counts ${h.lines.join(', ')}` });
  }
}

// ------------------------------------------------------------------ h1 lines + opacity jumps
export async function cEntrance(ctx) {
  const g = newGate('C-entrance', 'Heading entrance + opacity continuity', 'motion', 'C §6.6: h1 line count never changes during the entrance; no element opacity changes by > 0.35 between consecutive frames (load, tab switch, dossier open/close)');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await P.context.addInitScript((cfg) => { window.__e2eCfg = { sampler: cfg }; }, samplerCfg('load', 3200));
    await P.page.goto(`${ctx.base}/${ctx.bgQuery ? '?' + ctx.bgQuery.slice(1) : ''}#/today`, { waitUntil: 'load' });
    let load = null;
    try { await P.page.waitForFunction(() => window.__e2e.samples.load, null, { timeout: 12000 }); load = await P.page.evaluate(() => window.__e2e.samples.load); } catch { /* reported */ }
    reportScenario(g, 'first load: Today', load);
    await sleep(800);
    const tab = await sampleDuring(P.page, samplerCfg('tab', 2200), () => setHash(P.page, '#/feed'));
    reportScenario(g, 'tab switch: Today→Feed', tab);
    await sleep(1200);
    let o;
    const open = await sampleDuring(P.page, samplerCfg('open', 1600, ['.dossier', '#view']), async () => { o = await openDossier(P.page, ctx.storyId, { settle: 0 }); });
    if (!o?.ok) check(g, 'dossier opens', false, 'true', true, { detail: o?.reason });
    else {
      reportScenario(g, `dossier open (${o.via})`, open, { h1: false });
      await sleep(600);
      const close = await sampleDuring(P.page, samplerCfg('close', 1200, ['.dossier', '#view']), () => P.page.keyboard.press('Escape'));
      reportScenario(g, 'dossier close', close, { h1: false });
    }
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ background frame pacing
export async function cPacing(ctx) {
  const g = newGate('C-pacing', 'Background frame pacing', 'motion', 'C §6.6 / DECISIONS: drift draws every Nth vsync (frame-count division, not timestamp gates): < 5% of gaps longer than N, none shorter');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'today', { query: ctx.bgQuery.slice(1), settle: 2500 });
    const st = await bgStats(P.page);
    if (!st) { check(g, 'bg.stats() available', false, 'true', true, { detail: 'window.__byline.bg.stats missing' }); return g; }
    const res = await P.page.evaluate(() => {
      let last = null, lastFrame = 0; const gaps = [];
      return window.__e2e.everyFrame((i) => {
        const d = window.__byline.bg.stats().draws;
        if (last !== null && d !== last) { gaps.push(i - lastFrame); lastFrame = i; }
        if (last === null) lastFrame = i;
        last = d;
      }, 3000).then(() => gaps);
    });
    // bg.js paces Canvas2D at ≤ 20 fps (N2 = max(N, hz/20)) but stats().N reports the WebGL N; expect the real one
    const N = st.renderer === 'canvas2d' ? Math.max(st.N || 1, Math.round((st.hz || 60) / 20)) : (st.N || 2);
    if (st.renderer === 'canvas2d' && N !== st.N) g.notes.push(`Canvas2D: expecting a draw every ${N} vsyncs (20 fps cap); bg.stats().N reports ${st.N}, which does not reflect the cap`);
    const gaps = res.slice(1); // first gap is from an arbitrary phase
    const longer = gaps.filter(x => x > N).length, shorter = gaps.filter(x => x < N).length;
    const hist = gaps.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
    check(g, 'draw gaps measured', gaps.length, '>=', 10, { detail: `renderer ${st.renderer}, hz ${st.hz}, expected N ${N}, histogram (vsyncs:count) ${JSON.stringify(hist)}` });
    check(g, `gaps > ${N} vsyncs`, gaps.length ? +(100 * longer / gaps.length).toFixed(1) : null, '<', 5, { unit: '%', detail: `histogram ${JSON.stringify(hist)}` });
    check(g, `gaps < ${N} vsyncs`, shorter, '==', 0);
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ banned easing + animated property whitelist
const BANNED_EASE = /cubic-bezier\(\s*0?\.16\s*,\s*1(\.0+)?\s*,\s*0?\.3\s*,\s*1(\.0+)?\s*\)/i;
const LAYOUT_PROPS = /^(left|top|right|bottom|width|height|inset(-.*)?|margin(-.*)?|padding(-.*)?|min-(width|height)|max-(width|height)|font-size|line-height|border(-(top|right|bottom|left))?-width|grid-template(-.*)?|flex(-basis|-grow|-shrink)?|gap|row-gap|column-gap|backdrop-filter|-webkit-backdrop-filter|--frost|all)$/;
const H1_ONLY = /^(filter|letter-spacing|font-variation-settings|font-weight)$/;
const ALLOWED_CUSTOM = new Set(['--rail-w', '--grp-h', '--hl-i', '--hl-g', '--ring-p']);
const kebab = (p) => p.startsWith('--') ? p : p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()).replace(/^webkit-/, '-webkit-');

export async function cRules(ctx) {
  const g = newGate('C-rules', 'Motion bans: expo curve, animated-property whitelist', 'motion', 'DECISIONS: cubic-bezier(.16,1,.3,1) banned app-wide; animate transform/opacity/clip-path only; filter, letter-spacing, font-variation-settings only on the page h1; never left/top/width/height (except --rail-w); never backdrop-filter');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  const texts = new Map();
  P.page.on('response', async (r) => {
    try {
      const u = new URL(r.url());
      if (u.origin !== new URL(ctx.base).origin) return;
      if (!/\.(css|m?js)$/.test(u.pathname)) return;
      texts.set(u.pathname, await r.text());
    } catch { /* body gone */ }
  });
  try {
    await gotoRoute(P.page, ctx.base, 'today', { settle: 2500 });
    const seen = [];
    seen.push(...(await sampleAnimations(P.page, 1500, () => setHash(P.page, '#/feed'))).map(a => ({ ...a, during: 'tab switch' })));
    await sleep(800);
    let o;
    seen.push(...(await sampleAnimations(P.page, 1500, async () => { o = await openDossier(P.page, ctx.storyId, { settle: 0 }); })).map(a => ({ ...a, during: 'dossier open' })));
    if (o?.ok) {
      seen.push(...(await sampleAnimations(P.page, 1200, () => toggleRail(P.page))).map(a => ({ ...a, during: 'rail collapse (dossier open)' })));
      await waitRailSettled(P.page);
      await closeDossier(P.page, { settle: 300 });
      await toggleRail(P.page); await waitRailSettled(P.page);
    } else g.notes.push(`dossier did not open (${o?.reason}); dossier/rail animations not sampled`);
    seen.push(...(await sampleAnimations(P.page, 1500, () => setHash(P.page, '#/today'))).map(a => ({ ...a, during: 'tab switch back' })));
    // themes: the cross-fade animates colours on token surfaces (allowed); sample it for layout props anyway
    seen.push(...(await sampleAnimations(P.page, 900, () => P.page.evaluate(() => document.querySelector('[data-theme-set="night"], [data-theme-toggle]')?.click()))).map(a => ({ ...a, during: 'theme switch' })));
    await sleep(600);

    // 1. banned curve in any loaded CSS/JS, inline <style>, or a live animation
    await sleep(300);
    const inline = await P.page.evaluate(() => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));
    const hits = [];
    for (const [file, txt] of [...texts, ['inline <style>', inline]]) {
      txt.split('\n').forEach((line, i) => { if (BANNED_EASE.test(line)) hits.push(`${file}:${i + 1}`); });
    }
    const liveHits = seen.filter(a => a.easing.some(e => BANNED_EASE.test(e)));
    check(g, 'banned cubic-bezier(.16,1,.3,1) in loaded CSS/JS', hits.length, '==', 0, { detail: `${texts.size} files scanned; ` + hits.slice(0, 6).join(', ') });
    check(g, 'animations using the banned curve', liveHits.length, '==', 0, { detail: liveHits.slice(0, 4).map(a => `${a.props.join(',')} on ${a.target} (${a.during})`).join(' | ') });

    // 2. property whitelist
    const layout = [], h1only = [], custom = new Set();
    for (const a of seen) {
      for (const raw of a.props) {
        const p = kebab(raw);
        if (LAYOUT_PROPS.test(p)) layout.push(`${p} on ${a.target.slice(0, 50)} (${a.during})`);
        else if (H1_ONLY.test(p) && !(a.isH1 || a.inH1)) h1only.push(`${p} on ${a.target.slice(0, 50)} (${a.during})`);
        else if (p.startsWith('--') && !ALLOWED_CUSTOM.has(p)) custom.add(p);
      }
    }
    check(g, 'animations on layout props / backdrop-filter / transition:all', layout.length, '==', 0, { detail: `${seen.length} animations sampled; ` + [...new Set(layout)].slice(0, 6).join(' | ') });
    check(g, 'filter/letter-spacing/font-variation outside h1', h1only.length, '==', 0, { detail: [...new Set(h1only)].slice(0, 6).join(' | ') });
    check(g, 'other animated custom properties', [...custom].join(', ') || 'none', 'info', null, { detail: 'not banned; listed so a reviewer can confirm they drive paint/transform only' });
    const props = [...new Set(seen.flatMap(a => a.props.map(kebab)))].sort();
    check(g, 'all animated properties seen', props.join(', ') || 'none', 'info', null);
  } finally { await P.close(); }
  return g;
}

export const MOTION_GATES = { 'C-entrance': cEntrance, 'C-pacing': cPacing, 'C-rules': cRules };
