// Daily workflow with explicit, re-runnable stages: collect → cluster → rank → brief → draft.
// Idempotent per date: articles are unique by URL, briefs by date, the auto draft by auto_key.
import { all, get, run, now, tx, getSettings, cacheGet, cacheSet, parse, hydrate } from './db.js';
import { connectorFor, fetchArticle } from './connectors/index.js';
import { tokens, jaccard, sentences, hasNumber, termHits, domainOf, wordCount, readingMinutes, truncate, entities } from './text.js';
import { sourceCounts, cleanClaim, numberMarks, markedText } from './finding.js';
import { WEIGHTS, BREAKDOWN_VERSION, scoreFrom, r1, r2, r3 } from './score.js';
import { getProvider } from './ai/index.js';
import { loadStory, loadEmployers, createDraft, storyPreferences } from './store.js';
import { generateVisual } from './visual.js';
import { deliverBrief } from './delivery.js';

export const STAGES = ['collect', 'cluster', 'rank', 'brief', 'draft'];
const running = new Set();

export const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ---------- intake ----------
export function ingestItem(item, source, { demo = false } = {}) {
  const url = item.url.split('#')[0];
  const exists = get('SELECT id FROM articles WHERE url = ?', url);
  if (exists) return { id: exists.id, created: false };
  const r = run(`INSERT INTO articles(source_id, url, domain, title, summary, content, author, image_url, published_at, fetched_at, evidence_kind, engagement_json, is_demo)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, source?.id ?? null, url, domainOf(url), item.title, item.summary || '', item.content || '', item.author || '',
    item.image_url || null, item.published_at || null, item.fetched_at || now(), item.evidence_kind || source?.evidence_kind || 'reporting',
    item.engagement ? JSON.stringify(item.engagement) : null, demo ? 1 : 0);
  return { id: Number(r.lastInsertRowid), created: true };
}

export async function submitUrl(url, evidenceKind) {
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('URL must start with http:// or https://'), { status: 400 });
  let manual = get("SELECT * FROM sources WHERE kind = 'manual'");
  if (!manual) {
    run("INSERT INTO sources(name, kind, url, grp, evidence_kind) VALUES('Manual submissions', 'manual', 'manual://', 'Manual', 'reporting')");
    manual = get("SELECT * FROM sources WHERE kind = 'manual'");
  }
  let item;
  try { item = await fetchArticle(url); }
  catch (e) { throw Object.assign(new Error(`Could not fetch that page (${e.message}). Check the URL or your network.`), { status: 502 }); }
  const res = ingestItem({ ...item, evidence_kind: evidenceKind || 'reporting' }, manual);
  run('UPDATE sources SET last_sync_at = ?, last_error = NULL WHERE id = ?', now(), manual.id);
  clusterArticles();
  rankStories();
  const art = get('SELECT story_id FROM articles WHERE id = ?', res.id);
  return { article_id: res.id, created: res.created, story_id: art?.story_id };
}

// ---------- stages ----------
async function stageCollect(ctx) {
  const sources = all("SELECT * FROM sources WHERE paused = 0 AND kind != 'manual'");
  const detail = { sources: 0, collected: 0, new: 0, duplicates: 0, failed: [], skipped: [], cached: 0 };
  for (const s of sources) {
    const conn = connectorFor(s.kind);
    const st = conn.status(s);
    if (!st.ready) { detail.skipped.push({ source: s.name, reason: st.reason }); run('UPDATE sources SET last_error = ? WHERE id = ?', st.reason, s.id); continue; }
    if (s.is_demo) { detail.skipped.push({ source: s.name, reason: 'Demo source (sample data, not polled)' }); continue; }
    detail.sources++;
    const key = `collect:${s.id}:${ctx.date}`;
    try {
      let items = cacheGet(key, 6);
      if (items) detail.cached++;
      else { items = await conn.collect(s, { isKnown: (u) => !!get('SELECT 1 FROM articles WHERE url = ?', u) }); cacheSet(key, items); }
      let n = 0;
      for (const it of items.slice(0, 60)) {
        const r = ingestItem(it, s);
        detail.collected++; r.created ? (detail.new++, n++) : detail.duplicates++;
      }
      run('UPDATE sources SET last_sync_at = ?, last_error = NULL, last_count = ? WHERE id = ?', now(), n, s.id);
    } catch (e) {
      detail.failed.push({ source: s.name, error: e.message });
      run('UPDATE sources SET last_error = ? WHERE id = ?', e.message, s.id);
    }
  }
  return detail;
}

function stageCluster() { return clusterArticles(); }

const stem = (toks) => toks.map(t => t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
const properToks = (text) => new Set(entities(text).flatMap(e => e.toLowerCase().split(/[ \-]/)).filter(t => t.length > 2 && !['the', 'and', 'new', 'how', 'why'].includes(t)));

/** Same-event test: strong title overlap, or similar body text plus a shared proper name. */
function similarity(a, st) {
  const tA = new Set(stem(tokens(a.title)));
  const inter = [...tA].filter(t => st.title.has(t)).length;
  const ov = inter / Math.max(1, Math.min(tA.size, st.title.size));
  const bj = jaccard(stem(tokens(`${a.title} ${truncate(a.summary || '', 240)}`)), [...st.body]);
  const sharedProper = [...properToks(`${a.title} ${a.summary || ''}`)].filter(t => st.proper.has(t)).length;
  const match = (inter >= 3 && ov >= 0.45) || (bj >= 0.12 && sharedProper >= 1) || (bj >= 0.08 && sharedProper >= 2);
  return match ? ov + bj : 0;
}

export function clusterArticles() {
  const pending = all('SELECT * FROM articles WHERE story_id IS NULL ORDER BY COALESCE(published_at, fetched_at)');
  const recent = all("SELECT s.id FROM stories s WHERE s.status != 'archived' AND s.updated_at >= ?", new Date(Date.now() - 10 * 864e5).toISOString());
  const profiles = new Map();
  const addTo = (p, a) => {
    stem(tokens(a.title)).forEach(t => p.title.add(t));
    stem(tokens(`${a.title} ${truncate(a.summary || '', 240)}`)).forEach(t => p.body.add(t));
    properToks(`${a.title} ${a.summary || ''}`).forEach(t => p.proper.add(t));
  };
  const newProfile = () => ({ title: new Set(), body: new Set(), proper: new Set() });
  for (const s of recent) {
    const p = newProfile();
    for (const a of all('SELECT title, summary FROM articles WHERE story_id = ?', s.id)) addTo(p, a);
    profiles.set(s.id, p);
  }
  let created = 0, merged = 0;
  tx(() => {
    for (const a of pending) {
      let best = null, bestScore = 0;
      for (const [sid, p] of profiles) { const sc = similarity(a, p); if (sc > bestScore) { bestScore = sc; best = sid; } }
      let sid;
      if (best) { sid = best; merged++; run('UPDATE stories SET updated_at = MAX(updated_at, ?) WHERE id = ?', a.fetched_at || now(), sid); }
      else {
        const r = run('INSERT INTO stories(title, summary, first_seen, updated_at, is_demo) VALUES(?,?,?,?,?)', a.title, truncate(a.summary || '', 400), a.published_at || a.fetched_at || now(), a.fetched_at || now(), a.is_demo);
        sid = Number(r.lastInsertRowid); created++;
        profiles.set(sid, newProfile());
      }
      addTo(profiles.get(sid), a);
      run('UPDATE articles SET story_id = ? WHERE id = ?', sid, a.id);
      extractClaims(sid, a);
      refreshStoryMeta(sid);
    }
  });
  return { articles: pending.length, new_stories: created, merged };
}

const CLAIM_VERB = /\b(announc\w*|launch\w*|releas\w*|introduc\w*|report\w*|found|finds|show\w*|according|available|pric\w*|cost\w*|reduc\w*|increas\w*|improv\w*|outperform\w*|achiev\w*|support\w*|partner\w*|acquir\w*|rais\w*)\b/i;

function extractClaims(storyId, a) {
  const text = `${a.summary || ''} ${(a.content || '').slice(0, 3000)}`;
  const cands = sentences(text).filter(s => hasNumber(s) || CLAIM_VERB.test(s))
    .map(s => ({ s, score: (hasNumber(s) ? 2 : 0) + (CLAIM_VERB.test(s) ? 1 : 0) - (s.length > 260 ? 1 : 0) }))
    .sort((x, y) => y.score - x.score).slice(0, 3);
  const existing = all('SELECT text FROM claims WHERE story_id = ?', storyId).map(c => tokens(c.text));
  for (const { s } of cands) {
    const t = tokens(s);
    if (existing.some(e => jaccard(e, t) > 0.7)) continue;
    existing.push(t);
    run('INSERT OR IGNORE INTO claims(story_id, article_id, text, evidence_kind, has_number) VALUES(?,?,?,?,?)', storyId, a.id, s, a.evidence_kind, hasNumber(s) ? 1 : 0);
  }
}

function refreshStoryMeta(storyId) {
  const s = getSettings();
  const arts = all('SELECT * FROM articles WHERE story_id = ? ORDER BY COALESCE(published_at, fetched_at)', storyId);
  const text = arts.map(a => `${a.title} ${a.summary || ''} ${(a.content || '').slice(0, 1500)}`).join(' ');
  const topics = s.priorities.filter(p => p.weight > 0).map(p => ({ t: p.topic, n: termHits(text, p.terms).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).map(x => x.t).slice(0, 4);
  const companies = loadEmployers().filter(e => termHits(text, [e.name, ...(e.terms || []).filter(t => /^[A-Z]/.test(t))]).length).map(e => e.name);
  const origin = arts.find(a => a.evidence_kind === 'announcement') || arts.find(a => a.evidence_kind === 'research') || arts[0];
  run('UPDATE stories SET title = ?, summary = ?, topics = ?, companies = ? WHERE id = ?', origin.title, truncate(origin.summary || '', 400), JSON.stringify(topics), JSON.stringify(companies), storyId);
}

// Credibility order from the user: official & research > independent reporting > X/newsletters > community > applied.
export const CREDIBLE = new Set(['announcement', 'research', 'reporting']);
const TESTABLE = ['open source', 'open-source', 'api', 'sdk', 'github', 'dataset', 'available', 'free tier', 'benchmark'];
const CHALLENGE = ['contradicts', 'debunk', 'fails', 'failed', 'smaller than', 'overstated', 'needs context', 'mixed results', 'replicate', 'could not reproduce'];
const PROCESS = ['workflow', 'process', 'approval step', 'hand-off', 'review time', 'cycle time', 'operations'];
const IMPACT = ['pricing', 'price', 'available', 'general availability', 'ga', 'open source', 'open-source', 'api', 'enterprise', 'customers', 'cost', 'costs', 'benchmark', 'regulation', 'deadline', 'release', 'launch', 'production', 'sdk', 'framework', 'standard'];

export { WEIGHTS, BREAKDOWN_VERSION, scoreFrom } from './score.js';

/** First sentence of the story text that contains one of the terms (for "Why it's post-worthy" quotes). */
function quoteFor(sents, test) {
  const hit = sents.find(test);
  return hit ? truncate(hit.replace(/\s+([.,;:!?])/g, '$1'), 220) : null;
}

export function rankStories({ days = 7, asOf = Date.now() } = {}) {
  const s = getSettings();
  const prefs = storyPreferences();
  const watch = all('SELECT * FROM watchlists').map(hydrate);
  const employers = loadEmployers();
  const stories = all("SELECT * FROM stories WHERE status != 'archived' AND updated_at >= ?", new Date(asOf - days * 864e5).toISOString()).map(hydrate);
  const seen = all('SELECT id, title, first_seen FROM stories WHERE last_viewed_at IS NOT NULL AND updated_at >= ?', new Date(asOf - 30 * 864e5).toISOString());
  const positive = s.priorities.filter(p => p.weight > 0).sort((a, b) => b.weight - a.weight);
  const prioRank = new Map(positive.map((p, i) => [p.topic, i + 1]));
  for (const st of stories) {
    const arts = all('SELECT a.*, src.name AS source_name FROM articles a LEFT JOIN sources src ON src.id = a.source_id WHERE a.story_id = ?', st.id);
    if (!arts.length) continue;
    const text = arts.map(a => `${a.title} ${a.summary || ''} ${(a.content || '').slice(0, 1500)}`).join(' ');
    const sents = sentences(arts.map(a => `${a.summary || ''} ${(a.content || '').slice(0, 1500)}`).join(' '));
    const why = [], muted = [], priorities = [];
    let interest = 0, penalty = 1;
    for (const p of s.priorities) {
      const hits = termHits(text, p.terms);
      if (!hits.length) continue;
      if (p.weight < 0) penalty *= Math.max(0.3, 1 + p.weight * 0.15 * Math.min(hits.length, 2)); // de-emphasis scales the whole score
      else interest += p.weight * Math.min(hits.length, 3);
      priorities.push({ topic: p.topic.replace(/^De-emphasize: /, ''), weight: p.weight, hits, rank: prioRank.get(p.topic) ?? null, de_emphasis: p.weight < 0 });
      (p.weight < 0 ? muted : why).push(`${p.topic.replace(/^De-emphasize: /, '')} (${hits.slice(0, 3).join(', ')})`);
    }
    const watchHits = [], watchTerms = [];
    for (const w of watch) {
      const h = termHits(text, [w.name, ...w.terms]);
      if (h.length) { interest += 1.5 * w.weight * (w.pinned ? 1.5 : 1); watchHits.push(w.name); watchTerms.push({ name: w.name, kind: w.kind, pinned: !!w.pinned, weight: w.weight, terms: h }); }
    }
    const empMatches = employers.filter(e => termHits(text, [e.name]).length);
    const empHits = empMatches.map(e => e.name);
    interest += empMatches.reduce((m, e) => m + (e.pinned ? 1.5 : 0.5), 0); // pinned = big-push employers
    const interestN = Math.max(0, Math.min(1, interest / 9));

    const toks = tokens(st.title + ' ' + (st.summary || ''));
    const prior = seen.filter(x => x.id !== st.id && x.first_seen < st.first_seen);
    let maxSim = 0, similarTo = null;
    for (const x of prior) { const j = jaccard(toks, tokens(x.title)); if (j > maxSim) { maxSim = j; similarTo = x; } }
    const novelty = 1 - Math.min(1, maxSim * 1.4);

    const domains = new Set(arts.map(a => a.domain));
    const credibleDomains = new Set(arts.filter(a => CREDIBLE.has(a.evidence_kind)).map(a => a.domain));
    const kinds = new Set(arts.map(a => a.evidence_kind));
    let evidence = Math.min(1, credibleDomains.size / 3) * 0.6 + (kinds.has('announcement') ? 0.2 : 0) + (kinds.has('research') ? 0.2 : 0)
      + (kinds.has('reporting') && credibleDomains.size > 1 ? 0.1 : 0) + (kinds.has('commentary') ? 0.03 : 0) + (kinds.has('community') || kinds.has('application') ? 0.03 : 0);
    if (!credibleDomains.size) evidence -= 0.15;
    evidence = Math.max(0, Math.min(1, evidence));
    const counts = sourceCounts(arts);

    const impactHits = termHits(text, IMPACT);
    const signalHits = { testable: termHits(text, TESTABLE), challenges: termHits(text, CHALLENGE), process: termHits(text, PROCESS) };
    const signals = { testable: signalHits.testable.length > 0, challenges: signalHits.challenges.length > 0, process: signalHits.process.length > 0, numbers: /\d+(\.\d+)?\s?%/.test(text) };
    const impact = Math.min(1, impactHits.length / 5 + Object.values(signals).filter(Boolean).length * 0.12);
    const signalQuotes = {
      testable: signals.testable ? quoteFor(sents, x => termHits(x, signalHits.testable).length > 0) : null,
      challenges: signals.challenges ? quoteFor(sents, x => termHits(x, signalHits.challenges).length > 0) : null,
      process: signals.process ? quoteFor(sents, x => termHits(x, signalHits.process).length > 0) : null,
      numbers: signals.numbers ? quoteFor(sents, x => /\d+(\.\d+)?\s?%/.test(x)) : null
    };
    const claimRows = all('SELECT text FROM claims WHERE story_id = ?', st.id);
    const numbersFound = [...new Set(claimRows.flatMap(c => { const t = cleanClaim(c.text); return markedText(t, numberMarks(t)); }))].slice(0, 8);

    const newest = Math.max(...arts.map(a => Date.parse(a.published_at || a.fetched_at) || 0));
    const hours = Math.max(0, (asOf - newest) / 36e5);
    const recency = Math.max(0.35, Math.exp(-hours / 96));

    const topicPref = (st.topics || []).reduce((m, t) => m + (prefs.topic[t] || 0), 0) / Math.max(1, (st.topics || []).length);
    const srcPref = arts.reduce((m, a) => Math.min(m, 1 + (prefs.source[a.source_id] || 0)), 1);

    // Store first, then score from exactly the stored numbers.
    const b = { interest: r3(interestN), novelty: r3(novelty), evidence: r3(evidence), impact: r3(impact), recency: r2(recency), feedback: r2(topicPref), source_pref: r2(srcPref), penalty: r2(penalty) };
    const { points, base, score } = scoreFrom(b);

    const engagement = arts.reduce((acc, a) => { const e = parse(a.engagement_json, null); if (e) for (const [k, v] of Object.entries(e)) acc[k] = (acc[k] || 0) + v; return acc; }, {});
    const srcPhrase = `${counts.posts} post${counts.posts === 1 ? '' : 's'} from ${counts.outlets} outlet${counts.outlets === 1 ? '' : 's'} (${[
      counts.first_party ? `${counts.first_party} first-party` : null, counts.primary ? `${counts.primary} primary research/report` : null,
      `${counts.independent} independent`, counts.commentary ? `${counts.commentary} commentary/community` : null].filter(Boolean).join(', ')})`;
    const explanation = [
      why.length ? `Matches ${why.slice(0, 2).join('; ')}` : 'Weak match to your priorities',
      watchHits.length ? `watchlist: ${watchHits.slice(0, 3).join(', ')}` : null,
      srcPhrase,
      impactHits.length ? `practical signals: ${impactHits.slice(0, 3).join(', ')}` : null,
      Object.entries(signals).some(([, v]) => v) ? `post-worthy: ${Object.entries(signals).filter(([, v]) => v).map(([k]) => ({ testable: 'testable', challenges: 'challenges a claim', process: 'changes a process', numbers: 'checkable numbers' })[k]).join(', ')}` : null,
      muted.length ? `de-emphasized (×${b.penalty.toFixed(2)}): ${muted.join('; ')}` : null,
      novelty < 0.5 ? 'similar to stories you have seen' : null,
      b.feedback ? `feedback adjustment ${b.feedback > 0 ? '+' : ''}${Math.round(b.feedback * 100)}%` : null
    ].filter(Boolean).join(' · ');
    run('UPDATE stories SET score = ?, breakdown_json = ?, explanation = ? WHERE id = ?', score, JSON.stringify({
      version: BREAKDOWN_VERSION, ...b, weights: WEIGHTS, points, base, score,
      newest_hours: r1(hours), ranked_at: new Date(asOf).toISOString(),
      interest_raw: r2(interest), interest_cap: 9,
      priorities, watch: watchHits, watch_terms: watchTerms,
      employers: empHits, employer_hits: empMatches.map(e => ({ name: e.name, pinned: !!e.pinned })),
      impact_hits: impactHits, signals, signal_hits: signalHits, signal_quotes: signalQuotes, numbers_found: numbersFound,
      similar_to: maxSim >= 0.15 && similarTo ? { id: similarTo.id, title: similarTo.title, similarity: r2(maxSim) } : null,
      // legacy fields (v3 UI): credible outlets incl. first-party, and all outlets
      sources: credibleDomains.size, all_sources: domains.size,
      source_counts: counts, engagement
    }), explanation, st.id);
  }
  return { ranked: stories.length };
}

/** Time of the last pipeline rank (latest rank stage or article intake), for re-ranking without silently ageing scores. */
export function lastRankTime() {
  const stage = get("SELECT MAX(finished_at) AS t FROM run_stages WHERE stage = 'rank' AND status = 'done'")?.t;
  const intake = get('SELECT MAX(fetched_at) AS t FROM articles')?.t;
  const t = Math.max(Date.parse(stage || '') || 0, Date.parse(intake || '') || 0);
  return t || Date.now();
}

async function stageBrief(ctx) {
  const s = getSettings();
  const end = new Date(`${ctx.date}T23:59:59Z`).getTime() + 864e5;
  const startWin = end - 4 * 864e5;
  const cands = all("SELECT id, score FROM stories WHERE status != 'archived' AND updated_at <= ? AND updated_at >= ? ORDER BY score DESC LIMIT ?",
    new Date(end).toISOString(), new Date(startWin).toISOString(), s.brief_size);
  const ai = getProvider(ctx.runId);
  const items = [];
  let words = 0;
  for (const c of cands) {
    const { story, articles, claims } = loadStory(c.id);
    // Re-summarize only when the story's sources change (saves paid calls on reruns).
    const sumKey = `summary:${ai.name}:${story.id}:${articles.map(a => a.id).join(',')}`;
    let summary = cacheGet(sumKey, 24 * 30);
    if (!summary) { summary = await ai.summarize({ story, articles, claims }); cacheSet(sumKey, summary); }
    let lens = story.lens_json ? parse(story.lens_json, null) : story.lens;
    if (!lens) { lens = await ai.careerLens({ story, articles, claims, settings: s }); run('UPDATE stories SET lens_json = ? WHERE id = ?', JSON.stringify(lens), story.id); }
    run('UPDATE stories SET summary = ? WHERE id = ?', summary, story.id);
    words += wordCount(summary) + articles.reduce((m, a) => m + wordCount(a.summary || ''), 0);
    items.push({ story_id: story.id, title: story.title, summary, score: story.score, explanation: story.explanation, topics: story.topics, sources: articles.length, domains: [...new Set(articles.map(a => a.domain))], qualifies: story.score >= s.publish_threshold, is_demo: !!story.is_demo });
  }
  const quiet = !items.some(i => i.qualifies);
  const summary = items.length
    ? `${items.length} stor${items.length === 1 ? 'y' : 'ies'} worth your time. ${quiet ? `None met the publishing threshold (${s.publish_threshold}).` : `Top pick: ${items[0].title}.`}`
    : 'Nothing new was collected for this date.';
  const existing = get('SELECT id FROM briefs WHERE run_date = ?', ctx.date);
  if (existing) run('UPDATE briefs SET run_id = ?, summary = ?, items_json = ?, quiet = ?, reading_minutes = ?, updated_at = ? WHERE id = ?', ctx.runId, summary, JSON.stringify(items), quiet ? 1 : 0, readingMinutes(words), now(), existing.id);
  else run('INSERT INTO briefs(run_date, run_id, summary, items_json, quiet, reading_minutes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', ctx.date, ctx.runId, summary, JSON.stringify(items), quiet ? 1 : 0, readingMinutes(words), now(), now());
  return { items: items.length, quiet };
}

async function stageDraft(ctx) {
  const brief = get('SELECT * FROM briefs WHERE run_date = ?', ctx.date);
  if (!brief) throw new Error('No brief for this date — run the brief stage first.');
  if (brief.quiet) return { created: false, reason: 'Quiet day: no story met the publishing threshold.' };
  const autoKey = `daily:${ctx.date}:linkedin`;
  const existing = get('SELECT id FROM drafts WHERE auto_key = ?', autoKey);
  if (existing) { run('UPDATE briefs SET draft_id = ? WHERE id = ?', existing.id, brief.id); return { created: false, draft_id: existing.id, reason: 'Draft for this date already exists (kept as-is).' }; }
  const items = parse(brief.items_json, []).filter(i => i.qualifies);
  const top = items[0];
  const { story, articles, claims } = loadStory(top.story_id);
  const ai = getProvider(ctx.runId);
  const s = getSettings();
  // Roundup when two qualifying stories share a topic (a meaningful connection), otherwise a short post.
  const linked = items.slice(1).find(i => (i.topics || []).some(t => (top.topics || []).includes(t)));
  const format = linked ? 'roundup' : 'long';
  const linkedData = linked ? loadStory(linked.story_id) : null;
  const others = linkedData ? [linkedData.story] : [];
  const sections = await ai.draft({ story, stories: others, articles: linkedData ? [...articles, ...linkedData.articles] : articles, claims, format, angle: 'tradeoff', notes: [], experiences: [], profile: s.writing_profile, channel: 'linkedin' });
  const visual = generateVisual(story, claims, articles);
  const id = createDraft({ auto_key: autoKey, story_id: story.id, channel: 'linkedin', format, angle: 'tradeoff', title: story.title, sections, image_id: visual.id,
    source_ids: articles.map(a => a.id), meta: { linked_story_ids: others.map(o => o.id), visual_kind: visual.kind, generated_by: ai.name } });
  run('UPDATE briefs SET draft_id = ? WHERE id = ?', id, brief.id);
  return { created: true, draft_id: id, format };
}

const STAGE_FNS = { collect: stageCollect, cluster: stageCluster, rank: () => rankStories(), brief: stageBrief, draft: stageDraft };

/**
 * Run (or resume) the daily workflow for a date.
 * - fromStage: start from this stage (reruns it and everything after)
 * - runId: resume an existing run; defaults to the first failed stage
 */
export async function runDaily({ date, trigger = 'manual', fromStage = null, runId = null } = {}) {
  const s = getSettings();
  date ||= todayIn(s.timezone);
  if (running.has(date)) throw Object.assign(new Error(`A run for ${date} is already in progress.`), { status: 409 });
  running.add(date);
  try {
    if (runId && !fromStage) {
      const failed = get("SELECT stage FROM run_stages WHERE run_id = ? AND status = 'failed' ORDER BY id LIMIT 1", runId);
      fromStage = failed?.stage || 'collect';
    }
    if (!runId) runId = Number(run('INSERT INTO runs(run_date, trigger, status, started_at) VALUES(?,?,?,?)', date, trigger, 'running', now()).lastInsertRowid);
    else run("UPDATE runs SET status = 'running', error = NULL, finished_at = NULL WHERE id = ?", runId);
    const ctx = { date, runId };
    const stats = parse(get('SELECT stats_json FROM runs WHERE id = ?', runId).stats_json, {});
    const startIdx = Math.max(0, STAGES.indexOf(fromStage || 'collect'));
    for (const stage of STAGES.slice(startIdx)) {
      const sid = Number(run('INSERT INTO run_stages(run_id, stage, status, started_at) VALUES(?,?,?,?)', runId, stage, 'running', now()).lastInsertRowid);
      try {
        const detail = await STAGE_FNS[stage](ctx);
        stats[stage] = detail;
        run("UPDATE run_stages SET status = 'done', finished_at = ?, detail_json = ? WHERE id = ?", now(), JSON.stringify(detail), sid);
      } catch (e) {
        run("UPDATE run_stages SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", now(), e.message, sid);
        run("UPDATE runs SET status = 'failed', finished_at = ?, error = ?, stats_json = ? WHERE id = ?", now(), `${stage}: ${e.message}`, JSON.stringify(stats), runId);
        return { run_id: runId, status: 'failed', failed_stage: stage, error: e.message };
      }
    }
    // Post-run extras: never fail the run, but record what happened.
    try { stats.delivery = await deliverBrief(date); } catch (e) { stats.delivery = { error: e.message }; }
    // Pre-render the audio briefing in the background so "Listen" starts instantly (skipped if Kokoro isn't installed).
    import('./tts.js').then(async ({ speak, chunk, ttsStatus }) => {
      if (!(await ttsStatus()).installed) return;
      const { briefScript } = await import('./delivery.js');
      for (const c of chunk(briefScript(date) || '')) await speak(c, getSettings().tts_voice || undefined).catch(() => {});
    }).catch(() => {});
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    if (weekday === (s.schedule?.weekly_roundup_day || 'Fri')) {
      try { stats.weekly = await weeklyRoundup(date); } catch (e) { stats.weekly = { error: e.message }; }
    }
    const cost = get('SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE run_id = ?', runId).c;
    run("UPDATE runs SET status = 'done', finished_at = ?, stats_json = ?, cost_usd = ? WHERE id = ?", now(), JSON.stringify(stats), cost, runId);
    return { run_id: runId, status: 'done', stats };
  } finally {
    running.delete(date);
  }
}

const isoWeek = (date) => {
  const d = new Date(`${date}T12:00:00Z`); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};

/** Weekly roundup of the strongest stories from the 7 days ending on `date`. Idempotent per ISO week. */
export async function weeklyRoundup(date) {
  const s = getSettings();
  const key = `weekly:${isoWeek(date)}:linkedin`;
  const existing = get('SELECT id FROM drafts WHERE auto_key = ?', key);
  if (existing) return { created: false, draft_id: existing.id, reason: 'Roundup for this week already exists.' };
  const end = new Date(`${date}T23:59:59Z`).getTime() + 864e5;
  const top = all("SELECT id FROM stories WHERE status != 'archived' AND updated_at <= ? AND updated_at >= ? ORDER BY score DESC LIMIT 4",
    new Date(end).toISOString(), new Date(end - 8 * 864e5).toISOString());
  if (top.length < 2) return { created: false, reason: 'Fewer than two stories this week.' };
  const loaded = top.map(t => loadStory(t.id));
  const [main, ...rest] = loaded;
  const articles = loaded.flatMap(l => l.articles), claims = loaded.flatMap(l => l.claims);
  const ai = getProvider();
  const sections = await ai.draft({ story: main.story, stories: rest.map(r => r.story), articles, claims, format: 'roundup', angle: 'process', notes: [], experiences: [], profile: s.writing_profile, channel: 'linkedin' });
  const visual = generateVisual(main.story, main.claims, main.articles);
  const id = createDraft({ auto_key: key, story_id: main.story.id, channel: 'linkedin', format: 'roundup', angle: 'process', title: `Weekly roundup · ${isoWeek(date)}`, sections, image_id: visual.id,
    source_ids: articles.map(a => a.id), meta: { linked_story_ids: rest.map(r => r.story.id), weekly: isoWeek(date), generated_by: ai.name } });
  return { created: true, draft_id: id, stories: loaded.length };
}

/** Evergreen draft from a saved topic on quiet days. */
export async function evergreenDraft(storyId) {
  const { story, articles, claims } = loadStory(storyId);
  const ai = getProvider();
  const sections = await ai.draft({ story, articles, claims, format: 'long', angle: 'process', notes: [], experiences: [], profile: getSettings().writing_profile, channel: 'linkedin' });
  const visual = generateVisual(story, claims, articles);
  return createDraft({ story_id: story.id, channel: 'linkedin', format: 'long', angle: 'process', title: `Evergreen: ${story.title}`, sections, image_id: visual.id, source_ids: articles.map(a => a.id), meta: { evergreen: true } });
}
