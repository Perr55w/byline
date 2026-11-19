// Studio (v4): a distinct workshop. Same palette, but a solid writing surface, fewer chrome elements and a
// still, dimmed background (bg 'still', B table .20).
//
//   #/studio        drafts grouped by story, status + channel filters (with counts), F §2 Studio headline,
//                   a side column with the review queue, approved-but-unscheduled drafts, stories above your
//                   bar that have no draft yet, and the next open posting day.
//   #/draft/:id     the editor. A paper sheet holds the sections (each a textarea over a highlight mirror, so
//                   editorial flags are marked on the very sentence they refer to, numbered, with the note and
//                   its suggested fix directly under the section). An inspector with tabs keeps every v3
//                   capability: checks + approval (submit / approve / withdraw), schedule (approval-gated) and
//                   plan (date only), hold-to-publish (ui.holdToPress), mark published, metrics, exports,
//                   preview (LinkedIn / Instagram slides / video timeline + render), visual / media / video brief /
//                   narration recording, perspective notes + apply notes, sources + tag suggestions, versions
//                   (view / restore). The sheet footer adapts the story to another format and archives.
import { api } from '../api.js';
import { html, raw, esc, on, act, toast, status as statusTag, evChip, channelLabel, timeAgo, fmtDateTime, copy, download, svgToPng, fileToBase64, modal, confirmBox, scoreChip, icon, useStyle, holdToPress, threshold as liveThreshold } from '../ui.js';
import { enterItems, reduced, EASE } from '../motion.js';
import bg from '../bg.js';

const FORMATS = { linkedin: ['long', 'article', 'roundup', 'short'], instagram: ['carousel', 'reel', 'story'], video: ['explainer', 'trailer', 'demo', 'behind-the-scenes'] };
const ANGLES = [['tradeoff', 'Product tradeoff'], ['process', 'Business process'], ['experiment', 'Experiment I could run']];
const NOTE_KINDS = ['observation', 'disagreement', 'example', 'question'];
const METRICS = ['impressions', 'reach', 'reactions', 'comments', 'reposts', 'saves', 'clicks', 'profile_visits', 'meaningful_conversations'];
const FLAG_LABEL = { unsupported: 'Unsupported claim', stale: 'Stale sources', exaggeration: 'Exaggeration', first_person: 'First-person claim', affiliation: 'Affiliation wording', insider: 'Insider wording', motive: 'Assumed motive', private: 'Private detail', placeholder: 'Placeholder', thin_evidence: 'Thin evidence', tag: 'Tag', job_search: 'Job-search detail', hype: 'Hype' };
const flagLabel = (t) => FLAG_LABEL[t] || String(t || 'flag').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayShort = (ymd) => ymd ? new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) : '';
const STATUS_ORDER = ['in_review', 'draft', 'approved', 'scheduled', 'published', 'archived'];
const STATUS_LABEL = { all: 'All', in_review: 'In review', draft: 'Draft', approved: 'Approved', scheduled: 'Scheduled', published: 'Published', archived: 'Archived' };

const GLYPH = {
  linkedin: '<path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5"/>',
  instagram: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="3"/><circle cx="8" cy="8" r="2.4"/>',
  video: '<rect x="2.25" y="3.5" width="11.5" height="9" rx="2"/><path d="M7 6.3v3.4L9.8 8z" fill="currentColor" stroke="none"/>'
};
const glyph = (k) => raw(`<svg class="st-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[k] || GLYPH.linkedin}</svg>`);
const LOCK = raw('<svg class="st-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>');
const UNLOCK = raw('<svg class="st-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.9-.7"/></svg>');

// The workshop dims the still field to .20 (B table): a root class that follows the route.
document.addEventListener('byline:routed', (e) => document.documentElement.classList.toggle('st-workshop', ['studio', 'draft'].includes(e.detail?.key)));

useStyle('/css/v4/studio.css'); // warm on the shell's idle prefetch, so the first visit doesn't restyle the document mid-transition

export async function render(view, ctx) {
  await useStyle('/css/v4/studio.css');
  bg.setMode('still'); // the workshop: the field holds still (and dims to .20 in studio.css)
  const el = document.createElement('div');
  el.className = 'st';
  view.replaceChildren(el);
  if (ctx.name === 'draft' && ctx.params[0]) return editor(el, Number(ctx.params[0]));
  return list(el, ctx.params || []);
}

// ================================================================ list
// Deferred work waits until the router has swapped this page in (byline:routed names it) and two frames have
// painted, so it never lands in the swap frame. A fallback timer covers a missed event.
function afterSwap(el, fn, fallback = 1200) {
  let done = false;
  const run = () => {
    if (done) return; done = true;
    document.removeEventListener('byline:routed', onRouted); clearTimeout(t);
    if (el.isConnected) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { if (el.isConnected) fn(); }, 0)));
  };
  const onRouted = (e) => { if (e.detail?.page?.contains(el)) run(); };
  document.addEventListener('byline:routed', onRouted);
  const t = setTimeout(run, fallback);
}
const angleLabel = (a) => (ANGLES.find(x => x[0] === a) || [, a || ''])[1];
/** Consecutive identical paragraphs → [{ text, n }] (display only; the stored text is never changed). */
function collapseRuns(text) {
  const out = [];
  for (const p of String(text || '').split(/\n{2,}/)) {
    const k = p.trim();
    if (!k) continue;
    const last = out[out.length - 1];
    if (last && last.text.trim() === k) last.n++; else out.push({ text: p, n: 1 });
  }
  return out;
}
const hasRuns = (text) => collapseRuns(text).some(r => r.n > 1);

async function list(el, params) {
  const [drafts, st, found, slot] = await Promise.all([
    api.get('/drafts?all=1'),
    api.get('/status').catch(() => ({})),
    api.get('/search?type=stories&limit=200').catch(() => null),
    api.get('/slots/next?channel=linkedin').catch(() => ({}))
  ]);
  const th = st.threshold ?? liveThreshold();
  const stories = new Map((found?.stories || []).map(s => [s.id, s]));
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('byline-studio-filter') || '{}'); } catch (e) { return {}; } })();
  const F = { status: saved.status || 'all', channel: saved.channel || 'all', open: new Set() };
  const p0 = params[0] || '';
  if (STATUS_LABEL[p0]) F.status = p0;
  if (FORMATS[p0]) F.channel = p0;

  const live = drafts.filter(d => d.status !== 'archived');
  const open = live.filter(d => d.status !== 'published');
  const count = (pred) => live.filter(pred).length;
  const inReview = count(d => d.status === 'in_review'), approved = count(d => d.status === 'approved'), scheduled = count(d => d.status === 'scheduled');
  const byCh = (c) => open.filter(d => d.channel === c).length;
  const newest = (l) => [...l].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] || null;

  // the writing-surface card: the newest draft waiting on review; else the most recently edited open draft
  const leadRow = newest(live.filter(d => d.status === 'in_review')) || newest(open.filter(d => d.status === 'draft' || d.status === 'approved'));
  const lead = leadRow ? await api.get(`/drafts/${leadRow.id}`).catch(() => null) : null;

  // F §2 Studio headline + one-liner (first match wins), with honest fallbacks
  let h, l;
  if (!drafts.length) {
    const cleared = (found?.stories || []).filter(s => s.score >= th).length;
    h = 'No drafts yet.';
    l = html`Open a story and choose Draft a post; <b>${cleared}</b> ${cleared === 1 ? 'story is' : 'stories are'} above your bar.`;
  } else {
    h = inReview ? `${inReview} ${inReview === 1 ? 'draft is' : 'drafts are'} waiting on your review.`
      : approved ? `${approved} approved, ${scheduled ? `${scheduled} scheduled` : 'none scheduled'}.`
      : scheduled ? `${scheduled} scheduled, none waiting on review.`
      : `${open.length} drafts open, none approved yet.`;
    const tail = !approved && !scheduled ? html`None approved or scheduled yet.` : html`<b>${approved}</b> approved, <b>${scheduled}</b> scheduled.`;
    l = html`<b>${open.length}</b> open ${open.length === 1 ? 'draft' : 'drafts'}: <b>${byCh('linkedin')}</b> LinkedIn, <b>${byCh('instagram')}</b> Instagram, <b>${byCh('video')}</b> video. ${tail}`;
  }

  // ---- lead: title, a 3-line preview of the text, the approval checklist (existing approval data only), Open draft
  const leadHtml = () => {
    if (!lead) return '';
    const story = stories.get(lead.story_id);
    const advisory = lead.flags.length - lead.blocking;
    const body = lead.sections.filter(s => !['sources', 'caption'].includes(s.kind)).map(s => collapseRuns(s.text).map(r => r.text.trim()).join('\n')).filter(Boolean).join('\n');
    const waiting = lead.status === 'in_review';
    return html`<article class="st-lead" aria-labelledby="st-lead-t">
      <div class="st-lead-main">
        <p class="st-lead-k">${glyph(lead.channel)}<span>${waiting ? 'Waiting on your review' : 'Latest draft'} · ${channelLabel(lead.channel, lead.format)} · edited ${timeAgo(lead.updated_at)}</span></p>
        <h2 class="st-lead-t" id="st-lead-t"><a href="#/draft/${lead.id}">${lead.title || 'Untitled'}</a></h2>
        <p class="st-lead-x">${body || 'No text yet.'}</p>
        <div class="st-lead-acts">
          <a class="btn btn--primary" href="#/draft/${lead.id}">Open draft ${icon('arrow-right')}</a>
          ${story ? html`<a class="st-lead-story" href="#/story/${story.id}">${scoreChip(story.score, th)}<span>Story</span></a>` : ''}
        </div>
      </div>
      <div class="st-lead-side">
        <h3 class="st-lead-h">Before it can be approved</h3>
        <ul class="st-checklist" aria-label="Approval checklist">
          <li class="${lead.blocking ? 'is-err' : 'is-ok'}">${lead.blocking ? `${plural(lead.blocking, 'blocking flag')} to resolve` : 'No blocking flags'}</li>
          <li class="${advisory ? 'is-warn' : 'is-ok'}">${advisory ? `${plural(advisory, 'advisory flag')} to review` : 'No advisory flags'}</li>
          ${lead.channel === 'linkedin' ? html`<li class="${lead.image ? (lead.image.alt ? 'is-ok' : 'is-warn') : 'is-warn'}">${lead.image ? `Image attached${lead.image.alt ? ' with alt text' : ', alt text missing'}` : 'No image attached'}</li>` : ''}
          <li class="${lead.approval_valid ? 'is-ok' : ''}">${lead.approval_valid ? `Approved ${timeAgo(lead.approved_at)}` : 'Not approved yet'}</li>
          <li class="${lead.planned_date ? 'is-ok' : ''}">${lead.planned_date ? `Planned for ${dayShort(lead.planned_date)}` : 'No date planned'}</li>
        </ul>
        <p class="st-lead-note">Approval covers this exact text${lead.channel === 'video' ? ' and media' : ' and image'}. You approve it in the draft.</p>
      </div>
    </article>`;
  };

  const rowHtml = (d, grouped, common) => {
    const story = stories.get(d.story_id);
    const name = grouped ? channelLabel(d.channel, d.format) : (d.title || 'Untitled');
    const showAngle = d.angle && (!grouped || d.angle !== common);
    const date = d.status === 'published' && d.published_at ? html`<span class="st-k">Published</span> ${dayShort(d.published_at.slice(0, 10))}`
      : d.planned_date ? html`<span class="st-k">Planned</span> ${dayShort(d.planned_date)}` : null;
    return html`<li class="st-row${grouped ? '' : ' st-row--solo'}" data-row="${d.id}">
      ${glyph(d.channel)}
      <span class="st-row-main">
        <a class="st-row-t" href="#/draft/${d.id}" title="Draft #${d.id}">${name}<span class="sr-only">, draft #${d.id}</span></a>
        ${!grouped || showAngle ? html`<span class="st-row-m">${grouped ? '' : html`${channelLabel(d.channel, d.format)}${showAngle || story ? ' · ' : ''}`}${showAngle ? `Angle: ${angleLabel(d.angle)}` : ''}${!grouped && story ? html`${showAngle ? ' · ' : ''}story ${Math.round(story.score)}` : ''}</span>` : ''}
      </span>
      ${statusTag(d.status)}
      <span class="st-row-plan">${date || (d.status !== 'published' ? html`<button type="button" class="st-plan xbtn" data-plan="${d.id}" aria-label="Plan a date for ${name} (draft #${d.id})">${icon('calendar')}Plan</button>` : '')}</span>
      <span class="st-row-u"><time datetime="${d.updated_at}">${timeAgo(d.updated_at)}</time></span>
      <span class="st-row-go" aria-hidden="true">${icon('arrow-right')}</span>
    </li>`;
  };

  // start/end slice the ordered groups: the first renders with the page, the rest right after the swap
  function rowsHtml(start = 0, end = Infinity) {
    const shown = drafts.filter(d => (F.status === 'all' ? d.status !== 'archived' : d.status === F.status) && (F.channel === 'all' || d.channel === F.channel));
    if (!shown.length) return start ? '' : html`<div class="empty st-empty"><h3>${drafts.length ? 'Nothing matches these filters.' : 'No drafts yet.'}</h3><p>${drafts.length ? `${STATUS_LABEL[F.status]} · ${F.channel === 'all' ? 'all channels' : channelLabel(F.channel)}: 0 drafts. Clear a filter to see the other ${live.length}.` : 'Open a story in the Feed or the Map and choose Draft a post. Drafts keep their sources attached.'}</p></div>`;
    const groups = new Map();
    for (const d of shown) { const k = d.story_id ? `s${d.story_id}` : d.project_id ? `p${d.project_id}` : `d${d.id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
    const ordered = [...groups.entries()].sort((a, b) => {
      const rank = (l) => Math.min(...l.map(d => STATUS_ORDER.indexOf(d.status)));
      return rank(a[1]) - rank(b[1]) || Date.parse(b[1][0].updated_at) - Date.parse(a[1][0].updated_at);
    });
    return html`${ordered.slice(start, end).map(([k, list], i) => { const gi = start + i;
      list.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
      const story = stories.get(list[0].story_id);
      const cv = gi > 3 ? ' cv' : ''; // long lists only: a full-page capture still shows the first groups
      if (list.length === 1 && !story) return html`<section class="st-group st-group--solo${cv}"><ul class="st-rows" role="list">${rowHtml(list[0], false)}</ul></section>`;
      const by = list.reduce((m, d) => { m[d.channel] = (m[d.channel] || 0) + 1; return m; }, {});
      const angles = list.reduce((m, d) => { if (d.angle) m[d.angle] = (m[d.angle] || 0) + 1; return m; }, {});
      const common = Object.entries(angles).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const expanded = F.open.has(k) || list.length <= 6;
      const title = story ? story.title : list[0].title;
      return html`<section class="st-group${cv}" aria-label="${story?.short_title || list[0].title}">
        <header class="st-group-h">
          <div class="st-group-tx">
            <h2 class="st-group-t">${story ? html`<a href="#/story/${story.id}">${title}</a>` : title}${story?.is_demo ? html` <span class="tag tag--demo">Demo</span>` : ''}</h2>
            <p class="st-group-m">${plural(list.length, 'draft')}: ${Object.entries(by).map(([c, n]) => `${n} ${channelLabel(c)}`).join(', ')}${common ? html` · Angle: ${angleLabel(common)}` : ''}${story ? html` · ${story.main_topic ? html`<span class="chip chip--topic">${story.main_topic}</span>` : ''} ${story.source_line}` : ''}</p>
          </div>
          ${story ? scoreChip(story.score, th) : ''}
        </header>
        <ul class="st-rows" role="list">${(expanded ? list : list.slice(0, 5)).map(d => rowHtml(d, true, common))}</ul>
        ${list.length > 6 ? html`<button type="button" class="st-more xbtn" data-more="${k}" aria-expanded="${expanded}">${expanded ? 'Show fewer' : `Show ${list.length - 5} more drafts from this story`}</button>` : ''}
      </section>`;
    })}`;
  }

  // one compact filter bar: status and channel as two small segmented groups on one row
  const fBtn = (kind, key, label, n) => html`<button type="button" class="st-f xbtn" data-f="${kind}" data-v="${key}" aria-pressed="${F[kind] === key}">${label}${n != null ? html`<span class="st-f-n">${n}</span>` : ''}</button>`;
  const filtersHtml = () => html`
    <div class="st-filters" role="group" aria-label="Filter drafts">
      <div class="st-fgroup" role="group" aria-label="Status">${fBtn('status', 'all', 'All', live.length)}${STATUS_ORDER.map(s => { const n = drafts.filter(d => d.status === s).length; return n || F.status === s ? fBtn('status', s, STATUS_LABEL[s], n) : ''; })}</div>
      <span class="st-fsep" aria-hidden="true"></span>
      <div class="st-fgroup" role="group" aria-label="Channel">${[['all', 'All channels'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['video', 'Video']].map(([k, lb]) => fBtn('channel', k, lb, k === 'all' ? null : drafts.filter(d => d.channel === k && d.status !== 'archived').length))}</div>
    </div>`;

  // side column: what else needs you, and what you could write next
  const queue = live.filter(d => d.status === 'in_review' && d.id !== lead?.id);
  const approvedUns = live.filter(d => d.status === 'approved' && !d.planned_date && d.id !== lead?.id);
  const drafted = new Set(drafts.map(d => d.story_id).filter(Boolean));
  const ready = [...stories.values()].filter(s => s.score >= th && !drafted.has(s.id) && s.status !== 'archived').sort((a, b) => b.score - a.score);
  const sideItem = (d) => html`<li><a class="st-side-row" href="#/draft/${d.id}" title="Draft #${d.id}">${glyph(d.channel)}<span class="st-side-t">${stories.get(d.story_id)?.title || d.title}<span class="st-side-m">${channelLabel(d.channel, d.format)} · ${timeAgo(d.updated_at)}</span></span></a></li>`;
  const sideHtml = html`
    ${queue.length || approvedUns.length || !lead ? html`<section class="tile tile--static st-side-tile" aria-labelledby="st-q-h">
      <h2 class="st-side-h" id="st-q-h">${lead ? 'Also waiting on your review' : 'Waiting on your review'} <span class="st-n">${queue.length}</span></h2>
      ${queue.length ? html`<ul class="st-side-list" role="list">${queue.slice(0, 5).map(sideItem)}</ul>${queue.length > 5 ? html`<button type="button" class="st-more xbtn" data-f="status" data-v="in_review">All ${queue.length} in review</button>` : ''}`
        : html`<p class="st-side-empty">Nothing else is waiting. Submit a draft for review from its Review tab.</p>`}
      ${approvedUns.length ? html`<h2 class="st-side-h">Approved, no date <span class="st-n">${approvedUns.length}</span></h2><ul class="st-side-list" role="list">${approvedUns.slice(0, 4).map(sideItem)}</ul>` : ''}
    </section>` : ''}
    <section class="tile tile--static st-side-tile" aria-labelledby="st-r-h">
      <h2 class="st-side-h" id="st-r-h">Above your bar, no draft yet <span class="st-n">${ready.length}</span></h2>
      ${ready.length ? html`<ul class="st-side-list" role="list">${ready.slice(0, 5).map(s => html`<li><a class="st-side-row st-side-row--story" href="#/story/${s.id}">${scoreChip(s.score, th)}<span class="st-side-t" data-shared="title">${s.title}${s.is_demo ? html` <span class="tag tag--demo">Demo</span>` : ''}<span class="st-side-m">${s.source_line}</span></span></a></li>`)}</ul>
        <p class="st-side-foot">Open one and choose Draft a post.</p>`
        : html`<p class="st-side-empty">Every story at or above ${th} already has a draft.</p>`}
    </section>
    <section class="tile tile--static st-side-tile st-side-slot">
      <h2 class="st-side-h">Next open posting day</h2>
      <p class="st-slot">${slot?.date ? html`<b>${dayShort(slot.date)}</b> for LinkedIn` : 'No open LinkedIn slot in the next 60 days.'}</p>
      <a class="st-side-link" href="#/calendar">Plan it in the Calendar ${icon('arrow-right')}</a>
    </section>`;

  el.innerHTML = String(html`
    <header class="page-head st-head">
      <p class="eyebrow">Studio</p>
      <h1>${h}</h1>
      <p class="lede">${l}</p>
    </header>
    <div class="st-list-layout" data-stagger>
      <div class="st-list-col">
        ${leadHtml()}
        <section class="tile tile--static tile--flush st-list" aria-label="Drafts">
          <div class="st-list-bar">${filtersHtml()}</div>
          <div class="st-groups">${rowsHtml(0, 1)}</div>
        </section>
      </div>
      <aside class="st-side" aria-label="Review queue and ideas"></aside>
    </div>`);

  let full = false; // the groups after the first two are in
  const repaint = () => {
    full = true;
    try { sessionStorage.setItem('byline-studio-filter', JSON.stringify({ status: F.status, channel: F.channel })); } catch (e) { /* storage unavailable */ }
    el.querySelector('.st-list-bar').innerHTML = String(filtersHtml());
    const g = el.querySelector('.st-groups');
    g.innerHTML = String(rowsHtml());
    if (!reduced()) enterItems([...g.querySelectorAll('.st-group')].slice(0, 6), { stagger: 30, y: 4, duration: 380, fadeDuration: 260 });
  };
  on(el, 'click', '[data-f]', (e, b) => { F[b.dataset.f] = b.dataset.v; repaint(); el.querySelector(`.st-list-bar [data-f="${b.dataset.f}"][data-v="${b.dataset.v}"]`)?.focus(); });
  on(el, 'click', '[data-more]', (e, b) => { const k = b.dataset.more; F.open.has(k) ? F.open.delete(k) : F.open.add(k); repaint(); el.querySelector(`[data-more="${k}"]`)?.focus(); });
  on(el, 'click', '[data-plan]', (e, b) => { e.preventDefault(); planDialog(drafts.find(d => d.id === Number(b.dataset.plan)), b, repaint); });
  // after the swap: the remaining groups and the side column (the side is still faded out by the router's entrance)
  afterSwap(el, () => {
    if (!full) { full = true; el.querySelector('.st-groups').insertAdjacentHTML('beforeend', String(rowsHtml(1))); }
    el.querySelector('.st-side').innerHTML = String(sideHtml);
    if (!reduced()) enterItems([...el.querySelectorAll('.st-group')].slice(0, 6), { stagger: 30, delay: 120, y: 6, duration: 460, fadeDuration: 320 });
  }, 400);
}

/** "Plan" on a row: choose a date for the draft (POST /drafts/:id/plan: the date only; status and approval stay). */
async function planDialog(d, opener, done) {
  if (!d) return;
  const slot = await api.get(`/slots/next?channel=${d.channel}`).catch(() => ({}));
  const m = modal(String(html`<h2>Plan a date</h2>
    <p class="st-muted">${d.title || 'Untitled'} · ${channelLabel(d.channel, d.format)}</p>
    <label class="field st-plan-field">Date<input class="input" type="date" id="st-plan-date" value="${slot?.date || ''}"></label>
    <p class="st-muted">Planning sets the calendar date only. Scheduling for publishing still needs approval in the draft.</p>
    <div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button type="button" class="btn btn--primary" id="st-plan-go">Plan for this date</button></div>`));
  m.el.querySelector('#st-plan-go').onclick = (ev) => act(ev.target, async () => {
    const date = m.el.querySelector('#st-plan-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a date first.');
    const r = await api.post(`/drafts/${d.id}/plan`, { date });
    d.planned_date = date;
    m.close(); done();
    toast(`Planned for ${dayShort(date)}`, 'ok', { undo: { revert: async () => { await api.post(`/drafts/${d.id}/plan`, { date: r.previous_date ?? null }); d.planned_date = r.previous_date ?? null; done(); } } });
  }, 'Planning…');
  void opener;
}

// ================================================================ slide rendering (Instagram)
function wrap(text, max) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) { if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) out.push(line);
  return out;
}
/**
 * Carousel slide (1080×1350) in the v4 Proof identity: white paper, ink, electric-blue accent, Newsreader
 * headline, Geist body, Geist Mono folio. Fonts are embedded at PNG export time (ui.svgToPng). These literal
 * colours are export artwork, not UI.
 */
export function slideSvg(text, i, n) {
  const C = { paper: '#FFFFFF', ink: '#0C0D10', ink2: '#4A4E57', ink3: '#62666F', accent: '#1F5EFF', rule: '#E4E7EC' };
  const [head, ...rest] = String(text).split('\n');
  const body = rest.join(' ').trim();
  const headSize = head.length > 60 ? 70 : head.length > 36 ? 86 : 104;
  const headLines = wrap(head, Math.floor(1560 / headSize));
  const bodyLines = wrap(body, 32);
  const bodySize = bodyLines.length > 6 ? 40 : 46;
  let y = body ? 400 : 675 - (headLines.length * headSize * 1.02) / 2 + headSize;
  const t = headLines.map(l => { const r = `<text x="90" y="${y}" font-family="'Newsreader', Georgia, serif" font-weight="420" font-size="${headSize}" letter-spacing="-2" fill="${C.ink}">${esc(l)}</text>`; y += headSize * 1.04; return r; }).join('');
  y += 46;
  const b = bodyLines.map(l => { const r = `<text x="90" y="${y}" font-family="'Geist', Arial, sans-serif" font-size="${bodySize}" fill="${C.ink2}">${esc(l)}</text>`; y += bodySize * 1.4; return r; }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<rect width="1080" height="1350" fill="${C.paper}"/>
<rect x="90" y="150" width="40" height="6" rx="3" fill="${C.accent}"/>
<text x="148" y="160" font-family="'Geist Mono', monospace" font-size="26" letter-spacing="2" fill="${C.ink3}">${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</text>${t}${b}
<line x1="90" y1="1200" x2="990" y2="1200" stroke="${C.rule}" stroke-width="2"/>
<text x="90" y="1262" font-family="'Geist', Arial, sans-serif" font-weight="600" font-size="26" letter-spacing="3" fill="${C.ink2}">${i === n - 1 ? 'SOURCES IN CAPTION' : 'SWIPE →'}</text>
<text x="990" y="1264" text-anchor="end" font-family="'Newsreader', Georgia, serif" font-weight="560" font-size="40" fill="${C.ink}">Byline</text></svg>`;
  const issues = [];
  if (text.length > 170) issues.push(`${text.length} chars — aim for under 170 per slide`);
  if (bodyLines.length > 8) issues.push('Too many body lines; split the slide');
  if (y > 1170) issues.push('Text runs into the footer');
  return { svg, issues };
}

// ================================================================ editor
async function editor(el, id) {
  let d = await api.get(`/drafts/${id}`);
  let images = await api.get('/images').catch(() => []);
  const th = liveThreshold();
  const saveTimers = {};
  const ui = { expanded: new Set(), tab: (() => { try { return sessionStorage.getItem('byline-st-tab') || 'review'; } catch (e) { return 'review'; } })() };
  if (!['review', 'preview', 'notes', 'media', 'sources', 'history'].includes(ui.tab)) ui.tab = 'review';

  // ---- flags: numbered once, in document order (section flags first, by section order; then general checks)
  const numbered = () => {
    const order = new Map(d.sections.map((s, i) => [s.id, i]));
    return d.flags.map((f, i) => ({ ...f, i })).sort((a, b) => (order.get(a.section_id) ?? 999) - (order.get(b.section_id) ?? 999) || a.i - b.i).map((f, k) => ({ ...f, n: k + 1 }));
  };
  const sectionFlags = (sid) => numbered().filter(f => f.section_id === sid);
  const sectionLabel = (sid) => d.sections.find(s => s.id === sid)?.label || sid;

  /** The highlight mirror under a textarea: flagged sentences become numbered <mark>s at the same glyph positions. */
  function mirrorHtml(text, flags) {
    const ranges = [];
    for (const f of flags) { if (!f.sentence) continue; const at = text.indexOf(f.sentence); if (at >= 0) ranges.push([at, at + f.sentence.length, f]); }
    ranges.sort((a, b) => a[0] - b[0]);
    let out = '', pos = 0;
    for (const [a, b, f] of ranges) {
      if (a < pos) continue;
      out += esc(text.slice(pos, a)) + `<mark class="st-mk${f.blocking ? ' is-block' : ''}" data-n="${f.n}">${esc(text.slice(a, b))}</mark>`;
      pos = b;
    }
    return out + esc(text.slice(pos)) + '\n';
  }

  const flagNote = (f) => html`<li class="st-fn${f.blocking ? ' is-block' : ''}" data-n="${f.n}">
    <span class="st-fn-n" aria-hidden="true">${f.n}</span>
    <div class="st-fn-b">
      <p class="st-fn-h"><span class="st-fn-type">${flagLabel(f.type)}</span>${f.blocking ? html`<span class="tag tag--err">blocks approval</span>` : html`<span class="tag tag--warn">advisory</span>`}<span class="sr-only">, flag ${f.n}</span></p>
      <p class="st-fn-msg">${f.message}</p>
      ${f.suggestion ? html`<p class="st-fn-sug"><span class="st-k">Suggestion</span> ${f.suggestion}${f.sentence && f.section_id && ['exaggeration', 'motive'].includes(f.type) ? html` <button type="button" class="btn btn--secondary btn--sm" data-act="apply-fix" data-i="${f.i}">Apply</button>` : ''}</p>` : ''}
      ${f.evidence?.length ? html`<p class="st-fn-ev"><span class="st-k">Evidence</span> ${f.evidence.map(e => html`<a href="${e.url}" target="_blank" rel="noopener noreferrer">${e.domain || e.title}</a> `)}</p>` : ''}
    </div>
  </li>`;

  // Consecutive identical paragraphs (e.g. one perspective note applied three times) show once with a marker.
  // Display only: the textarea and the stored text keep every copy; "Show all" opens the full text to edit.
  const collapsedHtml = (s) => html`<div class="st-collapsed" data-collapsed="${s.id}">
    ${collapseRuns(s.text).map(r => html`<p class="st-collapsed-p">${r.text.trim()}${r.n > 1 ? html` <span class="st-rep" title="The stored text repeats this paragraph ${r.n} times in a row">repeated note ×${r.n}</span>` : ''}</p>`)}
    <p class="st-collapsed-k">Shown once here; the text itself still has every copy. <button type="button" class="st-collapsed-go xbtn" data-act="expand" data-id="${s.id}">Show all and edit</button></p>
  </div>`;
  const isCollapsed = (s) => !ui.expanded.has(s.id) && hasRuns(s.text);

  const sectionHtml = (s, i) => {
    const flags = sectionFlags(s.id);
    const isScene = s.kind === 'scene';
    const ro = s.locked ? raw('readonly') : '';
    const col = isCollapsed(s);
    return html`
    <section class="st-sec${s.locked ? ' is-locked' : ''}${flags.length ? ' is-flagged' : ''}${i > 1 ? ' cv' : ''}" id="sec-${s.id}" data-sec="${s.id}" aria-labelledby="lbl-${s.id}">
      <header class="st-sec-h">
        <h3 class="st-sec-l" id="lbl-${s.id}">${s.label}</h3>
        <span class="st-sec-flags">${flags.length ? html`<span class="tag ${flags.some(f => f.blocking) ? 'tag--err' : 'tag--warn'}">${plural(flags.length, 'flag')}</span>` : ''}</span>
        ${s.locked ? html`<span class="tag tag--neutral">locked</span>` : ''}
        <span class="st-sec-tools">
          <button type="button" class="btn btn--ghost btn--sm" data-act="lock" data-id="${s.id}" aria-pressed="${!!s.locked}" title="Locked sections survive regeneration">${s.locked ? LOCK : UNLOCK}${s.locked ? 'Unlock' : 'Lock'}</button>
          ${s.kind === 'humor_variant' ? html`<button type="button" class="btn btn--ghost btn--sm" data-act="use-humor" data-id="${s.id}" title="Swap this into the public hook">Use as hook</button>` : ''}
          <button type="button" class="btn btn--ghost btn--sm" data-act="rewrite" data-id="${s.id}" ${s.locked ? raw('disabled') : ''}>Rewrite</button>
        </span>
      </header>
      ${col ? collapsedHtml(s) : ''}
      <div class="st-field" ${col ? raw('hidden') : ''}>
        <div class="st-mirror" aria-hidden="true" data-mirror="${s.id}">${raw(mirrorHtml(s.text || '', flags))}</div>
        <textarea class="textarea st-text" rows="1" spellcheck="true" data-field="text" data-id="${s.id}" aria-labelledby="lbl-${s.id}" ${flags.length ? raw(`aria-describedby="fn-${s.id}"`) : ''} ${ro}>${s.text}</textarea>
      </div>
      ${isScene ? html`<div class="st-scene">
        <label class="field">On-screen text<input class="input" data-field="onscreen" data-id="${s.id}" value="${s.onscreen || ''}" ${ro}></label>
        <label class="field">Duration (s)<input class="input" type="number" min="1" max="60" data-field="duration" data-id="${s.id}" value="${s.duration || 4}" ${ro}></label>
        <label class="field">B-roll / shot idea<input class="input" data-field="broll" data-id="${s.id}" value="${s.broll || ''}" ${ro}></label>
        <label class="field">Media for this scene<select class="select" data-field="media_id" data-id="${s.id}" ${s.locked ? raw('disabled') : ''}>
          <option value="">Title card (no media)</option>
          ${images.filter(m => /^(image|video)\//.test(m.mime) && m.mime !== 'image/svg+xml').map(m => html`<option value="${m.id}" ${String(s.media_id) === String(m.id) ? raw('selected') : ''}>${m.mime.split('/')[0]} · ${m.attribution || m.filename}</option>`)}
        </select></label></div>` : ''}
      <ol class="st-fns" id="fn-${s.id}" aria-label="Flags in ${s.label}">${flags.map(flagNote)}</ol>
    </section>`;
  };

  // ---------------------------------------------------------------- inspector panels
  const checksHtml = () => {
    const all = numbered();
    const general = all.filter(f => !f.section_id);
    const advisory = d.flags.length - d.blocking;
    return html`
      <div class="st-checks-sum">
        <span class="st-big ${d.blocking ? 'is-err' : 'is-ok'}"><b>${d.blocking}</b> blocking</span>
        <span class="st-big"><b>${advisory}</b> advisory</span>
      </div>
      ${all.length ? html`<ol class="st-checks" role="list">${all.map(f => html`<li class="${f.blocking ? 'is-block' : ''}">
        <span class="st-fn-n" aria-hidden="true">${f.n}</span>
        <span class="st-check-t"><b>${flagLabel(f.type)}</b> ${f.section_id ? html`in ${sectionLabel(f.section_id)}` : html`<span class="st-k">whole draft</span>`}</span>
        ${f.section_id ? html`<button type="button" class="btn btn--ghost btn--sm" data-act="goto" data-id="${f.section_id}" data-n="${f.n}">Go to</button>` : ''}
      </li>`)}</ol>` : html`<p class="st-muted">No issues found. Checks cover unsupported claims, stale sources, exaggeration, first-person claims, affiliation/insider wording, motive assumptions and private details.</p>`}
      ${general.length ? html`<ol class="st-fns st-fns--general" aria-label="Checks on the whole draft">${general.map(flagNote)}</ol>` : ''}`;
  };

  const approvalHtml = () => {
    const pub = d.publisher;
    const planned = d.planned_date ? String(d.planned_date).slice(0, 10) : '';
    return html`
      <section class="st-block" aria-labelledby="st-ap-h">
        <div class="st-block-h"><h3 id="st-ap-h">Approval</h3>${statusTag(d.status)}</div>
        <ul class="st-checklist">
          <li class="${d.blocking ? 'is-err' : 'is-ok'}">${d.blocking ? `${plural(d.blocking, 'blocking flag')} to resolve` : 'No blocking flags'}</li>
          <li>${plural(d.flags.length - d.blocking, 'advisory flag')} to review</li>
          ${d.channel === 'linkedin' ? html`<li class="${d.image ? (d.image.alt ? 'is-ok' : 'is-warn') : 'is-warn'}">${d.image ? `Image attached${d.image.alt ? ' with alt text' : ' (alt text missing)'}` : 'No image attached'}</li>` : ''}
          <li>${d.approved_at && d.approval_valid ? `Approved ${timeAgo(d.approved_at)}` : 'Not approved'}. Approval covers this exact text${d.channel !== 'video' ? ' and image' : ' and media'}; any edit returns it to review.</li>
        </ul>
        <div class="cluster">
          ${d.status === 'draft' ? html`<button type="button" class="btn btn--secondary" data-act="submit">Submit for review</button>` : ''}
          ${!d.approval_valid ? html`<button type="button" class="btn btn--primary" data-act="approve" ${d.blocking ? raw('disabled') : ''}>Approve this version</button>` : html`<button type="button" class="btn btn--ghost" data-act="unapprove">Withdraw approval</button>`}
        </div>
      </section>
      ${d.status !== 'published' ? html`<section class="st-block" aria-labelledby="st-sc-h">
        <div class="st-block-h"><h3 id="st-sc-h">Date</h3><span class="st-k">${planned ? `planned ${dayShort(planned)}` : 'no date'}</span></div>
        <div class="st-date-row">
          <input class="input" type="date" id="sched-date" value="${planned}" aria-label="Date">
          <button type="button" class="btn btn--ghost btn--sm" data-act="next-slot">Next open slot</button>
        </div>
        <div class="cluster">
          <button type="button" class="btn btn--secondary btn--sm" data-act="plan" title="Change the planned date only; status and approval stay as they are">Plan for this date</button>
          ${planned ? html`<button type="button" class="btn btn--ghost btn--sm" data-act="unplan">Clear date</button>` : ''}
          ${d.approval_valid ? html`<button type="button" class="btn btn--primary btn--sm" data-act="schedule">Schedule for publishing</button>` : ''}
        </div>
        ${!d.approval_valid ? html`<p class="st-muted">Scheduling for publishing unlocks once this version is approved. Planning only sets the calendar date.</p>` : ''}
      </section>` : ''}
      <section class="st-block" aria-labelledby="st-pub-h">
        <div class="st-block-h"><h3 id="st-pub-h">Publish</h3></div>
        ${d.status === 'published' ? html`<p class="st-muted">Published ${fmtDateTime(d.published_at)}${d.publish_ref && d.publish_ref !== 'manual' ? ` · ${d.publish_ref}` : ' (marked manually)'}.</p>
          ${metricsHtml()}` : html`
          <p class="st-muted">${pub.available ? pub.note : `Direct publishing isn’t connected. ${pub.note}`}</p>
          <div class="st-pub">
            ${pub.available ? html`<button type="button" class="btn btn--primary btn--lg" data-act="publish" ${d.approval_valid ? '' : raw('disabled')}>Publish to ${channelLabel(d.channel)}</button>` : ''}
            <button type="button" class="btn btn--secondary" data-act="mark-published" ${d.approval_valid ? '' : raw('disabled')}>I posted it — mark as published</button>
          </div>
          ${!d.approval_valid ? html`<p class="st-muted">Both need an approved current version.</p>` : ''}`}
      </section>
      <section class="st-block" aria-labelledby="st-ex-h">
        <div class="st-block-h"><h3 id="st-ex-h">Export</h3></div>
        <div class="cluster">
          <button type="button" class="btn btn--secondary btn--sm" data-act="copy">Copy post text</button>
          ${d.image ? html`<button type="button" class="btn btn--secondary btn--sm" data-act="dl-image">Download image</button>` : ''}
          ${d.channel === 'instagram' ? html`<button type="button" class="btn btn--secondary btn--sm" data-act="dl-slides">Slides + caption</button>` : ''}
          <button type="button" class="btn btn--secondary btn--sm" data-act="dl-notes">Source notes</button>
        </div>
        <p class="st-muted">Exports never include your private notes.</p>
      </section>`;
  };

  const metricsHtml = () => html`<div class="st-metrics" data-metrics>
    <p class="st-k">Results (blank stays blank, never zero)</p>
    <div class="st-metrics-grid">${METRICS.map(m => html`<label class="field">${m.replace(/_/g, ' ')}<input class="input" type="number" min="0" step="1" data-m="${m}" value="${typeof d.metrics?.[m] === 'number' ? d.metrics[m] : ''}" placeholder="—"></label>`)}</div>
    <div class="cluster"><button type="button" class="btn btn--secondary btn--sm" data-act="save-metrics">Save results</button><a class="st-side-link" href="#/performance">Compare in Performance ${icon('arrow-right')}</a>
      ${d.metrics?.updated_at ? html`<span class="st-k">updated ${timeAgo(d.metrics.updated_at)}</span>` : ''}</div>
  </div>`;

  const notesHtml = () => html`
    <div class="st-block-h"><h3>My perspective</h3><span class="cluster"><button type="button" class="btn btn--secondary btn--sm" data-act="add-note">${icon('plus')}Add note</button><button type="button" class="btn btn--primary btn--sm" data-act="apply-notes">Apply notes to draft</button></span></div>
    <p class="st-muted">Notes are private by default. Tick “Use in draft” to let one appear in the public perspective section, then apply.</p>
    ${d.notes.length ? html`<ul class="st-notes" role="list">${d.notes.map(n => html`
      <li class="st-note${n.include ? ' is-in' : ''}" data-note="${n.id}">
        <textarea class="textarea" data-note-text="${n.id}" rows="2" aria-label="Note" placeholder="Rough notes, first-person observations, disagreements, examples…">${n.text}</textarea>
        <div class="st-note-bar">
          <select class="select" data-note-kind="${n.id}" aria-label="Kind">${NOTE_KINDS.map(k => html`<option ${n.kind === k ? raw('selected') : ''}>${k}</option>`)}</select>
          <label class="st-check"><input type="checkbox" class="switch" data-note-include="${n.id}" ${n.include ? raw('checked') : ''}> Use in draft (public)</label>
          <button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="del-note" data-id="${n.id}">Delete</button>
        </div>
      </li>`)}</ul>` : html`<p class="st-muted">No notes yet.</p>`}`;

  const tagsHtml = () => (d.tags || []).length ? html`<ul class="st-tags" role="list">${d.tags.map((t, i) => html`
    <li>
      <div class="st-tag-h"><b>@${t.name}</b><span class="tag ${t.recommended ? 'tag--ok' : 'tag--warn'}">${t.recommended ? 'recommended' : 'not recommended'}</span>
        <label class="st-check"><input type="checkbox" class="switch" data-tag="${i}" ${t.enabled ? raw('checked') : ''}> Use tag</label></div>
      <p class="st-quote">“${t.sentence}”</p>
      <p class="st-muted">${t.reason} ${t.source ? html`<a href="${t.source.url}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</p>
    </li>`)}</ul>` : html`<p class="st-muted">Suggestions appear when the draft names a target employer or a contact. You choose each tag; removing one never rewrites the post.</p>`;

  const sourcesHtml = () => html`
    <div class="st-block-h"><h3>Sources attached <span class="st-n">${d.articles.length}</span></h3></div>
    ${d.articles.length ? html`<ul class="st-srcs" role="list">${d.articles.map(a => html`<li>${evChip(a.evidence_kind)}<a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a><span class="st-dom">${a.domain}</span></li>`)}</ul>` : html`<p class="st-muted">No sources attached.</p>`}
    <div class="st-block-h st-gap"><h3>Tags</h3><button type="button" class="btn btn--secondary btn--sm" data-act="suggest-tags">Suggest tags</button></div>
    <div id="tags">${tagsHtml()}</div>`;

  const visualHtml = () => {
    const im = d.image;
    return html`
      ${im ? html`
        <img class="st-img" src="/media/${im.filename}" alt="${im.alt || ''}">
        <div class="cluster st-gap-s">${im.generated ? html`<span class="tag tag--neutral">Generated in Byline</span>` : html`<span class="tag tag--neutral">${im.origin === 'sourced' ? 'Sourced image' : 'Uploaded'}</span>`}
          ${im.origin === 'chart' ? html`<span class="tag tag--ok">chart from source-backed figures</span>` : ''}</div>
        <div class="st-form">
          <label class="field st-full">Alt text<textarea class="textarea" data-img-field="alt" rows="2">${im.alt || ''}</textarea></label>
          <label class="field">Attribution<input class="input" data-img-field="attribution" value="${im.attribution || ''}"></label>
          <label class="field">License<input class="input" data-img-field="license" value="${im.license || ''}"></label>
          <label class="field st-full">Original source<input class="input" data-img-field="source_url" value="${im.source_url || ''}"></label>
        </div>` : html`<div class="empty"><p>No image attached.</p></div>`}
      <div class="cluster st-gap-s">
        <button type="button" class="btn btn--secondary btn--sm" data-act="visual" data-kind="auto">Recommend visual</button>
        <button type="button" class="btn btn--secondary btn--sm" data-act="visual" data-kind="card">Text card</button>
        <button type="button" class="btn btn--secondary btn--sm" data-act="visual" data-kind="diagram">Diagram</button>
        <button type="button" class="btn btn--secondary btn--sm" data-act="upload">Upload image</button>
        <button type="button" class="btn btn--secondary btn--sm" data-act="import">From URL</button>
        <button type="button" class="btn btn--secondary btn--sm" data-act="library">Library</button>
        ${im ? html`<button type="button" class="btn btn--ghost btn--sm" data-act="no-image">Remove</button>` : ''}
      </div>`;
  };

  const videoBriefHtml = () => {
    const m = d.meta || {};
    return html`<div class="st-block-h"><h3>Video brief</h3></div>
    <div class="st-form">
      <label class="field">Audience<input class="input" data-meta="audience" value="${m.audience || ''}" placeholder="e.g. analytics hiring managers"></label>
      <label class="field">Purpose<input class="input" data-meta="purpose" value="${m.purpose || ''}" placeholder="e.g. explain a project result"></label>
      <label class="field">Platform<select class="select" data-meta="platform">${['Instagram Reels', 'LinkedIn video', 'YouTube Shorts', 'YouTube', 'TikTok'].map(p => html`<option ${m.platform === p ? raw('selected') : ''}>${p}</option>`)}</select></label>
      <label class="field">Target length (s)<input class="input" type="number" data-meta="length" value="${m.length || 30}"></label>
      <label class="field">Orientation<select class="select" data-meta="orientation">${['vertical', 'landscape'].map(o => html`<option ${m.orientation === o ? raw('selected') : ''}>${o}</option>`)}</select></label>
      <label class="field">Narration audio<select class="select" data-meta="narration_id"><option value="">None (silent + captions)</option>${images.filter(x => x.mime?.startsWith('audio/')).map(a => html`<option value="${a.id}" ${String(m.narration_id) === String(a.id) ? raw('selected') : ''}>${a.attribution || a.filename}</option>`)}</select></label>
    </div>
    <div class="cluster st-gap-s">
      <button type="button" class="btn btn--secondary btn--sm" data-act="upload-media">Upload footage / audio</button>
      <button type="button" class="btn btn--secondary btn--sm" data-act="record">Record narration</button>
      <button type="button" class="btn btn--primary btn--sm" data-act="render">Render preview MP4</button>
      <label class="st-check"><input type="checkbox" class="switch" id="burn" checked> Burn in captions</label>
    </div>
    <p class="st-muted">Media rights: ${images.filter(x => !x.generated).slice(0, 6).map(x => `${x.mime?.split('/')[0]} — ${x.attribution || 'unattributed'} (${x.license || 'no license'})`).join(' · ') || 'no uploads yet'}. Synthetic narration or likeness stays off unless you opt in under Settings.</p>`;
  };

  const previewHtml = () => {
    if (d.channel === 'linkedin') {
      const text = d.final_text;
      const short = text.length > 210 ? text.slice(0, 210).replace(/\s+\S*$/, '') : text;
      return html`<div class="st-li">
        <div class="st-li-head"><div class="st-li-av" aria-hidden="true">PW</div><div><div class="st-li-name">Perry Watson</div><div class="st-li-sub">AI product · analytics · KSU</div><div class="st-li-sub">now · public</div></div></div>
        <div class="st-li-body" id="li-body">${short}${text.length > 210 ? html`<button type="button" class="st-li-more xbtn" data-act="more">…see more</button>` : ''}</div>
        ${d.image ? html`<img class="st-li-img" src="/media/${d.image.filename}" alt="${d.image.alt || ''}">` : ''}
        <div class="st-li-bar" aria-hidden="true"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
      </div>
      <p class="st-k st-gap-s">${text.length} characters · the first ${Math.min(210, text.length)} show before “see more”</p>`;
    }
    if (d.channel === 'instagram') {
      const slides = d.sections.filter(s => ['slide', 'frame', 'beat', 'hook'].includes(s.kind));
      const rendered = slides.map((s, i) => ({ s, ...slideSvg(s.text, i, slides.length) }));
      return html`<div class="st-slides">${rendered.map(r => html`<figure><div class="st-slide">${raw(r.svg)}</div>
        <figcaption class="${r.issues.length ? 'is-warn' : ''}">${r.issues.length ? r.issues.join('; ') : `${r.s.label}: legible`}</figcaption></figure>`)}</div>
        <p class="st-k st-gap">Caption</p><pre class="st-code">${d.sections.find(s => s.kind === 'caption')?.text || ''}</pre>`;
    }
    if (d.channel === 'video') {
      const scenes = d.sections.filter(s => s.kind === 'scene');
      const total = scenes.reduce((m, s) => m + Number(s.duration || 0), 0);
      const renders = d.meta?.renders || [];
      return html`<div class="st-timeline" role="img" aria-label="${scenes.length} scenes, ${total} seconds">${scenes.map(s => html`<div style="flex:${s.duration || 1}" title="${s.label}">${s.duration}s</div>`)}</div>
        <p class="st-k st-gap-s">${scenes.length} scenes · ${total}s total · ${d.meta?.orientation || 'vertical'}</p>
        ${renders.length ? html`<video class="st-video" src="/media/${renders[0].mp4}" controls></video>
          <div class="cluster st-gap-s">
            <a class="btn btn--secondary btn--sm" href="/media/${renders[0].mp4}?download">MP4</a><a class="btn btn--secondary btn--sm" href="/media/${renders[0].thumbnail}?download">Thumbnail</a>
            <a class="btn btn--secondary btn--sm" href="/media/${renders[0].srt}?download">Subtitles (.srt)</a><a class="btn btn--secondary btn--sm" href="/media/${renders[0].caption}?download">Caption</a></div>
          <p class="st-muted">${renders[0].captions_burned ? 'Captions burned in; .srt included for platforms that support uploads.' : 'No system font found for burned-in text — use the .srt file.'}</p>`
          : html`<div class="empty"><p>Render a preview once your scenes and media are ready (Media tab).</p></div>`}`;
    }
    return html`<pre class="st-code">${d.final_text}</pre>`;
  };

  const versionsHtml = () => d.versions.length ? html`<ol class="st-vers" role="list">${d.versions.map(v => html`<li>
    <span class="st-ver-id">v${v.id}</span><span class="st-ver-n">${v.note}</span><time class="st-k" datetime="${v.created_at}">${timeAgo(v.created_at)}</time>
    <span class="cluster"><button type="button" class="btn btn--ghost btn--sm" data-act="view-version" data-id="${v.id}">View</button><button type="button" class="btn btn--secondary btn--sm" data-act="restore" data-id="${v.id}">Restore</button></span></li>`)}</ol>` : html`<p class="st-muted">No versions yet. Every save, rewrite and regeneration keeps the earlier text here.</p>`;

  const TABS = [['review', 'Review'], ['preview', 'Preview'], ['notes', 'Notes'], ['media', d.channel === 'video' ? 'Video' : 'Visual'], ['sources', 'Sources'], ['history', 'History']];
  const tabBadge = (k) => k === 'review' ? (d.blocking ? html`<span class="st-badge is-err">${d.blocking}</span>` : d.flags.length ? html`<span class="st-badge">${d.flags.length}</span>` : '')
    : k === 'notes' ? (d.notes.length ? html`<span class="st-badge">${d.notes.length}</span>` : '') : k === 'history' ? (d.versions.length ? html`<span class="st-badge">${d.versions.length}</span>` : '') : '';

  // ---------------------------------------------------------------- head (data one-liner)
  const words = () => (d.final_text.match(/\S+/g) || []).length;
  const ledeHtml = () => {
    const advisory = d.flags.length - d.blocking;
    const appr = d.status === 'published' ? html`Published ${timeAgo(d.published_at)}.` : d.approval_valid ? html`Approved ${timeAgo(d.approved_at)}${d.status === 'scheduled' && d.planned_date ? html`, scheduled for <b>${dayShort(d.planned_date)}</b>` : ''}.` : d.status === 'in_review' ? html`Waiting on your review.` : html`Not approved yet.`;
    return html`<b>${words()}</b> words, <b>${d.final_text.length}</b> characters${d.channel === 'linkedin' ? ' (210 show before “see more”)' : ''}. <b>${d.blocking}</b> blocking and <b>${advisory}</b> advisory ${d.flags.length === 1 ? 'flag' : 'flags'}. ${appr}${d.planned_date && d.status !== 'scheduled' && d.status !== 'published' ? html` Planned for <b>${dayShort(d.planned_date)}</b>.` : ''}`;
  };
  const metaHtml = () => {
    const sib = Object.values(d.siblings.reduce((g, x) => { const k = channelLabel(x.channel); (g[k] ||= { label: k, items: [] }).items.push(x); return g; }, {}));
    return html`${statusTag(d.status)}
      ${d.story_id ? html`<a class="st-meta-a" href="#/story/${d.story_id}" title="Story #${d.story_id}">Open the story${d.story?.score != null ? html` · score ${Math.round(d.story.score)}` : ''}</a>` : ''}
      ${d.project ? html`<a class="st-meta-a" href="#/career">Project: ${d.project.title}</a>` : ''}
      ${d.meta?.adapted_from ? html`<a class="st-meta-a" href="#/draft/${d.meta.adapted_from}">Adapted from #${d.meta.adapted_from}</a>` : ''}
      ${d.meta?.generated_by ? html`<span class="st-k">engine ${d.meta.generated_by}</span>` : ''}
      ${sib.length ? html`<span><span class="st-k">also from this story:</span> ${sib.map((g, k) => html`${k ? ', ' : ''}<a class="st-meta-a" href="#/draft/${g.items[0].id}">${g.label}${g.items.length > 1 ? ` ×${g.items.length}` : ''}</a>`)}</span>` : ''}`;
  };

  // inspector panes render on first show (only the open one is built with the page)
  const paneHtml = (k) => k === 'review' ? html`<section class="st-block" aria-labelledby="st-ck-h"><div class="st-block-h"><h3 id="st-ck-h">Editorial &amp; affiliation checks</h3></div><div id="flags">${checksHtml()}</div></section>
          <div id="approval">${approvalHtml()}</div>`
    : k === 'preview' ? html`<div id="preview">${previewHtml()}</div>`
    : k === 'notes' ? html`<div id="notes">${notesHtml()}</div>`
    : k === 'media' ? (d.channel === 'video' ? html`<div id="vbrief">${videoBriefHtml()}</div>` : html`<div class="st-block-h"><h3>Visual</h3></div><div id="visual">${visualHtml()}</div>`)
    : k === 'sources' ? html`<div id="sources">${sourcesHtml()}</div>`
    : html`<div class="st-block-h"><h3>Version history</h3></div><div id="versions">${versionsHtml()}</div>`;

  function paint({ first = false } = {}) {
    const long = (d.title || '').length > 70;
    el.innerHTML = String(html`
    <header class="page-head st-head st-head--ed">
      <p class="eyebrow"><a class="st-back" href="#/studio">Studio</a> / ${channelLabel(d.channel, d.format)} / draft #${d.id}</p>
      <h1 class="${long ? 'st-h1-long' : ''}">${d.title || 'Untitled'}</h1>
      <p class="lede" id="st-lede">${ledeHtml()}</p>
      <p class="st-meta" id="st-meta">${metaHtml()}</p>
      <div class="page-head-actions"><span class="st-save" id="st-save" aria-live="polite">${d.versions[0] ? `Saved ${timeAgo(d.versions[0].created_at)}` : 'Saved'}</span></div>
    </header>
    <div class="st-desk" data-stagger>
      <article class="st-sheet" aria-label="Draft text">
        <div class="st-sheet-bar" role="toolbar" aria-label="Draft settings">
          <label class="st-inline"><span>Format</span><select class="select" id="format">${(FORMATS[d.channel] || [d.format]).map(f => html`<option ${f === d.format ? raw('selected') : ''}>${f}</option>`)}</select></label>
          <label class="st-inline"><span>Angle</span><select class="select" id="angle">${ANGLES.map(([k, l]) => html`<option value="${k}" ${k === d.angle ? raw('selected') : ''}>${l}</option>`)}</select></label>
          <span class="st-bar-gap"></span>
          <button type="button" class="btn btn--secondary btn--sm" data-act="regen" title="Rewrites every unlocked section with this format and angle. Locked sections and your notes are kept; the earlier text goes to History." aria-describedby="st-regen-d">Regenerate unlocked</button>
          <span class="sr-only" id="st-regen-d">Locked sections and your notes survive every regeneration.</span>
        </div>
        ${d.flags.some(f => f.section_id) ? html`<p class="st-sheet-note">Flagged sentences are marked in the text; the numbered note sits under its section.</p>` : ''}
        <div id="sections">${(first ? d.sections.slice(0, 2) : d.sections).map(sectionHtml)}</div>
        <footer class="st-sheet-foot">
          <div>
            <h3 class="st-foot-h">Adapt to another format</h3>
            <p class="st-muted">Same story record and sources; facts preserved, hook and structure adapted. Notes are copied.</p>
            <div class="cluster">
              <button type="button" class="btn btn--secondary btn--sm" data-act="adapt" data-channel="linkedin" data-format="long">LinkedIn analysis</button>
              <button type="button" class="btn btn--secondary btn--sm" data-act="adapt" data-channel="instagram" data-format="carousel">IG carousel</button>
              <button type="button" class="btn btn--secondary btn--sm" data-act="adapt" data-channel="instagram" data-format="reel">IG Reel</button>
              <button type="button" class="btn btn--secondary btn--sm" data-act="adapt" data-channel="instagram" data-format="story">IG Story</button>
              <button type="button" class="btn btn--secondary btn--sm" data-act="adapt" data-channel="video" data-format="explainer">Video</button>
            </div>
          </div>
          <button type="button" class="btn btn--ghost btn--sm btn--danger st-archive" data-act="archive">${d.status === 'archived' ? 'Restore draft' : 'Archive draft'}</button>
        </footer>
      </article>
      <aside class="st-insp" aria-label="Inspector">
        <div class="st-tabs-wrap" data-fade="end"><div class="st-tabs" role="tablist" aria-label="Inspector">${TABS.map(([k, l]) => html`<button type="button" class="st-tab xbtn" role="tab" id="tab-${k}" aria-controls="pane-${k}" aria-selected="${ui.tab === k}" tabindex="${ui.tab === k ? 0 : -1}" data-tab="${k}">${l}<span data-badge="${k}">${tabBadge(k)}</span></button>`)}</div></div>
        <div class="st-insp-body">
        ${TABS.map(([k]) => html`<div class="st-pane" id="pane-${k}" role="tabpanel" aria-labelledby="tab-${k}" ${ui.tab !== k ? raw('hidden') : ''}>${ui.tab === k ? paneHtml(k) : ''}</div>`)}
        </div>
      </aside>
    </div>`);
    wireHold();
    wireTabs();
  }

  // the tab strip scrolls sideways when it doesn't fit; a 16px fade marks the clipped side (no tab is ever cut silently)
  function wireTabs() {
    const t = el.querySelector('.st-tabs'), w = t?.parentElement;
    if (!t) return;
    const upd = () => { const max = t.scrollWidth - t.clientWidth; w.dataset.fade = max <= 1 ? 'none' : t.scrollLeft <= 1 ? 'end' : t.scrollLeft >= max - 1 ? 'start' : 'both'; };
    t.addEventListener('scroll', upd, { passive: true }); // reads only on scroll: the initial state is the static "end" fade
  }

  function refreshPanels() {
    const set = (sel, v) => { const n = el.querySelector(sel); if (n) n.innerHTML = String(v); };
    set('#flags', checksHtml()); set('#approval', approvalHtml()); set('#preview', previewHtml()); set('#tags', tagsHtml()); set('#versions', versionsHtml());
    set('#st-lede', ledeHtml()); set('#st-meta', metaHtml());
    TABS.forEach(([k]) => set(`[data-badge="${k}"]`, tabBadge(k)));
    for (const s of d.sections) {
      const b = el.querySelector(`#sec-${CSS.escape(s.id)}`);
      if (!b) continue;
      const flags = sectionFlags(s.id);
      b.classList.toggle('is-flagged', flags.length > 0);
      const m = b.querySelector('.st-mirror'); if (m) m.innerHTML = mirrorHtml(b.querySelector('.st-text')?.value ?? s.text ?? '', flags);
      const fl = b.querySelector('.st-fns'); if (fl) fl.innerHTML = String(html`${flags.map(flagNote)}`);
      const fc = b.querySelector('.st-sec-flags'); if (fc) fc.innerHTML = flags.length ? String(html`<span class="tag ${flags.some(f => f.blocking) ? 'tag--err' : 'tag--warn'}">${plural(flags.length, 'flag')}</span>`) : '';
      const ta = b.querySelector('.st-text'); if (ta) { if (flags.length) ta.setAttribute('aria-describedby', `fn-${s.id}`); else ta.removeAttribute('aria-describedby'); }
    }
    wireHold();
  }

  const saveState = (t) => { const n = el.querySelector('#st-save'); if (n) n.textContent = t; };
  async function saveSections(note) {
    saveState('Saving…');
    d = await api.patch(`/drafts/${id}`, { sections: d.sections, note });
    refreshPanels();
    saveState('Saved just now');
  }
  const reload = async () => { d = await api.get(`/drafts/${id}`); paint(); };

  // first paint: the first two sections (the rest are below the fold, .cv) join right after the swap
  paint({ first: true });
  afterSwap(el, () => {
    const box = el.querySelector('#sections');
    if (box && box.children.length < d.sections.length) box.insertAdjacentHTML('beforeend', String(html`${d.sections.slice(box.children.length).map((x, i) => sectionHtml(x, i + box.children.length))}`));
    if (!reduced()) enterItems([...el.querySelectorAll('.st-sec')].slice(0, 6), { stagger: 40, delay: 120, y: 6, duration: 520, fadeDuration: 360 }); });

  // ---------------------------------------------------------------- tabs (roving, arrow keys)
  function showTab(k, { focus = false } = {}) {
    ui.tab = k;
    try { sessionStorage.setItem('byline-st-tab', k); } catch (e) { /* storage unavailable */ }
    el.querySelectorAll('.st-tab').forEach(t => {
      const on = t.dataset.tab === k; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      if (on) { if (focus) t.focus({ preventScroll: true }); const s = t.parentElement; const l = t.offsetLeft, r = l + t.offsetWidth; if (l < s.scrollLeft + 16 || r > s.scrollLeft + s.clientWidth - 16) s.scrollTo({ left: Math.max(0, l - 24), behavior: reduced() ? 'auto' : 'smooth' }); }
    });
    el.querySelectorAll('.st-pane').forEach(p => { const on = p.id === `pane-${k}`; p.hidden = !on; if (on && !p.firstElementChild) p.innerHTML = String(paneHtml(k)); if (on && !reduced()) p.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE.settle }); });
    wireHold();
  }
  on(el, 'click', '[data-tab]', (e, t) => showTab(t.dataset.tab));
  on(el, 'keydown', '.st-tab', (e, t) => {
    const keys = TABS.map(x => x[0]); const i = keys.indexOf(t.dataset.tab);
    const j = e.key === 'ArrowRight' ? (i + 1) % keys.length : e.key === 'ArrowLeft' ? (i - 1 + keys.length) % keys.length : e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : -1;
    if (j < 0) return; e.preventDefault(); showTab(keys[j], { focus: true });
  });

  // flag note ↔ mark: hovering or focusing a note lights its sentence
  const hot = (n, sec, onn) => sec?.querySelectorAll(`.st-mk[data-n="${n}"]`).forEach(m => m.classList.toggle('is-hot', onn));
  el.addEventListener('pointerover', (e) => { const fn = e.target.closest?.('.st-fn'); if (fn) hot(fn.dataset.n, fn.closest('.st-sec'), true); });
  el.addEventListener('pointerout', (e) => { const fn = e.target.closest?.('.st-fn'); if (fn && !fn.contains(e.relatedTarget)) hot(fn.dataset.n, fn.closest('.st-sec'), false); });

  // ---------------------------------------------------------------- inputs (autosave)
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.field) {
      const s = d.sections.find(x => x.id === t.dataset.id);
      if (!s) return;
      s[t.dataset.field] = t.dataset.field === 'duration' ? Number(t.value) : t.dataset.field === 'media_id' ? (t.value ? Number(t.value) : null) : t.value;
      if (t.dataset.field === 'text') { const m = el.querySelector(`[data-mirror="${CSS.escape(s.id)}"]`); if (m) m.innerHTML = mirrorHtml(t.value, sectionFlags(s.id)); }
      saveState('Unsaved changes');
      clearTimeout(saveTimers.sec);
      saveTimers.sec = setTimeout(() => saveSections('edit').catch(err => { saveState('Not saved'); toast(err.message, 'err'); }), 700);
    }
    if (t.dataset.noteText) {
      clearTimeout(saveTimers['n' + t.dataset.noteText]);
      saveTimers['n' + t.dataset.noteText] = setTimeout(async () => { await api.patch(`/notes/${t.dataset.noteText}`, { text: t.value }); d = await api.get(`/drafts/${id}`); refreshPanels(); }, 700);
    }
    if (t.dataset.imgField) {
      clearTimeout(saveTimers.img);
      saveTimers.img = setTimeout(async () => { await api.patch(`/images/${d.image.id}`, { [t.dataset.imgField]: t.value }); d = await api.get(`/drafts/${id}`); refreshPanels(); }, 700);
    }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.noteInclude) { await api.patch(`/notes/${t.dataset.noteInclude}`, { include: t.checked }); d = await api.get(`/drafts/${id}`); el.querySelector('#notes').innerHTML = String(notesHtml()); refreshPanels(); toast(t.checked ? 'Note will be used — choose “Apply notes to draft”' : 'Note is private again', 'ok'); }
      if (t.dataset.noteKind) await api.patch(`/notes/${t.dataset.noteKind}`, { kind: t.value });
      if (t.dataset.tag !== undefined && t.dataset.tag !== '') {
        const tags = d.tags.map((x, i) => i === Number(t.dataset.tag) ? { ...x, enabled: t.checked } : x);
        d = await api.patch(`/drafts/${id}`, { tags, note: 'tags' }); refreshPanels();
      }
      if (t.dataset.meta) {
        const meta = { ...(d.meta || {}), [t.dataset.meta]: t.type === 'number' ? Number(t.value) : (t.dataset.meta === 'narration_id' ? (t.value ? Number(t.value) : null) : t.value) };
        d = await api.patch(`/drafts/${id}`, { meta, note: 'video brief' }); refreshPanels();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
  // Ctrl/⌘+S saves now (autosave already runs after 700 ms of quiet)
  el.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (saveTimers.sec) { clearTimeout(saveTimers.sec); saveTimers.sec = 0; saveSections('edit').catch(err => toast(err.message, 'err')); } else saveState('Saved'); }
  });

  // ---------------------------------------------------------------- actions
  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    const sid = btn.dataset.id;
    try {
      if (a === 'lock') { const s = d.sections.find(x => x.id === sid); s.locked = !s.locked; await saveSections(s.locked ? `lock ${s.label}` : `unlock ${s.label}`); paint(); el.querySelector(`[data-act="lock"][data-id="${CSS.escape(sid)}"]`)?.focus(); }
      if (a === 'rewrite') await act(btn, async () => { d = await api.post(`/drafts/${id}/regenerate`, { section_id: sid, angle: el.querySelector('#angle').value }); paint(); toast('Section rewritten — earlier text saved in History', 'ok'); }, 'Rewriting…');
      if (a === 'regen') await act(btn, async () => { d = await api.post(`/drafts/${id}/regenerate`, { format: el.querySelector('#format').value, angle: el.querySelector('#angle').value }); paint(); toast('Regenerated unlocked sections', 'ok'); }, 'Regenerating…');
      if (a === 'expand' || (a === 'goto' && el.querySelector(`[data-collapsed="${CSS.escape(sid)}"]`))) {
        ui.expanded.add(sid);
        const box = el.querySelector(`[data-collapsed="${CSS.escape(sid)}"]`), sec = box?.closest('.st-sec');
        box?.remove();
        const f = sec?.querySelector('.st-field'); if (f) f.hidden = false;
        if (a === 'expand') sec?.querySelector('.st-text')?.focus();
      }
      if (a === 'goto') {
        const sec = el.querySelector(`#sec-${CSS.escape(sid)}`);
        sec?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
        const n = btn.dataset.n;
        if (n && sec) { hot(n, sec, true); setTimeout(() => hot(n, sec, false), 1600); }
        sec?.querySelector('.st-text')?.focus({ preventScroll: true });
      }
      if (a === 'apply-fix') {
        const f = d.flags[Number(btn.dataset.i)];
        const s = d.sections.find(x => x.id === f.section_id);
        if (s && s.text.includes(f.sentence)) { s.text = s.text.replace(f.sentence, f.suggestion); await saveSections(`fix ${f.type}`); paint(); toast('Suggestion applied — the earlier text is in History', 'ok'); }
        else toast('That sentence changed since the check ran; edit it directly.', 'err');
      }
      if (a === 'add-note') { d.notes = await api.post(`/drafts/${id}/notes`, { text: '', kind: 'observation' }); el.querySelector('#notes').innerHTML = String(notesHtml()); refreshPanels(); [...el.querySelectorAll('#notes textarea')].pop()?.focus(); }
      if (a === 'del-note') { await api.del(`/notes/${sid}`); await reload(); }
      if (a === 'apply-notes') await act(btn, async () => { d = await api.post(`/drafts/${id}/apply-notes`); paint(); toast('Perspective section updated from your selected notes', 'ok'); });
      if (a === 'suggest-tags') await act(btn, async () => { d = await api.post(`/drafts/${id}/tags/suggest`); refreshPanels(); });
      if (a === 'restore') await act(btn, async () => { d = await api.post(`/drafts/${id}/versions/${sid}/restore`); paint(); toast('Version restored (current text saved first)', 'ok'); });
      if (a === 'view-version') {
        const v = await api.get(`/drafts/${id}/versions/${sid}`);
        modal(String(html`<h2>Version v${v.id}</h2><p class="st-muted">${v.note} · ${fmtDateTime(v.created_at)}</p><div class="st-vview">${(v.sections || []).map(s => html`<p class="st-k">${s.label}${s.locked ? ' · locked' : ''}</p><p class="st-vtext">${s.text}</p>`)}</div><div class="modal-actions"><button type="button" class="btn btn--secondary" data-close>Close</button></div>`), { wide: true });
      }
      if (a === 'more') { el.querySelector('#li-body').textContent = d.final_text; }
      if (a === 'visual') await act(btn, async () => { d = await api.post(`/drafts/${id}/visual`, { kind: btn.dataset.kind }); paint(); });
      if (a === 'no-image') { d = await api.patch(`/drafts/${id}`, { image_id: null, note: 'remove image' }); paint(); }
      if (a === 'upload' || a === 'upload-media') uploadDialog(a === 'upload-media');
      if (a === 'import') importDialog();
      if (a === 'library') libraryDialog();
      if (a === 'submit') { d = await api.post(`/drafts/${id}/submit`); refreshPanels(); toast('Submitted for review', 'ok'); }
      if (a === 'approve') {
        const noImage = d.channel === 'linkedin' && !d.image ? await confirmBox('No image is attached. Approve this post as text-only?', 'Approve text-only') : false;
        if (d.channel === 'linkedin' && !d.image && !noImage) return;
        await act(btn, async () => { d = await api.post(`/drafts/${id}/approve`, { hash: d.current_hash, no_image: noImage }); refreshPanels(); toast('Approved this exact version', 'ok'); });
      }
      if (a === 'unapprove') { d = await api.post(`/drafts/${id}/unapprove`); refreshPanels(); }
      if (a === 'next-slot') { const r = await api.get(`/slots/next?channel=${d.channel}`); if (r.date) el.querySelector('#sched-date').value = r.date; else toast('No open slot in the next 60 days', 'err'); }
      if (a === 'use-humor') {
        const v = d.sections.find(x => x.id === sid), hook = d.sections.find(x => x.kind === 'hook');
        if (!hook || hook.locked) return toast('Unlock the hook first.', 'err');
        const old = hook.text; hook.text = v.text; v.text = old;
        await saveSections('swap in humor hook'); paint(); toast('Humor hook swapped in — the plain version is kept as the variant', 'ok');
      }
      if (a === 'record') recordNarration();
      if (a === 'schedule') await act(btn, async () => { const date = el.querySelector('#sched-date').value; if (!date) throw new Error('Pick a date first.'); d = await api.post(`/drafts/${id}/schedule`, { date }); refreshPanels(); toast(`Scheduled for ${dayShort(date)} — it’s on the calendar`, 'ok'); });
      if (a === 'plan' || a === 'unplan') await act(btn, async () => {
        const date = a === 'plan' ? el.querySelector('#sched-date').value : null;
        if (a === 'plan' && !date) throw new Error('Pick a date first.');
        const r = await api.post(`/drafts/${id}/plan`, { date });
        d = await api.get(`/drafts/${id}`); refreshPanels();
        toast(date ? `Planned for ${dayShort(date)}` : 'Date cleared', 'ok', { undo: { revert: async () => { await api.post(`/drafts/${id}/plan`, { date: r.previous_date }); d = await api.get(`/drafts/${id}`); refreshPanels(); } } });
      });
      if (a === 'copy') copy(d.final_text);
      if (a === 'dl-image') await act(btn, async () => {
        const im = d.image;
        if (im.mime === 'image/svg+xml') download(`byline-${id}.png`, await svgToPng(`/media/${im.filename}`, 1200, 1200));
        else { const blob = await (await fetch(`/media/${im.filename}`)).blob(); download(im.filename, blob); }
      });
      if (a === 'dl-slides') await act(btn, async () => {
        const slides = d.sections.filter(s => ['slide', 'frame', 'beat', 'hook'].includes(s.kind));
        for (let i = 0; i < slides.length; i++) download(`byline-${id}-slide-${i + 1}.png`, await svgToPng(slideSvg(slides[i].text, i, slides.length).svg, 1080, 1350));
        const exp = await api.get(`/drafts/${id}/export`);
        download(`byline-${id}-caption.txt`, exp.text);
      });
      if (a === 'dl-notes') { const exp = await api.get(`/drafts/${id}/export`); download(`byline-${id}-source-notes.md`, exp.source_notes, 'text/markdown'); }
      if (a === 'publish') return; // hold-to-publish (wired below) is the confirmation; a click alone never publishes
      if (a === 'mark-published') await act(btn, async () => { d = await api.post(`/drafts/${id}/mark-published`, {}); paint(); toast('Marked as published — add results in the Review tab', 'ok'); });
      if (a === 'save-metrics') await act(btn, async () => {
        const body = {};
        for (const inp of el.querySelectorAll('[data-metrics] [data-m]')) {
          if (inp.value !== '' && (isNaN(Number(inp.value)) || Number(inp.value) < 0)) throw new Error(`${inp.dataset.m.replace(/_/g, ' ')} must be a non-negative number`);
          body[inp.dataset.m] = inp.value === '' ? null : Number(inp.value);
        }
        d.metrics = await api.patch(`/drafts/${id}/metrics`, body);
        toast('Results saved', 'ok');
      }, 'Saving…');
      if (a === 'adapt') await act(btn, async () => { const r = await api.post(`/drafts/${id}/adapt`, { channel: btn.dataset.channel, format: btn.dataset.format }); location.hash = `#/draft/${r.draft_id}`; }, 'Adapting…');
      if (a === 'render') await act(btn, async () => { const r = await api.post(`/drafts/${id}/render`, { orientation: d.meta?.orientation, burn_captions: el.querySelector('#burn')?.checked !== false }); d = r.draft; paint(); toast(`Rendered ${Math.round(r.duration)}s MP4`, 'ok'); }, 'Rendering…');
      if (a === 'archive') { d = await api.patch(`/drafts/${id}`, { status: d.status === 'archived' ? 'draft' : 'archived' }); paint(); toast(d.status === 'archived' ? 'Archived' : 'Restored to drafts', 'ok'); }
    } catch (err) { toast(err.message, 'err'); }
  });

  // ---------------------------------------------------------------- publish: hold to publish (no dialog)
  async function publishNow() {
    try {
      d = await api.post(`/drafts/${id}/publish`, { confirm_hash: d.current_hash });
      toast('Published', 'ok');
      setTimeout(paint, 1100); // let the ✓ land before the panel re-sets
      return true;
    } catch (err) { toast(err.message, 'err'); return false; }
  }
  function wireHold() {
    el.querySelectorAll('[data-act="publish"]:not([data-hold])').forEach(b => holdToPress(b, { ms: 900, hint: `Hold to publish to ${channelLabel(d.channel)}`, onComplete: publishNow }));
  }

  // ---------------------------------------------------------------- dialogs (unchanged behaviour, v4 controls)
  function recordNarration() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Recording needs a browser with microphone support (Chrome, Edge, Safari 14.1+).', 'err');
    const script = d.sections.filter(x => x.kind === 'scene').map((x, i) => `${i + 1}. ${x.text}`).join('\n');
    const m = modal(String(html`<h2>Record narration</h2><p class="st-muted">Read the scenes in order. Your recording is saved as your own voice in the media rights log and set as this video's narration.</p>
      <pre class="st-code">${script}</pre>
      <div class="cluster st-gap-s"><button type="button" class="btn btn--primary" id="rec">Start recording</button><span class="st-k" id="timer">0:00</span></div>
      <audio id="play" controls class="st-audio" hidden></audio>
      <div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button type="button" class="btn btn--primary" id="save" disabled>Use this take</button></div>`));
    let rec, chunks = [], blob, t0, tick, stream;
    const recBtn = m.el.querySelector('#rec');
    recBtn.onclick = async () => {
      if (rec?.state === 'recording') { rec.stop(); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone permission was denied.', 'err'); }
      chunks = []; rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => chunks.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); clearInterval(tick);
        blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const au = m.el.querySelector('#play'); au.src = URL.createObjectURL(blob); au.hidden = false;
        recBtn.textContent = 'Record again'; m.el.querySelector('#save').disabled = false;
      };
      rec.start(); t0 = Date.now(); recBtn.textContent = 'Stop';
      tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); m.el.querySelector('#timer').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }, 500);
    };
    m.el.querySelector('#save').onclick = (ev) => act(ev.target, async () => {
      const ext = (blob.type.includes('mp4') ? '.m4a' : '.webm');
      const img = await api.post('/images', { filename: `narration-${id}${ext}`, mime: blob.type.split(';')[0].replace('video/', 'audio/'), data: await fileToBase64(blob),
        attribution: 'My own recorded voice', license: 'Own work', rights: { type: 'audio', own_voice: true } });
      images = await api.get('/images');
      d = await api.patch(`/drafts/${id}`, { meta: { ...(d.meta || {}), narration_id: img.id }, note: 'record narration' });
      m.close(); paint(); toast('Narration saved and attached', 'ok');
    }, 'Saving…');
  }

  function uploadDialog(media) {
    const m = modal(String(html`<h2>${media ? 'Upload footage, image or audio' : 'Upload an image'}</h2>
      <div class="st-form">
        <label class="field st-full">File<input type="file" id="f" accept="${media ? 'image/*,video/*,audio/*' : 'image/*'}"></label>
        <label class="field">Attribution<input class="input" id="attr" value="Me"></label>
        <label class="field">License<input class="input" id="lic" value="Own work"></label>
        <label class="field st-full">Original source (optional)<input class="input" id="src"></label>
        ${!media ? html`<label class="field st-full">Alt text<textarea class="textarea" id="alt" rows="2"></textarea></label>` : ''}
        ${media ? html`<label class="st-check st-full"><input type="checkbox" class="switch" id="synth"> This contains synthetic narration or a generated likeness</label>` : ''}
      </div>
      <div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button type="button" class="btn btn--primary" id="go">Upload</button></div>`));
    m.el.querySelector('#go').onclick = async (ev) => {
      const file = m.el.querySelector('#f').files[0];
      if (!file) return toast('Choose a file', 'err');
      await act(ev.target, async () => {
        const synth = m.el.querySelector('#synth')?.checked;
        const img = await api.post('/images', { filename: file.name, mime: file.type, data: await fileToBase64(file), attribution: m.el.querySelector('#attr').value, license: m.el.querySelector('#lic').value,
          source_url: m.el.querySelector('#src').value, alt: m.el.querySelector('#alt')?.value || '', rights: { type: file.type.split('/')[0], synthetic_voice: synth && file.type.startsWith('audio'), synthetic_likeness: synth && !file.type.startsWith('audio') } });
        images = await api.get('/images');
        if (!media) d = await api.patch(`/drafts/${id}`, { image_id: img.id, note: 'upload image' });
        m.close(); paint(); toast('Uploaded', 'ok');
      }, 'Uploading…');
    };
  }
  function importDialog() {
    const m = modal(String(html`<h2>Use a sourced image</h2><p class="st-muted">Attribution and license are required and saved with the image.</p>
      <div class="st-form"><label class="field st-full">Image URL<input class="input" id="u"></label><label class="field">Attribution (creator / site)<input class="input" id="attr"></label>
      <label class="field">License<input class="input" id="lic" placeholder="e.g. CC BY 4.0, Unsplash License"></label><label class="field st-full">Page where you found it<input class="input" id="src"></label>
      <label class="field st-full">Alt text<textarea class="textarea" id="alt" rows="2"></textarea></label></div>
      <div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button type="button" class="btn btn--primary" id="go">Import</button></div>`));
    m.el.querySelector('#go').onclick = (ev) => act(ev.target, async () => {
      const g = (s) => m.el.querySelector(s).value;
      const img = await api.post('/images/import', { url: g('#u'), attribution: g('#attr'), license: g('#lic'), source_url: g('#src') || g('#u'), alt: g('#alt') });
      d = await api.patch(`/drafts/${id}`, { image_id: img.id, note: 'sourced image' }); m.close(); paint();
    }, 'Downloading…');
  }
  async function libraryDialog() {
    images = await api.get('/images?kind=image');
    const m = modal(String(html`<h2>Image library</h2><div class="st-thumbs">${images.map(i => html`<button type="button" class="st-thumb xbtn${d.image_id === i.id ? ' is-sel' : ''}" data-pick="${i.id}" aria-label="${i.alt || i.attribution || i.filename}" aria-pressed="${d.image_id === i.id}"><img src="/media/${i.filename}" alt="" title="${i.generated ? 'Generated' : i.attribution}"></button>`)}</div>
      <div class="modal-actions"><button type="button" class="btn btn--secondary" data-close>Close</button></div>`), { wide: true });
    on(m.el, 'click', '[data-pick]', async (e, t) => { d = await api.patch(`/drafts/${id}`, { image_id: Number(t.dataset.pick), note: 'choose image' }); m.close(); paint(); });
  }
}
