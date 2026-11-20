// Today (SPEC §5, DECISIONS, C §2 choreography, F §2 headline templates).
// Every figure comes from the API: /api/today, /api/status, /api/settings, /api/stories?days=window,
// /api/map, /api/calendar, /api/slots/next. The threshold always comes from the payload (never hard-coded).
//
// Layout (12 cols desktop, stacked on phone, DOM order = phone order):
//   lead tile (7) | S1 + S2 (5)
//   News weather (7) | News map (5)
//   This week (7: strip | posts) | Waiting on you (5)      (round 1 T1: row 3 is top-aligned, no S3 tile)
//   Also in the brief (12: the 3rd secondary story onward, as compact rows sized by importance)
//
// Motion: the shell runs enterHeading on the h1. This view owns everything after it (C §2, round 1 T4):
// the lede at h1 line-2 start + 120 ms, the actions and run strip with the lede, then the tile cascade at
// lede + 200 ms. It starts on the router's `byline:routed` event, the moment the page becomes visible.

import { api } from '../api.js';
import { html, raw, esc, on, act, toast, modal, icon, scoreRing, scoreChip, topicPills, demoFlag, channelLabel, status as statusTag, useStyle, reducedMotion } from '../ui.js';
import { EASE, countTo, hasCounted } from '../motion.js';
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
// T10: shared topicPills() (blue main pill only above the bar, neutral .chip--lead below); the first pill keeps
// data-shared="topic" so it still flies into the dossier
const pills = (it, T, max = 3) => {
  const topics = it.topics || [];
  const main = it.main_topic || topics[0];
  if (!main) return '';
  const list = [main, ...topics.filter(x => x !== main)];
  const inner = String(topicPills(list, it.score, T, { max })).replace('<span class="chip ', '<span data-shared="topic" class="chip ');
  return html`<div class="td-pills cluster">${raw(inner)}</div>`;
};
const storyHref = (it) => `#/story/${it.story_id ?? it.id}`;

/**
 * T3 (ruling R8): the lead's source mix, all from /api/today item fields. It is real content that makes up the
 * height difference with the side column (fixed 24 px gaps; nothing spreads).
 */
function mixBlock(it) {
  if (!it.source_line) return '';
  const n = (v) => (Number.isFinite(v) ? v : null);
  const kinds = [[n(it.first_party), 'first-party'], [n(it.primary), 'primary research'], [n(it.commentary), 'commentary']].filter(([v]) => v != null); // independent is in the line itself
  const seen = it.first_seen ? fmtDay(String(it.first_seen).slice(0, 10)) : '';
  const origin = it.origin_domain ? html`From <b>${it.origin_domain}</b>${seen ? html`, first seen ${seen}` : ''}.` : seen ? html`First seen ${seen}.` : '';
  // two layouts of the same facts: with or without the origin line (the footer keeps the origin domain); fitLead
  // picks the one that brings the lead closest to the side column's height without passing it
  return html`<div class="td-mix">
    <h3 class="td-label">Source mix</h3>
    <p class="td-mix-line"><span class="td-src">${it.source_line}</span>${kinds.length ? html`<span class="td-mix-kinds">${kinds.map(([v, k], i) => html`${i ? ' · ' : ''}<b>${v}</b> ${k}`)}</span>` : ''}</p>
    ${origin ? html`<p class="td-mix-extra">${origin}</p>` : ''}
  </div>`;
}

function leadTile(it, T) {
  const why = whyOf(it);
  // T2: one grid: pills / title / dek in the text column, the ring beside them (rows 1–3), so the dek sits
  // right under the title instead of under the ring; at ≤480 px the ring drops to 64 px beside the pills
  return html`
  <article class="tile tile--lead td-lead" data-dossier-src data-tile="lead" aria-labelledby="td-lead-title">
    <div class="td-lead-top">
      ${pills(it, T, 3)}
      <h2 class="td-title-lg" id="td-lead-title"><a class="td-stretch" href="${storyHref(it)}" data-shared="title">${it.title}</a>${demoFlag(it.is_demo)}</h2>
      ${it.finding ? html`<p class="td-dek">${marked(it.finding, it.finding_marks)}</p>` : ''}
      <div class="td-lead-ring">${scoreRing(it.score, T, { size: 108, count: true, key: `today-lead-${it.story_id}` })}</div>
    </div>
    ${why.length ? html`<div class="td-why">
      <h3 class="td-label">Why it ranked</h3>
      <ul>${why.map(w => html`<li>${w}</li>`)}</ul>
    </div>` : ''}
    ${(it.companies || []).length ? html`<div class="td-named"><h3 class="td-label">Named</h3><span class="cluster">${it.companies.slice(0, 4).map(c => html`<span class="td-domain">${c}</span>`)}${it.companies.length > 4 ? html`<span class="td-meta">+${it.companies.length - 4}</span>` : ''}</span></div>` : ''}
    ${mixBlock(it)}
    <footer class="td-lead-foot">
      ${it.origin_domain ? html`<span class="td-domain" title="The origin: the site the story first came from">${it.origin_domain}</span>` : ''}
      <span class="td-open" data-act="open-lead" aria-hidden="true">Open dossier ${icon('arrow-right')}</span>
    </footer>
  </article>`;
}

function storyTile(it, T, { rank, size = 'md', why = false, maxPills = 2 }) {
  const bullets = why ? whyOf(it) : [];
  return html`
  <article class="tile td-story td-story--${size}" data-dossier-src data-tile="s${rank}" aria-labelledby="td-s${rank}">
    <div class="td-story-top">
      ${pills(it, T, maxPills)}
      ${scoreRing(it.score, T, { size: size === 'lg' ? 64 : 52, label: false, count: true, key: `today-s-${it.story_id}` })}
    </div>
    <h2 class="td-title ${size === 'lg' ? 'td-title--lg' : ''}" id="td-s${rank}"><a class="td-stretch" href="${storyHref(it)}" data-shared="title">${it.title}</a>${demoFlag(it.is_demo)}</h2>
    ${it.finding ? html`<p class="td-finding">${marked(it.finding, it.finding_marks)}</p>` : ''}
    ${bullets.length ? html`<div class="td-why td-why--sm"><h3 class="td-label">Why it ranked</h3><ul>${bullets.map(w => html`<li>${w}</li>`)}</ul></div>` : ''}
    <footer class="td-story-foot"><span class="td-src">${it.source_line || ''}</span><span class="td-q">${qualityLabel(it.score, T)}</span></footer>
  </article>`;
}

// News weather (Edition's chart, rebuilt on real data): one row per topic, one dot per ranked story in
// the window, placed on a 0–100 score axis. Hot / Warm / Calm use F's "dominates" share on cleared stories.
// `weights` = priority weight per topic (settings); weight ≤ 1 topics keep their chart row but never lead the sentence.
function weatherModel(stories, t, weights = {}) {
  const T = t.threshold;
  const cleared = stories.filter(s => s.score >= T);
  const nCleared = cleared.length;
  const rows = new Map();
  for (const s of stories) for (const tp of (s.topics || [])) {
    if (!rows.has(tp)) rows.set(tp, { topic: tp, stories: [] });
    rows.get(tp).stories.push(s);
  }
  const weightedOf = Object.fromEntries((t.topic_counts || []).map(x => [x.topic, x.weighted]));
  const list = [...rows.values()].map(r => {
    const above = r.stories.filter(s => s.score >= T).length;
    const share = nCleared ? above / nCleared : 0;
    const label = above && share >= 0.5 ? 'hot' : above ? 'warm' : 'calm';
    return { ...r, above, share, label, weight: weights[r.topic] ?? null, weighted: weightedOf[r.topic] ?? 0, stories: r.stories.slice().sort((a, b) => a.score - b.score) };
  }).sort((a, b) => b.weighted - a.weighted || b.above - a.above || b.stories.length - a.stories.length || a.topic.localeCompare(b.topic));
  return { rows: list.slice(0, 8), more: Math.max(0, list.length - 8), total: stories.length, nCleared, T };
}

/** T7: the chart's own counts in words. No "run hot" (DECISIONS: only when history supports it). */
function weatherSentence(m) {
  const counts = (r) => r.weight == null || r.weight > 1; // weight ≤ 1 (Machine learning) never leads the sentence
  const shown = m.rows.filter(counts);
  const hot = shown.filter(r => r.label === 'hot');
  const calm = shown.filter(r => r.label === 'calm').sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 2).map(r => r.topic);
  const n = m.nCleared;
  const calmTail = calm.length ? html`; ${listJoin(calm)} ${calm.length === 1 ? 'is' : 'are'} in none` : '';
  if (!n) return html`None of the <b>${m.total}</b> stories ranked this week cleared your bar of <b>${m.T}</b>.`;
  if (hot.length) {
    const names = html`<b>${listJoin(hot.map(r => r.topic))}</b> ${hot.length === 1 ? 'is' : 'are'}`;
    const span = n === 1 ? html`the one story above your bar`
      : hot.every(r => r.above === n) ? html`all <b>${n}</b> stories above your bar`
      : html`half or more of the <b>${n}</b> stories above your bar`;
    return html`${names} in ${span}${calmTail}.`;
  }
  const lead = shown.filter(r => r.above).sort((a, b) => b.above - a.above)[0];
  return html`No topic is in half of the <b>${n}</b> ${n === 1 ? 'story' : 'stories'} above your bar${lead ? html`; <b>${lead.topic}</b> is in <b>${lead.above}</b>` : ''}${calmTail}.`;
}

/** T8: a priority weight ≤ 1 topic (Machine learning) keeps its dots but reads as the catch-all it is. */
const catchAll = (r) => r.weight != null && r.weight <= 1;

function weatherTile(stories, t, weights) {
  const m = weatherModel(stories, t, weights);
  if (!m.total) return html`<section class="tile tile--static td-wx" data-tile="weather" aria-labelledby="td-wx-h"><div class="td-tile-head"><h2 class="td-h2" id="td-wx-h">News weather</h2></div>
    <div class="empty"><h3>No ranked stories this week</h3><p>The chart fills in after a run ranks stories from the last ${t.window_days || 7} days.</p></div></section>`;
  const th = Math.max(0, Math.min(100, m.T));
  const LABEL = { hot: 'Hot', warm: 'Warm', calm: 'Calm' };
  return html`
  <section class="tile td-wx" data-tile="weather" aria-labelledby="td-wx-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-wx-h">News weather</h2>
      <button type="button" class="btn btn--ghost btn--sm td-wx-toggle" data-act="wx-table" aria-pressed="false" aria-controls="td-wx-table">Show as table</button>
    </div>
    <p class="td-sub">${weatherSentence(m)}</p>
    <div class="td-wx-chart" aria-hidden="true" style="--th:${th / 100}">
      <div class="td-wx-axis"><span class="td-wx-bar-label" style="--x:${th / 100}">Your bar, ${m.T}</span></div>
      ${m.rows.map((r) => html`
      <div class="td-wx-row" data-label="${r.label}"${catchAll(r) ? raw(' data-catchall') : ''}>
        <span class="td-wx-name">${r.topic}</span>
        <span class="td-wx-track">
          ${r.stories.map((s, k) => {
            const prev = r.stories[k - 1];
            const near = prev && Math.abs(s.score - prev.score) < 2.6;
            const lift = near ? (k % 2 ? -4 : 4) : 0;
            return html`<a class="td-wx-dot" href="#/story/${s.id}" tabindex="-1" data-dossier-src data-s="${s.id}" data-q="${qualityTier(s.score, m.T)}" data-q-score="${s.score}" data-q-threshold="${m.T}" style="--x:${Math.max(0, Math.min(100, s.score)) / 100};--lift:${lift}px;--q:${qualityColor(s.score, m.T)}"><span class="td-wx-tip">${s.short_title || s.title} · ${round(s.score)}</span></a>`;
          })}
        </span>
        <span class="td-wx-label">${catchAll(r) ? 'catch-all' : LABEL[r.label]}</span>
      </div>`)}
      <div class="td-wx-scale"><span>0</span><span>50</span><span>100</span></div>
    </div>
    <table class="td-wx-table sr-only" id="td-wx-table">
      <caption>News weather: ${m.total} ranked stories from the last ${t.window_days || 7} days by topic. Threshold ${m.T}.</caption>
      <thead><tr><th scope="col">Topic</th><th scope="col">Stories</th><th scope="col">Above ${m.T}</th><th scope="col">Scores</th><th scope="col">Weather</th></tr></thead>
      <tbody>${m.rows.map(r => html`<tr><th scope="row">${r.topic}</th><td class="num">${r.stories.length}</td><td class="num">${r.above}</td><td>${r.stories.slice().reverse().map(s => round(s.score)).join(', ')}</td><td>${catchAll(r) ? `Catch-all (${LABEL[r.label]})` : LABEL[r.label]}</td></tr>`)}</tbody>
    </table>
    <p class="td-caption">Each dot is one of the <b>${m.total}</b> stories ranked in the last ${t.window_days || 7} days, placed by score; filled dots cleared your bar. <b>Hot</b>: in half or more of the ${m.nCleared} above it · <b>Warm</b>: in at least one · <b>Calm</b>: in none.${m.rows.some(catchAll) ? html` <b>Catch-all</b>: priority weight 1 or less, so it never leads.` : ''}${m.more ? ` ${plural(m.more, 'smaller topic')} not shown.` : ''}</p>
  </section>`;
}

// News map: a static drawing of the Map tab's own /api/map layout (same seeded positions). The geometry is fitted
// once the canvas size is known (T7): node bounds fill the box with 12% padding, nodes are 6–9 px by score, the
// cluster discs enclose their own nodes, and the top 3 nodes carry their short title outside the discs.
// The top-3 hot regions sit beside it: "leads" = stories whose main topic it is, "in" = stories carrying it at all.
function mapTile(map, t) {
  const hot = map?.hot_topics || [];
  const n = map?.nodes?.length || 0;
  const list = hot.length ? html`<ol class="td-hot">${hot.slice(0, 3).map((h, i) => {
      const inN = h.in_count ?? null;
      const recent = h.recent != null && h.recent !== h.count ? html` · ${h.recent} this week` : '';
      return html`
      <li><a href="#/map" class="td-hot-row"><span class="td-hot-rank">${i + 1}</span><span class="td-hot-name">${h.topic}</span><span class="td-hot-meta">leads ${h.count}${inN != null ? html`, in ${inN}` : ''}${recent}</span></a></li>`;
    })}</ol>`
    : html`<p class="td-sub">No topic regions yet.</p>`;
  const ar = mapAspect(map);
  return html`
  <section class="tile td-map" data-tile="map" aria-labelledby="td-map-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-map-h">News map</h2>
      <a class="btn btn--ghost btn--sm" href="#/map">Open map ${icon('arrow-right')}</a>
    </div>
    <div class="td-map-body">
      <a class="td-map-canvas" href="#/map"${ar ? raw(` style="--ar:${ar.toFixed(3)}"`) : ''} aria-label="Open the Map: ${n} stories in ${map?.clusters?.length || 0} topic regions">${staticMap(map, t.threshold)}</a>
      <div class="td-map-side">
        <h3 class="td-label" id="td-hot-h">Hottest regions</h3>
        ${list}
        ${n ? html`<p class="td-caption">${plural(n, 'story', 'stories')}, ${plural(map.edges?.length || 0, 'connection')}. Ranked by heat: this week’s stories weighted by score. <b>Leads</b>: main topic · <b>in</b>: carries the topic. Labels name the three top-scoring stories.</p>` : ''}
      </div>
    </div>
  </section>`;
}

/** The canvas aspect: the node bounds' own, clamped 1.35–2.1 so the box never turns into a strip or a tower. */
function mapAspect(map) {
  const nodes = map?.nodes || [];
  if (!nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const nd of nodes) { x0 = Math.min(x0, nd.x); y0 = Math.min(y0, nd.y); x1 = Math.max(x1, nd.x); y1 = Math.max(y1, nd.y); }
  return Math.max(1.35, Math.min(2.1, Math.max(40, x1 - x0) / Math.max(40, y1 - y0)));
}

const nodeR = (score) => 6 + 3 * Math.max(0, Math.min(100, Number(score) || 0)) / 100; // T7: 6–9 px by score

function staticMap(map, T) {
  const nodes = map?.nodes || [];
  if (!nodes.length) return html`<span class="td-map-empty">The map fills in as runs collect stories.</span>`;
  const pos = new Map(nodes.map(nd => [nd.id, nd]));
  const hotTopics = (map.hot_topics || []).slice(0, 3).map(h => h.topic);
  const edges = (map.edges || []).map(e => { const a = pos.get(e.a), c = pos.get(e.b); return a && c ? `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${c.x.toFixed(1)} ${c.y.toFixed(1)}` : ''; }).join('');
  const top = nodes.slice().sort((a, b) => b.score - a.score).slice(0, 3);
  // geometry (viewBox, radii, discs, labels) is set by fitMap() once the box size is known; until then the layer is hidden
  return raw(`<svg class="td-map-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <g class="td-map-regions">${(map.clusters || []).filter(c => hotTopics.includes(c.topic)).map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="0" data-topic="${esc(c.topic)}" style="opacity:${(0.35 + 0.65 * (c.heat || 0)).toFixed(2)}"/>`).join('')}</g>
    <path class="td-map-edges" d="${edges}"/>
    <g class="td-map-nodes">${nodes.map(nd => `<circle cx="${nd.x.toFixed(1)}" cy="${nd.y.toFixed(1)}" r="0" data-id="${nd.id}" data-q="${qualityTier(nd.score, T)}" data-q-score="${nd.score}" data-q-threshold="${T}" style="--q:${qualityColor(nd.score, T)}"/>`).join('')}</g>
  </svg><span class="td-map-labels" aria-hidden="true"><svg class="td-map-leaders"></svg>${top.map(nd => `<span class="td-map-label" data-id="${nd.id}">${esc(nd.short_title || nd.title || '')}</span>`).join('')}</span>`);
}

/**
 * T7: fit the drawing to the canvas once its size is known (ResizeObserver entry: no forced layout), then place at most
 * three labels outside the cluster discs, toward the nearest edge, never over a node. Label widths are estimated from
 * the text (11px Geist ≈ 6.1px per character), capped at 46% of the canvas (the label ellipsises).
 */
function fitMap(host, map) {
  const box = host?.querySelector('.td-map-labels');
  const svg = host?.querySelector('.td-map-svg');
  const nodes = map?.nodes || [];
  if (!box || !svg || !nodes.length || !('ResizeObserver' in window)) { box?.classList.add('is-placed'); host?.classList.add('is-fit'); return; }
  const byId = new Map(nodes.map(nd => [String(nd.id), nd]));
  const circles = [...svg.querySelectorAll('.td-map-nodes circle')];
  const discs = [...svg.querySelectorAll('.td-map-regions circle')];
  const labels = [...box.querySelectorAll('.td-map-label')];
  const leaders = box.querySelector('.td-map-leaders');
  let lastW = 0, lastH = 0;
  const place = (W, H) => {
    if (!W || !H || (W === lastW && H === lastH)) return;
    lastW = W; lastH = H;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const nd of nodes) { x0 = Math.min(x0, nd.x); y0 = Math.min(y0, nd.y); x1 = Math.max(x1, nd.x); y1 = Math.max(y1, nd.y); }
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    // 12% padding on each side, plus the largest node radius so no disc of a node touches the padding line
    const k = Math.min((W * 0.76 - 18) / bw, (H * 0.76 - 18) / bh); // px per layout unit
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const vw = W / k, vh = H / k, vx = cx - vw / 2, vy = cy - vh / 2;
    svg.setAttribute('viewBox', `${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);
    const px = (nd) => ({ x: (nd.x - vx) * k, y: (nd.y - vy) * k, r: nodeR(nd.score) });
    const P = nodes.map(px);
    const pOf = new Map(nodes.map((nd, i) => [String(nd.id), P[i]]));
    circles.forEach((c) => { const nd = byId.get(c.dataset.id); if (nd) c.setAttribute('r', (nodeR(nd.score) / k).toFixed(2)); });
    // discs: each covers the core of its own topic's nodes (median distance + 14 px), capped at a quarter of the short side
    const D = discs.map((c) => {
      const tp = c.dataset.topic;
      const ccx = Number(c.getAttribute('cx')), ccy = Number(c.getAttribute('cy'));
      const ds = nodes.filter(nd => nd.topic === tp).map(nd => Math.hypot(nd.x - ccx, nd.y - ccy) * k).sort((a, b) => a - b);
      const med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
      const r = Math.min(Math.max(med + 14, 26), Math.min(W, H) * 0.26);
      c.setAttribute('r', (r / k).toFixed(2));
      return { x: (ccx - vx) * k, y: (ccy - vy) * k, r };
    });
    const placed = [];
    let lines = '';
    const maxW = Math.round(W * 0.46);
    for (const s of labels) {
      const nd = byId.get(s.dataset.id);
      if (!nd) { s.hidden = true; continue; }
      const p = pOf.get(String(nd.id));
      const w = Math.min(maxW, Math.round(s.textContent.length * 6.1 + 16)), h = 20;
      s.style.maxWidth = `${w}px`;
      // nearest edge first, then the other sides, then the corners
      const dists = [['l', p.x], ['r', W - p.x], ['t', p.y], ['b', H - p.y]].sort((a, b) => a[1] - b[1]).map(d => d[0]);
      const dirs = [...dists, `${dists.includes('t') && p.y < H / 2 ? 't' : 'b'}${p.x < W / 2 ? 'l' : 'r'}`, 'tl', 'tr', 'bl', 'br'].filter((d, i, a) => a.indexOf(d) === i);
      let best = null;
      for (const strict of [true, false]) { if (best) break; for (const [rank, dir] of dirs.entries()) for (let step = 0; step < 10; step++) {
        const off = p.r + 6 + step * 10;
        let x = p.x - w / 2, y = p.y - h / 2;
        if (dir.includes('l')) x = p.x - off - w; else if (dir.includes('r')) x = p.x + off;
        if (dir.includes('t')) y = p.y - off - h; else if (dir.includes('b')) y = p.y + off;
        if (dir.length === 2) { x = dir.includes('l') ? p.x - off * 0.7 - w : p.x + off * 0.7; y = dir.includes('t') ? p.y - off * 0.7 - h : p.y + off * 0.7; }
        x = Math.max(4, Math.min(W - w - 4, x)); y = Math.max(4, Math.min(H - h - 4, y));
        const hitsNode = P.some(q => { const dx = Math.max(x - q.x, 0, q.x - (x + w)), dy = Math.max(y - q.y, 0, q.y - (y + h)); return dx * dx + dy * dy < (q.r + 2) ** 2; });
        if (hitsNode) continue;
        if (placed.some(q => x < q.x + q.w + 4 && x + w + 4 > q.x && y < q.y + q.h + 3 && y + h + 3 > q.y)) continue;
        const inDisc = D.reduce((n, d) => { const dx = Math.max(x - d.x, 0, d.x - (x + w)), dy = Math.max(y - d.y, 0, d.y - (y + h)); return n + (dx * dx + dy * dy < d.r * d.r ? 1 : 0); }, 0);
        const lx = Math.max(x, Math.min(p.x, x + w)), ly = Math.max(y, Math.min(p.y, y + h));
        // a leader may not pass over another node
        const crosses = P.some(q => { if (q === p) return false; const vx = lx - p.x, vy = ly - p.y, L2 = vx * vx + vy * vy || 1; const u = Math.max(0, Math.min(1, ((q.x - p.x) * vx + (q.y - p.y) * vy) / L2)); return Math.hypot(p.x + u * vx - q.x, p.y + u * vy - q.y) < q.r + 1.5; });
        if (crosses && strict) continue; // second pass: a leader may cross an edge-dense core rather than lose the label
        const cost = inDisc * 40 + Math.hypot(lx - p.x, ly - p.y) * 1.2 + rank * 8;
        if (!best || cost < best.cost) best = { x, y, w, h, cost };
        if (!inDisc) break; // outside every disc on this side: the nearest such spot wins
      } }
      s.hidden = !best;
      if (!best) continue;
      placed.push(best);
      s.style.transform = `translate(${Math.round(best.x)}px, ${Math.round(best.y)}px)`;
      // a hairline leader from the node's edge to the label's nearest point, when they are apart
      const lx = Math.max(best.x, Math.min(p.x, best.x + best.w)), ly = Math.max(best.y, Math.min(p.y, best.y + best.h));
      const d = Math.hypot(lx - p.x, ly - p.y);
      if (d > p.r + 7) { const ux = (lx - p.x) / d, uy = (ly - p.y) / d; lines += `M${(p.x + ux * (p.r + 2)).toFixed(1)} ${(p.y + uy * (p.r + 2)).toFixed(1)}L${lx.toFixed(1)} ${ly.toFixed(1)}`; }
      svg.querySelector(`.td-map-nodes circle[data-id="${CSS.escape(s.dataset.id)}"]`)?.classList.add('is-labelled');
    }
    if (leaders) { leaders.setAttribute('viewBox', `0 0 ${W} ${H}`); leaders.innerHTML = lines ? `<path d="${lines}"/>` : ''; }
    box.classList.add('is-placed');
    host.classList.add('is-fit');
  };
  // the first fit runs in the observer callback (before first paint); later resizes (the rail's 420 ms width animation,
  // a window resize) refit once they stop, so no frame of the animation rewrites the drawing (E12)
  let first = true, timer = 0;
  const ro = track(host, new ResizeObserver(([en]) => {
    if (!host.isConnected) { ro.disconnect(); return; }
    const W = Math.round(en.contentRect.width), H = Math.round(en.contentRect.height);
    if (first) { first = false; place(W, H); return; }
    clearTimeout(timer);
    timer = setTimeout(() => { if (host.isConnected) place(W, H); }, 160);
  }));
  ro.observe(box);
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

/**
 * T5: the suggested next post is the highest-scoring above-bar story in the brief with no draft yet (story ids from
 * the calendar's drafts, tray and history). Only when every above-bar story already has a draft does it fall back to
 * the draft in review. It links to the story's dossier, where Draft a post lives: nothing is created from here.
 */
function suggestion(items, T, cals, t) {
  const drafted = new Set();
  for (const c of cals) for (const d of [...(c.drafts || []), ...(c.unplanned || []), ...(c.history || [])]) if (d?.story_id != null) drafted.add(String(d.story_id));
  const above = items.filter(it => Math.round(it.score) >= T).sort((a, b) => b.score - a.score);
  const story = above.find(it => !drafted.has(String(it.story_id ?? it.id)));
  if (story) return { kind: 'story', it: story };
  if (t.draft) return { kind: 'draft', d: t.draft };
  return null;
}

function weekTile(w, t, T, sugg) {
  const total = w.posts.length;
  const left = Math.max(0, w.goal - total);
  const headline = total >= w.goal ? 'This week is fully planned.' : `${total} of ${w.goal} posts planned this week.`;
  const suggRow = !sugg ? html`<p class="td-sub">No story above your bar is waiting for a draft.</p>`
    : sugg.kind === 'story' ? html`<h3 class="td-label td-week-label">Suggested next post</h3>
      <a class="td-row td-row--sugg" href="${storyHref(sugg.it)}" data-dossier-src><span class="td-row-title">${sugg.it.short_title || sugg.it.title}</span><span class="td-row-meta"><span class="td-num">${round(sugg.it.score)}</span><span>no draft yet</span><span class="td-sugg-go">Draft a post ${icon('arrow-right')}</span></span></a>
      <p class="td-caption td-sugg-why">The top story above your bar of <b>${T}</b> with no draft. Opens its dossier; nothing is drafted yet.</p>`
    : html`<h3 class="td-label td-week-label">Suggested next post</h3>
      <a class="td-row td-row--sugg" href="#/draft/${sugg.d.id}"><span class="td-row-title">${sugg.d.title}</span><span class="td-row-meta">${statusTag(sugg.d.status)}<span>${channelLabel(sugg.d.channel, sugg.d.format)}</span></span></a>
      <p class="td-caption td-sugg-why">Every story above your bar already has a draft; this one is in review.</p>`;
  // T1 (round 1): the 7-day strip and the posts (or the suggestion) side by side; T4: the tray line sits under the legend
  return html`
  <section class="tile td-week" data-tile="week" aria-labelledby="td-week-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-week-h">This week</h2>
      <a class="btn btn--ghost btn--sm" href="#/calendar">Calendar ${icon('arrow-right')}</a>
    </div>
    <p class="td-sub"><b>${headline}</b> ${w.published ? `${w.published} published.` : ''}</p>
    <div class="td-week-body">
      <div class="td-week-strip">
        <div class="td-cadence" role="img" aria-label="Posting cadence: ${total} of ${w.goal} posts this week (goal: one on each posting day${w.postingDays.length ? `, ${w.postingDays.join(', ')}` : ''})">
          ${w.days.map(d => {
            const dw = dowOf(d);
            const isPosting = w.postingDays.includes(dw);
            const has = w.posts.filter(p => p.day === d);
            return html`<span class="td-day${d === w.today ? ' is-today' : ''}${d < w.today ? ' is-past' : ''}${isPosting ? ' is-posting' : ''}${has.length ? ' has-post' : ''}"><span class="td-day-name">${dw.slice(0, 2)}</span><span class="td-day-num">${Number(d.slice(8))}</span><i class="td-day-slot"${has.length ? raw(` style="--q:${qualityColor(has[0].score ?? T, T)}"`) : ''}></i></span>`;
          })}
        </div>
        <p class="td-legend"><i class="td-day-slot"></i> Posting day, filled once a post is planned</p>
        ${!total ? html`<p class="td-week-empty">Nothing planned yet. <b>${w.unplanned >= 30 ? '30+' : w.unplanned}</b> ${w.unplanned === 1 ? 'draft is' : 'drafts are'} in the tray.</p>` : ''}
      </div>
      <div class="td-week-side">
        ${total ? html`<ul class="td-list">${w.posts.slice(0, 3).map(p => html`<li><a class="td-row" href="#/draft/${p.id}"><span class="td-row-day">${dowOf(p.day)}</span><span class="td-row-title">${p.title || p.story_title || 'Untitled draft'}</span><span class="td-row-meta">${statusTag(p.status)}<span>${channelLabel(p.channel)}</span></span></a></li>`)}</ul>${total > 3 ? html`<p class="td-more"><a href="#/calendar">All ${total} this week →</a></p>` : ''}`
          : suggRow}
        ${left && w.next ? html`<a class="td-row td-week-next" href="#/calendar"><span class="td-label">Next open posting day</span><span class="td-row-title">${fmtDay(w.next)}</span></a>` : ''}
      </div>
    </div>
  </section>`;
}

// Demo contacts: same display rule as People ("(demo)" / "DEMO ·" become a Demo tag; stored names untouched)
const isDemoName = (n) => /^\s*DEMO\s*[·:-]|\((demo|fictional)\)/i.test(String(n || ''));
const stripName = (n) => String(n || '').replace(/^\s*DEMO\s*[·:-]\s*/i, '').replace(/\s*\((demo|fictional)\)/ig, '').trim();

/**
 * T3: the review count Studio and Performance show. counts.in_review / counts.drafts_open come from /api/status
 * (same SQL as Studio's list); without them the label counts the statuses of the 12 most recent drafts and says so.
 */
function reviewLabel(s, awaiting) {
  const c = s?.counts || {};
  if (Number.isFinite(c.in_review) && Number.isFinite(c.drafts_open)) {
    if (!c.drafts_open) return null;
    return c.in_review ? `${c.in_review} in review of ${plural(c.drafts_open, 'open draft')}` : `${plural(c.drafts_open, 'open draft')}, none in review`;
  }
  if (!awaiting.length) return null;
  const rev = awaiting.filter(d => d.status === 'in_review').length;
  return `${rev} in review, ${plural(awaiting.length - rev, 'draft')}, of the ${awaiting.length} most recent`;
}

// Waiting on you: drafts in review first, then open drafts, outreach drafts, follow-ups due (all /api/today data).
function deskTile(t, s) {
  const awaiting = t.awaiting || [];
  const groups = [];
  for (const d of awaiting) {
    let g = groups.find(x => x.title === d.title);
    if (!g) { g = { title: d.title, id: d.id, status: d.status, channels: new Set() }; groups.push(g); }
    g.channels.add(channelLabel(d.channel));
    if (d.status === 'in_review') { g.status = 'in_review'; g.id = d.id; }
  }
  groups.sort((a, b) => (b.status === 'in_review') - (a.status === 'in_review')); // stable: recency within each
  const label = reviewLabel(s, awaiting);
  const today = t.today || t.date;
  const fu = t.followups || [];
  const out = t.outreach_awaiting || [];
  const nothing = !label && !fu.length && !out.length;
  return html`
  <section class="tile td-desk" data-tile="desk" aria-labelledby="td-desk-h">
    <div class="td-tile-head">
      <h2 class="td-h2" id="td-desk-h">Waiting on you</h2>
      <a class="btn btn--ghost btn--sm" href="#/studio">Studio ${icon('arrow-right')}</a>
    </div>
    ${nothing ? html`<p class="td-sub">Nothing is waiting: no drafts to review and no follow-ups due.</p>` : ''}
    ${label ? html`<h3 class="td-label td-desk-label">${label}</h3>
      ${groups.length ? html`<ul class="td-list">${(groups.some(g => g.status === 'in_review') ? groups.filter(g => g.status === 'in_review') : groups).slice(0, 2).map(g => html`<li><a class="td-row" href="#/draft/${g.id}"><span class="td-row-title">${g.title}</span><span class="td-row-meta">${statusTag(g.status)}<span>${[...g.channels].join(' · ')}</span></span></a></li>`)}</ul>` : ''}
      <p class="td-more"><a href="#/studio">All drafts →</a></p>` : ''}
    ${out.length ? html`<h3 class="td-label td-desk-label">${plural(out.length, 'outreach draft')}</h3>
      <ul class="td-list">${out.slice(0, 3).map(o => html`<li><a class="td-row" href="#/people"><span class="td-row-title">${stripName(o.name)} · ${String(o.purpose || '').replace(/_/g, ' ')}</span><span class="td-row-meta">${statusTag(o.status)}</span></a></li>`)}</ul>` : ''}
    ${fu.length ? html`<h3 class="td-label td-desk-label">${plural(fu.length, 'follow-up')} due</h3>
      <ul class="td-list td-list--fu">${fu.slice(0, 2).map(f => html`<li><a class="td-row" href="#/person/${f.id}"><span class="td-row-title">${stripName(f.name)}${isDemoName(f.name) ? html` <span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}</span><span class="td-row-meta"><span>${f.next_step}</span><span class="${f.next_date < today ? 'td-overdue' : ''}"><time datetime="${f.next_date}">${f.next_date < today ? 'overdue since ' : 'due '}${fmtDay(f.next_date)}</time></span></span></a></li>`)}</ul>` : ''}
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
        <div class="td-rest-side">${it.main_topic ? raw(String(topicPills([it.main_topic], it.score, T, { max: 1 })).replace('<span class="chip ', '<span data-shared="topic" class="chip ')) : ''}<span class="td-src">${it.source_line || ''}</span></div>
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

// T6: the eyebrow states the brief's age (the status pill already carries the date), in settings.timezone
function eyebrowOf(t, s, settings, b) {
  if (!b) return 'Today';
  const n = s?.issue?.number;
  let now = t.today || t.date;
  try { now = new Intl.DateTimeFormat('en-CA', { timeZone: settings?.timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { /* unknown zone: the server's date */ }
  const days = Math.round((Date.parse(`${now}T12:00:00Z`) - Date.parse(`${b.run_date}T12:00:00Z`)) / 864e5);
  const age = !Number.isFinite(days) ? `from the ${fmtDay(b.run_date)} run` : days <= 0 ? 'from today’s run' : days === 1 ? 'from yesterday’s run' : `from the ${fmtDay(b.run_date)} run`;
  return `Brief${n ? ` No. ${n}` : ''} · ${age}`;
}

// ------------------------------------------------------------------ render
// T1 (E1): the render task builds only the head, the run strip and the three story tiles. News weather, the map, This
// week, Waiting on you and Also in the brief are fetched in parallel and appended one tile per idle task once the page
// is on screen (byline:routed → rAF → setTimeout), each a .cv tile so off-screen ones skip style and layout.
// Today's layout observers stop when the router starts the page's exit, so they never run inside the next
// route's swap frame (their callbacks read layout).
function track(node, ro) { const page = node.closest('.page'); if (page) (page.__tdObs ||= []).push(ro); return ro; }
export function destroy(page) { for (const ro of page?.__tdObs || []) ro.disconnect(); if (page) page.__tdObs = []; }

export async function render(view) {
  await useStyle('/css/v4/today.css');
  const month = (d) => d.slice(0, 7);
  const [t, s, settings] = await Promise.all([api.get('/today'), api.get('/status').catch(() => null), api.get('/settings').catch(() => null)]);
  const today = t.today || t.date;
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const wkStart = ymdAdd(today, -dow), wkEnd = ymdAdd(wkStart, 6);
  const months = [...new Set([month(today), month(wkStart), month(wkEnd)])];
  const restData = Promise.all([
    api.get(`/stories?days=${t.window_days || 7}&limit=200`).catch(() => []),
    api.get('/map').catch(() => null),
    api.get('/slots/next').catch(() => null),
    ...months.map(m => api.get(`/calendar?month=${m}`).catch(() => ({})))
  ]).then(([stories, map, slot, ...cals]) => {
    // the calendar for today's month first (its unplanned tray is the one we report)
    cals.sort((a, b) => (a.month === month(today) ? -1 : b.month === month(today) ? 1 : 0));
    return { stories, map, slot, cals };
  });

  const T = t.threshold;
  const b = t.brief;
  const items = b?.items || [];
  const { h, l } = headline(t, items);
  const eyebrow = eyebrowOf(t, s, settings, b);
  // quiet day: the lead slot explains the quiet day; the closest stories fill the secondary slots
  const pool = b?.quiet ? items : items.slice(1);
  const pick = { lead: b?.quiet ? null : items[0], s1: pool[0], s2: pool[1], rest: pool.slice(2) };
  const weights = Object.fromEntries([...(t.topic_counts || []).map(x => [x.topic, x.weight]), ...(settings?.priorities || []).map(p => [p.topic, p.weight])].filter(([, v]) => Number.isFinite(v)));

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
        <button type="button" class="btn btn--secondary" data-act="run" data-key="R">Run today’s workflow</button>
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
  </div>` : html`
  <div class="td-grid" data-no-count>
    ${b?.quiet ? quietLead(t, items) : leadTile(pick.lead, T)}
    ${pick.s1 ? html`<div class="td-side">${storyTile(pick.s1, T, { rank: 1, size: 'lg' })}${pick.s2 ? storyTile(pick.s2, T, { rank: 2 }) : ''}</div>` : ''}
  </div>`}`);
  view.replaceChildren(el);

  wire(el, view, { t, b, items });
  fitLead(el);

  // the deferred tiles, in DOM (= phone) order; each builder returns markup from the resolved data
  const later = [
    ['weather', (d) => weatherTile(d.stories, t, weights)],
    ['map', (d) => mapTile(d.map, t)],
    ['week', (d) => weekTile(weekModel(t, settings, d.cals, d.slot), t, T, suggestion(items, T, d.cals, t))],
    ['desk', () => deskTile(t, s)],
    ...(pick.rest.length ? [['rest', () => restTile(pick.rest, T)]] : [])
  ];
  const ctl = choreographer(el, t, later.map(([k]) => k));
  let started = false;
  const go = (quick) => {
    if (started || !el.isConnected) return;
    started = true;
    document.removeEventListener('byline:routed', onRouted);
    ctl.start(quick);
    buildLater(el, restData, later, ctl);
  };
  // the shell fires byline:routed when this page swaps in; a re-render (after a run) plays a short entrance itself
  const onRouted = (e) => { if (e.detail?.page === view || e.detail?.page?.contains?.(el)) go(false); };
  if (view.classList.contains('current')) go(true);
  else { document.addEventListener('byline:routed', onRouted); setTimeout(() => { if (!started && view.classList.contains('current')) go(true); }, 2500); }
}

/** Append the deferred tiles one per task: the first after the swap frame has painted, then one per idle period. */
function buildLater(el, restData, later, ctl) {
  const grid = el.querySelector('.td-grid');
  let i = 0, data = null;
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 160 }) : setTimeout(fn, 16));
  const step = () => {
    if (!el.isConnected || !grid) return;
    if (i >= later.length) { settle(); return; }
    const [key, build] = later[i++];
    grid.insertAdjacentHTML('beforeend', String(build(data)));
    const tile = grid.lastElementChild;
    tile.classList.add('cv');
    if (key === 'map') fitMap(tile.querySelector('.td-map-canvas'), data.map);
    ctl.enter(tile);
    idle(step);
  };
  // once the entrance is over, the tiles leave content-visibility one per idle period (their estimates match, so
  // nothing moves): scrolling and full-page captures then never meet a skipped tile
  const settle = () => setTimeout(() => {
    const cvs = [...grid.querySelectorAll(':scope > .cv')];
    const next = () => { const c = cvs.shift(); if (!c || !el.isConnected) return; c.classList.remove('cv'); idle(next); };
    idle(next);
  }, Math.max(0, ctl.endsIn?.() ?? 0) + 400);
  requestAnimationFrame(() => setTimeout(() => restData.then((d) => { data = d; setTimeout(step, 0); }, () => { data = { stories: [], map: null, slot: null, cals: [] }; setTimeout(step, 0); }), 0));
}

/**
 * T3 (ruling R8): fixed 24 px gaps, never spread. When the lead is still more than 32 px shorter than the side column
 * beside it, it stops stretching (align-self: start) instead of opening bands. Measured in a ResizeObserver callback,
 * where layout is clean (no forced layout); toggling the class does not change the lead's own content height.
 */
function fitLead(el) {
  const lead = el.querySelector('.td-lead'), side = el.querySelector('.td-side');
  if (!lead || !side || !('ResizeObserver' in window)) return;
  const mix = lead.querySelector('.td-mix');
  // the stacked mix is taller than the compact one by its origin line (4 + 21 px, today.css)
  const EXTRA = mix?.querySelector('.td-mix-extra') ? 25 : 0;
  const check = () => {
    if (!lead.isConnected) { ro.disconnect(); return; }
    const last = lead.lastElementChild;
    const pad = parseFloat(getComputedStyle(lead).paddingBottom) || 0;
    const natural = last ? last.offsetTop + last.offsetHeight + pad : lead.offsetHeight;
    const beside = side.offsetTop === lead.offsetTop;
    const compact = lead.classList.contains('mix-compact');
    let useCompact = false, nat = natural;
    // the side column's own content height (its tiles stretch when the lead is the taller one)
    const px = (v) => parseFloat(v) || 0;
    const tiles = [...side.children];
    const S = tiles.reduce((sum, tile) => {
      const cs = getComputedStyle(tile), kids = [...tile.children];
      return sum + px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth)
        + kids.reduce((h, k) => h + k.offsetHeight, 0) + px(cs.rowGap) * Math.max(0, kids.length - 1);
    }, 0) + px(getComputedStyle(side).rowGap) * Math.max(0, tiles.length - 1);
    if (beside && EXTRA) {
      const nC = compact ? natural : natural - EXTRA, nF = nC + EXTRA;
      useCompact = !(nF <= S + 4); // the stacked mix when it fits (4 px slack for the estimate), else the compact one
      nat = useCompact ? nC : nF;
    }
    const short = beside && S - nat > 32;
    apply(() => {
      if (useCompact !== compact) lead.classList.toggle('mix-compact', useCompact);
      lead.classList.toggle('is-short', short);
    });
  };
  // reads happen in the observer callback (layout is clean there); while the column keeps resizing (the rail animation)
  // the writes wait until it stops, so the decision never flips classes mid-animation (E12)
  let lastAt = -1e9, timer = 0;
  const apply = (fn) => {
    const now = performance.now(), busy = now - lastAt < 120;
    lastAt = now;
    clearTimeout(timer);
    if (busy) timer = setTimeout(fn, 160); else fn();
  };
  const ro = track(lead, new ResizeObserver(check));
  ro.observe(lead); ro.observe(side);
}

// ------------------------------------------------------------------ choreography (C §2 + round 1 T4/T5)
// One animation per element or group, opacity + transform in the same keyframes. Order: h1 lines → lede (line-2 start
// + 120 ms) with the actions and the run strip (+90 ms) → tiles from lede + 200 ms (90 ms stagger) → chart rows / map
// groups inside their tiles. The deferred tiles keep their slot in that schedule: each is timed against the moment
// the page was routed, whenever its idle task appends it.
const rise = (n, delay, { y = 10, duration = 700, easing = EASE.settle } = {}) => n?.animate(
  [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'none' }], { duration, delay, easing, fill: 'backwards' });

/** The heading's timing as enterHeading set it: { start, line2 } (ms from now), read from its own animations. */
function headTiming(el) {
  const h1 = el.querySelector('.td-head h1');
  if (h1?.__enter) return h1.__enter; // set by enterHeading: no getAnimations() style flush in the swap frame (E1)
  const delays = [...new Set((h1?.getAnimations({ subtree: true }) || []).filter(a => a.effect?.target !== h1).map(a => Number(a.effect.getTiming().delay) || 0))].sort((x, y) => x - y);
  return { start: delays[0] ?? 0, line2: delays[1] ?? delays[0] ?? 0, animated: delays.length > 0 };
}

function choreographer(el, t, laterKeys) {
  const T = t?.threshold;
  const ORDER = ['lead', 'empty', 's1', 's2', 'weather', 'map', 'week', 'desk', 'rest'];
  let t0 = 0, base = 0, mode = 'still'; // still | quick | full
  const at = new Map();
  const since = () => performance.now() - t0;

  const counts = (delays = new Map()) => [...el.querySelectorAll('.td-grid .score-ring')].forEach((ring, i) => {
    const num = ring.querySelector('.ring-num[data-count-to]');
    if (!num || num.dataset.counted) return; // T2: scoreRing renders a counted (key, value) final, with no data-count-to
    num.dataset.counted = '1';
    const final = Number(num.dataset.countTo);
    const go = () => countTo(num, final, { ring, threshold: Number(ring.dataset.qThreshold ?? T), duration: i === 0 ? 1400 : 1100, key: ring.dataset.countKey });
    const d = delays.get(ring);
    // T2: a ring that already counted this session (another render in between) paints its final value at once
    if (mode !== 'full' || d == null || hasCounted(ring.dataset.countKey, String(Math.round(final)))) go(); else setTimeout(go, d);
  });

  return {
    start(quick) {
      t0 = performance.now();
      heat(t);
      mode = reducedMotion() || document.hidden ? 'still' : quick ? 'quick' : 'full';
      if (mode === 'still') { counts(); return; }
      const head = el.querySelector('.td-head');
      const actions = head?.querySelector('.page-head-actions');
      const strip = el.querySelector('.td-strip');
      const tops = [...el.querySelectorAll('.td-grid > .tile, .td-grid > .empty, .td-side > .tile')];
      const keys = [...tops.map(n => n.dataset.tile), ...laterKeys].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      if (mode === 'quick') { // a re-render after a run: one short cascade, no heading choreography
        keys.forEach((k, i) => at.set(k, i * 40));
        tops.forEach(tile => rise(tile, at.get(tile.dataset.tile), { y: 8, duration: 500 }));
        counts();
        return;
      }
      // the head's actions and the run strip: take them off the shell's generic enter classes (which would show them
      // before the h1) and bring them in with the lede
      for (const n of [actions, strip, ...(actions ? actions.querySelectorAll('.enter-head, .enter-item') : [])]) { n?.classList.remove('enter-item', 'enter-head'); n?.style.removeProperty('--i'); }
      const ht = headTiming(el);
      const lede = head?.querySelector('.lede');
      let ledeAt = ht.line2 + 120;
      if (ht.animated && ht.start <= 80) ledeAt = Math.max(ledeAt, ht.start + 390); // first load: the long 'Settle' (≈450 ms)
      if (lede) { (ht.lede || lede.getAnimations()).forEach(a => a.cancel()); rise(lede, ledeAt, { y: 6, duration: 600, easing: EASE.fade }); }
      const fadeIn = (n, d) => rise(n, d, { y: 6, duration: 450, easing: EASE.fade });
      fadeIn(actions, ledeAt);
      fadeIn(strip, ledeAt + 90);
      base = ledeAt + 200;
      keys.forEach((k, i) => at.set(k, base + i * 90));
      tops.forEach(tile => rise(tile, at.get(tile.dataset.tile), { y: 12, duration: 800 }));
      // rings count up as their tiles land
      const delays = new Map([...el.querySelectorAll('.td-grid .score-ring')].map(r => [r, (at.get(r.closest('[data-tile]')?.dataset.tile) ?? base) + 300]));
      counts(delays);
      const lead = el.querySelector('.td-lead');
      pulseOn(lead, Math.max(0, (at.get('lead') ?? base) - 100));
    },
    /** ms until the last tile's entrance has finished (0 when nothing is animating). */
    endsIn() { if (mode === 'still') return 0; const last = Math.max(0, ...at.values()); return last + 900 - since(); },
    /** A deferred tile was appended: run its slot of the cascade (late tiles come in at once, shorter). */
    enter(tile) {
      if (mode === 'still') return;
      const k = tile.dataset.tile;
      const d = (at.get(k) ?? base) - since();
      if (mode === 'quick') { rise(tile, Math.max(0, d), { y: 8, duration: 500 }); return; }
      const late = d < 0;
      rise(tile, Math.max(0, d), late ? { y: 8, duration: 500 } : { y: 12, duration: 800 });
      const inner = Math.max(0, d) + (late ? 60 : 160);
      if (k === 'weather') tile.querySelectorAll('.td-wx-row').forEach((row, i) => rise(row, inner + i * 40, { y: 0, duration: 520, easing: EASE.fade }));
      if (k === 'map') {
        tile.querySelector('.td-map-edges')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: inner + 120, easing: EASE.fade, fill: 'backwards' });
        tile.querySelector('.td-map-nodes')?.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: inner, easing: EASE.settle, fill: 'backwards' });
      }
    }
  };
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

  // weather: chart ⇄ table (the text alternative, F §5). Delegated: the tile is appended after the page shows (T1).
  const wxTable = (btn) => {
    const tile = btn.closest('.td-wx'), table = tile.querySelector('.td-wx-table');
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Show as chart' : 'Show as table';
    tile.classList.toggle('show-table', on);
    table.classList.toggle('is-visible', on);
    table.classList.toggle('sr-only', !on);
    if (!reducedMotion()) (on ? table : tile.querySelector('.td-wx-chart')).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
  };

  // weather: hovering a dot echoes the same story in every topic row
  let lit = null;
  const light = (wx, id) => {
    if (lit === id) return;
    wx.querySelectorAll('.td-wx-dot.is-echo').forEach(d => d.classList.remove('is-echo'));
    lit = id;
    if (id) wx.querySelectorAll(`.td-wx-dot[data-s="${CSS.escape(id)}"]`).forEach(d => d.classList.add('is-echo'));
  };
  el.addEventListener('pointerover', (e) => { const wx = e.target.closest?.('.td-wx-chart'); if (wx) light(wx, e.target.closest('.td-wx-dot')?.dataset.s || null); else if (lit) light(el, null); });

  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'menu') { setMenu(btn.getAttribute('aria-expanded') !== 'true'); return; }
    if (a === 'wx-table') { wxTable(btn); return; }
    if (a === 'open-lead') { btn.closest('.td-lead')?.querySelector('.td-stretch')?.click(); return; } // same path as the title link
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
