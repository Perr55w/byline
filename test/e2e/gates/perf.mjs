// E §5 perf gates 1–11 (council round0-E-motion-engineering.md), plus D §1's rhythm assertion inside gate 11
// and C §6.6's "dossier.left ≥ rail.right" inside gate 2. Thresholds are the council's, verbatim.
import { SEL, GATE1_ROUTES, ALL_ROUTES, DESKTOP, DESKTOP_1280, PHONE } from '../lib/selectors.mjs';
import { openPage, metrics, delta, sleep, gotoRoute, setHash, loafSince, shiftsSince, rafCount, bgStats, summarizeLoaf, pageNow, setThrottle, forcedLayoutsFromTrace, waitRouted, TRACE_CATS } from '../lib/browser.mjs';
import { openDossier, closeDossier, toggleRail, isCollapsed, waitRailSettled, sampleAnimations } from '../lib/flows.mjs';
import { newGate, check } from '../lib/result.mjs';

/** Forced layouts during `action` (Chrome trace). */
async function tracedForcedLayouts(browser, page, action, waitMs) {
  await browser.startTracing(page, { categories: TRACE_CATS });
  try { await action(); await sleep(waitMs); } finally { /* always stop */ }
  const buf = await browser.stopTracing();
  return forcedLayoutsFromTrace(buf);
}

// ------------------------------------------------------------------ gate 1
export async function e1(ctx) {
  const g = newGate('E1', 'Tab change, phone 4× CPU', 'perf', 'E §5.1: longest LoAF < 50 ms, Σ blocking < 100 ms, forced style+layout per LoAF < 4 ms; DECISIONS: ≤ 1 forced layout per transition');
  const routes = ctx.routes(GATE1_ROUTES);
  const P = await openPage(ctx.browser, { profile: PHONE, throttle: 4 });
  ctx.track(P);
  try {
    const routed = await gotoRoute(P.page, ctx.base, 'today', { settle: 2500 });
    if (!routed) g.notes.push('Today never emitted byline:routed within 8 s (app may be broken); measuring anyway');
    const seq = routes.filter(r => r !== 'today').concat(routes.includes('today') ? ['today'] : []);
    for (const key of seq) {
      const t0 = await setHash(P.page, `#/${key}`);
      await sleep(1500);
      const ok = await P.page.evaluate(({ key, t0 }) => window.__e2e.events.some(e => e.type === 'byline:routed' && e.key === key && e.t >= t0), { key, t0 });
      const s = summarizeLoaf(await loafSince(P.page, t0));
      const detail = (ok ? '' : 'not routed within 1.5 s; ') + (s.worst ? `worst: ${s.worst}` : '');
      check(g, 'longest long frame', s.longest, '<', 50, { unit: 'ms', scope: key, detail });
      check(g, 'Σ blockingDuration', s.blocking, '<', 100, { unit: 'ms', scope: key });
      check(g, 'forced style+layout / LoAF', s.forcedMax, '<', 4, { unit: 'ms', scope: key });
    }
    // forced layout count per transition (trace; throttle off so the trace overhead does not skew anything)
    await setThrottle(P.cdp, 1);
    let prev = seq[seq.length - 1];
    for (const key of seq) {
      if (key === prev) continue;
      const r = await tracedForcedLayouts(ctx.browser, P.page, () => setHash(P.page, `#/${key}`), 1200);
      check(g, 'forced layouts in transition', r ? r.forced : null, '<=', 1, { scope: `${prev}→${key}`, detail: r ? `${r.layouts} layouts, forced ${r.forcedMs} ms${r.where.length ? ': ' + r.where.slice(0, 3).join(' | ') : ''}` : 'trace unreadable' });
      prev = key;
    }
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ gate 2
export async function e2(ctx) {
  const g = newGate('E2', 'Dossier open/close + rail collapse with dossier open', 'perf', 'E §5.2: longest LoAF < 50 ms (phone + desktop, 4×), ≤ 1 forced layout per open, dossier.left − rail.right constant ±1 px per frame; C §6.6: dossier.left ≥ rail.right every frame');
  for (const [label, profile] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    const P = await openPage(ctx.browser, { profile, throttle: 4 });
    ctx.track(P);
    try {
      await gotoRoute(P.page, ctx.base, 'feed', { settle: 2500 });
      const o = await openDossier(P.page, ctx.storyId, { settle: 1000 });
      if (!o.ok) { check(g, 'dossier opens', false, 'true', true, { scope: label, detail: `${o.reason} (via ${o.via})` }); continue; }
      const so = summarizeLoaf(await loafSince(P.page, o.t0));
      check(g, 'open: longest long frame', so.longest, '<', 50, { unit: 'ms', scope: `${label} (${o.via})`, detail: so.worst });
      const c = await closeDossier(P.page);
      const sc = summarizeLoaf(await loafSince(P.page, c.t0));
      check(g, 'close: longest long frame', sc.longest, '<', 50, { unit: 'ms', scope: label, detail: (c.ok ? '' : 'panel still visible after Esc; ') + sc.worst });
      // forced layouts per open (trace, throttle off)
      await setThrottle(P.cdp, 1);
      await sleep(300);
      let opened = null;
      const r = await tracedForcedLayouts(ctx.browser, P.page, async () => { opened = await openDossier(P.page, ctx.storyId, { settle: 0 }); }, 900);
      check(g, 'forced layouts per open', r && opened?.ok ? r.forced : null, '<=', 1, { scope: label, detail: r ? `${r.layouts} layouts, forced ${r.forcedMs} ms${r.where.length ? ': ' + r.where.slice(0, 3).join(' | ') : ''}` : 'trace unreadable' });
      if (label === 'desktop') {
        // rail collapse + expand with the dossier open, sampled every frame (4× again, per E)
        await setThrottle(P.cdp, 4);
        await sleep(400);
        const before = await P.page.evaluate(({ rail }) => document.querySelector(rail)?.getBoundingClientRect().width ?? null, { rail: SEL.rail });
        const samples = await P.page.evaluate(async ({ rail, panel, btn }) => {
          const R = document.querySelector(rail), D = document.querySelector(panel), B = document.querySelector(btn);
          if (!R || !D || !B) return { error: `missing ${!R ? 'rail ' : ''}${!D ? 'panel ' : ''}${!B ? 'collapse button' : ''}` };
          const read = () => { const a = R.getBoundingClientRect(), b = D.getBoundingClientRect(); return { railRight: a.right, railW: a.width, left: b.left, gap: b.left - a.right }; };
          const out = [read()];
          B.click();
          out.push(...await window.__e2e.everyFrame(() => read(), 900));
          B.click();
          out.push(...await window.__e2e.everyFrame(() => read(), 900));
          return { out };
        }, { rail: SEL.rail, panel: SEL.dossierPanel, btn: SEL.railCollapseBtn });
        if (samples.error) { check(g, 'rail collapse with dossier open', null, 'true', true, { scope: label, detail: samples.error }); }
        else {
          const s = samples.out, g0 = s[0].gap;
          const widths = s.map(x => x.railW), minW = Math.min(...widths), maxW = Math.max(...widths);
          const drift = Math.max(...s.map(x => Math.abs(x.gap - g0)));
          const minGap = Math.min(...s.map(x => x.gap));
          check(g, 'rail actually collapsed', maxW - minW, '>=', 100, { unit: 'px', scope: label, detail: `rail width ${Math.round(before)}: min ${Math.round(minW)}, max ${Math.round(maxW)} over ${s.length} frames` });
          check(g, 'dossier.left − rail.right drift', drift, '<=', 1, { unit: 'px', scope: label, detail: `gap at rest ${g0.toFixed(1)} px` });
          check(g, 'min(dossier.left − rail.right) (C)', minGap, '>=', 0, { unit: 'px', scope: label });
        }
      }
      await setThrottle(P.cdp, 1);
    } finally { await P.close(); }
  }
  return g;
}

// ------------------------------------------------------------------ gate 3
export async function e3(ctx) {
  const g = newGate('E3', 'Cumulative layout shift per route', 'perf', 'E §5.3: CLS after 4 s on each route (skeleton → content included) < 0.02, desktop');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    for (const key of ctx.routes(ALL_ROUTES)) {
      await gotoRoute(P.page, ctx.base, key, { timeout: 4000 });
      await sleep(4000);
      const shifts = (await shiftsSince(P.page, 0)).filter(s => !s.input);
      const cls = shifts.reduce((a, s) => a + s.value, 0);
      const worst = shifts.sort((a, b) => b.value - a.value)[0];
      check(g, 'CLS', +cls.toFixed(4), '<', 0.02, { scope: key, detail: worst ? `largest ${worst.value.toFixed(4)} at ${Math.round(worst.start)} ms: ${worst.src.join(', ')}` : '' });
    }
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ gate 4
export async function e4(ctx) {
  const g = newGate('E4', 'Idle CPU (background frozen)', 'perf', 'E §5.4: Today ?bgidle=2000, wait 3 s, measure 5 s: 0 rAF callbacks, TaskDuration Δ < 50 ms, LayoutCount Δ = 0');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'today', { query: 'bgidle=2000' + ctx.bgQuery });
    await sleep(3000);
    await P.page.evaluate(() => { window.__e2e.rafCallers = {}; });
    const r0 = await rafCount(P.page), m0 = await metrics(P.cdp);
    await sleep(5000);
    const m1 = await metrics(P.cdp), r1 = await rafCount(P.page);
    const d = delta(m0, m1), st = await bgStats(P.page);
    const callers = await P.page.evaluate(() => Object.entries(window.__e2e.rafCallers || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n}× ${k}`));
    check(g, 'rAF callbacks in 5 s', r1 - r0, '==', 0, { detail: (st ? `bg renderer ${st.renderer}, frozen ${st.frozen}, running ${st.running}` : 'window.__byline.bg.stats() missing') + (callers.length ? `; requested by: ${callers.join(' | ')}` : '') });
    check(g, 'TaskDuration Δ', d.TaskDuration, '<', 50, { unit: 'ms' });
    check(g, 'LayoutCount Δ', d.LayoutCount, '==', 0, { detail: `RecalcStyle Δ ${d.RecalcStyleCount}` });
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ gate 5
function drawLimits(st, phone) {
  if (!st) return { range: [27, 32], why: 'no bg.stats()' };
  if (st.renderer === 'webgl2') return { range: [27, 32], why: 'WebGL2 (E §5.5)' };
  if (st.renderer === 'canvas2d') return phone ? { range: [0, 1.2], why: 'Canvas2D on phone = static frame (DECISIONS)' } : { range: [15, 21], why: 'Canvas2D fallback is capped at 20 fps (DECISIONS); E §5.5 27–32 applies to WebGL2' };
  return { range: [27, 32], why: `renderer ${st.renderer}` };
}
export async function e5(ctx) {
  const g = newGate('E5', 'Ambient budget (Today active, Feed dim)', 'perf', 'E §5.5: 5 s on Today, no input: draws/s 27–32 (WebGL2), TaskDuration < 250 ms desktop / < 500 ms phone 4×, LayoutCount Δ = 0, RecalcStyle Δ ≤ 2; Feed: #bg opacity .35, draws/s ≤ 21');
  for (const [label, profile, throttle, budget] of [['desktop', DESKTOP, 1, 250], ['phone 4×', PHONE, 4, 500]]) {
    const P = await openPage(ctx.browser, { profile, throttle });
    ctx.track(P);
    try {
      await gotoRoute(P.page, ctx.base, 'today', { query: ctx.bgQuery.slice(1) });
      await sleep(3000);
      const s0 = await bgStats(P.page), m0 = await metrics(P.cdp);
      await sleep(5000);
      const m1 = await metrics(P.cdp), s1 = await bgStats(P.page);
      const d = delta(m0, m1);
      const lim = drawLimits(s1, label !== 'desktop');
      check(g, 'bg draws / s', s0 && s1 ? (s1.draws - s0.draws) / 5 : null, 'between', lim.range, { scope: label, detail: s1 ? `${lim.why}; hz ${s1.hz}, N ${s1.N}, mode ${s1.mode}` : 'window.__byline.bg.stats() missing' });
      check(g, 'TaskDuration Δ (5 s)', d.TaskDuration, '<', budget, { unit: 'ms', scope: label });
      check(g, 'LayoutCount Δ', d.LayoutCount, '==', 0, { scope: label });
      check(g, 'RecalcStyleCount Δ', d.RecalcStyleCount, '<=', 2, { scope: label });
      if (label === 'desktop') {
        const t0 = await setHash(P.page, '#/feed');
        await waitRouted(P.page, 'feed', t0, 4000);
        await sleep(1500);
        const f0 = await bgStats(P.page);
        const op = await P.page.evaluate((s) => { const c = document.querySelector(s); return c ? parseFloat(getComputedStyle(c).opacity) : null; }, SEL.bgCanvas);
        const attr = await P.page.evaluate(() => document.documentElement.dataset.bg || null);
        await sleep(3000);
        const f1 = await bgStats(P.page);
        check(g, 'Feed #bg opacity', op, 'within', [0.35, 0.02], { scope: 'feed', detail: `html[data-bg=${attr}]` });
        check(g, 'Feed bg draws / s', f0 && f1 ? (f1.draws - f0.draws) / 3 : null, '<=', 21, { scope: 'feed' });
      }
    } finally { await P.close(); }
  }
  return g;
}

// ------------------------------------------------------------------ gate 6
export async function e6(ctx) {
  const g = newGate('E6', 'No layout per pointermove', 'perf', 'E §5.6: 180 mouse moves across Today: LayoutCount Δ ≤ 12, no long frames (desktop)');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'today', { query: ctx.bgQuery.slice(1) });
    await sleep(3000);
    await P.page.mouse.move(320, 160);
    await sleep(200);
    const m0 = await metrics(P.cdp), t0 = await pageNow(P.page);
    for (let i = 0; i < 180; i++) {
      const row = Math.floor(i / 30), col = i % 30;
      const x = 320 + (row % 2 ? 29 - col : col) * 36, y = 180 + row * 110;
      await P.page.mouse.move(x, y);
    }
    await sleep(400);
    const m1 = await metrics(P.cdp), d = delta(m0, m1);
    const s = summarizeLoaf(await loafSince(P.page, t0));
    check(g, 'LayoutCount Δ (180 moves)', d.LayoutCount, '<=', 12, { detail: `RecalcStyle Δ ${d.RecalcStyleCount}, TaskDuration Δ ${d.TaskDuration} ms` });
    check(g, 'long frames', s.count, '==', 0, { detail: s.worst ? `longest ${s.longest} ms: ${s.worst}` : '' });
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ gate 7
export async function e7(ctx) {
  const g = newGate('E7', 'Hidden tab + reduced motion', 'perf', 'E §5.7: hidden → 0 draws over 2 s; reduced motion → ≤ 1 draw over 3 s, no running animations 100 ms after a route change; C §6.6: getAnimations().length === 0 50 ms after load');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'today', { query: ctx.bgQuery.slice(1) });
    await sleep(2500);
    await P.page.evaluate(() => window.__e2e.setHidden(true));
    await sleep(100);
    const s0 = await bgStats(P.page), r0 = await rafCount(P.page);
    await sleep(2000);
    const s1 = await bgStats(P.page), r1 = await rafCount(P.page);
    check(g, 'draws while hidden (2 s)', s0 && s1 ? s1.draws - s0.draws : null, '==', 0, { scope: 'hidden', detail: `app rAF callbacks ${r1 - r0}` });
    await P.page.evaluate(() => window.__e2e.setHidden(false));
  } finally { await P.close(); }

  const R = await openPage(ctx.browser, { profile: DESKTOP, reducedMotion: 'reduce' });
  ctx.track(R);
  try {
    await R.page.goto(`${ctx.base}/${ctx.bgQuery ? '?' + ctx.bgQuery.slice(1) : ''}#/today`, { waitUntil: 'load' });
    const routed = await waitRouted(R.page, 'today', 0, 8000);
    await sleep(50);
    const atLoad = await R.page.evaluate(() => document.getAnimations().map(a => `${a.constructor.name}:${a.animationName || a.transitionProperty || a.id || '?'} on ${window.__e2e.desc(a.effect?.target)}`));
    check(g, 'getAnimations().length 50 ms after load (C)', routed ? atLoad.length : null, '==', 0, { scope: 'reduced', detail: (routed ? '' : 'Today never routed; ') + atLoad.slice(0, 4).join(' | ') });
    const s0 = await bgStats(R.page);
    await sleep(3000);
    const s1 = await bgStats(R.page);
    check(g, 'bg draws over 3 s', s0 && s1 ? s1.draws - s0.draws : null, '<=', 1, { scope: 'reduced', detail: s1 ? `total draws since load ${s1.draws}, renderer ${s1.renderer}` : 'no bg.stats()' });
    const t0 = await setHash(R.page, '#/feed');
    const ok = await waitRouted(R.page, 'feed', t0, 5000);
    await sleep(100);
    const running = await R.page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => `${a.constructor.name}:${a.animationName || a.transitionProperty || '?'} on ${window.__e2e.desc(a.effect?.target)}`));
    check(g, 'running animations 100 ms after route change', ok ? running.length : null, '==', 0, { scope: 'reduced', detail: (ok ? '' : 'feed never routed; ') + running.slice(0, 4).join(' | ') });
  } finally { await R.close(); }
  return g;
}

// ------------------------------------------------------------------ gate 8
const COUNT_BACKDROP = () => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (!bf || bf === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (cs.visibility === 'hidden' || window.__e2e.effOpacity(el) < 0.01) continue;
    out.push(`${window.__e2e.desc(el).slice(0, 60)} [${bf}]`);
  }
  return out;
};
export async function e8(ctx) {
  const g = newGate('E8', 'Glass and layer limits', 'perf', 'E §5.8: visible backdrop-filter surfaces ≤ 2 (≤ 3 with a modal over the dossier); no animation keyframes on backdrop-filter/--frost; permanent will-change on ≤ 4 elements');
  const P = await openPage(ctx.browser, { profile: DESKTOP });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'today', { settle: 3500 });
    let list = await P.page.evaluate(COUNT_BACKDROP);
    check(g, 'backdrop-filter surfaces', list.length, '<=', 2, { scope: 'today', detail: list.join(' | ') });
    const wc = await P.page.evaluate(() => [...document.querySelectorAll('*')].filter(el => { const v = getComputedStyle(el).willChange; return v && v !== 'auto'; }).map(el => `${window.__e2e.desc(el).slice(0, 50)} [${getComputedStyle(el).willChange}]`));
    check(g, 'permanent will-change elements (at rest)', wc.length, '<=', 4, { scope: 'today', detail: wc.slice(0, 8).join(' | ') });
    const animsTab = await sampleAnimations(P.page, 1400, () => setHash(P.page, '#/feed'));
    await sleep(1600);
    list = await P.page.evaluate(COUNT_BACKDROP);
    check(g, 'backdrop-filter surfaces', list.length, '<=', 2, { scope: 'feed', detail: list.join(' | ') });
    let animsDz = [];
    const opened = await (async () => { let o; animsDz = await sampleAnimations(P.page, 1500, async () => { o = await openDossier(P.page, ctx.storyId, { settle: 0 }); }); return o; })();
    if (opened?.ok) {
      await sleep(600);
      list = await P.page.evaluate(COUNT_BACKDROP);
      check(g, 'backdrop-filter surfaces', list.length, '<=', 2, { scope: 'dossier open', detail: list.join(' | ') });
      const before = list.length;
      await P.page.keyboard.press('Control+k');
      await sleep(700);
      const list2 = await P.page.evaluate(COUNT_BACKDROP);
      if (list2.length !== before || await P.page.locator(SEL.indexDialog).count()) check(g, 'backdrop-filter surfaces', list2.length, '<=', 3, { scope: 'dossier + ⌘K', detail: list2.join(' | ') });
      else g.notes.push('⌘K did not open over the dossier (Ctrl+K); the 3-surface modal case was not measured');
      await P.page.keyboard.press('Escape'); await sleep(300);
    } else check(g, 'dossier opens', false, 'true', true, { detail: opened?.reason || 'unknown' });
    const bad = [...animsTab, ...animsDz].filter(a => a.props.some(p => /backdrop-filter|backdropFilter|--frost/i.test(p)));
    check(g, 'animations on backdrop-filter / --frost', bad.length, '==', 0, { scope: 'tab + dossier', detail: bad.slice(0, 4).map(a => `${a.props.join(',')} on ${a.target}`).join(' | ') });
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ gate 9
export async function e9(ctx) {
  const g = newGate('E9', 'Background canvas backing size', 'perf', 'E §5.9: desktop w×h ≤ 2.4e6; phone ≤ 0.6e6; at DPR 3 width/innerWidth ≤ 1.5');
  for (const [label, profile, max] of [['desktop 1440×900@2', DESKTOP, 2.4e6], ['phone 390×844@3', PHONE, 0.6e6]]) {
    const P = await openPage(ctx.browser, { profile });
    ctx.track(P);
    try {
      await gotoRoute(P.page, ctx.base, 'today', { settle: 1500, query: ctx.bgQuery.slice(1) });
      const b = await P.page.evaluate((s) => { const c = document.querySelector(s); return c ? { w: c.width, h: c.height, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio, renderer: window.__byline?.bg?.stats?.().renderer } : null; }, SEL.bgCanvas);
      check(g, 'backing pixels', b ? b.w * b.h : null, '<=', max, { scope: label, detail: b ? `${b.w}×${b.h} for ${b.iw}×${b.ih} CSS px, ${b.renderer}` : '#bg missing' });
      if (profile === PHONE) check(g, 'bg.width / innerWidth', b ? +(b.w / b.iw).toFixed(3) : null, '<=', 1.5, { scope: label });
    } finally { await P.close(); }
  }
  return g;
}

// ------------------------------------------------------------------ gate 10
function mapFixture(real, n = 500) {
  const nodes = real.nodes || [];
  if (!nodes.length) return null;
  const out = { ...real, nodes: [], edges: [] };
  const idMap = [];
  for (let i = 0; i < n; i++) {
    const src = nodes[i % nodes.length];
    const k = Math.floor(i / nodes.length);
    const id = k === 0 ? src.id : 900000 + i;
    const ang = (i * 2.399963) % (Math.PI * 2), rr = 14 * Math.sqrt(k + 1);
    const node = { ...src, id };
    if (typeof src.x === 'number' && k) { node.x = src.x + Math.cos(ang) * rr * k; node.y = src.y + Math.sin(ang) * rr * k; }
    out.nodes.push(node);
    idMap.push([src.id, id, k]);
  }
  const copies = Math.ceil(n / nodes.length);
  for (let k = 0; k < copies; k++) {
    for (const e of real.edges || []) {
      const a = k === 0 ? e.a : idMap.find(([s, , kk]) => s === e.a && kk === k)?.[1];
      const b = k === 0 ? e.b : idMap.find(([s, , kk]) => s === e.b && kk === k)?.[1];
      if (a != null && b != null) out.edges.push({ ...e, a, b });
    }
  }
  if (out.meta) out.meta = { ...out.meta, n: out.nodes.length, e: out.edges.length, fixture: `e2e: ${nodes.length} real nodes cloned to ${n}` };
  return out;
}
export async function e10(ctx) {
  const g = newGate('E10', 'Map with a 500-node fixture', 'perf', 'E §5.10: 60 wheels + 1 s drag, desktop 1×: frame p95 ≤ 20 ms; phone 4×: longest LoAF < 50 ms; 0 rAF callbacks 1.5 s after inertia ends');
  let real = null;
  try { real = await (await fetch(`${ctx.base}/api/map`)).json(); } catch (e) { g.notes.push(`GET /api/map failed: ${e.message}`); }
  const fixture = real ? mapFixture(real, 500) : null;
  if (!fixture) { check(g, '500-node fixture built', false, 'true', true, { detail: 'no /api/map nodes to clone' }); return g; }
  g.notes.push(`fixture: ${real.nodes.length} real /api/map nodes cloned (positions jittered) to ${fixture.nodes.length} nodes, ${fixture.edges.length} edges; injected by intercepting /api/map (test-only, never shown as data)`);
  for (const [label, profile, throttle] of [['desktop', DESKTOP, 1], ['phone 4×', PHONE, 4]]) {
    const P = await openPage(ctx.browser, { profile, throttle });
    ctx.track(P);
    try {
      await P.context.route('**/api/map*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
      await gotoRoute(P.page, ctx.base, 'map', { query: 'bgidle=1000' + ctx.bgQuery, settle: 2000 });
      const box = await P.page.evaluate((sel) => { const c = [...document.querySelectorAll(sel)].find(el => el.getBoundingClientRect().width > 100); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, SEL.mapCanvas);
      if (!box) { check(g, 'map canvas present', false, 'true', true, { scope: label, detail: `no visible ${SEL.mapCanvas} on #/map (map view not built yet?)` }); continue; }
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const t0 = await pageNow(P.page);
      const frames = P.page.evaluate(() => window.__e2e.everyFrame((i, t) => t, 3200));
      if (label === 'desktop') {
        await P.page.mouse.move(cx, cy);
        for (let i = 0; i < 60; i++) { await P.page.mouse.wheel(0, i < 30 ? -100 : 100); await sleep(16); }
        await P.page.mouse.down();
        for (let i = 1; i <= 60; i++) { await P.page.mouse.move(cx + i * 4, cy + i * 2); await sleep(16); }
        await P.page.mouse.up();
      } else {
        for (let i = 0; i < 60; i++) { await P.page.mouse.wheel(0, i < 30 ? -100 : 100).catch(() => {}); await sleep(16); }
        const tp = (type, x, y) => P.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
        await tp('touchStart', cx, cy);
        for (let i = 1; i <= 60; i++) { await tp('touchMove', cx - i * 2, cy - i); await sleep(16); }
        await tp('touchEnd');
      }
      const ts = await frames;
      const iv = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      const p95 = iv.length ? iv[Math.floor(iv.length * 0.95)] : null;
      const s = summarizeLoaf(await loafSince(P.page, t0));
      if (label === 'desktop') check(g, 'frame interval p95', p95 === null ? null : +p95.toFixed(1), '<=', 20, { unit: 'ms', scope: label, detail: `${iv.length} intervals, max ${iv.length ? iv[iv.length - 1].toFixed(1) : '—'} ms` });
      else check(g, 'longest long frame', s.longest, '<', 50, { unit: 'ms', scope: label, detail: s.worst });
      await sleep(3000); // inertia (≤ ~1 s) + 1.5 s, with ?bgidle=1000 the field is frozen too
      await P.page.evaluate(() => { window.__e2e.rafCallers = {}; });
      const r0 = await rafCount(P.page);
      await sleep(1000);
      const r1 = await rafCount(P.page);
      const callers = await P.page.evaluate(() => Object.entries(window.__e2e.rafCallers || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n}× ${k}`));
      check(g, 'rAF callbacks after inertia (1 s window)', r1 - r0, '==', 0, { scope: label, detail: callers.length ? `requested by: ${callers.join(' | ')}` : '' });
    } finally { await P.close(); }
  }
  return g;
}

// ------------------------------------------------------------------ gate 11 (+ D §1 rhythm assertion)
const RHYTHM = ({ slotSel, divSel, railSel, iconSel }) => {
  const rail = document.querySelector(railSel);
  if (!rail) return { error: 'no rail' };
  const kids = [...document.querySelectorAll(`${slotSel}, ${divSel}`)];
  const rr = rail.getBoundingClientRect();
  const items = kids.map(el => {
    const r = el.getBoundingClientRect();
    const ic = el.matches(slotSel) ? el.querySelector(iconSel)?.getBoundingClientRect() : null;
    return { kind: el.matches(slotSel) ? 'slot' : 'div', top: r.top, bottom: r.bottom, h: r.height, iconCx: ic ? ic.left + ic.width / 2 : null, label: (el.dataset.nav || el.textContent || '').trim().slice(0, 12) };
  });
  return { railCx: rr.left + rr.width / 2, railW: rr.width, items };
};
export async function e11(ctx) {
  const g = newGate('E11', 'Collapsed rail rhythm (+ D §1 assertion)', 'perf', 'E §5.11: icon-slot gaps equal ±0.5 px; D §1 at 1440×900 and 1280×800 after transitionend: slots 32, dividers 4, pitch 36 in-group / 44 across, divider gaps 4, icon centre x = rail centre x ±0.5, delta set = {36, 44}');
  for (const [label, profile] of [['1440×900', DESKTOP], ['1280×800', DESKTOP_1280]]) {
    const P = await openPage(ctx.browser, { profile });
    ctx.track(P);
    try {
      await gotoRoute(P.page, ctx.base, 'today', { settle: 800 });
      if (!(await isCollapsed(P.page))) await toggleRail(P.page);
      await waitRailSettled(P.page);
      await sleep(250);
      const m = await P.page.evaluate(RHYTHM, { slotSel: SEL.railSlot, divSel: SEL.railDivider, railSel: SEL.rail, iconSel: SEL.railIcon });
      if (m.error || !m.items.length) { check(g, 'rail slots found', false, 'true', true, { scope: label, detail: m.error || `no ${SEL.railSlot}` }); continue; }
      check(g, 'rail width collapsed', m.railW, 'within', [64, 0.5], { unit: 'px', scope: label });
      const slots = m.items.filter(i => i.kind === 'slot'), divs = m.items.filter(i => i.kind === 'div');
      const badSlot = slots.filter(s => Math.abs(s.h - 32) > 0.5), badDiv = divs.filter(d => Math.abs(d.h - 4) > 0.5);
      check(g, 'slot heights ≠ 32', badSlot.length, '==', 0, { scope: label, detail: `${slots.length} slots; ` + badSlot.slice(0, 3).map(s => `${s.label}=${s.h.toFixed(1)}`).join(', ') });
      check(g, 'divider heights ≠ 4', badDiv.length, '==', 0, { scope: label, detail: `${divs.length} dividers; ` + badDiv.slice(0, 3).map(d => `${d.label}=${d.h.toFixed(1)}`).join(', ') });
      const deltas = [], errs = [], gapErrs = [];
      for (let i = 0, prev = null, divBetween = null; i < m.items.length; i++) {
        const it = m.items[i];
        if (it.kind === 'div') { divBetween = it; continue; }
        if (prev) {
          const d = it.top - prev.top, want = divBetween ? 44 : 36;
          deltas.push(+d.toFixed(2));
          if (Math.abs(d - want) > 0.5) errs.push(`${prev.label}→${it.label} ${d.toFixed(1)} (want ${want})`);
          if (divBetween) {
            const a = divBetween.top - prev.bottom, b = it.top - divBetween.bottom;
            if (Math.abs(a - 4) > 0.5 || Math.abs(b - 4) > 0.5) gapErrs.push(`${divBetween.label}: ${a.toFixed(1)}/${b.toFixed(1)}`);
          }
        }
        prev = it; divBetween = null;
      }
      const set = [...new Set(deltas.map(d => Math.round(d * 2) / 2))].sort((a, b) => a - b);
      check(g, 'pitch errors (36 in-group / 44 across)', errs.length, '==', 0, { scope: label, detail: errs.slice(0, 4).join('; ') });
      check(g, 'divider gap errors (4 / 4)', gapErrs.length, '==', 0, { scope: label, detail: gapErrs.slice(0, 4).join('; ') });
      check(g, 'distinct pitch values', set.join(', ') || '—', 'info', null, { scope: label, detail: 'must be exactly {36, 44}' });
      check(g, 'pitch set is {36, 44}', set.length === 2 && set[0] === 36 && set[1] === 44, 'true', true, { scope: label, detail: `got {${set.join(', ')}}` });
      const off = slots.filter(s => s.iconCx === null || Math.abs(s.iconCx - m.railCx) > 0.5);
      check(g, 'icons off rail centre x', off.length, '==', 0, { scope: label, detail: off.slice(0, 3).map(s => `${s.label} ${s.iconCx?.toFixed(1)} vs ${m.railCx.toFixed(1)}`).join('; ') });
    } finally { await P.close(); }
  }
  return g;
}

export const PERF_GATES = { E1: e1, E2: e2, E3: e3, E4: e4, E5: e5, E6: e6, E7: e7, E8: e8, E9: e9, E10: e10, E11: e11 };
