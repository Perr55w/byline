// Sources (rebuilt from 25). SPEC §5, D §5 sketch, F §2 Sources headline (honest: "Collection is off:
// all 26 sources are paused."). Summary header from /api/sources/summary; tabs Sources | Watchlists |
// Connectors. Every v3 feature is kept: add / edit / delete source, pause or enable, sync now, Submit
// URL (with the paste-text fallback), watchlists (terms, weight, pin, add, delete) and connector status.
// The table carries a shape + label health mark, group, evidence kind, enabled switch, last sync, 7d,
// total, stories and Sync; a row expands to its recent articles (GET /api/sources/:id/articles), the
// last error and an edit form. Filters: group, health, text. Route: #/sources[/watchlists|/connectors].
import { api } from '../api.js';
import { html, raw, esc, on, act, toast, icon, modal, strikeOut, scoreChip, timeAgo, useStyle, optimistic } from '../ui.js';
import { enterItems, reduced } from '../motion.js';

const KINDS = [['rss', 'RSS / Atom feed'], ['blog', 'Company blog (feed)'], ['docs', 'Docs / release notes (feed)'], ['research', 'Research feed'], ['x', 'X search (needs API token)']];
const EVIDENCE = [['announcement', 'Announcement (first-party)'], ['reporting', 'Independent reporting'], ['research', 'Research'], ['commentary', 'Commentary']];
const EV_SHORT = { announcement: 'First-party', reporting: 'Reporting', research: 'Research', commentary: 'Commentary', community: 'Community', application: 'Release notes', own_work: 'My project' };
const WATCH_KINDS = ['company', 'researcher', 'product', 'framework', 'skill', 'question', 'team', 'topic'];
const HEALTH = { ok: 'Healthy', stale: 'Stale', error: 'Failing', paused: 'Paused' };
const TABS = [['sources', 'Sources'], ['watchlists', 'Watchlists'], ['connectors', 'Connectors']];
const ui = { tab: 'sources', group: '', health: '', text: '', sort: 'group', dir: 1, open: new Set(), sync: {}, manual: null };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const splitTerms = (s) => s.split(',').map(t => t.trim()).filter(Boolean);
const opts = (list, sel) => list.map(([v, l]) => html`<option value="${v}"${v === sel ? raw(' selected') : ''}>${l}</option>`);
const fmtWhen = (iso, tz) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, ...(tz ? { timeZone: tz } : {}) }).replace(',', '') : '';
const fmtDay = (iso, tz) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) }) : '';

/** Visible table columns at this width (a colspan wider than the visible columns would add a phantom column). */
let d7Shown = true; // R3: the 7d column is left out while it would equal Total on every row
const colCount = () => matchMedia('(max-width: 760px)').matches ? 4 : (matchMedia('(max-width: 1360px)').matches ? 10 : 11) - (d7Shown ? 0 : 1);
let colWatch = false;
function watchCols() {
  if (colWatch) return; colWatch = true;
  addEventListener('resize', () => { const n = String(colCount()); document.querySelectorAll('#view tr.so-detail > td').forEach(td => { if (td.getAttribute('colspan') !== n) td.setAttribute('colspan', n); }); }, { passive: true });
}

/** Health mark: a distinct shape per state (never colour alone) + a text label. */
function healthMark(h) {
  const shape = {
    ok: '<circle cx="6" cy="6" r="4.5" class="f"/>',
    stale: '<circle cx="6" cy="6" r="4" class="s"/><path d="M6 2a4 4 0 0 1 0 8z" class="f"/>',
    error: '<path d="M6 1.6 10.8 10H1.2z" class="f"/>',
    paused: '<rect x="2.4" y="2" width="2.4" height="8" rx=".6" class="f"/><rect x="7.2" y="2" width="2.4" height="8" rx=".6" class="f"/>'
  }[h] || '<circle cx="6" cy="6" r="4" class="s"/>';
  return raw(`<svg class="so-hm" data-h="${esc(h)}" viewBox="0 0 12 12" aria-hidden="true" focusable="false">${shape}</svg>`);
}

/** R1: a 7 px health dot (ok / stale / error colour; a hollow neutral ring for paused). Always next to a text label. */
const healthDot = (h) => raw(`<i class="so-dot" data-h="${esc(h)}" aria-hidden="true"></i>`);
/** R2: demo rows carry a Demo tag, so the stored "DEMO · " name prefix is dropped from the display (data unchanged). */
const displayName = (s) => (s.is_demo ? String(s.name).replace(/^\s*demo\s*[·:\-–—]\s*/i, '') : s.name);

/**
 * Run `fn` once the page holding `el` has been swapped in (byline:routed) and the main thread is idle, so
 * below-the-fold markup stays out of the tab-change frames (E1). Re-renders of a page already on screen
 * run it on the next idle period.
 */
function afterEnter(view, el, fn) {
  let done = false;
  const run = () => { if (done) return; done = true; document.removeEventListener('byline:routed', onRouted); if (el.isConnected) fn(); };
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 500 }) : setTimeout(run, 60));
  const onRouted = (e) => { if (e.detail?.page?.contains(el)) { document.removeEventListener('byline:routed', onRouted); requestAnimationFrame(() => setTimeout(idle, 0)); } };
  if (view.closest?.('.page.current') || view.classList?.contains('current')) { idle(); return; }
  document.addEventListener('byline:routed', onRouted);
  setTimeout(run, 2500);
}

// ------------------------------------------------------------------ headline (F §2 Sources, verbatim templates + fallbacks)
function headline(S) {
  const m = S.summary, n = m.sources;
  if (!n) return { h: 'No sources yet.', l: html`Add a feed, or load the demo sources from Settings. Submitting a single URL works without any source.` };
  const most = m.most_stories ? html` Most stories: <b>${m.most_stories.name}</b> (${m.most_stories.stories_count}).` : '';
  if (m.all_paused) {
    const u = m.unpaused_health || {};
    return {
      h: `Collection is off: all ${n} sources are paused.`,
      l: html`Before the pause, <b>${u.error ?? 0}</b> were failing, <b>${u.stale ?? 0}</b> stale and <b>${u.ok ?? 0}</b> healthy${m.demo ? html`; <b>${m.demo}</b> are demo` : ''}. <b>${m.articles_total}</b> articles in total${m.most_articles ? html`; <b>${m.most_articles.name}</b> contributed the most (${m.most_articles.article_count})` : ''}.${S.status?.schedule?.enabled === false ? ' The daily schedule is off too.' : ''}`
    };
  }
  const line = html`<b>${n}</b> sources · <b>${m.ok}</b> healthy · <b>${m.stale}</b> stale · <b>${m.error}</b> failing${m.paused ? html` · <b>${m.paused}</b> paused` : ''} · <b>${m.articles_7d}</b> articles this week.${most}`;
  if (m.error > 0) return { h: `${m.error} of ${n} sources are failing.`, l: line };
  return { h: `${m.ok} of ${n} sources are healthy.`, l: line };
}

// ------------------------------------------------------------------ summary header with numbers
function summaryHtml(S) {
  const m = S.summary, n = m.sources || 0;
  const stat = (v, label, tone = '') => html`<div class="so-stat${tone ? ` so-stat--${tone}` : ''}"><span class="so-stat-v">${v}</span><span class="so-stat-l">${label}</span></div>`;
  const bar = (counts, label) => {
    return html`<div class="so-hbar-row"><span class="so-hbar-label">${label}</span>
      <div class="so-hbar" role="img" aria-label="${label}: ${Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${v} ${HEALTH[k].toLowerCase()}`).join(', ')}">${Object.entries(counts).filter(([, v]) => v).map(([k, v]) => html`<i data-h="${k}" style="flex:${v}"></i>`)}</div>
      <span class="so-hbar-legend">${Object.entries(counts).filter(([, v]) => v).map(([k, v]) => html`<span>${healthDot(k)}${v} ${HEALTH[k].toLowerCase()}</span>`)}</span></div>`;
  };
  const collecting = n - (m.paused || 0);
  // R3: one state cell instead of four big zeros (sources · collecting · healthy · stale · failing)
  const state = m.all_paused
    ? { big: html`All <b>${n}</b> paused`, sub: html`<b>0</b> collecting${S.status?.schedule?.enabled === false ? ' · schedule off' : ''}`, tone: 'warn' }
    : { big: html`<b>${m.ok}</b> of ${n} healthy`, sub: html`<b>${collecting}</b> collecting${m.stale ? html` · <b>${m.stale}</b> stale` : ''}${m.error ? html` · <b>${m.error}</b> failing` : ''}${m.paused ? html` · <b>${m.paused}</b> paused` : ''}`, tone: m.error ? 'err' : m.stale ? 'warn' : 'ok' };
  return html`<section class="so-summary tile tile--static" aria-label="Source health summary">
    <div class="so-stats">
      <div class="so-state" data-tone="${state.tone}"><span class="so-state-v">${healthDot(m.all_paused ? 'paused' : state.tone === 'err' ? 'error' : state.tone === 'warn' ? 'stale' : 'ok')}<span>${state.big}</span></span><span class="so-stat-l">${state.sub}</span></div>
      ${stat(m.articles_7d, 'articles · 7 days')}${stat(m.demo, 'demo')}
    </div>
    <div class="so-bars">
      ${bar({ ok: m.ok, stale: m.stale, error: m.error, paused: m.paused }, 'Now')}
      ${m.paused && m.unpaused_health ? bar({ ok: m.unpaused_health.ok, stale: m.unpaused_health.stale, error: m.unpaused_health.error }, m.all_paused ? 'Before the pause' : 'Paused ones, if resumed') : ''}
    </div>
    <p class="so-facts">${m.most_stories ? html`<span>Most stories <b>${m.most_stories.name}</b> (${m.most_stories.stories_count})</span>` : ''}${m.most_articles ? html`<span>Most articles <b>${m.most_articles.name}</b> (${m.most_articles.article_count})</span>` : ''}${m.last_sync_at ? html`<span>Last sync <b><time datetime="${m.last_sync_at}">${fmtWhen(m.last_sync_at, S.tz)}</time></b></span>` : ''}</p>
    ${m.all_paused ? html`<div class="so-notice" role="note">${healthMark('paused')}<p><b>Runs read 0 sources until you resume some.</b> Switch a source on in the table${S.status?.schedule?.enabled === false ? html`, and turn on the daily schedule in <a href="#/settings">Settings</a>` : ''}. Demo sources are never polled.</p></div>` : ''}
  </section>`;
}

// ------------------------------------------------------------------ sources table
function visibleSources(S) {
  const t = ui.text.trim().toLowerCase();
  const list = S.sources.filter(s => (!ui.group || (s.grp || 'General') === ui.group)
    && (!ui.health || s.health === ui.health || (ui.health === 'was_error' && s.health === 'paused' && s.health_unpaused === 'error'))
    && (!t || `${s.name} ${s.url} ${s.grp} ${s.kind} ${s.employer || ''} ${s.last_error || ''}`.toLowerCase().includes(t)));
  const key = { name: s => s.name.toLowerCase(), sync: s => s.last_sync_at || '', d7: s => s.articles_7d || 0, total: s => s.article_count || 0, stories: s => s.stories_count || 0 }[ui.sort];
  if (key) list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.dir; });
  return list;
}
function sortTh(k, label, cls = '') {
  const on = ui.sort === k;
  return html`<th class="${cls}" aria-sort="${on ? (ui.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="so-sort so-btn" data-so-sort="${k}">${label}<span class="so-sort-i" aria-hidden="true">${on ? (ui.dir > 0 ? '↑' : '↓') : ''}</span></button></th>`;
}
function sourceRow(s, S, { cv = false, d7 = true } = {}) {
  const open = ui.open.has(s.id);
  const res = ui.sync[s.id];
  const polled = !s.is_demo && s.kind !== 'manual';
  const wasErr = s.health === 'paused' && s.health_unpaused === 'error';
  const sub = wasErr ? html`<span class="so-sub so-was" title="${s.last_error ? `Last error: ${s.last_error}` : 'Failing when last collected'}">was failing</span>`
    : s.health === 'stale' && !s.last_sync_at ? html`<span class="so-sub">never synced</span>` : '';
  const name = displayName(s);
  return html`<tr class="so-row${open ? ' is-open' : ''}${cv && !open ? ' cv-row' : ''}" data-row data-id="${s.id}">
    <td class="so-c-x"><button type="button" class="btn btn--ghost btn--icon btn--sm so-x" data-so-expand="${s.id}" aria-expanded="${open}" aria-controls="so-d-${s.id}" aria-label="${open ? 'Hide' : 'Show'} details for ${name}">${icon('chevron-right')}</button></td>
    <td class="so-c-h"><span class="so-health" data-h="${s.health}">${healthDot(s.health)}<span>${HEALTH[s.health] || s.health}</span></span>${sub}</td>
    <td class="so-c-name"><span class="so-name" title="${name}">${name}</span>
      <span class="so-url-line">${s.is_demo ? html`<span class="tag tag--demo">Demo</span>` : ''}<span class="so-url">${s.kind === 'x' ? `query: ${s.url}` : s.url.replace(/^https?:\/\//, '')}</span></span>
      <span class="so-phone-meta">${wasErr ? html`<span class="so-was">was failing</span> · ` : ''}${s.grp || 'General'} · ${EV_SHORT[s.evidence_kind] || s.evidence_kind} · ${s.is_demo ? 'not polled' : s.last_sync_at ? `synced ${timeAgo(s.last_sync_at)}` : 'never synced'} · ${s.article_count} articles</span>
      ${res ? html`<span class="so-res ${res.ok ? 'ok' : 'err'}">${res.msg}</span>` : ''}</td>
    <td class="so-c-grp">${s.grp || 'General'}</td>
    <td class="so-c-ev"><span class="so-ev">${EV_SHORT[s.evidence_kind] || s.evidence_kind}</span><span class="so-sub">${s.kind}</span></td>
    <td class="so-c-on">${s.kind === 'manual' ? html`<span class="so-dash" title="Manual submissions are always on">—</span>` : html`<input type="checkbox" class="switch" data-so-on="${s.id}" ${s.paused ? '' : raw('checked')} aria-label="Collect from ${name}">`}</td>
    <td class="so-c-sync">${s.is_demo ? html`<span class="so-sub">not polled</span>` : s.last_sync_at ? html`<time datetime="${s.last_sync_at}" title="${fmtWhen(s.last_sync_at, S.tz)}">${timeAgo(s.last_sync_at)}</time>` : html`<span class="so-sub">never</span>`}</td>
    ${d7 ? html`<td class="num">${s.articles_7d}</td>` : ''}
    <td class="num">${s.article_count}</td>
    <td class="num">${s.stories_count}</td>
    <td class="so-c-act">${polled ? html`<button type="button" class="btn btn--secondary btn--sm" data-so-act="sync" data-id="${s.id}"${s.connector_status?.ready === false ? html` title="${s.connector_status.reason}"` : ''}>Sync</button>` : s.is_demo ? html`<span class="so-sub" title="Demo sources hold sample data and are never polled">demo</span>` : ''}</td>
  </tr>
  ${open ? html`<tr class="so-detail" id="so-d-${s.id}"><td colspan="${colCount()}">${detailHtml(s, S)}</td></tr>` : ''}`;
}
function detailHtml(s, S) {
  const arts = S.articles[s.id];
  return html`<div class="so-detail-grid">
    <section class="so-d-arts" aria-label="Recent articles from ${displayName(s)}">
      <h3 class="section-label">Recent articles</h3>
      ${arts === undefined ? html`<p class="so-sub" data-so-loading="${s.id}">Loading the latest five…</p>`
        : arts?.error ? html`<p class="so-res err">${arts.error}</p>`
        : !arts.length ? html`<p class="so-sub">No articles collected from this source yet.</p>`
        : html`<ol class="so-arts">${arts.map(a => html`<li>
            <a class="so-art" href="${a.story_id ? `#/story/${a.story_id}` : a.url}" ${a.story_id ? raw('data-dossier-src') : raw('target="_blank" rel="noopener"')}>
              <span class="so-art-t">${a.title}${a.is_demo ? html` <span class="tag tag--demo">Demo</span>` : ''}</span>
              <span class="so-art-m"><time datetime="${a.published_at || a.fetched_at}">${fmtDay(a.published_at || a.fetched_at, S.tz)}</time><span class="mono">${a.domain}</span><span>${EV_SHORT[a.evidence_kind] || a.evidence_kind}</span>${a.story_id ? html`<span class="so-art-story">${a.story_title && a.story_title !== a.title ? html`in <b>${a.story_title.length > 54 ? `${a.story_title.slice(0, 52).replace(/\s+\S*$/, '')}…` : a.story_title}</b>` : 'leads its own story'}</span>${a.story_score != null ? scoreChip(a.story_score, S.T) : ''}` : ''}</span>
            </a></li>`)}</ol>`}
    </section>
    <section class="so-d-status" aria-label="Status">
      <h3 class="section-label">Status</h3>
      <dl class="kv so-kv">
        <dt>Health</dt><dd><span class="so-health" data-h="${s.health}">${healthDot(s.health)}${HEALTH[s.health]}</span>${s.health === 'paused' && s.health_unpaused ? html` <span class="so-sub">· ${HEALTH[s.health_unpaused].toLowerCase()} when on</span>` : ''}</dd>
        <dt>Connector</dt><dd>${s.connector || s.kind}${s.connector_status?.ready === false ? html`<span class="so-res err">${s.connector_status.reason}</span>` : ''}</dd>
        <dt>Last sync</dt><dd>${s.last_sync_at ? html`${fmtWhen(s.last_sync_at, S.tz)} · ${plural(s.last_count ?? 0, 'new item')}` : 'Never'}</dd>
        <dt>Newest article</dt><dd>${s.last_article_at ? fmtWhen(s.last_article_at, S.tz) : '—'}</dd>
        ${s.employer ? html`<dt>Employer</dt><dd>${s.employer}</dd>` : ''}
        <dt>Last error</dt><dd>${s.last_error ? html`<span class="so-err-text">${s.last_error}</span>` : html`<span class="so-sub">None</span>`}</dd>
      </dl>
    </section>
    <form class="so-d-edit" data-so-form="edit" data-id="${s.id}" aria-label="Edit ${displayName(s)}">
      <h3 class="section-label">Edit source</h3>
      <label class="field">Name<input class="input" name="name" required value="${s.name}"></label>
      <label class="field">${s.kind === 'x' ? 'X search query' : 'URL'}<input class="input" name="url" required value="${s.url}"${s.kind === 'manual' ? raw(' readonly') : ''}></label>
      <div class="so-2">
        <label class="field">Group<input class="input" name="grp" list="so-grp-list" value="${s.grp || ''}"></label>
        <label class="field">Evidence<select class="select" name="evidence_kind">${opts([...EVIDENCE, ...(EVIDENCE.some(e => e[0] === s.evidence_kind) ? [] : [[s.evidence_kind, EV_SHORT[s.evidence_kind] || s.evidence_kind]])], s.evidence_kind)}</select></label>
      </div>
      <label class="field">Employer (optional)<input class="input" name="employer" list="so-emp-list" value="${s.employer || ''}"></label>
      <div class="cluster so-edit-actions"><button class="btn btn--primary btn--sm" type="submit">Save changes</button><button type="button" class="btn btn--danger btn--sm" data-so-act="del-source" data-id="${s.id}" data-name="${s.name}">Delete source</button></div>
    </form>
  </div>`;
}
const FIRST_ROWS = 12; // table rows in the tab-change frame; the rest are appended after the swap (E1)
function sourcesTab(S, { limit = Infinity } = {}) {
  const groups = [...new Set(S.sources.map(s => s.grp || 'General'))];
  const gCount = (g) => S.sources.filter(s => (s.grp || 'General') === g).length;
  const hCount = (h) => S.sources.filter(s => s.health === h).length;
  const wasErr = S.sources.filter(s => s.health === 'paused' && s.health_unpaused === 'error').length;
  const list = visibleSources(S);
  // R3: the 7d column repeats Total while every source's articles are all from this week
  const d7 = d7Shown = S.sources.some(s => (s.articles_7d || 0) !== (s.article_count || 0));
  const healthChip = (k, label, n) => html`<button type="button" class="chip chip--filter" data-so-health="${k}" aria-pressed="${ui.health === k}">${label}<span class="so-cn">${n}</span></button>`;
  return html`
  <div class="so-bar">
    <div class="so-chips" role="group" aria-label="Filter by health">
      ${healthChip('', 'All', S.sources.length)}
      ${['ok', 'stale', 'error', 'paused'].filter(h => hCount(h) || ui.health === h).map(h => healthChip(h, HEALTH[h], hCount(h)))}
      ${wasErr ? healthChip('was_error', 'Paused · was failing', wasErr) : ''}
    </div>
    <div class="so-ctl">
      <label class="so-ctl-l"><span class="sr-only">Group</span><select class="select" data-so-group aria-label="Filter by group"><option value="">All groups</option>${groups.map(g => html`<option value="${g}"${ui.group === g ? raw(' selected') : ''}>${g} (${gCount(g)})</option>`)}</select></label>
      <label class="so-ctl-l so-find">${icon('search')}<span class="sr-only">Filter sources</span><input class="input" type="search" data-so-text value="${ui.text}" placeholder="Filter by name, URL or error"></label>
    </div>
  </div>
  <div class="tile tile--flush tile--static so-table-tile">
    ${S.sources.length ? html`<table class="table so-table">
      <caption class="sr-only">Sources: ${list.length} shown of ${S.sources.length}. Sortable columns.${d7 ? '' : ' Every collected article is from the past 7 days, so one Articles column stands for both.'}</caption>
      <thead><tr><th class="so-c-x"><span class="sr-only">Details</span></th><th class="so-c-h">Health</th>${sortTh('name', 'Source', 'so-c-name')}<th class="so-c-grp">Group</th><th class="so-c-ev">Evidence</th><th class="so-c-on">On</th>${sortTh('sync', 'Last sync', 'so-c-sync')}${d7 ? sortTh('d7', '7d', 'num') : ''}${sortTh('total', d7 ? 'Total' : 'Articles', 'num so-c-tot')}${sortTh('stories', 'Stories', 'num')}<th class="so-c-act"><span class="sr-only">Sync</span></th></tr></thead>
      <tbody data-so-rows>${list.slice(0, limit).map(s => sourceRow(s, S, { d7 }))}</tbody>
    </table>
    ${!list.length ? html`<div class="so-none"><p>No source matches these filters.</p><button type="button" class="btn btn--secondary btn--sm" data-so-act="clear">Clear filters</button></div>` : ''}`
    : html`<div class="empty"><h3>No sources yet.</h3><p>Add a feed with “Add source”, or load the demo sources from Settings.</p></div>`}
  </div>
  <p class="so-foot">Retrieved content is treated as untrusted data: it never changes instructions or triggers actions. Showing ${list.length} of ${plural(S.sources.length, 'source')}.${d7 ? '' : ' Every collected article is from the past 7 days, so Articles covers both the week and the total.'}</p>
  <datalist id="so-grp-list">${groups.map(g => html`<option value="${g}">`)}</datalist>
  <datalist id="so-emp-list">${S.employers.map(e => html`<option value="${e.name}">`)}</datalist>`;
}

// ------------------------------------------------------------------ watchlists
function watchTab(S) {
  const w = S.watch;
  const hay = S.stories.map(s => `${s.title} ${s.summary || ''} ${(s.companies || []).join(' ')}`.toLowerCase());
  const matches = (x) => hay.filter(h => [x.name, ...(x.terms || [])].some(t => t && h.includes(String(t).toLowerCase()))).length;
  return html`
  <p class="so-intro">Companies, researchers, products, frameworks, skills, questions and teams. A match raises a story’s relevance; pinned items count 1.5×. Changes re-rank stories straight away.</p>
  <div class="tile tile--flush tile--static so-table-tile">
    ${w.length ? html`<table class="table so-table so-wtable">
      <thead><tr><th>Kind</th><th>Name</th><th>Terms</th><th class="num">Weight</th><th>Pinned</th><th class="num" title="Stories whose title, summary or companies mention the name or a term">Stories</th><th><span class="sr-only">Delete</span></th></tr></thead>
      <tbody>${w.map(x => html`<tr data-row>
        <td><span class="tag tag--neutral">${x.kind}</span></td>
        <td class="so-w-name"><span class="so-name">${x.name}</span>${x.employer ? html`<span class="so-sub">${x.employer}</span>` : ''}</td>
        <td class="so-w-terms"><input class="input" data-wterms="${x.id}" value="${(x.terms || []).join(', ')}" aria-label="Terms for ${x.name}"></td>
        <td class="num"><input class="input so-w-weight" data-wweight="${x.id}" type="number" min="0" max="3" step="0.1" value="${x.weight}" aria-label="Weight for ${x.name}"></td>
        <td><input type="checkbox" class="switch" data-wpin="${x.id}" ${x.pinned ? raw('checked') : ''} aria-label="Pin ${x.name}"></td>
        <td class="num">${matches(x)}</td>
        <td class="so-c-act"><button type="button" class="btn btn--ghost btn--sm btn--danger" data-so-act="del-watch" data-id="${x.id}" data-name="${x.name}">Delete</button></td>
      </tr>`)}</tbody></table>` : html`<div class="empty"><h3>No watchlist items yet.</h3><p>Add a company, product or question below; matching stories rank higher.</p></div>`}
  </div>
  <form class="tile tile--static so-wadd" data-so-form="watch" aria-labelledby="so-wadd-h">
    <h2 class="t-title" id="so-wadd-h">Add to the watchlist</h2>
    <div class="so-wadd-grid">
      <label class="field">Kind<select class="select" name="kind">${WATCH_KINDS.map(k => html`<option value="${k}">${k}</option>`)}</select></label>
      <label class="field">Name<input class="input" name="name" required placeholder="e.g. Model Context Protocol"></label>
      <label class="field so-span2">Terms (comma-separated)<input class="input" name="terms" placeholder="MCP, Model Context Protocol"></label>
      <label class="field">Weight<input class="input" name="weight" type="number" min="0" max="3" step="0.1" value="1"></label>
      <label class="so-check"><input type="checkbox" class="switch" name="pinned"> Pin</label>
      <button class="btn btn--primary" type="submit">Add to watchlist</button>
    </div>
  </form>`;
}

// ------------------------------------------------------------------ connectors
function connectorsTab(S) {
  const c = S.status.connectors || {};
  const groups = {};
  for (const [kind, x] of Object.entries(c)) (groups[x.label] ||= { ...x, kinds: [] }).kinds.push(kind);
  const using = (kinds) => S.sources.filter(s => kinds.includes(s.kind));
  return html`
  <p class="so-intro">How Byline reaches each kind of source. Credentials such as <span class="mono">X_BEARER_TOKEN</span> are read from server environment variables, never entered here. Demo sources are labelled Demo and never polled.</p>
  <div class="so-conn-grid">${Object.values(groups).map(g => {
    const u = using(g.kinds);
    return html`<section class="tile tile--static so-conn" aria-label="${g.label}">
      <div class="so-conn-head"><h2 class="so-conn-t">${g.label}</h2><span class="tag ${g.ready ? 'tag--ok' : 'tag--warn'}">${g.ready ? 'Ready' : 'Needs setup'}</span></div>
      ${!g.ready && g.reason ? html`<p class="so-conn-why">${g.reason}</p>` : ''}
      <p class="so-conn-m"><span class="mono">${g.kinds.join(' · ')}</span></p>
      <p class="so-conn-u">${u.length ? html`<b>${u.length}</b> ${u.length === 1 ? 'source uses' : 'sources use'} it${u.filter(s => !s.paused).length ? html`, <b>${u.filter(s => !s.paused).length}</b> on` : ', all paused'}: ${u.slice(0, 3).map(s => s.name).join(', ')}${u.length > 3 ? ` and ${u.length - 3} more` : ''}.` : 'No source uses it yet.'}</p>
      ${g.kinds.includes('manual') ? html`<button type="button" class="btn btn--secondary btn--sm" data-so-act="submit-url">Submit a URL</button>` : ''}
    </section>`;
  })}</div>`;
}

// ------------------------------------------------------------------ paint
function paint(el, S) {
  const hd = headline(S);
  const counts = { sources: S.sources.length, watchlists: S.watch.length, connectors: new Set(Object.values(S.status.connectors || {}).map(c => c.label)).size };
  el.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Research inputs · ${plural(S.sources.length, 'source')}</p>
    <h1>${hd.h}</h1>
    <p class="lede">${hd.l}</p>
    <div class="page-head-actions">
      <button type="button" class="btn btn--secondary" data-so-act="submit-url">Submit URL</button>
      <button type="button" class="btn btn--primary" data-so-act="add-source">${icon('plus')}Add source</button>
    </div>
  </header>
  ${summaryHtml(S)}
  <div class="so-tabs" role="tablist" aria-label="Sources sections">${TABS.map(([k, l]) => html`<button type="button" role="tab" class="so-tab so-btn" id="so-tab-${k}" data-so-tab="${k}" aria-selected="${ui.tab === k}" aria-controls="so-panel" tabindex="${ui.tab === k ? 0 : -1}">${l}<span class="so-cn">${counts[k]}</span></button>`)}</div>
  <div class="so-panel" id="so-panel" role="tabpanel" aria-labelledby="so-tab-${ui.tab}" data-so-panel>${panelHtml(S, { limit: FIRST_ROWS })}</div>`);
}
const panelHtml = (S, opts) => ui.tab === 'watchlists' ? watchTab(S) : ui.tab === 'connectors' ? connectorsTab(S) : sourcesTab(S, opts);
function repaintPanel(el, S, { animate = false, focus = null } = {}) {
  S.rest = true;
  const p = el.querySelector('[data-so-panel]');
  p.innerHTML = String(panelHtml(S));
  p.setAttribute('aria-labelledby', `so-tab-${ui.tab}`);
  if (focus) p.querySelector(focus)?.focus({ preventScroll: true });
  if (animate) enterItems([...p.children].slice(0, 4), { stagger: 40, y: 6, duration: 420 });
  loadOpenArticles(el, S);
}
function repaintHead(el, S) {
  const hd = headline(S);
  const h1 = el.querySelector('.page-head h1');
  if (h1 && h1.textContent !== hd.h) h1.textContent = hd.h;
  const l = el.querySelector('.page-head .lede'); if (l) l.innerHTML = String(hd.l);
  const sum = el.querySelector('.so-summary'); if (sum) sum.outerHTML = String(summaryHtml(S));
  el.querySelectorAll('[data-so-tab]').forEach(t => { const n = t.querySelector('.so-cn'); if (n && t.dataset.soTab === 'sources') n.textContent = S.sources.length; if (n && t.dataset.soTab === 'watchlists') n.textContent = S.watch.length; });
}
function loadOpenArticles(el, S) {
  for (const id of ui.open) {
    if (S.articles[id] !== undefined || S.loading.has(id)) continue;
    S.loading.add(id);
    api.get(`/sources/${id}/articles?limit=5`).then(a => { S.articles[id] = a; }).catch(e => { S.articles[id] = { error: e.message }; }).finally(() => {
      S.loading.delete(id);
      const row = el.querySelector(`#so-d-${id}`);
      const s = S.sources.find(x => x.id === id);
      if (row && s) {
        const box = row.querySelector('.so-d-arts');
        const tmp = document.createElement('div'); tmp.innerHTML = String(detailHtml(s, S));
        box.replaceWith(tmp.querySelector('.so-d-arts'));
        enterItems(row.querySelectorAll('.so-arts > li'), { stagger: 30, y: 4, duration: 360 });
      }
    });
  }
}
async function refresh(el, S) {
  const [sources, summary] = await Promise.all([api.get('/sources', { fresh: true }), api.get('/sources/summary', { fresh: true })]);
  S.sources = sources; S.summary = summary;
  repaintHead(el, S);
}

// ------------------------------------------------------------------ render
export async function render(view, ctx = {}) {
  await useStyle('/css/v4/sources.css');
  const p0 = (ctx.params || [])[0];
  if (TABS.some(t => t[0] === p0)) ui.tab = p0;
  const [sources, summary, status, watch, employers, stories] = await Promise.all([
    api.get('/sources'), api.get('/sources/summary'), api.get('/status'), api.get('/watchlists'),
    api.get('/employers').catch(() => []), api.get('/search?type=stories&limit=200').then(r => r.stories || []).catch(() => [])
  ]);
  const settingsTz = status.timezone;
  const th = await api.get('/settings').then(s => Number(s.publish_threshold ?? 55)).catch(() => window.__byline?.threshold ?? 55);
  const S = { sources, summary, status, watch, employers, stories, tz: settingsTz, T: th, articles: {}, loading: new Set() };
  const el = document.createElement('div');
  el.className = 'so';
  view.replaceChildren(el);
  paint(el, S);
  loadOpenArticles(el, S);
  wire(el, S);
  watchCols();
  // rows past the first screen, appended once the tab change is over
  afterEnter(view, el, () => {
    if (S.rest || ui.tab !== 'sources') return;
    S.rest = true;
    const body = el.querySelector('[data-so-rows]');
    const rest = visibleSources(S).slice(FIRST_ROWS);
    if (!body || !rest.length) return;
    const d7 = d7Shown, n = body.children.length;
    body.insertAdjacentHTML('beforeend', rest.map(s => String(sourceRow(s, S, { d7 }))).join(''));
    enterItems([...body.children].slice(n), { stagger: 24, y: 4, duration: 360, cap: 6 });
  });
}

function sourceFormHtml(S, kind = 'rss') {
  const xReady = S.status.connectors?.x?.ready;
  const groups = [...new Set(S.sources.map(s => s.grp || 'General'))];
  return html`<form class="so-modal-form" data-so-form="source">
    <h2>Add a source</h2>
    <p class="so-modal-dek">A feed Byline polls on every run. It starts collecting on the next run or when you press Sync.</p>
    <div class="so-2">
      <label class="field">Name<input class="input" name="name" required placeholder="e.g. Snowflake Engineering Blog"></label>
      <label class="field">Kind<select class="select" name="kind" data-so-kind>${opts(KINDS, kind)}</select></label>
    </div>
    <label class="field" data-so-urlfield>${kind === 'x' ? 'X search query' : 'Feed URL'}<input class="input" name="url" required ${kind === 'x' ? raw('placeholder=\'"AI agents" (from:someone OR evaluation)\'') : raw('type="url" placeholder="https://example.com/feed.xml"')}></label>
    ${kind === 'x' && !xReady ? html`<p class="so-res err">X is not configured: ${S.status.connectors.x.reason}. You can add the source now; it will be skipped (with that reason) until X_BEARER_TOKEN is set in the server environment.</p>` : ''}
    <div class="so-2">
      <label class="field">Group<input class="input" name="grp" list="so-grp-m" placeholder="General"></label>
      <label class="field">Evidence type<select class="select" name="evidence_kind"><option value="">Default for kind</option>${opts(EVIDENCE)}</select></label>
    </div>
    <label class="field">Employer (optional)<input class="input" name="employer" list="so-emp-m" placeholder="e.g. AWS"></label>
    <datalist id="so-grp-m">${groups.map(g => html`<option value="${g}">`)}</datalist>
    <datalist id="so-emp-m">${S.employers.map(e => html`<option value="${e.name}">`)}</datalist>
    <div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" type="submit">Add source</button></div>
  </form>`;
}
function urlFormHtml() {
  const m = ui.manual;
  return html`<form class="so-modal-form" data-so-form="url">
    <h2>Submit a URL</h2>
    <p class="so-modal-dek">Add a single article. It’s clustered into an existing story or starts a new one.</p>
    <label class="field">Article URL<input class="input" name="url" type="url" required placeholder="https://…" value="${m?.url || ''}"></label>
    <label class="field">Evidence type<select class="select" name="evidence_kind">${opts(EVIDENCE, m?.evidence_kind || 'reporting')}</select></label>
    ${m?.error ? html`<p class="so-res err">${m.error}</p>` : ''}
    <div class="modal-actions">${m ? '' : html`<button type="button" class="btn btn--ghost" data-so-manual>Paste the text instead</button>`}<button class="btn btn--primary" type="submit">Fetch &amp; add</button></div>
  </form>
  ${m ? html`<form class="so-modal-form so-manual" data-so-form="manual">
    <h3 class="section-label">Paste the article</h3>
    <p class="so-modal-dek">Useful for paywalls or when the network is unavailable.</p>
    <label class="field">Title<input class="input" name="title" required></label>
    <label class="field">Text<textarea class="textarea" name="text" rows="6" placeholder="Paste the article text"></textarea></label>
    <div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" type="submit">Add pasted article</button></div>
  </form>` : ''}`;
}

function wire(el, S) {
  // tabs (roving tabindex, arrow keys)
  const setTab = (k, focus = false) => {
    ui.tab = k;
    el.querySelectorAll('[data-so-tab]').forEach(t => { const on = t.dataset.soTab === k; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    history.replaceState(history.state, '', k === 'sources' ? '#/sources' : `#/sources/${k}`);
    repaintPanel(el, S, { animate: true });
  };
  on(el, 'click', '[data-so-tab]', (e, t) => setTab(t.dataset.soTab));
  on(el, 'keydown', '[data-so-tab]', (e, t) => {
    const i = TABS.findIndex(x => x[0] === t.dataset.soTab);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { e.preventDefault(); setTab(TABS[(i + d + TABS.length) % TABS.length][0], true); }
  });

  // filters + sort
  on(el, 'click', '[data-so-health]', (e, b) => { ui.health = ui.health === b.dataset.soHealth ? '' : b.dataset.soHealth; repaintPanel(el, S, { focus: `[data-so-health="${CSS.escape(b.dataset.soHealth)}"]` }); });
  on(el, 'change', '[data-so-group]', (e, s) => { ui.group = s.value; repaintPanel(el, S, { focus: '[data-so-group]' }); });
  let deb = 0;
  on(el, 'input', '[data-so-text]', (e, i) => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      ui.text = i.value;
      const pos = i.selectionStart;
      repaintPanel(el, S, { focus: '[data-so-text]' });
      const ni = el.querySelector('[data-so-text]'); try { ni.setSelectionRange(pos, pos); } catch (err) { /* type=search */ }
    }, 140);
  });
  on(el, 'click', '[data-so-sort]', (e, b) => {
    const k = b.dataset.soSort;
    if (ui.sort === k) ui.dir = -ui.dir; else { ui.sort = k; ui.dir = k === 'name' ? 1 : -1; }
    repaintPanel(el, S, { focus: `[data-so-sort="${k}"]` });
  });

  // expand rows (button, or a click anywhere on the row that isn't a control)
  const toggle = (id) => {
    if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id);
    repaintPanel(el, S, { focus: `[data-so-expand="${id}"]` });
    if (ui.open.has(id) && !reduced()) { const d = el.querySelector(`#so-d-${id} .so-detail-grid`); if (d) enterItems([d], { y: 4, duration: 360 }); }
  };
  on(el, 'click', '[data-so-expand]', (e, b) => toggle(Number(b.dataset.soExpand)));
  on(el, 'click', 'tr.so-row', (e, tr) => { if (e.target.closest('button, input, select, a, label')) return; toggle(Number(tr.dataset.id)); });

  // enable / pause
  on(el, 'change', '[data-so-on]', async (e, c) => {
    const id = Number(c.dataset.soOn), s = S.sources.find(x => x.id === id);
    const paused = !c.checked, prev = s.paused;
    try {
      await optimistic({
        item: c.closest('tr'),
        apply: () => { s.paused = paused; },
        commit: () => api.patch(`/sources/${id}`, { paused }),
        revert: () => { s.paused = prev; c.checked = !prev; }
      });
      toast(paused ? `${s.name} paused` : `${s.name} is collecting again`, 'ok');
      await refresh(el, S);
      repaintPanel(el, S, { focus: `[data-so-on="${id}"]` });
    } catch (err) { /* optimistic() already reverted and said so */ }
  });

  // watchlist edits
  on(el, 'change', '[data-wterms],[data-wweight],[data-wpin]', async (e, i) => {
    const id = i.dataset.wterms || i.dataset.wweight || i.dataset.wpin;
    const body = i.dataset.wterms ? { terms: splitTerms(i.value) } : i.dataset.wweight ? { weight: Number(i.value) } : { pinned: i.checked };
    try {
      await api.patch(`/watchlists/${id}`, body);
      const w = S.watch.find(x => String(x.id) === String(id)); if (w) Object.assign(w, body, 'pinned' in body ? { pinned: body.pinned ? 1 : 0 } : {});
      toast('Watchlist updated: stories re-ranked', 'ok');
    } catch (err) { toast(err.message, 'err'); if (i.dataset.wpin) i.checked = !i.checked; }
  });

  // forms (inline edit + watch; modal forms are wired where they open)
  on(el, 'submit', 'form[data-so-form]', async (e, f) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    const d = Object.fromEntries(new FormData(f));
    if (f.dataset.soForm === 'edit') await act(btn, async () => {
      const id = Number(f.dataset.id);
      await api.patch(`/sources/${id}`, { name: d.name.trim(), url: (d.url || '').trim(), grp: (d.grp || '').trim() || 'General', evidence_kind: d.evidence_kind, employer: (d.employer || '').trim() || null });
      toast('Source saved', 'ok');
      await refresh(el, S);
      repaintPanel(el, S, { focus: `[data-so-expand="${id}"]` });
    }, 'Saving…');
    if (f.dataset.soForm === 'watch') await act(btn, async () => {
      await api.post('/watchlists', { kind: d.kind, name: d.name.trim(), terms: splitTerms(d.terms || ''), weight: Number(d.weight || 1), pinned: !!d.pinned });
      toast(`Watching ${d.name.trim()}`, 'ok');
      S.watch = await api.get('/watchlists', { fresh: true });
      repaintHead(el, S); repaintPanel(el, S);
    }, 'Adding…');
  });

  const openSource = () => {
    const m = modal(String(sourceFormHtml(S, 'rss')));
    const f = m.el.querySelector('form');
    // kind change updates the URL field in place (keeps everything typed so far)
    f.querySelector('[data-so-kind]').addEventListener('change', (e) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = String(sourceFormHtml(S, e.target.value));
      const keepUrl = f.elements.url.value;
      f.querySelector('[data-so-urlfield]').replaceWith(tmp.querySelector('[data-so-urlfield]'));
      f.querySelector('.so-res')?.remove();
      const warn = tmp.querySelector('.so-res');
      if (warn) f.querySelector('[data-so-urlfield]').after(warn);
      f.elements.url.value = keepUrl;
    });
    wireSourceForm(m, f);
    setTimeout(() => f.elements.name?.focus(), 60);
  };
  const wireSourceForm = (m, f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      await act(f.querySelector('button[type=submit]'), async () => {
        await api.post('/sources', { name: d.name.trim(), kind: d.kind, url: d.url.trim(), grp: (d.grp || '').trim() || 'General', evidence_kind: d.evidence_kind || undefined, employer: (d.employer || '').trim() || null });
        toast(`Added ${d.name.trim()}`, 'ok');
        m.close();
        await refresh(el, S);
        ui.tab = 'sources'; repaintPanel(el, S);
      }, 'Adding…');
    });
  };
  const openUrl = () => {
    const m = modal(String(urlFormHtml()), { onClose: () => { if (!ui.keepManual) ui.manual = null; ui.keepManual = false; } });
    const wireForms = () => {
      m.el.querySelector('[data-so-manual]')?.addEventListener('click', () => {
        const u = m.el.querySelector('[data-so-form="url"] [name=url]');
        ui.manual = { url: u.value, evidence_kind: m.el.querySelector('[data-so-form="url"] [name=evidence_kind]').value, error: ui.manual?.error || '' };
        rerender(); m.el.querySelector('[data-so-form="manual"] [name=title]')?.focus();
      });
      m.el.querySelector('[data-so-form="url"]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        try {
          await act(e.target.querySelector('button[type=submit]'), async () => {
            const r = await api.post('/intake/url', { url: d.url.trim(), evidence_kind: d.evidence_kind }).catch(err => { ui.manual = { url: d.url.trim(), evidence_kind: d.evidence_kind, error: `${err.message}. You can paste the text instead.` }; throw err; });
            ui.manual = null;
            toast(r.created ? 'Article added' : 'Already in your archive', 'ok');
            m.close();
            if (r.story_id) location.hash = `#/story/${r.story_id}`; else refresh(el, S).then(() => repaintPanel(el, S));
          }, 'Fetching…');
        } finally { if (ui.manual && m.el.isConnected) rerender(); }
      });
      m.el.querySelector('[data-so-form="manual"]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        const u = m.el.querySelector('[data-so-form="url"]');
        await act(e.target.querySelector('button[type=submit]'), async () => {
          const r = await api.post('/intake/manual', { url: u.elements.url.value.trim(), title: d.title.trim(), text: d.text, evidence_kind: u.elements.evidence_kind.value });
          ui.manual = null; toast('Article added from pasted text', 'ok'); m.close();
          if (r.story_id) location.hash = `#/story/${r.story_id}`; else refresh(el, S).then(() => repaintPanel(el, S));
        }, 'Adding…');
      });
    };
    const rerender = () => {
      const keep = { url: m.el.querySelector('[data-so-form="url"] [name=url]')?.value };
      const grip = m.el.querySelector('.sheet-grip');
      m.el.innerHTML = String(urlFormHtml());
      if (grip) m.el.prepend(grip);
      if (keep.url) m.el.querySelector('[data-so-form="url"] [name=url]').value = keep.url;
      wireForms();
    };
    wireForms();
    setTimeout(() => m.el.querySelector('[name=url]')?.focus(), 60);
  };

  on(el, 'click', '[data-so-act]', async (e, btn) => {
    const a = btn.dataset.soAct, id = Number(btn.dataset.id);
    if (a === 'add-source') openSource();
    if (a === 'submit-url') openUrl();
    if (a === 'clear') { ui.group = ''; ui.health = ''; ui.text = ''; repaintPanel(el, S); }
    if (a === 'sync') await act(btn, async () => {
      try {
        const r = await api.post(`/sources/${id}/sync`);
        ui.sync[id] = { ok: true, msg: `Fetched ${r.fetched}, ${r.created} new · ${r.new_stories ?? 0} new stories, ${r.merged ?? 0} merged` };
        delete S.articles[id];
        toast('Sync finished', 'ok');
      } catch (err) { ui.sync[id] = { ok: false, msg: err.message }; toast(err.message, 'err'); }
      await refresh(el, S).catch(() => {});
      repaintPanel(el, S, { focus: `[data-so-act="sync"][data-id="${id}"]` });
    }, 'Syncing…');
    if (a === 'del-source') {
      const row = el.querySelector(`tr.so-row[data-id="${id}"]`);
      el.querySelector(`#so-d-${id}`)?.remove();
      ui.open.delete(id);
      strikeOut(row || btn.closest('tr'), {
        message: `“${btn.dataset.name}” deleted. Collected articles stay in your archive.`,
        commit: async () => { await api.del(`/sources/${id}`); S.sources = S.sources.filter(s => s.id !== id); refresh(el, S).catch(() => {}); },
        onUndo: () => repaintPanel(el, S)
      });
    }
    if (a === 'del-watch') strikeOut(btn.closest('tr'), {
      message: `“${btn.dataset.name}” removed from watchlists.`,
      commit: async () => { await api.del(`/watchlists/${id}`); S.watch = S.watch.filter(w => w.id !== id); repaintHead(el, S); }
    });
  });
}
