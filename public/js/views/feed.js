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
import { enterItems, reduced } from '../motion.js';
import * as dossier from '../dossier.js';

const DEFAULT_COLLECTION = 'AI product management';
const DAYS = [['7', '7 days'], ['30', '30 days'], ['all', 'All time']];
const SORTS = [['score', 'Score'], ['new', 'Newest']];

// ------------------------------------------------------------------ helpers
const tz = () => window.__byline?.timezone || undefined;
const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz() });
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
function markers(s) {
  const fp = Math.min(8, (s.first_party || 0) + (s.primary || 0)), ind = Math.min(8, s.independent || 0), com = Math.min(8, s.commentary || 0);
  const more = (s.posts || 0) - fp - ind - com;
  const run = (k, n) => (n ? raw(`<i class="mkr mkr--${k}" style="--n:${n}"></i>`) : '');
  return html`<span class="fd-mks" aria-hidden="true">${run('fp', fp)}${raw('<i class="mk mk--ind"></i>'.repeat(ind))}${run('com', com)}${more > 0 ? html`<b>+${more}</b>` : ''}</span>`;
}

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
      h: total ? `${plural(total, 'archived story', 'archived stories')}.` : 'Nothing is archived.',
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
  if (st.topic) return { h: `${plural(total, `${st.topic} story`, `${st.topic} stories`)}; ${cleared.length} above ${T}.`, l: lede };
  return { h: `${cleared.length} of ${plural(total, 'story', 'stories')} ${when} ${cleared.length === 1 ? 'is' : 'are'} worth a post.`, l: lede };
}

// ------------------------------------------------------------------ row (F §4)
function row(s, T, archived) {
  const topics = s.topics || [];
  const main = s.main_topic || topics[0] || null;
  const second = topics.find(t => t !== main) || null;
  const below = s.score < T;
  const changed = s.viewed_score != null && Math.round(s.viewed_score) !== Math.round(s.score);
  const eng = Object.entries(s.breakdown?.engagement || {});
  const counts = `${(s.first_party || 0) + (s.primary || 0)} first-hand, ${s.independent || 0} independent, ${s.commentary || 0} commentary`;
  return html`<article class="fd-row${below ? ' is-below' : ''}" data-row data-dossier-src data-id="${s.id}" data-score="${s.score}">
    <div class="fd-score">${raw(String(scoreChip(s.score, T)).replace('<span class="score-chip"', '<span class="score-chip" data-shared="ring"'))}${changed ? html`<span class="fd-was" title="Score when you last opened it">was ${Math.round(s.viewed_score)}</span>` : ''}</div>
    <div class="fd-main">
      <h3 class="fd-h"><a class="fd-title" href="#/story/${s.id}" data-shared="title">${s.title}</a>${s.is_demo ? html` <span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}</h3>
      ${s.finding ? html`<p class="fd-finding">${marked(s.finding, s.finding_marks)}</p>` : ''}
      ${s.new_since_view || s.collections || eng.length ? html`<p class="fd-flags">
        ${s.new_since_view ? html`<span class="tag tag--ok">${s.new_since_view} new since you looked</span>` : ''}
        ${s.collections ? html`<span class="fd-saved">${icon('bookmark')}Saved: ${String(s.collections).split(',').join(', ')}</span>` : ''}
        ${eng.length ? html`<span class="fd-eng" title="Engagement is shown separately and does not count as evidence">engagement (not evidence): ${eng.map(([k, v]) => `${Number(v).toLocaleString()} ${k.replace('_count', 's')}`).join(' · ')}</span>` : ''}
      </p>` : ''}
    </div>
    <div class="fd-meta">
      <div class="fd-topics">${main ? html`<span class="chip chip--main" data-shared="topic">${main}</span>` : html`<span class="fd-none">No topic matched</span>`}${second ? html`<span class="chip chip--topic">${second}</span>` : ''}</div>
      <p class="fd-src" title="${counts}">${markers(s)}<span>${s.source_line}</span><span class="sr-only"> (${counts})</span><span class="fd-age-m" aria-hidden="true">· ${age(s.updated_at)}</span></p>
    </div>
    <div class="fd-end">
      <time class="fd-age" datetime="${s.updated_at}" title="Updated ${new Date(s.updated_at).toLocaleString('en-GB', { timeZone: tz() })}">${age(s.updated_at)}</time>
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

function listHtml(st, stories, T) {
  let list = stories.filter(s => !st.min || s.score >= Number(st.min));
  const hidden = stories.length - list.length;
  if (st.sort === 'new') list = list.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (!stories.length) return '';
  if (!list.length) return html`<div class="empty"><h3>Nothing at or above ${st.min}.</h3><p>${plural(hidden, 'story', 'stories')} in this range score lower. Lower the minimum score to see them.</p></div>`;
  const out = [];
  let divided = false;
  const belowCount = list.filter(s => s.score < T).length;
  list.forEach((s, i) => {
    if (st.sort === 'score' && !divided && s.score < T) {
      divided = true;
      out.push(html`<div class="divider-label fd-divider" role="separator">Below your bar · ${T} — ${plural(belowCount, 'story', 'stories')}</div>`);
    }
    out.push(row(s, T, st.status === 'archived'));
    void i;
  });
  return html`<div class="tile tile--static tile--flush fd-list" data-fd-list>${out}</div><template data-acts-home>${actsHtml(st.status === 'archived')}</template>
    ${hidden ? html`<p class="fd-foot">${plural(hidden, 'story', 'stories')} below ${st.min} hidden by the minimum score.</p>` : ''}`;
}

// ------------------------------------------------------------------ page
export async function render(view, ctx = {}) {
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
  paint(el, state);
  wire(el, state, topics);
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

function paint(el, state) {
  const { st, stories, T, settings } = state;
  const topics = (settings.priorities || []).filter(p => p.weight > 0).map(p => p.topic);
  const head = headline(st, stories, T, state.status);
  const prioCount = (settings.priorities || []).filter(p => p.weight > 0).length;
  el.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Ranked by your ${prioCount} priorities · bar ${T}</p>
    <h1>${head.h}</h1>
    <p class="lede">${head.l}</p>
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
    <div class="fd-topicbar" role="group" aria-label="Filter by topic">
      <button type="button" class="chip chip--filter" data-fd="topic" data-v="" aria-pressed="${!st.topic && !st.status}">All</button>
      ${topicCounts(state, topics).map(([t, n]) => html`<button type="button" class="chip chip--filter" data-fd="topic" data-v="${t}" aria-pressed="${st.topic === t && !st.status}">${t}<span class="fd-n">${n}</span></button>`)}
      <button type="button" class="chip chip--filter fd-arch" data-fd="archived" aria-pressed="${st.status === 'archived'}">Archived</button>
    </div>
  </div>
  <div class="fd-viewbar">
    <p class="fd-showing">${showing(st, stories)}</p>
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
  <div class="fd-body" data-fd-body>${stories.length ? listHtml(st, stories, T) : html`<div class="empty"><h3>${head.h}</h3><p>${head.l}</p>${st.status === 'archived' ? html`<div class="cluster"><button type="button" class="btn btn--secondary" data-fd="archived">Back to the feed</button></div>` : html`<div class="cluster"><button type="button" class="btn btn--primary" data-fd="add">${icon('plus')}Add story URL</button>${st.days !== 'all' ? html`<button type="button" class="btn btn--secondary" data-fd="days" data-v="all">Show all time</button>` : ''}</div>`}</div>`}</div>`);
}

async function update(el, state, patch) {
  const prev = state.st;
  const st = { ...prev, ...patch };
  state.st = st;
  history.replaceState(history.state, '', hashFor(st));
  const refetch = st.days !== prev.days || st.topic !== prev.topic || st.status !== prev.status;
  if (refetch) {
    el.querySelector('[data-fd-body]')?.setAttribute('aria-busy', 'true');
    try {
      [state.stories, state.all] = await Promise.all([api.get(storiesUrl(st)), st.topic ? api.get(storiesUrl({ ...st, topic: '' })) : null]);
    } catch (e) { toast(e.message, 'err'); return; }
    state.status = state.stories.length ? null : await api.get('/status').catch(() => null);
    if (state.st !== st) return;
  }
  const focusKey = document.activeElement?.closest?.('[data-fd]') ? `${document.activeElement.dataset.fd}|${document.activeElement.dataset.v || ''}` : null;
  paint(el, state);
  if (focusKey) {
    const [k, v] = focusKey.split('|');
    el.querySelector(`[data-fd="${k}"]${k === 'min' ? '' : `[data-v="${CSS.escape(v)}"]`}`)?.focus({ preventScroll: true });
  }
  const rows = el.querySelectorAll('[data-fd-list] > *');
  enterItems([...rows].slice(0, 12), { stagger: 30, y: 6, duration: 480 });
  if (!reduced()) el.querySelector('.page-head h1')?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
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
    else api.get(storiesUrl(state.st), { fresh: true }).then(list => { state.stories = list; if (el.isConnected) paint(el, state); }).catch(() => {});
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
