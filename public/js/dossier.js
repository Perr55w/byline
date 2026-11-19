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

const S = { open: false, closing: false, id: null, root: null, panel: null, body: null, src: null, opener: null, anims: [], seq: 0, onRequestClose: null, keyHandler: null };
export const isOpen = () => S.open;
export const currentId = () => S.id;
/** app.js: how a close request (Esc, ×, scrim, swipe) becomes a history change. */
export function onRequestClose(fn) { S.onRequestClose = fn; }

const phone = () => matchMedia('(max-width: 760px)').matches;
const load = (id) => api.get(`/stories/${id}?mark_viewed=0`);
/** Warm the story (no side effects: mark_viewed=0). Call on tile hover / focus. */
export function prefetch(id) { if (id) load(id).catch(() => {}); }

function finalRect() {
  // computed from tokens, never measured (E §3 step 2)
  if (phone()) return { left: 0, top: 8, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight - 8 };
  const cs = getComputedStyle(document.documentElement);
  const inset = parseFloat(cs.getPropertyValue('--shell-inset')) || 12;
  const rail = parseFloat(cs.getPropertyValue('--rail-w')) || 0;
  const left = inset + rail + inset, top = inset, right = innerWidth - inset, bottom = innerHeight - inset;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
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

async function fill(body, id, data, phase) {
  const fn = renderer || defaultRender;
  const out = await fn(body, { id, data, phase, close: requestClose });
  const h = body.querySelector('h1');
  if (h) { h.id = h.id || `dz-title-${id}`; S.panel.setAttribute('aria-labelledby', h.id); h.tabIndex = -1; }
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

  // data first (prefetch makes this instant); after 120ms, fly with a placeholder and fill on arrival
  let data = null, late = false;
  const dataP = load(id).then(d => (data = d)).catch(e => { data = { error: e }; });
  await Promise.race([dataP, new Promise(r => setTimeout(r, 120))]);
  if (seq !== S.seq) return;
  if (!data) late = true;

  // 1) batch reads on the source before any change to the page
  const src = srcEl && srcEl.isConnected ? srcEl : null;
  const srcRect = src ? src.getBoundingClientRect() : null;
  const fly = !reduced() && !phone() && visible(srcRect);
  const srcShared = {};
  if (fly) for (const n of ['title', 'ring', 'topic']) { const e = guessShared(src, n); if (e) { const r = e.getBoundingClientRect(); if (visible(r)) srcShared[n] = { el: e, rect: r, fs: parseFloat(getComputedStyle(e).fontSize) || 16 }; } }

  // 2) build + render the content
  const root = build(id);
  S.root = root; S.panel = root.querySelector('.dossier-panel'); S.body = root.querySelector('.dossier-body'); S.src = src;
  let after = {};
  if (data && !data.error) after = await fill(S.body, id, data, 'open');
  else if (data?.error) S.body.innerHTML = errorHtml(data.error);
  else S.body.innerHTML = placeholderHtml(srcShared.title?.el?.textContent);
  if (seq !== S.seq) return;
  document.body.append(root);
  wire(root);

  // 3) flight
  const P = finalRect();
  const panel = S.panel, scrim = root.querySelector('.dossier-scrim');
  const sections = [...S.body.querySelectorAll('[data-dossier-section]')];
  const anims = [];
  if (reduced()) {
    root.classList.add('frosted');
  } else if (phone()) {
    anims.push(scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: EASE.fade, fill: 'both' }));
    anims.push(panel.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 520, easing: EASE.settle }));
  } else if (fly) {
    src.style.visibility = 'hidden';
    const rTo = (r) => `inset(${(r.top - P.top).toFixed(1)}px ${(P.right - r.right).toFixed(1)}px ${(P.bottom - r.bottom).toFixed(1)}px ${(r.left - P.left).toFixed(1)}px round 12px)`;
    anims.push(panel.animate([{ clipPath: rTo(srcRect) }, { clipPath: 'inset(0px 0px 0px 0px round 16px)' }], { duration: DUR.morphOpen, easing: EASE.move }));
    anims.push(scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EASE.fade, fill: 'both' }));
    // shared elements: one read of their destinations, then translate + uniform scale on the same curve
    for (const [n, s] of Object.entries(srcShared)) {
      const dst = sharedIn(S.body, n);
      if (!dst) continue;
      const d = dst.getBoundingClientRect();
      const scale = n === 'title' ? s.fs / (parseFloat(getComputedStyle(dst).fontSize) || s.fs) : (s.rect.width / (d.width || 1));
      const fromChip = n === 'ring' && s.el.classList.contains('score-chip');
      const kf = [{ transform: `translate(${(s.rect.left - d.left).toFixed(1)}px, ${(s.rect.top - d.top).toFixed(1)}px) scale(${scale.toFixed(4)})`, transformOrigin: 'top left', opacity: fromChip ? 0 : 1 },
        { transform: 'none', transformOrigin: 'top left', opacity: 1 }];
      if (fromChip) kf.splice(1, 0, { opacity: 0, offset: .4 });
      anims.push(dst.animate(kf, { duration: DUR.morphOpen, easing: EASE.move }));
    }
  } else {
    // deep link / off-screen source: the panel simply fades in
    anims.push(scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EASE.fade, fill: 'both' }));
    anims.push(panel.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE.settle }));
  }
  if (!reduced()) {
    sections.slice(0, 6).forEach((sec, i) => {
      anims.push(sec.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: (fly ? 300 : 160) + i * 50, easing: EASE.settle, fill: 'backwards' }));
    });
    if (sections.length > 6) sections.slice(6).forEach(sec => anims.push(sec.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: (fly ? 300 : 160) + 6 * 50, easing: EASE.fade, fill: 'backwards' })));
  }
  S.anims = anims;
  const h1 = S.body.querySelector('h1');
  (h1 || panel).focus({ preventScroll: true });

  const landed = Promise.all(anims.map(a => a.finished.catch(() => {})));
  landed.then(() => {
    if (seq !== S.seq || S.closing) return;
    root.classList.add('frosted'); // frost fades in on a child layer after the flight (E §2)
    S.anims = [];
    try { after.afterFlight?.(); } catch (e) { console.error(e); }
  });
  if (late) {
    dataP.then(async () => {
      if (seq !== S.seq || S.closing) return;
      if (data?.error) { S.body.innerHTML = errorHtml(data.error); return; }
      const out = await fill(S.body, id, data, 'swap');
      if (!reduced()) S.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
      await landed; out.afterFlight?.();
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
  const after = data.error ? (body.innerHTML = errorHtml(data.error), {}) : await fill(body, id, data, 'swap');
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
 */
export function close({ instant = false } = {}) {
  if (!S.open || S.closing) return Promise.resolve();
  S.closing = true; S.seq++;
  const seqAtClose = S.seq;
  const r = S.root, panel = S.panel, scrim = r?.querySelector('.dossier-scrim');
  if (!r) { teardown(); return Promise.resolve(); }
  document.removeEventListener('keydown', S.keyHandler, true);
  if (instant || reduced()) { teardown(); return Promise.resolve(); }
  // mid-flight: reverse what's running (works at any point of the flight)
  if (S.anims.some(a => a.playState === 'running')) {
    const list = S.anims;
    list.forEach(a => { try { a.reverse(); } catch (e) { /* finished */ } });
    return Promise.all(list.map(a => a.finished.catch(() => {}))).then(() => { if (S.seq === seqAtClose) teardown(); });
  }
  r.classList.remove('frosted');
  const anims = [];
  anims.push(S.body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE.exit, fill: 'forwards' }));
  const src = S.src && S.src.isConnected ? S.src : null;
  if (src) src.style.visibility = '';
  const sr = src ? src.getBoundingClientRect() : null;
  if (src) src.style.visibility = 'hidden';
  if (phone()) {
    anims.push(panel.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 320, easing: EASE.exit, fill: 'forwards' }));
    anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: EASE.fade, fill: 'forwards' }));
  } else if (visible(sr)) {
    const P = finalRect();
    const to = `inset(${(sr.top - P.top).toFixed(1)}px ${(P.right - sr.right).toFixed(1)}px ${(P.bottom - sr.bottom).toFixed(1)}px ${(sr.left - P.left).toFixed(1)}px round 12px)`;
    anims.push(panel.animate([{ clipPath: 'inset(0px 0px 0px 0px round 16px)' }, { clipPath: to }], { duration: DUR.morphClose, easing: EASE.move, fill: 'forwards' }));
    anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.morphClose, easing: EASE.fade, fill: 'forwards' }));
  } else {
    anims.push(panel.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], { duration: 280, easing: EASE.exit, fill: 'forwards' }));
    anims.push(scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: EASE.fade, fill: 'forwards' }));
  }
  return Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => { if (S.seq === seqAtClose) teardown(); });
}

function teardown() {
  const opener = S.opener, src = S.src;
  if (src) src.style.visibility = ''; // exact swap on the last frame: no extra fade, no double image
  S.root?.remove();
  if (S.keyHandler) document.removeEventListener('keydown', S.keyHandler, true);
  const wasOpen = S.open;
  Object.assign(S, { open: false, closing: false, id: null, root: null, panel: null, body: null, src: null, opener: null, anims: [], keyHandler: null });
  if (wasOpen) bg.overlay(false);
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
 */
export function railWillChange(targetRailW) {
  if (!S.open || phone() || !S.body) return;
  const cs = getComputedStyle(document.documentElement);
  const inset = parseFloat(cs.getPropertyValue('--shell-inset')) || 12;
  const w = innerWidth - (inset + targetRailW + inset) - inset;
  const max = parseFloat(cs.getPropertyValue('--content-max')) || 1240;
  S.body.style.width = `${Math.min(max, w)}px`;
  S.body.style.maxWidth = 'none';
}
export function railDidChange() { if (S.body) { S.body.style.width = ''; S.body.style.maxWidth = ''; } }

// ------------------------------------------------------------------ minimal honest dossier (until a renderer registers)
const BOILER = /^(this article is adapted|learn about|read on|today, we are excited|we['’]re (excited|highlighting)|features\b|bug fixes|\w+ is an ai safety)/i;
const usable = (t) => !!t && !BOILER.test(t.trim()) && t.trim().split(/\s+/).length >= 8 && !/\n\s*[-*•]/.test(t);
const cleanClaim = (t) => String(t || '').replace(/^\d\s+(?=[A-Z])/, '').replace(/\s+([.,;:!?])/g, '$1').trim();
// highlight %, currency, ×/times, "N of M", or a count followed by a word; never bare years / versions
const NUM = /((?:[$€£]\s?\d[\d,.]*\s?(?:[kmb]n?|million|billion|trillion)?)|(?:\d[\d,.]*\s?%)|(?:\d[\d,.]*\s?(?:×|x|times)\b)|(?:\b\d+\s+of\s+\d+\b)|(?:\b(?!(?:19|20)\d{2}\b)\d[\d,.]*(?:\s(?:million|billion|trillion))?\s(?=[a-z]{3,})))/gi;
const hl = (t) => esc(t).replace(NUM, (m) => (/^v?\d+\.\d+\.\d+/.test(m) ? m : `<mark class="num-hl">${m}</mark>`));

function placeholderHtml(title) {
  return `<header class="dz-head" data-dossier-section><div><p class="eyebrow">Loading the dossier…</p>${title ? `<h1 class="dz-title">${esc(title)}</h1>` : '<span class="sk sk-line xl" style="width:70%;margin-top:14px"></span>'}</div></header>
    <div class="dz-grid"><div class="tile tile--static"><span class="sk sk-line lg" style="width:60%"></span><span class="sk sk-line" style="width:90%;margin-top:12px"></span><span class="sk sk-line" style="width:80%;margin-top:10px"></span></div><div class="tile tile--static"><span class="sk sk-line lg" style="width:40%"></span></div></div>`;
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
