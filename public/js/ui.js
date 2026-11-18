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
    let y0 = 0, dy = 0, t0 = 0, dragging = false;
    el.addEventListener('pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      if (e.pointerType === 'mouse' || (el.scrollTop > 0 && e.clientY - r.top > 44)) return;
      dragging = true; y0 = e.clientY; t0 = performance.now(); el.setPointerCapture(e.pointerId); el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const raw = e.clientY - y0;
      dy = raw > 0 ? raw : raw * .2;
      el.style.setProperty('--drag', `${dy}px`);
      wrap.style.setProperty('--p', String(Math.max(0, Math.min(1, dy / el.offsetHeight))));
    });
    el.addEventListener('pointerup', () => {
      if (!dragging) return; dragging = false; el.classList.remove('dragging');
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > 120 || v > .6) close();
      else { el.classList.add('spring'); el.style.setProperty('--drag', '0px'); wrap.style.setProperty('--p', '0'); setTimeout(() => el.classList.remove('spring'), 280); }
      dy = 0;
    });
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
      if (done) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="done-mark">✓ ${esc(done)}</span>`; btn.classList.add('done'); setTimeout(() => { if (btn.isConnected) { btn.innerHTML = btn.dataset.label; btn.classList.remove('done'); } }, 900); }
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
  return html`<b class="score-num${flap ? ' flap' : ''}" data-v="${n}" ${from != null ? html`data-from="${from}"` : ''} style="${inkStyle(n, t)}" aria-label="Score ${shown}"><span class="int" aria-hidden="true">${i}</span>${d ? html`<span class="dec" aria-hidden="true">.${d}</span>` : ''}</b>`;
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
  if (reducedMotion()) { els.forEach(e => e.dataset.counted = '1'); return; }
  const start = (el) => {
    if (active >= 8) { queue.push(el); return; }
    active++;
    const to = Number(el.dataset.v), from = Number(el.dataset.from ?? 0);
    const intEl = el.querySelector('.int'), decEl = el.querySelector('.dec');
    const dur = Math.min(500 + Math.abs(to - from) * 4, 900), t0 = performance.now();
    let band = -1;
    el.classList.add('counting');
    const frame = (now) => {
      const x = Math.min(1, (now - t0) / dur), e = 1 - (1 - x) ** 4;
      const cur = from + (to - from) * e;
      const txt = String(Math.round(x < 1 ? Math.floor(cur) : Math.round(to)));
      if (el.classList.contains('flap') && intEl.textContent !== txt) { intEl.classList.remove('tick'); void intEl.offsetWidth; intEl.classList.add('tick'); }
      intEl.textContent = x < 1 ? txt : intEl.textContent.length && decEl ? String(Math.trunc(to)) : String(Math.round(to));
      const b = inkBand(cur, t), key = b.w * 1000 + b.h;
      if (key !== band) { band = key; el.style.setProperty('--w', b.w); el.style.setProperty('--heat', `${b.h}%`); }
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
  els.forEach(e => io.observe(e));
}

/** Topics as run-in text ("AGENT ORCHESTRATION · EVALUATION"), not chips. */
export const topicsLine = (topics = [], max = 3) => topics.length
  ? html`<span class="topics">${topics.slice(0, max).map((t, k) => html`${k ? html`<i>·</i>` : ''}${t}`)}${topics.length > max ? html`<i>·</i>+${topics.length - max}` : ''}</span>` : '';

