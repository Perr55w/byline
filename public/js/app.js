import { api } from './api.js';
import { html, toast } from './ui.js';

const NAV = [
  ['Daily', [['today', 'Today'], ['feed', 'Feed'], ['studio', 'Studio'], ['calendar', 'Calendar']]],
  ['Career', [['career', 'Career'], ['employers', 'Employers'], ['people', 'People'], ['campaigns', 'Campaigns']]],
  ['Control', [['performance', 'Performance'], ['sources', 'Sources'], ['runs', 'Runs'], ['search', 'Archive'], ['settings', 'Settings']]]
];

// route → module path (lazy loaded); `story/:id` style params are passed as an array.
const ROUTES = {
  today: './views/today.js', feed: './views/feed.js', story: './views/feed.js', studio: './views/studio.js', draft: './views/studio.js',
  calendar: './views/calendar.js', career: './views/career.js', employers: './views/employers.js', people: './views/people.js', person: './views/people.js',
  campaigns: './views/campaigns.js', performance: './views/performance.js', sources: './views/sources.js', runs: './views/runs.js', search: './views/search.js', settings: './views/settings.js'
};

export const state = { status: null };

export async function refreshStatus() {
  try {
    state.status = await api.get('/status');
    const s = state.status;
    const engine = s.provider.active === 'claude' ? `Claude` : s.provider.active === 'ollama' ? `Ollama` : 'Template engine';
    document.getElementById('rail-foot').innerHTML = String(html`
      <span><span class="dot ${s.provider.active === 'local' ? 'warn' : 'ok'}"></span><b>${engine}</b></span>
      <span>LinkedIn: <b>${s.publishers.linkedin.available ? 'connected' : 'manual'}</b></span>
      <span><b>${s.counts.stories}</b> stories · <b>${s.counts.sources}</b> sources</span>
      ${s.counts.demo_articles ? html`<span class="demo-flag" style="color:#E0B055">Demo data</span>` : ''}`);
    const d = new Date(`${s.today}T12:00:00`);
    const doy = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    document.getElementById('dateline').textContent = `Vol. 1 · No. ${doy} · ${d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '')}`;
    const badge = document.querySelector('[data-nav="studio"] .badge');
    if (badge) badge.textContent = s.counts.awaiting || '';
    if (badge) badge.style.display = s.counts.awaiting ? '' : 'none';
  } catch (e) { /* server restarting */ }
}

function renderNav(active) {
  document.getElementById('nav').innerHTML = NAV.map(([group, items]) => `<span class="folio-group">${group}</span>` + items.map(([k, label]) =>
    `<a href="#/${k}" data-nav="${k}" class="${k === active ? 'active' : ''}"${k === active ? ' aria-current="page"' : ''}>${label}${k === 'studio' ? '<span class="badge" style="display:none"></span>' : ''}</a>`).join('')).join('');
  document.querySelector('#nav a.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Theme: Proof Desk (light) / Night desk (dark); follows the system until chosen.
function themeNow() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function paintToggle() { document.getElementById('theme-toggle').textContent = themeNow() === 'dark' ? 'Proof desk' : 'Night desk'; }
document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = themeNow() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('byline-theme', next); } catch (e) { /* storage unavailable */ }
  paintToggle();
});
paintToggle();

// The full "going to press" hero plays on the first Today render of the session; every route gets the compressed grammar.
function heroDue(key) {
  if (key !== 'today') return false;
  try { if (sessionStorage.getItem('byline-hero')) return false; sessionStorage.setItem('byline-hero', '1'); } catch (e) { return false; }
  return true;
}

const ALIAS = { story: 'feed', draft: 'studio', person: 'people' };

async function route() {
  const [name = 'today', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const key = ROUTES[name] ? name : 'today';
  renderNav(ALIAS[key] || key);
  const el = document.getElementById('view');
  const bar = document.getElementById('pressbar');
  const slow = setTimeout(() => { bar.classList.add('on'); el.innerHTML = '<div class="loading">Setting type…</div>'; }, 200);
  el.classList.remove('press', 'hero');
  el.dataset.route = key;
  try {
    const mod = await import(ROUTES[key]);
    await mod.render(el, { name: key, params });
  } catch (e) {
    console.error(e);
    el.innerHTML = String(html`<div class="card"><h2>Something went wrong</h2><p class="muted">${e.message}</p></div>`);
  }
  clearTimeout(slow);
  bar.classList.remove('on');
  void el.offsetWidth; // restart animations for this route only
  el.classList.add('press');
  if (heroDue(key)) el.classList.add('hero');
  clearTimeout(route.settle);
  route.settle = setTimeout(() => el.classList.remove('press', 'hero'), 1700); // in-view re-renders never replay the entrance
  refreshStatus();
}

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Unexpected error', 'err'));
route();
