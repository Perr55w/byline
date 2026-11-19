import { api } from './api.js';
import { html, toast, countUp, reducedMotion, inField, stampChanged, galleyProof } from './ui.js';

// [key, label, g-shortcut]
const NAV = [
  ['Daily', [['today', 'Today', 't'], ['feed', 'Feed', 'f'], ['studio', 'Studio', 's'], ['calendar', 'Calendar', 'c']]],
  ['Career', [['career', 'Career', 'k'], ['employers', 'Employers', 'e'], ['people', 'People', 'p'], ['campaigns', 'Campaigns', 'm']]],
  ['Control', [['performance', 'Performance', 'o'], ['sources', 'Sources', 'u'], ['runs', 'Runs', 'r'], ['search', 'Archive', 'a'], ['settings', 'Settings', ',']]]
];
const NAV_FLAT = NAV.flatMap(([, items]) => items.map(([k, label, key]) => ({ href: `#/${k}`, label, key, route: k })));

// route → module path (lazy loaded); `story/:id` style params are passed as an array.
const ROUTES = {
  today: './views/today.js', feed: './views/feed.js', story: './views/feed.js', studio: './views/studio.js', draft: './views/studio.js',
  calendar: './views/calendar.js', career: './views/career.js', employers: './views/employers.js', people: './views/people.js', person: './views/people.js',
  campaigns: './views/campaigns.js', performance: './views/performance.js', sources: './views/sources.js', runs: './views/runs.js', search: './views/search.js', settings: './views/settings.js'
};
const ALIAS = { story: 'feed', draft: 'studio', person: 'people' };
const DATA = { today: '/today' }; // safe GETs worth warming on hover

export const state = { status: null };
window.__byline = window.__byline || {};

// ---------------------------------------------------------------- status + teletype dateline
let typedOnce = false;
function typeDateline(el, text) {
  if (reducedMotion() || typedOnce) { el.textContent = text; return; }
  typedOnce = true;
  el.classList.add('typing');
  let i = 0;
  const step = () => { el.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(step, 16); else setTimeout(() => el.classList.remove('typing'), 500); };
  step();
}
function flapIssue(el, text) {
  // only the issue number flips; the rest stays put
  const m = text.match(/No\. (\d+)/);
  if (!m || reducedMotion()) { el.textContent = text; return; }
  el.innerHTML = String(html`${text.slice(0, m.index + 4)}<span class="flap-d">${m[1]}</span>${text.slice(m.index + 4 + m[1].length)}`);
}

export async function refreshStatus({ flap = false } = {}) {
  try {
    state.status = await api.get('/status', { fresh: true });
    const s = state.status;
    window.__byline.threshold = s.threshold ?? window.__byline.threshold ?? 55;
    const engine = s.provider.active === 'claude' ? `Claude` : s.provider.active === 'ollama' ? `Ollama` : 'Template engine';
    document.getElementById('rail-foot').innerHTML = String(html`
      <span><span class="dot ${s.provider.active === 'local' ? 'warn' : 'ok'}"></span><b>${engine}</b></span>
      <span>LinkedIn: <b>${s.publishers.linkedin.available ? 'connected' : 'manual'}</b></span>
      <span><b>${s.counts.stories}</b> stories · <b>${s.counts.sources}</b> sources</span>
      ${s.counts.demo_articles ? html`<span class="demo-flag">Demo data</span>` : ''}`);
    const d = new Date(`${s.today}T12:00:00`);
    const doy = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    const text = `Vol. 1 · No. ${doy} · ${d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '')}`;
    const dl = document.getElementById('dateline');
    if (flap) flapIssue(dl, text); else if (dl.textContent !== text) typeDateline(dl, text);
    const badge = document.querySelector('[data-nav="studio"] .badge');
    if (badge) { badge.textContent = s.counts.awaiting || ''; badge.style.display = s.counts.awaiting ? '' : 'none'; }
  } catch (e) { /* server restarting */ }
}

// ---------------------------------------------------------------- nav
function renderNav(active) {
  document.getElementById('nav').innerHTML = NAV.map(([group, items]) => `<span class="folio-group">${group}</span>` + items.map(([k, label, key]) =>
    `<a href="#/${k}" data-nav="${k}" data-key="g ${key}" class="${k === active ? 'active' : ''}"${k === active ? ' aria-current="page"' : ''}>${label}${k === 'studio' ? '<span class="badge" style="display:none"></span>' : ''}${k === active ? '<i class="folio-mark" aria-hidden="true"></i>' : ''}</a>`).join('')).join('');
  requestAnimationFrame(() => document.querySelector('#nav a.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  const s = state.status;
  const badge = document.querySelector('[data-nav="studio"] .badge');
  if (badge && s?.counts.awaiting) { badge.textContent = s.counts.awaiting; badge.style.display = ''; }
}

// ---------------------------------------------------------------- desk switch (Night default) with the ink roller
const root = document.documentElement;
function themeNow() { return root.dataset.theme === 'light' ? 'light' : 'dark'; }
function paintSwitch() {
  const b = document.getElementById('theme-toggle');
  const night = themeNow() === 'dark';
  b.setAttribute('aria-checked', String(night));
  b.setAttribute('aria-label', night ? 'Night desk on — switch to Proof desk' : 'Proof desk on — switch to Night desk');
  b.dataset.short = night ? '☾ Night' : '☼ Proof';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', night ? '#1C1A15' : '#1C1A16');
}
function applyTheme(next) {
  if (next === themeNow()) return;
  const swap = () => { root.dataset.theme = next; paintSwitch(); };
  if (!document.startViewTransition || reducedMotion()) { swap(); return; }
  runningVT?.skipTransition();
  root.classList.add('theme-wipe');
  const roller = document.createElement('div');
  const vt = document.startViewTransition(() => { swap(); roller.className = 'ink-roller'; document.body.append(roller); });
  vt.ready.catch(() => {});
  vt.finished.catch(() => {}).finally(() => { root.classList.remove('theme-wipe'); roller.remove(); });
}
window.__byline.setTheme = (pref) => {
  try { localStorage.setItem('byline-theme', pref); } catch (e) { /* storage unavailable */ }
  applyTheme(pref === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref);
};
function toggleDesk() { window.__byline.setTheme(themeNow() === 'dark' ? 'light' : 'dark'); }
document.getElementById('theme-toggle').addEventListener('click', toggleDesk);
paintSwitch();

// ---------------------------------------------------------------- nameplate: inking the plate
const plate = document.querySelector('.nameplate');
function ink() {
  if (reducedMotion()) return;
  plate.style.setProperty('--np-w', `${plate.offsetWidth}px`);
  plate.classList.remove('inking'); void plate.offsetWidth; plate.classList.add('inking');
  setTimeout(() => plate.classList.remove('inking'), 900);
}
plate.addEventListener('click', (e) => {
  if (location.hash.replace(/^#\/?/, '').split('/')[0] === 'today' || location.hash === '' || location.hash === '#/') {
    e.preventDefault();
    const go = () => { ink(); replayEntrance(); };
    runningVT ? runningVT.finished.catch(() => {}).finally(go) : go();
  } else ink();
});
function replayEntrance() {
  const el = document.getElementById('view');
  el.classList.remove('press', 'hero'); void el.offsetWidth; el.classList.add('press');
  el.querySelectorAll('.score-num[data-counted]').forEach(n => { const i = n.querySelector('.int'); if (i) { i.dataset.final = i.dataset.final || i.textContent; i.textContent = String(Math.round(Number(n.dataset.from || 0))); } n.removeAttribute('data-counted'); n.classList.remove('landed'); n.closest('.score')?.classList.remove('landed'); });
  countUp(el);
  clearTimeout(route.settle); route.settle = setTimeout(() => el.classList.remove('press', 'hero'), 1700);
}

function heroDue(key) {
  if (key !== 'today') return false;
  try { if (sessionStorage.getItem('byline-hero')) return false; sessionStorage.setItem('byline-hero', '1'); } catch (e) { return false; }
  return true;
}

// ---------------------------------------------------------------- direction for predictive/back navigation
let navIdx = history.state?.idx ?? 0, maxIdx = navIdx;
function direction() {
  const idx = history.state?.idx;
  if (idx == null) { navIdx = ++maxIdx; history.replaceState({ ...(history.state || {}), idx: navIdx }, ''); return 'forward'; }
  const dir = idx < navIdx ? 'back' : 'forward'; navIdx = idx; return dir;
}

// ---------------------------------------------------------------- route with view transitions, skeletons and a stale guard
let runningVT = null;
async function route() {
  if (history.state?.sheet) return; // a sheet's history entry; the sheet handles it
  const seq = route.seq = (route.seq || 0) + 1;
  const [name = 'today', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const key = ROUTES[name] ? name : 'today';
  const dir = direction();
  const main = document.getElementById('view');
  const bar = document.getElementById('pressbar');
  const old = main.querySelector('.page.current');
  const page = document.createElement('div');
  page.className = 'page';
  main.append(page);
  let skeleton = null;
  const slow = setTimeout(() => {
    if (seq !== route.seq) return;
    bar.classList.add('on');
    skeleton = document.createElement('div');
    skeleton.className = 'page current';
    skeleton.innerHTML = galleyProof(key);
    old?.remove();
    renderNav(ALIAS[key] || key);
    main.append(skeleton);
  }, 200);
  try {
    const mod = await import(ROUTES[key]);
    await mod.render(page, { name: key, params });
  } catch (e) {
    console.error(e);
    page.innerHTML = String(html`<div class="card"><h2>Something went wrong</h2><p class="muted">${e.message}</p></div>`);
  }
  clearTimeout(slow);
  if (seq !== route.seq) { page.remove(); return; }
  bar.classList.remove('on');

  const swap = () => {
    main.querySelectorAll('.page.current').forEach(p => { if (p !== page) p.remove(); });
    old?.remove();
    page.classList.add('current');
    renderNav(ALIAS[key] || key);
    main.dataset.route = key;
    // the page is a fresh element, so its entrance starts on its own; no forced reflow here
    main.classList.remove('hero');
    main.classList.add('press');
    if (heroDue(key)) { main.classList.add('hero'); ink(); }
    if (window.scrollY) window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const after = () => {
    decorate(page);
    clearTimeout(route.settle);
    route.settle = setTimeout(() => main.classList.remove('press', 'hero'), 1700);
    document.getElementById('route-live').textContent = `${NAV_FLAT.find(n => n.route === (ALIAS[key] || key))?.label || ''} loaded`;
  };
  root.dataset.dir = dir;
  if (skeleton) {
    // a skeleton was showing: crossfade it out, then the entrance runs (no view transition)
    skeleton.classList.remove('current');
    skeleton.querySelector('.galley')?.classList.add('out');
    setTimeout(() => skeleton.remove(), 160);
    swap(); after();
  } else if (old && document.startViewTransition && !reducedMotion() && !document.hidden && !matchMedia('(max-width: 760px), (pointer: coarse)').matches) {
    runningVT?.skipTransition();
    const vt = runningVT = document.startViewTransition(swap);
    vt.updateCallbackDone.then(after, after);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => { if (runningVT === vt) runningVT = null; });
  } else { swap(); after(); }
  refreshStatus();
}

/** Post-render enrichment shared by every tab. */
function decorate(scope) {
  countUp(scope);
  // numeric table cells align right
  scope.querySelectorAll('td').forEach(td => { if (/^[\s$€£+−-]*[\d.,]+\s*[%kKmM×x]?\s*$/.test(td.textContent) && td.textContent.trim()) td.classList.add('num'); });
  // re-run when a view re-renders itself in place
  if (!scope.__observed) {
    scope.__observed = true;
    new MutationObserver(() => { clearTimeout(scope.__deb); scope.__deb = setTimeout(() => countUp(scope), 30); }).observe(scope, { childList: true, subtree: true });
  }
}

// POST-WORTHY stamp lands when a count crosses the threshold (max 3 per screen)
document.addEventListener('counted', (e) => {
  const el = e.target, holder = el.closest('.score');
  holder?.classList.add('landed');
  if (!holder || !holder.hasAttribute('data-stamp') || e.detail.value < e.detail.threshold) return;
  if (document.querySelectorAll('.pw-stamp').length >= 3 || holder.querySelector('.pw-stamp')) return;
  holder.insertAdjacentHTML('beforeend', '<span class="pw-stamp">Post-worthy</span>');
});

// ---------------------------------------------------------------- honest stage-driven pressbar + press-run band
export async function stagedRun(promise) {
  const bar = document.getElementById('pressbar');
  const shell = document.querySelector('.shell');
  bar.classList.add('staged', 'on');
  shell.classList.add('running');
  bar.innerHTML = '<i class="stage-fill"></i>';
  const cap = document.createElement('span'); cap.className = 'stage-caption'; cap.textContent = 'Collecting…';
  document.querySelector('.masthead').append(cap);
  const STAGES = ['collect', 'cluster', 'rank', 'brief', 'draft'];
  const VERB = { collect: 'Collecting', cluster: 'Clustering', rank: 'Ranking', brief: 'Writing the brief', draft: 'Drafting' };
  let done = false;
  const poll = async () => {
    while (!done) {
      try {
        const [latest] = await api.get('/runs', { fresh: true });
        if (latest && latest.status === 'running') {
          const r = await api.get(`/runs/${latest.id}`, { fresh: true });
          const finished = r.stages.filter(s => s.status === 'done').length;
          const cur = r.stages.find(s => s.status === 'running');
          bar.style.setProperty('--f', String(Math.min(1, (finished + (cur ? .5 : 0)) / STAGES.length)));
          if (cur) cap.textContent = `${VERB[cur.stage] || cur.stage}… ${finished + 1}/${STAGES.length}`;
        }
      } catch (e) { /* keep polling */ }
      await new Promise(r => setTimeout(r, 450));
    }
  };
  poll();
  try { return await promise; }
  finally {
    done = true;
    bar.style.setProperty('--f', '1');
    setTimeout(() => { bar.classList.remove('staged', 'on'); bar.innerHTML = ''; bar.style.removeProperty('--f'); cap.remove(); shell.classList.remove('running'); }, 420);
    refreshStatus({ flap: true });
  }
}
window.__byline.stagedRun = stagedRun;

// ---------------------------------------------------------------- prefetch: hover/touch on folios, idle import of the rest
const warmed = new Set();
function warm(k) {
  if (!k || warmed.has(k) || !ROUTES[k]) return;
  warmed.add(k);
  import(ROUTES[k]).catch(() => warmed.delete(k));
  if (DATA[k]) api.get(DATA[k]).catch(() => {});
}
const navEl = document.getElementById('nav');
navEl.addEventListener('pointerenter', (e) => warm(e.target.closest?.('a[data-nav]')?.dataset.nav), true);
navEl.addEventListener('touchstart', (e) => warm(e.target.closest?.('a[data-nav]')?.dataset.nav), { passive: true });
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => Object.keys(ROUTES).forEach(k => { if (!['story', 'draft', 'person'].includes(k)) import(ROUTES[k]).catch(() => {}); }));

// ---------------------------------------------------------------- keyboard row focus (j / k / Enter)
function rows() { return [...document.querySelectorAll('#view .page.current :is(.story, .brief-item, tbody tr, .hit, .source-row)')].filter(r => r.offsetParent); }
function moveRow(d) {
  const list = rows(); if (!list.length) return;
  const cur = list.findIndex(r => r.classList.contains('kfocus'));
  const next = list[Math.max(0, Math.min(list.length - 1, cur + d))];
  list.forEach(r => r.classList.remove('kfocus'));
  next.classList.add('kfocus');
  next.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
}
function openRow() { const r = document.querySelector('.kfocus'); const a = r?.querySelector('a[href]'); if (a) a.click(); else r?.click(); }

// ---------------------------------------------------------------- Index (command menu) + shortcuts (module loads lazily)
const go = (href) => { location.hash = href.replace(/^#/, ''); };
const ACTIONS = [
  { id: 'run', label: 'Run today’s workflow', hint: 'Collect → draft', run: () => { go('#/today'); setTimeout(() => document.querySelector('[data-act="run"]')?.click(), 400); } },
  { id: 'desk', label: 'Switch desk (Night / Proof)', hint: 'n', run: toggleDesk },
  { id: 'add', label: 'Add a story by URL', hint: 'Feed', run: () => { go('#/feed'); setTimeout(() => document.querySelector('[name="url"]')?.focus(), 400); } },
  { id: 'ink', label: 'Re-ink the nameplate', hint: 'Today', run: () => plate.click() },
  { id: 'style', label: 'House style sheet (shortcuts)', hint: '?', run: () => window.__byline.styleSheet?.() }
];
document.getElementById('index-btn').addEventListener('click', async () => {
  const m = await import('./index-menu.js').catch(() => null);
  m?.openIndex?.();
});
import('./index-menu.js').then((m) => {
  m.initIndex?.({ nav: NAV_FLAT, go, actions: ACTIONS });
  m.initShortcuts?.({ go, nav: NAV_FLAT, onTheme: toggleDesk, onNext: () => moveRow(1), onPrev: () => moveRow(-1), onOpen: openRow, onPlay: () => document.querySelector('#wire-player button')?.click() });
  m.keytips?.(document);
  if (m.openStyleSheet) window.__byline.styleSheet = m.openStyleSheet;
}).catch(() => {
  // the Index isn't installed: keep the essential keys working
  document.addEventListener('keydown', (e) => {
    if (inField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n') toggleDesk(); else if (e.key === 'j') moveRow(1); else if (e.key === 'k') moveRow(-1);
  });
});

document.addEventListener('visibilitychange', () => root.classList.toggle('doc-hidden', document.hidden));
window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Unexpected error', 'err'));
export { stampChanged };
route();
