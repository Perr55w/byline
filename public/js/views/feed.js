// Feed (SPEC §5, F §2 Feed headline template, F §4 row anatomy). Every figure comes from /api/stories and
// /api/settings; the threshold is settings.publish_threshold. Story detail lives in the dossier overlay
// (views/story-dossier.js); each row is a dossier flight source (data-shared title / chip→ring / topic).
//
// Kept from v3: topic filter + Archived, Add story URL (POST /api/intake/url with evidence kind),
// score change since last viewed, "N new since you looked", saved collections, engagement note,
// keyboard rows (app.js j/k/Enter via [data-row]). New: min score, date range, sort, threshold divider,
// hover actions Draft / Save / Dismiss (Restore in Archived).

import { api } from '../api.js';
import { html, raw, esc, on, act, toast, icon, scoreChip, strikeOut, useStyle } from '../ui.js';
import { EASE, reduced } from '../motion.js';
import * as dossier from '../dossier.js';

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

// ------------------------------------------------------------------ row (F §4)
function row(s, T, cv = false) {
  const topics = s.topics || [];
  const main = s.main_topic || topics[0] || null;
  const second = topics.find(t => t !== main) || null;
  const below = s.score < T;
  const changed = s.viewed_score != null && Math.round(s.viewed_score) !== Math.round(s.score);
  const eng = Object.entries(s.breakdown?.engagement || {});
  const counts = countsLabel(s);
  return html`<article class="fd-row${below ? ' is-below' : ''}${cv ? ' cv-row' : ''}" data-row data-dossier-src data-id="${s.id}" data-score="${s.score}">
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
      <div class="fd-topics">${main ? html`<span class="chip chip--main" data-shared="topic">${main}</span>` : html`<span class="fd-none">No topic matched</span>`}${second ? html`<span class="chip chip--topic">${second}</span>` : ''}</div>
      <p class="fd-src" title="${counts}">${markers(s)}<span>${outletsLine(s)}</span><span class="sr-only">${s.source_line} (${counts})</span><span class="fd-age-m" aria-hidden="true">· ${age(s.updated_at)}</span></p>
    </div>
    <div class="fd-end">
      <time class="fd-age" datetime="${s.updated_at}" title="Updated ${fmt('full').format(new Date(s.updated_at))}">${age(s.updated_at)}</time>
    </div>
  </article>`;
}

/** One toolbar for the whole list (keeps per-row DOM small); it moves into the row under the pointer or focus. */
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
  if (!rowEl) return;
  let bar = el.querySelector('.fd-list [data-acts]');
  if (!bar) bar = el.querySelector('template[data-acts-home]')?.content.firstElementChild?.cloneNode(true);
  if (!bar || bar.parentElement === rowEl.querySelector('.fd-end')) return;
  rowEl.querySelector('.fd-end').append(bar);
  const s = state.stories.find(x => String(x.id) === rowEl.dataset.id);
  bar.setAttribute('aria-label', `Actions for ${s?.short_title || s?.title || 'story'}`);
  bar.querySelector('[data-fd="save"]')?.setAttribute('aria-pressed', String(!!s?.collections));
}

// CV_FROM: content-visibility only deep in long lists (All time, up to 200 rows). On a short list it saves little
// layout and makes full-page captures paint skipped rows as an empty band at the foot of the card (C, D).
const SYNC_ROWS = 12, STAGGER_CAP = 8, CV_FROM = 24;
/** Row ids + hidden count: when this key is unchanged a repaint leaves the list alone. */
const listKey = (st, stories, T) => `${T}|${st.sort}|${st.min}|${stories.map(s => `${s.id}:${s.score}`).join(',')}`;
/**
 * The list (F §4). Returns { html, rest }: the first SYNC_ROWS rows render now; the rest are markup strings
 * appended in one idle chunk (F6). Items past STAGGER_CAP live in `.fd-rest`, which enters as one block.
 */
function listHtml(st, stories, T) {
  let list = stories.filter(s => !st.min || s.score >= Number(st.min));
  const hidden = stories.length - list.length;
  if (st.sort === 'new') list = list.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (!stories.length) return { html: '', rest: null };
  if (!list.length) return { html: String(html`<div class="empty"><h3>Nothing at or above ${st.min}.</h3><p>${plural(hidden, 'story', 'stories')} in this range score lower. Lower the minimum score to see them.</p></div>`), rest: null };
  // items are thunks: rows past the first SYNC_ROWS are only built in the idle chunk
  const items = [];
  let divided = false, rows = 0, syncEnd = 0;
  const belowCount = list.filter(s => s.score < T).length;
  for (const s of list) {
    if (st.sort === 'score' && !divided && s.score < T) {
      divided = true;
      items.push(() => String(html`<div class="divider-label fd-divider" role="separator">Below your bar · ${T} — ${plural(belowCount, 'story', 'stories')}</div>`));
    }
    const cv = rows >= CV_FROM;
    items.push(() => String(row(s, T, cv)));
    if (++rows === SYNC_ROWS) syncEnd = items.length;
  }
  if (!syncEnd) syncEnd = items.length;
  const run = (fns) => fns.map(f => f()).join('');
  const head = items.slice(0, Math.min(STAGGER_CAP, syncEnd)), mid = items.slice(STAGGER_CAP, syncEnd);
  return {
    html: String(html`<div class="tile tile--static tile--flush fd-list" data-fd-list>${raw(run(head))}<div class="fd-rest" data-fd-rest>${raw(run(mid))}</div></div><template data-acts-home>${actsHtml(st.status === 'archived')}</template>
    ${hidden ? html`<p class="fd-foot">${plural(hidden, 'story', 'stories')} below ${st.min} hidden by the minimum score.</p>` : ''}`),
    rest: () => run(items.slice(Math.max(syncEnd, STAGGER_CAP)))
  };
}

const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 600 }) : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 32));
/** Append the deferred rows (one idle chunk), then check the finding clamps. */
function fillRest(el, state, rest) {
  const token = (state.restToken = {});
  idle(() => {
    if (state.restToken !== token || !el.isConnected) return;
    const more = rest?.();
    if (more) el.querySelector('[data-fd-rest]')?.insertAdjacentHTML('beforeend', more);
    clampCheck(el, state);
  });
}
/**
 * F2: findings clamp at 2 lines, or 3 when line 2 would cut through a highlighted figure. Reads mark
 * geometry in idle time (layout is clean by then), a few rows per chunk.
 */
function clampCheck(el, state) {
  const token = (state.clampToken = {});
  const todo = [...el.querySelectorAll('.fd-finding:not([data-clamp])')].filter(p => p.querySelector('mark'));
  const LH = 21;
  const step = (dl) => {
    if (state.clampToken !== token || !el.isConnected) return;
    const n3 = [];
    while (todo.length && (dl.didTimeout || dl.timeRemaining() > 2)) {
      const p = todo.shift();
      p.dataset.clamp = '2';
      const top = p.getBoundingClientRect().top;
      for (const m of p.querySelectorAll('mark')) {
        const r = m.getClientRects(); if (!r.length) continue;
        const a = Math.floor((r[0].top - top + 2) / LH), b = Math.floor((r[r.length - 1].bottom - top - 2) / LH);
        if (a <= 1 && b >= 2) { n3.push(p); break; }
      }
    }
    n3.forEach(p => { p.dataset.clamp = '3'; }); // writes after the reads
    if (todo.length) idle(step);
  };
  idle(step);
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
  // F6: rows past the first 12 arrive in one idle chunk once the page is on screen (byline:routed)
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

/** Topic chips: the priorities that appear in this date range, most stories first, with their counts. */
function topicCounts(state, topics) {
  const base = state.all || state.stories;
  const n = new Map(topics.map(t => [t, 0]));
  for (const s of base) for (const t of s.topics || []) if (n.has(t)) n.set(t, n.get(t) + 1);
  return [...n].filter(([t, c]) => c > 0 || t === state.st.topic).sort((a, b) => b[1] - a[1]);
}

function headHtml(state) {
  const { st, stories, T, settings } = state;
  const prioCount = (settings.priorities || []).filter(p => p.weight > 0).length;
  const head = headline(st, stories, T, state.status);
  return { eyebrow: `Ranked by your ${prioCount} priorities · bar ${T}`, h: String(html`${head.h}`), l: String(html`${head.l}`), raw: head };
}
function chipsData(state, topics) {
  const { st } = state;
  return [{ v: '', label: 'All', pressed: !st.topic && !st.status }, ...topicCounts(state, topics).map(([t, n]) => ({ v: t, label: t, n, pressed: st.topic === t && !st.status }))];
}
const chipHtml = (c) => html`<button type="button" class="chip chip--filter" data-fd="topic" data-v="${c.v}" aria-pressed="${c.pressed}">${c.label}${c.n != null ? html`<span class="fd-n">${c.n}</span>` : ''}</button>`;
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
  state.head = head; state.key = listKey(st, stories, T);
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
      <button type="button" class="chip chip--filter fd-arch" data-fd="archived" aria-pressed="${st.status === 'archived'}">Archived</button>
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
      <div class="fd-seg" role="radiogroup" aria-label="Date range">${DAYS.map(([k, l]) => html`<button type="button" role="radio" class="fd-seg-btn" data-fd="days" data-v="${k}" aria-checked="${st.days === k}">${l}</button>`)}</div>
      <div class="fd-seg" role="radiogroup" aria-label="Sort">${SORTS.map(([k, l]) => html`<button type="button" role="radio" class="fd-seg-btn" data-fd="sort" data-v="${k}" aria-checked="${st.sort === k}">${l}</button>`)}</div>
    </div>
  </div>
  <div class="fd-body" data-fd-body>${raw(body.html)}</div>`);
  return body.rest;
}

// ------------------------------------------------------------------ repaint in place (F5: no h1 flash, nothing vanishes at full opacity)
const fadeIn = (n) => { if (!reduced()) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade, fill: 'backwards' }); };
const skeleton = (root) => [...root.childNodes].map(n => (n.nodeType === 1 && n.tagName === 'B' ? '§' : n.textContent)).join('');
/**
 * Swap `node`'s figures to `next` (markup whose variable parts are <b>). Same sentence shape → only the
 * changed <b> texts change, each fading 0 → 1 over 240 ms; otherwise the markup is replaced and the new
 * figures fade. The node itself never changes opacity.
 */
function patchFigures(node, prev, next) {
  if (!node || prev === next) return;
  const t = document.createElement('template'); t.innerHTML = next;
  const was = document.createElement('template'); was.innerHTML = prev || '';
  const nb = [...t.content.querySelectorAll('b')], ob = [...was.content.querySelectorAll('b')];
  const live = [...node.querySelectorAll('b')];
  if (skeleton(t.content) === skeleton(was.content) && live.length === nb.length && nb.length === ob.length) {
    nb.forEach((b, i) => { if (b.textContent !== ob[i].textContent) { live[i].textContent = b.textContent; fadeIn(live[i]); } });
    return;
  }
  // after the entrance the h1 holds one .ln block per line: reuse the first (wrapping) and empty the rest, so
  // no line element is removed while visible
  const lns = node.querySelectorAll(':scope > .ln');
  if (lns.length) { lns[0].replaceChildren(t.content); lns[0].style.whiteSpace = 'normal'; for (let k = 1; k < lns.length; k++) lns[k].replaceChildren(); }
  else node.replaceChildren(t.content);
  [...node.querySelectorAll('b')].forEach((b, i) => { if (b.textContent !== ob[i]?.textContent) fadeIn(b); });
}
/** Topic chips keyed by value: kept chips update in place and move; new ones fade in. */
function patchChips(el, state) {
  const bar = el.querySelector('[data-fd-topics]'); if (!bar) return;
  const topics = (state.settings.priorities || []).filter(p => p.weight > 0).map(p => p.topic);
  const arch = bar.querySelector('.fd-arch');
  const have = new Map([...bar.querySelectorAll('[data-fd="topic"]')].map(b => [b.dataset.v, b]));
  const next = chipsData(state, topics).map(c => {
    let b = have.get(c.v);
    if (b) {
      have.delete(c.v);
      b.setAttribute('aria-pressed', String(c.pressed));
      const n = b.querySelector('.fd-n'); if (n && c.n != null && n.textContent !== String(c.n)) n.textContent = c.n;
    } else {
      const t = document.createElement('template'); t.innerHTML = String(chipHtml(c)); b = t.content.firstElementChild; fadeIn(b);
    }
    return b;
  });
  have.forEach(b => b.remove());
  bar.replaceChildren(...next, arch);
  arch.setAttribute('aria-pressed', String(state.st.status === 'archived'));
}

async function update(el, state, patch) {
  const prev = state.st;
  const st = { ...prev, ...patch };
  state.st = st;
  history.replaceState(history.state, '', hashFor(st));
  const refetch = st.days !== prev.days || st.topic !== prev.topic || st.status !== prev.status;
  const bodyEl = el.querySelector('[data-fd-body]');
  // while fetching, the list only dims (1 → .55 over 220 ms); it is faded out only once we know it changes
  let dim = null;
  if (refetch) {
    bodyEl.setAttribute('aria-busy', 'true');
    if (!reduced()) dim = bodyEl.animate([{ opacity: 1 }, { opacity: 0.55 }], { duration: 220, easing: EASE.fade, fill: 'forwards' });
    try {
      [state.stories, state.all] = await Promise.all([api.get(storiesUrl(st)), st.topic ? api.get(storiesUrl({ ...st, topic: '' })) : null]);
    } catch (e) { dim?.cancel(); bodyEl.removeAttribute('aria-busy'); toast(e.message, 'err'); return; }
    state.status = state.stories.length ? null : await api.get('/status').catch(() => null);
    if (state.st !== st) return;
  }
  // header, chips and view bar: patched in place
  const head = headHtml(state);
  patchFigures(el.querySelector('.page-head h1'), state.head?.h, head.h);
  patchFigures(el.querySelector('.page-head .lede'), state.head?.l, head.l);
  const eb = el.querySelector('.page-head .eyebrow'); if (eb && eb.textContent !== head.eyebrow) eb.textContent = head.eyebrow;
  state.head = head;
  patchChips(el, state);
  el.querySelectorAll('.fd-seg-btn').forEach(b => b.setAttribute('aria-checked', String(st[b.dataset.fd] === b.dataset.v)));
  const sel = el.querySelector('select[data-fd="min"]'); if (sel && sel.value !== st.min) sel.value = st.min;
  const sh = el.querySelector('.fd-showing'); if (sh) sh.textContent = showing(st, state.stories);
  // the list: unchanged → untouched; otherwise built first, then the body fades out (120 ms), swaps and fades
  // back in while the first 8 items and then the rest block rise (transform only: no opacity compounds)
  const key = listKey(st, state.stories, state.T);
  bodyEl.removeAttribute('aria-busy');
  if (key === state.key && state.stories.length) { dim?.reverse(); return; }
  state.key = key;
  const body = bodyHtml(state, head);
  if (!reduced()) {
    const from = dim ? Number(getComputedStyle(bodyEl).opacity) : 1;
    const out = bodyEl.animate([{ opacity: from }, { opacity: 0 }], { duration: Math.round(120 * from) + 20, easing: EASE.exit, fill: 'forwards' });
    dim?.cancel();
    await out.finished.catch(() => {});
    if (state.st !== st) return;
    bodyEl.innerHTML = body.html;
    bodyEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE.fade, fill: 'backwards' });
    out.cancel();
    const list = bodyEl.querySelector('[data-fd-list]');
    const items = list ? [...list.children].filter(n => n.tagName !== 'TEMPLATE') : [];
    items.forEach((n, i) => n.animate([{ transform: 'translateY(6px)' }, { transform: 'none' }], { duration: 480, delay: Math.min(i, STAGGER_CAP) * 30, easing: EASE.settle, fill: 'backwards' }));
  } else bodyEl.innerHTML = body.html;
  fillRest(el, state, body.rest);
}

function wire(el, state) {
  on(el, 'click', '[data-fd]', async (e, b) => {
    const k = b.dataset.fd;
    const rowEl = b.closest('[data-row]');
    const id = rowEl?.dataset.id;
    if (k === 'topic') return update(el, state, { topic: b.dataset.v, status: '' });
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
  el.addEventListener('pointerover', (e) => { const r = e.target.closest?.('[data-row]'); if (r && r !== el._hov) { el._hov = r; dossier.prefetch(r.dataset.id); placeActs(el, r, state); } }, { passive: true });
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
