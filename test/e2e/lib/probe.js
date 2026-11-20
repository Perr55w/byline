// Init script injected before any page script (E §5 shared setup).
// - long-animation-frame observer (duration, blockingDuration, per-script forcedStyleAndLayoutDuration)
// - layout-shift observer
// - a wrapped requestAnimationFrame that counts callbacks the APP runs (harness loops use __e2e.raw)
// - a log of the app's byline:routed / byline:rail events so gates can wait on real completion
// - small samplers used by the motion gates (they run on the raw rAF so they never count as app frames)
(() => {
  if (window.__e2e) return;
  const raw = window.requestAnimationFrame.bind(window);
  const rawCancel = window.cancelAnimationFrame.bind(window);
  const E = window.__e2e = { raw, rawCancel, raf: 0, rafTimes: [], keepRafTimes: false, loaf: [], shifts: [], events: [], errors: [] };

  E.rafCallers = null; // set to {} to attribute app rAF requests to their caller (E4/E10 diagnostics)
  window.requestAnimationFrame = function requestAnimationFrame(cb) {
    if (E.rafCallers) {
      const line = (new Error().stack || '').split('\n').slice(2).find(l => !l.includes('__e2e')) || '?';
      const k = line.trim().replace(/^at /, '').replace(location.origin, '');
      E.rafCallers[k] = (E.rafCallers[k] || 0) + 1;
    }
    return raw(function (t) {
      E.raf++;
      if (E.keepRafTimes) E.rafTimes.push(t);
      return cb(t);
    });
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) { return rawCancel(id); };

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const scripts = (e.scripts || []).map(s => ({ invoker: s.invoker, src: (s.sourceURL || '').replace(location.origin, ''), fn: s.sourceFunctionName, dur: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration || 0) }));
        E.loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration || 0, forced: scripts.reduce((a, s) => a + s.forced, 0), scripts: scripts.sort((a, b) => b.dur - a.dur).slice(0, 4) });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { E.errors.push('long-animation-frame unsupported: ' + e.message); }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const src = (e.sources || []).map(s => s.node ? (s.node.id ? '#' + s.node.id : (s.node.className && typeof s.node.className === 'string' ? s.node.tagName?.toLowerCase() + '.' + s.node.className.split(' ').slice(0, 2).join('.') : s.node.nodeName)) : '?').slice(0, 3);
        E.shifts.push({ start: e.startTime, value: e.value, input: e.hadRecentInput, src });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { E.errors.push('layout-shift unsupported: ' + e.message); }

  for (const ev of ['byline:routed', 'byline:rail', 'byline:theme']) {
    document.addEventListener(ev, (e) => E.events.push({ type: ev, t: performance.now(), key: e.detail?.key ?? null, collapsed: e.detail?.collapsed ?? null }));
  }
  addEventListener('error', (e) => E.errors.push(String(e.message || e.error)));
  addEventListener('unhandledrejection', (e) => E.errors.push('unhandled: ' + String(e.reason?.message || e.reason)));

  E.desc = (el) => {
    if (!el || !el.tagName) return String(el);
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`;
  };

  /** Run fn(frameIndex, t) on every raw frame for ms; resolves with the collected (non-undefined) results. */
  E.everyFrame = (fn, ms) => new Promise((resolve) => {
    const out = []; const t0 = performance.now(); let i = 0;
    const step = (t) => {
      try { const v = fn(i++, t); if (v !== undefined) out.push(v); } catch (err) { out.push({ error: String(err) }); }
      if (performance.now() - t0 < ms) raw(step); else resolve(out);
    };
    raw(step);
  });

  /** Effective opacity (product up the tree); 0 when display:none / visibility:hidden. */
  E.effOpacity = (el, memo) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (memo && memo.has(n)) { o *= memo.get(n); break; }
      const cs = getComputedStyle(n);
      if (cs.display === 'none') return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  };

  /**
   * C amendment 6 sampler. Every raw frame for cfg.ms:
   *  - the page h1 (cfg.h1Sel): layout height + line count (catches re-wrap during the entrance)
   *  - effective opacity of cfg.opSel elements inside cfg.scopes (in the viewport): records any jump > cfg.limit
   *    between consecutive frames, including elements that appear at full opacity or vanish while visible.
   *    visibility:hidden elements are skipped (FLIP source hiding is intended); cfg.swapSel elements are exempt
   *    from appear/vanish detection (shared-element swaps), but not from in-place opacity jumps.
   */
  E.samples = {};
  E.startSampler = (cfg) => {
    const ids = new WeakMap(); let nid = 0;
    const idOf = (el) => { let k = ids.get(el); if (!k) { k = ++nid; ids.set(el, k); } return k; };
    const known = new WeakSet();
    let prev = new Map(), hiddenPrev = new Set(), frame = 0;
    E.__maxRaw = null;
    const jumps = [], h1s = new Map();
    const limit = cfg.limit ?? 0.35, maxEls = cfg.maxEls ?? 400;
    const swap = (el) => !!(cfg.swapSel && el.closest && el.closest(cfg.swapSel));
    // appear/vanish only counts elements that paint something themselves (text, media, fill, border, shadow);
    // a bare container whose children carry the fade (e.g. an h1 whose .ln spans animate) is not a hard cut
    const ownPaint = (el) => {
      if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return true;
      if (/^(IMG|SVG|CANVAS|VIDEO|INPUT|TEXTAREA|SELECT|svg)$/.test(el.tagName)) return true;
      const cs = getComputedStyle(el);
      if (cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
      const bg = cs.backgroundColor; if (bg && !/rgba\([^)]*,\s*0\)$|transparent/.test(bg)) return true;
      return parseFloat(cs.borderTopWidth) > 0 && !/rgba\([^)]*,\s*0\)$/.test(cs.borderTopColor);
    };
    let lastT = null;
    const p = E.everyFrame((i, t) => {
      const h = cfg.h1Sel && document.querySelector(cfg.h1Sel);
      if (h && h.getClientRects().length) {
        const k = idOf(h); let r = h1s.get(k);
        if (!r) { r = { desc: E.desc(h), heights: [], lines: [], ln: 0, t0: t }; h1s.set(k, r); }
        const cs = getComputedStyle(h);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const hh = h.offsetHeight;
        r.heights.push(hh); r.lines.push(Math.round(hh / lh)); r.ln = Math.max(r.ln, h.querySelectorAll('.ln').length);
      }
      if (!cfg.opSel) return;
      const memo = new Map();
      const eff = (el) => {
        if (!el || el.nodeType !== 1) return 1;
        if (memo.has(el)) return memo.get(el);
        const cs = getComputedStyle(el);
        const v = cs.display === 'none' ? 0 : parseFloat(cs.opacity) * eff(el.parentElement);
        memo.set(el, v); return v;
      };
      const cur = new Map(), hiddenNow = new Set();
      let n = 0;
      for (const s of cfg.scopes || ['body']) {
        for (const root of document.querySelectorAll(s)) {
          for (const el of root.querySelectorAll(cfg.opSel)) {
            if (n++ > maxEls) break;
            const k = idOf(el);
            const wasKnown = known.has(el); known.add(el);
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            if (getComputedStyle(el).visibility === 'hidden') { hiddenNow.add(k); continue; }
            const o = eff(el);
            cur.set(k, { o, el });
            const pv = prev.get(k);
            let d = null, from = null, raw = null;
            // in-place changes are normalised to one 60 Hz vsync (C measured snaps on a 50 ms grid): a dropped
            // frame is not a snap; appear/vanish at full opacity are hard cuts whatever the frame time
            if (pv) { raw = Math.abs(o - pv.o); d = lastT === null ? raw : raw / Math.max(1, (t - lastT) / 16.67); from = pv.o; }
            else if (frame > 0 && !wasKnown && !hiddenPrev.has(k) && !swap(el) && ownPaint(el)) { d = o; from = 0; }
            if (d !== null && d > limit) jumps.push({ frame, t: Math.round(t), dt: lastT === null ? null : Math.round(t - lastT), from: +from.toFixed(3), to: +o.toFixed(3), d: +d.toFixed(3), raw: raw === null ? null : +raw.toFixed(3), el: E.desc(el), kind: pv ? 'change' : 'appear' });
            if (raw !== null && raw > (E.__maxRaw?.d || 0)) E.__maxRaw = { d: raw, dt: lastT === null ? null : t - lastT };
          }
        }
      }
      for (const [k, pv] of prev) {
        if (!cur.has(k) && !hiddenNow.has(k) && !pv.el.isConnected && pv.o > limit && !swap(pv.el) && pv.paint !== false) jumps.push({ frame, t: Math.round(t), dt: lastT === null ? null : Math.round(t - lastT), from: +pv.o.toFixed(3), to: 0, d: +pv.o.toFixed(3), el: E.desc(pv.el), kind: 'vanish' });
      }
      for (const v of cur.values()) if (v.o > limit && v.paint === undefined) v.paint = ownPaint(v.el);
      prev = cur; hiddenPrev = hiddenNow; frame++; lastT = t;
    }, cfg.ms).then(() => {
      const res = { maxRaw: E.__maxRaw ? { d: +E.__maxRaw.d.toFixed(3), dt: E.__maxRaw.dt === null ? null : Math.round(E.__maxRaw.dt) } : null, frames: frame, maxJump: jumps.reduce((m, j) => Math.max(m, j.d), 0), jumps: jumps.sort((a, b) => b.d - a.d).slice(0, 12), jumpCount: jumps.length, h1s: [...h1s.values()].map(r => ({ desc: r.desc, ln: r.ln, frames: r.heights.length, minH: Math.min(...r.heights), maxH: Math.max(...r.heights), lines: [...new Set(r.lines)] })) };
      E.samples[cfg.name || 'default'] = res;
      return res;
    });
    return p;
  };
  document.addEventListener('DOMContentLoaded', () => { if (window.__e2eCfg && window.__e2eCfg.sampler) E.startSampler(window.__e2eCfg.sampler); });

  /** Pretend the tab is hidden (E §5 gate 7) or visible again. */
  E.setHidden = (hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
})();
