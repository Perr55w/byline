// Story dossier CONTENT (F §3 information architecture, D §5 layout) rendered into the dossier frame
// (public/js/dossier.js). Data: GET /api/stories/:id (docs/design/API-v4.md) — every figure, sentence and
// mark below comes from that payload; nothing is invented. Imported once by app.js; self-registers.
//
// Layout: header (eyebrow, h1, finding dek, actions | ring + fact strip) over a flat 7/5 grid, the right
// column set off by a hairline. Left: "What the sources say" + "Evidence". Right (sticky): "Why it ranked",
// "Score breakdown" (tracks ∝ weights), "Lens", employer connections, drafts & projects, ranking feedback;
// the foot sections move under the left column when the right one runs long. Phone order (F): header → Why it
// ranked → What the sources say → Evidence → Breakdown → Lens, actions pinned to the bottom of the sheet.
// Progressive (E2 / FD1): the open/swap render holds the header, Why it ranked, the breakdown and the first two
// source cards; the rest arrives after the flight, one section per task (fillProgressive).
// Shared elements for the frame's FLIP: data-shared="title" | "ring" | "topic".

import { api } from '../api.js';
import * as ui from '../ui.js';
import { qualityColor } from '../quality.js';
import { EASE, reduced } from '../motion.js';
import * as dossier from '../dossier.js';

const { html, raw, esc, icon, scoreRing, toast, act, channelLabel, status: statusTag, useStyle, threshold: liveThreshold } = ui;
/** R2 / S9: the main pill is blue only when round(score) clears the bar, else the neutral lead pill (shared helper). */
const mainPill = (topic, score, th) => {
  const out = typeof ui.topicPills === 'function' ? String(ui.topicPills([topic], score, th, { max: 1 }))
    : `<span class="chip ${Math.round(Number(score) || 0) >= th ? 'chip--main' : 'chip--lead'}">${esc(topic)}</span>`;
  return raw(out.replace(/<span class="chip/, '<span data-shared="topic" class="chip'));
};

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
const BOILER = /^(this article is adapted|learn about|read on|today,? we(?:'|’)?re\b|today,? we are (announcing|introducing|launching|excited)|we are expanding our partnership|we['’]re (excited|highlighting)|features\b|bug fixes|since announcing\b|now,? everybody\b)|we(?:'|’)ve heard (?:helpful )?feedback|finally gets what they want/i;
const words = (t) => new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}%.\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2));
/** Same sentence give or take wording (the dek is often a claim rephrased): Jaccard over content words. */
function sameText(a, b) {
  const A = a instanceof Set ? a : words(a), B = b instanceof Set ? b : words(b);
  if (!A.size || !B.size) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n) >= 0.5;
}

/** Same headline give or take case and punctuation (a source post that IS the story's own headline). */
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** "DEMO · The Ledger (tech news)" → "The Ledger (tech news)": the Demo tag carries that fact (FD10). */
const srcName = (a) => String(a?.source_name || '').replace(/^DEMO\s*·\s*/i, '');
/** The outlet's plain name for prose: "The Ledger (tech news)" → "The Ledger", "Google Cloud — AI & ML blog" → "Google Cloud". */
const outletName = (a) => srcName(a).replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+[—–-]\s+.*$/, '').replace(/\s+(blog|newsroom|newsletter|news|press)$/i, '').trim();
/**
 * Clip at a word boundary (FD6): text up to `max` chars is shown whole; longer text is cut to `to` chars at the
 * last space (so never mid-word, and a hyphenated word like "multi-agent" is kept or dropped whole), trailing
 * punctuation trimmed, "…" appended. Marks past the cut are dropped. Returns { text, marks, clipped }.
 */
function clip(text, marks = [], max = 240, to = 200) {
  const t = String(text ?? '');
  if (t.length <= max) return { text: t, marks: marks || [], clipped: false };
  let cut = t.lastIndexOf(' ', to);
  if (cut < to * 0.6) cut = to;
  let head = t.slice(0, cut).replace(/[\s,;:–—(-]+$/u, '');
  return { text: `${head}…`, marks: (marks || []).filter(([, b]) => b <= head.length), clipped: true };
}
/** Sentences of `text` with their marks re-based ("2.0" and "U.S." do not end a sentence: a split needs a following capital). */
function sentences(text, marks = []) {
  const t = String(text ?? ''), out = [];
  const re = /[^]*?[.!?](?=\s+[\p{Lu}“"‘(\d]|\s*$)|[^]+$/gu;
  let m;
  while ((m = re.exec(t)) && m[0]) {
    const raw0 = m[0], lead = raw0.length - raw0.trimStart().length, s = m.index + lead, e = m.index + raw0.trimEnd().length;
    if (e > s) out.push({ text: t.slice(s, e), marks: (marks || []).filter(([a, b]) => a >= s && b <= e).map(([a, b]) => [a - s, b - s]) });
    if (re.lastIndex >= t.length) break;
  }
  return out;
}
/** Join sentence parts back into { text, marks }. */
function joinParts(parts) {
  let text = '', marks = [];
  for (const p of parts) { const off = text ? text.length + 1 : 0; text = text ? `${text} ${p.text}` : p.text; marks = marks.concat(p.marks.map(([a, b]) => [a + off, b + off])); }
  return { text, marks };
}
/**
 * What a post says in 1–2 sentences (FD5): sentences that restate the dek are dropped (the dek already says
 * them), then the first two kept, or one when two run past 280 characters, clipped at a word boundary.
 * Returns null when every sentence restates the dek.
 */
function trimSays(text, marks, dekW) {
  const parts = sentences(text, marks).filter(p => !(dekW && sameText(p.text, dekW)));
  if (!parts.length) return null;
  let pick = parts.slice(0, 2);
  if (pick.length > 1 && joinParts(pick).text.length > 280) pick = pick.slice(0, 1);
  const j = joinParts(pick);
  return clip(j.text, j.marks, 280, 240);
}

// source-role shape markers (F §4): ■ first-party / primary, ◆ independent, ○ commentary & community
const ROLE = { first_party: ['fp', 'first-party'], primary: ['fp', 'primary source'], independent: ['ind', 'independent'], commentary: ['com', 'commentary or community'] };
const marker = (role) => html`<i class="mk mk--${(ROLE[role] || ROLE.commentary)[0]}" aria-hidden="true"></i>`;
// R12: every kind tag is neutral; the ◆ marker (blue) carries "independent". No --ok colour in the dossier: green
// means healthy or sent elsewhere in the app.
const KIND_TONE = {};

// ------------------------------------------------------------------ header
/**
 * FD9: where the topic pills and the actions sit so the two header columns end level (within ~24 px). The
 * right column is the score card; when it is shorter than the left one, the pills (and, when that is still not
 * enough, the actions, then a stacked ring) move under the Sources/Companies block. Heights are estimated from the
 * text lengths and the viewport width (innerWidth is not a layout read), calibrated on stories 3, 5, 7, 13, 14 and 16
 * at 1280, 1440 and 1920. Under 1101 px the header is one column and nothing moves.
 */
function headPlan(s, companies, ebText) {
  const vw = typeof innerWidth === 'number' ? innerWidth : 1440;
  const none = { pills: false, acts: false, stack: false };
  if (vw <= 1100) return none;
  const panel = Math.min(1040, vw - 416);
  const mainW = Math.max(300, (panel - 134) * 7 / 12), sideW = (panel - 134) * 5 / 12 - 33;
  // greedy word wrap at an average glyph width per role (Newsreader 40/36 px, Geist 17 px lede, Geist Mono 12 px caps)
  const lines = (text, maxW, cw) => { let n = 1, x = 0; for (const w of String(text || '').split(/\s+/).filter(Boolean)) { const ww = w.length * cw; if (x && x + cw + ww > maxW) { n++; x = ww; } else x += (x ? cw : 0) + ww; } return n; };
  const tl = String(s.title || ''), long = tl.length > 70;
  const tLines = lines(tl, Math.min(mainW, 518), long ? 16 : 17.5);
  const dLines = s.finding ? lines(s.finding, Math.min(mainW, 600), 8.5) : 0;
  const tagW = (s.is_demo ? 58 : 0) + (s.status === 'archived' ? 74 : 0);
  const ebLines = lines(`${'x'.repeat(Math.ceil(tagW / 7.3))} ${ebText}`, mainW, 7.3);
  const core = (tagW ? 20 : 14) + (ebLines - 1) * 14 + 12 + tLines * (long ? 40 : 44) + (dLines ? 14 + dLines * 27 : 0);
  const topics = [s.main_topic || s.topics?.[0], ...(s.topics || []).filter(t => t !== (s.main_topic || s.topics?.[0])).slice(0, 2)].filter(Boolean);
  const pillsW = (w) => { let rows = 1, x = 0; for (const t of topics) { const cw = t.length * 6.3 + 18; if (x && x + cw > w) { rows++; x = 0; } x += cw + 6; } return rows; };
  const pillsH = (w) => (topics.length ? 18 + pillsW(w) * 30 : 0);
  const actsH = (w) => 22 + (w < 480 ? 76 : 34);
  const facts = 71 + (companies.length ? (sideW < 330 ? 117 : 90) : 0);
  const card = (stack) => 30 + (stack ? 114 + facts : Math.max(114, facts));
  const plans = [
    { ...none, L: core + pillsH(mainW) + actsH(mainW), R: card(false) },
    { pills: true, acts: false, stack: false, L: core + actsH(mainW), R: card(false) + pillsH(sideW) - 12 },
    { pills: true, acts: true, stack: false, L: core, R: card(false) + pillsH(sideW) - 12 + actsH(sideW) - 6 },
    { pills: true, acts: true, stack: true, L: core, R: card(true) + pillsH(sideW) - 12 + actsH(sideW) - 6 }
  ];
  return plans.reduce((m, p) => (Math.abs(p.L - p.R) < Math.abs(m.L - m.R) - 8 ? p : m)); // ties keep the simpler layout
}
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
  // D-8: the separators are drawn in CSS (never at the start of a line); under 600 px the topic takes line 1 and
  // the date loses "first seen" and the clock ("18 Nov · updated 2d ago")
  const ebParts = [main || 'Story',
    s.first_seen ? html`<span class="dx-eb-long">first seen </span>${day(s.first_seen)}<span class="dx-eb-long">, ${clock(s.first_seen)}</span>` : '',
    s.updated_at ? `updated ${ago(s.updated_at)}` : ''].filter(Boolean);
  const plan = headPlan(s, companies, eyebrow);
  // D-4: "with no independent report yet" is dropped when the first-party / no-independent callout says it below
  const callout = d.sources_header?.callout;
  const qualifier = callout?.text && callout.kind !== 'disagreement' && /no independent/i.test(s.evidence_qualifier || '') ? '' : (s.evidence_qualifier || '');
  const topicsHtml = main ? html`<div class="dx-topics">${mainPill(main, s.score, th)}${rest.length ? html`<span class="dx-rest-topics" data-dossier-section>${rest.map(t => html`<span class="chip chip--topic">${t}</span>`)}</span>` : ''}</div>` : '';
  const actionsHtml = html`<div class="dx-actions" data-dossier-section>
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
        ${origin?.url ? html`<a class="btn btn--ghost dx-open" href="${origin.url}" target="_blank" rel="noopener noreferrer" aria-label="Open primary source"><span class="dx-open-l">Open primary</span><span class="dx-open-s" aria-hidden="true">Source</span>${icon('arrow-up-right')}</a>` : ''}
      </div>`;
  return html`
  <header class="dx-head${plan.stack ? ' dx-head--stack' : ''}">
    <div class="dx-head-main">
      <p class="eyebrow dx-eyebrow" data-dossier-section>${s.is_demo ? html`<span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}${archived ? html`<span class="tag tag--neutral">Archived</span>` : ''}${ebParts.map((part, i) => html`${i ? raw('<span class="sr-only"> · </span>') : ''}<span class="dx-eb-part${i ? '' : ' dx-eb-topic'}">${part}</span>`)}</p>
      <h1 class="dx-title${String(s.title || '').length > 70 ? ' dx-title--long' : ''}" data-shared="title">${s.title}</h1>
      ${s.finding ? html`<p class="dx-dek" data-dossier-section>${marked(s.finding, s.finding_marks)}</p>` : ''}
      ${plan.pills ? '' : topicsHtml}
      ${plan.acts ? '' : actionsHtml}
    </div>
    <div class="dx-head-side">
      <div class="dx-card">
        <div class="dx-ring" data-shared="ring">${scoreRing(s.score, th, { size: 92 })}</div>
        <dl class="dx-facts">
          <div class="dx-fact" data-dossier-section>
            <dt>Sources</dt>
            <dd class="dx-fact-v dx-seps">${String(s.source_line || '').split(' · ').map(p => html`<span>${p}</span>`)}</dd>
            ${qualifier ? html`<dd class="dx-fact-s">${qualifier}</dd>` : ''}
          </div>
          ${companies.length ? html`<div class="dx-fact" data-dossier-section>
            <dt>Companies</dt>
            <dd class="dx-fact-v" title="${companies.join(', ')}">${companies[0]}${companies.length > 1 ? html` <span class="ink-3">+${companies.length - 1}</span>` : ''}</dd>
            <dd class="dx-fact-s">${companies.length > 1 ? companies.slice(1).join(', ') : 'the only company named'}</dd>
          </div>` : ''}
        </dl>
      </div>
      ${plan.pills ? topicsHtml : ''}
      ${plan.acts ? actionsHtml : ''}
    </div>
  </header>`;
}

// ------------------------------------------------------------------ A. What the sources say
/**
 * What one post says (F §3, FD5). The summary when it is not a press-release opener (server flag or the same
 * regex), minus any sentence that restates the dek; otherwise the post's best claim (numbers first) that isn't
 * the dek. When the only thing the post says IS the dek, that claim is still shown (marked `restates`): every
 * card shows what its source said, or says honestly that nothing was extracted. Returns { says, claims }.
 */
function postView(a, dek) {
  const dekW = dek ? words(dek) : null;
  const usable = (a.claims || []).filter(c => !BOILER.test(c.text));
  const fresh = usable.filter(c => !(dekW && sameText(c.text, dekW)));
  const num = (x, y) => (y.has_number ? 1 : 0) - (x.has_number ? 1 : 0);
  let says = null;
  const s0 = a.says && !(a.says.from === 'summary' && a.summary_is_boilerplate) && !BOILER.test(a.says.text) ? a.says : null;
  if (s0) { const t = trimSays(s0.text, s0.marks, dekW); if (t) says = { ...s0, text: t.text, marks: t.marks }; }
  if (!says) { const best = fresh.slice().sort(num)[0]; if (best) { const t = clip(best.text, best.marks, 280, 240); says = { text: t.text, marks: t.marks, from: 'claim', claim_id: best.id }; } }
  if (!says) {
    const best = usable.slice().sort(num)[0] || (s0 ? { text: s0.text, marks: s0.marks, id: s0.claim_id } : null);
    if (best) { const t = clip(best.text, best.marks, 280, 240); says = { text: t.text, marks: t.marks, from: 'claim', claim_id: best.id, restates: true }; }
  }
  const claims = fresh.filter(c => c.id !== says?.claim_id && !(says && sameText(c.text, says.text)));
  return { says, claims };
}
const saysHtml = (says) => (says
  ? html`<p class="dx-says"><span class="dx-says-k">${says.from === 'summary' ? 'Summary' : 'Key claim'}${says.restates ? html`<span class="dx-says-n"> · the finding above comes from this post</span>` : ''}</span>${marked(says.text, says.marks)}</p>`
  : html`<p class="dx-says dx-says--none">No summary extracted for this post.</p>`);
/**
 * One source card. `label` is the kind tag (FD7: "Primary" only on the earliest first-party post, "Same outlet"
 * on the outlet's other posts). A post whose headline is the story's own headline shows what it says in place
 * of repeating the title; its domain becomes the link (FD5).
 */
function articleCard(a, dek, storyTitle, label = a.kind_label, cv = false) {
  const tone = KIND_TONE[label] || 'neutral';
  const when = a.published_at ? day(a.published_at) : `fetched ${day(a.fetched_at)}`;
  const { says, claims } = postView(a, dek);
  const sameHead = normTitle(a.title) === normTitle(storyTitle);
  const name = srcName(a);
  return html`<article class="dx-art${cv ? ' dx-cv' : ''}"${cv ? raw(' style="--cis:190px"') : ''}>
    <div class="dx-art-meta">
      ${marker(a.role)}<span class="tag tag--${tone}">${label}</span>
      ${sameHead ? html`<a class="dx-dom dx-dom-link" href="${a.url}" target="_blank" rel="noopener noreferrer">${a.domain}<span class="sr-only"> (opens the post: ${a.title})</span>${icon('arrow-up-right', 'dx-out')}</a>` : html`<span class="dx-dom">${a.domain}</span>`}
      ${name ? html`<span class="dx-srcname">${name}</span>` : ''}
      <time datetime="${a.published_at || a.fetched_at || ''}">${when}</time>
      ${a.is_new ? html`<span class="tag tag--neutral dx-new">New</span>` : ''}${a.is_demo ? html`<span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}
    </div>
    ${sameHead ? '' : html`<a class="dx-art-title" href="${a.url}" target="_blank" rel="noopener noreferrer"><span>${a.title}<span class="sr-only"> (opens the article)</span></span>${icon('arrow-up-right', 'dx-out')}</a>`}
    ${saysHtml(says)}
    ${claims.length ? html`<ul class="dx-claims">${claims.map((c, i) => { const t = clip(c.text, c.marks); return html`<li${i >= 1 ? raw(' hidden data-more') : ''}>${marked(t.text, t.marks)}${c.also_reported_by?.length ? html` <span class="dx-also">also reported by ${c.also_reported_by.join(', ')}</span>` : ''}</li>`; })}</ul>
      ${claims.length > 1 ? html`<button type="button" class="dx-link" data-dx="more-claims">+${plural(claims.length - 1, 'more claim')}</button>` : ''}` : ''}
  </article>`;
}
/**
 * D-5: a run of posts from one outlet that have no summary or claim, as one row: "4 release notes from
 * github.com (23 Oct – 9 Nov): v2.2.0, v2.5.0, v2.6.0, v2.7.0 · no summaries extracted". Each version (or title,
 * when it carries none) links to its post; dates and versions come from the articles.
 */
function runHtml(run, label) {
  const a0 = run[0];
  const rel = run.every(x => x.kind_label === 'Release notes');
  const ts = run.map(x => x.published_at || x.fetched_at).filter(Boolean).sort();
  const from = ts.length ? day(ts[0]) : '', to = ts.length ? day(ts[ts.length - 1]) : '';
  const span = from && to && from !== to ? `${from} – ${to}` : from;
  const ver = (x) => String(x.title || '').match(/(?:^|\s)(v?\d+(?:\.\d+)+(?:[-+][\w.]+)?)\s*$/)?.[1] || x.title || x.domain;
  const name = srcName(a0);
  return html`<article class="dx-art dx-art--run">
    <div class="dx-art-meta">${marker(a0.role)}<span class="tag tag--neutral">${label || a0.kind_label}</span>${name ? html`<span class="dx-srcname dx-srcname--first">${name}</span>` : ''}${run.some(x => x.is_demo) ? html`<span class="tag tag--demo" title="Fictional sample data">Demo</span>` : ''}</div>
    <p class="dx-run"><b>${plural(run.length, rel ? 'release note' : 'post')}</b> from <span class="dx-dom">${a0.domain}</span>${span ? ` (${span})` : ''}: ${run.map((x, i) => html`${i ? ', ' : ''}<a href="${x.url}" target="_blank" rel="noopener noreferrer" title="${x.title}">${ver(x)}</a>`)} <span class="ink-3">· no summaries extracted</span></p>
  </article>`;
}
/** FD7: "Primary" goes to the earliest first-party post only; the outlet's other posts read "Same outlet". */
function kindLabels(arts) {
  const t = (a) => { const v = Date.parse(a.published_at || a.fetched_at || ''); return Number.isFinite(v) ? v : Infinity; };
  const fp = arts.filter(a => a.role === 'first_party' || a.role === 'primary');
  const first = fp.reduce((m, a) => (!m || t(a) < t(m) ? a : m), null); // ties keep list order
  const out = new Map();
  for (const a of arts) {
    if (!fp.includes(a)) out.set(a.id, a.kind_label);
    else out.set(a.id, a === first ? 'Primary' : a.domain === first.domain ? 'Same outlet' : 'First-party');
  }
  return out;
}
/**
 * FD8: the independent figure against the first-party one, only when both appear as marked numbers in the
 * story's claims: one figure in the independent post's claim that no first-party claim has, one it shares with a
 * first-party claim, same unit. Anything less returns null (no invented comparison).
 */
function comparison(d, ind) {
  const marksOf = (c) => (c.marks || []).map(([a, b]) => String(c.text || '').slice(a, b));
  const fpIds = new Set((d.articles || []).filter(a => a.role === 'first_party' || a.role === 'primary').map(a => a.id));
  const fpNums = new Set((d.claims || []).filter(c => fpIds.has(c.article_id)).flatMap(marksOf));
  if (!fpNums.size) return null;
  const unit = (n) => String(n).replace(/^[\d.,\s]+/, '').trim().toLowerCase();
  const val = (n) => Number(String(n).replace(/,/g, '').match(/[\d.]+/)?.[0]);
  for (const c of (d.claims || []).filter(x => x.article_id === ind.id)) {
    const nums = marksOf(c);
    for (const u of new Set(nums.map(unit))) {
      const theirs = nums.filter(n => unit(n) === u && !fpNums.has(n)), shared = nums.filter(n => unit(n) === u && fpNums.has(n));
      if (theirs.length !== 1 || shared.length !== 1) continue;
      const a = val(theirs[0]), b = val(shared[0]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      return { theirs: theirs[0], ours: shared[0], word: a < b ? 'is below' : a > b ? 'is above' : 'matches' };
    }
  }
  return null;
}
function calloutHtml(d, callout) {
  if (!callout?.text) return '';
  if (callout.kind !== 'disagreement') return html`<div class="dx-callout dx-callout--${callout.kind}" role="note"><span class="dx-callout-k">${callout.kind === 'all_first_party' ? 'First-party only' : 'No independent report'}</span><span>${marked(callout.text, callout.marks)}</span></div>`;
  const body = callout.text.replace(/^Independent check:\s*/, ''), off = callout.text.length - body.length;
  const dek = d.story?.finding || '';
  const ind = (d.articles || []).find(a => a.id === callout.article_id) || (d.articles || []).find(a => a.role === 'independent');
  if (!(dek && sameText(body, dek)) || !ind) {
    return html`<div class="dx-callout dx-callout--disagreement" role="note"><span class="dx-callout-k">Independent check</span><span>${marked(body, (callout.marks || []).map(([a, b]) => [a - off, b - off]))}</span></div>`;
  }
  // the callout would repeat the dek word for word: attribute it instead (FD8)
  const cmp = comparison(d, ind);
  const fp = (d.articles || []).find(a => a.role === 'first_party' || a.role === 'primary');
  const owner = fp ? outletName(fp) || fp.domain : null;
  return html`<p class="dx-callout dx-callout--disagreement dx-callout--attr" role="note"><span class="dx-callout-k">Independent check</span><span class="dx-sep" aria-hidden="true">·</span><a href="${ind.url}" target="_blank" rel="noopener noreferrer">${outletName(ind) || ind.domain}</a> <span class="dx-dom">(${ind.domain})</span>${cmp && owner ? html`<span class="dx-sep" aria-hidden="true">·</span><span>its <mark class="num-hl">${cmp.theirs}</mark> ${cmp.word} ${owner}’s own <mark class="num-hl">${cmp.ours}</mark></span>` : ''}</p>`;
}
/**
 * The sources section. `defer` (open phase) collects everything after the first two cards as deferred
 * chunks: [{ slot, html() }]; their placeholders are empty hidden divs replaced after the flight.
 */
function sourcesHtml(d, defer = null) {
  const arts = d.articles || [];
  const hdr = d.sources_header || {};
  const c = hdr.counts || {};
  const dek = d.story?.finding || '', title = d.story?.title || '';
  const labels = kindLabels(arts);
  const groups = Object.fromEntries((d.domain_groups || []).filter(g => g.collapse).map(g => [g.domain, g]));
  const done = new Set();
  const blocks = [];
  let cards = 0, n = 0;
  const later = (fn) => { if (!defer) return fn(); const slot = `src${n++}`; defer.push({ slot, html: fn }); return raw(`<div data-defer="${slot}" hidden></div>`); };
  // the first two cards render during the flight (early chunks, one per frame), the rest after it
  const soon = (fn) => { if (!defer) return fn(); const slot = `src${n++}`; defer.push({ slot, html: fn, early: true }); return raw(`<div data-defer="${slot}" hidden></div>`); };
  const card = (a) => { const k = cards++; return k < 2 ? soon(() => articleCard(a, dek, title, labels.get(a.id))) : later(() => articleCard(a, dek, title, labels.get(a.id), !!defer)); };
  // D-5: consecutive posts from one outlet with nothing extracted fold into one row
  const empty = new Map();
  const noSays = (a) => { if (!empty.has(a.id)) empty.set(a.id, !postView(a, dek).says); return empty.get(a.id); };
  for (let i = 0; i < arts.length; i++) {
    const a = arts[i];
    if (done.has(a.id)) continue;
    const g = groups[a.domain];
    if (!g) {
      const run = [a];
      if (noSays(a)) for (let j = i + 1; j < arts.length; j++) { const x = arts[j]; if (done.has(x.id) || groups[x.domain] || x.domain !== a.domain || !noSays(x)) break; run.push(x); }
      if (run.length > 1) {
        run.forEach(x => done.add(x.id));
        const k = cards++;
        const fn = () => runHtml(run, labels.get(a.id));
        blocks.push(k < 2 ? soon(fn) : later(fn));
        continue;
      }
      done.add(a.id); blocks.push(card(a)); continue;
    }
    const members = arts.filter(x => x.domain === a.domain);
    members.forEach(x => done.add(x.id));
    const first = members.slice(0, 2), rest = members.slice(2);
    const restHtml = () => html`<div class="dx-rest${defer ? ' dx-cv' : ''}" data-rest${defer ? raw(` style="--cis:${rest.length * 78 + 24}px"`) : ''}>
        <ol class="dx-compact">${rest.map(x => { const v = postView(x, dek); return html`<li><a href="${x.url}" target="_blank" rel="noopener noreferrer" class="dx-compact-t">${x.title}</a>${v.says ? html`<span class="dx-compact-s">${marked(v.says.text, v.says.marks)}</span>` : html`<span class="dx-compact-s dx-compact-s--none">No summary extracted for this post.</span>`}</li>`; })}</ol>
        <div class="dx-rest-full" data-domain="${a.domain}" hidden></div>
      </div>`;
    const firstCards = first.map(card);
    blocks.push(html`<div class="dx-group">
      <div class="dx-group-head">${marker(members[0].role)}<span>${plural(members.length, 'post')} from ${a.domain}${members[0].role === 'first_party' || members[0].role === 'primary' ? ' (first-party)' : ''}</span>${rest.length ? html`<button type="button" class="dx-link dx-group-more" data-dx="expand-group" aria-expanded="false">Show all ${members.length} in full</button>` : ''}</div>
      ${firstCards}
      ${rest.length ? later(restHtml) : ''}
    </div>`);
  }
  const present = [['first_party', (c.first_party || 0) + (c.primary || 0), `first-party${c.primary ? ' / primary' : ''}`], ['independent', c.independent || 0, 'independent'], ['commentary', c.commentary || 0, 'commentary / community']];
  return html`<section class="dx-sec dx-sources" data-dossier-section aria-labelledby="dx-h-sources">
    <div class="section-head"><h2 class="t-h2 dx-h" id="dx-h-sources">What the sources say</h2>${arts.length ? html`<span class="dx-legend" aria-hidden="true">${present.filter(([, n]) => n > 0).map(([k, , l]) => html`<span>${marker(k)}${l}</span>`)}</span>` : ''}</div>
    ${calloutHtml(d, hdr.callout)}
    ${arts.length ? html`<div class="dx-arts">${blocks}</div>` : html`<p class="dx-empty">No articles are attached to this story.</p>`}
  </section>`;
}

// ------------------------------------------------------------------ B. Evidence
/**
 * "Checkable numbers" (C, F): each figure inside its claim fragment (±8 words) with the source domain.
 * At most 4; a figure with no fragment in the stored claims/summaries is dropped, and so is the row.
 */
// a figure as a whole token: no letter or digit before it, no digit after it (compiled once: a per-term
// unicode RegExp cost ~1.5 ms each at 4× CPU)
const LN = /[\p{L}\p{N}]/u, DIG = /\p{N}/u;
function termAt(lc, lt) {
  for (let i = lc.indexOf(lt); i >= 0; i = lc.indexOf(lt, i + 1)) {
    const pre = lc[i - 1], post = lc[i + lt.length];
    if ((!pre || !LN.test(pre)) && (!post || !DIG.test(post))) return i;
  }
  return -1;
}
function numberFragments(d, terms) {
  const dom = new Map((d.articles || []).map(a => [a.id, a.domain]));
  const dekW = d.story?.finding ? words(d.story.finding) : null;
  const seen = new Set();
  const pool = [...(d.claims || []).map(c => ({ text: c.text_clean || c.text, domain: dom.get(c.article_id) })),
    ...(d.articles || []).filter(a => a.says?.text).map(a => ({ text: a.says.text, domain: a.domain }))]
    .filter(p => { const k = p.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); p.lc = k; return true; });
  // "is it the dek?" only for passages that hold a figure (word sets are the costly part; FD1 keeps this chunk short)
  const notDek = (p) => (p.nd ??= !(dekW && sameText(p.text, dekW)));
  // figures per sentence: several figures in one claim share one fragment
  const hits = new Map(); let count = 0;
  for (const term of terms || []) {
    if (count >= 4) break;
    const lt = String(term).toLowerCase();
    let at = -1;
    const p = pool.find(x => { at = termAt(x.lc, lt); return at >= 0 && notDek(x); });
    if (!p) continue;
    const m = [null, '', p.text.slice(at, at + lt.length)];
    const list = hits.get(p) || [];
    if (list.some(([a, b]) => at < b && at + m[2].length > a)) continue;
    list.push([at, at + m[2].length]); hits.set(p, list); count++;
  }
  return [...hits].slice(0, 3).map(([p, marks]) => {
    marks.sort((x, y) => x[0] - y[0]);
    const t = p.text;
    // FD6: the whole claim up to 240 characters; a longer one is a window of whole words around its figures
    // (≈ 3 lines), so a claim never stops before its object ("…already using…") or after a hyphen ("multi-…")
    let from = 0, to = t.length;
    if (t.length > 240) {
      from = marks[0][0]; to = marks[marks.length - 1][1];
      const room = 200;
      while (to - from < room && (from > 0 || to < t.length)) {
        const grow = to < t.length && (from === 0 || (to - marks[marks.length - 1][1]) <= (marks[0][0] - from));
        if (grow) { const nx = t.indexOf(' ', to + 1); to = nx < 0 ? t.length : nx; }
        else { const pv = t.lastIndexOf(' ', from - 2); from = pv < 0 ? 0 : pv + 1; }
      }
    }
    const frag = t.slice(from, to).replace(to < t.length ? /[\s,;:–—(-]+$/u : /$^/, '');
    return html`<li><span class="dx-frag">${from > 0 ? '…' : ''}${marked(frag, marks.map(([a, b]) => [a - from, b - from]).filter(([, b]) => b <= frag.length))}${to < t.length ? '…' : ''}</span> <span class="dx-frag-src">${p.domain || ''}</span></li>`;
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
  // FD1: the number fragments (the costly part) are computed in their own task, just before the group renders
  const later = (fn) => { if (!defer) return fn(); defer.push({ slot: 'ev-pw', html: fn }); defer.push({ slot: 'ev-calc', run: () => (pw.rows || []).forEach(r => { if (r.signal === 'numbers') fragsOf(r); }) }); return raw('<div data-defer="ev-pw" hidden></div>'); };
  const fragCache = new Map();
  const fragsOf = (r) => { if (!fragCache.has(r)) fragCache.set(r, numberFragments(d, r.terms)); return fragCache.get(r); };
  let pwCache = null;
  const pwRows = () => pwCache || (pwCache = (pw.rows || []).map(r => {
    if (r.signal !== 'numbers') {
      const q = r.quote ? clip(r.quote) : null;
      if (q) return html`<li><b>${r.label}</b><q class="dx-quote"${q.clipped ? raw(` title="${esc(r.quote)}"`) : ''}>${q.text}</q></li>`;
      // D-1: no quote. The label, then what it matched; the row's text is shown only when it says more than the label
      const terms = uniqCI(r.terms);
      const echo = normTitle(r.text) === normTitle(r.label) || !String(r.text || '').trim();
      return html`<li class="dx-pw-line"><span><b>${r.label}</b>${terms.length ? html`<span class="ink-3"> · matched </span>${listJoin(terms.map(t => html`<span class="dx-term">${t}</span>`))}` : echo ? html` <span class="dx-pw-ok" aria-hidden="true">${icon('check')}</span>` : ''}</span>${echo ? '' : html`<span>${r.text}</span>`}</li>`;
    }
    const frags = fragsOf(r);
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
      <div class="dx-score-top"><span class="dx-score-num">${Math.round(score)}</span><span class="dx-score-cap">of 100 · ${verdict}</span></div>
      <p class="dx-empty">Ranked before the breakdown was stored; only the score is available.</p></section>`;
  }
  const rows = b.rows;
  const sum = Number(b.computed ?? score);
  const mults = b.multipliers || [], neutral = mults.filter(m => Number(m.value) === 1);
  return html`<section class="dx-sec dx-score" data-dossier-section aria-labelledby="dx-h-score">
    <div class="section-head"><h2 class="t-h2 dx-h" id="dx-h-score">Score breakdown</h2><span class="section-meta">bar ${th}</span></div>
    <p class="dx-score-line"><b>${Math.round(score)}</b> of 100 · ${verdict}</p>
    <p class="dx-base">Base <b>${f1(b.base)}</b> of ${b.base_max || 100} <span class="ink-3">· bar width = share of 100</span></p>
    <ol class="dx-bars${pending ? ' is-pending' : ''}" aria-label="Score components; each bar's width is its share of 100">
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
/**
 * D-3: a matched term that is the employer's own name or its parent ("Google" under "Google (other teams)" or
 * "Google Cloud") says nothing about what the employer works on.
 */
function ownName(term, employer) {
  const t = normTitle(term), e = normTitle(employer), base = normTitle(String(employer || '').replace(/\s*\([^)]*\)\s*/g, ' '));
  return !!t && (t === e || t === base || base.startsWith(`${t} `) || e.startsWith(`${t} `));
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
  // A company chip with no connection card: say where it was named instead of a bare "no connection".
  const unlinked = (d.employer_unlinked || []).filter(n => !list.some(c => c.employer === n));
  const unlinkedP = unlinked.length ? html`<p class="dx-empty">${listJoin(unlinked)} ${unlinked.length > 1 ? 'are' : 'is'} named only in the body of a source, with no passage tying this story to ${unlinked.length > 1 ? 'their' : 'its'} public work. Mention ${unlinked.length > 1 ? 'them' : 'it'} only with your own analysis.</p>` : '';
  if (!list.length) return html`<section class="dx-sec dx-conn" data-dossier-section data-dx-movable aria-labelledby="dx-h-conn">${head}${unlinkedP || html`<p class="dx-empty">No source ties this story to your target employers.</p>`}</section>`;
  const named = list.filter(c => c.mention_ok), topical = list.filter(c => !c.mention_ok);
  const shownQuotes = new Map(); // quote → first employer that showed it
  const card = (c, i) => {
    const q = quoteOf(c), hits = uniqCI(c.matched).filter(h => !ownName(h, c.employer));
    const dup = q && shownQuotes.has(q);
    if (q && !dup) shownQuotes.set(q, c.employer);
    return html`<li${i >= 3 ? raw(' hidden data-more') : ''}>
      <div class="dx-conn-top"><b>${c.employer}</b>${c.first_party ? html`<span class="tag tag--warn">First-party</span>` : html`<span class="tag">Named in a source</span>`}</div>
      ${c.first_party && c.mention_note ? html`<p class="dx-fine">${String(c.mention_note).replace(/^First-party:\s*/i, '').replace(/^./, (ch) => ch.toUpperCase())}</p>` : ''}
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
      ${basisShown ? html`<p class="dx-conn-basis"><span class="ink-3">${basisList.length === topical.length ? (topical.length > 1 ? 'All match on' : 'Matches on') : html`${listJoin(basisList.map(c => c.employer))} match on`} this passage from ${basisList[0].source?.url ? html`<a href="${basisList[0].source.url}" target="_blank" rel="noopener noreferrer">${basisList[0].source.domain || 'the source'}</a>` : 'the source'}:</span> <q class="dx-quote">${basisQ}</q></p>` : ''}
    </div>` : ''}
    ${unlinkedP}
    ${caveat ? html`<p class="dx-fine dx-conn-caveat">${caveat}</p>` : ''}
  </section>`;
}
function makeHtml(d) {
  const drafts = d.drafts || [], projects = d.projects || [];
  return html`<section class="dx-sec dx-make" data-dossier-section data-dx-movable aria-labelledby="dx-h-make">
    <div class="section-head"><h2 class="dx-h3" id="dx-h-make">Drafts & projects</h2><span class="section-meta">${drafts.length + projects.length ? `${drafts.length + projects.length} linked` : 'none yet'}</span></div>
    ${drafts.length || projects.length ? html`<ul class="dx-pieces">
      ${[...drafts.map(x => html`<li><a href="#/draft/${x.id}">${x.title && x.title !== d.story?.title ? x.title : channelLabel(x.channel, x.format)}</a><span class="dx-fine">${x.title && x.title !== d.story?.title ? channelLabel(x.channel, x.format) : `edited ${ago(x.updated_at)}`}</span>${raw(String(statusTag(x.status)).replace('tag--ok', 'tag--neutral'))}</li>`),
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
  // E2: an "early" chunk renders during the flight, one per frame from the third frame on, so the panel's first
  // frame lays out only the header and the section heads (Why it ranked, the first two source cards, the breakdown follow)
  const early = (key, fn) => { if (!lite) return fn(); defer.push({ slot: key, html: fn, early: true }); return raw(`<div data-defer="${key}" hidden></div>`); };
  // chunks a deferred section adds while it renders run right after it
  const subDefer = lite ? { push: (c) => defer.splice(defer.indexOf(defer.find(x => x.slot === 'evidence')) + 1, 0, c) } : null;
  const why = early('why', () => whyHtml(d));
  const score = early('score', () => breakdownHtml(d, th, lite && !reduced()));
  const out = String(html`<div class="dx" data-dx-root>
    ${headerHtml(d, th)}
    <div class="dx-cols">
      <div class="dx-left" data-col="left">${sourcesHtml(d, defer)}${slot('evidence', () => evidenceHtml(d, subDefer))}</div>
      <aside class="dx-right" data-col="right" aria-label="Ranking, lens and actions">${why}${score}${slot('lens', () => lensHtml(d))}${slot('conn', () => connectionsHtml(d))}${slot('make', () => makeHtml(d))}${slot('tune', () => tuneHtml(d))}</aside>
    </div>
  </div>`);
  // early chunks first, in the order they were declared (sorted in place: subDefer splices into this same array)
  if (defer) defer.sort((a, b) => (b.early ? 1 : 0) - (a.early ? 1 : 0));
  return { html: out, defer: defer || [] };
}

// FD1: each deferred section renders in its own task, the task right after a frame has rendered (rAF, then
// setTimeout 0), so no two sections, and no section plus a release step, ever share a frame. (Idle callbacks were
// tried: several of them ran back to back with no frame between and added up to 50–60 ms frames at 4× CPU.)
const nextTask = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
// Laid-out heights of each deferred section at 1440 (stories 3, 5, 7, 13 and 16, measured: evidence 468–976,
// lens 417–439, connections 96–312, drafts 106–303, tune 109–149), used as its
// contain-intrinsic-size until it has rendered once (`auto` remembers the real size after that).
const CIS = { evidence: 700, 'ev-pw': 260, lens: 420, conn: 220, make: 200, tune: 130 };
const live = (body, st) => body._dx === st && body.isConnected && !body.closest('.closing');
/**
 * After the flight (FD1). One deferred section per task, inserted with content-visibility:auto (dossier.css
 * .dx-cv), so a section below the fold costs its parse and a box, not a layout of its text. No layout reads.
 * Then, still one per task, each section drops content-visibility so the scroll height is exact; only after the
 * last does `done()` start the layout observer (ResizeObserver only), so the column balance works from real heights.
 * Everything stops when the dossier closes or moves to another story.
 */
function fillProgressive(body, st, chunks, done) {
  let i = 0, landed = false, waiting = false, io = null;
  const phone = () => !!(st.phone || dossier.isPhone?.());
  /**
   * D-6: an entrance only for a section the reader can see. Each inserted section is held at opacity 0 (.dx-pre)
   * and observed (IntersectionObserver rooted on the scroller: no layout read); on its first report an on-screen
   * section fades in (opacity only, 240 ms, --ease-fade) and an off-screen one simply drops the hold, with no
   * animation, no layer and no repaint while the panel settles. On the phone sheet there is no entrance at all.
   */
  const enter = (nodes) => {
    if (reduced() || phone() || !nodes.length || !('IntersectionObserver' in window)) return;
    const scroller = body.closest('.dossier-scroll');
    if (!scroller) return;
    io ||= new IntersectionObserver((entries) => {
      for (const en of entries) {
        const n = en.target;
        io.unobserve(n);
        if (en.isIntersecting && live(body, st)) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade });
        n.classList.remove('dx-pre'); // same task as the animation's start: no frame at the resting opacity first
      }
    }, { root: scroller });
    for (const n of nodes) { n.classList.add('dx-pre'); io.observe(n); }
  };
  const step = () => {
    waiting = false;
    // an idle prebuild renders into a container that dossier.js detaches until open(): park, and resume on land()
    if (body._dx === st && !body.isConnected && !body.closest('.closing')) { waiting = true; return; }
    if (!live(body, st)) return;
    while (i < chunks.length) {
      if (!chunks[i].early && !landed) { waiting = true; return; } // the rest waits for the landing
      const { slot, html: fn, run, early } = chunks[i++];
      if (run) { run(); break; } // a compute-only chunk: its own task too
      const ph = body.querySelector(`[data-defer="${slot}"]`);
      if (!ph) continue;
      const t = document.createElement('template');
      t.innerHTML = String(fn());
      const nodes = [...t.content.children];
      if (!early) for (const n of nodes) if (n.matches('.dx-sec, .dx-ev') && !n.classList.contains('dx-cv')) { n.classList.add('dx-cv'); n.style.setProperty('--cis', `${CIS[slot] || 320}px`); }
      ph.replaceWith(t.content);
      enter(nodes);
      if (landed) animateBars(body, phone()); // the breakdown arrived after the landing
      break; // one section per task
    }
    if (i < chunks.length) nextTask(step); else nextTask(release);
  };
  const release = () => {
    if (!live(body, st)) { io?.disconnect(); return; }
    const n = body.querySelector('.dx-cv');
    if (!n) { done(); return; }
    n.classList.remove('dx-cv'); n.style.removeProperty('--cis');
    nextTask(release);
  };
  // the first early chunk waits one more frame: dossier.js focuses the h1 in the task after the first frame, and
  // content inserted before that focus would make it force a layout
  if (chunks[0]?.early) requestAnimationFrame(() => nextTask(step)); else waiting = true;
  return { land() { landed = true; if (waiting) nextTask(step); } };
}

function animateBars(body, phone = false) {
  const list = body.querySelector('.dx-bars.is-pending');
  if (!list) return;
  list.classList.remove('is-pending');
  if (reduced() || phone) return; // D-6: on the phone sheet the breakdown is far below the fold: no entrance
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
    if (!body.isConnected || body.closest('.closing')) { ro.disconnect(); return; } // nothing to balance while it closes
    for (const en of entries) sizes.set(en.target, hOf(en));
    const vh = sizes.get(scroller), lh = sizes.get(left), rh = sizes.get(right);
    if (vh == null || lh == null || rh == null) return;
    // the sticky offset goes on the column itself: a custom property on the body would restyle every descendant
    const stick = `${Math.min(24, vh - rh - 24).toFixed(0)}px`;
    if (right.style.top !== stick) right.style.top = stick;
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

/** S1 / D-6: an in-panel expansion keeps the frost off (dossier.busy) until its animations have finished. */
function settle(anims) {
  if (!anims.length) return;
  const all = Promise.all(anims.map(a => a.finished.catch(() => {})));
  if (typeof dossier.busy === 'function') dossier.busy(all);
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
      if (!reduced()) settle([...out.children].map((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 50, easing: EASE.settle, fill: 'backwards' })));
    }, 'Thinking…');
    if (kind === 'more-claims' || kind === 'more-conn') {
      const host = btn.previousElementSibling;
      const anims = [];
      host?.querySelectorAll('[data-more]').forEach(li => { li.hidden = false; if (!reduced()) anims.push(li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.fade })); });
      btn.remove();
      settle(anims);
    }
    if (kind === 'expand-group') {
      const rest = btn.closest('.dx-group')?.querySelector('[data-rest]');
      if (!rest) return;
      const full = rest.querySelector('.dx-rest-full'), compact = rest.querySelector('.dx-compact');
      const open = full.hidden;
      if (open && !full.children.length) { // built on first expand, not during the open
        const members = (d.articles || []).filter(x => x.domain === full.dataset.domain).slice(2);
        const labels = kindLabels(d.articles || []);
        full.innerHTML = String(html`${members.map(x => articleCard(x, d.story?.finding || '', d.story?.title || '', labels.get(x.id)))}`);
      }
      full.hidden = !open; compact.hidden = open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Show the short list' : `Show all ${rest.closest('.dx-group').querySelectorAll('.dx-group > .dx-art').length + full.children.length} in full`;
      if (open && !reduced()) settle([...full.children].map((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: Math.min(i, 6) * 40, easing: EASE.settle, fill: 'backwards' })));
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
  // early chunks start now (from the flight's second frame); the rest wait for afterFlight
  const fill = m.defer.length ? fillProgressive(body, st, m.defer, () => layoutObserver(body)) : null;
  return {
    afterFlight(opts = {}) {
      if (landed || body._dx !== st) return;
      landed = true;
      if (opts.phone) st.phone = true;
      animateBars(body, !!(opts.phone || dossier.isPhone?.()));
      if (fill) fill.land(); else layoutObserver(body);
    }
  };
}

dossier.registerDossierRenderer(renderDossier);
export { renderDossier };
