// Story dossier: the overlay FRAME (C §3, E §3, D §5). A floating glass panel inset to the rail's top and
// bottom whose `left` follows the registered --rail-w, so collapsing the rail reflows it live.
// The frame owns: open/close, the FLIP flight (clip-path on the panel + shared elements), the scrim,
// background 'still' mode, focus trap, Esc, focus return, the phone full-height sheet with drag-to-dismiss.
// CONTENT is rendered by a registered renderer:
//
//   registerDossierRenderer(async (body, ctx) => { ... })
//     body: the <article class="dossier-body"> to fill
//     ctx:  { id, data /* GET /api/stories/:id?mark_viewed=0 */, close(), phase: 'open' | 'swap' }
//     Mark shared elements so they fly from the source: data-shared="title" | "ring" | "topic".
//     Mark body sections with data-dossier-section (they fade/rise in after the flight starts).
//     The panel's heading must be an h1 (it labels the dialog and receives focus).
//     Return { afterFlight() } (optional) to render below-fold sections once the flight has landed.
//
// Sources mark shared elements the same way (data-shared="title|ring|topic" inside the clicked tile/row).
// App wiring: app.js calls open(id, srcEl) for #/story/:id and close() when the hash leaves it.

import { api } from './api.js';
import { html, raw, esc, icon, scoreRing, trapFocus, fmtDate, evLabel, demoFlag, toast, act, threshold } from './ui.js';
import { EASE, DUR, reduced } from './motion.js';
import bg from './bg.js';

let renderer = null;
/** Install the dossier content renderer (the dossier builder calls this once). */
export function registerDossierRenderer(fn) { renderer = typeof fn === 'function' ? fn : null; }

const S = { open: false, closing: false, id: null, root: null, panel: null, body: null, src: null, srcShared: [], opener: null, anims: [], seq: 0, onRequestClose: null, keyHandler: null };
export const isOpen = () => S.open;
export const currentId = () => S.id;
/** app.js: how a close request (Esc, ×, scrim, swipe) becomes a history change. */
export function onRequestClose(fn) { S.onRequestClose = fn; }

const phone = () => matchMedia('(max-width: 760px)').matches;
const collapsed = () => document.documentElement.classList.contains('rail-collapsed');
const load = (id) => api.get(`/stories/${id}?mark_viewed=0`);
const ric = window.requestIdleCallback ? (f, o) => requestIdleCallback(f, o) : (f) => setTimeout(() => f({ timeRemaining: () => 8, didTimeout: true }), 60);

// ------------------------------------------------------------------ prefetch + idle prebuild (S3)
// prefetch(id) warms the data; once it resolves, an idle callback renders the whole 'open' dossier into a hidden,
// attached, contain:strict root at the final geometry, measures the shared destinations there, then detaches it.
// open() re-appends that root and starts the flight with zero layout reads after the insert. LRU of 3.
const ready = new Map();           // id → story payload (resolved)
const PRE = new Map();             // id → { root, rects, key, after }
const PRE_MAX = 3;
const geomKey = () => `${innerWidth}x${innerHeight}:${collapsed() ? 'c' : 'e'}:${phone() ? 'p' : 'd'}`;
const pending = new Set();
/** Warm the story (no side effects: mark_viewed=0). Call on tile hover / focus. */
export function prefetch(id) {
  if (!id) return;
  id = String(id);
  load(id).then((d) => {
    ready.set(id, d);
    if (ready.size > 12) ready.delete(ready.keys().next().value);
    schedulePrebuild(id, d);
  }).catch(() => {});
}
let quietUntil = 0; // no idle prebuild right after a close (the focus return re-warms the same story)
function schedulePrebuild(id, data) {
  if (performance.now() < quietUntil) return;
  const hit = PRE.get(id);
  if (hit && hit.key === geomKey()) { PRE.delete(id); PRE.set(id, hit); return; } // touch (LRU)
  if (pending.has(id) || (S.open && S.id === id)) return;
  pending.add(id);
  ric(() => { pending.delete(id); prebuild(id, data).catch(() => {}); }, { timeout: 2000 });
}
async function prebuild(id, data) {
  if ((S.open && S.id === id) || !data || data.error) return;
  const old = PRE.get(id);
  if (old) { if (old.key === geomKey()) return; PRE.delete(id); }
  const key = geomKey();
  const root = build(id);
  root.classList.add('is-prebuild');
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  document.body.append(root);
  const panel = root.querySelector('.dossier-panel'), body = root.querySelector('.dossier-body');
  let after = {};
  try { after = await fill(body, panel, id, data, 'open'); } catch (e) { root.remove(); return; }
  if (!root.isConnected || key !== geomKey() || (S.open && S.id === id)) { root.remove(); return; }
  // idle time: this read is the prebuild's only layout, off the click path
  const rects = {};
  if (!phone() && !reduced()) for (const n of ['title', 'ring', 'topic']) {
    const el = sharedIn(body, n);
    if (el) rects[n] = { rect: el.getBoundingClientRect(), fs: n === 'title' ? parseFloat(getComputedStyle(el).fontSize) || 0 : 0 };
  }
  root.remove(); // detached until open(): no duplicate ids, no style cost meanwhile
  PRE.set(id, { root, rects, key, after });
  while (PRE.size > PRE_MAX) PRE.delete(PRE.keys().next().value);
}
function takePrebuilt(id) {
  const hit = PRE.get(id);
  if (!hit) return null;
  PRE.delete(id);
  return hit.key === geomKey() ? hit : null;
}
/** Warm the first story on a page once it has sat idle (never inside the tab switch itself). */
let warmT = 0;
document.addEventListener('byline:routed', (e) => {
  clearTimeout(warmT);
  const page = e.detail?.page;
  warmT = setTimeout(() => ric(() => {
    if (!page?.isConnected || S.open) return;
    const a = page.querySelector('a[href^="#/story/"]');
    const id = /#\/story\/([^/?#]+)/.exec(a?.getAttribute('href') || '')?.[1];
    if (id) prefetch(id);
  }, { timeout: 1500 }), 1800);
});

function finalRect() {
  // computed from tokens, never measured (E §3 step 2). Width cap S6: min(1040, 100vw − rail − 2·inset − 160).
  if (phone()) return { left: 0, top: 8, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight - 8 };
  const inset = 12, rail = collapsed() ? 64 : 232;
  const left = inset + rail + inset, top = inset, bottom = innerHeight - inset;
  const width = Math.min(1040, innerWidth - rail - 2 * inset - 160);
  return { left, top, right: left + width, bottom, width, height: bottom - top };
}
const visible = (r) => r && r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
const sharedIn = (el, name) => el?.querySelector?.(`[data-shared="${name}"]`) || null;
function guessShared(src, name) {
  if (!src) return null;
  const hit = sharedIn(src, name);
  if (hit) return hit;
  if (name === 'title') return src.querySelector('h1, h2, h3, .story-title, .t-title, .t-title-lg');
  if (name === 'ring') return src.querySelector('.score-ring, .score-chip, .score-num');
  return null;
}

function build(id) {
  const root = document.createElement('div');
  root.className = 'dossier';
  root.innerHTML = `
    <div class="dossier-scrim" data-dz-close></div>
    <section class="dossier-panel" role="dialog" aria-modal="true" tabindex="-1">
      <div class="dossier-fill"></div><div class="dossier-frost"></div>
      <div class="dossier-grab" aria-hidden="true"></div>
      <div class="dossier-bar"><button type="button" class="btn btn--secondary btn--icon" data-dz-close aria-label="Close dossier (Esc)">${icon('x')}</button></div>
      <div class="dossier-scroll"><article class="dossier-body" data-story="${esc(id)}"></article></div>
    </section>`;
  return root;
}

async function fill(body, panel, id, data, phase) {
  const fn = renderer || defaultRender;
  const out = await fn(body, { id, data, phase, close: requestClose });
  const h = body.querySelector('h1');
  if (h) { h.id = h.id || `dz-title-${id}`; panel.setAttribute('aria-labelledby', h.id); h.tabIndex = -1; }
  return out || {};
}

function requestClose() {
  if (!S.open || S.closing) return;
  if (S.onRequestClose) S.onRequestClose(); else close();
}

/**
 * Open the dossier for story `id`, flying from `srcEl` (a tile / row) when given and visible.
 * `opts.render` overrides the registered renderer for this open.
 */
export async function open(id, srcEl = null, opts = {}) {
  id = String(id);
  if (S.open && !S.closing && S.id === id) return;
  if (S.open && !S.closing) return swap(id, opts);
  if (S.closing) teardown();
  const seq = ++S.seq;
  S.open = true; S.closing = false; S.id = id; S.opener = document.activeElement;
  bg.overlay(true); bg.hold(DUR.morphOpen);

  // 1) every read happens here, on the page, before anything changes (the open's one layout at most)
  const src = srcEl && srcEl.isConnected ? srcEl : null;
  const srcRect = src ? src.getBoundingClientRect() : null;
  const fly = !reduced() && !phone() && visible(srcRect);
  const srcShared = {};
  if (fly) for (const n of ['title', 'ring', 'topic']) { const e = guessShared(src, n); if (e) { const r = e.getBoundingClientRect(); if (visible(r)) srcShared[n] = { el: e, rect: r, fs: parseFloat(getComputedStyle(e).fontSize) || 16 }; } }
  const onPhone = phone();
  const P = finalRect();

  // 2) content: the idle prebuild when there is one; else render now if the data is already here; else fly at once
  //    with a placeholder and fill on arrival (no waiting before the first frame of motion)
  const pre = takePrebuilt(id);
  let root, after = {}, late = false, dataP = null, data = null;
  if (pre) {
    root = pre.root; after = pre.after;
    root.classList.remove('is-prebuild'); root.removeAttribute('aria-hidden'); root.inert = false;
  } else {
    root = build(id);
    data = ready.get(id) || null;
    const panel0 = root.querySelector('.dossier-panel'), body0 = root.querySelector('.dossier-body');
    if (data && !data.error) after = await fill(body0, panel0, id, data, 'open');
    else {
      late = true;
      body0.innerHTML = placeholderHtml(srcShared.title?.el?.textContent);
      dataP = load(id).then(d => (data = d)).catch(e => { data = { error: e }; });
    }
    if (seq !== S.seq) return;
  }
  if (seq !== S.seq) return;
  S.root = root; S.panel = root.querySelector('.dossier-panel'); S.body = root.querySelector('.dossier-body'); S.src = src;
  document.body.append(root);
  wire(root);

  // 3) flight. Destination rects: cached by the prebuild (no read); otherwise one read of the inserted panel.
  const panel = S.panel, scrim = root.querySelector('.dossier-scrim');
  const sections = [...S.body.querySelectorAll('[data-dossier-section]')];
  const cols = [...S.body.querySelectorAll('[data-col]')];
  const anims = [];
  const dsts = fly ? Object.entries(srcShared).map(([n, s]) => {
    const dst = sharedIn(S.body, n); if (!dst) return null;
    if (pre) { const c = pre.rects[n]; return c ? { n, s, dst, d: c.rect, fs: c.fs || s.fs } : null; }
    if (late) return null; // the placeholder's title isn't the real destination
    return { n, s, dst, d: dst.getBoundingClientRect(), fs: n === 'title' ? parseFloat(getComputedStyle(dst).fontSize) || s.fs : 0 };
  }).filter(Boolean) : [];
  let flight = null;
  if (reduced()) {
    root.classList.add('frosted');
  } else if (onPhone) {
    anims.push(scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE.fade, fill: 'both' }));
    anims.push(flight = panel.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 520, easing: EASE.settle }));
  } else if (fly) {
    // the source: its shared elements vanish on frame 1 (their clones fly), the rest fades out under the clip;
    // it stays in flow (visibility, never display) until the last close frame
    S.srcShared = Object.values(srcShared).map(x => x.el);
    S.srcShared.forEach(e => { e.style.visibility = 'hidden'; });
    const fade = src.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: EASE.exit, fill: 'forwards' });
    anims.push(fade);
    const rTo = (r) => `inset(${(r.top - P.top).toFixed(1)}px ${(P.right - r.right).toFixed(1)}px ${(P.bottom - r.bottom).toFixed(1)}px ${(r.left - P.left).toFixed(1)}px round 12px)`;
    anims.push(flight = panel.animate([{ clipPath: rTo(srcRect) }, { clipPath: 'inset(0px 0px 0px 0px round 16px)' }], { duration: DUR.morphOpen, easing: EASE.move }));
    anims.push(scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade, fill: 'both' })); // ≥ .6 by 120ms
    // shared elements ride inside the panel's clipped layer, on the title's curve
    for (const { n, s, dst, d, fs } of dsts) {
      const fromChip = n === 'ring' && s.el.classList.contains('score-chip');
      if (fromChip) { // a chip doesn't become a ring: cross-fade the ring in place over the first 40%
        anims.push(dst.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.morphOpen * .4, easing: EASE.fade, fill: 'backwards' }));
        continue;
      }
      const scale = n === 'title' ? s.fs / (fs || s.fs) : (s.rect.width / (d.width || 1));
      anims.push(dst.animate([
        { transform: `translate(${(s.rect.left - d.left).toFixed(1)}px, ${(s.rect.top - d.top).toFixed(1)}px) scale(${scale.toFixed(4)})`, transformOrigin: 'top left' },
        { transform: 'none', transformOrigin: 'top left' }], { duration: DUR.morphOpen, easing: EASE.move }));
    }
  } else {
    // deep link / off-screen source: the panel simply fades in
    anims.push(scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade, fill: 'both' }));
    anims.push(flight = panel.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE.settle }));
  }
  if (!reduced()) {
    const base = fly ? 300 : 160;
    cols.forEach(c => anims.push(c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: base, easing: EASE.fade, fill: 'backwards' })));
    sections.slice(0, 6).forEach((sec, i) => {
      anims.push(sec.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: base + i * 50, easing: EASE.settle, fill: 'backwards' }));
    });
    if (sections.length > 6) sections.slice(6).forEach(sec => anims.push(sec.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: base + 6 * 50, easing: EASE.fade, fill: 'backwards' })));
  }
  // focus once the first frame is out: focusing now would force a layout of the freshly inserted panel inside the
  // click task; after that frame the layout is clean and focus() reads nothing new
  const h1 = S.body.querySelector('h1');
  requestAnimationFrame(() => setTimeout(() => { if (seq === S.seq && !S.closing) (h1?.isConnected ? h1 : panel).focus({ preventScroll: true }); }, 0));
  S.anims = anims;

  // afterFlight once the panel has landed (not when the last section's stagger ends)
  const landed = (flight ? flight.finished.catch(() => {}) : Promise.resolve());
  landed.then(() => {
    if (seq !== S.seq || S.closing) return;
    root.classList.add('frosted'); // frost fades in on a child layer after the flight (E §2)
    if (fly && src.isConnected) src.style.visibility = 'hidden';
    if (!late) { try { after.afterFlight?.(); } catch (e) { console.error(e); } }
  });
  Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => { if (seq === S.seq && !S.closing) S.anims = []; });
  if (late) {
    dataP.then(async () => {
      if (seq !== S.seq || S.closing) return;
      await landed; // never re-render mid-flight
      if (seq !== S.seq || S.closing) return;
      if (data?.error) { S.body.innerHTML = errorHtml(data.error); return; }
      const out = await fill(S.body, S.panel, id, data, 'swap');
      if (!reduced()) S.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
      S.body.querySelector('h1')?.focus({ preventScroll: true });
      out.afterFlight?.();
    });
  }
  // mark viewed (the server's GET side effect), once the user has actually opened it
  api.get(`/stories/${id}`, { fresh: true }).catch(() => {});
  return landed;
}

/** Replace the content of an open dossier with another story (no flight). */
async function swap(id, opts = {}) {
  const seq = ++S.seq;
  S.id = id;
  const body = S.body;
  const out = reduced() ? null : body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE.exit, fill: 'forwards' });
  let data;
  try { data = await load(id); } catch (e) { data = { error: e }; }
  await out?.finished.catch(() => {});
  if (seq !== S.seq) return;
  body.dataset.story = id;
  root().querySelector('.dossier-scroll').scrollTop = 0;
  const after = data.error ? (body.innerHTML = errorHtml(data.error), {}) : await fill(body, S.panel, id, data, 'swap');
  out?.cancel();
  if (!reduced()) body.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE.settle });
  body.querySelector('h1')?.focus({ preventScroll: true });
  after.afterFlight?.();
  api.get(`/stories/${id}`, { fresh: true }).catch(() => {});
}
const root = () => S.root;

/**
 * Close (Esc / Back / × / scrim). Reverses a flight still in progress; otherwise flies back to the
 * source re-measured now, or fades + scales to .98 if the source is gone or off-screen.
 * S5: the frost layer is display:none synchronously (no backdrop-filter repaint under a moving clip) and the
 * body fade, clip and scrim all start in this same frame.
 */
export function close({ instant = false } = {}) {
  if (!S.open || S.closing) return Promise.resolve();
  S.closing = true; S.seq++;
  const seqAtClose = S.seq;
  const r = S.root, panel = S.panel, scrim = r?.querySelector('.dossier-scrim');
  if (!r) { teardown(); return Promise.resolve(); }
  document.removeEventListener('keydown', S.keyHandler, true);
  if (instant || reduced()) { teardown(); return Promise.resolve(); }
  r.classList.remove('frosted');
  r.classList.add('closing');
  // mid-flight: reverse what's running (works at any point of the flight)
  if (S.anims.some(a => a.playState === 'running')) {
    const list = S.anims;
    list.forEach(a => { try { a.reverse(); } catch (e) { /* finished */ } });
    return Promise.all(list.map(a => a.finished.catch(() => {}))).then(() => { if (S.seq === seqAtClose) teardown(); });
  }
  // reads first (visibility:hidden keeps geometry, so the hidden source can be measured as is), then writes
  const src = S.src && S.src.isConnected ? S.src : null;
  const sr = src ? src.getBoundingClientRect() : null;
  const onPhone = phone();
  const P = onPhone ? null : finalRect();
  const anims = [];
  // once faded the body is hidden too, so the clip's per-frame repaint is just the fill
  anims.push(S.body.animate([{ opacity: 1, visibility: 'visible' }, { opacity: 0, visibility: 'hidden' }], { duration: 140, easing: EASE.exit, fill: 'forwards' }));
  if (onPhone) {
    anims.push(panel.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 320, easing: EASE.exit, fill: 'forwards' }));
    anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: EASE.fade, fill: 'forwards' }));
  } else if (visible(sr)) {
    const to = `inset(${(sr.top - P.top).toFixed(1)}px ${(P.right - sr.right).toFixed(1)}px ${(P.bottom - sr.bottom).toFixed(1)}px ${(sr.left - P.left).toFixed(1)}px round 12px)`;
    anims.push(panel.animate([{ clipPath: 'inset(0px 0px 0px 0px round 16px)' }, { clipPath: to }], { duration: DUR.morphClose, easing: EASE.move, fill: 'forwards' }));
    anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.morphClose, easing: EASE.fade, fill: 'forwards' }));
    // over the last 40% the emptied panel dissolves into the source, which fades back in place (no blank box, no pop)
    const fill = panel.querySelector('.dossier-fill');
    if (fill) anims.push(fill.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: .6 }, { opacity: 0 }], { duration: DUR.morphClose, easing: 'linear', fill: 'forwards' }));
    panel.style.boxShadow = 'none';
    src.getAnimations().forEach(a => { if (a.effect?.getKeyframes?.().some(k => 'opacity' in k)) a.cancel(); });
    src.style.visibility = '';
    S.srcShared.forEach(e => { e.style.visibility = ''; });
    anims.push(src.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: .55 }, { opacity: 1 }], { duration: DUR.morphClose, easing: EASE.fade }));
  } else {
    anims.push(panel.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], { duration: 280, easing: EASE.exit, fill: 'forwards' }));
    anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: EASE.fade, fill: 'forwards' }));
  }
  return Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => { if (S.seq === seqAtClose) teardown(); });
}

function teardown() {
  const opener = S.opener, src = S.src;
  // exact swap on the last frame: the source (and its shared elements) come back as the panel goes
  if (src) { src.style.visibility = ''; src.getAnimations?.().forEach(a => { if (a.effect?.getKeyframes?.().some(k => 'opacity' in k)) a.cancel(); }); }
  S.srcShared.forEach(e => { e.style.visibility = ''; });
  S.root?.remove();
  if (S.keyHandler) document.removeEventListener('keydown', S.keyHandler, true);
  const wasOpen = S.open;
  Object.assign(S, { open: false, closing: false, id: null, root: null, panel: null, body: null, src: null, srcShared: [], opener: null, anims: [], keyHandler: null });
  if (wasOpen) { bg.overlay(false); quietUntil = performance.now() + 2500; }
  const back = (src && src.isConnected && (src.matches('a, button, [tabindex]') ? src : src.querySelector('a[href*="story"], a, button'))) || (opener?.isConnected ? opener : null);
  back?.focus?.({ preventScroll: true });
}

function wire(r) {
  r.addEventListener('click', (e) => { if (e.target.closest('[data-dz-close]')) { e.preventDefault(); requestClose(); } });
  S.keyHandler = (e) => {
    if (!S.open || document.querySelector('.modal-wrap, .ix-wrap')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose(); return; }
    trapFocus(S.panel, e);
  };
  document.addEventListener('keydown', S.keyHandler, true);
  // phone: drag the grabber to dismiss (follows the finger; velocity or 30% closes)
  const grab = r.querySelector('.dossier-grab');
  let y0 = 0, dy = 0, drag = false, samples = [];
  grab.addEventListener('pointerdown', (e) => { drag = true; y0 = e.clientY; dy = 0; samples = [[performance.now(), 0]]; grab.setPointerCapture(e.pointerId); bg.hold(2000); });
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dy = Math.max(0, e.clientY - y0);
    const now = performance.now(); samples.push([now, dy]); while (samples.length > 2 && now - samples[0][0] > 80) samples.shift();
    S.panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!drag) return; drag = false;
    const [ta, ya] = samples[0], [tb, yb] = samples[samples.length - 1];
    const v = (yb - ya) / Math.max(1, tb - ta);
    if (dy > S.panel.offsetHeight * .3 || v > .5) {
      const p = S.panel; const from = p.style.transform; p.style.transform = '';
      p.animate([{ transform: from }, { transform: 'translateY(100%)' }], { duration: 320, easing: EASE.exit, fill: 'forwards' });
      setTimeout(() => { if (S.onRequestClose) S.onRequestClose({ animated: false }); else close({ instant: true }); }, 300);
    } else {
      const p = S.panel; const from = p.style.transform; p.style.transform = '';
      p.animate([{ transform: from }, { transform: 'none' }], { duration: 360, easing: EASE.settle });
    }
  };
  grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
}

/**
 * Rail collapse/expand while open: lock the body to its end width for the transition so text doesn't
 * re-wrap every frame (C §3); released at transitionend by app.js calling railDidChange().
 * Prebuilt dossiers were laid out for the old width: drop them.
 */
export function railWillChange(targetRailW) {
  PRE.clear();
  if (!S.open || phone() || !S.body) return;
  // no backdrop-filter re-blur of a page that is reflowing under it: opaque fill until transitionend
  S.root?.classList.add('is-reflowing');
  const scroll = S.body.parentElement;
  const gutter = scroll ? scroll.offsetWidth - scroll.clientWidth : 0;
  const w = Math.min(1040, innerWidth - targetRailW - 24 - 160) - gutter;
  S.body.style.width = `${w}px`;
  S.body.style.maxWidth = 'none';
}
export function railDidChange() { S.root?.classList.remove('is-reflowing'); if (S.body) { S.body.style.width = ''; S.body.style.maxWidth = ''; } }
addEventListener('resize', () => PRE.clear(), { passive: true });

// ------------------------------------------------------------------ minimal honest dossier (until a renderer registers)
const BOILER = /^(this article is adapted|learn about|read on|today, we are excited|we['’]re (excited|highlighting)|features\b|bug fixes|\w+ is an ai safety)/i;
const usable = (t) => !!t && !BOILER.test(t.trim()) && t.trim().split(/\s+/).length >= 8 && !/\n\s*[-*•]/.test(t);
const cleanClaim = (t) => String(t || '').replace(/^\d\s+(?=[A-Z])/, '').replace(/\s+([.,;:!?])/g, '$1').trim();
// highlight %, currency, ×/times, "N of M", or a count followed by a word; never bare years / versions
const NUM = /((?:[$€£]\s?\d[\d,.]*\s?(?:[kmb]n?|million|billion|trillion)?)|(?:\d[\d,.]*\s?%)|(?:\d[\d,.]*\s?(?:×|x|times)\b)|(?:\b\d+\s+of\s+\d+\b)|(?:\b(?!(?:19|20)\d{2}\b)\d[\d,.]*(?:\s(?:million|billion|trillion))?\s(?=[a-z]{3,})))/gi;
const hl = (t) => esc(t).replace(NUM, (m) => (/^v?\d+\.\d+\.\d+/.test(m) ? m : `<mark class="num-hl">${m}</mark>`));

function placeholderHtml(title) {
  return `<header class="dz-head" data-dossier-section><div><p class="eyebrow">Loading the dossier…</p>${title ? `<h1 class="dz-title">${esc(title)}</h1>` : '<span class="sk sk-line xl" style="width:70%;margin-top:14px"></span>'}</div></header>
    <div class="dz-grid" data-dossier-section aria-hidden="true"><div><span class="sk sk-line lg" style="width:60%"></span><span class="sk sk-line" style="width:90%;margin-top:12px"></span><span class="sk sk-line" style="width:80%;margin-top:10px"></span></div><div><span class="sk sk-line lg" style="width:40%"></span></div></div>`;
}
function errorHtml(e) {
  return String(html`<header class="dz-head"><div><p class="eyebrow">Dossier</p><h1 class="dz-title">This story couldn’t be loaded.</h1><p class="dz-dek">${e?.message || 'Unknown error'}</p></div></header>`);
}

async function defaultRender(body, { id, data }) {
  const s = data.story || {}, arts = data.articles || [], claims = data.claims || [];
  const th = threshold();
  const origin = data.origin || arts[0];
  const domains = [...new Set(arts.map(a => a.domain).filter(Boolean))];
  const firstParty = arts.filter(a => a.evidence_kind === 'announcement').length;
  const independent = arts.filter(a => (a.evidence_kind === 'reporting' || a.evidence_kind === 'research') && a.domain !== origin?.domain).length;
  const counts = [`${arts.length} post${arts.length === 1 ? '' : 's'}`, `${domains.length} outlet${domains.length === 1 ? '' : 's'}`, `${independent} independent`];
  const best = claims.filter(c => c.has_number).map(c => cleanClaim(c.text)).find(t => usable(t));
  const dek = s.finding || (usable(s.summary) ? s.summary : best || '');
  const tz = window.__byline?.timezone;
  const when = s.first_seen ? new Date(s.first_seen).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) }).replace(',', '') : '';
  const order = ['announcement', 'research', 'reporting', 'commentary', 'community', 'application', 'own_work'];
  const sorted = arts.slice().sort((a, b) => order.indexOf(a.evidence_kind) - order.indexOf(b.evidence_kind) || String(b.published_at || b.fetched_at).localeCompare(String(a.published_at || a.fetched_at)));
  const byArticle = (aid) => claims.filter(c => c.article_id === aid).map(c => cleanClaim(c.text)).filter(t => t.split(/\s+/).length >= 6);
  const allFirst = arts.length && firstParty === arts.length;
  body.innerHTML = String(html`
    <header class="dz-head">
      <div>
        <p class="eyebrow" data-dossier-section>${(s.topics || [])[0] || 'Story'}${when ? ` · first seen ${when}` : ''}</p>
        <h1 class="dz-title" data-shared="title">${s.title || `Story ${id}`}${demoFlag(s.is_demo)}</h1>
        ${dek ? html`<p class="dz-dek" data-dossier-section>${dek}</p>` : ''}
        <div class="dz-facts" data-dossier-section>
          <span class="t-meta">${counts.join(' · ')}</span>
          <span class="cluster">${(s.topics || []).slice(0, 3).map((t, i) => html`<span class="chip ${i === 0 ? 'chip--main' : 'chip--topic'}">${t}</span>`)}</span>
        </div>
        <div class="cluster" style="margin-top:20px" data-dossier-section>
          <button type="button" class="btn btn--primary" data-dz-draft>${icon('pen')}Draft a post</button>
          ${origin?.url ? html`<a class="btn btn--ghost" href="${origin.url}" target="_blank" rel="noopener noreferrer">Open primary${icon('arrow-up-right')}</a>` : ''}
        </div>
      </div>
      <div data-shared="ring" style="padding-bottom:22px">${scoreRing(s.score, th, { size: 104 })}</div>
    </header>
    <div class="dz-grid">
      <section class="tile tile--static" data-dossier-section>
        <div class="section-head"><h2 class="t-h2">What the sources say</h2><span class="section-meta">${counts.join(' · ')}</span></div>
        ${allFirst ? html`<p class="t-meta ink-2" style="margin:0 0 6px">No independent outlet has reported this yet; every figure below is the company’s own.</p>` : ''}
        ${sorted.map(a => {
          const said = usable(a.summary) ? a.summary : '';
          const cl = byArticle(a.id).filter(t => t !== said).slice(0, 3);
          return html`<article class="dz-src">
            <div class="dz-src-meta"><span class="tag ${a.evidence_kind === 'announcement' ? 'tag--neutral' : a.evidence_kind === 'reporting' || a.evidence_kind === 'research' ? 'tag--ok' : 'tag--neutral'}">${a.evidence_kind === 'announcement' ? 'Primary' : evLabel(a.evidence_kind)}</span><span>${a.domain}</span><span>${a.published_at ? fmtDate(a.published_at, { day: 'numeric', month: 'short' }) : `fetched ${fmtDate(a.fetched_at, { day: 'numeric', month: 'short' })}`}</span>${a.is_demo ? html`<span class="tag tag--demo">Demo</span>` : ''}</div>
            <a class="dz-src-title" href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
            ${said ? html`<p>${said}</p>` : ''}
            ${cl.length ? html`<ul class="dz-claims">${cl.map(t => html`<li>${raw(hl(t))}</li>`)}</ul>` : ''}
          </article>`;
        })}
      </section>
      <aside class="stack" data-dossier-section>
        <section class="tile tile--static">
          <div class="section-head"><h2 class="t-h2">Score</h2><span class="section-meta">bar ${th}</span></div>
          <dl class="kv">${breakdownRows(s.breakdown, s.score)}</dl>
          <p class="t-meta ink-3" style="margin:14px 0 0">The full breakdown with weights arrives with the dossier rebuild.</p>
        </section>
        ${s.companies?.length ? html`<section class="tile tile--static"><h2 class="section-label">Companies</h2><div class="cluster">${s.companies.map(c => html`<span class="chip">${c}</span>`)}</div></section>` : ''}
      </aside>
    </div>`);
  body.querySelector('[data-dz-draft]')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const r = await api.post(`/stories/${id}/drafts`, { channel: 'linkedin', format: 'long' });
    toast('Draft created', 'ok');
    location.hash = `#/draft/${r.id || r.draft_id || r.draft?.id || ''}`;
  }, 'Drafting…'));
  return {};
}
function breakdownRows(b, score) {
  if (!b) return html`<dt>Score</dt><dd>${Math.round(score)}</dd>`;
  const rows = [['Interest', b.interest, 35], ['Evidence', b.evidence, 25], ['Novelty', b.novelty, 20], ['Impact', b.impact, 20]].filter(([, v]) => typeof v === 'number');
  const base = rows.reduce((t, [, v, w]) => t + v * w, 0);
  return html`${rows.map(([n, v, w]) => html`<dt>${n}</dt><dd class="tnum">${(v * w).toFixed(1)} <span class="ink-3">/ ${w}</span></dd>`)}
    ${typeof b.recency === 'number' ? html`<dt>× recency</dt><dd class="tnum">${b.recency.toFixed(2)}</dd>` : ''}
    <dt>Result</dt><dd class="tnum">${(base * (b.recency ?? 1) * (1 + (b.feedback || 0))).toFixed(1)} <span class="ink-3">(stored ${Number(score).toFixed(1)})</span></dd>`;
}
