// Today (SPEC §5, DECISIONS, C §2 choreography, F §2 headline templates).
// Every figure comes from the API: /api/today, /api/status, /api/settings, /api/stories?days=window,
// /api/map, /api/calendar, /api/slots/next. The threshold always comes from the payload (never hard-coded).
//
// Layout (12 cols desktop, stacked on phone, DOM order = phone order):
//   lead tile (7) | S1 + S2 (5)
//   News weather (7) | News map (5)
//   S3 (4) | This week (4) | Waiting on you (4)
//   Also in the brief (12, only when the brief has more than 4 stories)
//
// Motion: the shell runs enterHeading on the h1 and fades the run strip (enter-item). The tiles live
// outside the head's parent on purpose, so this view owns their choreography (C §2) and starts it on the
// router's `byline:routed` event, the moment the page becomes visible.

import { api } from '../api.js';
import { html, raw, esc, on, act, toast, modal, icon, scoreRing, scoreChip, demoFlag, channelLabel, status as statusTag, useStyle, reducedMotion } from '../ui.js';
import { EASE, countTo } from '../motion.js';
import { qualityColor, qualityTier, qualityLabel } from '../quality.js';
import bg from '../bg.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round = (n) => Math.round(Number(n) || 0);
const listJoin = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const fmtDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
const ymdAdd = (ymd, d) => new Date(Date.parse(`${ymd}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
const dowOf = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

/** A finding line with its number marks (API: [start, end) UTF-16 pairs; each slice escaped). */
function marked(text, marks) {
  const t = String(text || '');
  if (!Array.isArray(marks) || !marks.length) return html`${t}`;
  let out = '', at = 0;
  for (const [a, b] of marks) {
    if (a < at || b > t.length || b <= a) continue;
    out += esc(t.slice(at, a)) + `<mark class="num-hl">${esc(t.slice(a, b))}</mark>`;
    at = b;
  }
  return raw(out + esc(t.slice(at)));
}

/** "Why it ranked": the server's three plain-language bullets, or a plain fallback from `explanation`. */
function whyOf(it) {
  if (Array.isArray(it.why) && it.why.length) return it.why.slice(0, 3);
  return String(it.explanation || '').split(' · ').filter(s => !/credible independent/i.test(s)).slice(0, 3)
    .map(s => s.replace(/^Matches /, 'Fits ').replace(/ \([^)]*\)/g, '').replace(/^watchlist: /, 'Touches your watchlist: ').replace(/^practical signals: /, 'Mentions '));
}

// ------------------------------------------------------------------ F §2 Today templates
function headline(t, items) {
  const T = t.threshold;
  const tc = t.topic_counts || [];
  const byTopic = (name) => tc.find(x => x.topic === name);
  if (!items.length) return { h: 'No brief yet.', l: html`Run a collection or add a story URL.${t.sources_total && t.sources_paused >= t.sources_total ? html` All <b>${t.sources_total}</b> sources are paused.` : ''}` };
  const brief = t.is_today ? 'today’s brief' : 'the brief';
  const tail = t.is_today ? '' : ' No run yet today.';
  if (!t.cleared) {
    const top = t.top;
    return { h: `Nothing cleared your bar of ${T}.`, l: html`<b>${t.ranked}</b> ranked; the closest was ${top ? html`<b>${top.short_title || top.title}</b> at <b>${round(top.score)}</b>` : 'none'}.${tail}` };
  }
  const t1 = byTopic(t.headline_topic), t2 = byTopic(t.second_topic);
  const top = t.top;
  let h;
  if (t1 && t2 && t2.count > 0 && Math.abs(t1.count - t2.count) <= 1) h = `${t1.topic} and ${t2.topic} split ${brief}.`;
  else if (t1 && t1.share >= 0.5) h = `${t1.topic} dominates ${brief}.`;
  else if (top && top.score >= T + 15) h = `${top.short_title || top.title} tops ${brief} at ${round(top.score)}.`;
  else if (t1) h = `${t1.topic} leads ${brief}.`;
  else h = `${t.cleared} of ${t.ranked} stories cleared your bar.`;
  const l = html`<b>${t.cleared}</b> of <b>${t.ranked}</b> ranked stories cleared your threshold of <b>${T}</b>.${t1 ? html` ${t1.topic} is in <b>${t1.count}</b> of them${t2 ? html`; ${t2.topic} in <b>${t2.count}</b>` : ''}.` : ''}${top ? html` Top: <b>${top.short_title || top.title}</b> at <b>${round(top.score)}</b>, ${top.evidence_qualifier}.` : ''}${tail}`;
  return { h, l };
}

// ------------------------------------------------------------------ tiles
const pills = (it, max = 3) => {
  const topics = it.topics || [];
  const main = it.main_topic || topics[0];
  const rest = topics.filter(x => x !== main).slice(0, max - 1);
  return main ? html`<div class="td-pills cluster">${html`<span class="chip chip--main" data-shared="topic">${main}</span>`}${rest.map(x => html`<span class="chip chip--topic">${x}</span>`)}</div>` : '';
};
const storyHref = (it) => `#/story/${it.story_id ?? it.id}`;

function leadTile(it, T) {
  const why = whyOf(it);
  return html`
  <article class="tile tile--lead td-lead" data-dossier-src data-tile="lead" aria-labelledby="td-lead-title">
    ${pills(it, 3)}
    <div class="td-lead-top">
      <div class="td-lead-main">
        <h2 class="td-title-lg" id="td-lead-title"><a class="td-stretch" href="${storyHref(it)}" data-shared="title">${it.title}</a>${demoFlag(it.is_demo)}</h2>
      </div>
      <div class="td-lead-ring">${scoreRing(it.score, T, { size: 108, count: true, key: `today-lead-${it.story_id}` })}</div>
    </div>
    ${it.finding ? html`<p class="td-dek">${marked(it.finding, it.finding_marks)}</p>` : ''}
    ${why.length ? html`<div class="td-why">
      <h3 class="td-label">Why it ranked</h3>
      <ul>${why.map(w => html`<li>${w}</li>`)}</ul>
    </div>` : ''}
    ${(it.companies || []).length ? html`<div class="td-named"><h3 class="td-label">Named</h3><span class="cluster">${it.companies.slice(0, 4).map(c => html`<span class="td-domain">${c}</span>`)}${it.companies.length > 4 ? html`<span class="td-meta">+${it.companies.length - 4}</span>` : ''}</span></div>` : ''}
    <footer class="td-lead-foot">
      <span class="td-src" title="Posts are articles; outlets are distinct sites; independent means reporting or research from a site other than the origin’s.">${it.source_line || ''}</span>
      ${it.origin_domain ? html`<span class="td-domain">${it.origin_domain}</span>` : ''}
      <span class="td-open" aria-hidden="true">Open dossier ${icon('arrow-right')}</span>
    </footer>
  </article>`;
}

function storyTile(it, T, { rank, size = 'md', why = false, maxPills = 2 }) {
  const bullets = why ? whyOf(it) : [];
  return html`
  <article class="tile td-story td-story--${size}" data-dossier-src data-tile="s${rank}" aria-labelledby="td-s${rank}">
    <div class="td-story-top">
      ${pills(it, maxPills)}
      ${scoreRing(it.score, T, { size: size === 'lg' ? 64 : 52, label: false, count: true, key: `today-s-${it.story_id}` })}
    </div>
    <h2 class="td-title ${size === 'lg' ? 'td-title--lg' : ''}" id="td-s${rank}"><a class="td-stretch" href="${storyHref(it)}" data-shared="title">${it.title}</a>${demoFlag(it.is_demo)}</h2>
    ${it.finding ? html`<p class="td-finding">${marked(it.finding, it.finding_marks)}</p>` : ''}
    ${bullets.length ? html`<div class="td-why td-why--sm"><h3 class="td-label">Why it ranked</h3><ul>${bullets.map(w => html`<li>${w}</li>`)}</ul></div>` : ''}
    <footer class="td-story-foot"><span class="td-src">${it.source_line || ''}</span><span class="td-q">${qualityLabel(it.score, T)}</span></footer>
  </article>`;
}

// News weather (Edition's chart, rebuilt on real data): one row per topic, one dot per ranked story in
// the window, placed on a 0–100 score axis. HOT / WARM / CALM use F's "dominates" share on cleared stories.
function weatherModel(stories, t) {
  const T = t.threshold;
  const cleared = stories.filter(s => s.score >= T);
  const nCleared = cleared.length;
  const rows = new Map();
  for (const s of stories) for (const tp of (s.topics || [])) {
    if (!rows.has(tp)) rows.set(tp, { topic: tp, stories: [] });
    rows.get(tp).stories.push(s);
  }
  const weightOf = Object.fromEntries((t.topic_counts || []).map(x => [x.topic, x.weighted]));
  const list = [...rows.values()].map(r => {
    const above = r.stories.filter(s => s.score >= T).length;
    const share = nCleared ? above / nCleared : 0;
    const label = above && share >= 0.5 ? 'hot' : above ? 'warm' : 'calm';
    return { ...r, above, share, label, weighted: weightOf[r.topic] ?? 0, stories: r.stories.slice().sort((a, b) => a.score - b.score) };
  }).sort((a, b) => b.weighted - a.weighted || b.above - a.above || b.stories.length - a.stories.length || a.topic.localeCompare(b.topic));
  return { rows: list.slice(0, 8), more: Math.max(0, list.length - 8), total: stories.length, nCleared, T };
}

function weatherTile(stories, t) {
  const m = weatherModel(stories, t);
  if (!m.total) return html`<section class="tile tile--static td-wx" data-tile="weather" aria-labelledby="td-wx-h"><div class="td-tile-head"><h2 class="td-h2" id="td-wx-h">News weather</h2></div>
    <div class="empty"><h3>No ranked stories this week</h3><p>The chart fills in after a run ranks stories from the last ${t.window_days || 7} days.</p></div></section>`;
  const hot = m.rows.filter(r => r.label === 'hot').map(r => r.topic);
  const calm = m.rows.filter(r => r.label === 'calm').map(r => r.topic);
  const sentence = hot.length
    ? html`<b>${listJoin(hot)}</b> ${hot.length === 1 ? 'runs' : 'run'} hot${calm.length ? html`; ${listJoin(calm.slice(0, 2))} ${calm.length === 1 ? 'is' : 'are'} calm` : ''}.`
    : html`No topic is in half of the ${m.nCleared} stories above your bar.`;
  const th = Math.max(0, Math.min(100, m.T));
  return html`
  <section class="tile td-wx" data-tile="weather" aria-labelledby="td-wx-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-wx-h">News weather</h2>
      <button type="button" class="btn btn--ghost btn--sm td-wx-toggle" aria-pressed="false" aria-controls="td-wx-table">Show as table</button>
    </div>
    <p class="td-sub">${sentence}</p>
    <div class="td-wx-chart" aria-hidden="true" style="--th:${th / 100}">
      <div class="td-wx-axis"><span class="td-wx-bar-label" style="--x:${th / 100}">bar ${m.T}</span></div>
      ${m.rows.map((r) => html`
      <div class="td-wx-row" data-label="${r.label}">
        <span class="td-wx-name">${r.topic}</span>
        <span class="td-wx-track">
          ${r.stories.map((s, k) => {
            const prev = r.stories[k - 1];
            const near = prev && Math.abs(s.score - prev.score) < 2.6;
            const lift = near ? (k % 2 ? -4 : 4) : 0;
            return html`<a class="td-wx-dot" href="#/story/${s.id}" tabindex="-1" data-dossier-src data-s="${s.id}" data-q="${qualityTier(s.score, m.T)}" data-q-score="${s.score}" data-q-threshold="${m.T}" style="--x:${Math.max(0, Math.min(100, s.score)) / 100};--lift:${lift}px;--q:${qualityColor(s.score, m.T)}"><span class="td-wx-tip">${s.short_title || s.title} · ${round(s.score)}</span></a>`;
          })}
        </span>
        <span class="td-wx-label">${r.label.toUpperCase()}</span>
      </div>`)}
      <div class="td-wx-scale"><span>0</span><span>50</span><span>100</span></div>
    </div>
    <table class="td-wx-table sr-only" id="td-wx-table">
      <caption>News weather: ${m.total} ranked stories from the last ${t.window_days || 7} days by topic. Threshold ${m.T}.</caption>
      <thead><tr><th scope="col">Topic</th><th scope="col">Stories</th><th scope="col">Above ${m.T}</th><th scope="col">Scores</th><th scope="col">Weather</th></tr></thead>
      <tbody>${m.rows.map(r => html`<tr><th scope="row">${r.topic}</th><td class="num">${r.stories.length}</td><td class="num">${r.above}</td><td>${r.stories.slice().reverse().map(s => round(s.score)).join(', ')}</td><td>${r.label}</td></tr>`)}</tbody>
    </table>
    <p class="td-caption">Each dot is one of the <b>${m.total}</b> stories ranked in the last ${t.window_days || 7} days, placed by score; filled dots cleared your bar. <b>Hot</b>: in half or more of the ${m.nCleared} above it · <b>Warm</b>: in at least one · <b>Calm</b>: none.${m.more ? ` ${plural(m.more, 'smaller topic')} not shown.` : ''}</p>
  </section>`;
}

// News map: the Map tab's engine when present (map-engine.js → mountMiniMap), else a static drawing of the
// same /api/map layout. The top-3 hot regions always sit beside it.
function mapTile(map, t) {
  const hot = map?.hot_topics || [];
  const n = map?.nodes?.length || 0;
  const list = hot.length ? html`<ol class="td-hot">${hot.slice(0, 3).map((h, i) => html`
      <li><a href="#/map" class="td-hot-row"><span class="td-hot-rank">${i + 1}</span><span class="td-hot-name">${h.topic}</span><span class="td-hot-meta">${plural(h.count, 'story', 'stories')}${h.recent != null ? html` · ${h.recent} this week` : ''}</span>
        <span class="meter td-hot-meter" title="Heat ${Number(h.heat).toFixed(2)}: recent stories weighted by score, hottest region = 1"><i style="--v:${Math.max(0.04, Math.min(1, h.heat))}"></i></span></a></li>`)}</ol>`
    : html`<p class="td-sub">No topic regions yet.</p>`;
  return html`
  <section class="tile td-map" data-tile="map" aria-labelledby="td-map-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-map-h">News map</h2>
      <a class="btn btn--ghost btn--sm" href="#/map">Open map ${icon('arrow-right')}</a>
    </div>
    <div class="td-map-body">
      <a class="td-map-canvas" href="#/map" aria-label="Open the Map: ${n} stories in ${map?.clusters?.length || 0} topic regions">${staticMap(map, t.threshold)}</a>
      <div class="td-map-side">
        <h3 class="td-label" id="td-hot-h">Hottest regions</h3>
        ${list}
        ${n ? html`<p class="td-caption">${plural(n, 'story', 'stories')}, ${plural(map.edges?.length || 0, 'connection')}. Heat counts this week’s stories, weighted by score.</p>` : ''}
      </div>
    </div>
  </section>`;
}

function staticMap(map, T) {
  if (!map?.nodes?.length || !map.bounds) return html`<span class="td-map-empty">The map fills in as runs collect stories.</span>`;
  const b = map.bounds, pad = 18;
  const vb = `${(b.x0 - pad).toFixed(1)} ${(b.y0 - pad).toFixed(1)} ${(b.x1 - b.x0 + pad * 2).toFixed(1)} ${(b.y1 - b.y0 + pad * 2).toFixed(1)}`;
  const pos = new Map(map.nodes.map(nd => [nd.id, nd]));
  const hot = new Set((map.hot_topics || []).slice(0, 3).map(h => h.topic));
  const edges = (map.edges || []).map(e => { const a = pos.get(e.a), c = pos.get(e.b); return a && c ? `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${c.x.toFixed(1)} ${c.y.toFixed(1)}` : ''; }).join('');
  const W = b.x1 - b.x0 + pad * 2, H = b.y1 - b.y0 + pad * 2;
  // label positions (normalised), nudged apart so two region names never sit on top of each other
  const labels = (map.clusters || []).filter(c => hot.has(c.topic)).map(c => ({ label: c.label, x: (c.x - b.x0 + pad) / W, y: (c.y - b.y0 + pad) / H })).sort((p, q) => p.y - q.y);
  for (let i = 1; i < labels.length; i++) for (let j = 0; j < i; j++) {
    const a = labels[j], c = labels[i];
    if (Math.abs(a.x - c.x) < 0.4 && c.y - a.y < 0.15) c.y = a.y + 0.15;
  }
  labels.forEach(l => { l.x = Math.min(0.8, Math.max(0.2, l.x)); l.y = Math.min(0.92, Math.max(0.08, l.y)); });
  return raw(`<svg class="td-map-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <g class="td-map-regions">${(map.clusters || []).filter(c => hot.has(c.topic)).map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${Math.max(40, Math.min(c.radius, 150)).toFixed(1)}" style="opacity:${(0.35 + 0.65 * (c.heat || 0)).toFixed(2)}"/>`).join('')}</g>
    <path class="td-map-edges" d="${edges}"/>
    <g class="td-map-nodes">${map.nodes.map(nd => `<circle cx="${nd.x.toFixed(1)}" cy="${nd.y.toFixed(1)}" r="${(nd.r * 0.62).toFixed(1)}" data-q="${qualityTier(nd.score, T)}" data-q-score="${nd.score}" data-q-threshold="${T}" style="--q:${qualityColor(nd.score, T)}"/>`).join('')}</g>
  </svg>${labels.map(l => `<span class="td-map-label" style="--x:${l.x.toFixed(3)};--y:${l.y.toFixed(3)}">${esc(l.label)}</span>`).join('')}`);
}

// This week: planned + published posts in the Mon–Sun week, cadence against the posting days in settings.
function weekModel(t, settings, cals, slot) {
  const today = t.today || t.date;
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const start = ymdAdd(today, -dow);
  const days = Array.from({ length: 7 }, (_, i) => ymdAdd(start, i));
  const inWeek = (d) => d && d >= days[0] && d <= days[6];
  const seen = new Set();
  const posts = [];
  for (const c of cals) {
    for (const d of (c.drafts || [])) if (inWeek(d.planned_date) && d.status !== 'archived' && !seen.has(d.id)) { seen.add(d.id); posts.push({ ...d, day: d.planned_date, kind: d.status === 'published' ? 'published' : 'planned' }); }
    for (const h of (c.history || [])) { const day = (h.published_at || '').slice(0, 10); if (inWeek(day) && !seen.has(h.id)) { seen.add(h.id); posts.push({ ...h, day, status: 'published', kind: 'published' }); } }
  }
  posts.sort((a, b) => a.day.localeCompare(b.day));
  const postingDays = settings?.posting_days?.length ? settings.posting_days : [];
  const goal = postingDays.length || 3;
  const unplanned = cals[0]?.unplanned_total ?? cals[0]?.unplanned?.length ?? 0;
  return { today, days, posts, postingDays, goal, published: posts.filter(p => p.kind === 'published').length, planned: posts.filter(p => p.kind === 'planned').length, unplanned, next: slot?.date || null };
}

function weekTile(w, t, T) {
  const total = w.posts.length;
  const left = Math.max(0, w.goal - total);
  const headline = total >= w.goal ? 'This week is fully planned.' : `${total} of ${w.goal} posts planned this week.`;
  return html`
  <section class="tile td-week" data-tile="week" aria-labelledby="td-week-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-week-h">This week</h2>
      <a class="btn btn--ghost btn--sm" href="#/calendar">Calendar ${icon('arrow-right')}</a>
    </div>
    <p class="td-sub"><b>${headline}</b> ${w.published ? `${w.published} published. ` : ''}${left && w.next ? html`Next open posting day: <b>${fmtDay(w.next)}</b>.` : ''}</p>
    <div class="td-cadence" role="img" aria-label="Posting cadence: ${total} of ${w.goal} posts this week (goal: one on each posting day${w.postingDays.length ? `, ${w.postingDays.join(', ')}` : ''})">
      ${w.days.map(d => {
        const dw = dowOf(d);
        const isPosting = w.postingDays.includes(dw);
        const has = w.posts.filter(p => p.day === d);
        return html`<span class="td-day${d === w.today ? ' is-today' : ''}${d < w.today ? ' is-past' : ''}${isPosting ? ' is-posting' : ''}${has.length ? ' has-post' : ''}"><span class="td-day-name">${dw.slice(0, 2)}</span><span class="td-day-num">${Number(d.slice(8))}</span><i class="td-day-slot"${has.length ? raw(` style="--q:${qualityColor(has[0].score ?? T, T)}"`) : ''}></i></span>`;
      })}
    </div>
    <p class="td-legend"><i class="td-day-slot"></i> posting day · filled once a post is planned</p>
    ${total ? html`<ul class="td-list">${w.posts.map(p => html`<li><a class="td-row" href="#/draft/${p.id}"><span class="td-row-day">${dowOf(p.day)}</span><span class="td-row-title">${p.title || p.story_title || 'Untitled draft'}</span><span class="td-row-meta">${statusTag(p.status)}<span>${channelLabel(p.channel)}</span></span></a></li>`)}</ul>`
      : html`<div class="td-week-empty"><p>Nothing planned yet. <b>${w.unplanned >= 30 ? '30+' : w.unplanned}</b> ${w.unplanned === 1 ? 'draft is' : 'drafts are'} in the tray.</p>
        ${t.draft ? html`<a class="td-row td-row--draft" href="#/draft/${t.draft.id}"><span class="td-row-day">Suggested</span><span class="td-row-title">${t.draft.title}</span><span class="td-row-meta">${statusTag(t.draft.status)}<span>${channelLabel(t.draft.channel, t.draft.format)}</span></span></a>` : ''}
      </div>`}
  </section>`;
}

// Demo contacts: same display rule as People ("(demo)" / "DEMO ·" become a Demo tag; stored names untouched)
const isDemoName = (n) => /^\s*DEMO\s*[·:-]|\((demo|fictional)\)/i.test(String(n || ''));
const stripName = (n) => String(n || '').replace(/^\s*DEMO\s*[·:-]\s*/i, '').replace(/\s*\((demo|fictional)\)/ig, '').trim();
// Waiting on you: drafts awaiting review, outreach drafts, follow-ups due (all existing /api/today data).
function deskTile(t, s) {
  const awaiting = t.awaiting || [];
  const total = s?.counts?.awaiting ?? awaiting.length;
  const groups = [];
  for (const d of awaiting) {
    let g = groups.find(x => x.title === d.title);
    if (!g) { g = { title: d.title, id: d.id, status: d.status, channels: new Set() }; groups.push(g); }
    g.channels.add(channelLabel(d.channel));
    if (d.status === 'in_review') g.status = 'in_review';
  }
  const today = t.today || t.date;
  const fu = t.followups || [];
  const out = t.outreach_awaiting || [];
  const nothing = !total && !fu.length && !out.length;
  return html`
  <section class="tile td-desk" data-tile="desk" aria-labelledby="td-desk-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-desk-h">Waiting on you</h2>
      <a class="btn btn--ghost btn--sm" href="#/studio">Studio ${icon('arrow-right')}</a>
    </div>
    ${nothing ? html`<p class="td-sub">Nothing is waiting: no drafts to review and no follow-ups due.</p>` : ''}
    ${total ? html`<h3 class="td-label td-desk-label">${plural(total, 'draft')} awaiting review</h3>
      <ul class="td-list">${groups.slice(0, 2).map(g => html`<li><a class="td-row" href="#/draft/${g.id}"><span class="td-row-title">${g.title}</span><span class="td-row-meta">${statusTag(g.status)}<span>${[...g.channels].join(' · ')}</span></span></a></li>`)}</ul>
      ${groups.length > 2 || total > awaiting.length ? html`<p class="td-more">The ${Math.min(2, groups.length)} most recent titles of ${total} drafts. <a href="#/studio">All drafts</a></p>` : ''}` : ''}
    ${out.length ? html`<h3 class="td-label td-desk-label">${plural(out.length, 'outreach draft')}</h3>
      <ul class="td-list">${out.slice(0, 3).map(o => html`<li><a class="td-row" href="#/people"><span class="td-row-title">${stripName(o.name)} · ${String(o.purpose || '').replace(/_/g, ' ')}</span><span class="td-row-meta">${statusTag(o.status)}</span></a></li>`)}</ul>` : ''}
    ${fu.length ? html`<h3 class="td-label td-desk-label">${plural(fu.length, 'follow-up')} due</h3>
      <ul class="td-list">${fu.slice(0, 2).map(f => html`<li><a class="td-row" href="#/person/${f.id}"><span class="td-row-title">${stripName(f.name)}${isDemoName(f.name) ? html` <span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}</span><span class="td-row-meta"><span>${f.next_step}</span><span class="${f.next_date < today ? 'td-overdue' : ''}"><time datetime="${f.next_date}">${f.next_date < today ? 'overdue since ' : 'due '}${fmtDay(f.next_date)}</time></span></span></a></li>`)}</ul>` : ''}
  </section>`;
}

function restTile(items, T) {
  return html`
  <section class="tile tile--flush td-rest" data-tile="rest" aria-labelledby="td-rest-h">
    <div class="td-tile-head td-rest-head"><h2 class="td-h2" id="td-rest-h">Also in the brief</h2><span class="td-meta">${plural(items.length, 'more story', 'more stories')}</span></div>
    <ul class="td-rest-list">${items.map(it => html`
      <li class="td-rest-row" data-dossier-src>
        ${scoreChip(it.score, T)}
        <div class="td-rest-main">
          <a class="td-rest-title td-stretch" href="${storyHref(it)}" data-shared="title">${it.title}</a>${demoFlag(it.is_demo)}
          ${it.finding ? html`<p class="td-finding">${marked(it.finding, it.finding_marks)}</p>` : ''}
        </div>
        <div class="td-rest-side">${it.main_topic ? html`<span class="chip chip--main" data-shared="topic">${it.main_topic}</span>` : ''}<span class="td-src">${it.source_line || ''}</span></div>
      </li>`)}</ul>
  </section>`;
}

function quietLead(t, items) {
  const T = t.threshold;
  const top = items[0];
  return html`
  <article class="tile tile--lead td-lead td-quiet" data-tile="lead" aria-labelledby="td-quiet-h">
    <p class="td-kicker">Quiet day</p>
    <h2 class="td-title-lg" id="td-quiet-h">No story met your bar of ${T}, so nothing will be drafted automatically.</h2>
    ${top ? html`<p class="td-dek">Closest: <a href="${storyHref(top)}">${top.title}</a> at <b>${round(top.score)}</b> (${qualityLabel(top.score, T)}).</p>` : ''}
    ${t.evergreen_candidates?.length ? html`<div class="td-why"><h3 class="td-label">Prepare an evergreen draft from a saved topic</h3>
      <ul class="td-ever">${t.evergreen_candidates.map(c => html`<li><span>${c.title} <span class="chip chip--topic">${c.collection}</span></span><button type="button" class="btn btn--secondary btn--sm" data-act="evergreen" data-id="${c.id}">Draft evergreen</button></li>`)}</ul></div>`
      : html`<p class="td-sub">Save stories to a collection to unlock evergreen drafts on quiet days.</p>`}
  </article>`;
}

// Run strip: the collection state and the last run, stated plainly (F: surface data problems honestly).
function runStrip(t, s) {
  const r = t.last_run_summary || s?.last_run;
  const allPaused = t.sources_total && t.sources_paused >= t.sources_total;
  const parts = [];
  let tone = 'ok';
  if (allPaused) { tone = 'warn'; parts.push(html`<b>Collection is off:</b> all ${t.sources_total} sources are paused${t.schedule_enabled ? '' : ' and the daily schedule is off'}.`); }
  else if (t.sources_paused) parts.push(html`${t.sources_paused} of ${t.sources_total} sources are paused.`);
  if (!allPaused && !t.schedule_enabled) { tone = 'warn'; parts.push(html`The daily schedule is off.`); }
  if (r) {
    const when = [r.time_local, r.date_local].filter(Boolean).join(' ');
    if (r.status === 'failed') { tone = 'err'; parts.push(html`The last run (${when}) failed at ${r.failed_stage || 'an unknown stage'}${r.error ? `: ${r.error}` : ''}.`); }
    else if (r.status === 'running') parts.push(html`A run is in progress.`);
    else parts.push(html`The last run (${when}, ${r.trigger || 'manual'}) read ${plural(r.sources_read || 0, 'source')}, found ${r.new_articles || 0} new ${r.new_articles === 1 ? 'article' : 'articles'} and ranked ${r.ranked ?? 0}${r.sources_failed ? `; ${r.sources_failed} failed` : ''}.`);
    if (r.sources_read === 0 && tone === 'ok') tone = 'warn';
  } else parts.push(html`No runs yet.`);
  return html`<div class="td-strip" data-tone="${tone}" role="note">
    <span class="dot ${tone}" aria-hidden="true"></span>
    <p>${parts.map((p, i) => html`${i ? ' ' : ''}${p}`)}</p>
    <span class="td-strip-links">${allPaused || t.sources_paused ? html`<a href="#/sources">Sources</a>` : ''}<a href="#/runs">Run log</a></span>
  </div>`;
}

// ------------------------------------------------------------------ render
export async function render(view) {
  await useStyle('/css/v4/today.css');
  const month = (d) => d.slice(0, 7);
  const [t, s, settings] = await Promise.all([api.get('/today'), api.get('/status').catch(() => null), api.get('/settings').catch(() => null)]);
  const today = t.today || t.date;
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const wkStart = ymdAdd(today, -dow), wkEnd = ymdAdd(wkStart, 6);
  const months = [...new Set([month(today), month(wkStart), month(wkEnd)])];
  const [stories, map, slot, ...cals] = await Promise.all([
    api.get(`/stories?days=${t.window_days || 7}&limit=200`).catch(() => []),
    api.get('/map').catch(() => null),
    api.get('/slots/next').catch(() => null),
    ...months.map(m => api.get(`/calendar?month=${m}`).catch(() => ({})))
  ]);
  // the calendar for today's month first (its unplanned tray is the one we report)
  cals.sort((a, b) => (a.month === month(today) ? -1 : b.month === month(today) ? 1 : 0));

  const T = t.threshold;
  const b = t.brief;
  const items = b?.items || [];
  const { h, l } = headline(t, items);
  const issue = s?.issue;
  const eyebrow = !b ? 'Today' : t.is_today ? `${t.brief_date_label || fmtDay(today)}${issue?.number ? ` · No. ${issue.number}` : ''}` : `From ${t.brief_date_label || fmtDay(b.run_date)}’s run${issue?.number ? ` · No. ${issue.number}` : ''}`;
  const w = weekModel(t, settings, cals, slot);
  // quiet day: the lead slot explains the quiet day; the closest stories fill the secondary slots
  const pool = b?.quiet ? items : items.slice(1);
  const pick = { lead: b?.quiet ? null : items[0], s1: pool[0], s2: pool[1], s3: pool[2], rest: pool.slice(3) };

  const el = document.createElement('div');
  el.className = 'today';
  el.innerHTML = String(html`
  <div class="today-top">
    <header class="page-head page-head--display td-head">
      <p class="eyebrow">${eyebrow}</p>
      <h1><span class="sr-only">Today: </span>${h}</h1>
      <p class="lede">${l}</p>
      <div class="page-head-actions">
        ${!items.length ? html`<button type="button" class="btn btn--primary" data-act="demo">Load demo data</button>` : ''}
        <button type="button" class="btn ${items.length ? 'btn--secondary' : 'btn--secondary'}" data-act="run" data-key="R">Run today’s workflow</button>
        ${b ? html`<div class="td-menu">
          <button type="button" class="btn btn--ghost btn--icon" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-controls="td-brief-menu" aria-label="Brief actions">${icon('more')}</button>
          <div class="td-menu-pop" id="td-brief-menu" role="menu" aria-label="Brief actions" hidden>
            <p class="td-menu-meta">${plural(items.length, 'story', 'stories')} · about ${Math.max(1, round(b.reading_minutes))} min read</p>
            <button type="button" role="menuitem" data-act="digest">Email digest preview</button>
            <button type="button" role="menuitem" data-act="deliver">Send email + push now</button>
            <a role="menuitem" href="#/runs">Run log</a>
          </div>
        </div>` : ''}
      </div>
    </header>
    ${runStrip(t, s)}
  </div>
  ${!items.length ? html`
  <div class="td-grid" data-no-count>
    <div class="empty td-empty" data-tile="empty"><h3>No brief yet</h3>
      <p>Run today’s workflow to collect and rank stories${t.sources_total && t.sources_paused >= t.sources_total ? ` (all ${t.sources_total} sources are paused, so a run only re-ranks what is already stored)` : ''}, add a story URL in the Feed, or load the fictional demo data to try the full flow without credentials.</p>
      <div class="cluster"><button type="button" class="btn btn--primary" data-act="demo">Load demo data</button><a class="btn btn--secondary" href="#/feed">Add a story URL</a></div>
    </div>
    ${weatherTile(stories, t)}
    ${mapTile(map, t)}
    ${weekTile(w, t, T)}
    ${deskTile(t, s)}
  </div>` : html`
  <div class="td-grid${!pick.s3 ? ' td-grid--no-s3' : ''}" data-no-count>
    ${b?.quiet ? quietLead(t, items) : leadTile(pick.lead, T)}
    ${pick.s1 ? html`<div class="td-side">${storyTile(pick.s1, T, { rank: 1, size: 'lg' })}${pick.s2 ? storyTile(pick.s2, T, { rank: 2 }) : ''}</div>` : ''}
    ${weatherTile(stories, t)}
    ${mapTile(map, t)}
    ${pick.s3 ? storyTile(pick.s3, T, { rank: 3, why: true, maxPills: 1 }) : ''}
    ${weekTile(w, t, T)}
    ${deskTile(t, s)}
    ${pick.rest.length ? restTile(pick.rest, T) : ''}
  </div>`}`);
  view.replaceChildren(el);

  wire(el, view, { t, b, items });
  mountMap(el, view);
  // the shell fires byline:routed when this page swaps in; a re-render (after a run) plays a short entrance itself
  if (view.classList.contains('current')) choreograph(el, { quick: true, t });
  else {
    const h2 = (e) => { if (e.detail?.page !== view) return; document.removeEventListener('byline:routed', h2); choreograph(el, { t }); };
    document.addEventListener('byline:routed', h2);
  }
}

// ------------------------------------------------------------------ choreography (C §2), transform + opacity only
function choreograph(el, { quick = false, t } = {}) {
  const T = t?.threshold;
  const rings = [...el.querySelectorAll('.td-grid .score-ring')];
  const counts = () => rings.forEach((ring, i) => {
    const num = ring.querySelector('.ring-num[data-count-to]');
    if (!num || num.dataset.counted) return;
    num.dataset.counted = '1';
    const go = () => countTo(num, Number(num.dataset.countTo), { ring, threshold: Number(ring.dataset.qThreshold ?? T), duration: i === 0 ? 1400 : 1100, key: ring.dataset.countKey });
    if (reducedMotion() || quick) go(); else setTimeout(go, [560, 650, 740, 830][i] ?? 830);
  });
  heat(t);
  if (reducedMotion() || document.hidden) { counts(); return; }
  const tiles = [...el.querySelectorAll('.td-grid > .tile, .td-grid > .empty, .td-side > .tile')];
  const order = ['lead', 'empty', 's1', 's2', 'weather', 'map', 's3', 'week', 'desk', 'rest'];
  tiles.sort((a, b) => order.indexOf(a.dataset.tile) - order.indexOf(b.dataset.tile));
  const base = quick ? 0 : 140;
  const stag = quick ? 40 : 90;
  tiles.forEach((tile, i) => {
    const d = base + i * stag;
    tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: quick ? 450 : 600, delay: d, easing: EASE.fade, fill: 'backwards' });
    tile.animate([{ transform: 'translateY(12px)' }, { transform: 'none' }], { duration: quick ? 600 : 900, delay: d, easing: EASE.settle, fill: 'backwards' });
  });
  counts();
  if (quick) return;
  // lead internals: pills (40ms), title (+120), why bullets (60ms from +300)
  const lead = el.querySelector('.td-lead');
  if (lead) {
    const fade = (n, d, y = 6) => {
      n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: d, easing: EASE.fade, fill: 'backwards' });
      n.animate([{ transform: `translateY(${y}px)` }, { transform: 'none' }], { duration: 700, delay: d, easing: EASE.settle, fill: 'backwards' });
    };
    lead.querySelectorAll('.td-pills .chip').forEach((c, i) => fade(c, 260 + i * 40, 4));
    const title = lead.querySelector('.td-title-lg'); if (title) fade(title, 380, 8);
    const dek = lead.querySelector('.td-dek'); if (dek) fade(dek, 460, 6);
    lead.querySelectorAll('.td-why li').forEach((li, i) => fade(li, 560 + i * 60, 6));
  }
  // weather dots in score order (18ms stagger), labels after
  const dots = [...el.querySelectorAll('.td-wx-dot')].sort((a, b) => Number(a.dataset.qScore) - Number(b.dataset.qScore));
  dots.forEach((dot, i) => {
    const d = 560 + Math.min(i, 40) * 18;
    dot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: d, easing: EASE.fade, fill: 'backwards' });
    dot.animate([{ transform: 'translate(-6px, var(--lift, 0px))' }, { transform: 'translate(0px, var(--lift, 0px))' }], { duration: 700, delay: d, easing: EASE.settle, fill: 'backwards' });
  });
  el.querySelectorAll('.td-wx-label').forEach((n, i) => n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 900 + i * 30, easing: EASE.fade, fill: 'backwards' }));
  // static map nodes (10ms), edges from +180, top-3 rows (60ms)
  el.querySelectorAll('.td-map-nodes circle').forEach((c, i) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 650 + Math.min(i, 60) * 10, easing: EASE.fade, fill: 'backwards' }));
  const edges = el.querySelector('.td-map-edges'); if (edges) edges.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 830, easing: EASE.settle, fill: 'backwards' });
  el.querySelectorAll('.td-hot li').forEach((li, i) => li.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 680 + i * 60, easing: EASE.settle, fill: 'backwards' }));
  // a soft light pulse under the lead and the map as they resolve (rects via IntersectionObserver: no forced layout)
  pulseOn(el.querySelector('[data-tile="lead"]'), 0);
}

function pulseOn(tile, delay) {
  if (!tile || !('IntersectionObserver' in window) || !bg?.pulse) return;
  const io = new IntersectionObserver(([en]) => {
    io.disconnect();
    if (!en?.isIntersecting) return;
    const r = en.boundingClientRect;
    setTimeout(() => { if (tile.isConnected) bg.pulse(r.left + r.width / 2, r.top + Math.min(r.height / 2, 220)); }, delay);
  });
  io.observe(tile);
}

function heat(t) {
  if (!t?.topic_counts?.length || !bg?.setHeat) return;
  const pairs = t.topic_counts.map(x => [x.topic, Number(x.weighted ?? x.count) || 0]).filter(([, v]) => v > 0).slice(0, 6);
  const max = pairs[0]?.[1] || 1;
  // the shell already applies the same weighted heat on status refresh; only re-send when it differs
  const now = bg.stats?.().heatTopics || [];
  if (now.length === pairs.length && now.every((tp, i) => tp === pairs[i][0])) return;
  bg.setHeat(pairs.map(([topic, v]) => ({ topic, heat: v / max })));
}

// ------------------------------------------------------------------ map engine (owned by the Map tab)
let mapEngineOk = null;
async function mountMap(el, view) {
  const host = el.querySelector('.td-map-canvas');
  if (!host) return;
  if (mapEngineOk === null) {
    mapEngineOk = await fetch('/js/map-engine.js', { method: 'HEAD' }).then(r => r.ok && /javascript/.test(r.headers.get('content-type') || '')).catch(() => false);
  }
  if (!mapEngineOk) return;
  const m = await import('../map-engine.js').catch(() => null);
  if (!m?.mountMiniMap || !host.isConnected) return;
  let inst = null;
  try {
    const live = document.createElement('div');
    live.className = 'td-map-live';
    host.append(live);
    inst = await m.mountMiniMap(live, { onOpen: () => { location.hash = '#/map'; } });
    if (!host.isConnected) { inst?.destroy?.(); return; }
    host.classList.add('has-live');
  } catch (e) { host.querySelector('.td-map-live')?.remove(); return; }
  const off = (e) => { if (e.detail?.page === view) return; document.removeEventListener('byline:routed', off); inst?.destroy?.(); };
  document.addEventListener('byline:routed', off);
}

// ------------------------------------------------------------------ events
function wire(el, view, { t, b, items }) {
  const menuBtn = el.querySelector('[data-act="menu"]');
  const pop = el.querySelector('.td-menu-pop');
  const setMenu = (open, focus = true) => {
    if (!pop) return;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      pop.hidden = false;
      if (!reducedMotion()) pop.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE.settle });
      if (focus) pop.querySelector('[role=menuitem]')?.focus();
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    } else {
      pop.hidden = true;
      document.removeEventListener('pointerdown', outside, true);
      if (focus) menuBtn.focus();
    }
  };
  const outside = (e) => { if (!e.target.closest('.td-menu')) setMenu(false, false); };
  pop?.addEventListener('keydown', (e) => {
    const its = [...pop.querySelectorAll('[role=menuitem]')];
    const i = its.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); its[(i + 1) % its.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); its[(i - 1 + its.length) % its.length]?.focus(); }
    else if (e.key === 'Tab') setMenu(false, false);
  });
  pop?.addEventListener('click', (e) => { if (e.target.closest('a[role=menuitem]')) setMenu(false, false); });

  // weather: chart ⇄ table (the text alternative, F §5)
  el.querySelector('.td-wx-toggle')?.addEventListener('click', (e) => {
    const btn = e.currentTarget, tile = btn.closest('.td-wx'), table = tile.querySelector('.td-wx-table');
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Show as chart' : 'Show as table';
    tile.classList.toggle('show-table', on);
    table.classList.toggle('is-visible', on);
    table.classList.toggle('sr-only', !on);
    if (!reducedMotion()) (on ? table : tile.querySelector('.td-wx-chart')).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
  });

  // weather: hovering a dot echoes the same story in every topic row
  const wx = el.querySelector('.td-wx-chart');
  if (wx) {
    let lit = null;
    const light = (id) => {
      if (lit === id) return;
      wx.querySelectorAll('.td-wx-dot.is-echo').forEach(d => d.classList.remove('is-echo'));
      lit = id;
      if (id) wx.querySelectorAll(`.td-wx-dot[data-s="${CSS.escape(id)}"]`).forEach(d => d.classList.add('is-echo'));
    };
    wx.addEventListener('pointerover', (e) => light(e.target.closest('.td-wx-dot')?.dataset.s || null));
    wx.addEventListener('pointerleave', () => light(null));
  }

  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'menu') { setMenu(btn.getAttribute('aria-expanded') !== 'true'); return; }
    if (a === 'run') await act(btn, async () => {
      const tc = window.__byline?.lattice?.(btn, { label: 'Running' });
      const r = await (window.__byline?.stagedRun || ((p) => p))(api.post('/runs', {}));
      if (tc) { r.status === 'done' ? tc.done('Done') : tc.error('Stopped'); await new Promise(res => setTimeout(res, 700)); }
      toast(r.status === 'done' ? 'Daily run finished' : `Run failed at ${r.failed_stage}: ${r.error}`, r.status === 'done' ? 'ok' : 'err');
      api.clear();
      await render(view);
    }, 'Running…');
    if (a === 'demo') await act(btn, async () => { await api.post('/demo/load'); toast('Demo data loaded (fictional)', 'ok'); api.clear(); await render(view); }, 'Loading…');
    if (a === 'digest') { setMenu(false, false); await act(menuBtn, async () => {
      const r = await api.get(`/briefs/${b.run_date}/digest`);
      const m = modal(String(html`<h2>Email digest preview</h2><p class="td-menu-meta">The email the ${fmtDay(b.run_date)} brief would send.</p><iframe class="td-digest" sandbox="" title="Email digest preview"></iframe><div class="modal-actions"><button type="button" class="btn btn--secondary" data-close>Close</button></div>`), { wide: true });
      m.el.querySelector('iframe').srcdoc = r.html;
    }); }
    if (a === 'deliver') { setMenu(false, false); await act(menuBtn, async () => {
      const r = await api.post(`/briefs/${b.run_date}/deliver`, { force: true });
      toast(`Email: ${r.email} · Push: ${r.push}`, Object.values(r).some(v => v === 'sent') ? 'ok' : '');
    }); }
    if (a === 'evergreen') await act(btn, async () => { const r = await api.post(`/stories/${btn.dataset.id}/evergreen`); location.hash = `#/draft/${r.draft_id}`; });
  });
  void t; void items;
}
