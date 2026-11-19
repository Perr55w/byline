/* Effects adapted from React Bits (MIT + Commons Clause), David Haz
   (MaskedHeading/SplitText, EchoText, TextType, SplitFlapText, VariableProximity, FoldText).
   Vanilla ports for Byline, no build step. Only the listed ideas are ported.

   castHeading(h1, { hero, delay })   Slug cast: word mask rise onto a drawn baseline rule
   registerPlates(el)                 Plates into register: red/blue copies snap into register
   typeDek(el, { delay })             Wire dek: teletype the dek with a red block cursor
   flapTo(el, text, { reserve, animate })  Issue flap: split-flap digits, zero layout shift
   inkPressure(nameplateEl)           Ink pressure: per-letter wght/opsz near the pointer
   unfold(el)                         Below the fold: block unfolds from a top hinge

   Pairs with /css/fx-type.css. All motion is transform/opacity via WAAPI;
   under prefers-reduced-motion every function leaves the final static state. */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const token = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const EASE = {
  press: () => token('--ease-press', 'cubic-bezier(.16, 1, .3, 1)'),
  stamp: () => token('--ease-stamp', 'cubic-bezier(.3, 1.5, .6, 1)'),
  rule: () => token('--ease-rule', 'cubic-bezier(.65, 0, .35, 1)'),
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const done = (anim) => anim.finished.catch(() => {});
function span(cls, text) { const s = document.createElement('span'); if (cls) s.className = cls; if (text != null) s.textContent = text; return s; }
function textNodes(root) {
  const out = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
  return out;
}

/* ================================================================ 1 Slug cast */
function splitWords(h1) {
  for (const t of textNodes(h1)) {
    const parts = t.data.split(/(\s+)/);
    if (parts.length === 1 && !parts[0]) continue;
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) { frag.append(p); continue; }
      const w = span('fx-w'); w.setAttribute('aria-hidden', 'true');
      w.append(span('fx-wi', p)); frag.append(w);
    }
    t.replaceWith(frag);
  }
}
/** Group word wrappers into visual lines and find each line's baseline (relative to h1). */
function measureLines(h1, words) {
  const box = h1.getBoundingClientRect();
  const marks = words.map(w => { const m = document.createElement('i'); m.style.cssText = 'display:inline-block;width:0;height:0'; w.append(m); return m; });
  const lines = [];
  words.forEach((w, i) => {
    const r = w.getBoundingClientRect(); const base = marks[i].getBoundingClientRect().top - box.top;
    let line = lines.find(l => Math.abs(l.base - base) < 2);
    if (!line) { line = { base, left: Infinity, right: -Infinity, words: [] }; lines.push(line); }
    line.left = Math.min(line.left, r.left - box.left); line.right = Math.max(line.right, r.right - box.left); line.words.push(w);
  });
  marks.forEach(m => m.remove());
  return lines.sort((a, b) => a.base - b.base);
}

/**
 * Slug cast. Resolves when the last word lands.
 * @param {HTMLElement} h1
 * @param {{hero?: boolean, delay?: number}} [opts]
 */
export async function castHeading(h1, { hero = false, delay = 0 } = {}) {
  if (!h1) return;
  if (reduced()) { delete h1.dataset.fxCast; return; }
  const fresh = !h1.querySelector('.fx-w');
  if (fresh) { h1.setAttribute('aria-label', h1.textContent.replace(/\s+/g, ' ').trim()); }
  h1.dataset.fxCast = 'pending';
  h1._fxCast?.forEach(a => a.cancel());
  h1.querySelectorAll('.fx-rule').forEach(r => r.remove());
  await Promise.race([document.fonts?.load('600 1em Newsreader').catch(() => {}), wait(300)]);
  if (!h1.isConnected) return;
  if (fresh) splitWords(h1);
  const words = [...h1.querySelectorAll('.fx-w')];
  const lines = measureLines(h1, words);

  const ruleMs = hero ? 360 : 300, wordMs = hero ? 600 : 520, stagger = hero ? 65 : 55, lineGap = 60;
  const anims = [];
  const rules = lines.map((l, i) => {
    const r = document.createElement('i'); r.className = 'fx-rule'; r.setAttribute('aria-hidden', 'true');
    r.style.cssText = `left:${l.left}px;width:${Math.max(0, l.right - l.left)}px;top:${Math.round(l.base)}px`;
    h1.prepend(r); // under the words in paint order
    anims.push(r.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ruleMs, delay: delay + i * lineGap, easing: EASE.rule(), fill: 'backwards' }));
    return r;
  });
  const start = delay + ruleMs;
  let k = 0, last;
  for (const l of lines) for (const w of l.words) {
    last = w.firstElementChild.animate(
      [{ transform: 'translateY(calc(105% + .2em))' }, { transform: 'none' }],
      { duration: wordMs, delay: start + (k++) * stagger, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' });
    anims.push(last);
  }
  // the rule lifts as the last slug seats, so the landed heading is clean
  const fadeAt = start + Math.max(0, k - 1) * stagger + wordMs * 0.45;
  rules.forEach(r => anims.push(r.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, delay: fadeAt, easing: 'ease-out', fill: 'forwards' })));
  h1._fxCast = anims;
  h1.dataset.fxCast = 'run';
  if (last) await done(last);
  if (h1._fxCast !== anims) return; // superseded by a newer cast
  h1.dataset.fxCast = 'done';
  rules.forEach(r => r.remove());
  if (hero) registerPlates(h1);
}

/* ================================================================ 2 Plates into register */
/**
 * Red and blue aria-hidden copies, offset, snap into register then fade and remove.
 * @param {HTMLElement} el
 * @returns {Promise<void>}
 */
export async function registerPlates(el) {
  if (!el || reduced() || el._fxPlates) return;
  const cs = getComputedStyle(el);
  const restorePos = cs.position === 'static' ? (el.style.position = 'relative', true) : false;
  const make = (cls, dx, dy) => {
    const p = span(`fx-plate ${cls}`); p.setAttribute('aria-hidden', 'true');
    for (const n of el.childNodes) p.append(n.cloneNode(true));
    p.querySelectorAll('.fx-plate, .fx-rule, .np-ink, .np-roller, .fx-sr, .fx-caret').forEach(x => x.remove());
    p.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
    el.append(p);
    return p.animate([
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.75, easing: EASE.stamp() },
      { transform: 'none', opacity: 0.75, offset: 0.667, easing: 'ease-out' },
      { transform: 'none', opacity: 0 },
    ], { duration: 360, fill: 'both' });
  };
  const anims = [make('fx-red', -2, 1), make('fx-blue', 2, -1)];
  el._fxPlates = anims;
  await Promise.all(anims.map(done));
  anims.forEach(a => a.effect.target.remove());
  if (restorePos) el.style.position = '';
  el._fxPlates = null;
}

/* ================================================================ 3 Wire dek */
/**
 * Teletype the element's text (inline markup kept), ≤500 ms, then a red block cursor blinks twice.
 * The original nodes sit in a visually-hidden copy throughout and are restored at the end.
 * @param {HTMLElement} el
 * Pass `after` (e.g. the castHeading promise) to hide the dek at once and type when it resolves.
 * @param {{delay?: number, after?: Promise<any>}} [opts]
 */
export function typeDek(el, { delay = 0, after = null } = {}) {
  if (!el || reduced()) return Promise.resolve();
  el._fxType?.finish();
  const originals = [...el.childNodes];
  const sr = span('fx-sr'); sr.append(...originals);
  const vis = span('fx-typed'); vis.setAttribute('aria-hidden', 'true');
  originals.forEach(n => vis.append(n.cloneNode(true)));
  const segs = textNodes(vis).filter(t => t.data.length).map(t => {
    const hidden = span('fx-untyped', t.data); const full = t.data; t.data = ''; t.after(hidden);
    return { t, hidden, full };
  });
  const caret = span('fx-caret'); caret.setAttribute('aria-hidden', 'true');
  el.replaceChildren(sr, vis);
  const total = segs.reduce((n, s) => n + s.full.length, 0);
  const dur = Math.min(500, Math.max(160, total * 9));

  return new Promise(resolve => {
    let raf = 0, t0 = 0, shown = -1, blink = null, timer = 0;
    const restore = () => { cancelAnimationFrame(raf); clearTimeout(timer); blink?.cancel(); el.replaceChildren(...originals); el._fxType = null; resolve(); };
    el._fxType = { finish: restore };
    const paint = (k) => {
      let left = k, end = null;
      for (const s of segs) {
        const n = Math.max(0, Math.min(s.full.length, left)); left -= s.full.length;
        if (s.t.data.length !== n) { s.t.data = s.full.slice(0, n); s.hidden.textContent = s.full.slice(n); }
        if (n > 0) end = s.t;
      }
      if (end && caret.previousSibling !== end) end.after(caret);
    };
    const frame = (now) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / dur);
      const k = Math.round(total * p);
      if (k !== shown) { shown = k; paint(k); }
      if (p < 1) { raf = requestAnimationFrame(frame); return; }
      blink = caret.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], { duration: 260, iterations: 2 });
      done(blink).then(restore);
    };
    const go = () => { if (el._fxType?.finish === restore) timer = setTimeout(() => { raf = requestAnimationFrame(frame); }, delay); };
    after ? Promise.resolve(after).catch(() => {}).then(go) : go();
  });
}

/* ================================================================ 4 Issue flap */
const DIGIT = /\d/;
function buildFlap(el, text, reserve) {
  const st = el._fxFlap || (el._fxFlap = { max: 0 });
  st.text = text;
  st.sr = span('fx-sr', text);
  const line = span('fx-flapline'); line.setAttribute('aria-hidden', 'true');
  st.cells = [];
  let run = '';
  for (const ch of text) {
    if (DIGIT.test(ch)) {
      if (run) { line.append(run); run = ''; }
      const c = span('fx-cell'); const g = span('fx-g', ch); c.append(g); line.append(c);
      st.cells.push({ c, g });
    } else { run += ch; st.cells.push(null); }
  }
  if (run) line.append(run);
  el.replaceChildren(st.sr, line);
  st.line = line;
  if (reserve) {
    // reserve in ch: the widest string seen so far (Martian Mono is monospace; letter-spacing added)
    const len = [...text].length;
    if (len >= st.max) { st.max = len; st.reserve = line.getBoundingClientRect().width / len; } // per-char advance (ch + letter-spacing), measured
    line.style.minWidth = `${(st.max * (st.reserve || 0)).toFixed(3)}px`;
  }
  return st;
}
function flapCell(cell, final, startDelay) {
  const { c, g } = cell;
  const seq = [];
  let prev = g.textContent;
  for (let i = 0; i < 3; i++) { let d; do { d = String(Math.floor(Math.random() * 10)); } while (d === prev || d === final); seq.push(d); prev = d; }
  seq.push(final);
  return new Promise(resolve => {
    setTimeout(async () => {
      c.classList.add('fx-flapping');
      for (const ch of seq) {
        g.textContent = ch;
        await done(g.animate([{ transform: 'perspective(160px) rotateX(-84deg)' }, { transform: 'none' }], { duration: 90, easing: 'cubic-bezier(.3, 0, .2, 1)' }));
      }
      c.classList.remove('fx-flapping');
      resolve();
    }, startDelay);
  });
}
/**
 * Split-flap display for short strings. Only digits flap (3 random flips at 90 ms each).
 * First call renders static unless {animate:true}; later calls flap only changed digits.
 * @param {HTMLElement} el
 * @param {string} text
 * @param {{reserve?: boolean, animate?: boolean}} [opts]
 */
export async function flapTo(el, text, { reserve = true, animate = false } = {}) {
  if (!el) return;
  text = String(text);
  const prev = el._fxFlap?.text;
  if (prev === text && el.contains(el._fxFlap.line)) return;
  const sameShape = prev != null && [...prev].length === [...text].length && el.contains(el._fxFlap.line);
  if (!sameShape || reduced()) {
    const st = buildFlap(el, text, reserve);
    if (reduced() || (prev == null && !animate)) return;
    // new shape (or first animated call): flap every digit in from a random face
    const chars = [...text];
    await Promise.all(st.cells.map((cell, i) => cell && flapCell(cell, chars[i], i * 30)).filter(Boolean));
    return;
  }
  const st = el._fxFlap;
  const a = [...prev], b = [...text];
  st.text = text; st.sr.textContent = text;
  const jobs = []; let order = 0;
  // non-digit changes swap in place (same shape, so cell indexes line up)
  if (a.some((ch, i) => ch !== b[i] && (!DIGIT.test(ch) || !DIGIT.test(b[i])))) {
    const keep = st.cells.map(c => c && c.g.textContent);
    buildFlap(el, text, reserve);
    st.cells.forEach((c, i) => { if (c && keep[i] != null && DIGIT.test(keep[i])) c.g.textContent = keep[i]; });
  }
  st.cells.forEach((cell, i) => { if (cell && cell.g.textContent !== b[i]) jobs.push(flapCell(cell, b[i], (order++) * 30)); });
  await Promise.all(jobs);
}

/* ================================================================ 5 Ink pressure */
const GAUSS_EDGE = Math.exp(-2);
const gauss = (d, r) => (d >= r ? 0 : (Math.exp(-2 * (d / r) ** 2) - GAUSS_EDGE) / (1 - GAUSS_EDGE));
function splitLetters(parent) {
  const letters = [];
  for (const n of [...parent.childNodes]) {
    if (n.nodeType !== 3 || !n.data.trim()) continue;
    const frag = document.createDocumentFragment();
    for (const ch of n.data) { const l = span('fx-l', ch); letters.push(l); frag.append(l); }
    n.replaceWith(frag);
  }
  return letters;
}
/**
 * VariableProximity on the nameplate: per-letter Newsreader wght/opsz within a gaussian radius.
 * Fine pointer + hover only; rAF runs only while the pointer is inside the masthead and letters are moving.
 * @param {HTMLElement} np  the .nameplate anchor
 * @param {{radius?: number, rest?: {wght:number, opsz:number}, max?: {wght:number, opsz:number}}} [opts]
 * @returns {() => void} destroy
 */
export function inkPressure(np, { radius = 90, rest = { wght: 700, opsz: 48 }, max = { wght: 800, opsz: 72 } } = {}) {
  if (!np) return () => {};
  if (np._fxInk) return np._fxInk;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || reduced()) return () => {};
  const word = np.querySelector('.np-word') || np;
  const inkLayer = word.querySelector('.np-ink');
  const original = word.innerHTML;
  const base = splitLetters(word);
  const inked = inkLayer ? splitLetters(inkLayer) : [];
  const pairs = base.map((l, i) => [l, inked[i]].filter(Boolean));
  const set = (i, s) => {
    const w = (rest.wght + (max.wght - rest.wght) * s).toFixed(1), o = (rest.opsz + (max.opsz - rest.opsz) * s).toFixed(1);
    for (const l of pairs[i]) { l.style.setProperty('--fx-wght', w); l.style.setProperty('--fx-opsz', o); }
  };
  // reserve the widest state so neighbours never move
  base.forEach((_, i) => set(i, 1));
  np.dataset.fxInk = '';
  np.style.width = `${np.getBoundingClientRect().width}px`;
  base.forEach((_, i) => set(i, 0));

  const mast = np.closest('.masthead') || np.parentElement;
  const cur = base.map(() => 0);
  let centers = [], px = -1e4, py = -1e4, inside = false, raf = 0;
  const frame = () => {
    raf = 0; let moving = false;
    for (let i = 0; i < base.length; i++) {
      const target = inside ? gauss(Math.hypot(px - centers[i].x, py - centers[i].y), radius) : 0;
      const next = cur[i] + (target - cur[i]) * 0.3;
      const settled = Math.abs(target - next) < 0.004;
      const v = settled ? target : next;
      if (v !== cur[i]) { cur[i] = v; set(i, v); }
      if (!settled) moving = true;
    }
    if (moving && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const move = (e) => { px = e.clientX; py = e.clientY; kick(); };
  // pointerover/out (with relatedTarget checks) rather than enter/leave: enter is skipped when the
  // pointer is already over the masthead at load, which would leave the effect dead until a re-entry
  const enter = (e) => {
    if (inside) return;
    inside = true;
    centers = base.map(l => { const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    mast.addEventListener('pointermove', move, { passive: true });
    move(e);
  };
  const leave = () => { inside = false; mast.removeEventListener('pointermove', move); kick(); };
  const out = (e) => { if (!e.relatedTarget || !mast.contains(e.relatedTarget)) leave(); };
  const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; inside = false; base.forEach((_, i) => { cur[i] = 0; set(i, 0); }); } };
  mast.addEventListener('pointerover', enter, { passive: true });
  mast.addEventListener('pointerout', out, { passive: true });
  document.addEventListener('visibilitychange', vis);
  const destroy = () => {
    cancelAnimationFrame(raf); leave();
    mast.removeEventListener('pointerover', enter); mast.removeEventListener('pointerout', out);
    document.removeEventListener('visibilitychange', vis);
    word.innerHTML = original; np.style.width = ''; delete np.dataset.fxInk; np._fxInk = null;
  };
  np._fxInk = destroy;
  return destroy;
}

/* ================================================================ 12 Below the fold */
/**
 * FoldText-style block unfold from a top hinge. Waits (IntersectionObserver) when the block is below the viewport.
 * @param {HTMLElement} el
 * @returns {Promise<void>} resolves when unfolded
 */
export function unfold(el) {
  if (!el || reduced()) return Promise.resolve();
  if (el._fxUnfold) return el._fxUnfold;
  const deg = matchMedia('(max-width: 760px)').matches ? 60 : 88;
  el.style.setProperty('--fx-fold-deg', `${deg}deg`);
  const p = new Promise(resolve => {
    const run = () => {
      el.classList.add('fx-unfold');
      el.classList.remove('fx-folded');
      const a = el.animate([{ transform: `perspective(900px) rotateX(-${deg}deg)` }, { transform: 'perspective(900px) rotateX(0deg)' }],
        { duration: 520, easing: EASE.press() });
      try { el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, easing: 'ease-out', pseudoElement: '::after' }); } catch (e) { /* no pseudo animations */ }
      done(a).then(() => { el.classList.remove('fx-unfold'); el.style.removeProperty('--fx-fold-deg'); el._fxUnfold = null; resolve(); });
    };
    if (el.getBoundingClientRect().top < innerHeight * 0.9) { run(); return; }
    el.classList.add('fx-folded');
    const io = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting) || !el.isConnected) return;
      io.disconnect(); run();
    }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
  });
  el._fxUnfold = p;
  return p;
}
