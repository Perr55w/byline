// Story dossier CONTENT (F §3 information architecture, D §5 layout) rendered into the dossier frame
// (public/js/dossier.js). Data: GET /api/stories/:id (docs/design/API-v4.md) — every figure, sentence and
// mark below comes from that payload; nothing is invented. Imported once by app.js; self-registers.
//
// Layout: header (eyebrow, h1, finding dek, actions | ring + fact strip) over a flat 7/5 grid, the right
// column set off by a hairline. Left: "What the sources say" + "Evidence". Right (sticky): "Why it ranked",
// "Score breakdown" (tracks ∝ weights), "Lens", employer connections, drafts & projects, ranking feedback;
// the foot sections move under the left column when the right one runs long. Phone order (F): header → Why it
// ranked → What the sources say → Evidence → Breakdown → Lens, actions pinned to the bottom of the sheet.
// Progressive (E2): the open/swap render holds the header, Why it ranked, the breakdown and the first two
// source cards; the rest arrives after the flight, one section per idle chunk.
// Shared elements for the frame's FLIP: data-shared="title" | "ring" | "topic".

import { api } from '../api.js';
import { html, raw, esc, icon, scoreRing, toast, act, channelLabel, status as statusTag, useStyle, threshold as liveThreshold } from '../ui.js';
import { qualityColor } from '../quality.js';
import { EASE, reduced } from '../motion.js';
import { registerDossierRenderer } from '../dossier.js';

const CSS = '/css/v4/dossier.css';
useStyle(CSS); // warm it so the first open never waits on the stylesheet

const COLLECTIONS = ['AI product management', 'Business analysis', 'Data analytics', 'Career watchlist'];
const FORMATS = [
  ['linkedin', 'long', 'LinkedIn · analysis'], ['linkedin', 'article', 'LinkedIn · article'], ['linkedin', 'short', 'LinkedIn · short'],
  ['instagram', 'carousel', 'Instagram carousel'], ['instagram', 'reel', 'Instagram Reel'], ['video', 'explainer', 'Video explainer']
];
const FEEDBACK = [['useful', 'Useful'], ['repetitive', 'Repetitive'], ['low_quality', 'Low quality'], ['off_topic', 'Off-topic']];

// ------------------------------------------------------------------ small formatters
const tz = () => window.__byline?.timezone || undefined;
const day = (iso, wd = false) => iso ? new Date(iso).toLocaleDateString('en-GB', { ...(wd ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', timeZone: tz() }).replace(',', '') : '';
const clock = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz() }) : '';
function ago(iso) {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  return d < 14 ? `${d}d ago` : `on ${day(iso)}`;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const f1 = (v) => (Number(v) || 0).toFixed(1);
const f2 = (v) => (Number(v) || 0).toFixed(2);
/** Text with [start, end) number marks rendered as <mark>; every slice escaped (API-v4 conventions). */
function marked(text, marks) {
  const t = String(text ?? '');
  if (!marks?.length) return raw(esc(t));
  let out = '', at = 0;
  for (const [a, b] of marks) {
    if (a < at || b > t.length || b <= a) continue;
    out += esc(t.slice(at, a)) + `<mark class="num-hl">${esc(t.slice(a, b))}</mark>`;
    at = b;
  }
  return raw(out + esc(t.slice(at)));
}
/** Quoted words (“agent”) become highlighted term tokens. Input is plain text; output is escaped markup. */
const termsIn = (text) => raw(esc(text).replace(/“([^”]{1,60})”/g, '<span class="dx-term">$1</span>'));
const tokens = (list) => html`${(list || []).map(t => html`<span class="dx-term">${t}</span>`)}`;
const listJoin = (parts) => parts.length <= 1 ? parts : parts.flatMap((p, i) => (i === 0 ? [p] : [raw(i === parts.length - 1 ? ' and ' : ', '), p]));
/** Case-insensitive de-duplication that keeps the first spelling ("AI adoption, AI adoption" → "AI adoption"). */
const uniqCI = (list) => { const seen = new Set(); return (list || []).filter(x => { const k = String(x).trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
// engagement keys → words (F: "610 replys")
const ENG = { reply_count: 'replies', like_count: 'likes', retweet_count: 'reposts', quote_count: 'quotes', view_count: 'views', bookmark_count: 'bookmarks' };
const engText = (eng) => eng.map(([k, v]) => `${Number(v).toLocaleString()} ${ENG[k] || k.replace(/_count$/, '').replace(/_/g, ' ')}`).join(' · ');
// press-release openers (src/finding.js BOILERPLATE + F round 1 additions); the server flag wins when present
const BOILER = /^(this article is adapted|learn about|read on|today,? we(?:'|’)?re\b|today,? we are (announcing|introducing|launching|excited)|we are expanding our partnership|we['’]re (excited|highlighting)|features\b|bug fixes)/i;
const words = (t) => new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}%.\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2));
/** Same sentence give or take wording (the dek is often a claim rephrased): Jaccard over content words. */
function sameText(a, b) {
  const A = a instanceof Set ? a : words(a), B = b instanceof Set ? b : words(b);
  if (!A.size || !B.size) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n) >= 0.5;
}

// source-role shape markers (F §4): ■ first-party / primary, ◆ independent, ○ commentary & community
const ROLE = { first_party: ['fp', 'first-party'], primary: ['fp', 'primary source'], independent: ['ind', 'independent'], commentary: ['com', 'commentary or community'] };
const marker = (role) => html`<i class="mk mk--${(ROLE[role] || ROLE.commentary)[0]}" aria-hidden="true"></i>`;
const KIND_TONE = { Primary: 'neutral', Research: 'neutral', Independent: 'ok', Reporting: 'ok', Commentary: 'neutral', Community: 'neutral', 'Release notes': 'neutral' };

// ------------------------------------------------------------------ header
function headerHtml(d, th) {
  const s = d.story;
  const topics = s.topics || [];
  const main = s.main_topic || topics[0] || null;
  const rest = topics.filter(t => t !== main).slice(0, 2);
  const employers = s.breakdown?.employers || [];
  const companies = [...(s.companies || [])].sort((a, b) => (employers.includes(b) ? 1 : 0) - (employers.includes(a) ? 1 : 0));
  const origin = d.origin;
  const archived = s.status === 'archived';
  const eyebrow = [main || 'Story', s.first_seen ? `first seen ${day(s.first_seen)}, ${clock(s.first_seen)}` : '', s.updated_at ? `updated ${ago(s.updated_at)}` : ''].filter(Boolean).join(' · ');
  return html`
  <header class="dx-head">
    <div class="dx-head-main">
      <p class="eyebrow dx-eyebrow" data-dossier-section>${eyebrow}${s.is_demo ? html` <span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}${archived ? html` <span class="tag tag--neutral">Archived</span>` : ''}</p>
      <h1 class="dx-title" data-shared="title">${s.title}</h1>
      ${s.finding ? html`<p class="dx-dek" data-dossier-section>${marked(s.finding, s.finding_marks)}</p>` : ''}
      ${main ? html`<div class="dx-topics"><span class="chip chip--main" data-shared="topic">${main}</span>${rest.length ? html`<span class="dx-rest-topics" data-dossier-section>${rest.map(t => html`<span class="chip chip--topic">${t}</span>`)}</span>` : ''}</div>` : ''}
      <div class="dx-actions" data-dossier-section>
        <div class="dx-split">
          <button type="button" class="btn btn--primary" data-dx="draft" data-channel="linkedin" data-format="long" data-dz-draft>${icon('pen')}Draft a post</button>
          <button type="button" class="btn btn--primary btn--icon dx-split-more" data-dx="menu" data-menu="formats" aria-haspopup="menu" aria-expanded="false" aria-label="More formats">${icon('chevron-right', 'dx-chev')}</button>
          <div class="dx-menu" role="menu" data-menu-for="formats" hidden>
            ${FORMATS.map(([c, f, l]) => html`<button type="button" role="menuitem" class="dx-menu-item" data-dx="draft" data-channel="${c}" data-format="${f}">${l}</button>`)}
            <button type="button" role="menuitem" class="dx-menu-item" data-dx="project-auto">Portfolio project</button>
          </div>
        </div>
        <div class="dx-split">
          <button type="button" class="btn btn--secondary" data-dx="menu" data-menu="save" aria-haspopup="menu" aria-expanded="false">${icon('bookmark')}${d.saved?.length ? `Saved · ${d.saved.length}` : 'Save'}</button>
          <div class="dx-menu" role="menu" data-menu-for="save" hidden>
            ${COLLECTIONS.map(c => { const on = (d.saved || []).some(x => x.collection === c); return html`<button type="button" role="menuitemcheckbox" aria-checked="${on}" class="dx-menu-item" data-dx="save" data-c="${c}"><span class="dx-check" aria-hidden="true">${on ? icon('check') : ''}</span>${c}</button>`; })}
          </div>
        </div>
        <button type="button" class="btn btn--secondary" data-dx="dismiss">${archived ? 'Restore to feed' : 'Dismiss'}</button>
        ${origin?.url ? html`<a class="btn btn--ghost" href="${origin.url}" target="_blank" rel="noopener noreferrer">Open primary${icon('arrow-up-right')}</a>` : ''}
      </div>
    </div>
    <div class="dx-head-side">
      <div class="dx-ring" data-shared="ring">${scoreRing(s.score, th, { size: 92 })}</div>
      <dl class="dx-facts">
        <div class="dx-fact" data-dossier-section>
          <dt>Sources</dt>
          <dd class="dx-fact-v">${s.source_line}</dd>
          <dd class="dx-fact-s">${s.evidence_qualifier || ''}</dd>
        </div>
        ${companies.length ? html`<div class="dx-fact" data-dossier-section>
          <dt>Companies</dt>
          <dd class="dx-fact-v" title="${companies.join(', ')}">${companies[0]}${companies.length > 1 ? html` <span class="ink-3">+${companies.length - 1}</span>` : ''}</dd>
          <dd class="dx-fact-s">${companies.length > 1 ? companies.slice(1).join(', ') : 'the only company named'}</dd>
        </div>` : ''}
      </dl>
    </div>
  </header>`;
}

// ------------------------------------------------------------------ A. What the sources say
/**
 * What one post says. F §3: the summary only when it is not a press-release opener (server flag or the
 * same regex); otherwise the post's best claim (numbers first); never a sentence that repeats the dek.
 * Returns { says, claims } with `says` null when only the title is worth showing.
 */
function postView(a, dek) {
  const all = (a.claims || []).filter(c => !(dek && sameText(c.text, dek)));
  let says = a.says || null;
  if (says && says.from === 'summary' && (a.summary_is_boilerplate || BOILER.test(says.text))) says = null;
  if (says && dek && sameText(says.text, dek)) says = null;
  if (says && BOILER.test(says.text)) says = null;
  if (!says) {
    const best = all.filter(c => !BOILER.test(c.text)).sort((x, y) => (y.has_number ? 1 : 0) - (x.has_number ? 1 : 0))[0];
    if (best) says = { text: best.text, marks: best.marks, from: 'claim', claim_id: best.id };
  }
  const claims = all.filter(c => !BOILER.test(c.text) && c.id !== says?.claim_id && !(says && sameText(c.text, says.text)));
  return { says, claims };
}
function articleCard(a, dek) {
  const tone = KIND_TONE[a.kind_label] || 'neutral';
  const when = a.published_at ? day(a.published_at) : `fetched ${day(a.fetched_at)}`;
  const { says, claims } = postView(a, dek);
  return html`<article class="dx-art">
    <div class="dx-art-meta">
      ${marker(a.role)}<span class="tag tag--${tone}">${a.kind_label}</span>
      <span class="dx-dom">${a.domain}</span>
      ${a.source_name ? html`<span class="dx-srcname">${a.source_name}</span>` : ''}
      <time datetime="${a.published_at || a.fetched_at || ''}">${when}</time>
      ${a.is_new ? html`<span class="tag tag--ok">New</span>` : ''}${a.is_demo ? html`<span class="tag tag--demo">Demo</span>` : ''}
    </div>
    <a class="dx-art-title" href="${a.url}" target="_blank" rel="noopener noreferrer"><span>${a.title}<span class="sr-only"> (opens the article)</span></span>${icon('arrow-up-right', 'dx-out')}</a>
    ${says ? html`<p class="dx-says"><span class="dx-says-k">${says.from === 'summary' ? 'Summary' : 'Key claim'}</span>${marked(says.text, says.marks)}</p>` : ''}
    ${claims.length ? html`<ul class="dx-claims">${claims.map((c, i) => html`<li${i >= 1 ? raw(' hidden data-more') : ''}>${marked(c.text, c.marks)}${c.also_reported_by?.length ? html` <span class="dx-also">also reported by ${c.also_reported_by.join(', ')}</span>` : ''}</li>`)}</ul>
      ${claims.length > 1 ? html`<button type="button" class="dx-link" data-dx="more-claims">+${plural(claims.length - 1, 'more claim')}</button>` : ''}` : ''}
  </article>`;
}
/**
 * The sources section. `defer` (open phase) collects everything after the first two cards as deferred
 * chunks: [{ slot, html() }]; their placeholders are empty hidden divs replaced after the flight.
 */
function sourcesHtml(d, defer = null) {
  const arts = d.articles || [];
  const hdr = d.sources_header || {};
  const c = hdr.counts || {};
  const dek = d.story?.finding || '';
  const groups = Object.fromEntries((d.domain_groups || []).filter(g => g.collapse).map(g => [g.domain, g]));
  const done = new Set();
  const blocks = [];
  let cards = 0, n = 0;
  const later = (fn) => { if (!defer) return fn(); const slot = `src${n++}`; defer.push({ slot, html: fn }); return raw(`<div data-defer="${slot}" hidden></div>`); };
  for (const a of arts) {
    if (done.has(a.id)) continue;
    const g = groups[a.domain];
    if (!g) { done.add(a.id); blocks.push(cards++ < 2 ? articleCard(a, dek) : later(() => articleCard(a, dek))); continue; }
    const members = arts.filter(x => x.domain === a.domain);
    members.forEach(x => done.add(x.id));
    const first = members.slice(0, 2), rest = members.slice(2);
    const restHtml = () => html`<div class="dx-rest" data-rest>
        <ol class="dx-compact">${rest.map(x => { const v = postView(x, dek); return html`<li><a href="${x.url}" target="_blank" rel="noopener noreferrer" class="dx-compact-t">${x.title}</a>${v.says ? html`<span class="dx-compact-s">${marked(v.says.text, v.says.marks)}</span>` : ''}</li>`; })}</ol>
        <div class="dx-rest-full" data-domain="${a.domain}" hidden></div>
      </div>`;
    const firstCards = first.map(x => (cards++ < 2 ? articleCard(x, dek) : later(() => articleCard(x, dek))));
    blocks.push(html`<div class="dx-group">
      <div class="dx-group-head">${marker(members[0].role)}<span>${g.label}</span>${rest.length ? html`<button type="button" class="dx-link dx-group-more" data-dx="expand-group" aria-expanded="false">Show all ${members.length} in full</button>` : ''}</div>
      ${firstCards}
      ${rest.length ? later(restHtml) : ''}
    </div>`);
  }
  const callout = hdr.callout;
  const present = [['first_party', (c.first_party || 0) + (c.primary || 0), `first-party${c.primary ? ' / primary' : ''}`], ['independent', c.independent || 0, 'independent'], ['commentary', c.commentary || 0, 'commentary / community']];
  return html`<section class="dx-sec dx-sources" data-dossier-section aria-labelledby="dx-h-sources">
    <div class="section-head"><h2 class="t-h2 dx-h" id="dx-h-sources">What the sources say</h2>${arts.length ? html`<span class="dx-legend" aria-hidden="true">${present.filter(([, n]) => n > 0).map(([k, , l]) => html`<span>${marker(k)}${l}</span>`)}</span>` : ''}</div>
    ${callout?.text ? html`<div class="dx-callout dx-callout--${callout.kind}" role="note">${callout.kind === 'disagreement' ? html`<span class="dx-callout-k">Independent check</span><span>${marked(callout.text.replace(/^Independent check:\s*/, ''), (callout.marks || []).map(([a, b]) => { const off = callout.text.length - callout.text.replace(/^Independent check:\s*/, '').length; return [a - off, b - off]; }))}</span>` : html`<span class="dx-callout-k">${callout.kind === 'all_first_party' ? 'First-party only' : 'No independent report'}</span><span>${marked(callout.text, callout.marks)}</span>`}</div>` : ''}
    ${arts.length ? html`<div class="dx-arts">${blocks}</div>` : html`<p class="dx-empty">No articles are attached to this story.</p>`}
  </section>`;
}

// ------------------------------------------------------------------ B. Evidence
/**
 * "Checkable numbers" (C, F): each figure inside its claim fragment (±8 words) with the source domain.
 * At most 4; a figure with no fragment in the stored claims/summaries is dropped, and so is the row.
 */
function numberFragments(d, terms) {
  const dom = new Map((d.articles || []).map(a => [a.id, a.domain]));
  const dekW = d.story?.finding ? words(d.story.finding) : null;
  const seen = new Set();
  const pool = [...(d.claims || []).map(c => ({ text: c.text_clean || c.text, domain: dom.get(c.article_id) })),
    ...(d.articles || []).filter(a => a.says?.text).map(a => ({ text: a.says.text, domain: a.domain }))]
    .filter(p => { const k = p.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); p.lc = k; return !(dekW && sameText(p.text, dekW)); });
  // figures per sentence: several figures in one claim share one fragment
  const hits = new Map(); let count = 0;
  for (const term of terms || []) {
    if (count >= 4) break;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{N}])`, 'iu');
    const lt = String(term).toLowerCase();
    const p = pool.find(x => x.lc.includes(lt) && re.test(x.text));
    if (!p) continue;
    const m = re.exec(p.text);
    const at = m.index + m[1].length;
    const list = hits.get(p) || [];
    if (list.some(([a, b]) => at < b && at + m[2].length > a)) continue;
    list.push([at, at + m[2].length]); hits.set(p, list); count++;
  }
  return [...hits].slice(0, 3).map(([p, marks]) => {
    marks.sort((x, y) => x[0] - y[0]);
    const t = p.text, a0 = marks[0][0], b1 = marks[marks.length - 1][1];
    // ±8 words around the first and last figure
    const before = t.slice(0, a0).split(/(\s+)/), after = t.slice(b1).split(/(\s+)/);
    const pre = before.slice(-16).join(''), post = after.slice(0, 16).join('');
    const from = a0 - pre.length, to = b1 + post.length;
    const frag = t.slice(from, to).trim().replace(to < t.length ? /[,;:]$/ : /$^/, ''), off = from + (t.slice(from, to).length - t.slice(from, to).trimStart().length);
    return html`<li><span class="dx-frag">${from > 0 ? '…' : ''}${marked(frag, marks.map(([a, b]) => [a - off, b - off]))}${to < t.length ? '…' : ''}</span> <span class="dx-frag-src">${p.domain || ''}</span></li>`;
  });
}
function evidenceHtml(d, defer = null) {
  const e = d.evidence;
  if (!e) return '';
  if (e.legacy || !e.priorities) {
    return html`<section class="dx-sec dx-evidence" data-dossier-section aria-labelledby="dx-h-ev"><div class="section-head"><h2 class="t-h2 dx-h" id="dx-h-ev">Evidence</h2></div>
      <p class="dx-empty">${d.story?.explanation || 'This story was ranked before evidence was stored.'}</p></section>`;
  }
  const p = e.priorities, w = e.watchlist, pr = e.practical, pw = e.post_worthy;
  const strip = (text, topic) => String(text || '').replace(new RegExp(`^${topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`), '');
  const eng = Object.entries(d.story?.breakdown?.engagement || {});
  const grp = (title, sum, body) => html`<div class="dx-ev"><div class="dx-ev-k"><h3>${title}</h3>${sum ? html`<p>${sum}</p>` : ''}</div><div class="dx-ev-v">${body}</div></div>`;
  const prow = p.rows || [];
  // the post-worthy group (quotes + number fragments) is its own idle chunk
  const later = (fn) => { if (!defer) return fn(); defer.push({ slot: 'ev-pw', html: fn }); return raw('<div data-defer="ev-pw" hidden></div>'); };
  let pwCache = null;
  const pwRows = () => pwCache || (pwCache = (pw.rows || []).map(r => {
    if (r.signal !== 'numbers') return html`<li><b>${r.label}</b>${r.quote ? html`<q class="dx-quote" title="${r.quote}">${r.quote}</q>` : html`<span>${r.text}</span>`}</li>`;
    const frags = numberFragments(d, r.terms);
    return frags.length ? html`<li><b>${r.label}</b><ul class="dx-nums">${frags}</ul></li>` : '';
  }).filter(x => x !== ''));
  return html`<section class="dx-sec dx-evidence" data-dossier-section aria-labelledby="dx-h-ev">
    <div class="section-head"><h2 class="t-h2 dx-h" id="dx-h-ev">Evidence</h2><span class="section-meta">what the ranking matched</span></div>
    ${grp(p.title, p.summary, prow.length ? html`<ul class="dx-ev-rows">${prow.map((r, i) => html`<li${i >= 3 ? raw(' hidden data-more') : ''}><span class="chip ${r.strong ? 'chip--main' : 'chip--topic'}">${r.topic}</span><span>${termsIn(strip(r.text, r.topic))}</span></li>`)}</ul>${prow.length > 3 ? html`<button type="button" class="dx-link" data-dx="more-claims">+${prow.length - 3} more</button>` : ''}` : html`<p class="dx-empty">${p.empty || 'No priority matched.'}</p>`)}
    ${grp(w.title, null, (w.rows?.length || w.employers?.length) ? html`<ul class="dx-ev-rows">
      ${(w.rows || []).map(r => html`<li class="dx-watch"><span class="dx-watch-q">${r.name}</span><span class="dx-watch-m"><span class="tag tag--neutral">${r.kind}</span>${r.pinned ? html`<span class="tag tag--neutral">Pinned</span>` : ''}${r.terms?.length ? html`<span class="ink-3">matched</span>${tokens(r.terms)}` : ''}</span></li>`)}
      ${(w.employers || []).map(r => html`<li><span>${r.text}${r.pinned ? html` <span class="tag tag--neutral">Big-push employer</span>` : ''}</span></li>`)}
    </ul>` : html`<p class="dx-empty">${w.empty || 'No watchlist items or employers mentioned.'}</p>`)}
    ${grp(pr.title, null, pr.mapped?.length ? html`<p class="dx-ev-line">Mentions ${listJoin(pr.mapped.map(t => html`<span class="dx-term">${t}</span>`))}.</p>` : html`<p class="dx-empty">${pr.empty || pr.text || 'No practical signals.'}</p>`)}
    ${later(() => html`${grp(pw.title, null, pwRows().length ? html`<ul class="dx-ev-rows dx-pw">${pwRows()}</ul>` : html`<p class="dx-empty">${pw.empty || 'No post-worthy signals found.'}</p>`)}
    ${e.de_emphasis?.text || e.notes?.length || eng.length ? html`<ul class="dx-notes">
      ${e.de_emphasis?.text ? html`<li>${termsIn(e.de_emphasis.text)}</li>` : ''}
      ${(e.notes || []).map(n => html`<li>${n}</li>`)}
      ${eng.length ? html`<li>Engagement, shown separately and not counted as evidence: ${engText(eng)}.</li>` : ''}
    </ul>` : ''}`)}
  </section>`;
}

// ------------------------------------------------------------------ C/D. Why it ranked + score breakdown
function whyHtml(d) {
  const why = d.why_ranked || [];
  if (!why.length) return '';
  return html`<section class="dx-sec dx-why" data-dossier-section aria-labelledby="dx-h-why">
    <h2 class="t-h2 dx-h" id="dx-h-why">Why it ranked</h2>
    <ul class="dx-why-list">${why.map(t => html`<li>${t}</li>`)}</ul>
  </section>`;
}
function breakdownHtml(d, th, pending) {
  const b = d.breakdown || {};
  const score = Number(d.story?.score ?? b.score) || 0;
  // the same integer as the ring caption (quality.js qualityLabel): round(score) − bar
  const delta = Math.round(score) - th;
  const verdict = delta >= 0 ? html`<b>${delta}</b> over your bar of ${th}` : html`<b>${-delta}</b> below your bar of ${th}`;
  if (b.legacy || !b.rows) {
    return html`<section class="dx-sec dx-score" data-dossier-section aria-labelledby="dx-h-score">
      <h2 class="t-h2 dx-h" id="dx-h-score">Score</h2>
      <div class="dx-score-top"><span class="dx-score-num">${f1(score)}</span><span class="dx-score-cap">of 100 · ${verdict}</span></div>
      <p class="dx-empty">Ranked before the breakdown was stored; only the score is available.</p></section>`;
  }
  const rows = b.rows;
  const sum = Number(b.computed ?? score);
  const mults = b.multipliers || [], neutral = mults.filter(m => Number(m.value) === 1);
  return html`<section class="dx-sec dx-score" data-dossier-section aria-labelledby="dx-h-score">
    <div class="section-head"><h2 class="t-h2 dx-h" id="dx-h-score">Score breakdown</h2><span class="section-meta">bar ${th}</span></div>
    <p class="dx-score-line"><b>${f1(score)}</b> of 100 · ${verdict}</p>
    <p class="dx-base">Base <b>${f1(b.base)}</b> of ${b.base_max || 100} <span class="ink-3">· track length = weight</span></p>
    <ol class="dx-bars${pending ? ' is-pending' : ''}" aria-label="Score components, track length proportional to weight">
      ${rows.map(r => html`<li class="dx-bar" style="--track:${Number(r.track) || 0};--fill:${Math.max(0, Math.min(1, Number(r.fraction) || 0))};--q:${qualityColor((Number(r.fraction) || 0) * 100, th)}">
        <span class="dx-bar-l">${r.label}<small>${r.weight_pct}%</small></span>
        <span class="dx-bar-t" aria-hidden="true"><span class="dx-bar-track"><i></i></span></span>
        <span class="dx-bar-v"><b>${f1(r.points)}</b> / ${r.max}</span>
        ${r.note ? html`<span class="dx-bar-n">${r.note}</span>` : ''}
      </li>`)}
    </ol>
    <ul class="dx-mults">${mults.filter(m => Number(m.value) !== 1).map(m => html`<li><span class="dx-mult-v">× ${f2(m.value)}</span><span class="dx-mult-l">${m.label}</span><span class="dx-mult-n">${m.note || ''}</span></li>`)}
      ${neutral.length ? html`<li class="is-neutral" title="${neutral.map(m => `${m.label}: ${m.note || 'no change'}`).join('\n')}"><span class="dx-mult-v">× ${f2(1)}</span><span class="dx-mult-l dx-mult-l--all">${neutral.map(m => m.label).join(', ')}</span></li>` : ''}</ul>
    <p class="dx-recon"><span class="dx-mult-v">= ${f1(sum)} → ${Math.round(sum)}</span>${b.reconciles ? html`<span class="ink-3">matches the stored score</span>` : html`<span class="ink-3">computed; stored score ${f1(score)} (components rounded)</span>`}</p>
  </section>`;
}

// ------------------------------------------------------------------ E/F. Lens, connections, drafts, feedback
function lensHtml(d) {
  const l = d.lens || {};
  const who = Array.isArray(l.who) ? l.who : String(l.who || '').split(/;\s*/).filter(Boolean);
  const tests = (Array.isArray(l.test) ? l.test : [l.test]).filter(Boolean);
  if (!who.length && !l.decision && !tests.length) return '';
  return html`<section class="dx-sec dx-lens" data-dossier-section aria-labelledby="dx-h-lens">
    <div class="section-head"><h2 class="t-h2 dx-h" id="dx-h-lens">Lens</h2><button type="button" class="btn btn--ghost btn--sm" data-dx="lens">Refresh</button></div>
    ${who.length ? html`<h3 class="dx-k">Who it matters to</h3><ul class="dx-who">${who.map(w => html`<li>${w}</li>`)}</ul>` : ''}
    ${l.decision ? html`<h3 class="dx-k">What it could change</h3><p class="dx-p">${l.decision}</p>` : ''}
    ${tests.length ? html`<h3 class="dx-k">What to test</h3><ul class="dx-tests">${tests.map((t, i) => html`<li><span class="dx-box" aria-hidden="true"></span><span class="dx-test-t">${t} <button type="button" class="dx-link dx-link--inline" data-dx="test-project" data-i="${i}">Make it a project</button></span></li>`)}</ul>` : ''}
    <p class="dx-fine">Lens: ${l.provider || 'provider'}</p>
  </section>`;
}
/** The quote the server embedded in `why` ("…; domain says: “…”"). */
const quoteOf = (c) => /“([^”]+)”\s*$/.exec(c.why || '')?.[1] || null;
/**
 * Employer connections (B, C, D, F round 1). A card only for employers a source names directly
 * (`mention_ok`); every topical-only overlap folds into one chip row with its shared basis quoted once and
 * the caveat stated once at the foot. Topic hits are de-duplicated case-insensitively.
 */
function connectionsHtml(d) {
  const list = d.employer_connections || [];
  const head = html`<h2 class="dx-h3" id="dx-h-conn">Employer connections</h2>`;
  if (!list.length) return html`<section class="dx-sec dx-conn" data-dossier-section data-dx-movable aria-labelledby="dx-h-conn">${head}<p class="dx-empty">No grounded connection to your target employers.</p></section>`;
  const named = list.filter(c => c.mention_ok), topical = list.filter(c => !c.mention_ok);
  const shownQuotes = new Map(); // quote → first employer that showed it
  const card = (c, i) => {
    const q = quoteOf(c), hits = uniqCI(c.matched).filter(h => h.toLowerCase() !== String(c.employer).toLowerCase());
    const dup = q && shownQuotes.has(q);
    if (q && !dup) shownQuotes.set(q, c.employer);
    return html`<li${i >= 3 ? raw(' hidden data-more') : ''}>
      <div class="dx-conn-top"><b>${c.employer}</b><span class="tag tag--ok">Named in a source</span></div>
      ${hits.length ? html`<p>Works publicly on ${listJoin(hits.slice(0, 3).map(h => html`<span class="dx-term">${h}</span>`))}.</p>` : ''}
      ${q ? (dup ? html`<p class="dx-fine">Same passage as ${shownQuotes.get(q)}.</p>` : html`<q class="dx-quote">${q}</q>`) : ''}
      ${c.source?.url ? html`<p class="dx-fine"><a href="${c.source.url}" target="_blank" rel="noopener noreferrer">${c.source.domain || 'source'}</a></p>` : ''}
    </li>`;
  };
  const namedCards = named.map(card); // first: the cards record the passages they quote
  // the basis most of the topical overlaps share, quoted once
  const byQuote = new Map();
  for (const c of topical) { const q = quoteOf(c); if (q) byQuote.set(q, [...(byQuote.get(q) || []), c]); }
  const [basisQ, basisList] = [...byQuote].sort((a, b) => b[1].length - a[1].length)[0] || [null, []];
  const basisShown = basisQ && !shownQuotes.has(basisQ);
  const caveat = topical.find(c => c.mention_note)?.mention_note;
  return html`<section class="dx-sec dx-conn" data-dossier-section data-dx-movable aria-labelledby="dx-h-conn">
    ${head}
    ${named.length ? html`<ul class="dx-conn-list">${namedCards}</ul>
      ${named.length > 3 ? html`<button type="button" class="dx-link" data-dx="more-conn">Show ${plural(named.length - 3, 'more employer')}</button>` : ''}` : ''}
    ${topical.length ? html`<div class="dx-conn-topical">
      <p class="dx-conn-k">Topical overlap only, not named:</p>
      <div class="dx-conn-chips">${topical.map(c => { const hits = uniqCI(c.matched); return html`<span class="chip chip--topic" title="${hits.length ? `Overlaps on ${hits.join(', ')}` : 'Topical overlap'}">${c.employer}</span>`; })}</div>
      ${basisQ && !basisShown ? html`<p class="dx-conn-basis ink-3">Same passage as ${shownQuotes.get(basisQ)} above.</p>` : ''}
      ${basisShown ? html`<p class="dx-conn-basis"><span class="ink-3">${basisList.length === topical.length ? (topical.length > 1 ? 'All match on' : 'Matches on') : html`${listJoin(basisList.map(c => c.employer))} match on`} this passage from ${basisList[0].source?.url ? html`<a href="${basisList[0].source.url}" target="_blank" rel="noopener noreferrer">${basisList[0].source.domain || 'the source'}</a>` : 'the source'}:</span> <q class="dx-quote">${basisQ}</q></p>` : ''}
    </div>` : ''}
    ${caveat ? html`<p class="dx-fine dx-conn-caveat">${caveat}</p>` : ''}
  </section>`;
}
function makeHtml(d) {
  const drafts = d.drafts || [], projects = d.projects || [];
  return html`<section class="dx-sec dx-make" data-dossier-section data-dx-movable aria-labelledby="dx-h-make">
    <div class="section-head"><h2 class="dx-h3" id="dx-h-make">Drafts & projects</h2><span class="section-meta">${drafts.length + projects.length ? `${drafts.length + projects.length} linked` : 'none yet'}</span></div>
    ${drafts.length || projects.length ? html`<ul class="dx-pieces">
      ${[...drafts.map(x => html`<li><a href="#/draft/${x.id}">${x.title && x.title !== d.story?.title ? x.title : channelLabel(x.channel, x.format)}</a><span class="dx-fine">${x.title && x.title !== d.story?.title ? channelLabel(x.channel, x.format) : `edited ${ago(x.updated_at)}`}</span>${statusTag(x.status)}</li>`),
        ...projects.map(p => html`<li><a href="#/career">${p.title}</a><span class="dx-fine">Project</span><span class="tag tag--neutral">${p.status}</span></li>`)]
        .map((li, i) => (i >= 4 ? raw(String(li).replace('<li>', '<li hidden data-more>')) : li))}
    </ul>
    ${drafts.length + projects.length > 4 ? html`<button type="button" class="dx-link" data-dx="more-conn">Show ${drafts.length + projects.length - 4} more</button>` : ''}` : html`<p class="dx-empty">Nothing drafted from this story yet.</p>`}
    <div class="dx-angles">
      <button type="button" class="btn btn--secondary btn--sm" data-dx="angles">Suggest angles</button>
      <div class="dx-angles-out" data-angles aria-live="polite"></div>
    </div>
  </section>`;
}
function tuneHtml(d) {
  const fb = d.feedback || [];
  return html`<section class="dx-sec dx-tune" data-dossier-section data-dx-movable aria-labelledby="dx-h-tune">
    <h2 class="dx-h3" id="dx-h-tune">Tune the ranking</h2>
    <div class="cluster">${FEEDBACK.map(([k, l]) => html`<button type="button" class="btn btn--secondary btn--sm" data-dx="fb" data-k="${k}"${fb.some(f => f.kind === k) ? raw(' aria-pressed="true"') : ''}>${l}</button>`)}</div>
    <p class="dx-fine" data-fb-out>${fb.length ? `Your feedback on this story: ${[...new Set(fb.map(f => f.kind.replace('_', ' ')))].join(', ')}.` : 'Adjusts how similar stories rank; review it under Runs → Feedback.'}</p>
  </section>`;
}

// ------------------------------------------------------------------ render + progressive fill
const thOf = (d) => Number(d.story?.threshold ?? d.breakdown?.threshold ?? liveThreshold());
/**
 * Markup only (no DOM reads; safe for an idle prebuild into a hidden container).
 * Progressive (`lite`, E §3 / E2): header, Why it ranked + breakdown and the first two source cards. Every
 * other block becomes a placeholder plus a deferred chunk, in reading order: remaining cards, Evidence,
 * Lens, Employer connections, Drafts & projects, Tune. Returns { html, defer }.
 */
function markup(d, lite = false) {
  const th = thOf(d);
  const defer = lite ? [] : null;
  const slot = (key, fn) => { if (!lite) return fn(); defer.push({ slot: key, html: fn }); return raw(`<div data-defer="${key}" hidden></div>`); };
  // chunks a deferred section adds while it renders run right after it
  const subDefer = lite ? { push: (c) => defer.splice(defer.indexOf(defer.find(x => x.slot === 'evidence')) + 1, 0, c) } : null;
  const out = String(html`<div class="dx" data-dx-root>
    ${headerHtml(d, th)}
    <div class="dx-cols">
      <div class="dx-left" data-col="left">${sourcesHtml(d, defer)}${slot('evidence', () => evidenceHtml(d, subDefer))}</div>
      <aside class="dx-right" data-col="right" aria-label="Ranking, lens and actions">${whyHtml(d)}${breakdownHtml(d, th, lite && !reduced())}${slot('lens', () => lensHtml(d))}${slot('conn', () => connectionsHtml(d))}${slot('make', () => makeHtml(d))}${slot('tune', () => tuneHtml(d))}</aside>
    </div>
  </div>`);
  return { html: out, defer: defer || [] };
}

const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 16));
/**
 * After the flight: one deferred section per idle chunk (≤ 8 ms of budget each), aborted when the dossier
 * moves to another story (body._dx changes). Each arrival fades + rises (transform/opacity only).
 */
function fillProgressive(body, st, chunks, done) {
  let i = 0;
  const step = (deadline) => {
    if (body._dx !== st || !body.isConnected) return;
    while (i < chunks.length) {
      if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 8) { idle(step); return; }
      const { slot, html: fn } = chunks[i++];
      const ph = body.querySelector(`[data-defer="${slot}"]`);
      if (!ph) continue;
      const t = document.createElement('template');
      t.innerHTML = String(fn());
      const nodes = [...t.content.children];
      ph.replaceWith(t.content);
      if (!reduced()) nodes.forEach(n => n.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE.settle, fill: 'backwards' }));
      idle(step); // one section per chunk
      return;
    }
    done();
  };
  idle(step);
}

function animateBars(body) {
  const list = body.querySelector('.dx-bars.is-pending');
  if (!list) return;
  list.classList.remove('is-pending');
  if (reduced()) return;
  list.querySelectorAll('.dx-bar-track i').forEach((el, i) => {
    el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(var(--fill))' }], { duration: 700, delay: i * 60, easing: EASE.settle, fill: 'backwards' });
  });
}

/**
 * Keep the sticky right column reachable when it is taller than the panel, and balance the columns once
 * (D §5: no gap taller than one section). Sizes come only from ResizeObserver entries — the scroller, both
 * columns and every movable section are observed — so the balancing step reads no layout itself.
 */
function layoutObserver(body) {
  body._dxRO?.disconnect();
  const scroller = body.closest('.dossier-scroll');
  const left = body.querySelector('[data-col=left]'), right = body.querySelector('[data-col=right]');
  if (!scroller || !left || !right || !('ResizeObserver' in window)) return;
  const movable = [...right.querySelectorAll('[data-dx-movable]')];
  let balanced = false;
  const sizes = new Map();
  const hOf = (en) => (en.borderBoxSize?.[0]?.blockSize ?? en.contentRect.height);
  const ro = new ResizeObserver((entries) => {
    for (const en of entries) sizes.set(en.target, hOf(en));
    const vh = sizes.get(scroller), lh = sizes.get(left), rh = sizes.get(right);
    if (vh == null || lh == null || rh == null) return;
    body.style.setProperty('--dx-stick', `${Math.min(24, vh - rh - 24).toFixed(0)}px`);
    if (balanced || !movable.every(m => sizes.has(m))) return;
    balanced = true;
    if (!matchMedia('(min-width: 961px)').matches) return;
    let l = lh, r = rh;
    const move = [];
    for (const sec of movable.slice().reverse()) {
      const h = sizes.get(sec) + 1;
      if (r - l < h + 48) break;
      move.unshift(sec); l += h; r -= h;
    }
    left.append(...move); // keep reading order
    movable.forEach(m => ro.unobserve(m));
  });
  [scroller, left, right, ...movable].forEach(el => ro.observe(el));
  body._dxRO = ro;
}

function closeMenus(body, except = null) {
  body.querySelectorAll('.dx-menu:not([hidden])').forEach(m => { if (m !== except) { m.hidden = true; body.querySelector(`[data-menu="${m.dataset.menuFor}"]`)?.setAttribute('aria-expanded', 'false'); } });
}

async function refresh(body) {
  const st = body._dx; if (!st) return;
  const scroller = body.closest('.dossier-scroll');
  const top = scroller?.scrollTop || 0;
  try {
    const data = await api.get(`/stories/${st.id}?mark_viewed=0`, { fresh: true });
    if (body._dx !== st || !body.isConnected) return;
    st.data = data;
    body.innerHTML = markup(data).html;
    if (scroller) scroller.scrollTop = top;
    layoutObserver(body);
  } catch (e) { toast(e.message, 'err'); }
}

function wire(body) {
  if (body._dxWired) return;
  body._dxWired = true;
  body.addEventListener('click', async (e) => {
    const st = body._dx; if (!st) return;
    const btn = e.target.closest('[data-dx]');
    if (!btn) { if (!e.target.closest('.dx-menu')) closeMenus(body); return; }
    const kind = btn.dataset.dx, id = st.id, d = st.data;
    if (kind !== 'menu') closeMenus(body);
    if (kind === 'menu') {
      const m = body.querySelector(`[data-menu-for="${btn.dataset.menu}"]`);
      const open = m.hidden;
      closeMenus(body, m);
      m.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) m.querySelector('[role^=menuitem]')?.focus();
      return;
    }
    if (kind === 'draft') return act(btn, async () => {
      const r = await api.post(`/stories/${id}/drafts`, { channel: btn.dataset.channel, format: btn.dataset.format, angle: btn.dataset.angle });
      toast('Draft created — opening Studio', 'ok');
      location.hash = `#/draft/${r.draft_id}`;
    }, 'Drafting…');
    if (kind === 'project-auto') return act(btn, async () => { await api.post(`/stories/${id}/project`); toast('Project scoped — edit it in Career → Projects', 'ok'); await refresh(body); }, 'Scoping…');
    if (kind === 'save') return act(btn, async () => {
      const existing = (d.saved || []).find(x => x.collection === btn.dataset.c);
      if (existing) await api.del(`/saved/${existing.id}`); else await api.post(`/stories/${id}/save`, { collection: btn.dataset.c });
      toast(existing ? `Removed from ${btn.dataset.c}` : `Saved to ${btn.dataset.c}`, 'ok');
      await refresh(body);
    });
    if (kind === 'dismiss') {
      const was = d.story.status, to = was === 'archived' ? 'seen' : 'archived';
      return act(btn, async () => {
        await api.patch(`/stories/${id}`, { status: to });
        document.dispatchEvent(new CustomEvent('byline:story-status', { detail: { id: Number(id), status: to } }));
        if (to === 'archived') {
          toast('Dismissed. It’s under Feed → Archived.', '', { undo: { revert: async () => { await api.patch(`/stories/${id}`, { status: was }); document.dispatchEvent(new CustomEvent('byline:story-status', { detail: { id: Number(id), status: was } })); toast('Restored', 'ok'); } } });
          st.ctx.close();
        } else { toast('Restored to the feed', 'ok'); await refresh(body); }
      });
    }
    if (kind === 'test-project') {
      const t = (d.lens?.test || [])[Number(btn.dataset.i)];
      if (!t) return;
      return act(btn, async () => {
        const title = t.charAt(0).toUpperCase() + t.slice(1);
        await api.post('/projects', { story_id: Number(id), title: title.length > 90 ? `${title.slice(0, 87).replace(/\s+\S*$/, '')}…` : title, kind: 'experiment', question: title, employer: d.story.companies?.[0] || null });
        toast('Project added — find it in Career → Projects', 'ok');
        await refresh(body);
      }, 'Adding…');
    }
    if (kind === 'lens') return act(btn, async () => { await api.post(`/stories/${id}/lens`); await refresh(body); toast('Lens refreshed', 'ok'); }, 'Refreshing…');
    if (kind === 'fb') return act(btn, async () => {
      const r = await api.post(`/stories/${id}/feedback`, { kind: btn.dataset.k });
      const adj = Object.entries(r.preferences?.topic || {}).map(([t, v]) => `${t} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`).join(' · ');
      const out = body.querySelector('[data-fb-out]');
      if (out) out.textContent = `Recorded. Topic adjustments now: ${adj || 'none'}.`;
      btn.setAttribute('aria-pressed', 'true');
      toast('Feedback recorded', 'ok');
    });
    if (kind === 'angles') return act(btn, async () => {
      const angles = await api.get(`/stories/${id}/angles`);
      const out = body.querySelector('[data-angles]');
      out.innerHTML = String(html`${(angles || []).map(g => html`<div class="dx-angle"><div><b>${g.title}</b><p>${g.covers}</p></div>
        <button type="button" class="btn btn--secondary btn--sm" data-dx="draft" data-channel="linkedin" data-format="long" data-angle="${g.key}">Draft with this angle</button></div>`)}`);
      if (!reduced()) [...out.children].forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 50, easing: EASE.settle, fill: 'backwards' }));
    }, 'Thinking…');
    if (kind === 'more-claims' || kind === 'more-conn') {
      const host = btn.previousElementSibling;
      host?.querySelectorAll('[data-more]').forEach(li => { li.hidden = false; if (!reduced()) li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE.fade }); });
      btn.remove();
    }
    if (kind === 'expand-group') {
      const rest = btn.closest('.dx-group')?.querySelector('[data-rest]');
      if (!rest) return;
      const full = rest.querySelector('.dx-rest-full'), compact = rest.querySelector('.dx-compact');
      const open = full.hidden;
      if (open && !full.children.length) { // built on first expand, not during the open
        const members = (d.articles || []).filter(x => x.domain === full.dataset.domain).slice(2);
        full.innerHTML = String(html`${members.map(x => articleCard(x, d.story?.finding || ''))}`);
      }
      full.hidden = !open; compact.hidden = open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Show the short list' : `Show all ${rest.closest('.dx-group').querySelectorAll('.dx-group > .dx-art').length + full.children.length} in full`;
      if (open && !reduced()) [...full.children].forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: Math.min(i, 6) * 40, easing: EASE.settle, fill: 'backwards' }));
    }
  });
  // menus: arrow keys move, Esc closes the menu (before the frame's capture handler would close the dossier)
  body.addEventListener('keydown', (e) => {
    const m = e.target.closest('.dx-menu');
    if (!m || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = [...m.querySelectorAll('[role^=menuitem]')];
    const i = items.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[n]?.focus();
  });
}
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const m = document.querySelector('.dossier .dx-menu:not([hidden])');
  if (!m) return;
  e.preventDefault(); e.stopPropagation();
  m.hidden = true;
  const b = document.querySelector(`.dossier [data-menu="${m.dataset.menuFor}"]`);
  b?.setAttribute('aria-expanded', 'false'); b?.focus();
}, true);

/**
 * Dossier renderer (dossier.js contract). Idempotent and read-free: it only writes markup, so dossier.js may
 * call it during an idle prebuild into a hidden attached container. 'open' / 'swap' render progressively;
 * afterFlight() (called once the flight has landed) animates the bars and fills the deferred sections.
 */
async function renderDossier(body, ctx) {
  await useStyle(CSS);
  const d = ctx.data || {};
  const st = { id: String(ctx.id), data: d, ctx };
  body._dx = st;
  body._dxRO?.disconnect();
  body.classList.add('dx-body');
  const progressive = ctx.phase === 'open' || ctx.phase === 'swap';
  const m = markup(d, progressive);
  body.innerHTML = m.html;
  wire(body);
  let landed = false;
  return {
    afterFlight() {
      if (landed || body._dx !== st) return;
      landed = true;
      animateBars(body);
      if (m.defer.length) fillProgressive(body, st, m.defer, () => layoutObserver(body));
      else layoutObserver(body);
    }
  };
}

registerDossierRenderer(renderDossier);
export { renderDossier };
