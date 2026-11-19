// Search (the "Archive", now labelled Search). SPEC §5, F §2 Search templates, F §4 result anatomy.
// Base: Instrument's Search (80): a large autofocused bar with quick-search chips under it.
// Real results from /api/search grouped Stories · Claims · Drafts · Notes · Contacts · Briefs, with
// <mark> query highlights and number marks, filters (type, topic, company, source, status, dates),
// ↑/↓ across groups + Enter, "/" focuses the bar, recent searches in localStorage, and the route
// param #/search/<query> prefills and runs (the ⌘K fallback uses it). Story rows are dossier flight
// sources (data-dossier-src + data-shared title / chip→ring / topic).
import { api } from '../api.js';
import { html, raw, esc, on, icon, scoreChip, channelLabel, status as statusTag, useStyle, inField, timeAgo, toast } from '../ui.js';
import { enterItems, reduced, EASE } from '../motion.js';

const TYPES = [['stories', 'Stories'], ['claims', 'Claims'], ['drafts', 'Drafts'], ['notes', 'Notes'], ['contacts', 'Contacts'], ['briefs', 'Briefs']];
const TYPE_ONE = { stories: 'story', claims: 'claim', drafts: 'draft', notes: 'note', contacts: 'contact', briefs: 'brief' };
const IDLE_TITLE = { stories: 'Top stories', claims: 'Claims with numbers', drafts: 'Recently edited drafts', notes: 'Latest notes', contacts: 'Contacts', briefs: 'Briefs' };
const STATUSES = [['', 'Any status'], ['new', 'Story · new'], ['seen', 'Story · seen'], ['archived', 'Story · archived'],
  ['draft', 'Draft · draft'], ['in_review', 'Draft · in review'], ['approved', 'Draft · approved'], ['scheduled', 'Draft · scheduled'], ['published', 'Draft · published']];
const RANGES = [['', 'Any time'], ['7', 'Past 7 days'], ['30', 'Past 30 days'], ['90', 'Past 90 days'], ['custom', 'Custom dates']];
const EV = { announcement: 'first-party', reporting: 'reporting', research: 'research', commentary: 'commentary', community: 'community', application: 'release notes', own_work: 'my project' };
const RECENT_KEY = 'byline-recent-searches';
const PER_GROUP = 5;
const IDLE_PER_GROUP = { stories: 5, claims: 4, drafts: 3, notes: 3, contacts: 4, briefs: 2 };

// filters survive tab switches within a session (the query comes from the route when given)
const blank = () => ({ q: '', type: 'all', topic: '', company: '', source: '', status: '', range: '', from: '', to: '' });
const ui = { f: blank() };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 8) : []; } catch (e) { return []; } };
const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { /* storage unavailable */ } };
function remember(q) {
  q = String(q || '').trim();
  if (q.length < 2) return;
  writeRecent([q, ...readRecent().filter(x => x.toLowerCase() !== q.toLowerCase())]);
}
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = (iso, tz) => { if (!iso) return ''; const d = new Date(/T/.test(iso) ? iso : `${iso}T12:00:00`); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(tz && /T/.test(iso) ? { timeZone: tz } : {}) }); };
const fmtLongDay = (iso) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';

/**
 * Highlight `text`: every case-insensitive occurrence of `q` → <mark class="sr-q">, and the server's
 * number marks (`[start, end)` pairs, F amendment 3) → <mark class="sr-n">. Query marks win overlaps.
 */
function hl(text, q, marks = []) {
  text = String(text ?? '');
  const ranges = [];
  const needle = String(q || '').trim().toLowerCase();
  if (needle) { const hay = text.toLowerCase(); for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) ranges.push([i, i + needle.length, 'q']); }
  for (const [a, b] of marks || []) if (a < b && b <= text.length && !ranges.some(([s, e, k]) => k === 'q' && a < e && b > s)) ranges.push([a, b, 'n']);
  ranges.sort((x, y) => x[0] - y[0]);
  let out = '', at = 0;
  for (const [a, b, k] of ranges) { if (a < at) continue; out += esc(text.slice(at, a)) + `<mark class="sr-${k}">${esc(text.slice(a, b))}</mark>`; at = b; }
  return raw(out + esc(text.slice(at)));
}
/** ±80 characters around the first match (F §4), on word boundaries, with ellipses. */
function windowAround(text, q, span = 80) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text.length > span * 2 ? `${text.slice(0, span * 2).replace(/\s+\S*$/, '')}…` : text;
  let a = Math.max(0, i - span), b = Math.min(text.length, i + q.length + span);
  if (a > 0) { const s = text.indexOf(' ', a); a = s > -1 && s < i ? s + 1 : a; }
  if (b < text.length) { const s = text.lastIndexOf(' ', b); b = s > i + q.length ? s : b; }
  return `${a > 0 ? '…' : ''}${text.slice(a, b)}${b < text.length ? '…' : ''}`;
}
const shiftMarks = (marks, offset) => (marks || []).map(([a, b]) => [a + offset, b + offset]);

// ------------------------------------------------------------------ data
function queryUrl(f) {
  const p = new URLSearchParams();
  p.set('type', f.type === 'all' ? TYPES.map(t => t[0]).join(',') : f.type);
  p.set('limit', f.type === 'all' ? String(PER_GROUP + 1) : '100');
  if (f.q) p.set('q', f.q);
  for (const k of ['topic', 'company', 'source', 'status']) if (f[k]) p.set(k, f[k]);
  const { from, to } = dates(f);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  return `/search?${p}`;
}
function dates(f) {
  if (f.range === 'custom') return { from: f.from, to: f.to };
  if (!f.range) return { from: '', to: '' };
  const d = new Date(); d.setDate(d.getDate() - Number(f.range));
  return { from: isoDay(d), to: '' };
}
const activeFilters = (f) => ['topic', 'company', 'source', 'status'].filter(k => f[k]).length + (f.range && (f.range !== 'custom' || f.from || f.to) ? 1 : 0);

// ------------------------------------------------------------------ headline + one-liner (F §2 Search, verbatim templates)
function headline(S) {
  const r = S.res, f = S.f, t = r?.totals || {};
  const c = r?.counts || {};
  const filterNames = filterLabels(S);
  if (!f.q && !activeFilters(f)) {
    return {
      h: `Search ${plural(t.stories ?? 0, 'story', 'stories')} and ${plural(t.claims ?? 0, 'claim')}.`,
      l: html`Also <b>${t.drafts ?? 0}</b> drafts and <b>${t.notes ?? 0}</b> notes${t.contacts ? html`, plus <b>${t.contacts}</b> ${t.contacts === 1 ? 'contact' : 'contacts'}` : ''}. Try a topic, a company or a number.`
    };
  }
  const total = c.total ?? 0;
  const searched = html`Searched <b>${t.stories ?? 0}</b> stories, <b>${t.claims ?? 0}</b> claims, <b>${t.drafts ?? 0}</b> drafts and <b>${t.notes ?? 0}</b> notes.`;
  if (!total) {
    const tryShort = f.q && f.q.length > 3;
    const lastFilter = filterNames[filterNames.length - 1];
    return {
      h: f.q ? `Nothing matches “${f.q}”.` : `Nothing matches ${filterNames.join(' and ')}.`,
      l: html`${searched} ${tryShort ? 'Try a shorter word' : 'Try a different word'}${lastFilter ? html`, or remove the <b>${lastFilter}</b> filter` : ''}.`
    };
  }
  const parts = TYPES.filter(([k]) => k === 'stories' || k === 'claims' || k === 'drafts' || k === 'notes' || c[k]).filter(([k]) => f.type === 'all' || f.type === k)
    .map(([k]) => html`<b>${c[k] ?? 0}</b> ${(c[k] ?? 0) === 1 ? TYPE_ONE[k] : k}`);
  const best = (r.stories || [])[0];
  const scope = f.q ? `“${f.q}”` : filterNames.join(' and ');
  return {
    h: `${plural(total, 'result')} ${f.q ? 'for' : 'in'} ${scope}.`,
    l: html`${joinList(parts)}.${best ? html` Best match: <b>${best.short_title || best.title}</b> (${Math.round(best.score)}).` : ''}${filterNames.length && f.q ? html` Filtered by ${filterNames.join(', ')}.` : ''}`
  };
}
function joinList(parts) {
  if (parts.length < 2) return parts[0] || '';
  return html`${parts.slice(0, -1).map((p, i) => html`${p}${i < parts.length - 2 ? ', ' : ''}`)} and ${parts[parts.length - 1]}`;
}
function filterLabels(S) {
  const f = S.f, out = [];
  if (f.type !== 'all') out.push(TYPES.find(t => t[0] === f.type)?.[1].toLowerCase());
  if (f.topic) out.push(f.topic);
  if (f.company) out.push(f.company);
  if (f.source) out.push(S.sourceName[f.source] || 'source');
  if (f.status) out.push(STATUSES.find(s => s[0] === f.status)?.[1].toLowerCase() || f.status);
  if (f.range === 'custom' && (f.from || f.to)) out.push(`${f.from || '…'} to ${f.to || 'today'}`);
  else if (f.range && f.range !== 'custom') out.push(RANGES.find(r => r[0] === f.range)?.[1].toLowerCase());
  return out.filter(Boolean);
}

// ------------------------------------------------------------------ quick-search chips (top topics, watchlist, employers — all from the API)
function quickChips(S) {
  const stories = S.allStories;
  const weight = Object.fromEntries((S.settings.priorities || []).map(p => [p.topic, Number(p.weight) || 0]));
  const tCount = new Map();
  for (const s of stories) for (const t of s.topics || []) tCount.set(t, (tCount.get(t) || 0) + 1);
  // weighted by count × priority weight; weight ≤ 1 (the catch-all) only fills in when nothing else exists (F §2)
  let topics = [...tCount].filter(([t]) => (weight[t] ?? 1) > 1).sort((a, b) => b[1] * (weight[b[0]] ?? 1) - a[1] * (weight[a[0]] ?? 1));
  if (topics.length < 3) topics = topics.concat([...tCount].filter(([t]) => (weight[t] ?? 1) > 0 && (weight[t] ?? 1) <= 1).sort((a, b) => b[1] - a[1]));
  topics = topics.slice(0, 5);
  const hay = stories.map(s => `${s.title} ${s.summary || ''} ${(s.companies || []).join(' ')} ${(s.topics || []).join(' ')}`.toLowerCase());
  const storyHits = (term) => { const t = term.toLowerCase(); return hay.filter(h => h.includes(t)).length; };
  // a watchlist item searches its name when short, else the first of its terms that matches anything
  const watch = (S.watch || []).map(w => {
    const cands = [...(w.kind !== 'question' && w.name.length <= 28 ? [w.name] : []), ...(w.terms || [])].filter(Boolean);
    const pick = cands.find(c => storyHits(c) > 0) || cands[0];
    return pick ? { q: pick, n: storyHits(pick), w } : null;
  }).filter(Boolean).sort((a, b) => (b.w.pinned - a.w.pinned) || (b.n - a.n)).slice(0, 6);
  const emps = (S.employers || []).filter(e => e.story_count > 0 || e.pinned).sort((a, b) => (b.story_count - a.story_count) || (b.pinned - a.pinned)).slice(0, 5);
  return { topics, watch, emps };
}

// ------------------------------------------------------------------ rows (F §4 anatomy)
function storyRow(s, S) {
  const q = S.f.q;
  const inTitle = q && s.title.toLowerCase().includes(q.toLowerCase());
  const inSummary = q && !inTitle && (s.summary || '').toLowerCase().includes(q.toLowerCase());
  const snip = inSummary ? hl(windowAround(s.summary, q), q) : hl(s.finding || '', q, s.finding_marks);
  const chip = String(scoreChip(s.score, S.T)).replace('<span class="score-chip"', '<span class="score-chip" data-shared="ring"');
  return html`<a class="sr-item sr-story" href="#/story/${s.id}" data-sr-item data-dossier-src data-story-id="${s.id}">
    <span class="sr-lead">${raw(chip)}</span>
    <span class="sr-main">
      <span class="sr-title" data-shared="title">${hl(s.title, q)}${s.is_demo ? html` <span class="tag tag--demo">Demo</span>` : ''}</span>
      ${snip && String(snip) ? html`<span class="sr-snip">${snip}</span>` : ''}
      <span class="sr-meta">${s.main_topic ? html`<span class="chip chip--main" data-shared="topic">${s.main_topic}</span>` : ''}<span class="mono">${s.source_line || ''}</span><time datetime="${s.updated_at}">${fmtDay(s.updated_at, S.tz)}</time>${s.status === 'archived' ? html`<span class="tag tag--neutral">Archived</span>` : ''}</span>
    </span>
  </a>`;
}
function claimRow(c, S) {
  const q = S.f.q;
  const text = c.text_clean || c.text;
  return html`<a class="sr-item sr-claim" href="${c.story_id ? `#/story/${c.story_id}` : c.url}" data-sr-item ${c.story_id ? raw('data-dossier-src') : raw('target="_blank" rel="noopener"')}>
    <span class="sr-lead"><span class="sr-glyph" aria-hidden="true">“</span></span>
    <span class="sr-main">
      <span class="sr-claim-text">${hl(text, q, c.text_clean ? c.marks : [])}</span>
      <span class="sr-meta"><span class="mono">${c.domain}</span><span>${EV[c.evidence_kind] || c.evidence_kind}</span>${c.story_id ? html`<span class="sr-from">from <b>${c.story_short_title || c.story_title}</b></span>${c.story_score != null ? html`<span class="sr-mini">${scoreChip(c.story_score, S.T)}</span>` : ''}` : ''}</span>
    </span>
  </a>`;
}
function draftRow(d, S) {
  const q = S.f.q;
  return html`<a class="sr-item sr-draft" href="#/draft/${d.id}" data-sr-item>
    <span class="sr-lead"><span class="sr-ico">${icon('studio')}</span></span>
    <span class="sr-main">
      <span class="sr-title sr-title--sm">${hl(d.title || 'Untitled draft', q)}</span>
      <span class="sr-meta"><span>${channelLabel(d.channel, d.format)}</span>${statusTag(d.status)}<span>edited ${timeAgo(d.updated_at)}</span>${d.planned_date ? html`<span>planned ${fmtLongDay(d.planned_date)}</span>` : ''}${d.story_score != null ? html`<span class="sr-mini" title="Story score">${scoreChip(d.story_score, S.T)}</span>` : ''}</span>
    </span>
  </a>`;
}
function noteRow(n, S) {
  const q = S.f.q;
  const href = n.draft_id ? `#/draft/${n.draft_id}` : n.story_id ? `#/story/${n.story_id}` : null;
  const inner = html`<span class="sr-lead"><span class="sr-ico">${icon('pen')}</span></span>
    <span class="sr-main">
      <span class="sr-snip sr-snip--ink">${hl(windowAround(n.text, q, 110), q)}</span>
      <span class="sr-meta"><span class="tag tag--neutral" title="Notes are private and never appear in exports">Private</span><span>${n.kind || 'note'}</span>${n.draft_title ? html`<span class="sr-from">on <b>${n.draft_title}</b></span>` : ''}<span>${timeAgo(n.created_at)}</span></span>
    </span>`;
  return href ? html`<a class="sr-item sr-note" href="${href}" data-sr-item>${inner}</a>` : html`<div class="sr-item sr-note" tabindex="-1" data-sr-item>${inner}</div>`;
}
function contactRow(c, S) {
  const q = S.f.q;
  return html`<a class="sr-item sr-contact" href="#/person/${c.id}" data-sr-item>
    <span class="sr-lead"><span class="sr-avatar" aria-hidden="true">${(c.name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span></span>
    <span class="sr-main">
      <span class="sr-title sr-title--sm">${hl(c.name, q)}</span>
      <span class="sr-snip">${hl([c.role, c.org || c.employer, c.team].filter(Boolean).join(' · '), q)}</span>
      <span class="sr-meta"><span class="tag tag--neutral">${(c.stage || '').replace(/_/g, ' ')}</span>${c.dnc ? html`<span class="tag tag--err">Do not contact</span>` : ''}${c.next_step ? html`<span>Next: ${c.next_step}${c.next_date ? html` · <time datetime="${c.next_date}">${fmtDay(c.next_date)}</time>` : ''}</span>` : ''}</span>
    </span>
  </a>`;
}
function briefRow(b, S) {
  const q = S.f.q;
  const current = S.today?.brief_date === b.run_date || S.today?.brief?.run_date === b.run_date;
  const inner = html`<span class="sr-lead"><span class="sr-ico">${icon('today')}</span></span>
    <span class="sr-main">
      <span class="sr-title sr-title--sm">Brief · <time datetime="${b.run_date}">${fmtLongDay(b.run_date)}</time></span>
      <span class="sr-snip">${hl(b.summary, q)}</span>
      <span class="sr-meta">${b.quiet ? html`<span class="tag tag--warn">Quiet day</span>` : ''}${current ? html`<span>Shown on Today</span>` : ''}</span>
    </span>`;
  return current ? html`<a class="sr-item sr-brief" href="#/today" data-sr-item>${inner}</a>` : html`<div class="sr-item sr-brief" tabindex="-1" data-sr-item>${inner}</div>`;
}
const ROW = { stories: storyRow, claims: claimRow, drafts: draftRow, notes: noteRow, contacts: contactRow, briefs: briefRow };

function resultsHtml(S) {
  const r = S.res, f = S.f;
  if (S.error) return html`<div class="empty"><h3>Search didn’t run.</h3><p>${S.error}</p></div>`;
  if (!r) return '';
  const idle = !f.q && !activeFilters(f) && f.type === 'all';
  const c = r.counts || {};
  if (!c.total) {
    const words = f.q.split(/\s+/).filter(Boolean);
    const shorter = words.length > 1 ? words.sort((a, b) => b.length - a.length)[0] : f.q.length > 4 ? f.q.slice(0, Math.max(3, Math.ceil(f.q.length * 0.6))) : '';
    return html`<div class="empty sr-zero"><h3>No ${f.type === 'all' ? 'results' : f.type} yet for this search.</h3>
      <p>Search matches words inside story titles and summaries, claims, drafts, notes, contacts and briefs. ${activeFilters(f) || f.type !== 'all' ? 'Filters narrow every group at once.' : ''}</p>
      <div class="cluster">${shorter ? html`<button type="button" class="btn btn--secondary" data-sr-run="${shorter}">Search “${shorter}”</button>` : ''}
      ${activeFilters(f) || f.type !== 'all' ? html`<button type="button" class="btn btn--secondary" data-sr="clear-filters">Clear filters</button>` : ''}
      ${f.q ? html`<button type="button" class="btn btn--ghost" data-sr="clear-q">Clear the search</button>` : ''}</div></div>`;
  }
  const order = f.type === 'all' ? TYPES : TYPES.filter(([k]) => k === f.type);
  return html`${order.filter(([k]) => (r[k] || []).length).map(([k, label]) => {
    const list = r[k];
    const shown = f.type === 'all' ? list.slice(0, idle ? IDLE_PER_GROUP[k] : PER_GROUP) : list;
    const total = c[k] ?? list.length;
    return html`<section class="sr-group" aria-labelledby="sr-g-${k}" data-group="${k}">
      <div class="sr-group-head">
        <h2 class="sr-gh" id="sr-g-${k}">${idle ? IDLE_TITLE[k] : label}<span class="sr-gn">${total}</span></h2>
        ${f.type === 'all' && total > shown.length ? html`<button type="button" class="btn btn--ghost btn--sm" data-sr-type="${k}">${idle ? `All ${total}` : `Show all ${total}`}${icon('arrow-right')}</button>` : ''}
        ${f.type !== 'all' && total > shown.length ? html`<span class="sr-gmore">Showing ${shown.length} of ${total}</span>` : ''}
      </div>
      <div class="sr-list">${shown.map(x => ROW[k](x, S))}</div>
    </section>`;
  })}`;
}

// ------------------------------------------------------------------ aside: type distribution + filters + recent
function selectHtml(name, label, list, cur) {
  return html`<label class="sr-field"><span>${label}</span><select class="select" data-sr-f="${name}">${list.map(([v, l]) => html`<option value="${v}"${String(v) === String(cur) ? raw(' selected') : ''}>${l}</option>`)}</select></label>`;
}
function asideHtml(S) {
  const f = S.f, c = S.res?.counts || {};
  const recent = readRecent();
  const n = activeFilters(f) + (f.type !== 'all' ? 1 : 0);
  return html`
  <section class="sr-refine tile tile--static" aria-labelledby="sr-refine-h">
    <div class="sr-refine-head"><h2 class="section-label" id="sr-refine-h">Refine</h2>${n ? html`<button type="button" class="btn btn--ghost btn--sm" data-sr="clear-filters">Clear ${n === 1 ? 'filter' : `${n} filters`}</button>` : ''}</div>
    <div class="sr-types" role="radiogroup" aria-label="Result type">
      <button type="button" role="radio" class="sr-type sr-btn" data-sr-type="all" aria-checked="${f.type === 'all'}"><span>All results</span><span class="sr-tn">${f.type === 'all' ? (c.total ?? 0) : ''}</span></button>
      ${TYPES.map(([k, l]) => html`<button type="button" role="radio" class="sr-type sr-btn" data-sr-type="${k}" aria-checked="${f.type === k}"><span>${l}</span><span class="sr-tn">${f.type === 'all' || f.type === k ? (c[k] ?? 0) : ''}</span><i class="sr-tbar" style="--v:${c.total && (f.type === 'all' || f.type === k) ? ((c[k] || 0) / Math.max(...TYPES.map(([kk]) => c[kk] || 0), 1)).toFixed(3) : 0}" aria-hidden="true"></i></button>`)}
    </div>
    <details class="sr-more"${!matchMedia('(max-width: 760px)').matches || activeFilters(f) ? raw(' open') : ''}>
    <summary class="sr-more-s">Filters${activeFilters(f) ? html` <span class="sr-cn">${activeFilters(f)}</span>` : ''}</summary>
    <div class="sr-fields">
      ${selectHtml('topic', 'Topic', [['', 'Any topic'], ...S.topicOptions.map(t => [t, t])], f.topic)}
      ${selectHtml('company', 'Company', [['', 'Any company'], ...S.companyOptions.map(t => [t, t])], f.company)}
      ${selectHtml('source', 'Source', [['', 'Any source'], ...S.sources.map(s => [s.id, s.is_demo ? `${s.name} (demo)` : s.name])], f.source)}
      ${selectHtml('status', 'Status', STATUSES, f.status)}
      ${selectHtml('range', 'Date', RANGES, f.range)}
      ${f.range === 'custom' ? html`<div class="sr-dates"><label class="sr-field"><span>From</span><input class="input" type="date" data-sr-f="from" value="${f.from}"></label><label class="sr-field"><span>To</span><input class="input" type="date" data-sr-f="to" value="${f.to}"></label></div>` : ''}
    </div>
    <p class="sr-note">Topic, company and source narrow stories (source also claims); status applies to stories and drafts; dates apply to stories, briefs and drafts.</p>
    </details>
  </section>
  <section class="sr-recent" aria-labelledby="sr-recent-h">
    <div class="sr-refine-head"><h2 class="section-label" id="sr-recent-h">Recent searches</h2>${recent.length ? html`<button type="button" class="btn btn--ghost btn--sm" data-sr="clear-recent">Clear</button>` : ''}</div>
    ${recent.length ? html`<ul class="sr-recent-list">${recent.map(q => html`<li><button type="button" class="sr-recent-q sr-btn" data-sr-run="${q}">${icon('search')}<span>${q}</span></button><button type="button" class="btn btn--ghost btn--icon btn--sm" data-sr-forget="${q}" aria-label="Remove “${q}” from recent searches">${icon('x')}</button></li>`)}</ul>`
      : html`<p class="sr-note">Searches you run are kept here, in this browser only.</p>`}
  </section>`;
}

// ------------------------------------------------------------------ paint
function headHtml(S) {
  const hd = headline(S);
  return html`<p class="eyebrow">Search · ${S.res?.totals ? `${(S.res.totals.stories || 0) + (S.res.totals.claims || 0) + (S.res.totals.drafts || 0) + (S.res.totals.notes || 0) + (S.res.totals.contacts || 0) + (S.res.totals.briefs || 0)} records indexed` : 'archive'}</p>
    <h1 data-sr-h>${hd.h}</h1>
    <p class="lede" data-sr-l>${hd.l}</p>`;
}
function chipsHtml(S) {
  const { topics, watch, emps } = S.quick;
  const f = S.f;
  const row = (label, items) => items.length ? html`<div class="sr-qrow"><span class="sr-qlabel">${label}</span><div class="sr-qchips">${items}</div></div>` : '';
  return html`
    ${row('Topics', topics.map(([t, n]) => html`<button type="button" class="chip chip--filter" data-sr-topic="${t}" aria-pressed="${f.topic === t}" title="${plural(n, 'story', 'stories')} tagged ${t}">${t}<span class="sr-cn">${n}</span></button>`))}
    ${row('Watchlist', watch.map(({ q, n, w }) => html`<button type="button" class="chip chip--filter${n ? '' : ' is-zero'}" data-sr-run="${q}" aria-pressed="${f.q.toLowerCase() === q.toLowerCase()}" title="Watchlist${w.kind === 'question' ? ' question' : ''}: ${w.name}${q !== w.name ? ` · searches “${q}”` : ''} · ${plural(n, 'story', 'stories')}">${w.pinned ? html`<span class="sr-pin" aria-label="Pinned">●</span>` : ''}${q}<span class="sr-cn">${n}</span></button>`))}
    ${row('Employers', emps.map(e => html`<button type="button" class="chip chip--filter" data-sr-run="${e.name}" aria-pressed="${f.q.toLowerCase() === e.name.toLowerCase()}" title="${e.name}: in ${plural(e.story_count, 'story', 'stories')} (all time)">${e.name}<span class="sr-cn">${e.story_count}</span></button>`))}`;
}

function paint(el, S) {
  el.innerHTML = String(html`
  <header class="page-head" data-sr-head>${headHtml(S)}</header>
  <section class="sr-hero" aria-label="Search">
    <form class="sr-form" role="search" data-sr-form>
      <label class="sr-bar">
        <span class="sr-bar-ico">${icon('search')}</span>
        <span class="sr-only">Search stories, claims, drafts, notes, contacts and briefs</span>
        <input class="sr-input vh" type="search" name="q" value="${S.f.q}" placeholder="Search stories, claims, drafts, notes, people…" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-controls="sr-results" aria-describedby="sr-keys" data-sr-input>
        <button type="button" class="btn btn--ghost btn--icon btn--sm sr-clear" data-sr="clear-q" aria-label="Clear the search"${S.f.q ? '' : raw(' hidden')}>${icon('x')}</button>
        <kbd class="sr-kbd" aria-hidden="true">/</kbd>
      </label>
      <p class="sr-keys" id="sr-keys"><span><kbd>/</kbd> focus</span><span><kbd>↑</kbd><kbd>↓</kbd> move through results</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> back to the bar</span></p>
    </form>
    <div class="sr-quick" data-sr-quick>${chipsHtml(S)}</div>
  </section>
  <div class="sr-body">
    <div class="sr-results" id="sr-results" data-sr-results aria-live="polite" aria-busy="false">${resultsHtml(S)}</div>
    <aside class="sr-aside" data-sr-aside aria-label="Refine and recent searches">${asideHtml(S)}</aside>
  </div>`);
}

/** Update head text, results, aside and chip states in place (the bar keeps focus and caret). */
function repaint(el, S, { animate = true } = {}) {
  const hd = headline(S);
  const h1 = el.querySelector('[data-sr-h]'), l = el.querySelector('[data-sr-l]');
  if (h1 && h1.textContent !== hd.h) {
    h1.textContent = hd.h;
    if (animate && !reduced()) h1.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 280, easing: EASE.fade });
  }
  if (l) l.innerHTML = String(hd.l);
  const out = el.querySelector('[data-sr-results]');
  out.innerHTML = String(resultsHtml(S));
  out.setAttribute('aria-busy', 'false');
  el.querySelector('[data-sr-aside]').innerHTML = String(asideHtml(S));
  el.querySelector('[data-sr-quick]').innerHTML = String(chipsHtml(S));
  el.querySelector('.sr-clear').hidden = !S.f.q;
  if (animate) enterItems([...out.querySelectorAll('.sr-group-head, .sr-item, .empty')].slice(0, 14), { stagger: 24, y: 6, duration: 420, fadeDuration: 320 });
}

// ------------------------------------------------------------------ render
export async function render(view, ctx = {}) {
  await useStyle('/css/v4/search.css');
  const routeQ = (ctx.params || []).length ? decodeURIComponent((ctx.params || []).join('/')) : null;
  // a query from the route (⌘K fallback, shared link) starts clean; plain #/search keeps this session's filters
  const f = routeQ != null ? { ...blank(), q: routeQ.trim() } : { ...ui.f };
  const [settings, sources, employers, watch, today, all] = await Promise.all([
    api.get('/settings'), api.get('/sources').catch(() => []), api.get('/employers').catch(() => []),
    api.get('/watchlists').catch(() => []), api.get('/today').catch(() => null), api.get('/search?type=stories&limit=200').catch(() => null)
  ]);
  const S = {
    f, settings, sources, employers, watch, today, res: null, error: null, seq: 0,
    T: Number(settings.publish_threshold ?? 55), tz: settings.timezone,
    allStories: all?.stories || [],
    sourceName: Object.fromEntries(sources.map(s => [String(s.id), s.name]))
  };
  const prio = (settings.priorities || []).filter(p => p.weight > 0).map(p => p.topic);
  S.topicOptions = [...new Set([...prio, ...S.allStories.flatMap(s => s.topics || [])])];
  S.companyOptions = [...new Set([...employers.map(e => e.name), ...S.allStories.flatMap(s => s.companies || [])])].sort((a, b) => a.localeCompare(b));
  S.quick = quickChips(S);
  try { S.res = await api.get(queryUrl(f)); } catch (e) { S.error = e.message; }
  if (f.q && S.res?.counts?.total) remember(f.q);

  const el = document.createElement('div');
  el.className = 'sr';
  view.replaceChildren(el);
  paint(el, S);
  wire(el, S);
}

function wire(el, S) {
  const input = el.querySelector('[data-sr-input]');
  let deb = 0;
  const setHash = () => {
    const h = S.f.q ? `#/search/${encodeURIComponent(S.f.q)}` : '#/search';
    if (location.hash !== h) history.replaceState(history.state, '', h);
  };
  const run = async ({ save = false, animate = true } = {}) => {
    clearTimeout(deb);
    ui.f = { ...S.f, q: '' };
    const seq = ++S.seq;
    setHash();
    el.querySelector('[data-sr-results]')?.setAttribute('aria-busy', 'true');
    try { const r = await api.get(queryUrl(S.f)); if (seq !== S.seq) return; S.res = r; S.error = null; }
    catch (e) { if (seq !== S.seq) return; S.error = e.message; }
    if (save && S.f.q && S.res?.counts?.total) remember(S.f.q);
    repaint(el, S, { animate });
  };
  const runQ = (q, opts) => { S.f.q = q.trim(); input.value = S.f.q; return run(opts); };

  // autofocus once the page is on screen (never on touch: it would raise the keyboard over the results)
  const focusBar = () => { if (el.isConnected && !matchMedia('(pointer: coarse)').matches && !document.querySelector('.dossier, .modal-wrap')) { input.focus({ preventScroll: true }); const n = input.value.length; input.setSelectionRange(n, n); } };
  const onRouted = (e) => { if (e.detail?.page?.contains(el)) { document.removeEventListener('byline:routed', onRouted); focusBar(); } };
  document.addEventListener('byline:routed', onRouted);
  setTimeout(() => document.removeEventListener('byline:routed', onRouted), 4000);

  input.addEventListener('input', () => {
    S.f.q = input.value.trim();
    el.querySelector('.sr-clear').hidden = !input.value;
    clearTimeout(deb);
    deb = setTimeout(() => run({ animate: false }), 180);
  });
  el.querySelector('[data-sr-form]').addEventListener('submit', (e) => { e.preventDefault(); S.f.q = input.value.trim(); run({ save: true }); });

  // keyboard: ↓ from the bar into the results; ↑/↓ across every group; esc back to the bar (F §4)
  const items = () => [...el.querySelectorAll('[data-sr-item]')];
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { const first = items()[0]; if (first) { e.preventDefault(); first.focus(); } }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); runQ(''); }
  });
  el.querySelector('[data-sr-results]').addEventListener('keydown', (e) => {
    const cur = e.target.closest('[data-sr-item]');
    if (!cur) return;
    const list = items(), i = list.indexOf(cur);
    let next = null;
    if (e.key === 'ArrowDown') next = list[i + 1];
    else if (e.key === 'ArrowUp') next = i > 0 ? list[i - 1] : input;
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else if (e.key === 'Escape') next = input;
    else if (e.key === 'Enter' && S.f.q) remember(S.f.q);
    if (next) { e.preventDefault(); next.focus(); next.scrollIntoView?.({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
  });
  on(el, 'click', '[data-sr-item]', () => { if (S.f.q) remember(S.f.q); });

  // "/" focuses the bar while Search is on screen (capture phase, ahead of the global ⌘K "/" shortcut)
  const onSlash = (e) => {
    if (!el.isConnected) { document.removeEventListener('keydown', onSlash, true); return; }
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || inField(e) || document.querySelector('.dossier, .modal-wrap, .ix')) return;
    e.preventDefault(); e.stopPropagation();
    input.focus(); input.select();
  };
  document.addEventListener('keydown', onSlash, true);

  // chips, type list, filters, recent
  on(el, 'click', '[data-sr-run]', (e, b) => runQ(b.dataset.srRun, { save: true }));
  on(el, 'click', '[data-sr-topic]', (e, b) => { S.f.topic = S.f.topic === b.dataset.srTopic ? '' : b.dataset.srTopic; run(); });
  on(el, 'click', '[data-sr-type]', (e, b) => {
    S.f.type = b.dataset.srType; run();
    if (b.closest('.sr-group-head')) el.querySelector('[data-sr-results]').scrollIntoView?.({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  });
  on(el, 'change', '[data-sr-f]', (e, c) => {
    S.f[c.dataset.srF] = c.value;
    if (c.dataset.srF === 'range' && c.value !== 'custom') { S.f.from = ''; S.f.to = ''; }
    run().then(() => el.querySelector(`[data-sr-f="${c.dataset.srF}"]`)?.focus({ preventScroll: true }));
  });
  on(el, 'click', '[data-sr="clear-filters"]', () => { S.f = { ...blank(), q: S.f.q }; run(); });
  on(el, 'click', '[data-sr="clear-q"]', () => { runQ('').then(() => input.focus()); });
  on(el, 'click', '[data-sr="clear-recent"]', () => { writeRecent([]); el.querySelector('[data-sr-aside]').innerHTML = String(asideHtml(S)); toast('Recent searches cleared', 'ok'); });
  on(el, 'click', '[data-sr-forget]', (e, b) => { writeRecent(readRecent().filter(x => x !== b.dataset.srForget)); el.querySelector('[data-sr-aside]').innerHTML = String(asideHtml(S)); el.querySelector('.sr-recent-q, [data-sr="clear-recent"]')?.focus(); });
}
