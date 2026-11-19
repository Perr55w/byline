// Pure, DB-free helpers shared by every endpoint that shows a story (Today, Feed, Map, Search, dossier).
// Implements critic F's rules (docs/design/council-v4/round0-F-type-info.md, amendments 1 and 3):
// honest source vocabulary, findingLine(), the boilerplate filter, claim cleanup and number highlighting.
// Nothing here touches the database, so tests can import it directly.
import { tokens, jaccard, sentences } from './text.js';

// ---------- vocabulary ----------
// post = an article · outlet = a distinct domain · first-party = `announcement`
// independent = `reporting` | `research` on a domain other than the origin's
// primary = `reporting` | `research` on the origin's own domain (the study or report itself)
// commentary = everything else (commentary, community, application/release notes)
export const CREDIBILITY = { announcement: 0, research: 0, reporting: 1, commentary: 2, community: 3, application: 3 };
const rankOf = (kind) => CREDIBILITY[kind] ?? 4;

/** The article a story is "about": first announcement, else first research, else the first article. */
export function originOf(articles = []) {
  return articles.find(a => a.evidence_kind === 'announcement') || articles.find(a => a.evidence_kind === 'research') || articles[0] || null;
}

/** Per-article role in F's vocabulary. */
export function roleOf(a, originDomain) {
  const k = a.evidence_kind;
  if (k === 'announcement') return 'first_party';
  if (k === 'reporting' || k === 'research') return a.domain && a.domain !== originDomain ? 'independent' : 'primary';
  return 'commentary';
}

/** UI badge text for an article (F §3 line 1). */
export function kindLabel(a, originDomain) {
  const k = a.evidence_kind;
  if (k === 'announcement') return 'Primary';
  if (k === 'research') return 'Research';
  if (k === 'reporting') return roleOf(a, originDomain) === 'independent' ? 'Independent' : 'Reporting';
  if (k === 'commentary') return 'Commentary';
  if (k === 'community') return 'Community';
  if (k === 'application') return 'Release notes';
  return 'Other';
}

/**
 * Honest source counts. first_party + primary + independent + commentary === posts (all counted per post).
 * independent_outlets counts distinct domains among the independent posts.
 */
export function sourceCounts(articles = []) {
  const origin = originOf(articles);
  const od = origin?.domain || null;
  const out = { posts: articles.length, outlets: new Set(articles.map(a => a.domain).filter(Boolean)).size, first_party: 0, primary: 0, independent: 0, commentary: 0, independent_outlets: 0, origin_domain: od };
  const indepDomains = new Set();
  for (const a of articles) {
    const r = roleOf(a, od);
    out[r]++;
    if (r === 'independent') indepDomains.add(a.domain);
  }
  out.independent_outlets = indepDomains.size;
  return out;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "6 posts · 1 outlet · 0 independent" (F's binding wording). */
export const sourceLine = (c) => `${plural(c.posts, 'post')} · ${plural(c.outlets, 'outlet')} · ${c.independent_outlets} independent`;

/** "6 posts from 1 outlet: 6 first-party, 0 independent, 0 commentary/community." */
export function sourceSummary(c) {
  const parts = [`${c.first_party} first-party`];
  if (c.primary) parts.push(`${c.primary} primary research/report`);
  parts.push(`${c.independent} independent`, `${c.commentary} commentary/community`);
  return `${plural(c.posts, 'post')} from ${plural(c.outlets, 'outlet')}: ${parts.join(', ')}.`;
}

/** Evidence qualifier for one-liners (F §2). */
export const evidenceQualifier = (c) => c.independent_outlets ? `backed by ${plural(c.independent_outlets, 'independent outlet')}` : 'with no independent report yet';

/**
 * F §2: the text before the first ":" or " — " when that prefix is substantial, else the title capped at 60.
 * F's rule says ≥ 20 characters, but F's own real output uses "Gemini at Work 2026" (19), so a prefix counts when it
 * has ≥ 15 characters and ≥ 3 words ("Study" or "Hands-on" never qualify).
 */
export function shortTitle(title = '') {
  // a leading GitHub-style "org/" (as in "acme/agent-kit v2: …") is dropped; the cut is the text before the first
  // ':', ' — ' or ',' when that part is at least 20 characters (round 1, S17c); else the title capped at 60
  const t = String(title).trim().replace(/^[A-Za-z0-9_.-]+\/(?=[A-Za-z0-9_.-]+(?:[\s:,]|$))/, '');
  const m = t.match(/^(.*?)(?::\s| — |,\s)/);
  if (m && m[1].trim().length >= 20) return m[1].trim();
  if (t.length <= 60) return t;
  return t.slice(0, 59).replace(/\s+\S*$/, '') + '…';
}

// ---------- boilerplate + claim cleanup ----------
export const BOILERPLATE = /^(this article is adapted|learn about|read on|today, we are excited|we['’]re (excited|highlighting)|features\b|bug fixes|\w+ is an ai safety)|^today,? we(?:'|’)?re|^today,? we are (announcing|introducing|launching|excited)|^we are expanding our partnership/i;
const wc = (s) => (String(s).match(/\S+/g) || []).length;

/** True when a summary should never be used as a dek: F's regex, fewer than 8 words, or a newline list. */
export function isBoilerplate(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (BOILERPLATE.test(t)) return true;
  if (wc(t) < 8) return true;
  if (/\n\s*([-*•·]|\d+[.)])\s/.test(t) || (t.match(/\n/g) || []).length >= 2) return true;
  if (/\s\.\s+[a-z]/.test(t) || (t.match(/(?:^|\s)[a-z]+: [a-z]/g) || []).length >= 2) return true;   // run-together release notes
  return false;
}

/** Strip a leading footnote digit, fix spaces before punctuation, collapse whitespace. */
export function cleanClaim(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d{1,2}\s+(?=[A-Z])/, '')   // "1 These days…" (footnote marker)
    .replace(/\s+([.,;:!?)])/g, '$1')       // "terminated ." → "terminated."
    .replace(/\(\s+/g, '(')
    .trim();
}

/**
 * A claim worth showing: ≥ 6 words after cleanup, not boilerplate by F's regex, and not a run-together
 * release-notes list (a mid-text " . " followed by lowercase, or two or more "label: lowercase" items).
 */
export function usableClaim(text, raw = text) {
  if (wc(text) < 6 || BOILERPLATE.test(text) || text.length > 360) return false;
  if (/\s\.\s+[a-z]/.test(String(raw))) return false;
  if ((String(raw).match(/(?:^|\s)[a-z]+: [a-z]/g) || []).length >= 2) return false;
  return true;
}

// ---------- number highlighting ----------
const UNITS = 'percent|pct|points?|x|times|fold|million|billion|trillion|thousand|k|m|bn|ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?|tokens?|gb|tb|mb|kb|users?|customers?|companies|enterprises|people|employees|teams?|workflows?|tasks?|languages?|countries|models?|requests?|queries|parameters?|params';
const NOT_PLURAL = new Set(['is', 'was', 'has', 'its', 'this', 'us', 'as', 'does', 'yes', 'less', 'across', 'plus', 'thus', 'whereas', 'always', 'perhaps', 'its', 'his', 'hers', 'ours', 'yours', 'theirs', 'access', 'process', 'business', 'success', 'class', 'gas', 'news', 'series', 'status', 'analysis', 'basis', 'versus', 'bonus', 'focus', 'campus', 'virus', 'corpus', 'means', 'uses', 'makes', 'gets', 'says', 'goes', 'comes', 'takes', 'runs', 'gives', 'shows', 'needs', 'seems', 'helps', 'works', 'adds', 'cuts', 'lets', 'puts', 'sets']);
const WORDNUM = '(?:one|two|three|four|five|six|seven|eight|nine|ten|a|half a|several)';
const MAG = '(?:thousand|million|billion|trillion)';

function overlaps(r, list) { return list.some(([s, e]) => r[0] < e && s < r[1]); }

/**
 * Highlight ranges for numbers that carry meaning: %, currency, ×/times, "N of M", or a count followed by
 * a unit or a plural noun (within three words), plus comma-grouped counts ("1,250"). Never bare years,
 * version strings ("2.10.0") or model names ("Opus 5.5"). Returns sorted, non-overlapping [start, end) pairs
 * in UTF-16 indices of `text`.
 */
export function numberMarks(text) {
  const s = String(text || '');
  const out = [];
  const add = (start, end) => { if (end > start && !overlaps([start, end], out)) out.push([start, end]); };
  const blocked = [];
  for (const m of s.matchAll(/\bv?\d+\.\d+(?:\.\d+)+\b/g)) blocked.push([m.index, m.index + m[0].length]);           // versions
  for (const m of s.matchAll(/\b\d{4}-\d{2}(?:-\d{2})?\b|\b\d{1,2}:\d{2}\b/g)) blocked.push([m.index, m.index + m[0].length]); // dates, clock times
  for (const m of s.matchAll(/\b[A-Z][A-Za-z]+ \d+(?:\.\d+)?(?![\d.,])(?! ?(?:%|percent|x\b|×|times\b))/g)) {      // "Opus 5.5", "Gemini 4"
    if (m.index === 0 || /[.!?:;]\s*$/.test(s.slice(Math.max(0, m.index - 3), m.index))) continue;              // sentence-initial word, not a name
    const numStart = m.index + m[0].search(/\d/);
    blocked.push([numStart, m.index + m[0].length]);
  }
  const free = (a, b) => !overlaps([a, b], blocked);
  const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
  const patterns = [
    new RegExp(String.raw`[$€£]\s?${NUM}(?:\s?${MAG}|\s?(?:k|m|bn)\b)?`, 'gi'),                                             // currency
    new RegExp(String.raw`\b${NUM}\s?(?:%|percent\b|pct\b|percentage points?\b)`, 'gi'),                                   // percent
    new RegExp(String.raw`\b${NUM}\s?(?:×|x\b|times\b|-fold\b|fold\b)`, 'gi'),                                              // multipliers
    new RegExp(String.raw`(?:×|x)\s?${NUM}\b`, 'g'),
    new RegExp(String.raw`\b${NUM}\s+(?:out\s+)?of\s+(?:the\s+)?${NUM}\b`, 'gi'),                                         // N of M
    new RegExp(String.raw`\b(?:${WORDNUM}\s+)?${MAG}\s+[a-z]+s\b|\b${WORDNUM}\s+${MAG}\b`, 'gi'),                        // "one trillion tokens"
    new RegExp(String.raw`\b${NUM}\s?${MAG}\b(?:\s+[a-z]+s\b)?`, 'gi')
  ];
  for (const re of patterns) for (const m of s.matchAll(re)) {
    const a = m.index, b = a + m[0].length;
    if (free(a, b)) add(a, b);
  }
  // Counts: a number followed within three words by a unit or a plural noun.
  for (const m of s.matchAll(new RegExp(String.raw`\b${NUM}\b`, 'g'))) {
    const a = m.index, raw = m[0];
    let b = a + raw.length;
    if (!free(a, b) || overlaps([a, b], out)) continue;
    const value = Number(raw.replace(/,/g, ''));
    const isYear = /^(19|20)\d{2}$/.test(raw);
    if (isYear) continue;
    if (/^\d{1,3}(,\d{3})+$/.test(raw)) { add(a, b); continue; }                         // 1,250
    const rest = s.slice(b, b + 60);
    const words = rest.match(/^(?:[\s-]+[A-Za-z][\w'’-]*){1,4}/);
    if (!words) continue;
    const ws = words[0].trim().split(/[\s]+/);
    let hit = -1;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i].replace(/^-/, '').toLowerCase().replace(/[’']s$/, '');
      if (new RegExp(`^(?:${UNITS})$`).test(w)) { hit = i; break; }
      if (/^[a-z][a-z-]*[^s]s$/.test(w) && !NOT_PLURAL.has(w) && w.length > 3) { hit = i; break; }
      if (i === 0 && /^(and|or|to|in|on|at|by|is|was|were|are)$/.test(w)) break;
      if (i >= 3 && !/^(of|its|their|the|our)$/.test(ws[i - 1]?.toLowerCase())) break;
    }
    if (hit < 0) continue;
    if (value < 2 && !/\./.test(raw) && hit > 0) continue;
    add(a, b);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** The highlighted substrings, for tests and plain-text use. */
export const markedText = (text, marks) => marks.map(([a, b]) => text.slice(a, b));

// ---------- finding line ----------
export const CHALLENGE_TERMS = ['contradicts', 'debunk', 'fails', 'failed', 'smaller than', 'overstated', 'needs context', 'mixed results', 'replicate', 'could not reproduce'];
const hasChallenge = (t) => { const s = ` ${String(t).toLowerCase()} `; return CHALLENGE_TERMS.some(c => s.includes(` ${c}`)); };

/** "Google Cloud — AI & ML blog" → "Google Cloud"; "DEMO · Northwind AI Blog" → "Northwind AI". */
export function orgName(a) {
  let n = String(a?.source_name || '').replace(/^DEMO\s*·\s*/i, '');
  n = n.split(/\s+[—–-]\s+|:\s/)[0].replace(/\s+(blog|news|newsroom|papers|press|release notes|updates)$/i, '').trim();
  if (!n || /^manual submissions$/i.test(n)) n = a?.domain || '';
  return n;
}

const LEAD_CLAUSE = /^(In|Over|During|Since|Across|For|Within|Last|This)\b[^,]{2,40},\s+/;
const LOWER_OK = /^(nearly|almost|about|around|more|over|under|roughly|some|most|many|the|a|an|its|their|every|each|only|just|up|at least|half|one|two|three|four|five|six|seven|eight|nine|ten|\d)/i;

/** Attribute a first-party claim: "Google Cloud says nearly 500 …" or "… (company claim)". */
export function attribute(claim, a) {
  const org = orgName(a);
  const text = claim.replace(/[.!?]+$/, '');
  if (!org || new RegExp(`\\b(says|said|according to|reports?|reported)\\b`, 'i').test(text) || text.toLowerCase().startsWith(org.toLowerCase())) return `${text}.`;
  const esc = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let body = text.replace(new RegExp(`(\\d[\\d,]*\\+?)\\s+${esc}\\s+(?=[a-z])`), '$1 of its ');
  if (body.toLowerCase().includes(org.toLowerCase()) || /^(we|our|us)\b/i.test(body)) return `${text} (company claim).`;
  const lead = body.match(LEAD_CLAUSE);
  if (lead) body = `${body.slice(lead[0].length)} ${lead[0].replace(/,\s+$/, '').replace(/^\w/, c => c.toLowerCase())}`;
  if (!LOWER_OK.test(body)) return `${text} (company claim).`;
  body = body.replace(/^\w/, c => c.toLowerCase());
  return `${org} says ${body}.`;
}

const capLen = (t, n = 220) => {
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const at = Math.max(cut.lastIndexOf('; '), cut.lastIndexOf(', '));
  return (at > n * 0.55 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, '')) + '…';
};

const SIGNAL_MAP = { ga: 'general availability', 'general availability': 'general availability', api: 'an API', sdk: 'an SDK', 'open-source': 'open source', 'open source': 'open source', price: 'pricing', cost: 'cost or pricing', costs: 'cost or pricing', available: 'availability', standard: 'a standard' };
/** Map practical-signal terms to plain words: ga → general availability, api → an API, sdk → an SDK. */
export function mapSignals(hits = []) {
  const seen = new Set(), out = [];
  for (const h of hits) { const m = SIGNAL_MAP[h.toLowerCase()] || h.toLowerCase(); if (!seen.has(m)) { seen.add(m); out.push(m); } }
  return out;
}
export const listJoin = (xs) => xs.length <= 1 ? (xs[0] || '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * F amendment 3. Order of preference:
 *  (a) disagreement: an independent reporting/research claim with a challenge term → "Independent check: …"
 *  (b) best numeric claim from the most credible article, attributed when first-party
 *  (c) the story summary (or origin summary) if it is not boilerplate
 *  (d) a signals phrase built from the breakdown
 * Returns { text, marks, kind, article_id, claim_id }.
 */
export function findingLine(story = {}, articles = [], claims = []) {
  const origin = originOf(articles);
  const od = origin?.domain;
  const byId = new Map(articles.map(a => [a.id, a]));
  const cleaned = claims.map(c => ({ ...c, clean: cleanClaim(c.text) })).filter(c => usableClaim(c.clean, c.text));
  const done = (text, kind, extra = {}) => ({ text, marks: numberMarks(text), kind, article_id: extra.article_id ?? null, claim_id: extra.claim_id ?? null });

  // (a) disagreement
  for (const c of cleaned) {
    const a = byId.get(c.article_id);
    if (!a || roleOf(a, od) !== 'independent') continue;
    if (hasChallenge(c.clean)) {
      const said = c.clean.replace(/[.!?]*$/, '.');
      // no "Independent check: Independent testers…" stutter
      return done(capLen(/^independent\b/i.test(said) ? said : `Independent check: ${said}`), 'disagreement', { article_id: a.id, claim_id: c.id });
    }
  }
  // (b) best numeric claim from the most credible article (origin first, then credibility, then date)
  const ordered = [...articles].sort((x, y) => (x === origin ? -1 : y === origin ? 1 : 0) || rankOf(x.evidence_kind) - rankOf(y.evidence_kind) || dateOf(x) - dateOf(y) || x.id - y.id);
  for (const a of ordered) {
    const mine = cleaned.filter(c => c.article_id === a.id).map(c => ({ c, n: numberMarks(c.clean).length })).filter(x => x.n > 0);
    if (!mine.length) continue;
    mine.sort((x, y) => y.n - x.n || x.c.clean.length - y.c.clean.length || x.c.id - y.c.id);
    const best = mine[0].c;
    const text = a.evidence_kind === 'announcement' ? attribute(best.clean, a) : best.clean.replace(/[.!?]*$/, '.');
    return done(capLen(text), 'claim', { article_id: a.id, claim_id: best.id });
  }
  // (c) summary
  for (const cand of [story.summary, origin?.summary]) {
    const t = cleanClaim(cand || '');
    if (t && !isBoilerplate(t)) {
      const ss = sentences(t);
      let pick = '';
      for (const x of (ss.length ? ss : [t])) { if (BOILERPLATE.test(x)) continue; pick = pick ? `${pick} ${x}` : x; if (wc(pick) >= 12 || pick.length >= 140) break; }
      if (wc(pick) >= 8) return done(capLen(pick), 'summary', { article_id: cand === origin?.summary ? origin?.id : null });
    }
  }
  // (d) signals phrase
  const b = story.breakdown || {};
  const sig = mapSignals(b.impact_hits || []);
  if (sig.length) return done(`Mentions ${listJoin(sig.slice(0, 3))}.`, 'signals');
  const topics = (story.topics || []).slice(0, 2);
  if (topics.length) return done(`About ${listJoin(topics)}; no checkable claim found in its sources.`, 'signals');
  return done('No summary or checkable claim found in its sources.', 'signals');
}

const dateOf = (a) => Date.parse(a.published_at || a.fetched_at || '') || 0;

// ---------- dossier helpers ----------
/** F §3 order: announcement/research, then reporting, then commentary, then community/application, then by date. */
export function orderArticles(articles = []) {
  return [...articles].sort((x, y) => rankOf(x.evidence_kind) - rankOf(y.evidence_kind) || dateOf(x) - dateOf(y) || x.id - y.id);
}

/**
 * Claims grouped per article: cleaned text, number marks, near-duplicate collapse (Jaccard > 0.6 across
 * articles → "also reported by"), has_number first, skipping the claim used as the article's "what it says".
 */
export function groupClaims(articles = [], claims = [], { usedClaimIds = new Set() } = {}) {
  const ordered = orderArticles(articles);
  const pos = new Map(ordered.map((a, i) => [a.id, i]));
  const cl = claims.map(c => ({ ...c, clean: cleanClaim(c.text) })).filter(c => usableClaim(c.clean, c.text))
    .sort((x, y) => (pos.get(x.article_id) ?? 99) - (pos.get(y.article_id) ?? 99) || y.has_number - x.has_number || x.id - y.id);
  const toks = new Map(cl.map(c => [c.id, tokens(c.clean)]));
  const kept = [], dupOf = new Map();
  for (const c of cl) {
    const twin = kept.find(k => k.article_id !== c.article_id && jaccard(toks.get(k.id), toks.get(c.id)) > 0.6);
    if (twin) { dupOf.set(c.id, twin.id); continue; }
    kept.push(c);
  }
  const domainOfArt = new Map(articles.map(a => [a.id, a.domain]));
  const groups = new Map(ordered.map(a => [a.id, []]));
  for (const c of kept) {
    const also = [...dupOf.entries()].filter(([, k]) => k === c.id).map(([d]) => domainOfArt.get(cl.find(x => x.id === d)?.article_id)).filter(Boolean);
    groups.get(c.article_id)?.push({ id: c.id, text: c.clean, marks: numberMarks(c.clean), evidence_kind: c.evidence_kind, has_number: !!c.has_number, also_reported_by: [...new Set(also)], used_as_summary: usedClaimIds.has(c.id) });
  }
  const duplicates = [...dupOf.entries()].map(([id, of]) => ({ id, duplicate_of: of, article_id: cl.find(x => x.id === id)?.article_id }));
  return { groups, duplicates };
}
