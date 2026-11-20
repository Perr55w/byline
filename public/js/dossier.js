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
/** True while the dossier is open (or opening) on story `id` (app.js route guard, R2/S2). */
export const isOpenOn = (id) => S.open && !S.closing && S.id === String(id);
/** app.js: how a close request (Esc, ×, scrim, swipe) becomes a history change. */
export function onRequestClose(fn) { S.onRequestClose = fn; }

const phone = () => matchMedia('(max-width: 760px)').matches;
/** R3 S1: views branch on the phone sheet (story-dossier.js skips entrance animations there). */
export const isPhone = phone;
const collapsed = () => document.documentElement.classList.contains('rail-collapsed');
const load = (id) => api.get(`/stories/${id}?mark_viewed=0`);
const ric = window.requestIdleCallback ? (f, o) => requestIdleCallback(f, o) : (f) => setTimeout(() => f({ timeRemaining: () => 8, didTimeout: true }), 60);

// ------------------------------------------------------------------ prefetch + idle prebuild (S3)
// prefetch(id) warms the data; once it resolves, an idle callback renders the whole 'open' dossier into a hidden,
// attached, contain:strict root at the final geometry and measures the shared destinations there.
// R3 S2 (E): the MOST RECENT prebuild stays attached (.is-prebuild: visibility hidden, inert, aria-hidden, its ids
// parked in data-pre-id), so its style, layout and paint records already exist when the click comes; open() only
// un-hides it (visibility / transform / clip change, nothing new is laid out). Older LRU entries are detached.
const ready = new Map();           // id → story payload (resolved)
const PRE = new Map();             // id → { root, rects, key, after }
const PRE_MAX = 3;
const geomKey = () => `${innerWidth}x${innerHeight}:${collapsed() ? 'c' : 'e'}:${phone() ? 'p' : 'd'}`;
const pending = new Set();
// ids inside a parked prebuild move to data-pre-id (no duplicate ids in the document while it waits)
function parkIds(root) { for (const el of root.querySelectorAll('[id]')) { el.setAttribute('data-pre-id', el.id); el.removeAttribute('id'); } }
function unparkIds(root) { for (const el of root.querySelectorAll('[data-pre-id]')) { el.id = el.getAttribute('data-pre-id'); el.removeAttribute('data-pre-id'); } }
/** Detach every parked prebuild except `keep` (LRU entries other than the most recent stay detached). */
function detachOthers(keep = null) { for (const v of PRE.values()) if (v.root !== keep && v.root.isConnected) v.root.remove(); }
function dropPrebuilt() { for (const v of PRE.values()) v.root.remove(); PRE.clear(); }
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
  if (pending.has(id) || S.open) return; // R3 S2: never park a second (attached) dossier beside an open one
  pending.add(id);
  ric(() => { pending.delete(id); prebuild(id, data).catch(() => {}); }, { timeout: 2000 });
}
async function prebuild(id, data) {
  if (S.open || !data || data.error) return;
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
  if (!root.isConnected || key !== geomKey() || S.open) { root.remove(); return; }
  // idle time: this read is the prebuild's only layout, off the click path
  const rects = {};
  if (!phone() && !reduced()) for (const n of ['title', 'ring', 'topic']) {
    const el = sharedIn(body, n);
    if (el) rects[n] = { rect: el.getBoundingClientRect(), fs: n === 'title' ? parseFloat(getComputedStyle(el).fontSize) || 0 : 0 };
  }
  parkIds(root); // stays attached (R3 S2); its ids wait in data-pre-id until open()
  PRE.set(id, { root, rects, key, after });
  detachOthers(root);
  while (PRE.size > PRE_MAX) { const k = PRE.keys().next().value; PRE.get(k).root.remove(); PRE.delete(k); }
}
function takePrebuilt(id) {
  const hit = PRE.get(id);
  if (!hit) return null;
  PRE.delete(id);
  if (hit.key !== geomKey()) { hit.root.remove(); return null; }
  return hit;
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
  // computed from tokens, never measured (E §3 step 2). Width: min(1040, 100vw − expanded rail − 2·inset − 160).
  if (phone()) return { left: 0, top: 8, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight - 8 };
  const inset = 12, rail = collapsed() ? 64 : 232;
  const left = inset + rail + inset, top = inset, bottom = innerHeight - inset;
  const width = Math.min(1040, innerWidth - 232 - 2 * inset - 160); // R2 S4: constant (the expanded rail), CSS too
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
    <div class="dossier-shadow" aria-hidden="true"></div>
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
  // R2 S2 (E): the clip starts this far above the row, so the flying title's first line is never cut mid-flight
  let topPad = 0;
  if (fly && srcShared.title) {
    const tcs = getComputedStyle(srcShared.title.el);
    const lh = parseFloat(tcs.lineHeight) || srcShared.title.fs * 1.25;
    const padTop = parseFloat(getComputedStyle(src).paddingTop) || 0;
    topPad = Math.max(8, lh - padTop);
  }

  // 2) content: the idle prebuild when there is one; else render now if the data is already here; else fly at once
  //    with a placeholder and fill on arrival (no waiting before the first frame of motion)
  const pre = takePrebuilt(id);
  let root, after = {}, late = false, dataP = null, data = null, skel = null;
  if (pre) {
    root = pre.root; after = pre.after;
    detachOthers(root);
  } else {
    root = build(id);
    data = ready.get(id) || null;
    const panel0 = root.querySelector('.dossier-panel'), body0 = root.querySelector('.dossier-body');
    if (data && !data.error) after = await fill(body0, panel0, id, data, 'open');
    else {
      late = true;
      body0.innerHTML = placeholderHtml(srcShared.title?.el?.textContent);
      dataP = load(id).then(d => (data = d)).catch(e => { data = { error: e }; });
      // the section-shaped skeleton shows only if the data takes > 120ms; once shown it is held ≥ 320ms
      skel = { shownAt: 0, t: setTimeout(() => {
        if (seq !== S.seq || data) return;
        const sk = body0.querySelector('.dz-sk'); if (!sk) return;
        sk.hidden = false; skel.shownAt = performance.now();
        if (!reduced()) sk.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
      }, 120) };
    }
    if (seq !== S.seq) return;
  }
  if (seq !== S.seq) return;
  S.root = root; S.panel = root.querySelector('.dossier-panel'); S.body = root.querySelector('.dossier-body'); S.src = src;
  if (pre && root.isConnected) {
    // R3 S2: the parked root is already styled and laid out at the final geometry: un-hide it in place
    unparkIds(root);
    root.classList.remove('is-prebuild'); root.removeAttribute('aria-hidden'); root.inert = false;
  } else {
    if (pre) { unparkIds(root); root.classList.remove('is-prebuild'); root.removeAttribute('aria-hidden'); root.inert = false; }
    document.body.append(root);
  }
  wire(root);
  clearTimeout(chromeT);
  document.documentElement.classList.remove('dz-back');
  document.documentElement.classList.add('dossier-open'); // S11: the top bar fades out (shell.css)

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
    // R2 S2: the clip's corners stay square (round 0) until .75 of the flight and only then round to 16px, so most
    // frames are a plain rectangular clip; the soft shadow is off the clipped layer (.dossier-shadow)
    const rTo = (r, rad = 0) => `inset(${(r.top - P.top).toFixed(1)}px ${(P.right - r.right).toFixed(1)}px ${(P.bottom - r.bottom).toFixed(1)}px ${(r.left - P.left).toFixed(1)}px round ${rad}px)`;
    const r0 = { top: Math.max(P.top, srcRect.top - topPad), right: srcRect.right, bottom: srcRect.bottom, left: srcRect.left };
    const at = (k) => ({ top: r0.top + (P.top - r0.top) * k, right: r0.right + (P.right - r0.right) * k, bottom: r0.bottom + (P.bottom - r0.bottom) * k, left: r0.left + (P.left - r0.left) * k });
    panel.style.willChange = 'transform, opacity, clip-path';
    anims.push(flight = panel.animate([{ clipPath: rTo(r0), offset: 0 }, { clipPath: rTo(at(.75)), offset: .75 }, { clipPath: 'inset(0px 0px 0px 0px round 16px)', offset: 1 }], { duration: DUR.morphOpen, easing: EASE.move }));
    anims.push(scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade, fill: 'both' })); // ≥ .6 by 120ms
    // shared elements ride inside the panel's clipped layer, on the title's curve
    for (const { n, s, dst, d, fs } of dsts) {
      const fromChip = n === 'ring' && s.el.classList.contains('score-chip');
      if (fromChip) { // a chip doesn't become a ring: R3 S3, the ring cross-fades in place from flight offset .75, once
        // the clip's top edge is above it (never a ring glyph cut by the clip)
        anims.push(dst.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.morphOpen * .4, delay: DUR.morphOpen * .75, easing: EASE.fade, fill: 'backwards' }));
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
    // R2 S2: base 160ms; a column fades as one unit with its divider (sections inside it don't fade separately), so the
    // rule never paints before its content; section 1 is fully in by base + 320 = 480ms after the click
    // R3 S3 (C, E): during a flight the units that share the head band with the flying title (everything in the
    // title's header after the title: dek, actions, the facts / ring column) wait until the title has all but
    // landed, max(160, HEAD_K × morphOpen), and only fade (no rise), so the title is never drawn across a half-faded dek
    const base = 160, step = 40, dur = 320;
    const units = [...sections.filter(sec => !cols.some(c => c.contains(sec))), ...cols];
    const titleEl = fly && dsts.some(x => x.n === 'title') ? sharedIn(S.body, 'title') : null;
    const band = titleEl?.closest('header, .dx-head, .dz-head') || null;
    const inBand = (u) => !!band && band.contains(u) && !!(titleEl.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING);
    const headDelay = Math.max(base, HEAD_K * DUR.morphOpen);
    let k = 0;
    units.forEach((u) => {
      if (inBand(u)) { anims.push(u.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay: headDelay, easing: EASE.fade, fill: 'backwards' })); return; }
      const i = k++;
      if (i < 7) anims.push(u.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: dur, delay: base + i * step, easing: EASE.settle, fill: 'backwards' }));
      else anims.push(u.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay: base + 7 * step, easing: EASE.fade, fill: 'backwards' }));
    });
  }
  // focus once the first frame is out: focusing now would force a layout of the freshly inserted panel inside the
  // click task; after that frame the layout is clean and focus() reads nothing new
  const h1 = S.body.querySelector('h1');
  requestAnimationFrame(() => setTimeout(() => { if (seq === S.seq && !S.closing) (h1?.isConnected ? h1 : panel).focus({ preventScroll: true }); }, 0));
  S.anims = anims;

  // afterFlight once the panel has landed (not when the last section's stagger ends)
  const landed = (flight ? flight.finished.catch(() => {}) : Promise.resolve());
  landed.then(() => {
    panel.style.willChange = '';
    if (seq !== S.seq || S.closing) return;
    // R2 S2: the soft shadow fades in over 200ms on the opaque fill first; the frost (backdrop blur) replaces the fill
    // only once nothing under or around the panel is changing, so the blur is computed once, not per frame
    root.classList.add('landed');
    if (fly && src.isConnected) src.style.visibility = 'hidden';
    // R3 S1 (R1): the frost (backdrop blur) goes live only once the panel is quiet (no running animation in it and no
    // deferred placeholder left, 2 frames in a row; cap 2 s). Until then the opaque .98 flight fill stays, so nothing
    // that afterFlight inserts or animates is ever re-blurred per frame.
    const frost = () => { if (seq === S.seq && !S.closing) root.classList.add('frosted'); };
    if (reduced()) frost(); else whenQuiet(root, () => seq === S.seq && !S.closing).then(frost);
    // R2 S2 contract: afterFlight runs in its own task, after the frame that adds .landed (never in this task)
    if (!late) runAfter(after, seq);
  });
  Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => { if (seq === S.seq && !S.closing) S.anims = []; });
  if (late) {
    dataP.then(async () => {
      if (seq !== S.seq || S.closing) return;
      clearTimeout(skel?.t);
      await landed; // never re-render mid-flight
      if (seq !== S.seq || S.closing) return;
      if (skel?.shownAt) { const wait = 320 - (performance.now() - skel.shownAt); if (wait > 0) await new Promise(r => setTimeout(r, wait)); }
      if (seq !== S.seq || S.closing) return;
      if (data?.error) { S.body.innerHTML = errorHtml(data.error); return; }
      const out = await fill(S.body, S.panel, id, data, 'swap');
      if (!reduced()) S.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
      S.body.querySelector('h1')?.focus({ preventScroll: true });
      runAfter(out, seq);
    });
  }
  // mark viewed (the server's GET side effect), once the user has actually opened it
  api.get(`/stories/${id}`, { fresh: true }).catch(() => {});
  return landed;
}

/**
 * afterFlight in its own task after the landing frame. R3 S9: on the phone sheet it runs in an idle callback
 * (timeout 300 ms) and is told { phone: true } so the view can skip entrance animations.
 */
function runAfter(after, seq) {
  if (!after?.afterFlight) return;
  const go = () => { if (seq !== S.seq || S.closing) return; try { after.afterFlight({ phone: phone() }); } catch (e) { console.error(e); } };
  if (phone()) requestAnimationFrame(() => ric(go, { timeout: 300 }));
  else requestAnimationFrame(() => setTimeout(go, 0));
}
const HEAD_K = .7; // R3 S3: head-band units wait for 0.7 of the flight (0.85 if the title still crosses the dek)
/**
 * R3 S1: resolves when the panel is quiet for 2 consecutive frames: no running animation in its subtree and no
 * [data-defer] / .dx-cv placeholder in the body (re-checked on body mutations), or `cap` ms after it starts. While
 * the dossier is .is-busy (an in-panel expansion) it is not quiet either.
 */
function whenQuiet(root, alive, cap = 2000) {
  const panel = root.querySelector('.dossier-panel'), body = root.querySelector('.dossier-body');
  return new Promise((resolve) => {
    const t0 = performance.now();
    let calm = 0, dirty = false, done = false;
    const mo = new MutationObserver(() => { dirty = true; calm = 0; });
    if (body) mo.observe(body, { childList: true, subtree: true, attributes: true });
    const end = () => { if (done) return; done = true; mo.disconnect(); resolve(); };
    const tick = () => {
      if (done) return;
      if (!alive() || !root.isConnected) { mo.disconnect(); done = true; return; }
      if (performance.now() - t0 >= cap) { end(); return; }
      const busy = dirty || root.classList.contains('is-busy')
        || panel.getAnimations({ subtree: true }).some(a => a.playState === 'running')
        || !!body?.querySelector('[data-defer], .dx-cv');
      dirty = false;
      calm = busy ? 0 : calm + 1;
      if (calm >= 2) end(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/**
 * R3 S1 (for in-panel expansions: "Show all 6 in full", "+3 more"): while `promise` is pending the dossier is
 * .is-busy, which takes the frost (backdrop blur) out and puts the opaque flight fill back, so the expansion's
 * frames don't re-blur the backdrop. Returns the promise.
 */
let busyN = 0;
export function busy(promise) {
  const r = S.root;
  if (!r || !promise?.then) return promise;
  busyN++;
  r.classList.add('is-busy');
  const done = () => { busyN = Math.max(0, busyN - 1); if (!busyN) r.classList.remove('is-busy'); };
  promise.then(done, done);
  return promise;
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
  runAfter(after, seq);
  api.get(`/stories/${id}`, { fresh: true }).catch(() => {});
}
const root = () => S.root;

/**
 * Close (Esc / Back / × / scrim). Reverses a flight still in progress; otherwise flies back to the
 * source re-measured now, or fades + scales to .98 if the source is gone or off-screen.
 * R2 S3: the frost goes at once (opacity 0, no transition), the opaque flight fill is back and the shadow is off; the
 * body fades in 140ms, then the scroller is display:none. A tall source gets the clip back; a small or off-screen
 * one gets a 360ms opacity + translate/scale toward it (C).
 */
export function close({ instant = false } = {}) {
  if (!S.open || S.closing) return Promise.resolve();
  S.closing = true; S.seq++;
  const seqAtClose = S.seq;
  const r = S.root, panel = S.panel, scrim = r?.querySelector('.dossier-scrim');
  if (!r) { teardown(); return Promise.resolve(); }
  document.removeEventListener('keydown', S.keyHandler, true);
  if (instant || reduced()) { teardown(); return Promise.resolve(); }
  // R2 S3, first close frame: the frost layer goes (opacity 0, no transition), the opaque flight fill is back, the
  // shadow is off; nothing but transform / opacity / clip-path animates from here
  // reads first (visibility:hidden keeps geometry, so the hidden source can be measured as is), then writes
  const src = S.src && S.src.isConnected ? S.src : null;
  const midFlight = S.anims.some(a => a.playState === 'running');
  const sr = src && !midFlight ? src.getBoundingClientRect() : null;
  r.classList.remove('frosted', 'landed');
  r.classList.add('closing');
  // R3 S4 (R4): one beat. The top bar's children and the field start their 240ms fade back in this same first close
  // frame (named children, opacity only), alongside the panel and scrim, not after the teardown
  if (!window.__noChrome) chromeBack();
  // mid-flight: reverse what's running (works at any point of the flight)
  if (midFlight) {
    const list = S.anims;
    list.forEach(a => { try { a.reverse(); } catch (e) { /* finished */ } });
    return Promise.all(list.map(a => a.finished.catch(() => {}))).then(() => { if (S.seq === seqAtClose) teardown(); });
  }
  const onPhone = phone();
  const P = onPhone ? null : finalRect();
  const anims = [];
  const run = () => {
    // the body goes in 140ms under a cover (the panel's ::after, the flight fill's colour) fading in on top: a solid
    // quad's opacity is cheap where fading the body itself made it a render surface; then the scroller leaves the render
    // (display:none), so whatever moves next moves an empty fill
    const scroll = panel.querySelector('.dossier-scroll');
    const bodyOut = onPhone ? null : panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: EASE.exit, fill: 'forwards', pseudoElement: '::after' });
    const gone = (bodyOut ? bodyOut.finished : Promise.resolve()).then(() => { if (S.seq === seqAtClose && scroll && !onPhone) scroll.classList.add('is-gone'); }).catch(() => {});
    if (bodyOut) anims.push(bodyOut);
    // opacity on the panel only once its body is gone (an opacity animation makes the panel a render surface)
    const fadePanel = (dur, easing = EASE.fade) => gone.then(() => { if (S.seq !== seqAtClose) return; const a = panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing, fill: 'forwards' }); anims.push(a); return a.finished.catch(() => {}); });
    const restoreSrc = () => {
      if (!src) return;
      src.getAnimations().forEach(a => { if (a.effect?.getKeyframes?.().some(k => 'opacity' in k)) a.cancel(); });
      src.style.visibility = '';
      S.srcShared.forEach(e => { e.style.visibility = ''; });
    };
    const waits = [];
    if (onPhone) {
      anims.push(panel.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 320, easing: EASE.exit, fill: 'forwards' }));
      anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: EASE.fade, fill: 'forwards' }));
    } else if (visible(sr) && sr.height >= P.height * .3) {
      // a tall source (Today's lead tile): the clip flies back to it, square-cornered after the first quarter
      panel.style.willChange = 'clip-path';
      const to = `inset(${(sr.top - P.top).toFixed(1)}px ${(P.right - sr.right).toFixed(1)}px ${(P.bottom - sr.bottom).toFixed(1)}px ${(sr.left - P.left).toFixed(1)}px round 0px)`;
      anims.push(panel.animate([{ clipPath: 'inset(0px 0px 0px 0px round 16px)' }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', offset: .25 }, { clipPath: to }], { duration: DUR.morphClose, easing: EASE.move, fill: 'forwards' }));
      anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.morphClose - FRAME, delay: FRAME, easing: EASE.fade, fill: 'forwards' }));
      // over the last 40% the emptied panel dissolves into the source, which fades back in place (no blank box, no pop)
      waits.push(gone.then(() => new Promise(r => setTimeout(r, Math.max(0, DUR.morphClose * .6 - 140)))).then(() => fadePanel(DUR.morphClose * .4, 'linear')));
      restoreSrc();
      anims.push(src.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: .55 }, { opacity: 1 }], { duration: DUR.morphClose, easing: EASE.fade }));
    } else if (visible(sr)) {
      // R2 S3 (C): a small source row (most Feed / Search rows): no clip; the panel drifts and shrinks toward the row
      // over 360ms and fades once its body is gone, and the row fades back in under it
      const dx = ((sr.left + sr.width / 2) - (P.left + P.width / 2)) * .18, dy = ((sr.top + sr.height / 2) - (P.top + P.height / 2)) * .18;
      panel.style.willChange = 'transform';
      anims.push(panel.animate([{ transform: 'none' }, { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(.94)` }], { duration: 360, easing: EASE.move, fill: 'forwards' }));
      waits.push(fadePanel(220));
      anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360 - FRAME, delay: FRAME, easing: EASE.fade, fill: 'forwards' }));
      restoreSrc();
      anims.push(src.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: .3 }, { opacity: 1 }], { duration: 360, easing: EASE.fade }));
    } else {
      restoreSrc();
      panel.style.willChange = 'transform';
      anims.push(panel.animate([{ transform: 'none' }, { transform: 'scale(.98)' }], { duration: 300, easing: EASE.exit, fill: 'forwards' }));
      waits.push(fadePanel(160, EASE.exit));
      anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 - FRAME, delay: FRAME, easing: EASE.fade, fill: 'forwards' }));
    }
    return Promise.all([...anims.map(a => a.finished.catch(() => {})), ...waits]).then(() => { if (S.seq === seqAtClose) teardown(); });
  };
  // the frost has just left (first close frame): start the motion on the next frame, so that frame's one-off redraw
  // of the area the blur covered isn't compounded with the first animation frame
  return new Promise((res) => requestAnimationFrame(() => { if (S.seq !== seqAtClose) { res(); return; } run().then(res); }));
}

const FRAME = 17; // R3 S4 (B): the scrim fade starts one frame after the clip / panel motion
/** R3 S4: swap html.dossier-open for html.dz-back (the chrome's 240ms fade-in); dz-back clears 300ms later. */
function chromeBack() {
  const h = document.documentElement;
  if (!h.classList.contains('dossier-open')) return;
  h.classList.add('dz-back', 'dz-field-hold'); h.classList.remove('dossier-open');
  clearTimeout(chromeT); chromeT = setTimeout(() => h.classList.remove('dz-back'), 300);
}
function teardown() {
  const opener = S.opener, src = S.src;
  // exact swap on the last frame: the source (and its shared elements) come back as the panel goes
  if (src) { src.style.visibility = ''; src.getAnimations?.().forEach(a => { if (a.effect?.getKeyframes?.().some(k => 'opacity' in k)) a.cancel(); }); }
  S.srcShared.forEach(e => { e.style.visibility = ''; });
  S.root?.remove();
  if (window.__noChrome) chromeBack();
  document.documentElement.classList.remove('dossier-open', 'dz-field-hold');
  busyN = 0;
  if (S.keyHandler) document.removeEventListener('keydown', S.keyHandler, true);
  const wasOpen = S.open;
  Object.assign(S, { open: false, closing: false, id: null, root: null, panel: null, body: null, src: null, srcShared: [], opener: null, anims: [], keyHandler: null });
  if (wasOpen) { bg.overlay(false); quietUntil = performance.now() + 2500; }
  const back = (src && src.isConnected && (src.matches('a, button, [tabindex]') ? src : src.querySelector('a[href*="story"], a, button'))) || (opener?.isConnected ? opener : null);
  back?.focus?.({ preventScroll: true });
}

let chromeT = 0;
function wire(r) {
  // S12: the close button's top fade shows once the body has scrolled (class only; no layout read beyond scrollTop)
  const sc = r.querySelector('.dossier-scroll');
  let scRaf = 0, scOn = false;
  sc?.addEventListener('scroll', () => {
    if (scRaf) return;
    scRaf = requestAnimationFrame(() => { scRaf = 0; const on = sc.scrollTop > 8; if (on !== scOn) { scOn = on; sc.classList.toggle('is-scrolled', on); } });
  }, { passive: true });
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
 * Rail collapse/expand while open. R2 S4: the panel's width no longer depends on the rail (components.css), so only
 * its left edge moves and the body never re-wraps. R3 S5 (C, F): with the dossier open the panel's and shadow's
 * --rail-w doesn't transition (shell.css), so `left` steps to its end value in ONE layout, and a WAAPI transform
 * translateX(old − new → 0) on the rail's own duration and curve carries it there on the compositor. During the move
 * the frost layer is dropped (no backdrop re-blur of a page moving under it) and the opaque flight fill stands in.
 * Prebuilt dossiers were laid out for the old geometry: drop them. Call BEFORE html.rail-collapsed flips.
 */
let railAnims = [];
export function railWillChange(newW) {
  dropPrebuilt();
  if (!S.open || phone() || !S.body) return;
  const oldW = collapsed() ? 64 : 232, toW = typeof newW === 'number' ? newW : (collapsed() ? 232 : 64);
  const dx = oldW - toW; // left = inset + rail + inset, so the left edge moves by the rail's width change
  S.root?.classList.add('is-reflowing');
  railAnims.forEach(a => a.cancel());
  railAnims = [];
  if (!dx || reduced()) { railDidChange(); return; }
  const seq = S.seq;
  for (const el of [S.panel, S.root.querySelector('.dossier-shadow')]) {
    if (el) railAnims.push(el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: DUR.layout, easing: EASE.move }));
  }
  Promise.all(railAnims.map(a => a.finished)).then(() => { if (seq === S.seq) railDidChange(); }, () => {});
}
export function railDidChange() { railAnims = []; S.root?.classList.remove('is-reflowing'); }
addEventListener('resize', () => dropPrebuilt(), { passive: true });
document.addEventListener('byline:theme', () => dropPrebuilt());

// ------------------------------------------------------------------ minimal honest dossier (until a renderer registers)
const BOILER = /^(this article is adapted|learn about|read on|today, we are excited|we['’]re (excited|highlighting)|features\b|bug fixes|\w+ is an ai safety)/i;
const usable = (t) => !!t && !BOILER.test(t.trim()) && t.trim().split(/\s+/).length >= 8 && !/\n\s*[-*•]/.test(t);
const cleanClaim = (t) => String(t || '').replace(/^\d\s+(?=[A-Z])/, '').replace(/\s+([.,;:!?])/g, '$1').trim();
// highlight %, currency, ×/times, "N of M", or a count followed by a word; never bare years / versions
const NUM = /((?:[$€£]\s?\d[\d,.]*\s?(?:[kmb]n?|million|billion|trillion)?)|(?:\d[\d,.]*\s?%)|(?:\d[\d,.]*\s?(?:×|x|times)\b)|(?:\b\d+\s+of\s+\d+\b)|(?:\b(?!(?:19|20)\d{2}\b)\d[\d,.]*(?:\s(?:million|billion|trillion))?\s(?=[a-z]{3,})))/gi;
const hl = (t) => esc(t).replace(NUM, (m) => (/^v?\d+\.\d+\.\d+/.test(m) ? m : `<mark class="num-hl">${m}</mark>`));

// R2 S2 (C): section-shaped: a 2-bar lede, a row of 3 action pills, two columns of 4 bars. Hidden until the data
// has taken > 120ms (open() unhides it), so a fast load never flashes it.
function placeholderHtml(title) {
  const bars = (ws) => ws.map(w => `<i style="width:${w}%"></i>`).join('');
  return `<header class="dz-head" data-dossier-section><div><p class="eyebrow">Loading the dossier…</p>${title ? `<h1 class="dz-title">${esc(title)}</h1>` : ''}</div></header>
    <div class="dz-sk" data-dossier-section aria-hidden="true" hidden>
      <div class="dz-sk-lede">${bars([92, 64])}</div>
      <div class="dz-sk-acts"><i></i><i></i><i></i></div>
      <div class="dz-sk-cols"><div>${bars([46, 96, 88, 72])}</div><div>${bars([38, 90, 80, 60])}</div></div>
    </div>`;
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
