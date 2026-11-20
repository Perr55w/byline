// Feed (SPEC §5, F §2 Feed headline template, F §4 row anatomy). Every figure comes from /api/stories and
// /api/settings; the threshold is settings.publish_threshold. Story detail lives in the dossier overlay
// (views/story-dossier.js); each row is a dossier flight source (data-shared title / chip→ring / topic).
//
// Kept from v3: topic filter + Archived, Add story URL (POST /api/intake/url with evidence kind),
// score change since last viewed, "N new since you looked", saved collections, engagement note,
// keyboard rows (app.js j/k/Enter via [data-row]). New: min score, date range, sort, threshold divider,
// hover actions Draft / Save / Dismiss (Restore in Archived).

import { api } from '../api.js';
import * as ui from '../ui.js';
import { EASE, reduced, flip } from '../motion.js';
import * as dossier from '../dossier.js';

const { html, raw, esc, on, act, toast, icon, scoreChip, strikeOut, useStyle } = ui;

const DEFAULT_COLLECTION = 'AI product management';
const DAYS = [['7', '7 days'], ['30', '30 days'], ['all', 'All time']];
const SORTS = [['score', 'Score'], ['new', 'Newest']];

// ------------------------------------------------------------------ helpers
const tz = () => window.__byline?.timezone || undefined;
// Intl formatters are costly to build (≈1.5 ms each at 4× CPU): one per timezone, reused by every row (E1)
const fmts = new Map();
const fmt = (kind) => { const k = `${kind}|${tz() || ''}`; let f = fmts.get(k); if (!f) { f = new Intl.DateTimeFormat('en-GB', kind === 'day' ? { day: 'numeric', month: 'short', timeZone: tz() } : { dateStyle: 'short', timeStyle: 'medium', timeZone: tz() }); fmts.set(k, f); } return f; };
const dayLabel = (iso) => fmt('day').format(new Date(iso));
const num = (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function age(iso) {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return dayLabel(iso);
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function marked(text, marks) {
  const t = String(text ?? '');
  if (!marks?.length) return raw(esc(t));
  let out = '', at = 0;
  for (const [a, b] of marks) { if (a < at || b > t.length || b <= a) continue; out += esc(t.slice(at, a)) + `<mark class="num-hl">${esc(t.slice(a, b))}</mark>`; at = b; }
  return raw(out + esc(t.slice(at)));
}
// engagement keys → words (F: "610 replys")
const ENG = { reply_count: 'replies', like_count: 'likes', retweet_count: 'reposts', quote_count: 'quotes', view_count: 'views', bookmark_count: 'bookmarks' };
const engWord = (k) => ENG[k] || k.replace(/_count$/, '').replace(/_/g, ' ');
/** F §4 source strip, one glyph per kind present with its count ("■ 4 ◆ 1 ○ 2"); the list header carries the key. */
const KINDS = [['fp', 'first-party'], ['ind', 'independent'], ['com', 'commentary']];
function kindCounts(s) { return { fp: (s.first_party || 0) + (s.primary || 0), ind: s.independent || 0, com: s.commentary || 0 }; }
function markers(s) {
  const n = kindCounts(s);
  return html`<span class="fd-mks" aria-hidden="true">${KINDS.filter(([k]) => n[k]).map(([k]) => html`<span class="fd-mk"><i class="mk mk--${k}"></i>${n[k]}</span>`)}</span>`;
}
const countsLabel = (s) => { const n = kindCounts(s); return KINDS.map(([k, l]) => `${n[k]} ${l}`).join(', '); };
/** The server's source line without its leading post count (the glyph counts already sum to it). */
const outletsLine = (s) => String(s.source_line || '').replace(/^\d+ posts? · /, '');
const LEGEND = html`<p class="fd-legend" aria-hidden="true"><span><i class="mk mk--fp"></i>first-party</span><span><i class="mk mk--ind"></i>independent</span><span><i class="mk mk--com"></i>commentary/community</span></p>`;

function params() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  return { topic: q.get('topic') || '', status: q.get('status') === 'archived' ? 'archived' : '', days: DAYS.some(([k]) => k === q.get('days')) ? q.get('days') : '7', min: q.get('min') || '', sort: q.get('sort') === 'new' ? 'new' : 'score' };
}
function hashFor(st) {
  const q = new URLSearchParams();
  if (st.topic) q.set('topic', st.topic);
  if (st.status) q.set('status', st.status);
  if (st.days !== '7') q.set('days', st.days);
  if (st.min) q.set('min', st.min);
  if (st.sort !== 'score') q.set('sort', st.sort);
  const s = q.toString();
  return `#/feed${s ? `?${s}` : ''}`;
}
function storiesUrl(st) {
  const q = new URLSearchParams();
  if (st.days !== 'all') q.set('days', st.days);
  if (st.topic) q.set('topic', st.topic);
  if (st.status) q.set('status', st.status);
  q.set('limit', st.days === 'all' || st.status ? '200' : '100');
  return `/stories?${q}`;
}

// ------------------------------------------------------------------ headline + one-liner (F §2 Feed, verbatim templates)
function headline(st, stories, T, status) {
  const total = stories.length;
  const cleared = stories.filter(s => s.score >= T);
  const below = total - cleared.length;
  const unopened = stories.filter(s => !s.last_viewed_at).length;
  const withIndep = cleared.filter(s => (s.independent_outlets || 0) > 0).length;
  const when = st.days === '7' ? 'this week' : st.days === '30' ? 'this month' : 'in your archive';
  const window = st.days === 'all' ? 'in total' : `in the last ${st.days} days`;
  if (st.status === 'archived') {
    return {
      h: total ? html`<b>${total}</b> archived ${total === 1 ? 'story' : 'stories'}.` : 'Nothing is archived.',
      l: total ? html`Dismissed stories stay searchable; <b>${cleared.length}</b> of them still score at or above your bar of <b>${T}</b>. Restore one to put it back in the ranking.` : html`Stories you dismiss land here. They stay searchable and can be restored.`
    };
  }
  if (!total) {
    const paused = status?.counts?.sources_paused, n = status?.counts?.sources;
    return {
      h: st.topic ? `No ${st.topic} stories ${window}.` : `No stories ${st.days === 'all' ? 'yet' : `in the last ${st.days} days`}.`,
      l: n && paused === n ? html`Collection is off: all <b>${n}</b> sources are paused. Add a story URL, or resume a source under Sources.` : html`Add a story URL to start${st.days !== 'all' ? ', or widen the date range' : ''}.`
    };
  }
  const lede = html`<b>${total}</b> updated ${window}; <b>${cleared.length}</b> at or above <b>${T}</b>, <b>${below}</b> below. <b>${unopened}</b> you haven’t opened. ${cleared.length ? html`<b>${withIndep}</b> of the ${cleared.length} ${withIndep === 1 ? 'has' : 'have'} an independent report.` : ''}`;
  // h1 figures and changing words sit in <b> (styled as plain h1 text) so a repaint can fade only what changed
  if (st.topic) return { h: html`<b>${total}</b> <b>${st.topic}</b> ${total === 1 ? 'story' : 'stories'}; <b>${cleared.length}</b> above <b>${T}</b>.`, l: lede };
  return { h: html`<b>${cleared.length}</b> of <b>${total}</b> ${total === 1 ? 'story' : 'stories'} <b>${when}</b> ${cleared.length === 1 ? 'is' : 'are'} worth a post.`, l: lede };
}

// ------------------------------------------------------------------ topic pills (R2 / S9)
/**
 * The first topic is blue (.chip--main) only when round(score) clears the bar; below it, the neutral lead pill.
 * Shared `topicPills()` (ui.js) owns the rule; the local copy only covers a ui.js without it.
 */
function pills(topics, score, T) {
  const list = topics.filter(Boolean).slice(0, 2);
  if (!list.length) return '';
  const out = typeof ui.topicPills === 'function'
    ? String(ui.topicPills(list, score, T, { max: 2 }))
    : list.map((t, i) => `<span class="chip ${i ? 'chip--topic' : Math.round(Number(score) || 0) >= T ? 'chip--main' : 'chip--lead'}">${esc(t)}</span>`).join('');
  // the first pill is the dossier flight's shared "topic" element
  return /data-shared=/.test(out) ? out : out.replace(/<span class="chip/, '<span data-shared="topic" class="chip');
}

// ------------------------------------------------------------------ row (F §4)
/** What a reused row must match to be kept as is through a repaint (anything the row markup shows). */
const rowSig = (s, T) => `${s.score}|${T}|${s.viewed_score ?? ''}|${s.collections ?? ''}|${s.new_since_view ?? ''}|${s.updated_at}|${s.finding ?? ''}`;
function row(s, T, cv = false) {
  const topics = s.topics || [];
  const main = s.main_topic || topics[0] || null;
  const second = topics.find(t => t !== main) || null;
  const below = s.score < T;
  const changed = s.viewed_score != null && Math.round(s.viewed_score) !== Math.round(s.score);
  const eng = Object.entries(s.breakdown?.engagement || {});
  const counts = countsLabel(s);
  return html`<article class="fd-row${below ? ' is-below' : ''}${cv ? ' cv-row' : ''}" data-row data-key="${s.id}" data-sig="${rowSig(s, T)}" data-id="${s.id}" data-score="${s.score}">
    <div class="fd-score">${raw(String(scoreChip(s.score, T)).replace('<span class="score-chip"', '<span class="score-chip" data-shared="ring"'))}${changed ? html`<span class="fd-was" title="Score when you last opened it">was ${Math.round(s.viewed_score)}</span>` : ''}</div>
    <div class="fd-main">
      <h3 class="fd-h"><a class="fd-title" href="#/story/${s.id}" data-shared="title">${s.title}</a>${s.is_demo ? html` <span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}</h3>
      ${s.finding ? html`<p class="fd-finding">${marked(s.finding, s.finding_marks)}</p>` : ''}
      ${s.new_since_view || s.collections || eng.length ? html`<p class="fd-flags">
        ${s.new_since_view ? html`<span class="tag tag--ok">${s.new_since_view} new since you looked</span>` : ''}
        ${s.collections ? html`<span class="fd-saved">${icon('bookmark')}Saved: ${String(s.collections).split(',').join(', ')}</span>` : ''}
        ${eng.length ? html`<span class="fd-eng" title="Engagement is shown separately and does not count as evidence">engagement (not evidence): ${eng.map(([k, v]) => `${num(v)} ${engWord(k)}`).join(' · ')}</span>` : ''}
      </p>` : ''}
    </div>
    <div class="fd-meta">
      <div class="fd-topics">${main ? raw(pills([main, second], s.score, T)) : html`<span class="fd-none">No topic matched</span>`}</div>
      <p class="fd-src" title="${counts}">${markers(s)}<span>${outletsLine(s)}</span><span class="sr-only">${s.source_line} (${counts})</span><span class="fd-age-m" aria-hidden="true">· ${age(s.updated_at)}</span></p>
    </div>
    <div class="fd-end">
      <time class="fd-age" datetime="${s.updated_at}" title="Updated ${fmt('full').format(new Date(s.updated_at))}">${age(s.updated_at)}</time>
    </div>
  </article>`;
}

/**
 * Row actions (F3). F-2: every row carries its own toolbar, added in idle time after the list is on screen
 * (armActs), so hover and focus only toggle :hover / :focus-within styles: nothing moves, nothing lays out. The
 * toolbar is absolutely placed over the date column and its reveal is opacity only. A row that is hovered or
 * focused before the idle pass reaches it gets its toolbar then (placeActs).
 */
function actsHtml(archived) {
  return html`<div class="fd-acts" role="group" aria-label="Story actions" data-acts>
    ${archived
      ? html`<button type="button" class="btn btn--ghost btn--sm" data-fd="restore">Restore</button>`
      : html`<button type="button" class="btn btn--ghost btn--sm btn--icon" data-fd="draft" aria-label="Draft a post" title="Draft a post">${icon('pen')}</button>
        <button type="button" class="btn btn--ghost btn--sm btn--icon" data-fd="save" aria-label="Save to ${DEFAULT_COLLECTION}" title="Save to ${DEFAULT_COLLECTION}">${icon('bookmark')}</button>
        <button type="button" class="btn btn--ghost btn--sm btn--icon" data-fd="dismiss" aria-label="Dismiss" title="Dismiss (moves it to Archived)">${icon('x')}</button>`}
  </div>`;
}
function placeActs(el, rowEl, state) {
  const end = rowEl?.querySelector('.fd-end');
  if (!end || end.querySelector('[data-acts]')) return false;
  const bar = el.querySelector('template[data-acts-home]')?.content.firstElementChild?.cloneNode(true);
  if (!bar) return false;
  const s = state.stories.find(x => String(x.id) === rowEl.dataset.id);
  bar.setAttribute('aria-label', `Actions for ${s?.short_title || s?.title || 'story'}`);
  bar.querySelector('[data-fd="save"]')?.setAttribute('aria-pressed', String(!!s?.collections));
  end.append(bar);
  return true;
}
/** Idle pass: a toolbar for every row that has none yet, a few rows per idle slice. */
function armActs(el, state) {
  if (matchMedia('(hover: none)').matches) return; // touch: the toolbar is hidden (feed.css); actions live in the dossier
  const token = (state.actsToken = {});
  const step = (dl) => {
    if (state.actsToken !== token || !el.isConnected) return;
    const todo = [...el.querySelectorAll('.fd-list > .fd-row:not(.fd-leaving)')].filter(r => !r.querySelector('.fd-end [data-acts]'));
    let n = 0;
    while (todo.length && (dl.didTimeout ? n < 12 : dl.timeRemaining() > 3)) { placeActs(el, todo.shift(), state); n++; }
    if (todo.length) idle(step, 1000);
  };
  idle(step, 1000);
}

// FD3 / E1: the first SYNC_ROWS rows render with the page; the rest arrive in one idle chunk. Every row after the
// 8th skips layout until scrolled to (cv-row; its intrinsic size is the measured Feed row, feed.css).
// F-1, phone: rows are ≈ 196 px and the list starts ≈ 500 px down, so two rows show on a 390 × 844 screen. The swap
// frame renders the first 6 rows and lays out only the first 3 (rows 4–6 are cv-row); the rest join the idle chunk.
const SYNC_ROWS = 8, SYNC_ROWS_PHONE = 6, CV_FROM = 8, CV_FROM_PHONE = 3, REUSE_SYNC = 40;
const isPhoneW = () => matchMedia('(max-width: 760px)').matches;
const syncRows = () => (isPhoneW() ? SYNC_ROWS_PHONE : SYNC_ROWS);
/** Row ids + scores: when this key is unchanged a repaint leaves the list alone. */
const listKey = (st, stories, T) => `${T}|${st.status}|${st.sort}|${st.min}|${stories.map(s => `${s.id}:${s.score}`).join(',')}`;
/**
 * The list plan (F §4): keyed items in display order, each { key, sig, html() } (markup built on demand),
 * plus the count the minimum score hides and, when nothing passes it, the empty-state markup.
 */
function listPlan(st, stories, T) {
  let list = stories.filter(s => !st.min || s.score >= Number(st.min));
  const hidden = stories.length - list.length;
  if (st.sort === 'new') list = list.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (!stories.length) return { items: [], hidden, empty: '' };
  if (!list.length) return { items: [], hidden, empty: String(html`<div class="empty"><h3>Nothing at or above ${st.min}.</h3><p>${plural(hidden, 'story', 'stories')} in this range score lower. Lower the minimum score to see them.</p></div>`) };
  const items = [];
  let divided = false, rows = 0;
  const cvFrom = isPhoneW() ? CV_FROM_PHONE : CV_FROM;
  const belowCount = list.filter(s => s.score < T).length;
  const divText = `Below your bar · ${T} — ${plural(belowCount, 'story', 'stories')}`;
  for (const s of list) {
    if (st.sort === 'score' && !divided && s.score < T) {
      divided = true;
      items.push({ key: 'div', sig: divText, text: divText, html: () => String(html`<div class="divider-label fd-divider" role="separator" data-key="div" data-sig="${divText}">${divText}</div>`) });
    }
    const cv = rows++ >= cvFrom;
    items.push({ key: String(s.id), sig: rowSig(s, T), cv, html: () => String(row(s, T, cv)) });
  }
  return { items, hidden, empty: null };
}
const footHtml = (st, hidden) => (hidden ? String(html`<p class="fd-foot" data-fd-foot>${plural(hidden, 'story', 'stories')} below ${st.min} hidden by the minimum score.</p>`) : '');
/** First paint of the list. Returns { html, rest }: rest() is the markup of every item after the first SYNC_ROWS rows. */
function listHtml(st, stories, T) {
  const plan = listPlan(st, stories, T);
  if (!plan.items.length) return { html: plan.empty || '', rest: null };
  let cut = plan.items.length, n = 0;
  const sync = syncRows();
  for (let i = 0; i < plan.items.length; i++) if (plan.items[i].key !== 'div' && ++n === sync) { cut = i + 1; break; }
  const run = (list) => list.map(it => it.html()).join('');
  return {
    html: String(html`<div class="tile tile--static tile--flush fd-list" data-fd-list>${raw(run(plan.items.slice(0, cut)))}</div><template data-acts-home>${actsHtml(st.status === 'archived')}</template>${raw(footHtml(st, plan.hidden))}`),
    rest: cut < plan.items.length ? () => run(plan.items.slice(cut)) : null
  };
}

const idle = (fn, timeout = 600) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 32));
/** Append the deferred rows (one idle chunk), then check the finding clamps. `rest` returns markup or nodes. */
function fillRest(el, state, rest) {
  const token = (state.restToken = {});
  idle(() => {
    if (state.restToken !== token || !el.isConnected) return;
    const more = rest?.();
    const list = el.querySelector('[data-fd-list]');
    if (more && list) { if (typeof more === 'string') list.insertAdjacentHTML('beforeend', more); else list.append(...more); }
    clampCheck(el, state);
    releaseCv(el, state);
    armActs(el, state);
  });
}
/**
 * cv-row is for the tab-in and append frames only. Once the page is quiet, a short list (≤ 60 rows) lays its
 * skipped rows out for real, a few per idle slice and all off screen (no visible shift), so the scroll height
 * is exact and full-page captures never show the estimate as an empty band. Long lists (All time) keep it.
 */
function releaseCv(el, state) {
  const token = (state.cvToken = {});
  const rows = () => [...el.querySelectorAll('.fd-list > .fd-row.cv-row:not(.fd-leaving)')];
  if (el.querySelectorAll('.fd-list > .fd-row').length > 60) return;
  setTimeout(() => {
    const todo = rows();
    const step = (dl) => {
      if (state.cvToken !== token || !el.isConnected) return;
      let n = 0;
      while (todo.length && n < 3 && (dl.didTimeout || dl.timeRemaining() > 6)) { todo.shift().classList.remove('cv-row'); n++; }
      if (todo.length) idle(step, 1000);
    };
    idle(step, 1000);
  }, 1200);
}
/**
 * F2: findings clamp at 2 lines, or 3 when line 2 would cut through a highlighted figure. Mark geometry is read
 * in a ResizeObserver callback for laid-out rows, and in idle time after the tab change for cv-row rows.
 */
function clampCheck(el, state) {
  const token = (state.clampToken = {});
  const all = [...el.querySelectorAll('.fd-finding:not([data-clamp])')].filter(p => p.querySelector('mark'));
  const LH = 21;
  // one finding's reads; returns true when its marks straddle lines 2 and 3
  const needs3 = (p) => {
    const top = p.getBoundingClientRect().top;
    for (const m of p.querySelectorAll('mark')) {
      const r = m.getClientRects(); if (!r.length) continue;
      const a = Math.floor((r[0].top - top + 2) / LH), b = Math.floor((r[r.length - 1].bottom - top - 2) / LH);
      if (a <= 1 && b >= 2) return true;
    }
    return false;
  };
  const write = (seen, n3) => { seen.forEach(p => { p.dataset.clamp = '2'; }); n3.forEach(p => { p.dataset.clamp = '3'; }); };
  // laid-out rows: read inside a ResizeObserver callback, where layout is clean (no forced layout in the tab change)
  const live = all.filter(p => !p.closest('.cv-row'));
  if (live.length && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      ro.disconnect();
      if (state.clampToken !== token || !el.isConnected) return;
      const seen = live.filter(p => p.isConnected);
      write(seen, seen.filter(needs3));
    });
    live.forEach(p => ro.observe(p));
  }
  // rows still under content-visibility are off screen: read them in idle time once the tab change is over
  const todo = 'ResizeObserver' in window ? all.filter(p => p.closest('.cv-row')) : all;
  if (!todo.length) return;
  const step = (dl) => {
    if (state.clampToken !== token || !el.isConnected) return;
    const seen = [], n3 = [];
    while (todo.length && (dl.didTimeout || dl.timeRemaining() > 2)) { const p = todo.shift(); seen.push(p); if (needs3(p)) n3.push(p); }
    write(seen, n3); // writes after the reads
    if (todo.length) idle(step);
  };
  setTimeout(() => idle(step), 1500);
}

// ------------------------------------------------------------------ page
export async function render(view, ctx = {}) {
  fmt('day'); fmt('full'); // build the formatters now, not inside the frame that paints the rows
  await useStyle('/css/v4/feed.css');
  const st = params();
  const [settings, stories] = await Promise.all([api.get('/settings'), api.get(storiesUrl(st))]);
  const status = stories.length ? null : await api.get('/status').catch(() => null);
  const T = Number(settings.publish_threshold ?? 55);
  const topics = (settings.priorities || []).filter(p => p.weight > 0).map(p => p.topic);
  const el = document.createElement('div');
  el.className = 'fd';
  view.replaceChildren(el);
  const all = st.topic ? await api.get(storiesUrl({ ...st, topic: '' })).catch(() => null) : null;
  const state = { st, stories, T, settings, status, all };
  const rest = paint(el, state);
  wire(el, state, topics);
  // F6 / FD3: rows past the first 8 arrive in one idle chunk once the page is on screen (byline:routed)
  let fired = false;
  const go = () => { if (fired) return; fired = true; document.removeEventListener('byline:routed', onRouted); fillRest(el, state, rest); };
  const onRouted = (e) => { if (!e.detail?.page || e.detail.page.contains(el)) go(); };
  document.addEventListener('byline:routed', onRouted);
  setTimeout(go, 1500); // a re-render outside the router never gets the event
  // story/:id deep link fallback (app.js normally opens the overlay over Feed itself)
  if (ctx.name === 'story' && ctx.params?.[0]) dossier.open(ctx.params[0]);
}

function showing(st, stories) {
  const n = stories.filter(s => !st.min || s.score >= Number(st.min)).length;
  const range = st.days === 'all' ? 'all time' : `last ${st.days} days`;
  return `${plural(n, st.status === 'archived' ? 'archived story' : 'story', st.status === 'archived' ? 'archived stories' : 'stories')}${st.topic ? ` in ${st.topic}` : ''} · ${range} · ${st.sort === 'new' ? 'newest first' : 'highest score first'}${st.min ? ` · ${st.min}+` : ''}`;
}

/**
 * Topic chips: the priorities that appear in this date range, with their counts, ordered by count × priority
 * weight (the headline-topic rule, DECISIONS); catch-all topics (weight ≤ 1, e.g. Machine learning) come after
 * every other topic whatever their count (FD13).
 */
function topicCounts(state, topics) {
  const base = state.all || state.stories;
  const weight = new Map((state.settings.priorities || []).map(p => [p.topic, Number(p.weight) || 0]));
  const n = new Map(topics.map(t => [t, 0]));
  for (const s of base) for (const t of s.topics || []) if (n.has(t)) n.set(t, n.get(t) + 1);
  const w = (t) => weight.get(t) ?? 1;
  return [...n].filter(([t, c]) => c > 0 || t === state.st.topic)
    .sort((a, b) => ((w(a[0]) <= 1) - (w(b[0]) <= 1)) || (b[1] * w(b[0]) - a[1] * w(a[0])) || (b[1] - a[1]));
}

function headHtml(state) {
  const { st, stories, T, settings } = state;
  const prioCount = (settings.priorities || []).filter(p => p.weight > 0).length;
  const head = headline(st, stories, T, state.status);
  return { eyebrow: `Ranked by your ${prioCount} priorities · bar ${T}`, h: String(html`${head.h}`), l: String(html`${head.l}`), raw: head };
}
/**
 * F-5: catch-all topics (weight ≤ 1) and topics with a single story fold into a trailing "+N" chip, so the row
 * stays on one line at 1440; the selected topic is never folded. "+N" expands the row in place (and "Fewer" folds it).
 */
function chipsData(state, topics) {
  const { st } = state;
  const weight = new Map((state.settings.priorities || []).map(p => [p.topic, Number(p.weight) || 0]));
  const all = topicCounts(state, topics).map(([t, n]) => ({ v: t, label: t, n, pressed: st.topic === t && !st.status, minor: (weight.get(t) ?? 1) <= 1 || n <= 1 }));
  const minor = all.filter(c => c.minor && !c.pressed);
  const fold = minor.length > 1 && !state.chipsOpen;
  const shown = fold ? all.filter(c => !c.minor || c.pressed) : all;
  const out = [{ v: '', label: 'All', pressed: !st.topic && !st.status }, ...shown];
  if (minor.length > 1) out.push({ v: '__more', more: true, label: fold ? `+${minor.length}` : 'Fewer', title: fold ? `${minor.map(c => `${c.label} (${c.n})`).join(', ')}` : 'Fold the catch-all and single-story topics', open: !fold });
  return out;
}
const chipHtml = (c) => (c.more
  ? html`<button type="button" class="chip chip--filter fd-more" data-fd="topic-more" data-v="__more" aria-expanded="${String(!!c.open)}" title="${c.title}">${c.label}</button>`
  : html`<button type="button" class="chip chip--filter" data-fd="topic" data-v="${c.v}" aria-pressed="${String(!!c.pressed)}">${c.label}${c.n != null ? html`<span class="fd-n">${c.n}</span>` : ''}</button>`);
function bodyHtml(state, head) {
  const { st, stories, T } = state;
  if (stories.length) return listHtml(st, stories, T);
  return { html: String(html`<div class="empty"><h3>${raw(head.h)}</h3><p>${raw(head.l)}</p>${st.status === 'archived' ? html`<div class="cluster"><button type="button" class="btn btn--secondary" data-fd="archived">Back to the feed</button></div>` : html`<div class="cluster"><button type="button" class="btn btn--primary" data-fd="add">${icon('plus')}Add story URL</button>${st.days !== 'all' ? html`<button type="button" class="btn btn--secondary" data-fd="days" data-v="all">Show all time</button>` : ''}</div>`}</div>`), rest: null };
}

/** First paint of the whole page. Returns the deferred row markup. */
function paint(el, state) {
  const { st, stories, T, settings } = state;
  const topics = (settings.priorities || []).filter(p => p.weight > 0).map(p => p.topic);
  const head = headHtml(state);
  const body = bodyHtml(state, head);
  state.head = head; state.key = listKey(st, stories, T); state.listStatus = st.status; state.headSwap = null; state.restToken = null;
  el.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">${head.eyebrow}</p>
    <h1>${raw(head.h)}</h1>
    <p class="lede">${raw(head.l)}</p>
    <div class="page-head-actions"><button type="button" class="btn btn--secondary" data-fd="add" aria-expanded="false" aria-controls="fd-intake">${icon('plus')}Add story URL</button></div>
  </header>
  <form class="fd-intake tile tile--static" id="fd-intake" data-intake>
    <label class="fd-intake-l" for="fd-url">Add a story by URL <span class="ink-3">when no source covers it</span></label>
    <div class="fd-intake-row">
      <input class="input" id="fd-url" name="url" type="url" required placeholder="https://…" autocomplete="off">
      <select class="select" name="evidence_kind" aria-label="Evidence kind">
        <option value="reporting">Independent reporting</option><option value="announcement">Announcement</option>
        <option value="research">Research</option><option value="commentary">Commentary</option>
      </select>
      <button class="btn btn--primary" type="submit">Add story</button>
      <button class="btn btn--ghost" type="button" data-fd="add-close">Cancel</button>
    </div>
  </form>
  <div class="fd-bar">
    <div class="fd-topicbar" role="group" aria-label="Filter by topic" data-fd-topics>
      ${chipsData(state, topics).map(chipHtml)}
    </div>
  </div>
  <div class="fd-viewbar">
    <div class="fd-viewinfo"><p class="fd-showing">${showing(st, stories)}</p>${LEGEND}</div>
    <div class="fd-controls">
      <label class="fd-ctl"><span>Min score</span>
        <select class="select" data-fd="min" aria-label="Minimum score">
          <option value="">Any</option>
          ${[T, 70, 40, 25].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a).map(v => html`<option value="${v}"${String(v) === st.min ? raw(' selected') : ''}>${v === T ? `${v}+ · your bar` : `${v}+`}</option>`)}
        </select>
      </label>
      <div class="fd-seg" role="radiogroup" aria-label="Date range">${DAYS.map(([k, l]) => html`<button type="button" role="radio" class="fd-seg-btn" data-fd="days" data-v="${k}" aria-checked="${String(st.days === k)}">${l}</button>`)}</div>
      <div class="fd-seg" role="radiogroup" aria-label="Sort">${SORTS.map(([k, l]) => html`<button type="button" role="radio" class="fd-seg-btn" data-fd="sort" data-v="${k}" aria-checked="${String(st.sort === k)}">${l}</button>`)}</div>
      <button type="button" class="chip chip--filter fd-arch" data-fd="archived" aria-pressed="${String(st.status === 'archived')}">Archived</button>
    </div>
  </div>
  <div class="fd-body" data-fd-body>${raw(body.html)}</div>`);
  return body.rest;
}

// ------------------------------------------------------------------ repaint in place (FD4: nothing blanks, nothing pops)
const fadeIn = (n, delay = 0) => { if (!reduced()) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay, easing: EASE.fade, fill: 'backwards' }); };
/**
 * Header swap on a filter change (F-3). enterHeading runs on route entry only; here the h1 stays put. When the new
 * sentence has the same words around its figures (each figure is a <b>), only the figures that changed dip to
 * opacity .5 and back over 160 ms, swapping at the bottom of the dip; when the wording changes too, the whole h1
 * dips the same way. A changed lede dips as a block. Nothing is ever blanked.
 */
const frag = (markup) => { const t = document.createElement('template'); t.innerHTML = markup; return t.content; };
const skeleton = (root) => [...root.childNodes].map(n => (n.nodeName === 'B' ? '\u0001' : n.textContent)).join('');
function dip(node, apply) {
  if (reduced()) { apply(); return; }
  const out = node.animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 80, easing: EASE.exit, fill: 'forwards' });
  out.finished.then(() => {
    apply();
    node.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 80, easing: EASE.fade });
    out.cancel(); // after the return leg has started: no frame at full opacity in between
  }, () => {});
}
function swapHead(el, state, head) {
  const h1 = el.querySelector('.page-head h1'), lede = el.querySelector('.page-head .lede');
  const eb = el.querySelector('.page-head .eyebrow'); if (eb && eb.textContent !== head.eyebrow) eb.textContent = head.eyebrow;
  const prev = state.head;
  const hChanged = !!h1 && prev?.h !== head.h, lChanged = !!lede && prev?.l !== head.l;
  state.head = head;
  if (hChanged) {
    const A = frag(prev?.h || ''), B = frag(head.h);
    const ab = [...A.querySelectorAll('b')], bb = [...B.querySelectorAll('b')];
    if (prev && ab.length === bb.length && skeleton(A) === skeleton(B)) {
      // the route entrance split the h1 into line boxes: put the same sentence back unsplit (no visible change)
      if (h1.children.length !== A.children.length || [...h1.children].some(c => c.nodeName !== 'B')) h1.innerHTML = prev.h;
      const live = [...h1.querySelectorAll('b')];
      bb.forEach((b, i) => {
        if (!live[i] || live[i].textContent === b.textContent) return;
        dip(live[i], () => {
          const now = frag(state.head.h), nb = [...now.querySelectorAll('b')];
          if (nb.length === live.length && skeleton(now) === skeleton(frag(h1.innerHTML))) live[i].textContent = nb[i].textContent;
          else h1.innerHTML = state.head.h;
        });
      });
    } else dip(h1, () => { h1.innerHTML = state.head.h; });
  }
  if (lChanged) dip(lede, () => { lede.innerHTML = state.head.l; });
}
/** Topic chips keyed by value: kept chips update in place and move; new ones fade in. */
function patchChips(el, state) {
  const bar = el.querySelector('[data-fd-topics]'); if (!bar) return;
  const topics = (state.settings.priorities || []).filter(p => p.weight > 0).map(p => p.topic);
  const have = new Map([...bar.querySelectorAll('[data-fd="topic"], [data-fd="topic-more"]')].map(b => [b.dataset.v, b]));
  const next = chipsData(state, topics).map(c => {
    let b = have.get(c.v);
    if (b && c.more) {
      have.delete(c.v);
      if (b.textContent !== c.label) b.textContent = c.label;
      b.setAttribute('aria-expanded', String(!!c.open)); b.title = c.title;
    } else if (b) {
      have.delete(c.v);
      b.setAttribute('aria-pressed', String(c.pressed));
      const n = b.querySelector('.fd-n'); if (n && c.n != null && n.textContent !== String(c.n)) n.textContent = c.n;
    } else {
      const t = document.createElement('template'); t.innerHTML = String(chipHtml(c)); b = t.content.firstElementChild; fadeIn(b);
    }
    return b;
  });
  have.forEach(b => b.remove());
  // keep the focused chip in place (re-inserting it would drop focus)
  if (next.some((b, i) => bar.children[i] !== b) || bar.children.length !== next.length) bar.replaceChildren(...next);
  el.querySelector('.fd-arch')?.setAttribute('aria-pressed', String(state.st.status === 'archived'));
}

/** Body swap when one side has no list (empty states): the old content fades out (140 ms), the new fades in (240 ms). */
async function replaceBody(el, state, head, st) {
  const bodyEl = el.querySelector('[data-fd-body]');
  const body = bodyHtml(state, head);
  state.restToken = null;
  if (!reduced() && bodyEl.firstElementChild) {
    const out = bodyEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE.exit, fill: 'forwards' });
    await out.finished.catch(() => {});
    if (state.st !== st) return;
    bodyEl.innerHTML = body.html;
    out.cancel();
    fadeIn(bodyEl);
  } else bodyEl.innerHTML = body.html;
  if (body.rest) fillRest(el, state, body.rest); else armActs(el, state);
}

/**
 * Keyed list update (FD4). Rows are keyed by story id (the divider by "div"):
 *  - persisting rows keep opacity 1 and FLIP to their new place (transform, 240 ms, --ease-move, motion.js flip);
 *  - new rows on screen fade in (240 ms, 30 ms stagger, at most 6 steps);
 *  - leaving rows on screen fade out over 140 ms, lifted out of flow at their old place.
 * One read pass before the DOM changes, one after (flip's reads); nothing is rebuilt that didn't change.
 */
function reconcile(el, state, head, st) {
  const bodyEl = el.querySelector('[data-fd-body]');
  const listEl = bodyEl.querySelector('[data-fd-list]');
  const plan = listPlan(st, state.stories, state.T);
  if (!listEl || !plan.items.length) return replaceBody(el, state, head, st);
  state.restToken = null; // the old list's pending rows are superseded: every row is placed below
  // FIRST (reads): where each on-screen item is now
  const vh = innerHeight;
  const old = new Map();
  for (const n of listEl.children) if (n.dataset.key) old.set(n.dataset.key, n);
  const listTop = listEl.getBoundingClientRect().top;
  const first = new Map(), was = new Map(); // on-screen rects / every row's rect
  for (const [k, n] of old) { const r = n.getBoundingClientRect(); was.set(k, r); if (r.bottom > 0 && r.top < vh) first.set(k, r); }
  // writes: reuse unchanged nodes, build the rest (rows past REUSE_SYNC that aren't on screen arrive in the idle chunk)
  const keep = new Set(plan.items.map(it => it.key));
  const fresh = [];
  const parse = (markup) => { const t = document.createElement('template'); t.innerHTML = markup; return [...t.content.children]; };
  const nodes = [], later = [];
  const toBuild = [];
  plan.items.forEach((it, i) => {
    const n = old.get(it.key);
    if (n && (n.dataset.sig === it.sig || it.key === 'div')) {
      if (it.key === 'div' && n.dataset.sig !== it.sig) { n.textContent = it.text; n.dataset.sig = it.sig; }
      nodes.push(n); old.delete(it.key);
    } else if (i < REUSE_SYNC || first.has(it.key)) { const slot = { it }; nodes.push(slot); toBuild.push(slot); }
    else later.push(it);
  });
  if (toBuild.length) { const built = parse(toBuild.map(s => s.it.html()).join('')); toBuild.forEach((s, j) => { s.node = built[j]; fresh.push(built[j]); }); }
  const children = nodes.map(x => x.node || x);
  // leaving rows: on screen → lifted out of flow at their old place and faded; off screen → dropped
  const leaving = [];
  for (const [k, n] of old) {
    if (keep.has(k)) continue; // changed content: replaced by its rebuilt row
    const r = first.get(k);
    if (!r || reduced()) continue;
    n.classList.add('fd-leaving');
    n.style.top = `${(r.top - listTop).toFixed(1)}px`;
    leaving.push(n);
  }
  // the hover toolbar belongs to the old status's list when the status changed
  if (st.status !== state.listStatus) {
    listEl.querySelectorAll('[data-acts]').forEach(b => b.remove());
    const tpl = bodyEl.querySelector('template[data-acts-home]');
    if (tpl) tpl.innerHTML = String(actsHtml(st.status === 'archived'));
    state.listStatus = st.status;
  }
  listEl.replaceChildren(...children, ...leaving);
  const foot = bodyEl.querySelector('[data-fd-foot]'), footNext = footHtml(st, plan.hidden);
  if (foot && !footNext) foot.remove();
  else if (footNext && (!foot || foot.outerHTML !== footNext)) { const [f] = parse(footNext); if (foot) foot.replaceWith(f); else bodyEl.append(f); }
  // LAST (reads after the writes) + play
  if (!reduced()) {
    leaving.forEach(n => n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE.exit, fill: 'forwards' }).finished.then(() => n.remove(), () => n.remove()));
    let entering = 0;
    const freshSet = new Set(fresh);
    for (const n of children) {
      const k = n.dataset.key;
      const r = n.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) continue; // off screen now: nothing to play
      const from = !freshSet.has(n) && was.get(k);
      if (from) { // persisting: stays at full opacity and FLIPs (a row arriving from off screen slides at most 60% of the viewport)
        const cap = vh * 0.6, dy = Math.max(-cap, Math.min(cap, from.top - r.top));
        if (Math.abs(dy) > 0.5) flip(n, new DOMRect(from.left, r.top + dy, r.width, r.height), { duration: 240, easing: EASE.move }); // same size: translate only
        continue;
      }
      fadeIn(n, Math.min(entering++, 5) * 30);
    }
  } else leaving.forEach(n => n.remove());
  if (later.length) fillRest(el, state, () => parse(later.map(it => it.html()).join('')));
  else { clampCheck(el, state); releaseCv(el, state); armActs(el, state); }
}

async function update(el, state, patch) {
  const prev = state.st;
  const st = { ...prev, ...patch };
  state.st = st;
  history.replaceState(history.state, '', hashFor(st));
  const refetch = st.days !== prev.days || st.topic !== prev.topic || st.status !== prev.status;
  const bodyEl = el.querySelector('[data-fd-body]');
  // no dimming while fetching (rows that stay must stay at full opacity); aria-busy for assistive tech only
  if (refetch) {
    bodyEl.setAttribute('aria-busy', 'true');
    try {
      [state.stories, state.all] = await Promise.all([api.get(storiesUrl(st)), st.topic ? api.get(storiesUrl({ ...st, topic: '' })) : null]);
    } catch (e) { bodyEl.removeAttribute('aria-busy'); toast(e.message, 'err'); return; }
    state.status = state.stories.length ? null : await api.get('/status').catch(() => null);
    if (state.st !== st) return;
  }
  // header, chips and view bar: patched in place
  const head = headHtml(state);
  swapHead(el, state, head);
  patchChips(el, state);
  el.querySelectorAll('.fd-seg-btn').forEach(b => b.setAttribute('aria-checked', String(st[b.dataset.fd] === b.dataset.v)));
  const sel = el.querySelector('select[data-fd="min"]'); if (sel && sel.value !== st.min) sel.value = st.min;
  const sh = el.querySelector('.fd-showing'); if (sh) sh.textContent = showing(st, state.stories);
  bodyEl.removeAttribute('aria-busy');
  // the list: unchanged → untouched; otherwise reconciled by key
  const key = listKey(st, state.stories, state.T);
  if (key === state.key && state.stories.length) return;
  state.key = key;
  return state.stories.length ? reconcile(el, state, head, st) : replaceBody(el, state, head, st);
}

function wire(el, state) {
  on(el, 'click', '[data-fd]', async (e, b) => {
    const k = b.dataset.fd;
    const rowEl = b.closest('[data-row]');
    const id = rowEl?.dataset.id;
    if (k === 'topic') return update(el, state, { topic: b.dataset.v, status: '' });
    if (k === 'topic-more') { state.chipsOpen = !state.chipsOpen; patchChips(el, state); el.querySelector('[data-fd="topic-more"]')?.focus(); return; }
    if (k === 'archived') return update(el, state, { status: state.st.status ? '' : 'archived', topic: '' });
    if (k === 'days') return update(el, state, { days: b.dataset.v });
    if (k === 'sort') return update(el, state, { sort: b.dataset.v });
    if (k === 'add' || k === 'add-close') {
      const f = el.querySelector('[data-intake]');
      const open = k === 'add' && !f.classList.contains('open');
      f.classList.toggle('open', open);
      el.querySelectorAll('[data-fd="add"]').forEach(x => x.setAttribute('aria-expanded', String(open)));
      if (open) { f.querySelector('input')?.focus(); if (!reduced()) f.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.25,.1,.05,1)' }); }
      else el.querySelector('.page-head [data-fd="add"]')?.focus();
      return;
    }
    if (!id) return;
    if (k === 'draft') return act(b, async () => {
      const r = await api.post(`/stories/${id}/drafts`, { channel: 'linkedin', format: 'long' });
      toast('Draft created — opening Studio', 'ok');
      location.hash = `#/draft/${r.draft_id}`;
    });
    if (k === 'save') {
      if (b.getAttribute('aria-pressed') === 'true') { toast('Already saved — manage collections in the dossier.', ''); return; }
      return act(b, async () => {
        const saved = await api.post(`/stories/${id}/save`, { collection: DEFAULT_COLLECTION });
        b.setAttribute('aria-pressed', 'true');
        const s = state.stories.find(x => String(x.id) === id); if (s) s.collections = (saved || []).map(x => x.collection).join(',');
        const mine = (saved || []).find(x => x.collection === DEFAULT_COLLECTION);
        toast(`Saved to ${DEFAULT_COLLECTION}`, 'ok', mine ? { undo: { revert: async () => { await api.del(`/saved/${mine.id}`); b.setAttribute('aria-pressed', 'false'); if (s) s.collections = null; } } } : {});
      });
    }
    if (k === 'dismiss' || k === 'restore') {
      const to = k === 'dismiss' ? 'archived' : 'seen';
      strikeOut(rowEl, {
        message: k === 'dismiss' ? 'Dismissed. It’s under Archived.' : 'Restored to the feed.',
        commit: async () => { await api.patch(`/stories/${id}`, { status: to }); state.stories = state.stories.filter(x => String(x.id) !== id); }
      });
    }
  });
  on(el, 'change', 'select[data-fd="min"]', (e, s) => update(el, state, { min: s.value }));
  // whole row opens the dossier (the title link is the real control; clicking it records the flight source)
  on(el, 'click', '[data-row]', (e, r) => {
    if (e.target.closest('a, button, input, select, label')) return;
    if (getSelection()?.toString()) return;
    r.querySelector('a.fd-title')?.click();
  });
  // F-2: hover only toggles :hover styles (rows carry their toolbars, armActs). The dossier warm-up waits for hover
  // intent, the pointer resting 80 ms on one row, so a sweep across the list fetches nothing; a press warms at once.
  let hovT = 0;
  el.addEventListener('pointerover', (e) => {
    const r = e.target.closest?.('[data-row]');
    if (!r || r === el._hov) return;
    el._hov = r;
    clearTimeout(hovT);
    hovT = setTimeout(() => { if (el._hov !== r || !r.isConnected) return; placeActs(el, r, state); dossier.prefetch(r.dataset.id); }, 80);
  }, { passive: true });
  el.addEventListener('pointerleave', () => { clearTimeout(hovT); el._hov = null; }, { passive: true });
  el.addEventListener('pointerdown', (e) => { const r = e.target.closest?.('[data-row]'); if (r) dossier.prefetch(r.dataset.id); }, { passive: true });
  el.addEventListener('focusin', (e) => { const r = e.target.closest?.('[data-row]'); if (r && !e.target.closest('[data-acts]')) placeActs(el, r, state); });
  el.querySelector('[data-intake]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await act(e.target.querySelector('button[type=submit]'), async () => {
      const r = await api.post('/intake/url', { url: f.get('url'), evidence_kind: f.get('evidence_kind') });
      toast(r.created ? 'Story added' : 'Already collected — opening it', 'ok');
      location.hash = `#/story/${r.story_id}`;
    }, 'Fetching…');
  });
  // the dossier's Dismiss / Restore changes a row's status: drop it from this list
  const onStatus = (e) => {
    if (!el.isConnected) { document.removeEventListener('byline:story-status', onStatus); return; }
    const { id, status } = e.detail || {};
    const inList = (state.st.status === 'archived') === (status === 'archived');
    if (!inList) { state.stories = state.stories.filter(x => x.id !== id); el.querySelector(`[data-row][data-id="${id}"]`)?.remove(); }
    else api.get(storiesUrl(state.st), { fresh: true }).then(list => { state.stories = list; if (el.isConnected) fillRest(el, state, paint(el, state)); }).catch(() => {});
  };
  document.addEventListener('byline:story-status', onStatus);
  // a hash change that lands on a different Feed query while this page is current (the router skips it)
  const onHash = () => {
    if (!el.isConnected) { removeEventListener('hashchange', onHash); return; }
    if (!location.hash.startsWith('#/feed')) return;
    const next = params();
    if (JSON.stringify(next) !== JSON.stringify(state.st)) update(el, state, next);
  };
  addEventListener('hashchange', onHash);
}
