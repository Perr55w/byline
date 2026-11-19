// Calendar (v4, rebuilt from 35). D §5 sketch + SPEC §5 + F §2 headline + F §5 keyboard twin.
//
// Month grid (default): day cells sized to the viewport, the day number inside the cell, no gap under the
// weekday header, a today disc, outside-month days muted, weekend tint, post chips (channel glyph + title +
// status style + 3px quality bar from the linked story's score) and "+N". Week view: lanes (Posts, Outreach,
// Slots) because drafts carry only a date. Side panel: the selected day, the Unscheduled drafts tray and the
// cadence meter (posts per week vs the goal, last 4 weeks), plus a History tab.
//
// Moving a draft: pointer drag (mouse and touch long-press) onto a day or back to the tray → POST
// /api/drafts/:id/plan with an optimistic update, an Undo toast (≥ 8 s) and Ctrl+Z. Keyboard twin: Space or
// Enter on a draft row picks it up, arrows choose a day, Enter drops, Esc cancels, a live region narrates.
// Every draft also has a "Schedule…" menu (plan for a date; approved drafts can additionally use the
// approval-gated POST /api/drafts/:id/schedule). The calendar feed (ICS) link from /api/status is kept.
import { api } from '../api.js';
import { html, raw, on, toast, modal, optimistic, copy, status as statusTag, scoreChip, channelLabel, icon, useStyle, inField } from '../ui.js';
import { qualityColor, qualityTier, qualityLabel } from '../quality.js';
import { enterItems, reduced, EASE } from '../motion.js';

// ------------------------------------------------------------------ dates (YYYY-MM-DD strings, UTC-noon arithmetic)
const P = (n) => String(n).padStart(2, '0');
const D = (ymd) => new Date(`${ymd}T12:00:00Z`);
const toYMD = (d) => `${d.getUTCFullYear()}-${P(d.getUTCMonth() + 1)}-${P(d.getUTCDate())}`;
const addDays = (ymd, n) => { const d = D(ymd); d.setUTCDate(d.getUTCDate() + n); return toYMD(d); };
const dow = (ymd) => (D(ymd).getUTCDay() + 6) % 7; // Mon = 0
const mondayOf = (ymd) => addDays(ymd, -dow(ymd));
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1, 12)); return `${d.getUTCFullYear()}-${P(d.getUTCMonth() + 1)}`; };
const FMT = new Map(); // Intl formatters are expensive to build: one per option set
const fmt = (ymd, o) => { const k = `${o.weekday}|${o.day}|${o.month}|${o.year}`; let f = FMT.get(k); if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }); FMT.set(k, f); } return f.format(D(ymd)); };
const dayShort = (ymd) => fmt(ymd, { weekday: 'short', day: 'numeric', month: 'short' });        // Wed 18 Nov
const dayLong = (ymd) => fmt(ymd, { weekday: 'long', day: 'numeric', month: 'long' });            // Wednesday 18 November
const monthName = (m) => fmt(`${m}-01`, { month: 'long' });
const monthYear = (m) => fmt(`${m}-01`, { month: 'long', year: 'numeric' });
const isoWeek = (ymd) => { const d = D(ymd); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - y0) / 864e5 - 3 + ((y0.getUTCDay() + 6) % 7)) / 7); };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** F's short title: the part before ":" / " — " when it is ≥ 20 chars, else the title capped at 60. */
const shortTitle = (t = '') => { const m = /^(.{20,}?)(?::\s| — )/.exec(t); const s = m ? m[1] : t; return s.length > 60 ? `${s.slice(0, 59).replace(/\s+\S*$/, '')}…` : s; };

// ------------------------------------------------------------------ channel glyphs (12px, 1.5 stroke, currentColor)
const GLYPH = {
  linkedin: '<path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5"/>',
  instagram: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="3"/><circle cx="8" cy="8" r="2.4"/>',
  video: '<rect x="2.25" y="3.5" width="11.5" height="9" rx="2"/><path d="M7 6.3v3.4L9.8 8z" fill="currentColor" stroke="none"/>',
  outreach: '<rect x="2.25" y="3.75" width="11.5" height="8.5" rx="1.6"/><path d="M2.8 4.6 8 8.6l5.2-4"/>',
  followup: '<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/>',
  check: '<path d="M3.5 8.4 6.6 11.4 12.6 4.8"/>'
};
const glyph = (k, label = '') => raw(`<svg class="cal-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${GLYPH[k] || GLYPH.linkedin}</svg>`);

const STATUS_RANK = { published: 0, scheduled: 1, approved: 2, in_review: 3, draft: 4 };
const chipState = (d) => d.status === 'published' ? 'published' : d.status === 'scheduled' ? 'scheduled' : (d.status === 'approved' || d.approved) ? 'approved' : 'draft';
const STATE_WORD = { published: 'published', scheduled: 'scheduled', approved: 'approved', draft: 'not approved' };

useStyle('/css/v4/calendar.css'); // warm on the shell's idle prefetch, so the first visit doesn't restyle the document mid-transition

export async function render(view, { params = [] } = {}) {
  await useStyle('/css/v4/calendar.css');
  const st = await api.get('/status').catch(() => ({}));
  const today = st.today || toYMD(new Date());
  const tz = st.timezone || 'America/New_York';
  const th = st.threshold ?? window.__byline?.threshold ?? 55;
  const tzDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDay = (iso) => !iso ? null : /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso
    : /T\d{2}:\d{2}(:\d{2})?$/.test(iso) ? iso.slice(0, 10) // naive local time (outreach send_at)
    : tzDay.format(new Date(iso));

  // ---------------------------------------------------------------- data
  const monthCache = new Map();
  const loadMonth = (m) => { if (!monthCache.has(m)) monthCache.set(m, api.get(`/calendar?month=${m}`).catch(() => null)); return monthCache.get(m); };
  const S = {
    month: /^\d{4}-\d{2}$/.test(params[0] || '') ? params[0] : today.slice(0, 7),
    view: (() => { try { return localStorage.getItem('byline-cal-view') === 'week' ? 'week' : 'month'; } catch (e) { return 'month'; } })(),
    week: null, selected: null, side: 'day', carry: null, openGroups: new Set(), trayReady: false,
    drafts: new Map(), outreach: [], followups: [], unplanned: [], unplannedTotal: 0, history: [],
    settings: {}, nextSlot: null
  };
  S.selected = S.month === today.slice(0, 7) ? today : `${S.month}-01`;
  S.week = mondayOf(S.selected);

  const ingest = (cal) => {
    if (!cal) return;
    for (const d of cal.drafts || []) S.drafts.set(d.id, d);
    S.outreach = mergeBy(S.outreach, cal.outreach || [], 'id');
    S.unplanned = cal.unplanned || S.unplanned;
    S.unplannedTotal = cal.unplanned_total ?? S.unplannedTotal;
    S.history = cal.history || S.history;
  };
  const mergeBy = (a, b, k) => { const m = new Map(a.map(x => [x[k], x])); for (const x of b) m.set(x[k], x); return [...m.values()]; };
  const ensureMonths = (ms) => Promise.all([...new Set(ms)].map(loadMonth)).then(rs => rs.forEach(ingest));
  const neededMonths = () => [shiftMonth(S.month, -1), S.month, shiftMonth(S.month, 1), addDays(today, -27).slice(0, 7), today.slice(0, 7), addDays(today, 6).slice(0, 7), S.week.slice(0, 7), addDays(S.week, 6).slice(0, 7)];

  const [settings, fu, slot, found] = await Promise.all([
    api.get('/settings').catch(() => ({})),
    api.get('/followups').catch(() => null),
    api.get('/slots/next?channel=linkedin').catch(() => ({})),
    api.get('/search?type=stories&limit=200').catch(() => null),
    ensureMonths(neededMonths())
  ]);
  // news context: stories by the local day they were first seen (what arrived when, to plan posts against)
  const news = new Map();
  for (const x of found?.stories || []) { const day = localDay(x.first_seen); if (!day) continue; if (!news.has(day)) news.set(day, []); news.get(day).push(x); }
  for (const l of news.values()) l.sort((a, b) => b.score - a.score);
  S.settings = settings || {};
  S.followups = (fu?.due || []).map(c => ({ ...c, day: c.next_date?.slice(0, 10) }));
  S.nextSlot = slot?.date || null;
  const postingDays = (S.settings.posting_days?.length ? S.settings.posting_days : ['Mon', 'Wed', 'Fri']);
  const goal = postingDays.length || 3;
  const isPostingDay = (ymd) => postingDays.includes(WEEKDAYS[dow(ymd)]);

  // ---------------------------------------------------------------- derived
  const dayOf = (d) => (d.status === 'published' && d.published_at) ? localDay(d.published_at) : (d.planned_date || '').slice(0, 10) || null;
  function byDay() {
    const map = new Map();
    const push = (day, it) => { if (!day) return; if (!map.has(day)) map.set(day, []); map.get(day).push(it); };
    for (const d of S.drafts.values()) if (d.status !== 'archived') push(dayOf(d), { kind: 'draft', ...d, state: chipState(d) });
    for (const o of S.outreach) push(localDay(o.send_at), { kind: 'outreach', ...o, time: /T(\d{2}:\d{2})/.exec(o.send_at || '')?.[1] || '' });
    for (const f of S.followups) push(f.day, { kind: 'followup', ...f });
    for (const list of map.values()) list.sort((a, b) => (a.kind !== 'draft') - (b.kind !== 'draft') || (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.id - b.id);
    return map;
  }
  const postsBetween = (from, to, map) => { let n = 0, pub = 0; for (let d = from; d <= to; d = addDays(d, 1)) for (const it of map.get(d) || []) if (it.kind === 'draft') { n++; if (it.state === 'published') pub++; } return { n, pub }; };

  // ---------------------------------------------------------------- headline (F §2 Calendar, verbatim + fallbacks)
  function headline(map) {
    const wk = mondayOf(today);
    const week = postsBetween(wk, addDays(wk, 6), map);
    let published = 0, planned = 0;
    for (const [day, list] of map) if (day.startsWith(S.month)) for (const it of list) if (it.kind === 'draft') it.state === 'published' ? published++ : planned++;
    const tray = S.unplannedTotal;
    const trayTxt = html`<b>${tray > S.unplanned.length && S.unplanned.length >= 30 ? `${S.unplanned.length}+` : tray}</b> ${tray === 1 ? 'draft' : 'drafts'} in the tray`;
    const next = S.nextSlot ? html`next open posting day: <b>${dayShort(S.nextSlot)}</b>.` : html`no open posting day in the next 60 days.`;
    const weekLine = html`<b>${week.n}</b> of <b>${goal}</b> posts planned this week.`;
    if (!published && !planned) return { h: `Nothing is scheduled in ${monthName(S.month)}.`, l: html`${weekLine} ${trayTxt}; ${next}` };
    const h = week.n >= goal ? 'This week is fully planned.' : `${week.n} of ${goal} posts planned this week.`;
    return { h, l: html`<b>${published}</b> published and <b>${planned}</b> planned in ${monthName(S.month)}. ${trayTxt}; ${next}` };
  }

  // ---------------------------------------------------------------- markup pieces
  const q = (score) => score == null ? '' : `--q:${qualityColor(score, th)}`;
  const qTier = (score) => score == null ? 'none' : qualityTier(score, th);
  const draftLabel = (d) => `${shortTitle(d.title || 'Untitled')}: ${channelLabel(d.channel, d.format)}, ${STATE_WORD[chipState(d)]}${d.score != null ? `, story score ${Math.round(d.score)} (${qualityLabel(d.score, th)})` : ', no linked story'}`;

  const chip = (it, { wrap = false } = {}) => {
    // month cells are narrow: "Jordan E." (full name in the tooltip, the side panel and the week view)
    const nm = (n = '') => { const b = n.replace(/\s*\(demo\)\s*$/i, ''); if (wrap) return b; const p = b.split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : b; };
    if (it.kind === 'outreach') return html`<a class="cal-chip cal-chip--out${wrap ? ' cal-chip--wrap' : ''}" href="#/people" tabindex="-1" title="Outreach to ${it.name} (${it.channel}, ${it.status})${it.time ? ` at ${it.time}` : ''}">${glyph('outreach')}<span class="cal-chip-t">${wrap && it.time ? html`<span class="cal-time">${it.time}</span> ` : ''}${nm(it.name)}</span></a>`;
    if (it.kind === 'followup') return html`<a class="cal-chip cal-chip--out${wrap ? ' cal-chip--wrap' : ''}" href="#/people" tabindex="-1" title="Follow up with ${it.name}: ${it.next_step || ''}">${glyph('followup')}<span class="cal-chip-t">${nm(it.name)}</span></a>`;
    const movable = it.state !== 'published';
    return html`<div class="cal-chip${wrap ? ' cal-chip--wrap' : ''}" data-id="${it.id}" data-st="${it.state}" data-q="${qTier(it.score)}" style="${q(it.score)}" ${movable ? raw('data-movable') : ''}
      title="${it.title}\n${channelLabel(it.channel, it.format)} · ${it.status.replace('_', ' ')}${it.score != null ? ` · story ${Math.round(it.score)}` : ''}${movable ? ' · drag to move' : ''}">
      ${glyph(it.state === 'published' ? 'check' : it.channel)}<span class="cal-chip-t">${shortTitle(it.title || 'Untitled')}</span></div>`;
  };

  function monthGrid(map) {
    const first = `${S.month}-01`;
    const start = mondayOf(first);
    const [y, m] = S.month.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const rows = Math.ceil((dow(first) + dim) / 7);
    const cap = rows >= 6 ? 2 : 3;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < 7; c++) {
        const day = addDays(start, r * 7 + c);
        const list = map.get(day) || [];
        const drafts = list.filter(i => i.kind === 'draft').length;
        const out = !day.startsWith(S.month);
        const open = !out && day >= today && isPostingDay(day) && !drafts;
        const shown = list.slice(0, list.length > cap ? cap - 1 : cap);
        const more = list.length - shown.length;
        const nw = news.get(day) || [];
        const label = `${dayLong(day)}${day === today ? ', today' : ''}, ${drafts ? plural(drafts, 'post') : 'no posts'}${list.length - drafts ? `, ${plural(list.length - drafts, 'outreach item')}` : ''}${open ? ', open posting day' : ''}${nw.length ? `, ${plural(nw.length, 'story', 'stories')} first seen, top score ${Math.round(nw[0].score)}` : ''}`;
        row.push(html`<div class="cal-cell${out ? ' is-out' : ''}${c > 4 ? ' is-weekend' : ''}${day === today ? ' is-today' : ''}${day === S.selected ? ' is-selected' : ''}" role="gridcell" data-cell="${day}" data-drop="${day}"
          tabindex="${day === S.selected ? 0 : -1}" aria-selected="${day === S.selected}" aria-label="${label}">
          <span class="cal-num" aria-hidden="true">${Number(day.slice(8))}${day.slice(8) === '01' ? html`<span class="cal-mon"> ${fmt(day, { month: 'short' })}</span>` : ''}</span>
          ${nw.length ? html`<span class="cal-news" aria-hidden="true" title="${plural(nw.length, 'story', 'stories')} first seen · top: ${nw[0].short_title} (${Math.round(nw[0].score)})"><i class="cal-news-q" data-q="${qTier(nw[0].score)}" style="${q(nw[0].score)}"></i>${nw.length}<span class="cal-news-w"> ${nw.length === 1 ? 'story' : 'stories'}</span></span>` : ''}
          <div class="cal-chips">${shown.map(it => chip(it, { wrap: list.length === 1 }))}${more > 0 ? html`<button type="button" class="cal-more xbtn" data-act="day" data-day="${day}" tabindex="-1" title="${list.slice(shown.length).map(x => x.title || x.name).join('\n')}">+${more} more</button>` : ''}${open ? html`<span class="cal-open" aria-hidden="true">open slot</span>` : ''}</div>
        </div>`);
      }
      cells.push(html`<div class="cal-row" role="row">${row}</div>`);
    }
    return html`<div class="cal-month" role="grid" aria-label="${monthYear(S.month)}" aria-describedby="cal-help" style="--rows:${rows}" data-grid>
      <div class="cal-row cal-dow" role="row">${WEEKDAYS.map((d, i) => html`<div class="cal-dow-c${i > 4 ? ' is-weekend' : ''}" role="columnheader"><abbr title="${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}">${d}</abbr></div>`)}</div>
      ${cells}
    </div>`;
  }

  function weekGrid(map) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(S.week, i));
    const lane = (key, label, fill) => html`<div class="cal-row cal-lane cal-lane--${key}" role="row"><div class="cal-lane-l" role="rowheader">${label}</div>${days.map((day, i) => {
      const list = map.get(day) || [];
      const body = fill(day, list);
      return html`<div class="cal-wcell${i > 4 ? ' is-weekend' : ''}${day === today ? ' is-today' : ''}${day === S.selected ? ' is-selected' : ''}" role="gridcell" data-cell="${day}" data-lane="${key}" ${key !== 'outreach' ? raw(`data-drop="${day}"`) : ''}
        tabindex="${key === 'posts' && day === S.selected ? 0 : -1}" aria-selected="${day === S.selected}" aria-label="${label}, ${dayLong(day)}: ${body.say}">${body.html}</div>`;
    })}</div>`;
    return html`<div class="cal-week" role="grid" aria-label="Week of ${dayLong(S.week)}" aria-describedby="cal-help" data-grid>
      <div class="cal-row cal-whead" role="row"><div class="cal-lane-l" role="columnheader"><span class="sr-only">Lane</span>W${isoWeek(S.week)}</div>${days.map((day, i) => html`<div class="cal-whead-c${i > 4 ? ' is-weekend' : ''}${day === today ? ' is-today' : ''}" role="columnheader"><span class="cal-wd">${WEEKDAYS[i]}</span><span class="cal-num">${Number(day.slice(8))}</span></div>`)}</div>
      ${lane('posts', 'Posts', (day, list) => { const ds = list.filter(i => i.kind === 'draft'); return { say: ds.length ? plural(ds.length, 'post') : 'none', html: html`<div class="cal-chips">${ds.map(it => chip(it, { wrap: true }))}</div>` }; })}
      ${lane('outreach', 'Outreach', (day, list) => { const os = list.filter(i => i.kind !== 'draft'); return { say: os.length ? plural(os.length, 'item') : 'none', html: html`<div class="cal-chips">${os.map(it => chip(it, { wrap: true }))}</div>` }; })}
      ${lane('slots', 'Slots', (day, list) => {
        const n = list.filter(i => i.kind === 'draft').length;
        if (!isPostingDay(day)) return { say: 'not a posting day', html: html`<span class="cal-slot is-off" aria-hidden="true">—</span>` };
        if (n) return { say: 'posting day, filled', html: html`<span class="cal-slot is-filled">${glyph('check')}filled</span>` };
        return { say: day < today ? 'posting day, missed' : 'posting day, open', html: html`<span class="cal-slot ${day < today ? 'is-missed' : 'is-open'}">${day < today ? 'missed' : 'open slot'}</span>` };
      })}
      ${lane('news', 'Stories', (day) => {
        const nw = news.get(day) || [];
        if (!nw.length) return { say: 'no stories first seen', html: html`<span class="cal-slot is-off" aria-hidden="true">—</span>` };
        return { say: `${plural(nw.length, 'story', 'stories')} first seen, top ${nw[0].short_title} at ${Math.round(nw[0].score)}`, html: html`<ul class="cal-wnews" role="list">${nw.slice(0, 3).map(x => html`<li><a href="#/story/${x.id}" tabindex="-1" title="${x.title}"><span class="cal-news-q" data-q="${qTier(x.score)}" style="${q(x.score)}" aria-hidden="true"></span><span class="cal-wnews-t">${x.short_title || x.title}</span><span class="cal-wnews-s">${Math.round(x.score)}</span></a></li>`)}</ul>${nw.length > 3 ? html`<span class="cal-wnews-more">+${nw.length - 3} more</span>` : ''}` };
      })}
    </div>`;
  }

  const draftRow = (d, { inDay = false } = {}) => {
    const state = chipState(d);
    const movable = state !== 'published';
    return html`<li class="cal-item" data-row="${d.id}">
      <span class="cal-qbar" data-q="${qTier(d.score)}" style="${q(d.score)}" aria-hidden="true"></span>
      <button type="button" class="cal-pick xbtn" data-pick="${d.id}" ${movable ? raw('data-movable') : raw('aria-disabled="true"')} data-id="${d.id}" aria-label="${draftLabel(d)}" aria-describedby="${movable ? 'cal-help' : ''}">
        ${glyph(d.channel)}
        <span class="cal-pick-main">
          ${inDay || !d.grouped ? html`<span class="cal-pick-t">${d.title || 'Untitled'}</span>` : ''}
          <span class="cal-pick-m">${channelLabel(d.channel, d.format)} <span class="cal-id">#${d.id}</span></span>
        </span>
      </button>
      <span class="cal-item-tags">${statusTag(d.status)}${d.score != null && !d.grouped ? scoreChip(d.score, th) : ''}</span>
      <span class="cal-item-acts">
        ${movable ? html`<button type="button" class="btn btn--ghost btn--sm btn--icon" data-act="menu" data-id="${d.id}" aria-label="Schedule ${shortTitle(d.title)} (#${d.id})…" title="Schedule…">${icon('calendar')}</button>` : ''}
        <a class="cal-ilink" href="#/draft/${d.id}" aria-label="Open draft #${d.id} in Studio" title="Open in Studio">${icon('arrow-up-right')}</a>
      </span>
    </li>`;
  };

  function trayList() {
    if (!S.unplanned.length) return html`<p class="cal-empty-note">Every open draft has a date. New drafts from the Feed or Today land here.</p>`;
    const groups = new Map();
    for (const d of S.unplanned) { const k = d.story_id ? `s${d.story_id}` : `t${d.title}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
    return html`${[...groups.values()].map(list => {
      if (list.length === 1) return html`<ul class="cal-items" role="list">${draftRow(list[0])}</ul>`;
      const by = list.reduce((m, d) => { m[d.channel] = (m[d.channel] || 0) + 1; return m; }, {});
      return html`<div class="cal-group">
        <div class="cal-group-h"><span class="cal-qbar" data-q="${qTier(list[0].score)}" style="${q(list[0].score)}" aria-hidden="true"></span>
          <p class="cal-group-tx"><span class="cal-group-t">${list[0].story_title || list[0].title}</span>
          <span class="cal-group-m">${plural(list.length, 'draft')} · ${Object.entries(by).map(([c, n]) => `${n} ${channelLabel(c)}`).join(', ')}</span></p>
          ${list[0].score != null ? scoreChip(list[0].score, th) : ''}</div>
        ${(() => { const key = list[0].story_id || list[0].title; const openAll = S.openGroups.has(key) || list.length <= 5; const vis = openAll ? list : list.slice(0, 4);
          return html`<ul class="cal-items" role="list">${vis.map(d => draftRow({ ...d, grouped: true }))}</ul>
          ${list.length > 5 ? html`<button type="button" class="cal-moreg xbtn" data-group="${key}" aria-expanded="${openAll}">${openAll ? 'Show fewer' : `Show ${list.length - 4} more from this story`}</button>` : ''}`; })()}
      </div>`;
    })}`;
  }

  function dayPanel(map) {
    const day = S.selected;
    const list = map.get(day) || [];
    const drafts = list.filter(i => i.kind === 'draft');
    const others = list.filter(i => i.kind !== 'draft');
    const sub = list.length
      ? `${drafts.length ? plural(drafts.length, 'post') : 'No posts'}${others.length ? ` · ${plural(others.length, 'outreach item')}` : ''}${isPostingDay(day) ? ' · posting day' : ''}`
      : `Nothing planned${isPostingDay(day) ? `. A posting day (${postingDays.join(', ')})` : ''}${day >= today ? '. Drag a draft here or use Schedule…' : '.'}`;
    return html`<section class="cal-day" aria-labelledby="cal-day-h">
      <h2 class="cal-day-h" id="cal-day-h"><time datetime="${day}">${dayLong(day)}</time>${day === today ? html` <span class="tag tag--neutral">Today</span>` : ''}</h2>
      <p class="cal-day-sub">${sub}</p>
      ${drafts.length ? html`<ul class="cal-items cal-items--day" role="list">${drafts.map(d => draftRow(d, { inDay: true }))}</ul>` : ''}
      ${others.length ? html`<ul class="cal-items cal-items--out" role="list">${others.map(o => html`<li class="cal-item cal-item--out">${glyph(o.kind === 'followup' ? 'followup' : 'outreach')}
        <a href="#/people" class="cal-out-t">${o.kind === 'followup' ? `Follow up with ${o.name}` : `Outreach to ${o.name}`}</a>
        <span class="cal-out-m">${o.kind === 'followup' ? (o.next_step || o.stage || '') : `${o.channel} · ${o.status}${o.time ? ` · ${o.time}` : ''}`}</span></li>`)}</ul>` : ''}
      ${(news.get(day) || []).length ? html`<div class="cal-newsl"><p class="cal-newsl-h">First seen this day · ${plural(news.get(day).length, 'story', 'stories')}</p>
        <ul class="cal-items" role="list">${news.get(day).slice(0, 3).map(x => html`<li class="cal-item cal-item--news"><span class="cal-qbar" data-q="${qTier(x.score)}" style="${q(x.score)}" aria-hidden="true"></span>
          <a class="cal-out-t" data-shared="title" href="#/story/${x.id}">${x.short_title || x.title}${x.is_demo ? html` <span class="tag tag--demo">Demo</span>` : ''}</a>${scoreChip(x.score, th)}</li>`)}</ul>
        ${news.get(day).length > 3 ? html`<a class="cal-newsl-more" href="#/feed">${news.get(day).length - 3} more in the Feed</a>` : ''}</div>` : ''}
    </section>`;
  }

  function historyPanel() {
    if (!S.history.length) return html`<div class="cal-hist-empty"><p class="cal-day-sub">Nothing published yet. When you publish a post, or mark one as published in Studio, it lands here and in Performance.</p></div>`;
    return html`<ul class="cal-items cal-hist" role="list">${S.history.map(h => html`<li class="cal-item">
      <span class="cal-qbar" data-q="${qTier(h.score)}" style="${q(h.score)}" aria-hidden="true"></span>
      ${glyph(h.channel)}<a class="cal-out-t" href="#/draft/${h.id}">${h.title}</a>
      <span class="cal-out-m"><time datetime="${h.published_at}">${dayShort(localDay(h.published_at))}</time> · ${channelLabel(h.channel, h.format)}</span></li>`)}</ul>`;
  }

  function cadence(map) {
    const wk = mondayOf(today);
    const weeks = [-3, -2, -1, 0].map(k => { const a = addDays(wk, 7 * k); const r = postsBetween(a, addDays(a, 6), map); return { a, ...r, cur: k === 0 }; });
    const pubTotal = weeks.reduce((s, w) => s + w.pub, 0);
    const avg = pubTotal / 4;
    return html`<section class="cal-cad" aria-labelledby="cal-cad-h">
      <div class="cal-cad-head"><h3 class="cal-cad-h" id="cal-cad-h">Cadence</h3><span class="cal-cad-goal">goal ${goal} a week · ${postingDays.join(', ')}</span></div>
      <ol class="cal-cad-weeks" role="list">${weeks.map(w => {
        const pips = Math.max(goal, w.n);
        return html`<li class="cal-cad-w${w.cur ? ' is-cur' : ''}" aria-label="${w.cur ? 'This week' : `Week ${isoWeek(w.a)}`}: ${w.pub} published, ${w.n - w.pub} planned, goal ${goal}">
          <span class="cal-pips" aria-hidden="true">${Array.from({ length: pips }, (_, i) => html`<i class="${i < w.pub ? 'is-pub' : i < w.n ? 'is-plan' : ''}"></i>`)}</span>
          <span class="cal-cad-l" aria-hidden="true">${w.cur ? 'This wk' : `W${isoWeek(w.a)}`}</span>
          <span class="cal-cad-n" aria-hidden="true">${w.n}/${goal}</span>
        </li>`;
      })}</ol>
      <p class="cal-cad-sum"><span>${pubTotal ? html`<b>${avg.toFixed(1)}</b> a week published over 4 weeks` : html`<b>0</b> published in the last 4 weeks`}</span><span class="cal-cad-k"><i class="is-pub"></i>published <i class="is-plan"></i>planned</span></p>
    </section>`;
  }

  // ---------------------------------------------------------------- page
  const el = document.createElement('div');
  el.className = 'cal';
  view.replaceChildren(el);
  const range = () => S.view === 'month' ? monthYear(S.month) : `${fmt(S.week, { day: 'numeric', month: S.week.slice(5, 7) === addDays(S.week, 6).slice(5, 7) ? undefined : 'short' })}–${fmt(addDays(S.week, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  function paint() {
    const map = byDay();
    const hl = headline(map);
    el.innerHTML = String(html`
    <header class="page-head cal-head">
      <p class="eyebrow">Editorial calendar</p>
      <h1>${hl.h}</h1>
      <p class="lede">${hl.l}</p>
    </header>
    <div class="cal-layout" data-stagger>
      <section class="tile tile--static tile--flush cal-main" aria-label="${S.view === 'month' ? 'Month' : 'Week'} plan">
        <div class="cal-bar">
          <h2 class="cal-range" aria-live="polite">${range()}</h2>
          <div class="cal-nav" role="group" aria-label="${S.view === 'month' ? 'Month' : 'Week'} navigation">
            <button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="prev" aria-label="Previous ${S.view}">${icon('chevron-left')}</button>
            <button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="next" aria-label="Next ${S.view}">${icon('chevron-right')}</button>
          </div>
          <button type="button" class="btn btn--secondary btn--sm" data-act="today">Today</button>
          <span class="cal-bar-gap"></span>
          <div class="seg cal-seg" role="radiogroup" aria-label="View" style="--i:${S.view === 'week' ? 1 : 0}"><span class="seg-thumb" aria-hidden="true"></span>
            ${[['month', 'Month'], ['week', 'Week']].map(([k, l]) => html`<button type="button" class="seg-opt" role="radio" aria-checked="${S.view === k}" data-view="${k}">${l}</button>`)}
          </div>
          ${st.ics_path ? html`<button type="button" class="btn btn--ghost btn--sm cal-ics" data-act="ics" title="Copy the calendar feed (ICS) URL for Google Calendar, Outlook or Apple Calendar">Subscribe${icon('arrow-up-right')}</button>` : ''}
        </div>
        <div class="cal-body">${S.view === 'month' ? monthGrid(map) : weekGrid(map)}</div>
        <footer class="cal-key" aria-label="Key">
          <span><i class="k k--draft"></i>draft</span><span><i class="k k--approved"></i>approved</span><span><i class="k k--scheduled"></i>scheduled</span>
          <span>${glyph('check')}published</span><span>${glyph('outreach')}outreach</span><span title="The left bar is the linked story's score against your bar of ${th}"><i class="k k--bar"></i>story score</span>
          <span class="cal-key-open"><i class="k k--open"></i>open slot</span>
        </footer>
      </section>
      <aside class="tile tile--static cal-side" aria-label="Day details and unscheduled drafts">
        <div class="seg cal-tabs" role="tablist" aria-label="Side panel" style="--i:${S.side === 'history' ? 1 : 0}"><span class="seg-thumb" aria-hidden="true"></span>
          <button type="button" class="seg-opt" role="tab" id="cal-tab-day" aria-selected="${S.side === 'day'}" aria-controls="cal-pane" data-side="day">Day &amp; tray</button>
          <button type="button" class="seg-opt" role="tab" id="cal-tab-history" aria-selected="${S.side === 'history'}" aria-controls="cal-pane" data-side="history">History${S.history.length ? html` <span class="cal-count">${S.history.length}</span>` : ''}</button>
        </div>
        <div class="cal-pane" id="cal-pane" role="tabpanel" aria-labelledby="cal-tab-${S.side}">${sidePane(map)}</div>
        ${cadence(map)}
      </aside>
    </div>
    <p class="sr-only" id="cal-help">To move a draft with the keyboard, focus it in the side panel and press Space or Enter, choose a day with the arrow keys, press Enter to drop or Escape to cancel. Each draft also has a Schedule menu.</p>
    <p class="sr-only" aria-live="assertive" id="cal-live"></p>`);
    observeHead();
  }
  const sidePane = (map) => S.side === 'history' ? historyPanel() : html`${dayPanel(map)}
    <section class="cal-tray" aria-labelledby="cal-tray-h" data-drop="">
      <div class="cal-tray-head"><h3 class="cal-tray-h" id="cal-tray-h">Unscheduled drafts</h3><span class="cal-count">${S.unplannedTotal}</span><span class="cal-tray-hint">drag onto a day</span></div>
      ${S.unplannedTotal > S.unplanned.length ? html`<p class="cal-day-sub">Showing the ${S.unplanned.length} most recently edited of ${S.unplannedTotal}.</p>` : ''}
      <div class="cal-tray-list">${S.trayReady ? trayList() : ''}</div>
    </section>`;

  // Partial repaint (state change after a move / nav / selection): body, side and head text, no re-entrance.
  function repaint({ head = true } = {}) {
    const map = byDay();
    const body = el.querySelector('.cal-body');
    const scroll = el.querySelector('.cal-tray-list')?.scrollTop || 0;
    if (body) body.innerHTML = String(S.view === 'month' ? monthGrid(map) : weekGrid(map));
    const pane = el.querySelector('#cal-pane');
    if (pane) { pane.innerHTML = String(sidePane(map)); pane.setAttribute('aria-labelledby', `cal-tab-${S.side}`); }
    const tl = el.querySelector('.cal-tray-list'); if (tl) tl.scrollTop = scroll;
    const cad = el.querySelector('.cal-cad'); if (cad) cad.outerHTML = String(cadence(map));
    el.querySelectorAll('[data-side]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.side === S.side)));
    el.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.view === S.view)));
    el.querySelector('.cal-seg')?.style.setProperty('--i', S.view === 'week' ? 1 : 0);
    el.querySelector('.cal-tabs')?.style.setProperty('--i', S.side === 'history' ? 1 : 0);
    const r = el.querySelector('.cal-range'); if (r) r.textContent = range();
    const main = el.querySelector('.cal-main'); if (main) main.setAttribute('aria-label', `${S.view === 'month' ? 'Month' : 'Week'} plan`);
    if (head) {
      const hl = headline(map);
      const h1 = el.querySelector('.page-head h1'), lede = el.querySelector('.page-head .lede');
      if (h1 && h1.textContent.trim() !== hl.h) { h1.textContent = hl.h; fadeIn(h1); }
      if (lede) { const next = String(hl.l); if (lede.innerHTML !== next) lede.innerHTML = next; }
    }
  }
  const fadeIn = (n) => { if (!reduced()) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade }); };

  // The grid height follows the page head (D: the month always fits one screen, no empty band). A
  // ResizeObserver reports the head's height after layout, so nothing forces a synchronous reflow.
  let ro = null;
  function observeHead() {
    ro?.disconnect();
    const head = el.querySelector('.page-head');
    if (!head || !('ResizeObserver' in window)) return;
    ro = new ResizeObserver(([e]) => { const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height); el.style.setProperty('--head-h', `${h}px`); });
    ro.observe(head);
  }

  paint();
  // The tray (often 20+ rows) fills one frame after the tab settles, so the route swap lays out less.
  const fillTray = () => {
    if (S.trayReady || !el.isConnected) return;
    S.trayReady = true;
    const tl = el.querySelector('.cal-tray-list');
    if (!tl) return;
    tl.innerHTML = String(trayList());
    if (!reduced()) enterItems([...tl.querySelectorAll('.cal-group, .cal-tray-list > .cal-items')].slice(0, 6), { stagger: 30, cap: 6, y: 4, duration: 380, fadeDuration: 280 });
  };
  document.addEventListener('byline:routed', function once(e) { if (e.detail?.page?.contains(el)) { document.removeEventListener('byline:routed', once); requestAnimationFrame(() => setTimeout(fillTray, 0)); } });
  setTimeout(fillTray, 1200); // fallback if the routed event never names this page
  const live = (t) => { const n = el.querySelector('#cal-live'); if (n) { n.textContent = ''; setTimeout(() => { n.textContent = t; }, 30); } };
  requestAnimationFrame(() => { if (!reduced()) enterItems(el.querySelectorAll('.cal-body .cal-chip, .cal-day .cal-item'), { stagger: 14, cap: 18, delay: 260, y: 4, duration: 420, fadeDuration: 320 }); });

  // ---------------------------------------------------------------- navigation
  async function go({ month = S.month, week = S.week, selected = S.selected, focus = false } = {}) {
    S.month = month; S.week = week; S.selected = selected;
    await ensureMonths(neededMonths());
    if (!el.isConnected) return;
    repaint();
    if (focus) focusCell(S.selected);
  }
  const focusCell = (day) => {
    const lane = S.view === 'week' ? '[data-lane="posts"]' : '';
    const c = el.querySelector(`[data-cell="${day}"]${lane}`);
    if (!c) return;
    el.querySelectorAll('[data-grid] [data-cell][tabindex="0"]').forEach(x => { x.tabIndex = -1; });
    c.tabIndex = 0; c.focus({ preventScroll: false });
  };
  function step(n) {
    if (S.view === 'month') { const m = shiftMonth(S.month, n); const sel = m === today.slice(0, 7) ? today : `${m}-01`; go({ month: m, selected: sel, week: mondayOf(sel) }); }
    else { const w = addDays(S.week, 7 * n); const sel = w <= today && today <= addDays(w, 6) ? today : w; go({ week: w, month: sel.slice(0, 7), selected: sel }); }
  }
  function select(day, { focus = false } = {}) {
    S.selected = day;
    if (S.view === 'month' && !day.startsWith(S.month)) return go({ month: day.slice(0, 7), selected: day, week: mondayOf(day), focus });
    if (S.view === 'week' && (day < S.week || day > addDays(S.week, 6))) return go({ week: mondayOf(day), month: day.slice(0, 7), selected: day, focus });
    S.week = mondayOf(day);
    el.querySelectorAll('[data-cell]').forEach(c => { const on = c.dataset.cell === day; c.classList.toggle('is-selected', on); c.setAttribute('aria-selected', String(on)); });
    if (S.side !== 'day') { S.side = 'day'; }
    const pane = el.querySelector('#cal-pane');
    if (pane) { const scroll = el.querySelector('.cal-tray-list')?.scrollTop || 0; pane.innerHTML = String(sidePane(byDay())); const tl = el.querySelector('.cal-tray-list'); if (tl) tl.scrollTop = scroll; fadeIn(pane.querySelector('.cal-day')); }
    el.querySelectorAll('[data-side]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.side === S.side)));
    el.querySelector('.cal-tabs')?.style.setProperty('--i', 0);
    if (focus) focusCell(day);
  }

  on(el, 'click', '[data-act="prev"]', () => step(-1));
  on(el, 'click', '[data-act="next"]', () => step(1));
  on(el, 'click', '[data-act="today"]', () => go({ month: today.slice(0, 7), week: mondayOf(today), selected: today }));
  on(el, 'click', '[data-act="ics"]', () => copy(`${location.origin}${st.ics_path}`));
  on(el, 'click', '[data-view]', (e, b) => {
    if (S.view === b.dataset.view) return;
    S.view = b.dataset.view;
    try { localStorage.setItem('byline-cal-view', S.view); } catch (err) { /* storage unavailable */ }
    S.week = mondayOf(S.selected);
    go().then(() => { if (!reduced()) enterItems(el.querySelectorAll('.cal-body [role=row]'), { stagger: 24, y: 4, duration: 360, fadeDuration: 260 }); });
  });
  on(el, 'click', '[data-side]', (e, b) => { S.side = b.dataset.side; repaint({ head: false }); });
  on(el, 'click', '[data-act="day"]', (e, b) => { e.stopPropagation(); select(b.dataset.day); });
  on(el, 'click', '[data-group]', (e, b) => { const k = /^\d+$/.test(b.dataset.group) ? Number(b.dataset.group) : b.dataset.group; S.openGroups.has(k) ? S.openGroups.delete(k) : S.openGroups.add(k); repaint({ head: false }); el.querySelector(`[data-group="${b.dataset.group}"]`)?.focus(); });
  on(el, 'click', '[data-act="menu"]', (e, b) => scheduleMenu(Number(b.dataset.id), b));
  // a click on a cell (not a chip drag) selects the day; a chip click selects its day and highlights its row
  on(el, 'click', '[data-cell]', (e, c) => {
    if (suppressClick) return;
    const chipEl = e.target.closest('.cal-chip[data-id]');
    select(c.dataset.cell);
    if (chipEl) { const row = el.querySelector(`.cal-day [data-row="${chipEl.dataset.id}"]`); row?.classList.add('is-flash'); setTimeout(() => row?.classList.remove('is-flash'), 900); }
  });
  on(el, 'dblclick', '.cal-chip[data-id]', (e, c) => { location.hash = `#/draft/${c.dataset.id}`; });
  // pointer click on a draft row (no drag) opens it in Studio; keyboard Enter/Space picks it up (below)
  on(el, 'click', '.cal-pick', (e, b) => { if (suppressClick || b.dataset.kbd) { delete b.dataset.kbd; return; } location.hash = `#/draft/${b.dataset.pick}`; });

  // ---------------------------------------------------------------- the move (optimistic + undo)
  const findDraft = (id) => S.drafts.get(id) || S.unplanned.find(d => d.id === id) || null;
  function setDate(id, date) {
    const d = findDraft(id); if (!d) return;
    S.unplanned = S.unplanned.filter(x => x.id !== id);
    if (date) { S.drafts.set(id, { ...d, planned_date: date }); }
    else { S.drafts.delete(id); S.unplanned = [{ ...d, planned_date: null }, ...S.unplanned]; }
  }
  function countFix(wasPlanned, nowPlanned) { if (wasPlanned && !nowPlanned) S.unplannedTotal += 1; if (!wasPlanned && nowPlanned) S.unplannedTotal = Math.max(0, S.unplannedTotal - 1); }

  async function move(id, date, { fromRect = null, quiet = false, focus = null } = {}) {
    const d = findDraft(id);
    if (!d) return;
    const prev = d.planned_date ? d.planned_date.slice(0, 10) : null;
    if ((prev || null) === (date || null)) { if (focus) focusCell(focus); return; }
    if (d.status === 'published') { toast('Published posts cannot be moved.', 'err'); return; }
    const snapshot = { drafts: new Map(S.drafts), unplanned: [...S.unplanned], total: S.unplannedTotal };
    const apply = () => {
      setDate(id, date); countFix(!!prev, !!date);
      if (date && S.view === 'month' && !date.startsWith(S.month)) { /* keep the view; the side panel shows the day */ }
      if (date) S.selected = date;
      repaint();
      landing(id, fromRect);
      if (focus) focusCell(focus);
    };
    const revert = () => { S.drafts = snapshot.drafts; S.unplanned = snapshot.unplanned; S.unplannedTotal = snapshot.total; repaint(); };
    try {
      await optimistic({ apply, commit: () => api.post(`/drafts/${id}/plan`, { date: date || null }), revert });
    } catch (e) { return; }
    if (quiet) return;
    const name = `“${shortTitle(d.title || 'Untitled')}” (#${id})`;
    toast(date ? `Planned ${name} for ${dayShort(date)}` : `Moved ${name} back to the tray`, 'ok', {
      undo: { revert: () => { move(id, prev, { quiet: true }).then(() => toast(prev ? `Back on ${dayShort(prev)}` : 'Back in the tray', '')); } }
    });
    live(date ? `Dropped on ${dayLong(date)}. Undo with Control Z.` : 'Moved back to the tray. Undo with Control Z.');
  }
  // the moved chip glides from where it was dropped (transform + opacity only)
  function landing(id, fromRect) {
    const target = el.querySelector(`.cal-body .cal-chip[data-id="${id}"]`) || el.querySelector(`.cal-tray [data-row="${id}"]`);
    if (!target || reduced()) return;
    if (fromRect) {
      const r = target.getBoundingClientRect();
      target.animate([{ transform: `translate(${fromRect.left - r.left}px, ${fromRect.top - r.top}px)`, opacity: .9 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: EASE.move });
    } else target.animate([{ opacity: .2, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE.settle });
  }

  // ---------------------------------------------------------------- Schedule… menu (plan / approval-gated schedule / tray)
  async function scheduleMenu(id, opener) {
    const d = findDraft(id);
    if (!d) return;
    const approved = d.status === 'approved' || d.status === 'scheduled' || d.approved;
    const planned = d.planned_date ? d.planned_date.slice(0, 10) : null;
    let slotDate = S.nextSlot;
    if (d.channel !== 'linkedin') slotDate = (await api.get(`/slots/next?channel=${d.channel}`).catch(() => ({}))).date || null;
    const m = modal(String(html`<h2>Schedule…</h2>
      <p class="cal-m-sub">${d.title || 'Untitled'}</p>
      <p class="cal-m-meta">${channelLabel(d.channel, d.format)} · #${d.id} · ${statusTag(d.status)}${planned ? html` · planned for ${dayShort(planned)}` : ' · unscheduled'}</p>
      <label class="field cal-m-field">Date<input class="input" type="date" id="cal-m-date" value="${planned || slotDate || today}" min="${today.slice(0, 4)}-01-01"></label>
      <div class="cluster cal-m-quick">
        ${slotDate ? html`<button type="button" class="chip chip--filter" data-quick="${slotDate}">Next open slot · ${dayShort(slotDate)}</button>` : ''}
        <button type="button" class="chip chip--filter" data-quick="${today}">Today</button>
        <button type="button" class="chip chip--filter" data-quick="${addDays(today, 1)}">Tomorrow</button>
        ${postingDays.map(pd => { let x = addDays(today, 1); while (WEEKDAYS[dow(x)] !== pd) x = addDays(x, 1); return x; }).sort().slice(0, 3).filter(x => x !== slotDate && x !== addDays(today, 1)).map(x => html`<button type="button" class="chip chip--filter" data-quick="${x}">${dayShort(x)}</button>`)}
      </div>
      <p class="cal-m-note">${approved ? 'Plan only changes the date. Schedule for publishing also marks it scheduled; the approval covers this exact text and media.' : 'Planning changes only the date and keeps the draft’s status. Scheduling it for publishing needs approval in Studio first.'}</p>
      <div class="modal-actions cal-m-actions">
        ${planned ? html`<button type="button" class="btn btn--ghost" data-m="tray">Move to tray</button>` : ''}
        <span class="cal-m-gap"></span>
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="button" class="btn ${approved ? 'btn--secondary' : 'btn--primary'}" data-m="plan">Plan for this date</button>
        ${approved ? html`<button type="button" class="btn btn--primary" data-m="schedule">Schedule for publishing</button>` : ''}
      </div>`));
    const input = m.el.querySelector('#cal-m-date');
    on(m.el, 'click', '[data-quick]', (e, b) => { input.value = b.dataset.quick; m.el.querySelectorAll('[data-quick]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    on(m.el, 'click', '[data-m]', async (e, b) => {
      const date = input.value;
      if (b.dataset.m === 'tray') { m.close(); return move(id, null, { focus: null }); }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date first.', 'err'); return; }
      if (b.dataset.m === 'plan') { m.close(); return move(id, date); }
      if (b.dataset.m === 'schedule') {
        b.disabled = true;
        try {
          await api.post(`/drafts/${id}/schedule`, { date });
          m.close();
          setDate(id, date); const cur = findDraft(id); if (cur) S.drafts.set(id, { ...cur, status: 'scheduled', planned_date: date });
          countFix(!!planned, true); S.selected = date; repaint(); landing(id);
          toast(`Scheduled for ${dayShort(date)}: it will publish from Studio’s approved version`, 'ok');
        } catch (err) { b.disabled = false; toast(err.message, 'err'); }
      }
    });
    void opener;
  }

  // ---------------------------------------------------------------- keyboard: roving grid + pick-up twin
  function cellsList() { return [...el.querySelectorAll(S.view === 'week' ? '[data-grid] [data-cell]' : '[data-grid] [data-cell]')]; }
  el.addEventListener('keydown', (e) => {
    if (inField(e)) return;
    const cell = e.target.closest?.('[data-grid] [data-cell]');
    // Esc cancels a carry from anywhere
    if (e.key === 'Escape' && S.carry) { e.preventDefault(); cancelCarry(); return; }
    // pick up from a draft row
    const pick = e.target.closest?.('.cal-pick[data-movable]');
    if (pick && (e.key === ' ' || e.key === 'Enter') && !S.carry) { e.preventDefault(); pick.dataset.kbd = '1'; startCarry(Number(pick.dataset.pick), pick); return; }
    if (!cell) return;
    const cells = cellsList();
    const i = cells.indexOf(cell);
    const day = cell.dataset.cell;
    const keyDelta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (keyDelta !== undefined) {
      e.preventDefault();
      if (S.view === 'week' && Math.abs(keyDelta) === 7) {
        const j = i + keyDelta; if (cells[j]) { rove(cells[j]); } return;
      }
      const target = addDays(day, keyDelta);
      const t = el.querySelector(`[data-grid] [data-cell="${target}"]${S.view === 'week' ? `[data-lane="${cell.dataset.lane}"]` : ''}`);
      if (t) rove(t);
      else { if (S.view === 'month') go({ month: target.slice(0, 7), selected: S.carry ? S.selected : target, week: mondayOf(target) }).then(() => focusCell(target)); else go({ week: mondayOf(target), month: target.slice(0, 7), selected: S.carry ? S.selected : target }).then(() => focusCell(target)); }
      if (S.carry) live(`Over ${dayLong(target)}`);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const row = cell.closest('[role=row]'); const rc = [...row.querySelectorAll('[data-cell]')]; rove(e.key === 'Home' ? rc[0] : rc[rc.length - 1]); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); step(e.key === 'PageUp' ? -1 : 1); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (S.carry) { const c = S.carry; S.carry = null; el.classList.remove('is-carrying'); el.querySelectorAll('.is-target').forEach(x => x.classList.remove('is-target')); move(c.id, day, { focus: day }); return; }
      select(day, { focus: true });
      const n = (byDay().get(day) || []).length;
      live(`${dayLong(day)} selected${n ? `, ${plural(n, 'item')} listed in the side panel` : ''}.`);
    }
  });
  function rove(target) {
    el.querySelectorAll('[data-grid] [data-cell][tabindex="0"]').forEach(x => { x.tabIndex = -1; });
    target.tabIndex = 0; target.focus();
    if (S.carry) { el.querySelectorAll('.is-target').forEach(x => x.classList.remove('is-target')); target.classList.add('is-target'); }
  }
  function startCarry(id, origin) {
    const d = findDraft(id); if (!d) return;
    S.carry = { id, origin: `[data-pick="${id}"]` };
    el.classList.add('is-carrying');
    el.querySelectorAll(`[data-pick="${id}"]`).forEach(x => x.closest('.cal-item')?.classList.add('is-carried'));
    const start = d.planned_date ? d.planned_date.slice(0, 10) : (S.selected || today);
    const lane = S.view === 'week' ? '[data-lane="posts"]' : '';
    let c = el.querySelector(`[data-grid] [data-cell="${start}"]${lane}`) || el.querySelector(`[data-grid] [data-cell="${S.selected}"]${lane}`) || el.querySelector(`[data-grid] [data-cell]${lane}`);
    if (c) { rove(c); c.classList.add('is-target'); }
    live(`Picked up ${shortTitle(d.title)}, number ${id}. Arrow keys choose a day, Enter drops, Escape cancels.`);
    void origin;
  }
  function cancelCarry() {
    const c = S.carry; S.carry = null;
    el.classList.remove('is-carrying');
    el.querySelectorAll('.is-target').forEach(x => x.classList.remove('is-target'));
    el.querySelectorAll('.is-carried').forEach(x => x.classList.remove('is-carried'));
    el.querySelector(c?.origin)?.focus();
    live('Move cancelled.');
  }

  // ---------------------------------------------------------------- pointer drag (mouse + touch long-press)
  let drag = null, suppressClick = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary || S.carry) return;
    const src = e.target.closest('[data-movable]');
    if (!src || e.target.closest('.cal-item-acts')) return;
    drag = { id: Number(src.dataset.id || src.dataset.pick), src, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', armed: e.pointerType === 'mouse', on: false, pid: e.pointerId, timer: 0 };
    if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.on) { drag.armed = true; begin(); navigator.vibrate?.(8); } }, 340);
  });
  function begin() {
    const r = drag.src.getBoundingClientRect();
    drag.on = true; drag.ox = drag.x - r.left; drag.oy = drag.y - r.top;
    const g = document.createElement('div');
    const d = findDraft(drag.id);
    g.className = 'cal-ghost';
    g.innerHTML = String(html`${glyph(d?.channel)}<span>${shortTitle(d?.title || 'Untitled')}</span>`);
    g.style.width = `${Math.min(280, Math.max(160, r.width))}px`;
    document.body.append(g);
    drag.ghost = g;
    try { drag.src.setPointerCapture(drag.pid); } catch (err) { /* gone */ }
    drag.src.closest('.cal-item, .cal-chip')?.classList.add('is-lifted');
    el.classList.add('is-dragging');
    place();
  }
  function place() {
    if (!drag?.ghost) return;
    drag.ghost.style.transform = `translate3d(${drag.x - drag.ox}px, ${drag.y - drag.oy}px, 0)`;
    const hit = document.elementFromPoint(drag.x, drag.y)?.closest?.('[data-drop]');
    const tgt = hit && el.contains(hit) ? hit : null;
    if (tgt !== drag.tgt) { drag.tgt?.classList.remove('is-target'); tgt?.classList.add('is-target'); drag.tgt = tgt; }
  }
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.x = e.clientX; drag.y = e.clientY;
    const dist = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
    if (!drag.on) {
      if (drag.touch && !drag.armed && dist > 8) { clearTimeout(drag.timer); drag = null; return; } // a scroll, not a drag
      if (drag.armed && dist > 5) begin();
      return;
    }
    place();
  });
  // while a touch drag is live, stop the page from scrolling
  el.addEventListener('touchmove', (e) => { if (drag?.on) e.preventDefault(); }, { passive: false });
  const end = (cancel) => {
    if (!drag) return;
    clearTimeout(drag.timer);
    const dd = drag; drag = null;
    if (!dd.on) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    el.classList.remove('is-dragging');
    dd.src.closest('.cal-item, .cal-chip')?.classList.remove('is-lifted');
    const fromRect = dd.ghost.getBoundingClientRect();
    dd.ghost.remove();
    dd.tgt?.classList.remove('is-target');
    if (cancel || !dd.tgt) return;
    move(dd.id, dd.tgt.dataset.drop || null, { fromRect });
  };
  el.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pid) end(false); });
  el.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pid) end(true); });
  el.addEventListener('lostpointercapture', (e) => { if (drag?.on && e.pointerId === drag.pid) end(false); });
  el.addEventListener('contextmenu', (e) => { if (drag?.armed) e.preventDefault(); });
  el.addEventListener('dragstart', (e) => { if (e.target.closest?.('[data-movable]')) e.preventDefault(); });
}
