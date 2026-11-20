// ⌘K Index (F amendment 5): a combobox over four groups — Go to, Stories, Actions, Settings (+ Recent
// when empty). No match → "Search the archive for “x”" opens Search (#/search/<query>).
// Also: single-key shortcuts (g-chords, j/k, o, n, [, ?), the shortcut sheet and Alt keytips.
// Wired from app.js with initIndex() / initShortcuts() / keytips().

import { api } from './api.js';
import { esc, modal, isSheet, inField, reducedMotion, scoreChip } from './ui.js';
import { EASE } from './motion.js';

const RECENT_KEY = 'byline-recent';
const MAX_RECENT = 5;
const GROUPS = [['recent', 'Recent'], ['tabs', 'Go to'], ['stories', 'Stories'], ['actions', 'Actions'], ['settings', 'Settings']];
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

const cfg = { nav: [], go: (h) => { location.hash = h; }, actions: [], settings: [], handlers: {} };
const touchOnly = () => matchMedia('(hover: none)').matches;
const otherModal = () => !!document.querySelector('.modal-wrap:not(.ix-sheet-wrap)');

// ---------------------------------------------------------------- recent
function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, MAX_RECENT) : []; } catch (e) { return []; }
}
function pushRecent(it) {
  if (it.kind === 'archive') return;
  const entry = { kind: it.kind, id: it.id, label: it.label, meta: it.meta || '', href: it.href || null, score: it.score ?? null };
  const next = [entry, ...readRecent().filter(r => !(r.kind === entry.kind && String(r.id) === String(entry.id)))].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch (e) { /* storage unavailable */ }
}
function hydrateRecent(r) {
  if (r.kind === 'actions') { const a = cfg.actions.find(x => x.id === r.id); return a ? actionItem(a) : null; }
  if (r.kind === 'settings') { const a = cfg.settings.find(x => x.id === r.id); return a ? settingItem(a) : null; }
  if (r.kind === 'tabs') { const n = cfg.nav.find(x => x.href === r.id); return n ? tabItem(n) : null; }
  return r.href ? { ...r } : null;
}

// ---------------------------------------------------------------- items
const tabItem = (n) => ({ kind: 'tabs', id: n.href, label: n.label, href: n.href, icon: n.route, keys: n.key ? ['G', n.key.toUpperCase()] : null, extra: n.group });
const actionItem = (a) => ({ kind: 'actions', id: a.id, label: a.label, hint: a.hint || '', run: a.run, icon: 'chevron-right' });
const settingItem = (a) => ({ kind: 'settings', id: a.id, label: a.label, run: a.run, icon: 'settings', meta: 'Settings' });
const fmtShort = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const storyItem = (s) => ({ kind: 'stories', id: s.id, label: s.title || `Story ${s.id}`, href: `#/story/${s.id}`, score: s.score ?? null, meta: fmtShort(s.updated_at || s.first_seen) });
const uid = (it) => `${it.kind}:${it.id}`;

/** 0 = no match; higher is better. Prefix > word start > substring > in-order letters. */
function rank(text, q) {
  if (!q) return 1;
  const t = String(text || '').toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 4;
  if (i > 0) return /[\s\-·/(&]/.test(t[i - 1]) ? 3 : 2;
  let j = 0;
  for (const c of t) { if (c === q[j]) j++; if (j === q.length) return 1; }
  return 0;
}
function filter(list, q, max) {
  if (!q) return list.slice(0, max);
  return list.map((it, k) => ({ it, k, r: Math.max(rank(it.label, q), it.extra ? rank(it.extra, q) * .9 : 0) }))
    .filter(x => x.r > 0).sort((a, b) => b.r - a.r || a.k - b.k).slice(0, max).map(x => x.it);
}
function mark(label, q) {
  const s = String(label || '');
  const i = q ? s.toLowerCase().indexOf(q) : -1;
  if (i < 0) return esc(s);
  return `${esc(s.slice(0, i))}<mark class="ix-hit">${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`;
}
const kbd = (k) => `<kbd class="keycap">${esc(k)}</kbd>`;
const ico = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${esc(n)}"/></svg>`;

// ---------------------------------------------------------------- the Index
let ix = null;

export function initIndex({ nav = [], go, actions = [], settings = [] } = {}) {
  cfg.nav = nav; cfg.actions = actions; cfg.settings = settings; if (go) cfg.go = go;
  if (initIndex.bound) return;
  initIndex.bound = true;
  document.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && k === 'k') {
      e.preventDefault();
      if (ix) ix.close(); else if (!otherModal()) openIndex();
    }
  });
}

export const isIndexOpen = () => !!ix;

export function openIndex(prefix = '') {
  if (ix) { ix.input.value = prefix; ix.refresh(); ix.input.focus(); return; }
  const sheet = isSheet();
  const inner = `
    <div class="ix-head">
      ${ico('search')}
      <input id="ix-q" class="ix-input" type="text" role="combobox" aria-expanded="true" aria-controls="ix-list" aria-autocomplete="list" aria-label="Search Byline or run a command"
        autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Go to a tab, find a story, run a command…">
      <kbd class="keycap ix-esc" aria-hidden="true">esc</kbd>
    </div>
    <div class="ix-list" id="ix-list" role="listbox" aria-label="Results"><div class="ix-groups"></div></div>
    <div class="ix-foot" aria-hidden="true"><span>${kbd('↑')}${kbd('↓')} move</span><span>${kbd('↵')} open</span><span>${kbd('tab')} next group</span></div>
    <span class="sr-only ix-sr" aria-live="polite"></span>`;

  let rootEl, panel, sheetModal = null, wrap = null;
  const opener = document.activeElement;
  window.__byline?.bg?.overlay?.(true);
  if (sheet) {
    sheetModal = modal(`<div class="ix in-sheet">${inner}</div>`, { onClose: () => teardown(true), sheet: true });
    window.__byline?.bg?.overlay?.(false); // the sheet counted itself already
    wrap = sheetModal.el.parentElement; wrap.classList.add('ix-sheet-wrap');
    panel = sheetModal.el; rootEl = panel.querySelector('.ix');
  } else {
    wrap = document.createElement('div');
    wrap.className = 'ix-wrap';
    wrap.innerHTML = `<div class="ix" role="dialog" aria-modal="true" aria-label="Index">${inner}</div>`;
    document.body.append(wrap);
    panel = rootEl = wrap.querySelector('.ix');
    if (!reducedMotion()) {
      wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE.fade });
      panel.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE.settle });
    }
  }
  const input = rootEl.querySelector('.ix-input');
  const list = rootEl.querySelector('.ix-list');
  const groupsEl = rootEl.querySelector('.ix-groups');
  const live = rootEl.querySelector('.ix-sr');
  let flat = [], active = -1, seq = 0, timer = null, remote = { q: null, stories: [] }, closed = false;

  const collect = () => {
    const q = input.value.trim().toLowerCase();
    const res = {};
    if (!q) res.recent = readRecent().map(hydrateRecent).filter(Boolean);
    res.tabs = filter(cfg.nav.map(tabItem), q, q ? 6 : 99);
    if (q && remote.q === q) res.stories = remote.stories.slice(0, 6);
    res.actions = filter(cfg.actions.map(actionItem), q, q ? 6 : 99);
    if (q) res.settings = filter(cfg.settings.map(settingItem), q, 5);
    return { res, q };
  };

  const row = (it, i, q) => {
    const right = it.kind === 'stories' ? `${it.score != null ? String(scoreChip(it.score)) : ''}<span class="ix-meta">${esc(it.meta || '')}</span>`
      : it.keys ? `<span class="ix-keys">${it.keys.map(kbd).join('')}</span>`
        : it.hint ? (it.hint.length <= 3 ? `<span class="ix-keys">${kbd(it.hint)}</span>` : `<span class="ix-meta">${esc(it.hint)}</span>`)
          : it.meta ? `<span class="ix-meta">${esc(it.meta)}</span>` : '';
    const lead = it.kind === 'stories' ? ico('feed') : it.kind === 'archive' ? ico('search') : ico(it.icon || 'chevron-right');
    return `<div class="ix-opt k-${it.kind}" role="option" id="ix-o-${i}" data-i="${i}" aria-selected="false">${lead}<span class="ix-label">${it.kind === 'archive' ? it.labelHtml : mark(it.label, q)}</span>${right}</div>`;
  };

  const render = () => {
    const { res, q } = collect();
    const keep = flat[active] ? uid(flat[active]) : null;
    flat = [];
    let out = '';
    for (const [g, label] of GROUPS) {
      const items = res[g];
      if (!items?.length) continue;
      out += `<div class="ix-grp" role="group" aria-labelledby="ix-g-${g}"><div class="ix-glabel" id="ix-g-${g}">${label}</div>`;
      for (const it of items) { out += row(it, flat.length, q); flat.push({ ...it, group: g }); }
      out += '</div>';
    }
    const pending = q && q.length >= 2 && remote.q !== q;
    if (q) {
      // the archive fallback is always available; it is the only row when nothing else matches
      const arch = { kind: 'archive', id: `archive:${q}`, label: `Search the archive for “${input.value.trim()}”`, labelHtml: `${flat.length ? 'Search the archive for' : `No match for “${esc(input.value.trim())}”. Search the archive for`} <b>“${esc(input.value.trim())}”</b>`, href: `#/search/${encodeURIComponent(input.value.trim())}`, hint: '↵' };
      out += `<div class="ix-grp" role="group" aria-label="Archive">${row(arch, flat.length, q)}</div>`;
      flat.push({ ...arch, group: 'archive' });
    }
    if (pending) out += '<div class="ix-pending" aria-hidden="true">Searching stories…</div>';
    groupsEl.innerHTML = out;
    let next = keep && !keep.startsWith('archive:') ? flat.findIndex(it => uid(it) === keep) : -1;
    if (next < 0) next = flat.length ? 0 : -1;
    setActive(next);
    clearTimeout(render.say);
    render.say = setTimeout(() => { live.textContent = flat.length ? `${flat.length} result${flat.length === 1 ? '' : 's'}` : 'No results'; }, 400);
  };

  const setActive = (i, { scroll = true } = {}) => {
    groupsEl.querySelector('.ix-opt[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    active = i;
    const el = i >= 0 ? groupsEl.querySelector(`#ix-o-${i}`) : null;
    if (!el) { input.removeAttribute('aria-activedescendant'); return; }
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    if (scroll) {
      const top = el.offsetTop, bot = top + el.offsetHeight;
      const glabel = el.parentElement.querySelector('.ix-glabel');
      const pad = glabel && el.previousElementSibling === glabel ? glabel.offsetHeight : 0;
      if (top - pad < list.scrollTop) list.scrollTop = top - pad;
      else if (bot > list.scrollTop + list.clientHeight) list.scrollTop = bot - list.clientHeight;
    }
  };

  const fetchRemote = () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(timer);
    if (!q || q.length < 2 || remote.q === q) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await api.get(`/search?q=${encodeURIComponent(q)}&type=stories`);
        if (my !== seq || closed) return;
        remote = { q, stories: (r.stories || []).map(storyItem) };
      } catch (e) { if (my !== seq || closed) return; remote = { q, stories: [] }; }
      render();
    }, 120);
  };
  const refresh = () => { render(); fetchRemote(); };

  const choose = (it) => {
    if (!it) return;
    pushRecent(it);
    const run = it.run || (it.kind === 'actions' ? cfg.actions.find(a => a.id === it.id)?.run : it.kind === 'settings' ? cfg.settings.find(a => a.id === it.id)?.run : null);
    close(() => (run ? run() : cfg.go(it.href)));
  };
  const groupStarts = () => flat.map((it, i) => (i === 0 || flat[i - 1].group !== it.group ? i : -1)).filter(i => i >= 0);

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const n = flat.length;
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); if (n) setActive((active + 1) % n); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); if (n) setActive((active - 1 + n) % n); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const starts = groupStarts();
      if (!starts.length) return;
      const c = starts.filter(s => s <= active).pop() ?? starts[0];
      const k = starts.indexOf(c);
      setActive(starts[(k + (e.shiftKey ? -1 : 1) + starts.length) % starts.length]);
    }
  });
  input.addEventListener('input', refresh);
  list.addEventListener('pointermove', (e) => { const o = e.target.closest('.ix-opt'); if (o && Number(o.dataset.i) !== active) setActive(Number(o.dataset.i), { scroll: false }); });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const o = e.target.closest('.ix-opt'); if (o) choose(flat[Number(o.dataset.i)]); });

  const onFocusIn = (e) => { if (!panel.contains(e.target)) input.focus({ preventScroll: true }); };
  const onWrapDown = (e) => { if (e.target === wrap) close(); };
  if (!sheet) { wrap.addEventListener('mousedown', onWrapDown); document.addEventListener('focusin', onFocusIn); }

  function teardown(fromModal) {
    if (closed && !fromModal) return;
    closed = true; clearTimeout(timer); clearTimeout(render.say);
    document.removeEventListener('focusin', onFocusIn);
    if (ix === handle) ix = null;
  }
  function close(then) {
    if (sheet) {
      if (closed) return;
      teardown();
      if (then) {
        let done = false;
        const fire = () => { if (done) return; done = true; window.removeEventListener('popstate', fire); setTimeout(then, 0); };
        window.addEventListener('popstate', fire);
        setTimeout(fire, 350);
      }
      sheetModal.close();
      return;
    }
    if (closed) return;
    teardown();
    window.__byline?.bg?.overlay?.(false);
    if (then) then();
    else if (opener && opener.isConnected && opener !== document.body) opener.focus?.({ preventScroll: true });
    if (reducedMotion()) { wrap.remove(); return; }
    wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE.exit, fill: 'forwards' }).finished.then(() => wrap.remove(), () => wrap.remove());
  }

  const handle = { input, refresh, close: () => close() };
  ix = handle;
  input.value = prefix;
  refresh();
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!closed) input.focus({ preventScroll: true }); }));
  input.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- shortcuts
let chordChip = null;
function showChord(onOff) {
  if (onOff) {
    if (touchOnly()) return;
    if (!chordChip) {
      chordChip = document.createElement('div');
      chordChip.className = 'ix-chord';
      chordChip.setAttribute('role', 'status');
      chordChip.innerHTML = `${kbd('G')}<span class="ix-chord-note">then a section key</span>`;
    }
    document.body.append(chordChip);
  } else chordChip?.remove();
}
/** Enter/o only act when focus isn't on something that already answers Enter. */
const plainTarget = (t) => !(t && t.closest && t.closest('a[href], button, summary, select, [role="button"], [role="option"], [role="tab"], [role="switch"], [role="link"], [role="radio"]'));

export function initShortcuts({ go, nav, onTheme, onNext, onPrev, onOpen, onRail, onPlay } = {}) {
  if (go) cfg.go = go;
  if (nav?.length) cfg.nav = nav;
  cfg.handlers = { onTheme, onNext, onPrev, onOpen, onRail, onPlay };
  if (initShortcuts.bound) return;
  initShortcuts.bound = true;
  let chord = null;
  const end = () => { if (!chord) return; clearTimeout(chord); chord = null; showChord(false); hideKeytips('chord'); };
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || (e.repeat && e.key === 'g')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) { end(); return; }
    if (inField(e) || ix || otherModal()) { end(); return; }
    if (document.querySelector('.dossier:not(.is-prebuild)') && e.key !== 'g' && !chord) {
      if (e.key === 'n' && cfg.handlers.onTheme) { e.preventDefault(); cfg.handlers.onTheme(); }
      if (e.key === '[' && cfg.handlers.onRail) { e.preventDefault(); cfg.handlers.onRail(); }
      return;
    }
    const k = e.key, h = cfg.handlers;
    if (chord) {
      if (k === 'Shift') return;
      const item = cfg.nav.find(n => n.key && n.key.toLowerCase() === k.toLowerCase());
      end();
      if (item) { e.preventDefault(); cfg.go(item.href); }
      return;
    }
    if (k === 'g') { e.preventDefault(); chord = setTimeout(end, 1200); showChord(true); showKeytips('chord'); return; }
    if (k === '?') { e.preventDefault(); openStyleSheet(); return; }
    if (k === '/') { e.preventDefault(); openIndex(); return; }
    if (k === '[' && h.onRail) { e.preventDefault(); h.onRail(); return; }
    if (k === 'j' && h.onNext) { e.preventDefault(); h.onNext(); return; }
    if (k === 'k' && h.onPrev) { e.preventDefault(); h.onPrev(); return; }
    if ((k === 'o' || (k === 'Enter' && plainTarget(e.target))) && h.onOpen) { if (h.onOpen() !== false) e.preventDefault(); return; }
    if (k === 'n' && h.onTheme) { e.preventDefault(); h.onTheme(); }
  });
  window.addEventListener('blur', end);
}

/** Every shortcut, as a plain two-column sheet. */
export function openStyleSheet() {
  if (document.querySelector('.hs')) return;
  const h = cfg.handlers;
  const line = (label, keys) => `<div class="hs-line"><dt>${esc(label)}</dt><dd>${keys}</dd></div>`;
  const sections = [
    ['Find', [line('Open the Index', `${kbd(MOD)}${kbd('K')} or ${kbd('/')}`), line('Next group in the Index', kbd('tab'))]],
    ['Go to', cfg.nav.filter(n => n.key).map(n => line(n.label, `${kbd('G')}${kbd(n.key.toUpperCase())}`))],
    ['Lists', [h.onNext && line('Next item', kbd('J')), h.onPrev && line('Previous item', kbd('K')), h.onOpen && line('Open item', `${kbd('O')} or ${kbd('↵')}`)].filter(Boolean)],
    ['Shell', [h.onTheme && line('Switch theme (Proof / Night)', kbd('N')), h.onRail && line('Collapse or expand the sidebar', kbd('[')),
      line('Undo the last change', `${kbd(MOD)}${kbd('Z')}`), line('Show keytips', `hold ${kbd(isMac ? '⌥' : 'Alt')}`), line('This sheet', kbd('?')), line('Close a panel', kbd('esc'))].filter(Boolean)]
  ].filter(([, rows]) => rows.length);
  modal(`<div class="hs"><p class="eyebrow">Keyboard</p><h2>Shortcuts</h2>
    <p class="hs-dek">Single keys rest while you type in a field.</p>
    <div class="hs-cols">${sections.map(([t, rows]) => `<section class="hs-sec"><h3>${esc(t)}</h3><dl>${rows.join('')}</dl></section>`).join('')}</div>
    <div class="modal-actions"><button type="button" class="btn btn--secondary" data-close>Close</button></div></div>`, { wide: true });
}

// ---------------------------------------------------------------- keytips (hold Alt, or during a g chord)
let tipLayer = null;
const tipReasons = new Set();
function tipTargets() {
  const seen = new Set(), out = [];
  const chord = tipReasons.has('chord');
  const add = (el, text) => { if (seen.has(el)) return; seen.add(el); out.push([el, text]); };
  (keytips.root || document).querySelectorAll('[data-key]').forEach(el => {
    const v = el.dataset.key || '';
    const m = chord ? v.match(/^g\s*\+?\s*(\S)$/i) : null;
    if (chord && !m) return;
    add(el, m ? m[1] : v);
  });
  if (!document.documentElement.classList.contains('rail-collapsed')) {
    for (const n of cfg.nav) {
      if (!n.key) continue;
      document.querySelectorAll(`.rail a[href="${CSS.escape(n.href)}"]`).forEach(a => add(a, chord ? n.key.toUpperCase() : `G ${n.key.toUpperCase()}`));
    }
  }
  return out;
}
function placeTips() {
  if (!tipLayer) return;
  const vw = innerWidth, vh = innerHeight;
  tipLayer.innerHTML = tipTargets().map(([el, text]) => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return '';
    const x = Math.min(vw - 14, Math.max(14, r.right - 8)), y = Math.min(vh - 10, Math.max(10, r.top + r.height / 2));
    return `<span class="ix-tip" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${esc(text)}</span>`;
  }).join('');
}
export function showKeytips(reason = 'manual') {
  if (touchOnly()) return;
  tipReasons.add(reason);
  if (!tipLayer) { tipLayer = document.createElement('div'); tipLayer.className = 'ix-tips'; tipLayer.setAttribute('aria-hidden', 'true'); }
  if (!tipLayer.isConnected) document.body.append(tipLayer);
  placeTips();
}
export function hideKeytips(reason) {
  if (reason) tipReasons.delete(reason); else tipReasons.clear();
  if (!tipReasons.size && tipLayer?.isConnected) tipLayer.remove();
  else if (tipReasons.size) placeTips();
}
export function keytips(rootEl = document) {
  keytips.root = rootEl;
  if (keytips.bound) return;
  keytips.bound = true;
  let t = null;
  const stop = () => { clearTimeout(t); t = null; hideKeytips('alt'); };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { if (!e.repeat && !t) t = setTimeout(() => showKeytips('alt'), 400); }
    else stop();
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') stop(); });
  window.addEventListener('blur', () => { stop(); hideKeytips(); });
  window.addEventListener('pointerdown', stop, true);
  const replace = () => { if (tipReasons.size) placeTips(); };
  window.addEventListener('scroll', replace, { passive: true, capture: true });
  window.addEventListener('resize', replace, { passive: true });
}
