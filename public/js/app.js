// Byline v4 shell: router (E §3), rail (D §1), status pill (F), theme, background wiring, dossier overlay.
import { api } from './api.js';
import { html, raw, toast, countUp, reducedMotion, inField, stampChanged, skeleton, icon, sheet, lattice, esc } from './ui.js';
import { enterHeading, DUR, EASE } from './motion.js';
import { repaintAll } from './quality.js';
import bg from './bg.js';
import * as dossier from './dossier.js';

// ---------------------------------------------------------------- navigation model
// [key, label, g-shortcut]. Map uses `g n` (g m stays Campaigns, g a stays Search/Archive).
export const NAV = [
  ['Briefing', [['today', 'Today', 't'], ['feed', 'Feed', 'f'], ['map', 'Map', 'n'], ['search', 'Search', 'a']]],
  ['Publish', [['studio', 'Studio', 's'], ['calendar', 'Calendar', 'c'], ['campaigns', 'Campaigns', 'm'], ['performance', 'Performance', 'o']]],
  ['Career', [['career', 'Career', 'k'], ['employers', 'Employers', 'e'], ['people', 'People', 'p']]],
  ['System', [['sources', 'Sources', 'u'], ['runs', 'Runs', 'r'], ['settings', 'Settings', ',']]]
];
const NAV_FLAT = NAV.flatMap(([group, items]) => items.map(([k, label, key]) => ({ href: `#/${k}`, label, key, route: k, group })));
const NAV_INDEX = Object.fromEntries(NAV_FLAT.map((n, i) => [n.route, { i, g: NAV.findIndex(([grp]) => grp === n.group) + 1, ...n }]));

// route → module (lazy). `story/:id` opens the dossier overlay over the current page.
const ROUTES = {
  today: './views/today.js', feed: './views/feed.js', map: './views/map.js', search: './views/search.js',
  studio: './views/studio.js', draft: './views/studio.js', calendar: './views/calendar.js', campaigns: './views/campaigns.js', performance: './views/performance.js',
  career: './views/career.js', employers: './views/employers.js', people: './views/people.js', person: './views/people.js',
  sources: './views/sources.js', runs: './views/runs.js', settings: './views/settings.js'
};
const ALIAS = { draft: 'studio', person: 'people' };
const BG_FULL = new Set(['today', 'map']); // full field; every other view is a reading view (dim)
const DATA = { today: '/today', feed: '/stories?days=7' }; // safe GETs warmed on hover

export const state = { status: null, today: null };
window.__byline = window.__byline || {};
window.__byline.bg = bg;
window.__byline.dossier = dossier;
const root = document.documentElement;
const $ = (id) => document.getElementById(id);
const view = $('view');

// Modules that may not exist yet (built by later builders) resolve to an honest placeholder.
const probed = new Map();
async function moduleFor(key) {
  const path = ROUTES[key];
  if (key !== 'map') return path;
  if (!probed.has(path)) {
    probed.set(path, fetch(`/js/views/${path.split('/').pop()}`, { method: 'HEAD' })
      .then(r => (r.ok && /javascript/.test(r.headers.get('content-type') || '') ? path : './views/_placeholder.js'))
      .catch(() => './views/_placeholder.js'));
  }
  return probed.get(path);
}

// ---------------------------------------------------------------- theme (Proof default; 'light'|'dark' stored for compat)
const themeNow = () => (root.dataset.theme === 'night' ? 'night' : 'proof');
function paintTheme() {
  const night = themeNow() === 'night';
  document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeSet === themeNow())));
  document.querySelectorAll('[data-theme-toggle]').forEach(b => { b.setAttribute('aria-label', night ? 'Switch to Proof (light)' : 'Switch to Night (dark)'); b.dataset.tip = night ? 'Theme: Night' : 'Theme: Proof'; });
  $('theme-color-live')?.setAttribute('content', night ? '#121316' : '#F5F6F8');
}
let xfadeT = 0;
function applyTheme(next) {
  if (next === themeNow()) return;
  if (!reducedMotion()) { root.classList.add('theme-xfade'); clearTimeout(xfadeT); xfadeT = setTimeout(() => root.classList.remove('theme-xfade'), DUR.theme + 60); }
  root.dataset.theme = next;
  paintTheme();
  repaintAll();
  document.dispatchEvent(new CustomEvent('byline:theme', { detail: { theme: next } }));
}
/** pref: 'light' | 'dark' | 'proof' | 'night' | 'system'. Persists in localStorage['byline-theme'] as light|dark|system. */
function setTheme(pref) {
  const store = pref === 'proof' ? 'light' : pref === 'night' ? 'dark' : pref;
  try { localStorage.setItem('byline-theme', store); } catch (e) { /* storage unavailable */ }
  const resolved = store === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'proof') : store === 'dark' ? 'night' : 'proof';
  applyTheme(resolved);
}
window.__byline.setTheme = setTheme;
const toggleTheme = () => setTheme(themeNow() === 'night' ? 'proof' : 'night');
document.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
document.querySelectorAll('[data-theme-toggle]').forEach(b => b.addEventListener('click', toggleTheme));
paintTheme();

// ---------------------------------------------------------------- rail: highlight, collapse, tooltips
const rail = $('rail'), hl = $('rail-hl'), railNav = $('rail-nav'), tip = $('rail-tip');
function setActive(key) {
  const k = ALIAS[key] || key;
  const n = NAV_INDEX[k];
  document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === k) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (n) { hl.style.setProperty('--hl-i', n.i); hl.style.setProperty('--hl-g', n.g); hl.classList.remove('is-off'); }
  else hl.classList.add('is-off');
  const crumb = $('crumb');
  if (crumb) { crumb.querySelector('.crumb-group').textContent = n?.group || (key === 'story' ? 'Briefing' : ''); crumb.querySelector('.crumb-page').textContent = n?.label || ''; }
}
const collapsed = () => root.classList.contains('rail-collapsed');
const railRect = (w) => (matchMedia('(max-width: 760px)').matches ? null : { x: 12, y: 12, w, h: innerHeight - 24 });
function setCollapsed(on, { persist = true } = {}) {
  if (on === collapsed()) return;
  const w = on ? 64 : 232;
  dossier.railWillChange(w);
  root.classList.toggle('rail-collapsed', on);
  const btn = $('rail-collapse');
  btn.setAttribute('aria-expanded', String(!on));
  btn.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
  btn.querySelector('.rail-label').textContent = on ? 'Expand' : 'Collapse';
  if (persist) { try { localStorage.setItem('byline-rail', on ? 'collapsed' : 'expanded'); } catch (e) { /* storage unavailable */ } }
  bg.setRail(railRect(w), { animate: reducedMotion() ? 0 : DUR.layout });
  hideTip();
}
root.addEventListener('transitionend', (e) => {
  if (e.target !== root || e.propertyName !== '--rail-w') return;
  dossier.railDidChange();
  checkRailScroll();
  document.dispatchEvent(new CustomEvent('byline:rail', { detail: { collapsed: collapsed() } }));
});
$('rail-collapse').addEventListener('click', () => setCollapsed(!collapsed()));
if (collapsed()) { const b = $('rail-collapse'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-label', 'Expand sidebar'); b.querySelector('.rail-label').textContent = 'Expand'; }
function checkRailScroll() { railNav.classList.toggle('is-scroll', railNav.scrollHeight > railNav.clientHeight + 1); }

let tipT = 0, tipFor = null;
function hideTip() { clearTimeout(tipT); tipFor = null; tip.classList.remove('on'); tip.setAttribute('aria-hidden', 'true'); }
function showTip(el, now = false) {
  if (!collapsed() || matchMedia('(max-width: 760px)').matches) return;
  clearTimeout(tipT);
  tipFor = el;
  tipT = setTimeout(() => {
    if (tipFor !== el) return;
    const r = el.getBoundingClientRect();
    const label = el.dataset.tip || el.getAttribute('aria-label') || '';
    tip.innerHTML = `${esc(label)}${el.dataset.short ? `<kbd>${esc(el.dataset.short)}</kbd>` : ''}`;
    tip.style.setProperty('--tip-y', `${Math.round(r.top + r.height / 2 - 13)}px`);
    tip.classList.add('on'); tip.setAttribute('aria-hidden', 'false');
  }, now ? 0 : 300);
}
rail.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (t && t !== tipFor) showTip(t); });
rail.addEventListener('pointerleave', hideTip);
rail.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(t, true); });
rail.addEventListener('focusout', hideTip);
railNav.addEventListener('scroll', hideTip, { passive: true });
addEventListener('resize', () => { checkRailScroll(); if (!dossier.isOpen()) bg.setRail(railRect(collapsed() ? 64 : 232)); }, { passive: true });

// brand moment: the underline draws leftward on first load (skipped under reduced motion)
if (!reducedMotion()) { root.classList.add('brand-draw'); setTimeout(() => root.classList.remove('brand-draw'), 1300); }

// phone "More" sheet: same groups as the rail
$('phone-more').addEventListener('click', () => {
  const cur = location.hash.replace(/^#\/?/, '').split('/')[0] || 'today';
  const k = ALIAS[cur] || cur;
  const m = sheet(`<nav class="sheet-nav" aria-label="All sections">${NAV.map(([g, items]) => `<p class="eyebrow">${g}</p>${items.map(([key, label]) => `<a href="#/${key}"${key === k ? ' aria-current="page"' : ''}><svg class="icon"><use href="#i-${key}"/></svg>${label}</a>`).join('')}`).join('')}
    <p class="eyebrow">Display</p><a href="#" data-sheet-theme><svg class="icon"><use href="#i-${themeNow() === 'night' ? 'sun' : 'moon'}"/></svg>Switch to ${themeNow() === 'night' ? 'Proof' : 'Night'}</a></nav>`);
  m.el.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    const go = a.hasAttribute('data-sheet-theme') ? toggleTheme : () => { location.hash = a.getAttribute('href'); };
    let done = false;
    const fire = () => { if (done) return; done = true; removeEventListener('popstate', fire); setTimeout(go, 0); };
    addEventListener('popstate', fire); setTimeout(fire, 400);
    m.close();
  });
});

// ---------------------------------------------------------------- status pill (F wording; every figure from /api/status + /api/today)
const fmtDay = (d, tz) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
const fmtTime = (iso, tz) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
const sep = raw('<span class="sep" aria-hidden="true">·</span>');
let statusAt = 0, statusP = null;
export async function refreshStatus({ flap = false, force = false } = {}) {
  void flap;
  if (!force && statusP && Date.now() - statusAt < 20000) return statusP;
  statusAt = Date.now();
  statusP = (async () => {
    try {
      const [s, t] = await Promise.all([api.get('/status', { fresh: true }), api.get('/today', { fresh: force }).catch(() => null)]);
      state.status = s; state.today = t;
      const th = t?.threshold ?? s.threshold ?? 55;
      window.__byline.threshold = th;
      window.__byline.timezone = s.timezone;
      paintPill(s, t, th);
      paintRailStatus(s);
      const badge = document.querySelector('.rail-item[data-nav="studio"] .rail-badge');
      if (badge) { const n = s.counts?.awaiting || 0; badge.textContent = n; badge.hidden = !n; badge.title = `${n} draft${n === 1 ? '' : 's'} awaiting review`; }
      heatFromToday(t, s);
    } catch (e) { /* server restarting: keep the last good pill */ }
  })();
  return statusP;
}
function paintPill(s, t, th) {
  const pill = $('status-pill');
  if (!pill) return;
  const tz = s.timezone;
  const segs = [];
  const briefs = s.counts?.briefs ?? s.briefs;
  if (t?.brief && briefs != null) segs.push(html`<span>No. <b>${briefs}</b></span>`);
  if (t?.brief?.run_date) segs.push(html`<span>${fmtDay(t.brief.run_date, tz)}</span>`);
  const r = t?.last_run;
  if (r) {
    const failed = r.status === 'failed', running = r.status === 'running';
    const readNone = r.stats?.collect && r.stats.collect.sources === 0;
    const dot = failed ? 'err' : readNone ? 'warn' : 'ok';
    const when = r.finished_at || r.started_at;
    segs.push(html`<span class="run-dot ${dot}" aria-hidden="true"></span><span>${failed ? 'Run failed' : running ? 'Running' : 'Ran'} ${when ? html`<b>${fmtTime(when, tz)}</b>` : ''}</span>`);
    if (r.stats?.collect?.new != null) segs.push(html`<span><b>${r.stats.collect.new}</b> new</span>`);
  }
  const ranked = t?.ranked ?? r?.stats?.rank?.ranked;
  if (ranked != null) segs.push(html`<span><b>${ranked}</b> ranked</span>`);
  if (t?.cleared != null) segs.push(html`<span><b>${t.cleared}</b> above ${th}</span>`);
  if (!segs.length) segs.push(html`<span>No runs yet</span>`);
  const text = segs.map(String).join(String(sep));
  const holder = pill.querySelector('.pill-text');
  if (holder.innerHTML !== text) holder.innerHTML = text;
  const notes = [];
  if (t?.brief && t.brief.run_date !== s.today) notes.push(`This brief is from ${fmtDay(t.brief.run_date)}; no run yet today.`);
  if (r?.stats?.collect?.sources === 0) notes.push('The last run read 0 sources.');
  pill.title = notes.join(' ');
  pill.setAttribute('aria-label', `Run status: ${holder.textContent.replace(/\s+/g, ' ').trim()}${notes.length ? '. ' + notes.join(' ') : ''}`);
}
function paintRailStatus(s) {
  const el = $('rail-status'); if (!el) return;
  const engine = s.provider?.active === 'claude' ? 'Claude' : s.provider?.active === 'ollama' ? 'Ollama' : 'Local engine';
  const li = s.publishers?.linkedin?.available ? 'LinkedIn connected' : 'LinkedIn manual';
  const paused = s.counts?.sources_paused != null && s.counts.sources && s.counts.sources_paused >= s.counts.sources;
  const dot = el.querySelector('.dot');
  dot.className = `dot ${paused ? 'warn' : s.provider?.active === 'local' ? 'warn' : 'ok'}`;
  const text = paused ? `${engine} · collection off` : `${engine} · ${li}`;
  el.querySelector('.rail-status-text').textContent = text;
  el.dataset.tip = `${engine}${s.provider?.reason ? ` (${s.provider.reason})` : ''} · ${li}${paused ? ` · all ${s.counts.sources} sources paused` : ''}`;
  el.title = el.dataset.tip;
}
/** Topic heat for the field, from the brief (weighted counts when the server provides topic_counts). */
function heatFromToday(t) {
  if (!t) return;
  let pairs = [];
  if (t.topic_counts && typeof t.topic_counts === 'object') pairs = (Array.isArray(t.topic_counts) ? t.topic_counts.map(x => [x.topic, x.weighted ?? x.count ?? x.n]) : Object.entries(t.topic_counts));
  else {
    const c = {};
    (t.brief?.items || []).forEach(it => (it.topics || []).forEach(tp => { c[tp] = (c[tp] || 0) + 1; }));
    pairs = Object.entries(c);
  }
  pairs = pairs.map(([k, v]) => [k, Number(typeof v === 'object' ? (v.weighted ?? v.count) : v) || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = pairs[0]?.[1] || 1;
  const key = JSON.stringify(pairs);
  if (heatFromToday.last === key) return;
  heatFromToday.last = key;
  bg.setHeat(pairs.map(([topic, v]) => ({ topic, heat: v / max })));
}

// ---------------------------------------------------------------- router (E §3: offscreen render, read-then-write, interruptible)
const cur = { page: null, key: null, hash: null, seq: 0 };
const dz = { back: false, base: '#/feed' };
let firstRoute = true, settleT = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function settleInFlight() {
  view.querySelectorAll('.page.leaving').forEach(p => p.remove());
  view.querySelectorAll('.page.entering').forEach(p => { p.classList.remove('entering', 'in', 'from-skeleton'); p.querySelectorAll('.enter-item').forEach(e => { e.classList.remove('enter-item'); e.style.removeProperty('--i'); }); });
  clearTimeout(settleT);
}
function enterTargets(page) {
  const head = page.querySelector('.page-head');
  const scope = head ? head.parentElement : (page.children.length === 1 ? page.firstElementChild : page);
  if (!scope) return [];
  const out = [];
  for (const c of scope.children) {
    if (c === head || c.matches('script, style, .sr-only, template')) continue;
    if (c.matches('.grid-12, .split, .grid, [data-stagger]') && c.children.length > 1) out.push(...c.children);
    else out.push(c);
  }
  return out;
}
function leave(old, { quick = false } = {}) {
  if (!old) return;
  const top = old.offsetTop; // the single forced read of a transition
  old.style.top = `${top}px`;
  old.classList.remove('current', 'entering', 'in');
  if (quick) old.classList.add('skeleton-page');
  old.classList.add('leaving');
  const kill = () => old.remove();
  old.addEventListener('transitionend', (e) => { if (e.target === old && e.propertyName === 'opacity') kill(); });
  setTimeout(kill, quick ? 320 : 420);
}
function showSkeleton(key, old) {
  const sk = document.createElement('div');
  sk.className = 'page skeleton-page current';
  sk.innerHTML = skeleton(key);
  if (!reducedMotion()) leave(old); else old?.remove();
  view.append(sk);
  if (!reducedMotion()) sk.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
  return sk;
}
function swapIn(page, old, { key, hash, fromSkeleton }) {
  const scrolled = window.scrollY > 0;
  const motion = !reducedMotion() && !document.hidden;
  if (old) { if (motion) leave(old, { quick: fromSkeleton }); else old.remove(); }
  page.classList.remove('is-pending');
  page.classList.add('current');
  cur.page = page; cur.key = key; cur.hash = hash;
  view.dataset.route = key;
  if (scrolled) window.scrollTo({ top: 0, behavior: 'instant' });
  const h1 = page.querySelector('.page-head h1') || page.querySelector('h1');
  if (motion) {
    const items = enterTargets(page);
    items.forEach((el, i) => { el.classList.add('enter-item'); el.style.setProperty('--i', String(Math.min(i, 8))); });
    page.classList.add('entering');
    if (fromSkeleton) page.classList.add('from-skeleton');
    requestAnimationFrame(() => requestAnimationFrame(() => { if (page.isConnected) page.classList.add('in'); }));
    settleT = setTimeout(() => {
      page.classList.remove('entering', 'in', 'from-skeleton');
      items.forEach(el => { el.classList.remove('enter-item'); el.style.removeProperty('--i'); });
    }, 600 + 8 * DUR.staggerItem + 200);
    if (h1) {
      const head = h1.closest('.page-head');
      enterHeading(h1, { variant: firstRoute ? 'load' : 'tab', key, lede: head?.querySelector('.lede, .live-dek'), eyebrow: head?.querySelector('.eyebrow, .kicker') });
    }
  }
  firstRoute = false;
  const label = NAV_INDEX[ALIAS[key] || key]?.label || '';
  document.title = label ? `${label} · Byline` : 'Byline';
  $('route-live').textContent = label ? `${label} loaded` : '';
  requestAnimationFrame(() => setTimeout(() => decorate(page), motion ? 120 : 0));
  document.dispatchEvent(new CustomEvent('byline:routed', { detail: { key, page } }));
}

async function routeTo(key, params, hash) {
  const seq = ++cur.seq;
  settleInFlight();
  setActive(key);
  bg.setMode(BG_FULL.has(key) ? 'full' : 'dim');
  bg.hold(450);
  const old = cur.page && cur.page.isConnected ? cur.page : view.querySelector('.page.current');
  const page = document.createElement('div');
  page.className = 'page is-pending';
  page.dataset.route = key;
  view.append(page);
  let sk = null, skAt = 0;
  const slow = setTimeout(() => { if (seq === cur.seq) { sk = showSkeleton(key, cur.page && cur.page.isConnected ? cur.page : old); skAt = performance.now(); cur.page = sk; } }, 120);
  try {
    const mod = await import(await moduleFor(key));
    await mod.render(page, { name: key, params });
  } catch (e) {
    console.error(e);
    page.innerHTML = String(html`<div class="page-head"><p class="eyebrow">Something went wrong</p><h1>This tab didn’t load.</h1><p class="lede">${e.message}</p></div>`);
  }
  clearTimeout(slow);
  if (seq !== cur.seq) { page.remove(); return; }
  if (sk) {
    const wait = 320 - (performance.now() - skAt); // hold the skeleton ≥ 320ms, then crossfade
    if (wait > 0) await sleep(wait);
    if (seq !== cur.seq) { page.remove(); return; }
  }
  swapIn(page, sk || old, { key, hash, fromSkeleton: !!sk });
  refreshStatus();
}

let lastSrc = null;
async function route(ev) {
  if (history.state?.sheet) return; // a sheet's own history entry; the sheet handles it
  const hash = location.hash && location.hash !== '#' && location.hash !== '#/' ? location.hash : '#/today';
  const [n0, ...params] = hash.replace(/^#\/?/, '').split('/');
  const name = n0 || 'today';
  if (name === 'story' && params[0]) {
    if (!dossier.isOpen()) {
      if (!cur.page) { await routeTo('feed', [], '#/feed'); dz.back = false; dz.base = '#/feed'; }
      else { dz.back = !!ev; dz.base = cur.hash || '#/feed'; }
    }
    const src = lastSrc && lastSrc.id === params[0] && performance.now() - lastSrc.t < 1500 ? lastSrc.el : null;
    lastSrc = null;
    dossier.open(params[0], src);
    return;
  }
  if (dossier.isOpen()) {
    dossier.close();
    if (hash === cur.hash) return; // closing restored the page underneath: nothing to re-render
  }
  if (hash === cur.hash && cur.page?.isConnected) return;
  return routeTo(ROUTES[name] ? name : 'today', params, hash);
}
dossier.onRequestClose(({ animated = true } = {}) => {
  if (!animated) dossier.close({ instant: true });
  if (dz.back) history.back(); else location.replace(dz.base || '#/feed');
});

// story links: remember the clicked tile/row as the FLIP source; prefetch on hover/focus (no side effects)
const storyId = (a) => /#\/story\/([^/?#]+)/.exec(a?.getAttribute?.('href') || '')?.[1];
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/story/"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const src = a.closest('[data-dossier-src], .tile, .story, article, tr, li, .brief-item') || a;
  lastSrc = { id: storyId(a), el: src, t: performance.now() };
}, true);
const warmStory = (e) => { const a = e.target.closest?.('a[href^="#/story/"]'); if (a) dossier.prefetch(storyId(a)); };
document.addEventListener('pointerover', warmStory, { passive: true });
document.addEventListener('focusin', warmStory);

/** Post-render enrichment shared by every tab. */
function decorate(scope) {
  countUp(scope);
  scope.querySelectorAll('td').forEach(td => { if (/^[\s$€£+−-]*[\d.,]+\s*[%kKmM×x]?\s*$/.test(td.textContent) && td.textContent.trim()) td.classList.add('num'); });
  if (!scope.__observed) {
    scope.__observed = true;
    new MutationObserver(() => { clearTimeout(scope.__deb); scope.__deb = setTimeout(() => countUp(scope), 60); }).observe(scope, { childList: true, subtree: true });
  }
}

// tile hue tint follows the pointer (rect read once per enter; one style write per frame on the hovered tile)
let hoverTile = null, hoverRect = null, tintRaf = 0, tintX = 0, tintY = 0;
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const t = e.target.closest?.('.tile:not(.tile--static)');
  if (t !== hoverTile) { hoverTile = t; hoverRect = t ? t.getBoundingClientRect() : null; }
  if (!t) return;
  tintX = e.clientX - hoverRect.left; tintY = e.clientY - hoverRect.top;
  if (!tintRaf) tintRaf = requestAnimationFrame(() => { tintRaf = 0; if (hoverTile) { hoverTile.style.setProperty('--mx', `${tintX.toFixed(0)}px`); hoverTile.style.setProperty('--my', `${tintY.toFixed(0)}px`); } });
}, { passive: true });
addEventListener('scroll', () => { hoverTile = null; }, { passive: true });

// top bar: the crumb gives way once content scrolls under the sticky pill
let scrolledState = false;
addEventListener('scroll', () => { const s = window.scrollY > 8; if (s !== scrolledState) { scrolledState = s; root.classList.toggle('scrolled', s); } }, { passive: true });

// ---------------------------------------------------------------- staged run (Today "Run now"): progress in the status pill
export async function stagedRun(promise) {
  const pill = $('status-pill'), holder = pill?.querySelector('.pill-text');
  const STAGES = ['collect', 'cluster', 'rank', 'brief', 'draft'];
  const VERB = { collect: 'Collecting', cluster: 'Clustering', rank: 'Ranking', brief: 'Writing the brief', draft: 'Drafting' };
  let done = false;
  const say = (t) => { if (holder) holder.innerHTML = `<span class="run-dot" aria-hidden="true"></span><span>${esc(t)}</span>`; };
  say('Starting the run…');
  (async () => {
    while (!done) {
      try {
        const [latest] = await api.get('/runs', { fresh: true });
        if (latest && latest.status === 'running') {
          const r = await api.get(`/runs/${latest.id}`, { fresh: true });
          const finished = r.stages.filter(s => s.status === 'done').length;
          const c = r.stages.find(s => s.status === 'running');
          if (c && !done) say(`${VERB[c.stage] || c.stage}… ${finished + 1} of ${STAGES.length}`);
        }
      } catch (e) { /* keep polling */ }
      await sleep(500);
    }
  })();
  try { return await promise; }
  finally { done = true; refreshStatus({ force: true }); }
}
window.__byline.stagedRun = stagedRun;
window.__byline.lattice = lattice;

// ---------------------------------------------------------------- prefetch: hover on nav, idle import of the rest
const warmed = new Set();
async function warm(k) {
  if (!k || warmed.has(k) || !ROUTES[k]) return;
  warmed.add(k);
  import(await moduleFor(k)).catch(() => warmed.delete(k));
  if (DATA[k]) api.get(DATA[k]).catch(() => {});
}
document.addEventListener('pointerover', (e) => warm(e.target.closest?.('[data-nav]')?.dataset.nav), { passive: true });
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => Object.keys(ROUTES).forEach(k => { if (!ALIAS[k]) moduleFor(k).then(p => import(p)).catch(() => {}); }), { timeout: 4000 });

// ---------------------------------------------------------------- keyboard row focus (j / k / Enter)
function rows() { return [...document.querySelectorAll('#view .page.current :is(.story, .brief-item, tbody tr, .hit, .source-row, [data-row])')].filter(r => r.offsetParent); }
function moveRow(d) {
  const list = rows(); if (!list.length) return;
  const i = list.findIndex(r => r.classList.contains('kfocus'));
  const next = list[Math.max(0, Math.min(list.length - 1, i + d))];
  list.forEach(r => r.classList.remove('kfocus'));
  next.classList.add('kfocus');
  next.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
}
function openRow() { const r = document.querySelector('.kfocus'); if (!r) return false; const a = r.querySelector('a[href]'); if (a) a.click(); else r.click(); return true; }

// ---------------------------------------------------------------- ⌘K Index + shortcuts (module loads lazily)
const go = (href) => { location.hash = href.replace(/^#/, ''); };
function whenRouted(key, fn) {
  if (cur.key === key && cur.page?.isConnected && !view.querySelector('.page.is-pending')) { fn(cur.page); return; }
  const h = (e) => { if (e.detail.key === key) { document.removeEventListener('byline:routed', h); setTimeout(() => fn(e.detail.page), 60); } };
  document.addEventListener('byline:routed', h);
}
const SETTINGS_SECTIONS = ['Publishing threshold & brief', 'Priorities', 'Schedule', 'AI provider', 'Budget', 'Writing profile', 'Editorial rules', 'Posting rhythm', 'Brief delivery', 'Calendar feed & access', 'Media', 'Display', 'Security', 'Demo data'];
function gotoSettings(section) {
  go('#/settings');
  whenRouted('settings', (page) => {
    const h = [...page.querySelectorAll('h2, h3')].find(x => x.textContent.trim().toLowerCase().startsWith(section.toLowerCase().slice(0, 12)));
    if (h) { h.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  });
}
const ACTIONS = [
  { id: 'run', label: 'Run today’s workflow now', hint: 'Collect → rank → brief', run: () => { go('#/today'); whenRouted('today', (p) => p.querySelector('[data-act="run"]')?.click()); } },
  { id: 'add', label: 'Add a story by URL', hint: 'Feed', run: () => { go('#/feed'); whenRouted('feed', (p) => p.querySelector('[name="url"]')?.focus()); } },
  { id: 'draft', label: 'Draft a post', hint: dossierHint(), run: () => { const b = document.querySelector('.dossier [data-dz-draft]'); if (b) b.click(); else go('#/studio'); } },
  { id: 'theme', get label() { return themeNow() === 'night' ? 'Switch to Proof (light)' : 'Switch to Night (dark)'; }, hint: 'n', run: toggleTheme },
  { id: 'rail', get label() { return collapsed() ? 'Expand the sidebar' : 'Collapse the sidebar'; }, hint: '[', run: () => setCollapsed(!collapsed()) },
  { id: 'keys', label: 'Keyboard shortcuts', hint: '?', run: () => window.__byline.styleSheet?.() }
];
function dossierHint() { return 'Studio'; }
const SETTINGS = SETTINGS_SECTIONS.map(s => ({ id: `settings:${s}`, label: s, run: () => gotoSettings(s) }));
document.querySelectorAll('[data-open-index]').forEach(b => b.addEventListener('click', async () => { const m = await import('./index-menu.js').catch(() => null); m?.openIndex?.(); }));
const cmdGlyph = document.querySelector('.cmd-glyph');
if (cmdGlyph) cmdGlyph.textContent = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
import('./index-menu.js').then((m) => {
  m.initIndex?.({ nav: NAV_FLAT, go, actions: ACTIONS, settings: SETTINGS });
  m.initShortcuts?.({ go, nav: NAV_FLAT, onTheme: toggleTheme, onNext: () => moveRow(1), onPrev: () => moveRow(-1), onOpen: openRow, onRail: () => setCollapsed(!collapsed()) });
  m.keytips?.(document);
  if (m.openStyleSheet) window.__byline.styleSheet = m.openStyleSheet;
}).catch((e) => {
  console.error(e);
  document.addEventListener('keydown', (ev) => {
    if (inField(ev) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'n') toggleTheme(); else if (ev.key === '[') setCollapsed(!collapsed());
  });
});

// ---------------------------------------------------------------- boot
bg.start();
bg.setRail(railRect(collapsed() ? 64 : 232));
checkRailScroll();
document.fonts?.ready?.then(checkRailScroll);
addEventListener('hashchange', (e) => route(e));
addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Unexpected error', 'err'));
document.querySelector('.skip-link')?.addEventListener('click', (e) => { e.preventDefault(); $('main').focus(); });
export { stampChanged, setTheme, setCollapsed };
refreshStatus({ force: true });
route();
