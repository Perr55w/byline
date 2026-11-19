import { developPlates } from './fx/surface.js';
// Shared UI helpers. Views build HTML with the `html` tag (auto-escaped) and wire events with `on`.

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

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isSheet = () => matchMedia('(max-width: 760px) and (pointer: coarse)').matches;
/** True when the keyboard event belongs to a text field (single-key shortcuts must ignore it). */
export const inField = (e) => !!(e.target.closest && e.target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

/** Remove an element after its exit animation (with a timeout fallback). */
function exitThen(el, cls, ms, done) {
  if (reducedMotion()) { done(); return; }
  el.classList.add(cls);
  let finished = false;
  const fin = () => { if (!finished) { finished = true; done(); } };
  el.addEventListener('animationend', fin, { once: true });
  setTimeout(fin, ms + 120);
}

// ---------- toasts: wire-in, wire-out, optional undo with a draining bar ----------
let liveUndo = null;
export function toast(msg, kind = '', { undo = null, ms } = {}) {
  const holder = document.createElement('div');
  holder.className = 'toast-slot';
  const el = document.createElement('div');
  el.className = `toast ${kind}${undo ? ' has-undo' : ''}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = msg;
  el.append(text);
  const life = ms || (undo ? 6000 : kind === 'err' ? 7000 : 3800);
  el.style.setProperty('--ms', `${life}ms`);
  holder.append(el);
  document.getElementById('toasts').append(holder);
  let timer, left = life, started = Date.now(), gone = false;
  const close = () => {
    if (gone) return; gone = true; clearTimeout(timer);
    if (liveUndo?.el === el) liveUndo = null;
    exitThen(el, 'out', 180, () => { holder.classList.add('collapse'); setTimeout(() => holder.remove(), 170); });
  };
  const run = () => { started = Date.now(); timer = setTimeout(() => { if (undo?.commit) undo.commit(); close(); }, left); };
  const pause = () => { clearTimeout(timer); left -= Date.now() - started; el.classList.add('paused'); };
  const resume = () => { el.classList.remove('paused'); run(); };
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
  // swipe right/down to dismiss on touch
  let sx = 0, sy = 0, dx = 0;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || e.target.closest('button')) return; sx = e.clientX; sy = e.clientY; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); });
  el.addEventListener('pointermove', (e) => { if (!el.classList.contains('dragging')) return; dx = Math.max(0, e.clientX - sx, (e.clientY - sy)); el.style.transform = `translateX(${dx}px)`; el.style.opacity = String(Math.max(.2, 1 - dx / 160)); });
  el.addEventListener('pointerup', () => { if (!el.classList.contains('dragging')) return; el.classList.remove('dragging'); if (dx > 80) { if (undo?.commit) undo.commit(); close(); } else { el.style.transform = ''; el.style.opacity = ''; } dx = 0; });
  run();
  return { close };
}
document.addEventListener('visibilitychange', () => { /* toasts keep their own timers; undo windows pause while hidden */
  document.querySelectorAll('.toast.has-undo').forEach(t => t.classList.toggle('paused', document.hidden));
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && liveUndo && !inField(e)) { e.preventDefault(); liveUndo.doUndo(); }
});

// ---------- modal: proof sheet on desktop, swipeable bottom sheet on phone, closes with system back ----------
export function modal(content, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `modal-wrap${isSheet() ? ' as-sheet' : ''}`;
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" tabindex="-1">${content}</div>`;
  const el = wrap.querySelector('.modal');
  const opener = document.activeElement;
  let closed = false, pushed = false;
  const finish = () => { wrap.remove(); onClose?.(); opener?.focus?.(); };
  const close = (fromHistory = false) => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    if (pushed && !fromHistory) history.back();
    exitThen(wrap, 'out', 200, finish);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onPop = () => close(true);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  if (isSheet()) {
    // predictive back: a history entry per sheet so the system back gesture closes it
    history.pushState({ sheet: Date.now() }, ''); pushed = true;
    window.addEventListener('popstate', onPop);
    // a real grip (touch-action: none) owns the drag; the sheet body keeps native scrolling
    const grip = document.createElement('div');
    grip.className = 'sheet-grip'; grip.setAttribute('aria-hidden', 'true');
    el.prepend(grip);
    let y0 = 0, dy = 0, t0 = 0, dragging = false, samples = [];
    el.addEventListener('animationend', (ev) => { if (ev.target === el) el.classList.add('settled'); });
    const settle = () => { el.classList.add('spring'); el.style.setProperty('--drag', '0px'); wrap.style.setProperty('--p', '0'); setTimeout(() => el.classList.remove('spring'), 280); };
    grip.addEventListener('pointerdown', (e) => {
      dragging = true; dy = 0; y0 = e.clientY; t0 = performance.now(); samples = [[t0, 0]]; el.classList.add('settled'); grip.setPointerCapture(e.pointerId); el.classList.add('dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const raw = e.clientY - y0;
      dy = raw > 0 ? raw : raw * .2;
      const now = performance.now(); samples.push([now, dy]); while (samples.length > 2 && now - samples[0][0] > 80) samples.shift();
      el.style.setProperty('--drag', `${dy}px`);
      wrap.style.setProperty('--p', String(Math.max(0, Math.min(1, dy / el.offsetHeight))));
    });
    const end = (cancelled) => {
      if (!dragging) return; dragging = false; el.classList.remove('dragging');
      const [ta, ya] = samples[0] || [t0, 0], [tb, yb] = samples[samples.length - 1] || [t0, dy];
      const v = (yb - ya) / Math.max(1, tb - ta);
      if (!cancelled && (dy > 120 || v > .6)) close(); else settle();
      dy = 0;
    };
    grip.addEventListener('pointerup', () => end(false));
    grip.addEventListener('pointercancel', () => end(true));
  }
  document.body.append(wrap);
  requestAnimationFrame(() => el.focus({ preventScroll: true }));
  return { el, close: () => close() };
}

export function confirmBox(message, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const m = modal(String(html`<h2>Please confirm</h2><p class="muted">${message}</p><div class="row" style="justify-content:flex-end;margin-top:18px"><button data-close>Cancel</button><button class="primary" id="ok">${okLabel}</button></div>`));
    m.el.querySelector('#ok').onclick = () => { m.close(); resolve(true); };
    m.el.parentElement.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m.el.parentElement) resolve(false); });
  });
}

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

export const status = (s) => html`<span class="status ${s}">${(s || '').replace('_', ' ')}</span>`;
export const evChip = (k) => html`<span class="chip ev-${k}">${({ announcement: 'Announcement', reporting: 'Independent reporting', research: 'Research', commentary: 'Commentary', community: 'Community / industry climate', application: 'Applied practice', own_work: 'My project' })[k] || k}</span>`;
/** A headline whose last word is glued to the DEMO flag, so the flag never strands a word. */
export const titleWithFlag = (title, demo) => { if (!demo) return html`${title}`; const i = String(title).lastIndexOf(' '); return html`${String(title).slice(0, i + 1)}<span class="nowrap">${String(title).slice(i + 1)}${demoFlag(true)}</span>`; };
export const demoFlag = (on) => on ? html`<span class="demo-flag" title="Fictional sample data">DEMO</span>` : '';
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
    load('Schibsted Grotesk', 'schibsted-grotesk.woff2', 'font-weight:400 900;'), load('Martian Mono', 'martian-mono.woff2', 'font-weight:100 800;font-stretch:75% 112.5%;')])).join('');
  return fontFaces;
}

/** Rasterize an SVG (markup or URL) to a PNG blob in the browser, with fonts embedded. */
export async function svgToPng(svgOrUrl, w = 1200, h = 1200) {
  let svgText = svgOrUrl.trim().startsWith('<') ? svgOrUrl : await (await fetch(svgOrUrl)).text();
  if (!svgText.includes('@font-face')) svgText = svgText.replace(/<svg([^>]*)>/, `<svg$1><style>${await fontFaceCss()}</style>`);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  await new Promise(r => setTimeout(r, 60)); // let embedded fonts settle before drawing
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

/** Run an async action bound to a button: bottom-edge press bar while busy, a stamp on success, a correction toast on failure. */
export async function act(btn, fn, label, { done } = {}) {
  setBusy(btn, true, label);
  const slow = setTimeout(() => document.getElementById('pressbar')?.classList.add('on'), 300);
  try {
    const r = await fn();
    if (btn && btn.isConnected) {
      setBusy(btn, false);
      if (done) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="done-mark">✓ ${esc(done)}</span>`; btn.classList.add('done'); import('./fx/micro.js').then(m => m.spatter(btn)).catch(() => {}); setTimeout(() => { if (btn.isConnected) { btn.innerHTML = btn.dataset.label; btn.classList.remove('done'); } }, 900); }
    }
    return r;
  } catch (e) { toast(e.message, 'err'); }
  finally { clearTimeout(slow); document.getElementById('pressbar')?.classList.remove('on'); if (btn?.isConnected && btn.hasAttribute('aria-busy')) setBusy(btn, false); }
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

/** Mark a status stamp as just changed so it lands with the stamp + ink-bleed animation. */
export function stampChanged(el) { if (!el) return; el.classList.remove('just'); void el.offsetWidth; el.classList.add('just'); setTimeout(() => el.classList.remove('just'), 600); }

export const pct = (v) => Math.round((v || 0) * 100);

/**
 * Score numeral. Renders the final value for assistive tech and no-JS; countUp() animates the visible digits.
 * opts.dec: show tenths (single-number places only); opts.flap: per-digit flap display (Feed).
 */
export function scoreNum(v, { dec = false, flap = false, from = null } = {}) {
  const n = Number(v) || 0;
  const shown = dec ? n.toFixed(1) : String(Math.round(n));
  const [i, d] = shown.split('.');
  const t = (window.__byline?.threshold) ?? 55;
  return html`<b class="score-num${flap ? ' flap' : ''}" data-v="${n}" ${from != null ? html`data-from="${from}"` : ''} style="${inkStyle(reducedMotion() ? n : Number(from ?? 0), t)}" ><span class="sr-only">Score ${shown}.</span><span class="int" aria-hidden="true" data-final="${i}">${reducedMotion() ? i : String(Math.round(Number(from ?? 0)))}</span>${d ? html`<span class="dec" aria-hidden="true">.${d}</span>` : ''}</b>`;
}

/** Stepped ink density: Martian weight and red-pencil mix in 5 bands, driven by value vs threshold. */
export function inkBand(v, t = 55) {
  const heat = Math.max(0, Math.min(1, (v - (t - 15)) / 30));
  const weight = Math.max(0, Math.min(1, (v - 30) / 50));
  return { w: 300 + 125 * Math.round(weight * 4), h: Math.round(heat * 4) * 25 };
}
export function inkStyle(v, t = 55) { const b = inkBand(v, t); return `--w:${b.w};--heat:${b.h}%`; }

/**
 * Count Tier-A numbers up the first time they're on screen. Digits change every frame;
 * ink steps through 5 bands. Max 8 concurrent; reduced motion shows the final state.
 */
let active = 0;
const queue = [];
export function countUp(root = document) {
  const els = [...root.querySelectorAll('.score-num[data-v]:not([data-counted])')];
  if (!els.length) return;
  const t = (window.__byline?.threshold) ?? 55;
  const caretOf = (el) => el.closest('.score')?.querySelector('.galley-scale .caret');
  if (reducedMotion()) { els.forEach(e => { e.dataset.counted = '1'; const ii = e.querySelector('.int'); if (ii?.dataset.final) ii.textContent = ii.dataset.final; const c = caretOf(e); if (c) c.style.transform = `translateX(${Math.min(100, Number(e.dataset.v))}%)`; e.closest('.score')?.classList.add('landed'); }); return; }
  const start = (el) => {
    if (active >= 8) { queue.push(el); return; }
    active++;
    const to = Number(el.dataset.v), from = Number(el.dataset.from ?? 0);
    const intEl = el.querySelector('.int'), finalInt = intEl.dataset.final || (intEl.dataset.final = intEl.textContent);
    const dur = Math.min(500 + Math.abs(to - from) * 4, 900), t0 = performance.now();
    let band = -1;
    const caret = caretOf(el);
    el.classList.add('counting');
    const frame = (now) => {
      const x = Math.min(1, (now - t0) / dur), e = 1 - (1 - x) ** 4;
      const cur = from + (to - from) * e;
      const txt = String(Math.round(x < 1 ? Math.floor(cur) : Math.round(to)));
      if (el.classList.contains('flap') && intEl.textContent !== txt && !(el.__lastTick > now - 70)) { el.__lastTick = now; intEl.animate([{ transform: 'scaleY(.6)' }, { transform: 'none' }], { duration: 90, easing: 'steps(2, end)' }); }
      intEl.textContent = x < 1 ? txt : finalInt;
      const b = inkBand(cur, t), key = b.w * 1000 + b.h;
      if (key !== band) { band = key; el.style.setProperty('--w', b.w); el.style.setProperty('--heat', `${b.h}%`); }
      if (caret) caret.style.transform = `translateX(${Math.min(100, cur)}%)`;
      if (x < 1) requestAnimationFrame(frame);
      else {
        el.style.cssText = inkStyle(to, t); el.classList.remove('counting'); el.classList.add('landed');
        el.dispatchEvent(new CustomEvent('counted', { bubbles: true, detail: { value: to, threshold: t } }));
        active--; if (queue.length) start(queue.shift());
      }
    };
    intEl.textContent = String(Math.round(from));
    requestAnimationFrame(frame);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en, k) => { if (!en.isIntersecting) return; io.unobserve(en.target); const el = en.target; el.dataset.counted = '1'; setTimeout(() => start(el), Math.min(k, 6) * 60); });
  }, { threshold: .6 });
  els.forEach(e => { const i = e.querySelector('.int'); if (i && !i.dataset.final) { i.dataset.final = i.textContent; i.textContent = String(Math.round(Number(e.dataset.from ?? 0))); } io.observe(e); });
}

/** Topics as run-in text ("AGENT ORCHESTRATION · EVALUATION"), not chips. */
export const topicsLine = (topics = [], max = 3) => topics.length
  ? html`<span class="topics">${topics.slice(0, max).map((t, k) => html`${k ? html`<i>·</i>` : ''}<span class="t">${t}</span>`)}${topics.length > max ? html`<i>·</i>+${topics.length - max}` : ''}</span>` : '';


// ---------- galley-proof skeletons (shown only when a tab takes longer than 200ms) ----------
export function galleyProof(key = '') {
  const head = '<div class="g-kick"></div><div class="g-h1"></div><div class="g-rule"></div>';
  const meters = '<div class="g-meters"><i></i><i></i><i></i><i></i></div>';
  let body;
  if (key === 'feed') body = Array.from({ length: 5 }, () => `<div class="g-row g-left"><div class="g-num"></div><div><div class="g-line t"></div><div class="g-line s"></div>${meters}</div></div>`).join('');
  else if (key === 'today') body = `<div class="g-lead"><div><div class="g-line g-big"></div><div class="g-line g-big" style="width:48%"></div><div class="g-line"></div><div class="g-line s"></div></div><div class="g-num g-num-lg"></div></div>
    <div class="g-fold">${Array.from({ length: 4 }, () => '<div class="g-row g-right"><div><div class="g-line t"></div><div class="g-line s"></div></div><div class="g-num"></div></div>').join('')}</div>`;
  else body = Array.from({ length: 4 }, () => '<div class="g-row g-plain"><div><div class="g-line t"></div><div class="g-line"></div><div class="g-line s"></div></div></div>').join('');
  return `<div class="galley" aria-busy="true"><span class="sr-only">Setting type…</span>${head}${body}</div>`;
}

// ---------- halftone plates: BlurHash decoded to luminance, real image develops over it ----------
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
/** Data URL of a luminance plate tinted to the current desk (ink on paper). */
export function plateUrl(hash) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const k = `${hash}|${dark}`;
  if (plateCache.has(k)) return plateCache.get(k);
  const w = 32, h = 32, lum = decodeBlurhash(hash, w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  const ink = dark ? [31, 28, 22] : [28, 26, 22], paper = dark ? [120, 112, 98] : [234, 227, 213];
  for (let p = 0; p < w * h; p++) { const t = lum[p] / 255; for (let ch = 0; ch < 3; ch++) img.data[p * 4 + ch] = ink[ch] + (paper[ch] - ink[ch]) * t; img.data[p * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  plateCache.set(k, url);
  return url;
}
/** Markup for an image on a halftone plate; call hydratePlates(root) after insertion. */
export function plateImg(file, { alt = '', ar = null, cls = '' } = {}) {
  return html`<span class="plate ${cls}" data-plate="${file}" style="${ar ? `aspect-ratio:${ar}` : ''}"><img src="/media/${file}" alt="${alt}" loading="lazy" decoding="async"></span>`;
}
export function hydratePlates(root = document) {
  developPlates(root);
  root.querySelectorAll('.plate[data-plate]:not([data-hyd])').forEach(async (el) => {
    el.dataset.hyd = '1';
    const img = el.querySelector('img');
    const show = () => img.classList.add('in');
    if (img.complete && img.naturalWidth) show(); else img.addEventListener('load', show, { once: true });
    try {
      const r = await fetch(`/api/plate?file=${encodeURIComponent(el.dataset.plate)}`).then(x => x.ok ? x.json() : null);
      if (r?.ar && !el.style.aspectRatio) el.style.aspectRatio = String(r.ar);
      if (r?.blurhash && !img.classList.contains('in')) el.style.backgroundImage = `url(${plateUrl(r.blurhash)})`;
    } catch (e) { /* plate is decoration only */ }
  });
}

// ---------- correction strike + fold away, with undo ----------
/**
 * Strike a row through, fold it out of the list, and offer Undo. `commit` runs when the undo window ends.
 * `revert` (optional) runs if the commit fails or after undo restores the row.
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
    if (!reducedMotion()) followers.forEach(f => f.animate([{ transform: `translateY(${h}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.65,0,.35,1)' }));
  };
  const t = setTimeout(fold, reducedMotion() ? 0 : 260);
  toast(message, '', {
    undo: {
      commit: async () => { try { await commit?.(); } catch (e) { parent.insertBefore(row, next); row.classList.remove('struck'); toast(`That didn’t save — it has been put back. (${e.message})`, 'err'); } },
      revert: () => { clearTimeout(t); if (!row.isConnected) parent.insertBefore(row, next); row.classList.remove('struck'); if (!reducedMotion()) row.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' }); onUndo?.(); }
    }
  });
}
