// F §5 accessibility checklist — the parts a machine can check (council round0-F-type-info.md):
// contrast from computed styles in both themes, one h1 per view, landmarks + skip link + aria-current,
// accessible names on every focusable control, visible keyboard focus, the dossier dialog contract,
// and reduced motion (final state at first paint). Plus a screenshot set for human review.
import path from 'node:path';
import fs from 'node:fs';
import { SEL, ALL_ROUTES, DESKTOP, PHONE } from '../lib/selectors.mjs';
import { openPage, sleep, gotoRoute, waitRouted } from '../lib/browser.mjs';
import { openDossier, toggleRail, waitRailSettled } from '../lib/flows.mjs';
import { newGate, check } from '../lib/result.mjs';

const A11Y_DESKTOP = { ...DESKTOP, deviceScaleFactor: 1 };

// ------------------------------------------------------------------ in-page: contrast of every visible text run
const CONTRAST = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const memo = new Map();
  const parse = (s) => {
    if (memo.has(s)) return memo.get(s);
    let c = null;
    const m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) c = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
    else { cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(1,2,3,0)'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; c = [d[0], d[1], d[2], d[3] / 255]; }
    memo.set(s, c); return c;
  };
  const over = (t, b) => { const a = t[3] + b[3] * (1 - t[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map(i => (t[i] * t[3] + b[i] * b[3] * (1 - t[3])) / a).concat(a); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const bgMemo = new Map(), opMemo = new Map();
  const bgOf = (el) => {
    if (!el || el.nodeType !== 1) return { c: [255, 255, 255, 1], img: false };
    if (bgMemo.has(el)) return bgMemo.get(el);
    const parent = bgOf(el.parentElement);
    const cs = getComputedStyle(el);
    const own = parse(cs.backgroundColor);
    const r = { c: own[3] > 0 ? over(own, parent.c) : parent.c, img: parent.img || (cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage) ? true : parent.img) };
    bgMemo.set(el, r); return r;
  };
  const opOf = (el) => { if (!el || el.nodeType !== 1) return 1; if (opMemo.has(el)) return opMemo.get(el); const cs = getComputedStyle(el); const v = cs.display === 'none' ? 0 : parseFloat(cs.opacity) * opOf(el.parentElement); opMemo.set(el, v); return v; };
  const fails = [], glyphs = []; let checked = 0, worst = Infinity;
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG'].includes(el.tagName)) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue; // sr-only / collapsed
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.clipPath === 'inset(50%)' || cs.clip === 'rect(0px, 0px, 0px, 0px)') continue;
    if (el.closest('[hidden], [inert]')) continue;
    if (el.matches(':disabled') || el.closest('[aria-disabled="true"]')) continue;
    const op = opOf(el);
    if (op < 0.1) continue; // invisible (e.g. hover-only hints at rest)
    const fg = parse(cs.color);
    if (fg[3] === 0) continue;
    const bg = bgOf(el);
    const eff = [fg[0], fg[1], fg[2], fg[3] * op];
    const shown = over(eff, bg.c);
    const cr = ratio(shown, bg.c);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const ownText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
    if (!/[\p{L}\p{N}]/u.test(ownText)) { if (cr + 1e-6 < need) glyphs.push(`${window.__e2e.desc(el).slice(0, 40)} ${cr.toFixed(2)}`); continue; } // lone separators (· / —): reported, not failed
    checked++;
    if (cr < worst) worst = cr;
    if (cr + 1e-6 < need) fails.push({ el: window.__e2e.desc(el).slice(0, 70), ratio: +cr.toFixed(2), need, fg: hex(shown), bg: hex(bg.c), size, gradientBehind: bg.img, opacity: +op.toFixed(2) });
  }
  return { checked, worst: worst === Infinity ? null : +worst.toFixed(2), fails: fails.sort((a, b) => a.ratio - b.ratio), glyphs: [...new Set(glyphs)] };
};

// ------------------------------------------------------------------ in-page: structure + names
const STRUCTURE = (route) => {
  const hiddenUp = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { if (n.hidden || n.getAttribute('aria-hidden') === 'true' || n.inert) return true; const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return true; } return false; };
  const text = (el) => { let s = ''; for (const n of el.childNodes) { if (n.nodeType === 3) s += n.textContent; else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true' && getComputedStyle(n).display !== 'none') { if (n.tagName === 'IMG') s += n.alt || ''; else if (n.tagName.toLowerCase() === 'svg') s += n.querySelector('title')?.textContent || ''; else s += ' ' + text(n); } } return s.replace(/\s+/g, ' ').trim(); };
  const name = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(text).join(' ').trim(); if (t) return t; }
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    if (el.labels && el.labels.length) { const t = [...el.labels].map(text).join(' ').trim(); if (t) return t; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) { if (['button', 'submit', 'reset'].includes(el.type) && el.value) return el.value; if (el.title) return el.title; if (el.placeholder) return `(placeholder) ${el.placeholder}`; return ''; }
    const t = text(el); if (t) return t;
    return el.title || '';
  };
  const modal = (el) => !!el.closest('[aria-modal="true"]');
  const h1s = [...document.querySelectorAll('h1')].filter(h => !hiddenUp(h) && !modal(h)).map(h => text(h).slice(0, 80));
  const mains = [...document.querySelectorAll('main, [role="main"]')].filter(m => !hiddenUp(m)).map(m => m.id || '(no id)');
  const FOC = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="combobox"]';
  const focusables = [...document.querySelectorAll(FOC)].filter(el => !hiddenUp(el) && !el.disabled && el.tabIndex >= 0);
  const unnamed = focusables.filter(el => !name(el)).map(el => window.__e2e.desc(el).slice(0, 70) + (el.getAttribute('href') ? ` href=${el.getAttribute('href')}` : ''));
  const placeholderOnly = focusables.filter(el => name(el).startsWith('(placeholder)')).map(el => window.__e2e.desc(el).slice(0, 60));
  const invisibleFocusable = focusables.filter(el => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o < 0.05; }).map(el => window.__e2e.desc(el).slice(0, 60));
  const navs = [...document.querySelectorAll('nav, [role="navigation"]')].filter(n => !hiddenUp(n)).map(n => n.getAttribute('aria-label') || (n.getAttribute('aria-labelledby') && document.getElementById(n.getAttribute('aria-labelledby'))?.textContent) || '');
  const first = focusables[0];
  const current = [...document.querySelectorAll('[aria-current="page"]')].filter(el => !hiddenUp(el)).map(el => el.dataset.nav || el.getAttribute('href') || '');
  return {
    lang: document.documentElement.lang || '',
    h1s, mains, navs, unnamed, placeholderOnly, invisibleFocusable, focusCount: focusables.length,
    skipFirst: first ? (first.getAttribute('href') === '#main' ? 'yes' : window.__e2e.desc(first).slice(0, 50)) : 'none',
    mainTarget: !!document.getElementById('main'),
    current, route
  };
};

export async function fContrast(ctx) {
  const g = newGate('F-contrast', 'Text contrast from computed styles (both themes)', 'a11y', 'F §5 / B: text ≥ 4.5:1 (large ≥ 3:1) against the composited background, Proof and Night, every route (canvas field ignored; glass composited over --bg)');
  const shotDir = ctx.shotDir;
  for (const theme of ['proof', 'night']) {
    const P = await openPage(ctx.browser, { profile: A11Y_DESKTOP, theme, reducedMotion: 'reduce' });
    ctx.track(P);
    const glyphs = new Set();
    try {
      for (const key of ctx.routes(ALL_ROUTES)) {
        await gotoRoute(P.page, ctx.base, key, { settle: 1200, timeout: 6000 });
        const r = await P.page.evaluate(CONTRAST);
        const actual = await P.page.evaluate(() => document.documentElement.dataset.theme);
        check(g, 'text runs below AA', r.fails.length, '==', 0, { scope: `${theme}/${key}`, detail: `${r.checked} runs, worst ${r.worst}:1${actual !== theme ? ` (html[data-theme=${actual}]!)` : ''}; ` + r.fails.slice(0, 3).map(f => `${f.ratio}<${f.need} ${f.fg} on ${f.bg} ${f.el}`).join(' | ') });
        r.glyphs.forEach(x => glyphs.add(x.replace(/ [\d.]+$/, m => ` (${m.trim()}:1)`)));
        if (shotDir) { const f = path.join(shotDir, `route-${theme}-${key}.jpg`); await P.page.screenshot({ path: f, type: 'jpeg', quality: 70 }).catch(() => {}); g.shots.push(f); }
      }
      if (glyphs.size) g.notes.push(`${theme}: separator-only text below AA (reported, not failed): ${[...glyphs].slice(0, 4).join(', ')}`);
    } finally { await P.close(); }
  }
  return g;
}

export async function fStructure(ctx) {
  const g = newGate('F-structure', 'Headings, landmarks, names', 'a11y', 'F §5: one h1 per view; skip link → <main id="main">; labelled primary nav with aria-current="page"; html[lang]; every focusable control has an accessible name');
  const P = await openPage(ctx.browser, { profile: A11Y_DESKTOP, reducedMotion: 'reduce' });
  ctx.track(P);
  const placeholder = new Map(), invisible = new Map();
  const where = (keys) => (keys.length >= ctx.routes(ALL_ROUTES).length ? 'every route' : keys.join(', '));
  try {
    for (const key of ctx.routes(ALL_ROUTES)) {
      await gotoRoute(P.page, ctx.base, key, { settle: 900, timeout: 6000 });
      const s = await P.page.evaluate(STRUCTURE, key);
      check(g, 'h1 count', s.h1s.length, '==', 1, { scope: key, detail: s.h1s.map(t => `“${t}”`).join(' · ') });
      if (s.h1s.length === 1) check(g, 'h1 has text', s.h1s[0].length > 0, 'true', true, { scope: key });
      check(g, 'unnamed focusable controls', s.unnamed.length, '==', 0, { scope: key, detail: `${s.focusCount} focusable; ` + s.unnamed.slice(0, 4).join(' | ') });
      s.placeholderOnly.forEach(x => (placeholder.get(x) || placeholder.set(x, []).get(x)).push(key));
      s.invisibleFocusable.forEach(x => (invisible.get(x) || invisible.set(x, []).get(x)).push(key));
      if (key === ctx.routes(ALL_ROUTES)[0]) {
        check(g, 'html[lang]', s.lang || null, 'info', null, { scope: 'shell' });
        check(g, 'html[lang] set', !!s.lang, 'true', true, { scope: 'shell' });
        check(g, 'one <main>, id="main"', s.mains.length === 1 && s.mains[0] === 'main', 'true', true, { scope: 'shell', detail: `mains: ${s.mains.join(', ') || 'none'}` });
        check(g, 'first focusable is the skip link to #main', s.skipFirst === 'yes', 'true', true, { scope: 'shell', detail: `first: ${s.skipFirst}` });
        check(g, 'every visible nav is labelled', s.navs.length > 0 && s.navs.every(Boolean), 'true', true, { scope: 'shell', detail: `navs: ${s.navs.map(n => `“${n}”`).join(', ') || 'none'}` });
      }
      const nav = ['story', 'draft', 'person'].includes(key) ? null : key;
      if (nav) check(g, 'aria-current="page" on the active nav item', s.current.includes(nav), 'true', true, { scope: key, detail: `current: ${s.current.join(', ') || 'none'}` });
    }
    for (const [el, keys] of placeholder) g.notes.push(`placeholder is the only name: ${el} (${where(keys)})`);
    for (const [el, keys] of invisible) g.notes.push(`focusable but fully transparent (keyboard users land on an invisible control): ${el} (${where(keys)})`);
  } finally { await P.close(); }
  return g;
}

export async function fFocus(ctx) {
  const g = newGate('F-focus', 'Keyboard focus + dossier dialog', 'a11y', 'F §5: :focus-visible ring on every tab stop; dossier role="dialog" aria-modal labelled, focus moves in and is trapped, Esc closes and focus returns to the opener');
  const P = await openPage(ctx.browser, { profile: A11Y_DESKTOP, reducedMotion: 'reduce' });
  ctx.track(P);
  try {
    await gotoRoute(P.page, ctx.base, 'feed', { settle: 1200 });
    const stops = [];
    for (let i = 0; i < 24; i++) {
      await P.page.keyboard.press('Tab');
      const h = await P.page.evaluateHandle(() => document.activeElement);
      const s = await h.evaluate((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { rect: [r.left, r.top, r.width, r.height].map(Math.round).join(','), desc: window.__e2e.desc(el).slice(0, 60), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineStyle} ${cs.outlineWidth}` : '', shadow: cs.boxShadow, bgc: cs.backgroundColor, border: cs.borderColor, fv: el.matches(':focus-visible'), body: el === document.body }; });
      if (s.body) break;
      stops.push({ h, s });
    }
    await P.page.evaluate(() => document.activeElement && document.activeElement.blur());
    const bad = [];
    for (const { h, s } of stops) {
      const rest = await h.evaluate((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { rect: [r.left, r.top, r.width, r.height].map(Math.round).join(','), shadow: cs.boxShadow, bgc: cs.backgroundColor, border: cs.borderColor }; }).catch(() => null);
      const visible = !!s.outline || (rest && (rest.shadow !== s.shadow || rest.bgc !== s.bgc || rest.border !== s.border || rest.rect !== s.rect));
      if (!visible) bad.push(s.desc);
    }
    check(g, 'tab stops without a visible focus change', stops.length ? bad.length : null, '==', 0, { scope: 'feed', detail: `${stops.length} stops checked; ` + bad.slice(0, 5).join(' | ') });

    // dossier dialog contract, keyboard only
    const all = P.page.locator(SEL.storyLink);
    if (!(await all.count())) { check(g, 'story link to open the dossier', false, 'true', true, { scope: 'dossier', detail: `no ${SEL.storyLink} on Feed` }); return g; }
    const idx = await P.page.evaluate((sel) => [...document.querySelectorAll(sel)].findIndex(el => el.tabIndex >= 0 && el.getBoundingClientRect().height > 0), SEL.storyLink);
    check(g, 'story rows are keyboard-focusable', idx >= 0, 'true', true, { scope: 'dossier', detail: idx >= 0 ? '' : `none of the ${await all.count()} story elements (${SEL.storyLink}) is focusable (tabIndex < 0): a keyboard user cannot open a dossier` });
    if (idx < 0) return g;
    const link = all.nth(idx);
    await link.focus();
    const opener = await P.page.evaluateHandle(() => document.activeElement);
    await P.page.keyboard.press('Enter');
    let open = true;
    try { await P.page.waitForSelector(SEL.dossierPanel, { state: 'visible', timeout: 5000 }); } catch { open = false; }
    if (!open) { check(g, 'Enter on a story opens the dossier', false, 'true', true, { scope: 'dossier' }); return g; }
    await sleep(700);
    const d = await P.page.evaluate((sel) => {
      const p = document.querySelector(sel);
      const lb = p.getAttribute('aria-labelledby');
      const nm = (lb && document.getElementById(lb)?.textContent?.trim()) || p.getAttribute('aria-label') || '';
      return { role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), name: nm.slice(0, 80), focusIn: p.contains(document.activeElement), active: window.__e2e.desc(document.activeElement).slice(0, 50), h1: p.querySelectorAll('h1').length };
    }, SEL.dossierPanel);
    check(g, 'role="dialog" + aria-modal="true"', d.role === 'dialog' && d.modal === 'true', 'true', true, { scope: 'dossier', detail: `role=${d.role} aria-modal=${d.modal}` });
    check(g, 'dialog has an accessible name', !!d.name, 'true', true, { scope: 'dossier', detail: d.name ? `“${d.name}”` : 'no aria-labelledby/aria-label' });
    check(g, 'dialog contains one h1', d.h1, '==', 1, { scope: 'dossier' });
    check(g, 'focus moved into the dialog', d.focusIn, 'true', true, { scope: 'dossier', detail: `active: ${d.active}` });
    let escaped = 0;
    for (let i = 0; i < 30; i++) {
      await P.page.keyboard.press('Tab');
      if (!(await P.page.evaluate((sel) => document.querySelector(sel)?.contains(document.activeElement), SEL.dossierPanel))) escaped++;
    }
    check(g, 'Tab presses that left the dialog (of 30)', escaped, '==', 0, { scope: 'dossier' });
    await P.page.keyboard.press('Escape');
    let closed = true;
    try { await P.page.waitForSelector(SEL.dossierPanel, { state: 'hidden', timeout: 4000 }); } catch { closed = false; }
    check(g, 'Esc closes the dialog', closed, 'true', true, { scope: 'dossier' });
    if (closed) {
      await sleep(300);
      const back = await opener.evaluate((o) => o.isConnected && (document.activeElement === o || o.contains(document.activeElement)) ? 'yes' : window.__e2e.desc(document.activeElement).slice(0, 50)).catch(() => 'opener detached');
      check(g, 'focus returned to the opener', back === 'yes', 'true', true, { scope: 'dossier', detail: back === 'yes' ? '' : `active: ${back}` });
    }
  } finally { await P.close(); }
  return g;
}

export async function fReduced(ctx) {
  const g = newGate('F-reduced', 'Reduced motion: final state at first paint', 'a11y', 'F §5 / C §1: under prefers-reduced-motion the h1 is not split, not blurred, fully opaque at first paint (bg + animation counts are in E7)');
  const P = await openPage(ctx.browser, { profile: A11Y_DESKTOP, reducedMotion: 'reduce' });
  ctx.track(P);
  try {
    for (const key of ['today', 'feed']) {
      await P.page.goto(`${ctx.base}/#/${key}`, { waitUntil: 'load' });
      const ok = await waitRouted(P.page, key, 0, 8000);
      await sleep(60);
      const h = await P.page.evaluate((sel) => { const h = document.querySelector(sel); if (!h) return null; const cs = getComputedStyle(h); let o = 1; for (let n = h; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return { ln: h.querySelectorAll('.ln').length, filter: cs.filter, opacity: +o.toFixed(3), lnFilter: [...h.querySelectorAll('.ln')].map(l => getComputedStyle(l).filter).find(f => f !== 'none') || 'none' }; }, SEL.pageH1);
      if (!h) { check(g, 'page h1 present', false, 'true', true, { scope: key, detail: ok ? '' : 'never routed' }); continue; }
      check(g, 'h1 effective opacity at first paint', h.opacity, '==', 1, { scope: key });
      check(g, 'h1 not blurred', h.filter === 'none' && h.lnFilter === 'none', 'true', true, { scope: key, detail: `filter ${h.filter}, line filter ${h.lnFilter}` });
      check(g, 'h1 line spans (no split under reduce)', h.ln, '==', 0, { scope: key });
    }
  } finally { await P.close(); }
  return g;
}

// ------------------------------------------------------------------ screenshots for human review (always "info")
export async function shots(ctx) {
  const g = newGate('shots', 'Screenshots for review', 'shots', 'Not a gate: Today (both themes), Feed, dossier open, dossier with the rail collapsed, phone Today');
  if (!ctx.shotDir) return g;
  const take = async (page, name) => { const f = path.join(ctx.shotDir, `${name}.png`); await page.screenshot({ path: f }).catch(() => {}); if (fs.existsSync(f)) { g.shots.push(f); check(g, name, path.relative(ctx.root, f), 'info', null); } };
  for (const theme of ['proof', 'night']) {
    const P = await openPage(ctx.browser, { profile: DESKTOP, theme });
    ctx.track(P);
    try {
      await gotoRoute(P.page, ctx.base, 'today', { settle: 3000 });
      await take(P.page, `today-${theme}`);
      if (theme === 'proof') {
        await P.page.evaluate(() => { location.hash = '#/feed'; });
        await sleep(2200);
        await take(P.page, 'feed-proof');
        const o = await openDossier(P.page, ctx.storyId, { settle: 1300 });
        if (o.ok) {
          await take(P.page, 'dossier-proof');
          await toggleRail(P.page); await waitRailSettled(P.page); await sleep(400);
          await take(P.page, 'dossier-rail-collapsed-proof');
        } else g.notes.push(`dossier did not open: ${o.reason}`);
      }
    } finally { await P.close(); }
  }
  const M = await openPage(ctx.browser, { profile: PHONE });
  ctx.track(M);
  try { await gotoRoute(M.page, ctx.base, 'today', { settle: 3000 }); await take(M.page, 'today-phone'); } finally { await M.close(); }
  return g;
}

export const A11Y_GATES = { 'F-contrast': fContrast, 'F-structure': fStructure, 'F-focus': fFocus, 'F-reduced': fReduced, shots };
