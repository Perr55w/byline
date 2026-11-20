// Performance (v4). F §2 Performance: with 0 published posts, "No published posts to measure yet." and the
// drafts count, with no placeholder charts; with 1–2 posts, the totals and "Comparisons start at 3 posts per
// format."; with ≥3 posts in two formats, "{Format} posts earn {x}× the {metric} of {format2}." All figures come
// from /api/performance (averages per post, null = not recorded) and /api/drafts.
// Kept from v3: goal metric (reach / saves / meaningful conversations), compare by topic / format / angle /
// channel, per-post metric entry (blank = unavailable, never zero), CSV import with matched / unmatched report.
import { api } from '../api.js';
import { html, on, act, toast, channelLabel, icon, useStyle, status } from '../ui.js';
import { enterItems, reduced } from '../motion.js';
import { plural, dayLabel } from './people.js';

const EDITABLE = ['impressions', 'reach', 'reactions', 'comments', 'reposts', 'saves', 'clicks', 'profile_visits', 'meaningful_conversations'];
const GOALS = [['reach', 'Reach'], ['saves', 'Saves'], ['meaningful_conversations', 'Meaningful conversations']];
const GROUPS = [['by_topic', 'Topic'], ['by_format', 'Format'], ['by_angle', 'Angle'], ['by_channel', 'Channel']];
const STATUS_ORDER = ['draft', 'in_review', 'approved', 'scheduled'];
const label = (m) => m.replace(/_/g, ' ');
const fmt = (v) => typeof v === 'number' ? v.toLocaleString('en-US') : null;
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const ui = { goal: 'reach', group: 'by_topic', importResult: null, importOpen: false };

function headline(p, drafts) {
  const n = p.posts.length;
  const open = drafts.filter(d => !['published', 'archived'].includes(d.status)).length;
  if (!n) {
    const c = (s) => drafts.filter(d => d.status === s).length;
    const ahead = [['in_review', 'in review'], ['approved', 'approved'], ['scheduled', 'scheduled']].map(([k, l]) => [c(k), l]).filter(x => x[0]);
    return { h: 'No published posts to measure yet.', l: html`<b>${open}</b> open ${open === 1 ? 'draft' : 'drafts'}${ahead.length ? html`, ${ahead.map(([k, l], i) => html`${i ? ', ' : ''}<b>${k}</b> ${l}`)}` : ', none in review yet'}. Publish one, or import a CSV after posting by hand, to start tracking impressions, reactions and replies.` };
  }
  const sum = (m) => { const v = p.posts.map(r => r.metrics?.[m]).filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const goalLabel = GOALS.find(g => g[0] === ui.goal)?.[1].toLowerCase() || label(ui.goal);
  const eligible = (p.by_format || []).filter(g => g.posts >= 3 && typeof g[ui.goal] === 'number' && g[ui.goal] > 0).sort((a, b) => b[ui.goal] - a[ui.goal]);
  const totals = html`<b>${fmt(sum('impressions')) ?? 'no'}</b> impressions, <b>${fmt(sum('reactions')) ?? 'no'}</b> reactions recorded`;
  if (eligible.length >= 2) {
    const a = eligible[0], b = eligible[eligible.length - 1];
    const x = Math.round(a[ui.goal] / b[ui.goal] * 10) / 10;
    if (x < 1.2) return { h: `${cap(a.key)} and ${b.key} posts earn about the same ${goalLabel}.`, l: html`<b>${n}</b> published posts; ${totals}. Averages per post: ${a.key} ${fmt(a[ui.goal])} vs ${b.key} ${fmt(b[ui.goal])} (${a.posts} and ${b.posts} posts).` };
    return { h: html`${cap(a.key)} posts earn <span class="pf-x">${x}×</span> the ${goalLabel} of ${b.key}.`, l: html`<b>${n}</b> published posts; ${totals}. Averages per post: ${a.key} ${fmt(a[ui.goal])} vs ${b.key} ${fmt(b[ui.goal])} (${a.posts} and ${b.posts} posts).` };
  }
  return { h: `${plural(n, 'published post')} so far.`, l: html`${totals}. Comparisons start at 3 posts per format.` };
}

const STATUS_LABEL = { draft: 'Draft', in_review: 'In review', approved: 'Approved', scheduled: 'Scheduled', published: 'Published' };
const STATUS_TONE = { approved: 'tag--ok', in_review: 'tag--warn', scheduled: 'tag--neutral', draft: 'tag--neutral' };
const stTag = (s) => html`<span class="tag ${STATUS_TONE[s] || 'tag--neutral'}">${STATUS_LABEL[s] || label(s)}</span>`;
const STATUS_PHRASE = { draft: 'in draft', in_review: 'in review', approved: 'approved', scheduled: 'scheduled' };
const NEAR_RANK = { scheduled: 0, approved: 1, in_review: 2, draft: 3 };
/** YYYY-MM-DD of an ISO timestamp (or now) in the settings timezone. */
const FMT = new Map();   // Intl formatters are costly to build; one per (kind, timezone)
const fmtr = (k, opts) => { if (!FMT.has(k)) { try { FMT.set(k, new Intl.DateTimeFormat(opts.locale, opts.o)); } catch (e) { FMT.set(k, new Intl.DateTimeFormat(opts.locale, { ...opts.o, timeZone: undefined })); } } return FMT.get(k); };
const ymdIn = (iso, tz) => fmtr(`ymd|${tz || ''}`, { locale: 'en-CA', o: { timeZone: tz || undefined } }).format(iso ? new Date(iso) : new Date());
/** "Wed 18 Nov", same format as people.js dayLabel, from a cached formatter. */
const dShort = (ymd) => ymd ? fmtr('short', { locale: 'en-GB', o: { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } }).format(new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`)).replace(',', '') : '';
const dDay = (ymd) => ymd ? fmtr('day', { locale: 'en-GB', o: { day: 'numeric', month: 'short', timeZone: 'UTC' } }).format(new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`)) : '';
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** 14 days ending today: each open draft counted once, on the day of its last edit (the only draft timestamp /api/drafts exposes). */
function lastEditStrip(open, tz) {
  const today = ymdIn(null, tz);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const by = new Map(days.map(d => [d, { review: 0, draft: 0 }]));
  const all = new Map();   // every last-edit day, inside the window or not
  let older = 0;
  for (const d of open) {
    const k = ymdIn(d.updated_at, tz);
    all.set(k, (all.get(k) || 0) + 1);
    if (!by.has(k)) { older++; continue; }
    by.get(k)[d.status === 'draft' ? 'draft' : 'review']++;
  }
  const max = Math.max(1, ...[...by.values()].map(v => v.review + v.draft));
  const peak = [...by.entries()].sort((a, b) => (b[1].review + b[1].draft) - (a[1].review + a[1].draft))[0];
  const active = [...by.values()].filter(v => v.review + v.draft).length;
  const allDays = [...all.entries()].sort((a, b) => b[0].localeCompare(a[0]));   // newest first
  return { days, by, max, older, peak, active, today, allDays };
}

/** Open drafts grouped by story (story_id, else exact title): one entry per story, with its channel · format
 *  variants. Each variant shows its furthest status and how many drafts share it. Ranked by the story's furthest
 *  status, then its latest edit. */
function storyGroups(open) {
  const m = new Map();
  for (const d of open) {
    const k = d.story_id != null ? `s${d.story_id}` : `t${d.title}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d);
  }
  const rank = (d) => NEAR_RANK[d.status] ?? 9;
  const byNear = (a, b) => rank(a) - rank(b) || String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  return [...m.values()].map(list => {
    const drafts = [...list].sort(byNear);
    const kinds = new Map();
    for (const d of drafts) {
      const k = `${d.channel}|${d.format || ''}`;
      if (!kinds.has(k)) kinds.set(k, { best: d, n: 0 });
      kinds.get(k).n++;
    }
    const last = drafts.reduce((a, d) => String(d.updated_at || '') > a ? String(d.updated_at || '') : a, '');
    const planned = drafts.map(d => d.planned_date).filter(Boolean).sort()[0] || null;
    return { best: drafts[0], drafts, kinds: [...kinds.values()].sort((a, b) => byNear(a.best, b.best) || b.n - a.n), last, planned };
  }).sort((a, b) => rank(a.best) - rank(b.best) || b.last.localeCompare(a.last));
}

export async function render(view) {
  await useStyle('/css/v4/performance.css');
  const [p, drafts, settings] = await Promise.all([api.get('/performance', { fresh: true }), api.get('/drafts').catch(() => []), api.get('/settings').catch(() => ({}))]);
  const tz = settings.timezone;
  const metrics = p.metrics || EDITABLE;
  const groups = p[ui.group] || [];
  const max = Math.max(0, ...groups.map(g => g[ui.goal] ?? 0));
  const goalLabel = GOALS.find(g => g[0] === ui.goal)?.[1] || label(ui.goal);
  const groupLabel = GROUPS.find(g => g[0] === ui.group)[1];
  const best = groups.filter(g => g[ui.goal] != null).sort((a, b) => b[ui.goal] - a[ui.goal])[0];
  const hd = headline(p, drafts);
  const open = drafts.filter(d => !['published', 'archived'].includes(d.status));
  const byStatus = STATUS_ORDER.map(s => [s, open.filter(d => d.status === s)]);
  const stories = storyGroups(open);
  const near = stories.slice(0, 3);
  const byChannel = ['linkedin', 'instagram', 'video'].map(c => [c, open.filter(d => d.channel === c).length]).filter(x => x[1]);
  const channels = [...new Set([...near.map(g => g.best.channel), ...byChannel.map(c => c[0])])];
  const slotList = await Promise.all(channels.map(c => api.get(`/slots/next?channel=${c}`).then(r => [c, r?.date || null]).catch(() => [c, null])));
  const slots = Object.fromEntries(slotList);
  const postingDays = settings.posting_days?.length ? settings.posting_days : null;
  const strip = lastEditStrip(open, tz);
  // R13: a chart only when last edits fall on ≥3 distinct days in the window; otherwise one computed sentence.
  const showChart = strip.active >= 3;
  const biggest = stories.reduce((a, g) => g.drafts.length > (a?.drafts.length || 0) ? g : a, null);
  const sinceLast = strip.allDays.length ? Math.round((new Date(`${strip.today}T12:00:00Z`) - new Date(`${strip.allDays[0][0]}T12:00:00Z`)) / 864e5) : null;
  const recorded = (r) => EDITABLE.filter(m => typeof r.metrics?.[m] === 'number').length;
  const cell = (v) => v == null ? html`<td class="num pf-na">—</td>` : html`<td class="num">${fmt(v)}</td>`;
  const funnelMax = Math.max(1, ...byStatus.map(([, a]) => a.length));

  const importCard = html`
    <details class="pf-details" ${ui.importResult || ui.importOpen ? 'open' : ''}>
      <summary class="pf-summary"><span class="pf-summary-t">Import results from a CSV</span><span class="pf-summary-m">${p.posts.length ? 'matches by draft_id or exact title' : 'once a draft is published'}</span>${icon('chevron-right', 'pf-chev')}</summary>
      <div class="pf-details-body">
        <p class="pf-sub">First line is the header: <code>draft_id</code> or <code>title</code>, then any metric columns. Empty cells are skipped; results show once the matched draft is published.</p>
        <h3 class="pf-h4">What will be tracked</h3>
        <p class="pf-sub">Per published post, as the platform reports it. Missing values stay blank, never zero.</p>
        <ul class="pf-metric-list">${metrics.map(m => html`<li>${label(m)}</li>`)}</ul>
        <textarea class="textarea pf-csv" data-csv rows="4" aria-label="CSV to import" placeholder="draft_id,impressions,reactions,comments&#10;&lt;id&gt;,&lt;number&gt;,&lt;number&gt;,&lt;number&gt;"></textarea>
        <div class="pf-import-row"><button class="btn btn--primary btn--sm" data-act="import">Import</button>
          ${ui.importResult ? html`<span class="tag tag--ok">${plural(ui.importResult.matched, 'row')} matched</span>
            ${ui.importResult.unmatched.length ? html`<span class="pf-err">Unmatched: ${ui.importResult.unmatched.map(u => u || '(blank)').join(', ')}</span>` : ''}` : ''}
        </div>
      </div>
    </details>`;

  const el = document.createElement('div');
  el.className = 'pf';
  el.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Publish · post results</p>
    <h1>${hd.h}</h1>
    <p class="lede">${hd.l}</p>
    ${p.posts.length ? html`<div class="page-head-actions">
      <label class="pf-goal"><span>Goal metric</span><select class="select" data-goal>${GOALS.map(([k, l]) => html`<option value="${k}" ${k === ui.goal ? 'selected' : ''}>${l}</option>`)}</select></label>
    </div>` : ''}
  </header>

  ${p.posts.length ? html`
  <section class="tile tile--static tile--flush pf-compare" aria-labelledby="pf-c-h">
    <div class="section-head pf-pad"><h2 class="t-h2" id="pf-c-h">${goalLabel} per post, by ${groupLabel.toLowerCase()}</h2>
      <div class="cluster" role="group" aria-label="Compare by">${GROUPS.map(([k, l]) => html`<button class="chip chip--filter" data-group="${k}" aria-pressed="${String(k === ui.group)}">${l}</button>`)}</div></div>
    <p class="pf-sub pf-pad">${best ? html`Best average ${goalLabel.toLowerCase()}: <b>${ui.group === 'by_channel' ? channelLabel(best.key) : best.key}</b> (${fmt(best[ui.goal])} across ${plural(best.posts, 'post')}).${groups.some(g => g.posts < 3) ? ' Groups under 3 posts are a hint, not a verdict.' : ''}` : `No ${goalLabel.toLowerCase()} recorded yet for any published post.`}</p>
    <div class="pf-scroll"><table class="table pf-table">
      <thead><tr><th>${groupLabel}</th><th class="num">Posts</th><th class="pf-goalcol">${goalLabel} (avg)</th>${metrics.filter(m => m !== ui.goal).map(m => html`<th class="num">${label(m)}</th>`)}</tr></thead>
      <tbody>${groups.map(g => html`<tr class="${groups.length > 20 ? 'cv-row' : ''}">
        <td class="pf-key">${ui.group === 'by_channel' ? channelLabel(g.key) : g.key}${g.posts < 3 ? html`<span class="pf-small">small sample</span>` : ''}</td><td class="num">${g.posts}</td>
        <td class="pf-goalcol">${g[ui.goal] == null ? html`<span class="pf-na">not recorded</span>`
          : html`<span class="pf-bar"><span class="meter"><i style="--v:${max ? Math.max(.02, g[ui.goal] / max) : 0}"></i></span><b>${fmt(g[ui.goal])}</b></span>`}</td>
        ${metrics.filter(m => m !== ui.goal).map(m => cell(g[m]))}
      </tr>`)}</tbody>
    </table></div>
  </section>

  <section class="tile tile--static tile--flush" aria-labelledby="pf-m-h">
    <div class="section-head pf-pad"><h2 class="t-h2" id="pf-m-h">Published posts · metrics</h2><span class="section-meta">${p.posts.filter(r => recorded(r)).length} of ${p.posts.length} with results</span></div>
    <p class="pf-sub pf-pad">Leave a field blank if the platform doesn’t report it (Instagram has no reposts). Blank means unavailable, never zero.</p>
    <div class="pf-scroll"><table class="table pf-table pf-entry">
      <thead><tr><th>Post</th>${EDITABLE.map(m => html`<th class="num">${label(m)}</th>`)}<th><span class="sr-only">Save</span></th></tr></thead>
      <tbody>${p.posts.map(r => html`<tr data-prow="${r.id}" class="${p.posts.length > 20 ? 'cv-row' : ''}">
        <td class="pf-post"><a class="pf-title" href="#/draft/${r.id}">${r.title}</a>
          <span class="pf-meta"><span class="chip">${channelLabel(r.channel, r.format)}</span>${r.angle ? html`<span class="chip">${r.angle}</span>` : ''}<span>published ${dayLabel((r.published_at || '').slice(0, 10), { weekday: false })}</span>${r.metrics?.updated_at ? html`<span>updated ${dayLabel(r.metrics.updated_at.slice(0, 10), { weekday: false })}</span>` : ''}</span></td>
        ${EDITABLE.map(m => html`<td><input class="input pf-metric" type="number" min="0" step="1" inputmode="numeric" data-m="${m}" value="${typeof r.metrics?.[m] === 'number' ? r.metrics[m] : ''}" placeholder="—" aria-label="${label(m)} for ${r.title}"></td>`)}
        <td><button class="btn btn--primary btn--sm" data-act="save" data-id="${r.id}">Save</button></td>
      </tr>`)}</tbody>
    </table></div>
  </section>
  <section class="tile tile--static pf-card pf-import" aria-label="Import CSV">${importCard}</section>` : html`
  <section class="tile tile--static pf-card pf-row1" aria-labelledby="pf-pipe-h">
    <div class="pf-funnel">
      <div class="section-head"><h2 class="t-h2" id="pf-pipe-h">On the way to publishing</h2><span class="section-meta">${plural(open.length, 'open draft')}</span></div>
      <ol class="pf-pipe" aria-label="Open drafts by status">${byStatus.map(([s, a]) => html`<li class="${a.length ? '' : 'is-zero'}"><span class="pf-pipe-n">${a.length}</span><span class="pf-pipe-l">${STATUS_LABEL[s]}</span><span class="pf-pipe-bar" aria-hidden="true"><i style="--v:${a.length / funnelMax}"></i></span></li>`)}<li class="is-zero pf-pipe-end"><span class="pf-pipe-n">0</span><span class="pf-pipe-l">Published</span><span class="pf-pipe-bar" aria-hidden="true"><i style="--v:0"></i></span></li></ol>
      <p class="pf-sub">Metrics start once a draft is published: publish from Studio, or use “Mark as published” there after posting by hand.</p>
    </div>
    <div class="pf-strip ${showChart ? '' : 'pf-strip--line'}" role="group" aria-labelledby="pf-strip-h">
      ${showChart ? html`<div class="pf-strip-head"><h3 class="pf-h4" id="pf-strip-h">Last edit per open draft · 14 days</h3>
        <span class="pf-legend"><span><i class="k k--rev"></i>In review or later</span><span><i class="k k--dr"></i>Draft</span></span></div>
      <ol class="pf-days">${strip.days.map(d => { const v = strip.by.get(d); const n = v.review + v.draft; return html`<li title="${dShort(d)}: ${n ? plural(n, 'draft') + ' last edited' : 'no draft last edited'}${v.review ? ` (${v.review} in review or later)` : ''}">
        <span class="pf-col" aria-hidden="true">${v.draft ? html`<i class="pf-seg pf-seg--dr" style="--h:${v.draft / strip.max}"></i>` : ''}${v.review ? html`<i class="pf-seg pf-seg--rev" style="--h:${v.review / strip.max}"></i>` : ''}</span>
        <span class="pf-dn ${n ? 'has' : ''}">${n || ''}</span>
        <span class="pf-dl ${d === strip.today ? 'is-today' : ''}">${d === strip.today ? 'Today' : new Date(`${d}T12:00:00Z`).getUTCDate()}</span>
        <span class="sr-only">${dShort(d)}: ${plural(n, 'draft')}</span></li>`; })}</ol>
      <p class="pf-sub pf-strip-note">Edits fall on ${strip.active} days, most on <b>${dShort(strip.peak[0])}</b> (${strip.peak[1].review + strip.peak[1].draft})${strip.older ? html`; ${strip.older} not touched in 14 days` : ''}. Creation and review dates aren’t recorded per draft, so this counts each draft once.</p>`
      : html`<h3 class="pf-h4" id="pf-strip-h">When the open drafts were last edited</h3>
      <p class="pf-line">${!open.length ? 'No open drafts.'
        : strip.allDays.length === 1 ? html`${open.length === 1 ? 'The one open draft was' : html`All <b>${open.length}</b> open drafts were`} last edited <b>${dShort(strip.allDays[0][0])}</b>.`
        : strip.allDays.length === 2 ? html`<b>${open.length}</b> open drafts were last edited on two days: <b>${strip.allDays[1][1]}</b> on ${dShort(strip.allDays[1][0])} and <b>${strip.allDays[0][1]}</b> on ${dShort(strip.allDays[0][0])}.`
        : html`<b>${open.length}</b> open drafts were last edited on ${strip.allDays.length} days, most recently <b>${dShort(strip.allDays[0][0])}</b>${strip.older ? html`; ${strip.older} not touched in 14 days` : ''}.`}</p>
      ${biggest && biggest.drafts.length > 1 ? html`<div class="pf-stat"><span class="pf-stat-n">${biggest.drafts.length}<span class="pf-stat-of"> of ${open.length}</span></span><span class="pf-stat-l">open drafts are for one story, ranked first below</span></div>`
        : sinceLast != null ? html`<div class="pf-stat"><span class="pf-stat-n">${sinceLast}</span><span class="pf-stat-l">${sinceLast === 1 ? 'day' : 'days'} since the last edit to an open draft</span></div>` : ''}
      <p class="pf-sub pf-strip-note">A day-by-day chart appears once edits span three or more days. Only the last edit is recorded per draft.</p>`}
    </div>
  </section>

  <div class="pf-cols">
    <section class="tile tile--static pf-card pf-near-card" aria-labelledby="pf-near-h">
      <div class="section-head"><h2 class="t-h2" id="pf-near-h">Closest to publishing</h2><span class="section-meta">${plural(stories.length, 'story', 'stories')} · furthest status, then latest edit</span></div>
      ${near.length ? html`<ol class="pf-near">${near.map((g, i) => html`<li>
        <span class="pf-rank" aria-hidden="true">${i + 1}</span>
        <div class="pf-near-main"><a class="pf-title" href="#/draft/${g.best.id}">${g.best.title}</a>
          <ul class="pf-kinds" aria-label="Drafts for this story by channel">${g.kinds.map(k => html`<li><a class="pf-kind" href="#/draft/${k.best.id}"><span class="pf-kind-c">${channelLabel(k.best.channel, k.best.format)}</span>${stTag(k.best.status)}${k.n > 1 ? html`<span class="pf-kind-n" title="${k.n} drafts in this format">×${k.n}</span>` : ''}</a></li>`)}</ul>
</div>
        <span class="pf-slot">${g.planned ? html`<span class="pf-slot-l">Planned</span><b>${dShort(g.planned)}</b>`
          : slots[g.best.channel] ? html`<span class="pf-slot-l">Next open ${channelLabel(g.best.channel)} slot</span><b>${dShort(slots[g.best.channel])}</b>` : html`<span class="pf-slot-l">No open slot in 60 days</span>`}<span class="pf-slot-m">${plural(g.drafts.length, 'draft')} · edited ${dDay(ymdIn(g.last, tz))}</span></span>
      </li>`)}</ol>${stories.length > 3 ? html`<p class="pf-sub pf-near-more">${plural(stories.length - 3, 'more story', 'more stories')} with open drafts in <a href="#/studio">Studio</a>.</p>` : ''}` : html`<p class="pf-sub">No open drafts. Start one from a story in Today or Feed.</p>`}
    </section>
    <section class="tile tile--static pf-card pf-side" aria-labelledby="pf-slots-h">
      <div class="section-head"><h2 class="t-h2" id="pf-slots-h">Next open slots</h2><span class="section-meta">${postingDays ? `posting days ${postingDays.join(', ')}` : 'posting days not set'}</span></div>
      <div class="pf-chan pf-chan--side">
        <span class="pf-chan-l">Drafts by channel</span>
        <span class="pf-chan-bar" role="img" aria-label="${byChannel.map(([c, n]) => `${n} ${channelLabel(c)}`).join(', ')}">${byChannel.map(([c, n], i) => html`<i class="pf-chan-seg pf-chan-seg--${i}" style="--w:${n}"></i>`)}</span>
      </div>
      <ul class="pf-slots">${byChannel.map(([c, n], i) => { const sc = STATUS_ORDER.map(st => [st, open.filter(d => d.channel === c && d.status === st).length]).filter(x => x[1]); return html`<li><span class="pf-slots-c"><i class="k pf-chan-seg--${i}" aria-hidden="true"></i>${channelLabel(c)}</span><span class="pf-slots-d">${slots[c] ? dShort(slots[c]) : 'none in 60 days'}</span><span class="pf-slots-n">${plural(n, 'draft')} waiting, ${sc.length === 1 ? `all ${STATUS_PHRASE[sc[0][0]]}` : sc.slice().reverse().map(([st, k]) => `${k} ${STATUS_PHRASE[st]}`).join(', ')}</span></li>`; })}</ul>
      <p class="pf-sub">Open means no draft is planned for that channel on that posting day. Plan drafts onto days in Calendar.</p>
      <div class="pf-side-import">${importCard}</div>
    </section>
  </div>`}`);
  view.replaceChildren(el);

  const again = async (animate) => { await render(view); if (animate && !reduced()) enterItems([...view.querySelectorAll('.pf > .tile, .pf-cols')].slice(0, 4), { y: 4, duration: 360, fadeDuration: 260 }); };
  on(el, 'change', '[data-goal]', (e, s) => { ui.goal = s.value; again(true); });
  on(el, 'click', '[data-group]', (e, b) => { ui.group = b.dataset.group; again(); });
  on(el, 'click', '[data-act]', async (e, btn) => {
    if (btn.dataset.act === 'save') await act(btn, async () => {
      const row = el.querySelector(`[data-prow="${btn.dataset.id}"]`);
      const body = {};
      for (const inp of row.querySelectorAll('[data-m]')) {
        if (inp.value !== '' && (isNaN(Number(inp.value)) || Number(inp.value) < 0)) throw new Error(`${label(inp.dataset.m)} must be a non-negative number`);
        body[inp.dataset.m] = inp.value === '' ? null : Number(inp.value);
      }
      await api.patch(`/drafts/${btn.dataset.id}/metrics`, body);
      toast('Metrics saved', 'ok');
      again();
    }, 'Saving…');
    if (btn.dataset.act === 'import') await act(btn, async () => {
      const csv = el.querySelector('[data-csv]').value.trim();
      if (!csv.includes('\n')) throw new Error('Paste a header line and at least one data row.');
      ui.importResult = await api.post('/performance/import', { csv });
      ui.importOpen = true;
      toast(`Imported ${plural(ui.importResult.matched, 'row')}`, ui.importResult.unmatched.length ? '' : 'ok');
      again();
    }, 'Importing…');
  });
  el.querySelectorAll('.pf-details').forEach(d => d.addEventListener('toggle', () => { ui.importOpen = d.open; }));
}
