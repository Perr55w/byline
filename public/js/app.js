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
    const ai = s.provider.active === 'claude' ? html`<span class="dot ok"></span>Claude (${s.provider.model})` : s.provider.active === 'ollama' ? html`<span class="dot ok"></span>Ollama (${s.provider.model})` : html`<span class="dot warn"></span>Template drafting engine`;
    document.getElementById('rail-foot').innerHTML = String(html`
      <div>${ai}</div>
      <div><span class="dot ${s.publishers.linkedin.available ? 'ok' : ''}"></span>LinkedIn ${s.publishers.linkedin.available ? 'connected' : 'manual export'}</div>
      <div><span class="dot ${s.connectors.x.ready ? 'ok' : ''}"></span>X ${s.connectors.x.ready ? 'connected' : 'not configured'}</div>
      <div style="margin-top:8px">${s.counts.stories} stories · ${s.counts.sources} sources</div>
      ${s.counts.demo_articles ? html`<div style="margin-top:6px"><span class="demo-flag">DEMO DATA LOADED</span></div>` : ''}
      <div style="margin-top:6px">${s.today} · ${s.timezone}</div>`);
    const badge = document.querySelector('[data-nav="studio"] .badge');
    if (badge) badge.textContent = s.counts.awaiting || '';
    if (badge) badge.style.display = s.counts.awaiting ? '' : 'none';
  } catch (e) { /* server restarting */ }
}

function renderNav(active) {
  document.getElementById('nav').innerHTML = NAV.map(([group, items]) => `<div class="nav-group">${group}</div>` + items.map(([k, label]) =>
    `<a href="#/${k}" data-nav="${k}" class="${k === active ? 'active' : ''}">${label}${k === 'studio' ? '<span class="badge" style="display:none"></span>' : ''}</a>`).join('')).join('');
}

const ALIAS = { story: 'feed', draft: 'studio', person: 'people' };

async function route() {
  const [name = 'today', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const key = ROUTES[name] ? name : 'today';
  renderNav(ALIAS[key] || key);
  const el = document.getElementById('view');
  el.innerHTML = '<div class="muted" style="padding:40px 0"><span class="spinner"></span> Loading…</div>';
  try {
    const mod = await import(ROUTES[key]);
    await mod.render(el, { name: key, params });
  } catch (e) {
    console.error(e);
    el.innerHTML = String(html`<div class="card"><h2>Something went wrong</h2><p class="muted">${e.message}</p></div>`);
  }
  refreshStatus();
}

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Unexpected error', 'err'));
route();
