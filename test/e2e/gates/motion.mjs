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

// ------------------------------------------------------------------ round 1 S7/S18: theme switch contrast frames
const CONTRAST_PROBE = (max = 160) => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const base = parse(getComputedStyle(document.body).backgroundColor) || [245, 246, 248, 1];
  const els = [...document.querySelectorAll('#view .page.current :is(h1, h2, h3, .lede, p, li, .t-meta, .chip, .tag, .eyebrow, .t-title, a)')].filter(el => {
    if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }).slice(0, max);
  let min = Infinity, worst = '';
  for (const el of els) {
    const cs = getComputedStyle(el); if (parseFloat(cs.opacity) < .1) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const stack = []; for (let p = el; p && p !== document.body; p = p.parentElement) { const b = parse(getComputedStyle(p).backgroundColor); if (b && b[3] > 0) stack.push(b); }
    let bg = base; for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    const f = over(fg, bg);
    const L1 = lum(f), L2 = lum(bg), c = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (c < min) { min = c; worst = `${window.__e2e.desc(el).slice(0, 50)} ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(',')})`; }
  }
  return { min: Number.isFinite(min) ? +min.toFixed(2) : null, worst, n: els.length };
};
export async function cTheme(ctx) {
  const g = newGate('C-theme', 'Theme switch: contrast frames and pacing', 'motion', 'Round 1 S7: text/surface contrast ≥ 3:1 at 100, 300 and 500 ms after the switch (both directions); frame p95 ≤ 33 ms at 1×');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'today', { settle: 3200 });
    for (const to of ['night', 'proof']) {
      const res = await P.page.evaluate(async ({ to, probe }) => {
        const fn = new Function(`return (${probe})`)();
        const at = [100, 300, 500], shots = {}, all = [];
        const t0 = performance.now();
        window.__byline.setTheme(to);
        const ts = await window.__e2e.everyFrame((i, t) => {
          const dt = performance.now() - t0;
          const r = fn(80); all.push({ dt: Math.round(dt), min: r.min, worst: r.worst });
          for (const a of at) if (!shots[a] && dt >= a) shots[a] = { dt: Math.round(dt), ...r };
          return t;
        }, 700);
        return { shots, all, ts };
      }, { to, probe: CONTRAST_PROBE.toString() });
      for (const a of [100, 300, 500]) {
        const s = res.shots[a];
        check(g, `contrast at ${a} ms`, s ? s.min : null, '>=', 3, { scope: `→ ${to}`, detail: s ? `sampled at ${s.dt} ms over ${s.n} text elements; worst ${s.worst}` : 'no frame' });
      }
      const lowest = res.all.filter(x => x.min != null).sort((x, y) => x.min - y.min)[0];
      check(g, 'lowest contrast on any frame', lowest ? lowest.min : null, 'info', null, { scope: `→ ${to}`, detail: lowest ? `${lowest.dt} ms: ${lowest.worst}; frames < 3:1: ${res.all.filter(x => x.min != null && x.min < 3).map(x => x.dt).join(', ') || 'none'} ms` : '' });
      await sleep(900);
    }
    // pacing, without the per-frame probe
    for (const to of ['night', 'proof']) {
      const ts = await P.page.evaluate(async (to) => { window.__byline.setTheme(to); return window.__e2e.everyFrame((i, t) => t, 700); }, to);
      const iv = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      const p95 = iv.length ? iv[Math.floor(iv.length * 0.95)] : null;
      check(g, 'frame p95 during the switch (1×)', p95 === null ? null : +p95.toFixed(1), '<=', 33, { unit: 'ms', scope: `→ ${to}`, detail: `${iv.length} intervals, max ${iv.length ? iv[iv.length - 1].toFixed(1) : '—'} ms` });
      await sleep(900);
    }
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ round 1 S2/S4/S18: swap overlap + flight compositing
export async function cFlight(ctx) {
  const g = newGate('C-flight', 'Route swap overlap and dossier flight compositing', 'motion', 'Round 1 S2: the two page h1s never sum above 1.2 opacity; S4: inside the panel clip the fill is ≥ .94 opaque on every frame (no page text shows through), the scrim reaches ≥ .6 within 120 ms; S3: first motion ≤ 1 frame after the click');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'today', { settle: 3000 });
    // 1) h1 overlap during Today → Feed
    const sw = await P.page.evaluate(async () => {
      const eff = (el) => { let o = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) o *= parseFloat(getComputedStyle(p).opacity); return o; };
      location.hash = '#/feed';
      return window.__e2e.everyFrame(() => {
        let sum = 0;
        for (const h of document.querySelectorAll('#view .page .page-head h1')) {
          const page = h.closest('.page'); if (getComputedStyle(page).visibility === 'hidden') continue;
          const lns = h.querySelectorAll('.ln');
          const own = lns.length ? Math.max(...[...lns].map(l => parseFloat(getComputedStyle(l).opacity))) : 1;
          sum += eff(h) * own;
        }
        return +sum.toFixed(3);
      }, 900);
    });
    check(g, 'max combined h1 opacity (old + new page)', sw.length ? Math.max(...sw) : null, '<=', 1.2, { scope: 'today → feed', detail: `${sw.length} frames` });
    await sleep(1500);
    // 2) flight compositing (desktop, from a Feed row)
    const link = P.page.locator(SEL.storyLink).first();
    if (!(await link.count())) { g.notes.push('no story link on Feed; flight not sampled'); return g; }
    await link.scrollIntoViewIfNeeded(); await link.hover(); await sleep(1200); // hover warms + prebuilds (S3)
    const pr = P.page.evaluate(() => {
      const t0 = performance.now(); let first = null;
      return window.__e2e.everyFrame((i, t) => {
        const panel = document.querySelector('.dossier-panel'); if (!panel || panel.closest('.is-prebuild')) return { i, none: true };
        if (first === null) first = i;
        const cs = getComputedStyle(panel), fill = panel.querySelector('.dossier-fill'), frost = panel.querySelector('.dossier-frost');
        const fo = parseFloat(getComputedStyle(fill).opacity) * parseFloat(cs.opacity);
        const fr = frost && getComputedStyle(frost).display !== 'none' ? parseFloat(getComputedStyle(frost).opacity) : 0;
        const scrim = parseFloat(getComputedStyle(document.querySelector('.dossier-scrim')).opacity);
        return { i, dt: Math.round(performance.now() - t0), fill: +Math.max(fo, fr).toFixed(3), scrim: +scrim.toFixed(3), clip: cs.clipPath };
      }, 900);
    });
    await P.page.evaluate(() => { window.__e2e.clickT = performance.now(); });
    await link.click({ noWaitAfter: true });
    const fr = (await pr).filter(Boolean);
    const shown = fr.filter(f => !f.none);
    const firstIdx = shown.length ? shown[0].i : null;
    const clickIdx = fr.findIndex(f => f.none === undefined);
    check(g, 'panel fill opacity (min over the flight)', shown.length ? Math.min(...shown.map(f => f.fill)) : null, '>=', 0.94, { scope: 'feed → dossier', detail: `${shown.length} frames with the panel` });
    const s120 = shown.find(f => f.dt - shown[0].dt >= 120);
    check(g, 'scrim opacity 120 ms after the panel appears', s120 ? s120.scrim : null, '>=', 0.6, { scope: 'feed → dossier', detail: s120 ? `at +${s120.dt - shown[0].dt} ms` : 'flight shorter than 120 ms?' });
    check(g, 'frames from the click to the first panel frame', firstIdx, 'info', null, { scope: 'feed → dossier', detail: `sampler frame index ${firstIdx} (click issued after the sampler started; ${clickIdx})` });
    await closeDossier(P.page, { settle: 400 });
  } finally { await P.close(); }
  return g;
}

export const MOTION_GATES = { 'C-entrance': cEntrance, 'C-pacing': cPacing, 'C-rules': cRules, 'C-theme': cTheme, 'C-flight': cFlight };
