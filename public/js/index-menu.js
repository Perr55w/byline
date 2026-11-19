// The Index (command menu), single-key shortcuts, the House style sheet and proof-mark keytips.
// No framework: one module, wired from app.js with initIndex() / initShortcuts() / keytips().

import { api } from './api.js';
import { esc, modal, isSheet, inField, reducedMotion } from './ui.js';

const RECENT_KEY = 'byline-recent';
const MAX_RECENT = 5;
const GROUPS = [['recent', 'Recent'], ['tabs', 'Tabs'], ['stories', 'Stories'], ['drafts', 'Drafts'], ['people', 'People'], ['actions', 'Actions']];
const MARK = { recent: '↺', tabs: '§', stories: '¶', drafts: '‡', people: '@', actions: '›' };
const SCOPES = { '>': ['actions'], '#': ['stories', 'drafts'], '@': ['people'] };
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

const cfg = { nav: [], go: (h) => { location.hash = h; }, actions: [], handlers: {} };
const touchOnly = () => matchMedia('(hover: none)').matches;
const otherModal = () => !!document.querySelector('.modal-wrap:not(.ix-sheet-wrap)');

// ---------------------------------------------------------------- recent
function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, MAX_RECENT) : []; } catch (e) { return []; }
}
function pushRecent(it) {
  const entry = { kind: it.kind, id: it.id, label: it.label, meta: it.meta || '', href: it.href || null };
  const next = [entry, ...readRecent().filter(r => !(r.kind === entry.kind && String(r.id) === String(entry.id)))].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch (e) { /* storage unavailable */ }
}
function hydrateRecent(r) {
  if (r.kind === 'actions') { const a = cfg.actions.find(x => x.id === r.id); return a ? actionItem(a) : null; }
  if (r.kind === 'tabs') { const n = cfg.nav.find(x => x.href === r.id); return n ? tabItem(n) : null; }
  return r.href ? { ...r } : null;
}

// ---------------------------------------------------------------- items
const tabItem = (n) => ({ kind: 'tabs', id: n.href, label: n.label, href: n.href, keys: n.key ? ['g', n.key] : null });
const actionItem = (a) => ({ kind: 'actions', id: a.id, label: a.label, hint: a.hint || '', run: a.run });
const storyItem = (s) => ({ kind: 'stories', id: s.id, label: s.title || `Story ${s.id}`, href: `#/story/${s.id}`, meta: (s.status || '').replace(/_/g, ' ') });
const draftItem = (d) => ({ kind: 'drafts', id: d.id, label: d.title || `Draft ${d.id}`, href: `#/draft/${d.id}`, meta: [d.channel, d.format, (d.status || '').replace(/_/g, ' ')].filter(Boolean).join(' · ') });
const personItem = (c) => ({ kind: 'people', id: c.id, label: c.name, href: `#/person/${c.id}`, meta: [c.role, c.org || c.employer].filter(Boolean).join(' · '), extra: `${c.org || ''} ${c.employer || ''} ${c.role || ''}` });
const uid = (it) => `${it.kind}:${it.id}`;

/** 0 = no match; higher is better. Prefix > word start > substring > in-order letters. */
function rank(text, q) {
  if (!q) return 1;
  const t = String(text || '').toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 4;
  if (i > 0) return /[\s\-·/(]/.test(t[i - 1]) ? 3 : 2;
  let j = 0;
  for (const c of t) { if (c === q[j]) j++; if (j === q.length) return 1; }
  return 0;
}
function filter(list, q, max) {
  if (!q) return list.slice(0, max);
  return list.map((it, k) => ({ it, k, r: Math.max(rank(it.label, q), it.extra ? rank(it.extra, q) * .9 : 0) }))
    .filter(x => x.r > 0).sort((a, b) => b.r - a.r || a.k - b.k).slice(0, max).map(x => x.it);
}
function parse(raw) {
  const m = raw.match(/^\s*([>#@])\s*/);
  return m ? { scope: m[1], q: raw.slice(m[0].length).trim().toLowerCase() } : { scope: '', q: raw.trim().toLowerCase() };
}
function mark(label, q) {
  const s = String(label || '');
  const i = q ? s.toLowerCase().indexOf(q) : -1;
  if (i < 0) return esc(s);
  return `${esc(s.slice(0, i))}<mark class="ix-hit">${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`;
}
const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

// ---------------------------------------------------------------- people cache (local filter)
let people = null, peopleAt = 0;
function loadPeople() {
  if (people && Date.now() - peopleAt < 60000) return people;
  peopleAt = Date.now();
  people = api.get('/contacts').then(list => (Array.isArray(list) ? list : []).map(personItem)).catch(() => []);
  return people;
}

// ---------------------------------------------------------------- the Index
let ix = null; // the open instance

export function initIndex({ nav = [], go, actions = [] } = {}) {
  cfg.nav = nav; cfg.actions = actions; if (go) cfg.go = go;
  if (initIndex.bound) return;
  initIndex.bound = true;
  document.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && k === 'k') {
      e.preventDefault();
      if (ix) ix.close(); else if (!otherModal()) openIndex();
      return;
    }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !inField(e) && !ix && !otherModal()) { e.preventDefault(); openIndex(); }
  });
}

export const isIndexOpen = () => !!ix;

export function openIndex(prefix = '') {
  if (ix) { ix.input.value = prefix; ix.refresh(); ix.input.focus(); return; }
  const sheet = isSheet();
  const inner = `
    <div class="ix-head">
      <label class="ix-kicker" for="ix-q">Index</label>
      <input id="ix-q" class="ix-input" type="text" role="combobox" aria-expanded="true" aria-controls="ix-list" aria-autocomplete="list"
        autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Find a tab, story, draft or person…">
      <kbd class="ix-esc" aria-hidden="true">esc</kbd>
    </div>
    <div class="ix-list" id="ix-list" role="listbox" aria-label="Index results">
      <div class="ix-bar" aria-hidden="true"></div>
      <div class="ix-groups"></div>
    </div>
    <div class="ix-foot" aria-hidden="true">
      <span>${kbd('↑')}${kbd('↓')} move</span><span>${kbd('↵')} open</span><span>${kbd('tab')} next group</span>
      <span class="ix-scopes">${kbd('>')} actions ${kbd('#')} copy ${kbd('@')} people</span>
    </div>
    <span class="ix-sr" aria-live="polite"></span>`;

  let root, panel, sheetModal = null, wrap = null;
  const opener = document.activeElement;
  if (sheet) {
    sheetModal = modal(`<div class="ix in-sheet">${inner}</div>`, { onClose: () => teardown(true) });
    wrap = sheetModal.el.parentElement; wrap.classList.add('ix-sheet-wrap');
    panel = sheetModal.el; root = panel.querySelector('.ix');
  } else {
    wrap = document.createElement('div');
    wrap.className = 'ix-wrap';
    wrap.innerHTML = `<div class="ix" role="dialog" aria-modal="true" aria-label="Index">${inner}</div>`;
    document.body.append(wrap);
    panel = root = wrap.querySelector('.ix');
  }
  const input = root.querySelector('.ix-input');
  // cycling hint (stops on the first keystroke; never under reduced motion)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !input.value) {
    const hints = ['Go to Feed…', 'Find a story…', '› Run today’s workflow', '@ a person…', 'Find a tab, story, draft or person…'];
    let hi = 0; const tick = setInterval(() => { if (!input.isConnected || input.value) { clearInterval(tick); return; } input.placeholder = hints[hi++ % hints.length]; }, 2400);
    input.addEventListener('input', () => { clearInterval(tick); input.placeholder = 'Find a tab, story, draft or person…'; }, { once: true });
  }
  const list = root.querySelector('.ix-list');
  const groupsEl = root.querySelector('.ix-groups');
  const bar = root.querySelector('.ix-bar');
  const live = root.querySelector('.ix-sr');

  let flat = [], active = -1, seq = 0, timer = null, remote = { q: null, stories: [], drafts: [] }, peopleList = null, closed = false;

  const collect = () => {
    const { scope, q } = parse(input.value);
    const allow = scope ? SCOPES[scope] : null;
    const on = (g) => !allow || allow.includes(g);
    const res = {};
    if (!scope && !q) res.recent = readRecent().map(hydrateRecent).filter(Boolean);
    if (scope === '#' && !q) res.recent = readRecent().filter(r => r.kind === 'stories' || r.kind === 'drafts').map(hydrateRecent).filter(Boolean);
    if (on('tabs') && !scope) res.tabs = filter(cfg.nav.map(tabItem), q, q ? 6 : 99);
    if (on('stories') && q && remote.q === q) res.stories = remote.stories.slice(0, scope ? 12 : 5);
    if (on('drafts') && q && remote.q === q) res.drafts = remote.drafts.slice(0, scope ? 10 : 4);
    if (on('people') && peopleList && (q || scope === '@')) res.people = filter(peopleList, q, scope ? 12 : 4);
    if (on('actions')) res.actions = filter(cfg.actions.map(actionItem), q, 99);
    return { res, q, scope };
  };

  const row = (it, i, q) => {
    const right = it.keys ? `<span class="ix-keys">${it.keys.map(kbd).join('')}</span>`
      : it.hint ? (it.hint.length <= 3 ? `<span class="ix-keys">${kbd(it.hint)}</span>` : `<span class="ix-meta">${esc(it.hint)}</span>`)
        : it.meta ? `<span class="ix-meta">${esc(it.meta)}</span>` : '';
    return `<div class="ix-opt k-${it.kind}" role="option" id="ix-o-${i}" data-i="${i}" aria-selected="false">
      <span class="ix-mark" aria-hidden="true">${MARK[it.kind] || '·'}</span><span class="ix-label">${mark(it.label, q)}</span>${right}</div>`;
  };

  const render = () => {
    const { res, q, scope } = collect();
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
    const pending = q && remote.q !== q && (!scope || scope === '#') && q.length >= 2;
    if (!flat.length) {
      out = pending ? '<div class="ix-empty">Pulling from the morgue…</div>'
        : `<div class="ix-empty">No copy matches “${esc(q)}”.<span>Try ${kbd('>')} for actions, ${kbd('#')} for stories and drafts, ${kbd('@')} for people.</span></div>`;
    } else if (pending) out += '<div class="ix-pending" aria-hidden="true">Pulling from the morgue…</div>';
    groupsEl.innerHTML = out;
    let next = keep ? flat.findIndex(it => uid(it) === keep) : -1;
    if (next < 0) next = flat.length ? 0 : -1;
    setActive(next, { snap: true });
    clearTimeout(render.say);
    render.say = setTimeout(() => { live.textContent = flat.length ? `${flat.length} result${flat.length === 1 ? '' : 's'}` : 'No results'; }, 400);
  };

  const setActive = (i, { snap = false, scroll = true } = {}) => {
    const prev = groupsEl.querySelector('.ix-opt[aria-selected="true"]');
    if (prev) prev.setAttribute('aria-selected', 'false');
    active = i;
    const el = i >= 0 ? groupsEl.querySelector(`#ix-o-${i}`) : null;
    if (!el) { input.removeAttribute('aria-activedescendant'); bar.style.opacity = '0'; return; }
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    bar.classList.toggle('snap', snap || bar.style.opacity === '0');
    bar.style.opacity = '1';
    bar.style.height = `${el.offsetHeight}px`;
    bar.style.transform = `translateY(${el.offsetTop}px)`;
    if (snap) requestAnimationFrame(() => bar.classList.remove('snap'));
    if (scroll) {
      const top = el.offsetTop, bot = top + el.offsetHeight;
      const glabel = el.parentElement.querySelector('.ix-glabel');
      const pad = glabel && el.previousElementSibling === glabel ? glabel.offsetHeight : 0; // keep the group label in view for the first row
      if (top - pad < list.scrollTop) list.scrollTop = top - pad;
      else if (bot > list.scrollTop + list.clientHeight) list.scrollTop = bot - list.clientHeight;
    }
  };

  const fetchRemote = () => {
    const { scope, q } = parse(input.value);
    clearTimeout(timer);
    if (!q || q.length < 2 || (scope && scope !== '#')) return;
    if (remote.q === q) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await api.get(`/search?q=${encodeURIComponent(q)}&type=stories,drafts`);
        if (my !== seq || closed) return;
        remote = { q, stories: (r.stories || []).map(storyItem), drafts: (r.drafts || []).map(draftItem) };
      } catch (e) {
        if (my !== seq || closed) return;
        remote = { q, stories: [], drafts: [] };
      }
      render();
    }, 120);
  };

  const refresh = () => {
    const { scope, q } = parse(input.value);
    if ((q || scope === '@') && !peopleList) loadPeople().then(l => { if (!closed) { peopleList = l; render(); } });
    render();
    fetchRemote();
  };

  const choose = (it) => {
    if (!it) return;
    pushRecent(it);
    const run = it.kind === 'actions' ? (it.run || cfg.actions.find(a => a.id === it.id)?.run) : null;
    close(() => (run ? run() : cfg.go(it.href)));
  };

  const groupStarts = () => flat.map((it, i) => (i === 0 || flat[i - 1].group !== it.group ? i : -1)).filter(i => i >= 0);

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const n = flat.length;
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); if (n) setActive((active + 1) % n); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); if (n) setActive((active - 1 + n) % n); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); if (n) setActive(0); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); if (n) setActive(n - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') {
      e.preventDefault(); // focus stays in the Index; Tab walks the groups instead
      const starts = groupStarts();
      if (!starts.length) return;
      const cur = starts.filter(s => s <= active).pop() ?? starts[0];
      const k = starts.indexOf(cur);
      setActive(starts[(k + (e.shiftKey ? -1 : 1) + starts.length) % starts.length]);
    }
  });
  input.addEventListener('input', refresh);
  list.addEventListener('pointermove', (e) => {
    const o = e.target.closest('.ix-opt');
    if (o && Number(o.dataset.i) !== active) setActive(Number(o.dataset.i), { scroll: false });
  });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus (and the caret) in the input
  list.addEventListener('click', (e) => { const o = e.target.closest('.ix-opt'); if (o) choose(flat[Number(o.dataset.i)]); });

  const onFocusIn = (e) => { if (!panel.contains(e.target)) input.focus({ preventScroll: true }); };
  const onWrapDown = (e) => { if (e.target === wrap) close(); };
  if (!sheet) {
    wrap.addEventListener('mousedown', onWrapDown);
    document.addEventListener('focusin', onFocusIn);
  }

  function teardown(fromModal) {
    if (closed && !fromModal) return;
    closed = true; clearTimeout(timer); clearTimeout(render.say);
    document.removeEventListener('focusin', onFocusIn);
    if (ix === api_) ix = null;
  }

  function close(then) {
    if (sheet) {
      if (closed) return;
      teardown();
      if (then) {
        // the sheet pops its history entry; navigate after that back() has landed so it can't undo the hash change
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
    const finish = () => { wrap.remove(); };
    if (then) then();
    else if (opener && opener.isConnected && opener !== document.body) opener.focus?.({ preventScroll: true });
    if (reducedMotion()) { wrap.classList.add('out'); setTimeout(finish, 100); return; }
    wrap.classList.add('out');
    let ended = false;
    const end = () => { if (!ended) { ended = true; finish(); } };
    panel.addEventListener('animationend', end, { once: true });
    setTimeout(end, 220);
  }

  const api_ = { input, refresh, close: () => close() };
  ix = api_;
  input.value = prefix;
  refresh();
  // modal() focuses its dialog on the next frame; take focus after it
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!closed) input.focus({ preventScroll: true }); }));
  input.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- shortcuts
let chordChip = null;
function showChord(on) {
  if (on) {
    if (touchOnly()) return;
    if (!chordChip) {
      chordChip = document.createElement('div');
      chordChip.className = 'ix-chord';
      chordChip.setAttribute('role', 'status');
      chordChip.innerHTML = `${kbd('g')}<span class="ix-chord-dots">…</span><span class="ix-chord-note">then a section letter</span>`;
    }
    chordChip.classList.remove('out');
    void chordChip.offsetWidth;
    document.body.append(chordChip);
  } else if (chordChip?.isConnected) {
    chordChip.remove();
  }
}

/** Enter/o only act when focus isn't on something that already answers Enter. */
const plainTarget = (t) => !(t && t.closest && t.closest('a[href], button, summary, select, [role="button"], [role="option"], [role="tab"], [role="switch"], [role="link"]'));

export function initShortcuts({ go, nav, onTheme, onNext, onPrev, onOpen, onPlay } = {}) {
  if (go) cfg.go = go;
  if (nav?.length) cfg.nav = nav;
  cfg.handlers = { onTheme, onNext, onPrev, onOpen, onPlay };
  if (initShortcuts.bound) return;
  initShortcuts.bound = true;
  let chord = null;
  const end = () => { if (!chord) return; clearTimeout(chord); chord = null; showChord(false); hideKeytips('chord'); };
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.repeat && e.key === 'g') return;
    if (e.metaKey || e.ctrlKey || e.altKey) { end(); return; }
    if (inField(e) || ix || otherModal()) { end(); return; }
    const k = e.key;
    const h = cfg.handlers;
    if (chord) {
      if (k === 'Shift') return;
      const item = cfg.nav.find(n => n.key && n.key.toLowerCase() === k.toLowerCase());
      end();
      if (item) { e.preventDefault(); cfg.go(item.href); }
      return;
    }
    if (k === 'g') { e.preventDefault(); chord = setTimeout(end, 1000); showChord(true); showKeytips('chord'); return; }
    if (k === '?') { e.preventDefault(); openStyleSheet(); return; }
    if (k === 'j' && h.onNext) { e.preventDefault(); h.onNext(); return; }
    if (k === 'k' && h.onPrev) { e.preventDefault(); h.onPrev(); return; }
    if ((k === 'o' || (k === 'Enter' && plainTarget(e.target))) && h.onOpen) { if (h.onOpen() !== false) e.preventDefault(); return; }
    if (k === 'n' && h.onTheme) { e.preventDefault(); h.onTheme(); return; }
    if (k === 'l' && h.onPlay) { e.preventDefault(); h.onPlay(); }
  });
  window.addEventListener('blur', end);
}

/** The House style sheet: every shortcut, typeset as a printer's style sheet. */
export function openStyleSheet() {
  if (document.querySelector('.hs')) return;
  const h = cfg.handlers;
  const line = (label, keys) => `<div class="hs-line"><dt>${esc(label)}</dt><dd>${keys}</dd></div>`;
  const or = '<i class="hs-or">or</i>';
  const sections = [
    ['Finding', [
      line('Open the Index', `${kbd(MOD)}${kbd('K')} ${or} ${kbd('/')}`),
      line('Actions only', kbd('>')), line('Stories & drafts only', kbd('#')), line('People only', kbd('@')),
      line('Next group in the Index', kbd('tab'))]],
    ['Sections', cfg.nav.filter(n => n.key).map(n => line(n.label, `${kbd('g')}${kbd(n.key)}`))],
    ['Lists', [h.onNext && line('Next item', kbd('j')), h.onPrev && line('Previous item', kbd('k')), h.onOpen && line('Open item', `${kbd('o')} ${or} ${kbd('↵')}`)].filter(Boolean)],
    ['Desk', [h.onTheme && line('Switch desk (Proof / Night)', kbd('n')), h.onPlay && line('Play or pause the brief', kbd('l')),
      line('Undo the last change', `${kbd(MOD)}${kbd('Z')}`), line('Show keytips', `hold ${kbd(isMac ? '⌥' : 'Alt')}`),
      line('This style sheet', kbd('?')), line('Close a sheet', kbd('esc'))].filter(Boolean)]
  ].filter(([, rows]) => rows.length);
  modal(`<div class="hs">
    <div class="hs-head"><span class="kicker">Style sheet · Keyboard</span><h2 class="hs-title">House style</h2>
    <p class="hs-dek">The marks of this desk. Single keys rest while you type in a field.</p></div>
    <div class="hs-cols">${sections.map(([t, rows]) => `<section class="hs-sec"><h3>${esc(t)}</h3><dl>${rows.join('')}</dl></section>`).join('')}</div>
    <div class="hs-foot"><button type="button" data-close>Close</button></div></div>`, { wide: true });
}

// ---------------------------------------------------------------- keytips
let tipLayer = null;
const tipReasons = new Set();

function tipTargets() {
  const seen = new Set(), out = [];
  const chord = tipReasons.has('chord');
  const add = (el, text) => { if (seen.has(el)) return; seen.add(el); out.push([el, text]); };
  (keytips.root || document).querySelectorAll('[data-key]').forEach(el => {
    const v = el.dataset.key || '';
    const m = chord ? v.match(/^g\s*\+?\s*(\S)$/i) : null;
    if (chord && !m) return; // during a g chord only the section letters matter
    add(el, m ? m[1] : v);
  });
  for (const n of cfg.nav) {
    if (!n.key) continue;
    document.querySelectorAll(`#nav a[href="${CSS.escape(n.href)}"], .folios a[href="${CSS.escape(n.href)}"]`).forEach(a => add(a, chord ? n.key : `g ${n.key}`));
  }
  return out;
}
function placeTips() {
  if (!tipLayer) return;
  const vw = innerWidth, vh = innerHeight;
  tipLayer.innerHTML = tipTargets().map(([el, text]) => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return '';
    // a proof mark pinned to the element's top-right corner, kept on screen
    const x = Math.min(vw - 14, Math.max(14, r.right - 6));
    const y = Math.min(vh - 10, Math.max(10, r.top + 3));
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

/** Proof-mark keytips for [data-key] elements (and the nav folios): hold Alt/Option 400ms, or press g. */
export function keytips(root = document) {
  keytips.root = root;
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
  window.addEventListener('hashchange', () => setTimeout(replace, 50));
}
