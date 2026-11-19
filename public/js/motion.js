// Motion helpers (council C §1–4; E §3). Every animation is transform / opacity / clip-path, except the page
// h1, which may also animate filter (blur), letter-spacing and font-variation-settings (C amendment 2).
// Reduced motion: final state immediately, no Animation objects created.
//
//   enterHeading(h1, { variant: 'load' | 'tab', lede, eyebrow })  "Settle" — line-split heading entrance
//   prepareHeading(h1)                                             do enterHeading's reads early (router, hidden page)
//   enterItems(container | elements, { stagger, cap, delay, y })  block arrivals with a capped stagger
//   exitView(el)                                                   200ms fade + drift out
//   flip(el, fromRect, opts) / rectDelta(from, to)                 FLIP helpers (transform only)
//   countTo(el, n, { ring, threshold, duration, decimals, key })    exponential count-up, ring + colour on the same progress
//   easeCount(t, k)                                                p = (1 − e^(−k t)) / (1 − e^(−k))
//   EASE, DUR                                                      token values read once from tokens.css

import { qualityColor, qualityTier, paintRingGradient } from './quality.js';

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const cs = getComputedStyle(document.documentElement);
const tok = (n, f) => (cs.getPropertyValue(n).trim() || f);
const ms = (n, f) => { const v = tok(n, ''); const m = /([\d.]+)\s*(ms|s)?/.exec(v); return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : f; };
// Easings are read once; durations are read once but reduced motion is checked per call (the token
// durations collapse to 0 under reduced motion, so read the authored values here as fallbacks).
export const EASE = Object.freeze({
  settle: tok('--ease-settle', 'cubic-bezier(.25,.1,.05,1)'),
  fade: tok('--ease-fade', 'cubic-bezier(.33,0,.2,1)'),
  exit: tok('--ease-exit', 'cubic-bezier(.4,0,1,1)'),
  move: tok('--ease-move', 'cubic-bezier(.45,0,.15,1)'),
  ambient: tok('--ease-ambient', 'cubic-bezier(.37,0,.63,1)'),
  press: tok('--ease-press', 'cubic-bezier(.2,0,0,1)')
});
const DEF = { press: 120, release: 240, micro: 160, hoverIn: 240, hoverOut: 360, exit: 200, fade: 450, settle: 900, heading: 1000, headingTab: 600, layout: 420, morphOpen: 600, morphClose: 440, count: 1400, count2: 1100, theme: 600, ambient: 1600, staggerLine: 120, staggerLineTab: 60, staggerTile: 90, staggerItem: 40 };
export const DUR = Object.freeze(Object.fromEntries(Object.entries(DEF).map(([k, v]) => {
  const name = '--' + (k.startsWith('stagger') ? k.replace(/([A-Z])/g, '-$1').toLowerCase() : 'dur-' + k.replace(/([A-Z])/g, '-$1').toLowerCase());
  const read = ms(name, v);
  return [k, read || v];
})));

/** p = (1 − e^(−k t)) / (1 − e^(−k)); visibly slows near the end (C §2). */
export const easeCount = (t, k = 4) => (1 - Math.exp(-k * Math.min(1, Math.max(0, t)))) / (1 - Math.exp(-k));

// Running animations per element, so a new entrance (or a route change) can finish the old one instantly.
const running = new WeakMap();
function track(el, anims) {
  const list = running.get(el) || [];
  list.push(...anims);
  running.set(el, list);
  return anims;
}
/** Finish every in-flight motion.js animation on `el` (interruptibility: last input wins). */
export function finish(el) {
  const list = running.get(el);
  if (!list) return;
  list.forEach(a => { try { a.finish(); } catch (e) { /* already gone */ } });
  running.delete(el);
}

// ------------------------------------------------------------------ line split that preserves inline markup
/**
 * Split `el` into one `.ln` block per rendered line, keeping inline elements (em, b, a, span) intact by
 * cloning their ancestry into each line. Words are never split. Returns the line elements.
 * Idempotent: an element that already holds `.ln` children is returned as is.
 */
export function splitLines(el) {
  const existing = el.querySelectorAll(':scope > .ln');
  if (existing.length) return [...existing];
  // 1) wrap every word in a measuring span, inside its own inline parents
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  const words = [];
  for (const t of texts) {
    const parts = t.nodeValue.split(/(\s+)/);
    if (parts.length <= 1 && !t.nodeValue.trim()) continue;
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) frag.append(document.createTextNode(' '));
      else { const s = document.createElement('span'); s.className = 'w-tmp'; s.textContent = p; frag.append(s); words.push(s); }
    }
    t.replaceWith(frag);
  }
  if (!words.length) return [];
  // 2) one read pass: line index from offsetTop
  const tops = words.map(w => w.offsetTop);
  const lineTops = [...new Set(tops.map(v => Math.round(v)))].sort((a, b) => a - b);
  const lineOf = new Map(words.map((w, i) => [w, lineTops.findIndex(v => Math.abs(v - tops[i]) < 3)]));
  // 3) rebuild: walk leaves in order and clone their inline ancestry into the right line
  const lines = lineTops.map(() => { const d = document.createElement('span'); d.className = 'ln'; return d; });
  let current = 0;
  const chainCache = lines.map(() => new Map());
  const placeLeaf = (leaf, li) => {
    const ancestors = [];
    for (let p = leaf.parentNode; p && p !== el; p = p.parentNode) ancestors.unshift(p);
    let target = lines[li];
    for (const a of ancestors) {
      let clone = chainCache[li].get(a);
      if (!clone || clone.parentNode !== target) {
        clone = a.cloneNode(false);
        target.append(clone);
        chainCache[li].set(a, clone);
      }
      target = clone;
    }
    if (leaf.classList?.contains('w-tmp')) target.append(document.createTextNode(leaf.textContent));
    else target.append(leaf.cloneNode(true));
  };
  const leaves = [];
  const collect = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) leaves.push(c);
      else if (c.nodeType === 1 && (c.classList.contains('w-tmp') || c.tagName === 'BR' || c.tagName === 'SVG' || c.tagName === 'IMG' || !c.childNodes.length)) leaves.push(c);
      else if (c.nodeType === 1) collect(c);
    }
  };
  collect(el);
  const pendingSpace = [];
  for (const leaf of leaves) {
    if (leaf.nodeType === 1 && leaf.classList.contains('w-tmp')) {
      const li = lineOf.get(leaf);
      if (li === current) pendingSpace.forEach(s => placeLeaf(s, li));
      pendingSpace.length = 0;
      current = li;
      placeLeaf(leaf, li);
    } else if (leaf.nodeType === 3) {
      if (!leaf.nodeValue.trim()) pendingSpace.push(leaf); // spaces only between words on the same line
      else placeLeaf(leaf, current);
    } else if (leaf.tagName !== 'BR') placeLeaf(leaf, current);
  }
  el.replaceChildren(...lines);
  return lines;
}

// ------------------------------------------------------------------ Settle (C §1)
const seenHeadings = new Map(); // route key → heading text, for the "same text again" plain fade
const prepared = new WeakMap();
function measureHeading(el) {
  const style = getComputedStyle(el);
  const fs = parseFloat(style.fontSize) || 48;
  const ls = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) || 0;
  const wMatch = /"?wght"?\s+([\d.]+)/.exec(style.fontVariationSettings || '');
  const W = wMatch ? Number(wMatch[1]) : Number(style.fontWeight) || 400;
  const oMatch = /"?opsz"?\s+([\d.]+)/.exec(style.fontVariationSettings || '');
  const O = oMatch ? Number(oMatch[1]) : 72;
  return { fs, ls, W, O, lines: splitLines(el) };
}
/**
 * Do enterHeading's reads (computed style, line split) ahead of time, while the layout is already clean
 * (the router calls this on the still-hidden page one frame after render), so the swap itself reads nothing.
 */
export function prepareHeading(el) {
  if (!el || reduced() || prepared.has(el)) return;
  prepared.set(el, measureHeading(el));
}

/**
 * Heading entrance. variant 'load' (≈1000ms, opsz/wght/tracking morph + blur on the h1 lines) or 'tab'
 * (≈600ms, shorter, no tracking/weight change). Pass `lede` / `eyebrow` elements to choreograph the
 * rest of the header. `key` (route) enables the plain 240ms fade when the same text returns.
 * Returns a Promise that resolves when the heading is at rest.
 */
export function enterHeading(el, { variant = 'load', lede = null, eyebrow = null, key = null, delay = 0 } = {}) {
  if (!el) return Promise.resolve();
  finish(el);
  if (reduced()) return Promise.resolve();
  const text = el.textContent.trim();
  const anims = [];
  const opts = (d, dur, easing) => ({ duration: dur, delay: d, easing, fill: 'backwards' });
  if (key && seenHeadings.get(key) === text) {
    anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], opts(delay, 240, EASE.fade)));
    if (lede) anims.push(lede.animate([{ opacity: 0 }, { opacity: 1 }], opts(delay, 240, EASE.fade)));
    track(el, anims);
    return Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => {});
  }
  if (key) seenHeadings.set(key, text);

  const { fs, ls, W, O, lines } = prepared.get(el) || measureHeading(el);
  prepared.delete(el);
  const load = variant === 'load';
  const stagger = load ? DUR.staggerLine : DUR.staggerLineTab;
  const dur = load ? DUR.heading : DUR.headingTab;
  el.style.willChange = 'opacity';
  lines.forEach((ln, i) => {
    const d = delay + (load ? 60 : 0) + i * stagger;
    ln.style.willChange = 'transform, opacity, filter';
    anims.push(ln.animate([{ opacity: 0 }, { opacity: 1 }], opts(d, load ? 700 : 420, EASE.fade)));
    anims.push(ln.animate([{ transform: `translateY(${load ? 0.10 : 0.06}em)`, filter: `blur(${load ? 6 : 3}px)` }, { transform: 'none', filter: 'blur(0px)' }], opts(d, dur, EASE.settle)));
    if (load) {
      anims.push(ln.animate([
        { fontVariationSettings: `"opsz" 24, "wght" ${W - 100}`, letterSpacing: `${(ls + 0.02 * fs).toFixed(2)}px` },
        { fontVariationSettings: `"opsz" ${O}, "wght" ${W}`, letterSpacing: `${ls.toFixed(2)}px` }], opts(d, dur, EASE.settle)));
    } else {
      anims.push(ln.animate([{ fontVariationSettings: `"opsz" ${Math.max(6, O - 24)}, "wght" ${W}` }, { fontVariationSettings: `"opsz" ${O}, "wght" ${W}` }], opts(d, dur, EASE.settle)));
    }
  });
  const extra = Math.max(0, lines.length - 1);
  if (eyebrow) anims.push(eyebrow.animate([{ opacity: 0 }, { opacity: 1 }], opts(delay, 500, EASE.fade)));
  if (lede) {
    const d = delay + (load ? 420 + 120 * extra : 160);
    anims.push(lede.animate([{ opacity: 0 }, { opacity: 1 }], opts(d, load ? 600 : 450, EASE.fade)));
    anims.push(lede.animate([{ transform: `translateY(${load ? 6 : 4}px)` }, { transform: 'none' }], opts(d, load ? 800 : 450, EASE.settle)));
  }
  track(el, anims);
  return Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => {
    el.style.willChange = '';
    lines.forEach(ln => { ln.style.willChange = ''; });
  });
}

// ------------------------------------------------------------------ block arrivals / exits
/**
 * Fade + rise blocks in with a capped stagger (C §3: 40ms, cap 8; items past the cap arrive with the 8th).
 * `target`: a container (its children animate) or an array/NodeList of elements.
 */
export function enterItems(target, { stagger = DUR.staggerItem, cap = 8, delay = 0, y = 10, duration = 600, fadeDuration = DUR.fade } = {}) {
  const items = target instanceof Element ? [...target.children] : [...(target || [])];
  if (!items.length || reduced()) return Promise.resolve();
  const anims = [];
  items.forEach((el, i) => {
    finish(el);
    const d = delay + Math.min(i, cap) * stagger;
    const a1 = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fadeDuration, delay: d, easing: EASE.fade, fill: 'backwards' });
    const a2 = el.animate([{ transform: `translateY(${y}px)` }, { transform: 'none' }], { duration, delay: d, easing: EASE.settle, fill: 'backwards' });
    track(el, [a1, a2]);
    anims.push(a1, a2);
  });
  return Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => {});
}

/** Old view out: opacity → 0, translateY → −6px over 200ms (exit curve). Resolves when done. */
export function exitView(el, { duration = DUR.exit } = {}) {
  if (!el || reduced()) return Promise.resolve();
  finish(el);
  const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration, easing: EASE.exit, fill: 'forwards' });
  track(el, [a]);
  return a.finished.catch(() => {});
}

// ------------------------------------------------------------------ FLIP
/** Transform that maps rect `to` onto rect `from` (translate + independent scale). */
export function rectDelta(from, to) {
  const sx = from.width / (to.width || 1), sy = from.height / (to.height || 1);
  return { x: from.left - to.left, y: from.top - to.top, sx, sy, transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})` };
}
/**
 * Play `el` from `fromRect` to where it is now. `uniform: true` uses one scale (text: no squash).
 * Returns the Animation (or null under reduced motion).
 */
export function flip(el, fromRect, { duration = DUR.morphOpen, easing = EASE.move, uniform = false, reverse = false, origin = 'top left' } = {}) {
  if (!el || !fromRect || reduced()) return null;
  const to = el.getBoundingClientRect();
  let t;
  if (uniform) { const s = fromRect.height / (to.height || 1); t = `translate(${fromRect.left - to.left}px, ${fromRect.top - to.top}px) scale(${s})`; }
  else t = rectDelta(fromRect, to).transform;
  const frames = [{ transform: t, transformOrigin: origin }, { transform: 'none', transformOrigin: origin }];
  const a = el.animate(reverse ? frames.reverse() : frames, { duration, easing, fill: reverse ? 'forwards' : 'none' });
  track(el, [a]);
  return a;
}

// ------------------------------------------------------------------ count-up (C §2, E §6.3)
const SESSION_KEY = 'byline-counted';
let countedMemo = null;
function counted() {
  if (countedMemo) return countedMemo;
  try { countedMemo = new Set(JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]')); } catch (e) { countedMemo = new Set(); }
  return countedMemo;
}
function remember(k) {
  const s = counted(); s.add(k);
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify([...s].slice(-400))); } catch (e) { /* storage unavailable */ }
}

/**
 * Count `el` up to `n` once per session per (key, value). Only textContent changes, inside a tabular-nums
 * box reserved to the final width. `ring`: an element holding `.ring-arc` (circle with r) — its
 * stroke-dashoffset and its `--q` colour follow the same progress, so the ring turns from slate to blue
 * exactly as the number crosses the threshold. Never use in the dossier or on Feed chips (DECISIONS).
 */
export function countTo(el, n, { ring = null, threshold, duration = DUR.count, decimals = 0, from = 0, key = null } = {}) {
  if (!el) return Promise.resolve();
  const target = Number(n) || 0;
  const fmt = (v) => (decimals ? v.toFixed(decimals) : String(Math.round(v)));
  const final = fmt(target);
  el.classList.add('count');
  if (!el.style.minWidth) el.style.minWidth = `${final.length}ch`;
  const arc = ring ? (ring.matches?.('.ring-arc') ? ring : ring.querySelector('.ring-arc')) : null;
  const host = ring ? (ring.closest?.('.score-ring') || ring) : null;
  const C = arc ? Number(arc.dataset.c || (2 * Math.PI * Number(arc.getAttribute('r') || 0))) : 0;
  const paint = (v) => {
    el.textContent = fmt(v);
    if (arc) arc.style.strokeDashoffset = String(C * (1 - Math.max(0, Math.min(100, v)) / 100));
    if (host) { host.style.setProperty('--q', qualityColor(v, threshold)); host.dataset.q = qualityTier(v, threshold); paintRingGradient(host, v, threshold); }
  };
  const k = `${key || el.dataset.countKey || el.closest('[data-count-key]')?.dataset.countKey || 'n'}:${final}`;
  if (reduced() || counted().has(k) || document.hidden) { paint(target); remember(k); return Promise.resolve(); }
  remember(k);
  return new Promise((resolve) => {
    const t0 = performance.now();
    paint(from);
    const step = (now) => {
      if (!el.isConnected) { resolve(); return; }
      const t = Math.min(1, (now - t0) / duration);
      const v = from + (target - from) * easeCount(t, 4);
      paint(t < 1 ? v : target);
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}
