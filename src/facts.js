// DB-backed story enrichment shared by /api/stories, /api/stories/:id, /api/today, /api/search and /api/map.
// The rules themselves live in finding.js (pure); this module only batches the queries.
import { all, getSettings, parse } from './db.js';
import { findingLine, sourceCounts, sourceLine, shortTitle, evidenceQualifier, mapSignals, listJoin } from './finding.js';

const placeholders = (n) => Array(n).fill('?').join(',');

/** Articles (with source name) and claims for many stories in two queries, grouped by story_id. */
export function loadMany(ids) {
  const arts = new Map(), claims = new Map();
  const uniq = [...new Set(ids.map(Number).filter(Boolean))];
  for (const id of uniq) { arts.set(id, []); claims.set(id, []); }
  if (!uniq.length) return { arts, claims };
  for (const a of all(`SELECT a.id, a.story_id, a.source_id, a.domain, a.title, a.url, a.summary, a.evidence_kind, a.published_at, a.fetched_at, a.is_demo,
      s.name AS source_name FROM articles a LEFT JOIN sources s ON s.id = a.source_id WHERE a.story_id IN (${placeholders(uniq.length)})
      ORDER BY COALESCE(a.published_at, a.fetched_at), a.id`, ...uniq)) arts.get(a.story_id)?.push(a);
  for (const c of all(`SELECT id, story_id, article_id, text, evidence_kind, has_number FROM claims WHERE story_id IN (${placeholders(uniq.length)}) ORDER BY has_number DESC, id`, ...uniq)) claims.get(c.story_id)?.push(c);
  return { arts, claims };
}

/** The fields every story payload carries in v4. `story` must have topics (array) and breakdown (object) hydrated. */
export function storyFacts(story, articles, claims) {
  const breakdown = story.breakdown || parse(story.breakdown_json, {}) || {};
  const f = findingLine({ ...story, breakdown }, articles, claims);
  const c = sourceCounts(articles);
  return {
    finding: f.text, finding_marks: f.marks, finding_kind: f.kind,
    posts: c.posts, outlets: c.outlets, first_party: c.first_party, primary: c.primary, independent: c.independent,
    independent_outlets: c.independent_outlets, commentary: c.commentary, origin_domain: c.origin_domain,
    source_line: sourceLine(c), evidence_qualifier: evidenceQualifier(c),
    short_title: shortTitle(story.title)
  };
}

/** Add storyFacts to many hydrated story rows (mutates and returns them). */
export function enrich(rows) {
  if (!rows?.length) return rows || [];
  const { arts, claims } = loadMany(rows.map(r => r.id ?? r.story_id));
  for (const r of rows) {
    const id = Number(r.id ?? r.story_id);
    Object.assign(r, storyFacts(r, arts.get(id) || [], claims.get(id) || []));
    if ('is_demo' in r) r.is_demo = !!r.is_demo;
  }
  return rows;
}

/** Main topic: the first of the story's topics whose priority weight is > 1, else its first topic. */
export function mainTopic(topics = [], weights = topicWeights()) {
  return topics.find(t => (weights[t] ?? 0) > 1) || topics[0] || null;
}
export function topicWeights() {
  return Object.fromEntries(getSettings().priorities.map(p => [p.topic, p.weight]));
}

/**
 * "Why it ranked": three plain bullets (F §3 C). Fit (largest component), evidence (always mention the weakest
 * component when it is under 50% of its maximum), post-worthiness.
 */
export function whyRanked(story, counts) {
  const b = story.breakdown || {};
  if (b.version !== 2) return [];
  const pts = b.points || {}, W = b.weights || {};
  const out = [];
  const pr = (b.priorities || []).filter(p => !p.de_emphasis);
  out.push(pr.length
    ? `Fits ${listJoin(pr.slice(0, 2).map(p => p.topic))}${b.interest >= 1 ? ' (interest maxed, 35 of 35)' : ` (interest ${pts.interest} of 35)`}.`
    : `Barely touches your priorities (interest ${pts.interest ?? 0} of 35).`);
  const comps = Object.keys(W).map(k => ({ k, frac: (pts[k] ?? 0) / W[k] })).sort((a, b) => a.frac - b.frac);
  const weakest = comps[0];
  const ev = counts || b.source_counts || {};
  const evText = ev.independent_outlets
    ? `Evidence: ${ev.posts} post${ev.posts === 1 ? '' : 's'} from ${ev.outlets} outlet${ev.outlets === 1 ? '' : 's'}, ${ev.independent_outlets} independent (${pts.evidence} of 25).`
    : `Evidence is thin: ${ev.posts} post${ev.posts === 1 ? '' : 's'} from ${ev.outlets} outlet${ev.outlets === 1 ? '' : 's'}, no independent report (${pts.evidence} of 25).`;
  out.push(weakest && weakest.k !== 'evidence' && weakest.frac < 0.5
    ? `${evText.replace(/\.$/, '')}; weakest part is ${weakest.k} (${pts[weakest.k]} of ${W[weakest.k]}).`
    : evText);
  const sig = b.signals || {};
  const pw = [sig.testable && 'you can test it', sig.challenges && 'it challenges a claim', sig.process && 'it changes a process', sig.numbers && 'it has checkable numbers'].filter(Boolean);
  out.push(pw.length ? `Worth a post: ${listJoin(pw)}.` : (b.impact_hits?.length ? `Mentions ${listJoin(mapSignals(b.impact_hits).slice(0, 3))}; no post-worthy signals.` : 'No post-worthy signals found.'));
  return out;
}
