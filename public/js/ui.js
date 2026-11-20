// Shared UI helpers (v4). Views build HTML with the `html` tag (auto-escaped) and wire events with `on`.
// Every export of the v3 ui.js still exists with the same signature; newspaper-only helpers are kept as
// compatible no-ops or v4 equivalents. New in v4: icon, scoreRing, scoreChip, skeleton, sheet,
// holdToPress, statusMark, lattice.

import { countTo, hasCounted, reduced as motionReduced, EASE } from './motion.js';
import { qualityColor, qualityTier, qualityLabel, ringGradientLine, paintQuality } from './quality.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template: interpolations are escaped unless raw() or arrays of html results. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map(x => (x instanceof Raw ? x.s : esc(x))).join('');
      else if (v === false && /\saria-[a-z]+="$/.test(s)) out += 'false'; // ARIA states need an explicit "false", not ""
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return new Raw(out);
}

export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

export const reducedMotion = motionReduced;
export const isSheet = () => matchMedia('(max-width: 760px)').matches;
/** True when the keyboard event belongs to a text field (single-key shortcuts must ignore it). */
export const inField = (e) => !!(e.target.closest && e.target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
export const threshold = () => window.__byline?.threshold ?? 55;

/** Inline icon from the sprite in index.html (D §1 set + utility glyphs). */
export const icon = (name, cls = '') => raw(`<svg class="icon${cls ? ' ' + esc(cls) : ''}" aria-hidden="true" focusable="false"><use href="#i-${esc(name)}"/></svg>`);

/** Remove an element after its exit animation (with a timeout fallback). */
function exitThen(el, cls, ms, done) {
  if (reducedMotion()) { done(); return; }
  el.classList.add(cls);
  let finished = false;
  const fin = () => { if (!finished) { finished = true; done(); } };
  el.addEventListener('animationend', fin, { once: true });
  setTimeout(fin, ms + 120);
}

// ---------- toasts: glass-strong, bottom-centre of the content column, optional undo ----------
let liveUndo = null;
export function toast(msg, kind = '', { undo = null, ms } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return { close() {} };
  const holder = document.createElement('div');
  holder.className = 'toast-slot';
  const el = document.createElement('div');
  el.className = `toast ${kind}${undo ? ' has-undo' : ''}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = msg;
  el.append(text);
  const life = ms || (undo ? 8000 : kind === 'err' ? 7000 : 3800);
  holder.append(el);
  host.append(holder);
  let timer, left = life, started = Date.now(), gone = false;
  const close = () => {
    if (gone) return; gone = true; clearTimeout(timer);
    if (liveUndo?.el === el) liveUndo = null;
    exitThen(el, 'out', 200, () => { holder.classList.add('collapse'); setTimeout(() => holder.remove(), 180); });
  };
  const run = () => { started = Date.now(); timer = setTimeout(() => { if (undo?.commit) undo.commit(); close(); }, left); };
  const pause = () => { clearTimeout(timer); left -= Date.now() - started; };
  const resume = () => run();
  if (undo) {
    const b = document.createElement('button');
    b.className = 'toast-undo'; b.type = 'button'; b.textContent = 'Undo';
    const doUndo = () => { if (gone) return; undo.revert?.(); close(); };
    b.onclick = doUndo;
    el.append(b);
    liveUndo = { el, doUndo };
    el.addEventListener('pointerenter', pause); el.addEventListener('pointerleave', resume);
    el.addEventListener('focusin', pause); el.addEventListener('focusout', resume);
  }
  // swipe to dismiss on touch
  let sx = 0, sy = 0, dx = 0, drag = false;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || e.target.closest('button')) return; sx = e.clientX; sy = e.clientY; drag = true; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (!drag) return; dx = Math.max(0, e.clientX - sx, e.clientY - sy); el.style.transform = `translateX(${dx}px)`; el.style.opacity = String(Math.max(.2, 1 - dx / 160)); });
  el.addEventListener('pointerup', () => { if (!drag) return; drag = false; if (dx > 80) { if (undo?.commit) undo.commit(); close(); } else { el.style.transform = ''; el.style.opacity = ''; } dx = 0; });
  run();
  return { close };
}
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && liveUndo && !inField(e)) { e.preventDefault(); liveUndo.doUndo(); }
});

// ---------- focus trap shared by modal / sheet / dossier ----------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function trapFocus(container, e) {
  if (e.key !== 'Tab') return;
  const f = [...container.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
  if (!f.length) { e.preventDefault(); container.focus(); return; }
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === container)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---------- modal: solid dialog on desktop, glass bottom sheet on phone (closes with system back) ----------
export function modal(content, { wide = false, onClose, sheet = null } = {}) {
  const asSheet = sheet ?? isSheet();
  const wrap = document.createElement('div');
  wrap.className = `modal-wrap${asSheet ? ' as-sheet' : ''}`;
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" tabindex="-1">${content}</div>`;
  const el = wrap.querySelector('.modal');
  const label = el.querySelector('h1, h2, h3');
  if (label) { label.id = label.id || `dlg-${Date.now().toString(36)}`; el.setAttribute('aria-labelledby', label.id); }
  const opener = document.activeElement;
  let closed = false, pushed = false;
  const finish = () => { wrap.remove(); window.__byline?.bg?.overlay?.(false); onClose?.(); opener?.focus?.({ preventScroll: true }); };
  const close = (fromHistory = false) => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onPop);
    if (pushed && !fromHistory) history.back();
    exitThen(wrap, 'out', 320, finish);
  };
  const onKey = (e) => {
    if (!wrap.isConnected || [...document.querySelectorAll('.modal-wrap')].pop() !== wrap) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else trapFocus(el, e);
  };
  const onPop = () => close(true);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey, true);
  if (asSheet) {
    history.pushState({ ...(history.state || {}), sheet: Date.now() }, ''); pushed = true;
    window.addEventListener('popstate', onPop);
    const grip = document.createElement('div');
    grip.className = 'sheet-grip'; grip.setAttribute('aria-hidden', 'true');
    el.prepend(grip);
    let y0 = 0, dy = 0, dragging = false, samples = [];
    el.addEventListener('animationend', (ev) => { if (ev.target === el) el.classList.add('settled'); });
    const settle = () => { el.classList.add('spring'); el.style.setProperty('--drag', '0px'); setTimeout(() => el.classList.remove('spring'), 380); };
    grip.addEventListener('pointerdown', (e) => { dragging = true; dy = 0; y0 = e.clientY; samples = [[performance.now(), 0]]; el.classList.add('settled'); grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = e.clientY - y0; dy = r > 0 ? r : r * .2;
      const now = performance.now(); samples.push([now, dy]); while (samples.length > 2 && now - samples[0][0] > 80) samples.shift();
      el.style.setProperty('--drag', `${dy}px`);
    });
    const end = (cancelled) => {
      if (!dragging) return; dragging = false;
      const [ta, ya] = samples[0], [tb, yb] = samples[samples.length - 1];
      const v = (yb - ya) / Math.max(1, tb - ta);
      if (!cancelled && (dy > el.offsetHeight * .3 || v > .5)) close(); else settle();
      dy = 0;
    };
    grip.addEventListener('pointerup', () => end(false));
    grip.addEventListener('pointercancel', () => end(true));
    window.__byline?.bg?.overlay?.(true);
  }
  document.body.append(wrap);
  requestAnimationFrame(() => el.focus({ preventScroll: true }));
  return { el, close: () => close() };
}
/** Phone-style bottom sheet regardless of viewport (used for the phone "More" menu). */
export const sheet = (content, opts = {}) => modal(content, { ...opts, sheet: true });

export function confirmBox(message, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal(String(html`<h2>Please confirm</h2><p class="muted" style="margin:0;color:var(--text-2)">${message}</p><div class="modal-actions"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" id="ok">${okLabel}</button></div>`),
      { onClose: () => { if (!answered) resolve(false); } });
    m.el.querySelector('#ok').onclick = () => { answered = true; m.close(); resolve(true); };
  });
}

// ---------- formatting ----------
export const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => d ? new Date(d).toLocaleDateString(undefined, opts) : '—';
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export function timeAgo(d) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const pct = (v) => Math.round((v || 0) * 100);

const STATUS_TONE = { approved: 'ok', published: 'ok', done: 'ok', sent: 'ok', replied: 'ok', in_review: 'warn', scheduled: 'neutral', running: 'warn', failed: 'err', cancelled: 'err', rejected: 'err' };
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1);
export const status = (s) => html`<span class="status tag tag--${STATUS_TONE[s] || 'neutral'} ${s || ''}">${sentence((s || '').replace(/_/g, ' '))}</span>`;
const EV = { announcement: 'First-party', reporting: 'Independent', research: 'Research', commentary: 'Commentary', community: 'Community', application: 'Applied practice', own_work: 'My project' };
export const evLabel = (k) => EV[k] || k;
export const evChip = (k) => html`<span class="chip ev-${k}">${evLabel(k)}</span>`;
/** A headline whose last word is glued to the Demo tag, so the tag never strands a word. */
export const titleWithFlag = (title, demo) => { if (!demo) return html`${title}`; const i = String(title).lastIndexOf(' '); return html`${String(title).slice(0, i + 1)}<span class="nowrap">${String(title).slice(i + 1)}${demoFlag(true)}</span>`; };
export const demoFlag = (on) => on ? html` <span class="tag tag--demo demo-flag" title="Fictional sample data">Demo</span>` : '';
export const channelLabel = (c, f) => `${({ linkedin: 'LinkedIn', instagram: 'Instagram', video: 'Video', email: 'Email', note: 'Note' })[c] || c}${f ? ' · ' + f : ''}`;

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); toast('Copied', 'ok'); }
}

export function download(filename, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Embed the app's woff2 fonts into SVG markup so rasterized/exported images keep the real typefaces. */
let fontFaces;
async function fontFaceCss() {
  if (fontFaces) return fontFaces;
  const load = async (family, file, extra) => {
    const buf = await (await fetch(`/fonts/${file}`)).arrayBuffer();
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');${extra}}`;
  };
  fontFaces = (await Promise.all([load('Newsreader', 'newsreader.woff2', 'font-weight:200 800;'), load('Newsreader', 'newsreader-italic.woff2', 'font-weight:200 800;font-style:italic;'),
    load('Geist', 'geist.woff2', 'font-weight:100 900;'), load('Geist Mono', 'geist-mono.woff2', 'font-weight:100 900;')])).join('');
  return fontFaces;
}

/** Rasterize an SVG (markup or URL) to a PNG blob in the browser, with fonts embedded. */
export async function svgToPng(svgOrUrl, w = 1200, h = 1200) {
  let svgText = svgOrUrl.trim().startsWith('<') ? svgOrUrl : await (await fetch(svgOrUrl)).text();
  if (!svgText.includes('@font-face')) svgText = svgText.replace(/<svg([^>]*)>/, `<svg$1><style>${await fontFaceCss()}</style>`);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  await new Promise(r => setTimeout(r, 60));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise(r => c.toBlob(r, 'image/png'));
}

export const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML; btn.style.minWidth = `${btn.offsetWidth}px`;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    if (label) btn.textContent = label;
  } else { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.style.minWidth = ''; }
}

/** Run an async action bound to a button: busy state, a brief ✓ on success, a correction toast on failure. */
export async function act(btn, fn, label, { done } = {}) {
  setBusy(btn, true, label);
  try {
    const r = await fn();
    if (btn && btn.isConnected) {
      setBusy(btn, false);
      if (done) {
        btn.dataset.label = btn.innerHTML;
        btn.innerHTML = `<span class="done-mark"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>${esc(done)}</span>`;
        btn.classList.add('done');
        setTimeout(() => { if (btn.isConnected) { btn.innerHTML = btn.dataset.label; btn.classList.remove('done'); } }, 1200);
      }
    }
    return r;
  } catch (e) { toast(e.message, 'err'); }
  finally { if (btn?.isConnected && btn.hasAttribute('aria-busy')) setBusy(btn, false); }
}

/**
 * Optimistic update: apply now, commit in the background, revert with a correction toast on failure.
 * `item` (optional) gets .pending while the commit is in flight.
 */
export async function optimistic({ apply, commit, revert, item, error = 'That change didn’t save — it has been put back.' }) {
  apply();
  item?.classList.add('pending');
  try { const r = await commit(); item?.classList.remove('pending'); return r; }
  catch (e) { item?.classList.remove('pending'); revert(); toast(`${error} (${e.message})`, 'err'); throw e; }
}

/** Mark a status tag as just changed (a short opacity settle; no stamp). */
export function stampChanged(el) {
  if (!el || reducedMotion()) return;
  el.animate([{ opacity: .3, transform: 'translateY(2px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE.settle });
}

// ---------- scores: ring, chip, numeral ----------
/**
 * Score ring (B §2). Fill fraction = score/100; colour from the quality ramp; tier cues: dotted track
 * below the bar, halo at the top tier; a mono label under it ("+23 over bar"). Count-up is opt-in:
 * pass { count: true } and call countUp(root) (never in the dossier).
 * @returns html markup with role="img" and an aria-label.
 */
let ringSeq = 0;
export function scoreRing(score, th = threshold(), { size = 96, label = true, count = false, decimals = 0, key = null } = {}) {
  const s = Number(score) || 0;
  const r = 50 - 3, C = 2 * Math.PI * r;
  const tier = qualityTier(s, th), col = qualityColor(s, th);
  const shown = decimals ? s.toFixed(decimals) : String(Math.round(s));
  const above = s >= th ? 'above' : 'below';
  // S7: a ring whose (key, value) already counted this session renders final markup (same as count:false), so a
  // revisit never shows '0' before snapping to the score
  const already = !!(count && key && hasCounted(key, shown));
  const counting = count && !already && !reducedMotion();
  const start = counting ? 0 : s;
  // S9: above the bar the arc runs from the threshold colour to the score colour (fill fraction stays the non-colour cue)
  const gid = `rg${++ringSeq}-${Math.random().toString(36).slice(2, 6)}`;
  const L = ringGradientLine(s);
  const grad = s >= th ? raw(`<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${L.x1}" y1="${L.y1}" x2="${L.x2}" y2="${L.y2}"><stop offset="0" stop-color="${qualityColor(th, th)}"/><stop offset="1" stop-color="${counting ? qualityColor(th, th) : col}"/></linearGradient></defs>`)
    : raw(`<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${L.x1}" y1="${L.y1}" x2="${L.x2}" y2="${L.y2}"><stop offset="0"/><stop offset="1"/></linearGradient></defs>`);
  const arcStroke = s >= th && !counting ? ` stroke:url(#${gid});` : '';
  return html`<span class="score-ring${size < 64 ? ' ring--sm' : ''}${counting ? ' is-counting' : ''}" role="img" aria-label="Score ${shown} of 100, ${above} your bar of ${th}" data-q="${counting ? qualityTier(0, th) : tier}" data-q-score="${s}" data-q-threshold="${th}" style="--ring-size:${size}px;--q:${counting ? qualityColor(0, th) : col}"${key ? raw(` data-count-key="${esc(key)}"`) : ''}>
    <svg viewBox="0 0 100 100" aria-hidden="true">${grad}<circle class="ring-track" cx="50" cy="50" r="${r}"/><circle class="ring-halo" cx="50" cy="50" r="${r + 4}"/><circle class="ring-arc" cx="50" cy="50" r="${r}" data-c="${C.toFixed(2)}" stroke-dasharray="${C.toFixed(2)}" style="stroke-dashoffset:${(C * (1 - Math.min(100, start) / 100)).toFixed(2)};${arcStroke}"/></svg>
    <span class="ring-num"${count && !already ? raw(` data-count-to="${s}" data-decimals="${decimals}"`) : ''} aria-hidden="true">${counting ? '0' : shown}</span>
    ${label ? html`<span class="ring-sub" aria-hidden="true">${qualityLabel(s, th)}</span>` : ''}
  </span>`;
}
/** Feed-style score chip with tiered non-colour cues (outline below the bar, solid at the top). Never counts. */
// S8: inline --qd = round(score) − threshold (clamped ±30) lets components.css ramp the fill inside each band.
export function scoreChip(score, th = threshold()) {
  const s = Number(score) || 0;
  const d = Math.round(s) - Math.round(Number(th) || 0), qd = Math.max(-30, Math.min(30, d));
  const band = d >= 15 ? 'top' : d >= 0 ? 'clears' : d >= -15 ? 'near' : 'below';
  return html`<span class="score-chip" data-q="${qualityTier(s, th)}" data-band="${band}" data-q-score="${s}" data-q-threshold="${th}" style="--q:${qualityColor(s, th)};--qd:${qd}" title="${qualityLabel(s, th)}"><span class="sr-only">Score </span>${Math.round(s)}</span>`;
}
/**
 * S9: topic pills for a story row. The first topic is blue (.chip--main) only when the story clears the bar;
 * below it the lead topic is neutral (.chip--lead). The rest are .chip--topic. Blue budget: B amendment 2.
 */
export function topicPills(topics = [], score, th = threshold(), { max = 2 } = {}) {
  const list = (topics || []).filter(Boolean).slice(0, max);
  if (!list.length) return '';
  const above = Math.round(Number(score) || 0) >= Number(th);
  return html`${list.map((t, k) => html`<span class="chip ${k === 0 ? (above ? 'chip--main' : 'chip--lead') : 'chip--topic'}">${t}</span>`)}`;
}
/** v3 score numeral (still used by v3 views). Final value in the markup; countUp() may animate it once. */
export function scoreNum(v, { dec = false, flap = false, from = null } = {}) {
  const n = Number(v) || 0;
  const shown = dec ? n.toFixed(1) : String(Math.round(n));
  void flap;
  return html`<b class="score-num" data-v="${n}" ${from != null ? html`data-from="${from}"` : ''} data-dec="${dec ? 1 : 0}"><span class="sr-only">Score ${shown}.</span><span class="int" aria-hidden="true">${shown}</span></b>`;
}
/** Retired (v3 ink bands). Kept so old imports resolve. */
export function inkBand() { return { w: 400, h: 0 }; }
export function inkStyle() { return ''; }

/**
 * Count numbers up the first time they're on screen (once per session per value; delegates to
 * motion.countTo). Handles v4 rings (`.ring-num[data-count-to]`) and v3 numerals (`.score-num[data-v]`).
 * Skips anything inside the dossier, Feed chips or [data-no-count].
 */
export function countUp(root = document) {
  const els = [...root.querySelectorAll('.ring-num[data-count-to]:not([data-counted]), .score-num[data-v]:not([data-counted])')]
    .filter(e => !e.closest('.dossier, .score-chip, [data-no-count]'));
  if (!els.length) return;
  const th = threshold();
  const start = (el) => {
    el.dataset.counted = '1';
    if (el.classList.contains('ring-num')) {
      const ring = el.closest('.score-ring');
      // the caption ("+23 over bar") stays hidden until the number lands (F)
      return countTo(el, Number(el.dataset.countTo), { ring, threshold: Number(ring?.dataset.qThreshold ?? th), decimals: Number(el.dataset.decimals || 0), key: ring?.dataset.countKey })
        .then(() => { ring?.classList.remove('is-counting'); if (ring) paintQuality(ring, Number(ring.dataset.qScore), Number(ring.dataset.qThreshold ?? th)); });
    }
    const int = el.querySelector('.int') || el;
    return countTo(int, Number(el.dataset.v), { threshold: th, from: Number(el.dataset.from ?? 0), decimals: el.dataset.dec === '1' ? 1 : 0, duration: 1100, key: el.closest('[data-count-key]')?.dataset.countKey });
  };
  if (!('IntersectionObserver' in window) || reducedMotion()) { els.forEach(start); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en, k) => { if (!en.isIntersecting) return; io.unobserve(en.target); setTimeout(() => start(en.target), Math.min(k, 6) * 90); });
  }, { threshold: .6 });
  els.forEach(e => io.observe(e));
}

/** Topics as chips: first (main) topic blue, the rest neutral (blue budget). */
export const topicsLine = (topics = [], max = 3) => topics.length
  ? html`<span class="topic-chips cluster">${topics.slice(0, max).map((t, k) => html`<span class="chip ${k === 0 ? 'chip--main' : 'chip--topic'}">${t}</span>`)}${topics.length > max ? html`<span class="chip chip--topic">+${topics.length - max}</span>` : ''}</span>` : '';

// ---------- skeletons (C: only after 120ms, held ≥320ms, breathing, no shimmer) ----------
const skHead = (display) => `<div class="sk-head" aria-hidden="true"><span class="sk sk-line" style="width:180px;height:11px"></span><span class="sk sk-line ${display ? 'display' : 'xl'}" style="width:min(720px,80%)"></span>${display ? '<span class="sk sk-line display" style="width:min(460px,55%)"></span>' : ''}<span class="sk sk-line lg" style="width:min(640px,70%);height:14px"></span></div>`;
const skTile = (lines = 3, h = 0, cls = '') => `<div class="tile tile--static ${cls}" style="${h ? `min-height:${h}px` : ''}"><span class="sk sk-line" style="width:120px;height:10px;margin-bottom:16px"></span>${Array.from({ length: lines }, (_, i) => `<span class="sk sk-line${i === 0 ? ' lg' : ''}" style="width:${[86, 72, 64, 48][i % 4]}%;margin-top:10px"></span>`).join('')}</div>`;
/** Skeleton shaped like the page for `key` (route). */
export function skeleton(key = '') {
  let body;
  if (key === 'today') body = `<div class="grid-12"><div class="col-7">${skTile(5, 360)}</div><div class="col-5 stack">${skTile(3, 172)}${skTile(3, 172)}</div><div class="col-5">${skTile(4, 240)}</div><div class="col-3">${skTile(3, 240)}</div><div class="col-4">${skTile(4, 240)}</div></div>`;
  else if (key === 'feed' || key === 'search') body = `<div class="tile tile--static tile--flush">${Array.from({ length: 7 }, () => `<div style="display:flex;gap:16px;padding:18px 20px;border-top:1px solid var(--line)"><span class="sk" style="width:44px;height:28px;border-radius:8px"></span><div style="flex:1"><span class="sk sk-line lg" style="width:62%"></span><span class="sk sk-line" style="width:84%;margin-top:10px"></span></div></div>`).join('')}</div>`;
  else if (key === 'map') body = `<div class="grid-12"><div class="col-8">${skTile(0, 560)}</div><div class="col-4">${skTile(6, 560)}</div></div>`;
  else body = `<div class="grid-12"><div class="col-8 stack">${skTile(4, 200)}${skTile(3, 160)}</div><div class="col-4 stack">${skTile(3, 140)}${skTile(3, 140)}</div></div>`;
  return `<div class="skeleton" aria-busy="true"><span class="sr-only">Loading…</span>${skHead(key === 'today')}${body}</div>`;
}
/** v3 name for the skeleton helper. */
export const galleyProof = skeleton;

// ---------- images (v3 "plates"): plain images with a neutral BlurHash placeholder ----------
const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const d83 = (s) => [...s].reduce((v, c) => v * 83 + B83.indexOf(c), 0);
const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const l2s = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255); };
const sp = (v, e) => Math.sign(v) * Math.abs(v) ** e;
export function decodeBlurhash(hash, w = 32, h = 32) {
  const size = d83(hash[0]), nx = (size % 9) + 1, ny = Math.floor(size / 9) + 1;
  const maxV = (d83(hash[1]) + 1) / 166;
  const colors = [];
  for (let i = 0; i < nx * ny; i++) {
    if (i === 0) { const v = d83(hash.slice(2, 6)); colors.push([s2l(v >> 16), s2l((v >> 8) & 255), s2l(v & 255)]); }
    else { const v = d83(hash.slice(4 + i * 2, 6 + i * 2)); colors.push([Math.floor(v / 361), Math.floor(v / 19) % 19, v % 19].map(q => sp((q - 9) / 9, 2) * maxV)); }
  }
  const lum = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const basis = Math.cos(Math.PI * x * i / w) * Math.cos(Math.PI * y * j / h), c = colors[i + j * nx];
      r += c[0] * basis; g += c[1] * basis; b += c[2] * basis;
    }
    lum[y * w + x] = 0.2126 * l2s(r) + 0.7152 * l2s(g) + 0.0722 * l2s(b);
  }
  return lum;
}
const plateCache = new Map();
/** Data URL of a soft luminance placeholder tinted to the current theme's inset/ink. */
export function plateUrl(hash) {
  const night = document.documentElement.dataset.theme === 'night';
  const k = `${hash}|${night}`;
  if (plateCache.has(k)) return plateCache.get(k);
  const w = 32, h = 32, lum = decodeBlurhash(hash, w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  const cs = getComputedStyle(document.documentElement);
  const parse = (v) => { const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v); return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128]; };
  const lo = parse(cs.getPropertyValue('--fd-ink')), hi = parse(cs.getPropertyValue('--fd-bg'));
  for (let p = 0; p < w * h; p++) { const t = lum[p] / 255; for (let ch = 0; ch < 3; ch++) img.data[p * 4 + ch] = lo[ch] + (hi[ch] - lo[ch]) * (0.35 + 0.65 * t); img.data[p * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  plateCache.set(k, url);
  return url;
}
/** Markup for an image with a placeholder; call hydratePlates(root) after insertion. */
export function plateImg(file, { alt = '', ar = null, cls = '' } = {}) {
  return html`<span class="plate ${cls}" data-plate="${file}" style="${ar ? `aspect-ratio:${ar}` : ''}"><img src="/media/${file}" alt="${alt}" loading="lazy" decoding="async"></span>`;
}
export function hydratePlates(root = document) {
  root.querySelectorAll('.plate[data-plate]:not([data-hyd])').forEach(async (el) => {
    el.dataset.hyd = '1';
    const img = el.querySelector('img');
    const show = () => img.classList.add('in');
    if (img.complete && img.naturalWidth) show(); else img.addEventListener('load', show, { once: true });
    try {
      const r = await fetch(`/api/plate?file=${encodeURIComponent(el.dataset.plate)}`).then(x => x.ok ? x.json() : null);
      if (r?.ar && !el.style.aspectRatio) el.style.aspectRatio = String(r.ar);
      if (r?.blurhash && !img.classList.contains('in')) el.style.backgroundImage = `url(${plateUrl(r.blurhash)})`;
    } catch (e) { /* placeholder is decoration only */ }
  });
}

// ---------- strike + fold away, with undo ----------
/**
 * Strike a row through, fold it out of the list, and offer Undo. `commit` runs when the undo window ends.
 */
export function strikeOut(row, { message = 'Removed.', commit, onUndo } = {}) {
  const parent = row.parentNode, next = row.nextSibling;
  row.classList.add('struck');
  const fold = () => {
    if (!row.isConnected) return;
    const h = row.getBoundingClientRect().height;
    const followers = [];
    for (let s = row.nextElementSibling; s && followers.length < 12; s = s.nextElementSibling) followers.push(s);
    row.remove();
    if (!reducedMotion()) followers.forEach(f => f.animate([{ transform: `translateY(${h}px)` }, { transform: 'none' }], { duration: 240, easing: EASE.move }));
  };
  const t = setTimeout(fold, reducedMotion() ? 0 : 260);
  toast(message, '', {
    undo: {
      commit: async () => { try { await commit?.(); } catch (e) { parent.insertBefore(row, next); row.classList.remove('struck'); toast(`That didn’t save — it has been put back. (${e.message})`, 'err'); } },
      revert: () => { clearTimeout(t); if (!row.isConnected) parent.insertBefore(row, next); row.classList.remove('struck'); if (!reducedMotion()) row.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE.settle }); onUndo?.(); }
    }
  });
}

// ---------- micro-interactions kept from v3 (restyled): hold-to-publish, stage marks, working indicator ----------
let uid = 0;
/**
 * Hold-to-confirm button. A fill crosses the button while a pointer, Space or Enter is held; letting go
 * early rolls it back. On completion `onComplete()` runs: return/resolve `false` to roll back. Plain
 * clicks never fire the action. Returns { reset, destroy }.
 */
export function holdToPress(button, { ms = 900, onComplete, hint = 'Hold to publish', doneLabel = 'Published', busyLabel = 'Publishing…', failLabel = 'Not published', releaseMs = 200 } = {}) {
  if (!button) return null;
  if (button._hold) return button._hold;
  const original = button.innerHTML;
  const hintId = `hp-hint-${++uid}`;
  button.dataset.hold = '';
  button.classList.add('hold-press');
  button.innerHTML = `<span class="hp-fill" aria-hidden="true"></span><span class="hp-label">${original}</span>`;
  const label = button.querySelector('.hp-label');
  const hintEl = document.createElement('span');
  hintEl.className = 'hp-hint'; hintEl.id = hintId; hintEl.textContent = hint;
  button.after(hintEl);
  button.setAttribute('aria-describedby', [button.getAttribute('aria-describedby'), hintId].filter(Boolean).join(' '));
  let phase = 'idle', input = null, pointerId = null, rect = null, started = 0, p = 0, raf = 0, timer = 0, hintTimer = 0;
  const paint = () => button.style.setProperty('--hp-p', p.toFixed(4));
  const say = (text, revertMs) => { clearTimeout(hintTimer); hintEl.textContent = text; if (revertMs) hintTimer = setTimeout(() => { if (phase === 'idle') hintEl.textContent = hint; }, revertMs); };
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const drive = (to, duration, ease) => {
    cancelAnimationFrame(raf);
    const from = p, t0 = performance.now();
    const step = (now) => { const t = duration > 0 ? Math.min(1, (now - t0) / duration) : 1; p = from + (to - from) * ease(t); paint(); raf = t < 1 ? requestAnimationFrame(step) : 0; };
    raf = requestAnimationFrame(step);
  };
  const complete = async () => {
    if (phase !== 'holding' || performance.now() - started < ms - 50) return;
    phase = 'busy'; cancelAnimationFrame(raf); p = 1; paint();
    if (pointerId != null) { try { button.releasePointerCapture(pointerId); } catch (e) { /* released */ } pointerId = null; }
    navigator.vibrate?.(10);
    button.classList.remove('holding'); button.setAttribute('aria-busy', 'true'); say(busyLabel);
    let ok;
    try { ok = await onComplete?.(); } catch (e) { ok = false; }
    button.removeAttribute('aria-busy');
    if (!button.isConnected) return;
    if (ok === false) { phase = 'idle'; if (reducedMotion()) { p = 0; paint(); } else drive(0, releaseMs, easeOut); say(`${failLabel}. ${hint} to try again.`, 4000); return; }
    phase = 'done'; button.classList.add('done'); button.setAttribute('aria-disabled', 'true');
    label.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>${esc(doneLabel)}`;
    say(doneLabel);
  };
  const begin = (kind) => {
    if (phase !== 'idle' || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    phase = 'holding'; input = kind; started = performance.now(); rect = button.getBoundingClientRect();
    button.classList.add('holding'); say('Keep holding…');
    if (reducedMotion()) { p = 0; paint(); } else drive(1, ms * (1 - p), t => t);
    clearTimeout(timer); timer = setTimeout(complete, ms + 20);
    return true;
  };
  const release = (early = true) => {
    if (phase !== 'holding') return;
    clearTimeout(timer); phase = 'idle'; input = null; button.classList.remove('holding');
    if (reducedMotion()) { p = 0; paint(); } else drive(0, releaseMs, easeOut);
    if (early) say(`${hint}: keep holding until the bar fills`, 2600);
  };
  const endPointer = (e) => { if (e.pointerId !== pointerId) return; try { if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ } pointerId = null; release(); };
  const handlers = {
    pointerdown: (e) => { if (e.button !== 0 || !e.isPrimary || pointerId != null) return; if (!begin('pointer')) return; pointerId = e.pointerId; try { button.setPointerCapture(e.pointerId); } catch (err) { /* n/a */ } },
    pointerup: endPointer, pointercancel: endPointer, lostpointercapture: endPointer,
    pointermove: (e) => { if (e.pointerId !== pointerId || !rect) return; if (e.clientX < rect.left - 10 || e.clientX > rect.right + 10 || e.clientY < rect.top - 10 || e.clientY > rect.bottom + 10) endPointer(e); },
    contextmenu: (e) => { if (phase === 'holding') e.preventDefault(); },
    keydown: (e) => { if (e.key === 'Escape') { if (input === 'key') release(); return; } if (e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault(); if (!e.repeat) begin('key'); },
    keyup: (e) => { if (e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault(); if (input === 'key') release(); },
    blur: () => release(),
    click: (e) => { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  for (const [k, fn] of Object.entries(handlers)) button.addEventListener(k, fn, k === 'click');
  const cancel = () => release();
  const onVis = () => { if (document.hidden) release(); };
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', onVis);
  const ctl = {
    reset() { clearTimeout(timer); cancelAnimationFrame(raf); phase = 'idle'; p = 0; paint(); button.classList.remove('holding', 'done'); button.removeAttribute('aria-disabled'); label.innerHTML = original; say(hint); },
    destroy() {
      ctl.reset();
      for (const [k, fn] of Object.entries(handlers)) button.removeEventListener(k, fn, k === 'click');
      window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', onVis);
      hintEl.remove(); button.innerHTML = original; button.classList.remove('hold-press'); delete button.dataset.hold; delete button._hold;
    }
  };
  button._hold = ctl;
  return ctl;
}

const MARK_STATES = { pending: 'pending', queued: 'pending', skipped: 'pending', running: 'running', done: 'done', ok: 'done', complete: 'done', failed: 'error', error: 'error', cancelled: 'error' };
const MARK_SPOKEN = { pending: 'Pending', running: 'In progress', done: 'Done', error: 'Failed' };
/** Run-stage mark in `el`: pending (dashed ring), running (turning arc), done (check), error (cross). */
export function statusMark(el, state) {
  if (!el) return null;
  const s = MARK_STATES[state] || 'pending';
  let m = el.querySelector(':scope > .status-mark');
  if (!m) {
    m = document.createElement('span');
    m.className = 'status-mark'; m.setAttribute('role', 'img');
    m.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle class="sm-ring" cx="12" cy="12" r="8.5"/><path class="sm-check" d="M8 12.5l2.8 2.8L16.5 9.5"/><path class="sm-cross" d="M9 9l6 6M15 9l-6 6"/></svg>';
    el.append(m);
  }
  m.dataset.state = s;
  m.setAttribute('aria-label', MARK_SPOKEN[s]);
  return m;
}
/** Small working indicator appended to `container`. Returns { el, done(), error(), stop() }. */
export function lattice(container, { label = 'Working' } = {}) {
  const el = document.createElement('span');
  el.className = 'spinner'; el.dataset.status = 'working'; el.setAttribute('role', 'status');
  el.innerHTML = `<i aria-hidden="true"></i><span class="sr-only">${esc(label)}, in progress</span>`;
  container?.append(el);
  const settle = (st, text) => { if (el.dataset.status !== 'working') return ctl; el.dataset.status = st; el.querySelector('.sr-only').textContent = text; return ctl; };
  const ctl = { el, done: (t = 'Done') => settle('done', t), error: (t = 'Failed') => settle('error', t), stop: () => el.remove() };
  return ctl;
}

// Per-view stylesheet loader: views call `await useStyle('/css/v4/<tab>.css')` before rendering,
// so the page never paints unstyled. Each href is linked once; the promise is cached.
const styleLoads = new Map();
export function useStyle(href) {
  if (styleLoads.has(href)) return styleLoads.get(href);
  const p = new Promise((resolve) => {
    const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
    if (existing) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href;
    link.onload = () => resolve(); link.onerror = () => resolve();
    document.head.append(link);
  });
  styleLoads.set(href, p);
  return p;
}
