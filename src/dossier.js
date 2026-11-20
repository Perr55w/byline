// Dossier payload for /api/stories/:id, following critic F §3 (information architecture) — pure given its inputs.
import { originOf, roleOf, kindLabel, sourceCounts, sourceSummary, sourceLine, shortTitle, isBoilerplate, cleanClaim, usableClaim,
  numberMarks, markedText, groupClaims, orderArticles, findingLine, mapSignals, listJoin, CHALLENGE_TERMS, keyEligible } from './finding.js';
import { scoreFrom } from './score.js';
import { whyRanked, mainTopic } from './facts.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const q = (t) => `“${t}”`;

/** Recency note: h = −96·ln r; at the 0.35 floor say "4+ days old". */
function recencyNote(b) {
  if (b.recency <= 0.35) return 'newest post 4+ days old';
  const h = b.newest_hours ?? -96 * Math.log(b.recency);
  if (h < 1) return 'newest post under an hour old';
  if (h < 36) return `newest post ~${Math.round(h)} h old`;
  return `newest post ~${Math.round(h / 24)} days old`;
}

/** Score breakdown with visible weights (F §3 D). Track lengths are proportional to the maxima 35:25:20:20. */
export function breakdownView(story, counts) {
  const b = story.breakdown || {};
  if (b.version !== 2) return { version: b.version ?? 1, legacy: true, score: story.score, reconciles: false };
  const { points, base, score } = scoreFrom(b);
  const W = b.weights;
  const maxW = Math.max(...Object.values(W));
  const ev = counts;
  const notes = {
    interest: b.interest >= 1 ? 'maxed' : `${b.interest_raw} of ${b.interest_cap} raw priority points`,
    evidence: ev.independent_outlets ? `${plural(ev.outlets, 'outlet')}, ${ev.independent_outlets} independent`
      : ev.first_party === ev.posts ? `${plural(ev.outlets, 'outlet')}, first-party only` : `${plural(ev.outlets, 'outlet')}, no independent report`,
    novelty: b.similar_to ? `similar to ${q(shortTitle(b.similar_to.title))}, a story you opened` : 'unlike stories you’ve opened',
    impact: [mapSignals(b.impact_hits || []).slice(0, 2).join(', '), Object.entries(b.signals || {}).filter(([, v]) => v).map(([k]) => ({ testable: 'testable', challenges: 'challenges a claim', process: 'process change', numbers: 'numbers' })[k]).join(', ')].filter(Boolean).join(' · ') || 'no practical signals'
  };
  const order = ['interest', 'evidence', 'novelty', 'impact'];
  const label = { interest: 'Interest', evidence: 'Evidence', novelty: 'Novelty', impact: 'Impact' };
  const pr = (b.priorities || []).filter(p => p.de_emphasis);
  return {
    version: 2, score: story.score, threshold: null, base, base_max: 100,
    rows: order.map(k => ({ key: k, label: label[k], value: b[k], points: points[k], max: W[k], weight_pct: W[k], fraction: Math.round((points[k] / W[k]) * 1000) / 1000, track: Math.round((W[k] / maxW) * 1000) / 1000, note: notes[k] })),
    multipliers: [
      { key: 'recency', label: 'recency', value: b.recency, note: recencyNote(b) },
      { key: 'feedback', label: 'feedback', value: Math.round((1 + b.feedback) * 100) / 100, note: b.feedback ? `your feedback on these topics ${b.feedback > 0 ? 'adds' : 'removes'} ${Math.abs(Math.round(b.feedback * 100))}%` : 'no feedback on these topics' },
      { key: 'source_pref', label: 'source pref', value: b.source_pref, note: b.source_pref < 1 ? 'includes a source you marked low quality' : 'no source marked low quality' },
      { key: 'penalty', label: 'de-emphasis', value: b.penalty, note: pr.length ? `marked down for ${listJoin(pr.map(p => p.topic))}` : 'no de-emphasized topics' }
    ],
    computed: score, reconciles: score === story.score, newest_hours: b.newest_hours, ranked_at: b.ranked_at,
    formula: 'score = round1(base × recency × feedback × source_pref × de_emphasis); base = Σ round1(component × weight)'
  };
}

/** Evidence in four fixed groups plus de-emphasis (F §3 B), from the structured breakdown. */
export function evidenceGroups(story) {
  const b = story.breakdown || {};
  if (b.version !== 2) return legacyEvidence(story.explanation || '');
  const pts = b.points || {};
  const pr = (b.priorities || []).filter(p => !p.de_emphasis);
  const priorities = {
    title: 'Matches your priorities',
    rows: pr.map(p => ({ topic: p.topic, weight: p.weight, rank: p.rank, hits: p.hits, strong: p.weight >= 2,
      text: `${p.topic}: your #${p.rank} priority, matched ${listJoin(p.hits.slice(0, 4).map(q))}.` })),
    interest_points: pts.interest, interest_max: 35, maxed: b.interest >= 1,
    summary: b.interest >= 1 ? 'Interest maxed: 35 of 35.' : null,
    empty: pr.length ? null : `Barely touches your priorities (interest ${pts.interest} of 35).`
  };
  const wt = b.watch_terms || (b.watch || []).map(name => ({ name, kind: null, pinned: false, terms: [] }));
  const emps = b.employer_hits || (b.employers || []).map(name => ({ name, pinned: false }));
  const watchlist = {
    title: 'On your watchlist',
    rows: wt.map(w => ({ name: w.name, kind: w.kind, pinned: w.pinned, terms: w.terms,
      text: `${q(w.name)}${w.terms?.length ? `, matched ${listJoin(w.terms.slice(0, 4).map(q))}` : ''}.` })),
    employers: emps.map(e => ({ name: e.name, pinned: e.pinned, text: `Mentions ${e.name}${e.pinned ? ' (big-push employer)' : ''}.` })),
    empty: wt.length || emps.length ? null : 'No watchlist items or employers mentioned.'
  };
  const mapped = mapSignals(b.impact_hits || []);
  const practical = { title: 'Practical signals', hits: b.impact_hits || [], mapped, text: mapped.length ? `Mentions ${listJoin(mapped.slice(0, 5))}.` : null, empty: mapped.length ? null : 'No practical signals found.' };
  const sig = b.signals || {}, quotes = b.signal_quotes || {};
  const LBL = { testable: 'You can try it', challenges: 'It challenges a claim', process: 'It changes a process', numbers: 'Checkable numbers' };
  const rows = ['testable', 'challenges', 'process', 'numbers'].filter(k => sig[k]).map(k => {
    const quote = quotes[k] && keyEligible(quotes[k]) ? quotes[k] : null; // R2 S14: filler / self-talk never quoted
    const text = k === 'numbers' && b.numbers_found?.length ? `${LBL[k]}: ${b.numbers_found.slice(0, 5).join(', ')}.` : `${LBL[k]}${quote ? `: ${q(quote)}` : '.'}`;
    return { signal: k, label: LBL[k], quote, terms: k === 'numbers' ? (b.numbers_found || []) : (b.signal_hits?.[k] || []), text };
  });
  const post_worthy = { title: 'Why it’s post-worthy', rows, empty: rows.length ? null : 'No post-worthy signals found.' };
  const de = (b.priorities || []).filter(p => p.de_emphasis);
  const de_emphasis = { title: 'Marked down', rows: de.map(p => ({ topic: p.topic, hits: p.hits, factor: b.penalty })),
    text: de.length ? `Marked down ${Math.round((1 - b.penalty) * 100)}% for ${listJoin(de.map(p => `${p.topic.toLowerCase()} (matched ${listJoin(p.hits.slice(0, 3).map(q))})`))}.` : null };
  const notes = [];
  if (b.novelty < 0.5) notes.push(`Similar to a story you’ve opened (novelty ${pts.novelty} of 20).`);
  if (b.feedback) notes.push(`Your feedback on these topics ${b.feedback > 0 ? 'adds' : 'removes'} ${Math.abs(Math.round(b.feedback * 100))}%.`);
  return { priorities, watchlist, practical, post_worthy, de_emphasis, notes };
}

/** Fallback for stories ranked before v2: turn the " · " explanation clauses into plain language (F §3). */
export function legacyEvidence(explanation) {
  const parts = explanation.split(' · ');
  const find = (re) => parts.find(p => re.test(p));
  const m = find(/^Matches /);
  const w = find(/^watchlist: /);
  const ps = find(/^practical signals: /);
  const pw = find(/^post-worthy: /);
  const de = find(/^de-emphasized/);
  const topics = m ? [...m.replace(/^Matches /, '').matchAll(/([^;(]+)\(/g)].map(x => x[1].trim()) : [];
  return {
    legacy: true,
    priorities: { title: 'Matches your priorities', rows: topics.map(t => ({ topic: t, text: `Fits ${t}.` })), empty: m ? null : 'Barely touches your priorities.' },
    watchlist: { title: 'On your watchlist', rows: w ? w.replace(/^watchlist: /, '').split(', ').map(n => ({ name: n, text: `${q(n)}.` })) : [], employers: [], empty: w ? null : 'No watchlist items or employers mentioned.' },
    practical: { title: 'Practical signals', hits: ps ? ps.replace(/^practical signals: /, '').split(', ') : [], text: ps ? `Mentions ${listJoin(mapSignals(ps.replace(/^practical signals: /, '').split(', ')))}.` : null },
    post_worthy: { title: 'Why it’s post-worthy', rows: pw ? [{ text: `Worth a post: ${pw.replace(/^post-worthy: /, '')}.` }] : [], empty: pw ? null : 'No post-worthy signals found.' },
    de_emphasis: { title: 'Marked down', rows: [], text: de ? de.replace(/^de-emphasized \(×([\d.]+)\): /, (_, f) => `Marked down ${Math.round((1 - Number(f)) * 100)}% for `) : null },
    notes: []
  };
}

/** Lens without `learn` (a template with the title pasted in); `who` split into a list. */
export function lensView(lens) {
  if (!lens) return null;
  return { who: String(lens.who || '').split(/;\s*/).map(s => s.trim()).filter(Boolean), decision: lens.decision || null, test: Array.isArray(lens.test) ? lens.test : [], provider: lens.provider || null };
}

/** Articles in F order, each with "what it says", its claims (grouped, cleaned, marked, deduped) and a role badge. */
export function articlesView(articles, claims) {
  const origin = originOf(articles);
  const od = origin?.domain;
  const perDomain = articles.reduce((m, a) => (m[a.domain] = (m[a.domain] || 0) + 1, m), {});
  const used = new Set();
  const says = new Map();
  for (const a of articles) {
    const sum = cleanClaim(a.summary || '');
    if (sum && !isBoilerplate(sum)) {
      says.set(a.id, { text: sum, marks: numberMarks(sum), from: 'summary', claim_id: null });
      const norm = (t) => t.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
      const ns = norm(sum);
      for (const c of claims) if (c.article_id === a.id && ns.includes(norm(cleanClaim(c.text)))) used.add(c.id);   // already shown in "what it says"
      continue;
    }
    // R2 S14: a self-talk sentence with no number ("we’ve heard helpful feedback") is never the Key claim
    const best = claims.filter(c => c.article_id === a.id).map(c => ({ c, t: cleanClaim(c.text) })).filter(x => usableClaim(x.t, x.c.text) && keyEligible(x.t))
      .sort((x, y) => numberMarks(y.t).length - numberMarks(x.t).length || y.c.has_number - x.c.has_number || x.c.id - y.c.id)[0];
    if (best) { used.add(best.c.id); says.set(a.id, { text: best.t, marks: numberMarks(best.t), from: 'claim', claim_id: best.c.id }); }
    else says.set(a.id, null);
  }
  const { groups, duplicates } = groupClaims(articles, claims, { usedClaimIds: used });
  const list = orderArticles(articles).map(a => {
    const cl = (groups.get(a.id) || []).filter(c => !c.used_as_summary);
    const sum = cleanClaim(a.summary || '');
    return {
      id: a.id, domain: a.domain, title: a.title, url: a.url, kind: a.evidence_kind, evidence_kind: a.evidence_kind, kind_label: kindLabel(a, od), role: roleOf(a, od),
      source_id: a.source_id, source_name: a.source_name || null, published_at: a.published_at || null, fetched_at: a.fetched_at || null,
      date_basis: a.published_at ? 'published' : 'fetched', summary: sum && !isBoilerplate(sum) ? sum : null, says: says.get(a.id),
      is_new: !!a.is_new, is_demo: !!a.is_demo, is_origin: a.id === origin?.id, domain_posts: perDomain[a.domain] || 1,
      claims: cl, claims_total: cl.length
    };
  });
  const domain_groups = Object.entries(perDomain).map(([domain, posts]) => {
    const roles = [...new Set(articles.filter(a => a.domain === domain).map(a => roleOf(a, od)))];
    const roleText = roles.length === 1 ? ({ first_party: 'first-party', independent: 'independent', primary: 'primary', commentary: 'commentary' })[roles[0]] : 'mixed';
    return { domain, posts, roles, collapse: posts >= 5, label: `${posts} posts from ${domain} (${roleText})` };
  }).sort((x, y) => y.posts - x.posts);
  return { list, duplicates, domain_groups };
}

/** "What the sources say" header: computed sentence + one callout. */
export function sourcesHeader(articles, claims) {
  const counts = sourceCounts(articles);
  const f = findingLine({}, articles, claims);
  let callout = null;
  if (f.kind === 'disagreement') callout = { kind: 'disagreement', text: f.text, marks: f.marks, article_id: f.article_id, claim_id: f.claim_id };
  else if (counts.posts && counts.independent === 0 && counts.first_party === counts.posts) callout = { kind: 'all_first_party', text: 'No independent outlet has reported this yet; every figure below is the company’s own.', marks: [] };
  else if (counts.posts && counts.independent === 0) callout = { kind: 'no_independent', text: 'No independent outlet has reported this yet.', marks: [] };
  return { sentence: sourceSummary(counts), line: sourceLine(counts), counts, callout, challenge_terms: CHALLENGE_TERMS };
}

export { mainTopic, whyRanked, markedText };
