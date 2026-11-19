import { all, get, run, now, hydrate, parse, getSettings, setSetting } from '../db.js';
import { connectors, connectorFor } from '../connectors/index.js';
import { weeklyRoundup } from '../pipeline.js';
import { deliverBrief, deliveryStatus, digestHtml } from '../delivery.js';
import { icsFeed, icsToken } from '../ics.js';
import { ollamaStatus } from '../ai/ollama.js';
import { ttsStatus, speak, chunk, VOICE } from '../tts.js';
import { briefScript } from '../delivery.js';
import { runDaily, submitUrl, ingestItem, clusterArticles, rankStories, evergreenDraft, todayIn, STAGES } from '../pipeline.js';
import { loadStory, loadEmployers, storyPreferences, createDraft } from '../store.js';
import { getProvider, providerStatus } from '../ai/index.js';
import { publishers } from '../publishers/index.js';
import { generateVisual } from '../visual.js';
import { loadDemo, clearDemo } from '../demo.js';
import { enrich, storyFacts, mainTopic, topicWeights, whyRanked } from '../facts.js';
import { breakdownView, evidenceGroups, lensView, articlesView, sourcesHeader } from '../dossier.js';
import { sourceCounts, cleanClaim, numberMarks, shortTitle } from '../finding.js';
import { timeLocal, dateLocal, dayLabel, tzAbbr } from '../timefmt.js';

/** Summary of a run for the status pill and Runs tab (times in settings.timezone). */
export function runSummary(r, tz) {
  if (!r) return null;
  const st = parse(r.stats_json, {}) || {};
  const failedStage = get("SELECT stage FROM run_stages WHERE run_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1", r.id)?.stage
    || (r.status === 'failed' && r.error ? String(r.error).split(':')[0] : null);
  const at = r.finished_at || r.started_at;
  return {
    id: r.id, run_date: r.run_date, trigger: r.trigger, status: r.status, started_at: r.started_at, finished_at: r.finished_at,
    time_local: timeLocal(at, tz), date_local: dateLocal(at, tz), timezone: tz, timezone_abbr: tzAbbr(tz, at ? new Date(at) : new Date()),
    sources_read: st.collect?.sources ?? null, sources_failed: st.collect?.failed?.length ?? null, sources_skipped: st.collect?.skipped?.length ?? null,
    new_articles: st.collect?.new ?? null, ranked: st.rank?.ranked ?? null, brief_items: st.brief?.items ?? null,
    failed_stage: failedStage, error: r.error || null, cost_usd: r.cost_usd ?? 0
  };
}

/** The 7-day window every view counts the same way: ranked, cleared, weighted topic counts, headline topic. */
export function windowCounts(s = getSettings(), days = 7) {
  const T = s.publish_threshold;
  const weights = Object.fromEntries(s.priorities.map(p => [p.topic, p.weight]));
  const rows = all("SELECT id, title, score, topics FROM stories WHERE status != 'archived' AND updated_at >= ? ORDER BY score DESC", new Date(Date.now() - days * 864e5).toISOString()).map(hydrate);
  const cleared = rows.filter(r => r.score >= T);
  const tally = {};
  for (const r of cleared) for (const t of r.topics) tally[t] = (tally[t] || 0) + 1;
  const topic_counts = Object.entries(tally).map(([topic, count]) => ({ topic, count, weight: weights[topic] ?? 1, weighted: Math.round(count * (weights[topic] ?? 1) * 100) / 100, share: cleared.length ? Math.round((count / cleared.length) * 1000) / 1000 : 0, eligible: (weights[topic] ?? 1) > 1 }))
    .sort((a, b) => b.weighted - a.weighted || b.count - a.count || a.topic.localeCompare(b.topic));
  const eligible = topic_counts.filter(t => t.eligible);
  const pick = eligible.length ? eligible : topic_counts;
  return { threshold: T, window_days: days, ranked: rows.length, cleared: cleared.length, below: rows.length - cleared.length, topic_counts,
    headline_topic: pick[0]?.topic || null, second_topic: pick[1]?.topic || null, cleared_ids: cleared.map(r => r.id) };
}

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const need = (v, msg) => { if (v === undefined || v === null || v === '') throw bad(msg); return v; };

/**
 * Source health (F §2): paused = paused; error = has last_error; stale = never synced or no sync in 48 h; ok otherwise.
 * Precedence: paused > error > stale > ok. `health_unpaused` is what it would be if un-paused.
 */
export function sourceHealth(src, nowMs = Date.now()) {
  const synced = Date.parse(src.last_sync_at || '') || 0;
  const underlying = src.last_error ? 'error' : (!synced || nowMs - synced >= 48 * 3600e3) ? 'stale' : 'ok';
  return { health: src.paused ? 'paused' : underlying, health_unpaused: underlying };
}

export function sourceRows() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  return all(`SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.source_id = s.id) AS article_count,
      (SELECT COUNT(*) FROM articles a WHERE a.source_id = s.id AND a.fetched_at >= ?) AS articles_7d,
      (SELECT COUNT(DISTINCT a.story_id) FROM articles a WHERE a.source_id = s.id AND a.story_id IS NOT NULL) AS stories_count,
      (SELECT MAX(COALESCE(a.published_at, a.fetched_at)) FROM articles a WHERE a.source_id = s.id) AS last_article_at
    FROM sources s ORDER BY grp, name`, since)
    .map(s => ({ ...s, paused: !!s.paused, is_demo: !!s.is_demo, ...sourceHealth(s), connector: connectorFor(s.kind).label, connector_status: connectorFor(s.kind).status(s) }));
}

export function sourceSummaryTotals(rows) {
  const by = (h) => rows.filter(r => r.health === h).length;
  const most = [...rows].sort((a, b) => b.stories_count - a.stories_count || b.article_count - a.article_count)[0];
  const mostA = [...rows].sort((a, b) => b.article_count - a.article_count || b.stories_count - a.stories_count)[0];
  return {
    sources: rows.length, ok: by('ok'), stale: by('stale'), error: by('error'), paused: by('paused'),
    all_paused: rows.length > 0 && rows.filter(r => r.kind !== 'manual').every(r => r.paused),
    with_error: rows.filter(r => r.last_error).length, demo: rows.filter(r => r.is_demo).length,
    articles_7d: rows.reduce((m, r) => m + r.articles_7d, 0), articles_total: rows.reduce((m, r) => m + r.article_count, 0),
    last_sync_at: rows.map(r => r.last_sync_at).filter(Boolean).sort().pop() || null,
    most_stories: most && most.stories_count ? { id: most.id, name: most.name, stories_count: most.stories_count } : null,
    most_articles: mostA && mostA.article_count ? { id: mostA.id, name: mostA.name, article_count: mostA.article_count } : null,
    unpaused_health: { ok: rows.filter(r => r.health_unpaused === 'ok').length, stale: rows.filter(r => r.health_unpaused === 'stale').length, error: rows.filter(r => r.health_unpaused === 'error').length }
  };
}

export function registerContent(route) {
  route('GET', '/api/status', () => {
    const s = getSettings();
    return {
      today: todayIn(s.timezone), timezone: s.timezone, threshold: s.publish_threshold, provider: providerStatus(),
      connectors: Object.fromEntries(Object.entries(connectors).map(([k, c]) => [k, { label: c.label, ...c.status({ url: 'x' }) }])),
      publishers: Object.fromEntries(Object.entries(publishers).map(([k, p]) => [k, p.status()])),
      counts: { ...get(`SELECT (SELECT COUNT(*) FROM stories) AS stories, (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM sources) AS sources,
        (SELECT COUNT(*) FROM drafts WHERE status IN ('draft','in_review')) AS awaiting, (SELECT COUNT(*) FROM articles WHERE is_demo = 1) AS demo_articles,
        (SELECT COUNT(*) FROM claims) AS claims, (SELECT COUNT(*) FROM drafts WHERE status NOT IN ('published','archived')) AS drafts_open,
        (SELECT COUNT(*) FROM notes) AS notes, (SELECT COUNT(*) FROM briefs) AS briefs, (SELECT COUNT(*) FROM sources WHERE paused = 1) AS sources_paused,
        (SELECT COUNT(*) FROM contacts) AS contacts`), schedule_enabled: !!s.schedule?.enabled },
      schedule: { enabled: !!s.schedule?.enabled, time: s.schedule?.time || null },
      last_run: runSummary(get('SELECT * FROM runs ORDER BY id DESC LIMIT 1'), s.timezone),
      issue: (() => { const b = get('SELECT run_date FROM briefs ORDER BY run_date DESC LIMIT 1'); return b ? { number: get('SELECT COUNT(*) AS n FROM briefs WHERE run_date <= ?', b.run_date).n, brief_date: b.run_date, date_label: dayLabel(b.run_date), is_today: b.run_date === todayIn(s.timezone) } : null; })(),
      timezone_abbr: tzAbbr(s.timezone),
      ffmpeg: true, delivery: deliveryStatus(), auth: !!process.env.BYLINE_PASSWORD, ics_path: `/api/calendar.ics?token=${icsToken()}`
    };
  });

  route('GET', '/api/settings', () => getSettings());
  route('GET', '/api/ollama', () => ollamaStatus());
  // ----- text-to-speech (Kokoro "Heart") -----
  route('GET', '/api/tts/status', () => ttsStatus());
  route('GET', '/api/briefs/:date/script', ({ params }) => {
    const text = briefScript(params.date);
    if (!text) throw bad('No brief for that date', 404);
    return { voice: getSettings().tts_voice || VOICE, chunks: chunk(text) };
  });
  route('POST', '/api/tts', async ({ body }) => {
    const text = String(body.text || '').trim();
    if (!text) throw bad('Text required');
    if (text.length > 600) throw bad('Send one sentence-sized chunk at a time (max 600 characters).');
    try { return { url: `/media/${await speak(text, body.voice || getSettings().tts_voice || VOICE)}` }; }
    catch (e) { throw bad(`Kokoro voice unavailable: ${e.message}`, 503); }
  });
  route('PUT', '/api/settings', ({ body }) => {
    for (const [k, v] of Object.entries(body)) setSetting(k, v);
    if (body.priorities) rankStories({ days: 30 });
    return getSettings();
  });

  // ----- sources -----
  route('GET', '/api/sources', () => sourceRows());
  route('GET', '/api/sources/summary', () => sourceSummaryTotals(sourceRows()));
  route('GET', '/api/sources/:id/articles', ({ params, query }) => {
    const src = get('SELECT id FROM sources WHERE id = ?', params.id);
    if (!src) throw bad('Source not found', 404);
    const limit = Math.max(1, Math.min(50, Number(query.limit || 5)));
    return all(`SELECT a.id, a.title, a.url, a.domain, a.evidence_kind, a.published_at, a.fetched_at, a.story_id, a.is_demo, st.title AS story_title, st.score AS story_score
      FROM articles a LEFT JOIN stories st ON st.id = a.story_id WHERE a.source_id = ? ORDER BY COALESCE(a.published_at, a.fetched_at) DESC, a.id DESC LIMIT ?`, params.id, limit)
      .map(a => ({ ...a, is_demo: !!a.is_demo }));
  });
  route('POST', '/api/sources', ({ body }) => {
    need(body.name, 'Name is required');
    if (body.kind !== 'x') need(body.url, 'Feed URL is required');
    if (body.kind !== 'x' && !/^https?:\/\//.test(body.url)) throw bad('Feed URL must start with http(s)://');
    const evidence = body.evidence_kind || ({ blog: 'announcement', docs: 'announcement', page: 'announcement', research: 'research', x: 'commentary', community: 'community', github: 'application' }[body.kind] || 'reporting');
    try {
      const r = run('INSERT INTO sources(name, kind, url, grp, evidence_kind, employer) VALUES(?,?,?,?,?,?)', body.name, body.kind || 'rss', body.url, body.grp || 'General', evidence, body.employer || null);
      return get('SELECT * FROM sources WHERE id = ?', Number(r.lastInsertRowid));
    } catch (e) { throw bad(/UNIQUE/.test(e.message) ? 'That source already exists.' : e.message); }
  });
  route('PATCH', '/api/sources/:id', ({ params, body }) => {
    const allowed = ['name', 'url', 'grp', 'paused', 'evidence_kind', 'employer'];
    for (const k of allowed) if (k in body) run(`UPDATE sources SET ${k} = ? WHERE id = ?`, typeof body[k] === 'boolean' ? Number(body[k]) : body[k], params.id);
    return get('SELECT * FROM sources WHERE id = ?', params.id);
  });
  route('DELETE', '/api/sources/:id', ({ params }) => { run('DELETE FROM sources WHERE id = ?', params.id); return { ok: true }; });
  route('POST', '/api/sources/:id/sync', async ({ params }) => {
    const s = get('SELECT * FROM sources WHERE id = ?', params.id);
    if (!s) throw bad('Source not found', 404);
    const c = connectorFor(s.kind); const st = c.status(s);
    if (!st.ready) { run('UPDATE sources SET last_error = ? WHERE id = ?', st.reason, s.id); throw bad(st.reason); }
    try {
      const items = await c.collect(s, { isKnown: (u) => !!get('SELECT 1 FROM articles WHERE url = ?', u) });
      let created = 0;
      for (const it of items.slice(0, 60)) if (ingestItem(it, s).created) created++;
      run('UPDATE sources SET last_sync_at = ?, last_error = NULL, last_count = ? WHERE id = ?', now(), created, s.id);
      const cl = clusterArticles(); rankStories();
      return { fetched: items.length, created, ...cl };
    } catch (e) { run('UPDATE sources SET last_error = ? WHERE id = ?', e.message, s.id); throw bad(`Sync failed: ${e.message}`, 502); }
  });

  route('POST', '/api/intake/url', ({ body }) => submitUrl(need(body.url, 'URL is required').trim(), body.evidence_kind));
  route('POST', '/api/intake/manual', ({ body }) => {
    // Paste-in fallback when a page cannot be fetched (paywall, offline).
    need(body.url, 'URL is required'); need(body.title, 'Title is required');
    let manual = get("SELECT * FROM sources WHERE kind = 'manual'");
    if (!manual) { run("INSERT INTO sources(name, kind, url, grp) VALUES('Manual submissions','manual','manual://','Manual')"); manual = get("SELECT * FROM sources WHERE kind = 'manual'"); }
    const r = ingestItem({ url: body.url, title: body.title, summary: body.text?.slice(0, 600), content: body.text, published_at: body.published_at || now(), evidence_kind: body.evidence_kind || 'reporting' }, manual);
    clusterArticles(); rankStories();
    return { article_id: r.id, story_id: get('SELECT story_id FROM articles WHERE id = ?', r.id).story_id };
  });

  // ----- stories -----
  route('GET', '/api/stories', ({ query }) => {
    const where = ["s.status != 'archived'"]; const p = [];
    if (query.status === 'archived') where[0] = "s.status = 'archived'";
    if (query.topic) { where.push('s.topics LIKE ?'); p.push(`%"${query.topic}"%`); }
    if (query.company) { where.push('s.companies LIKE ?'); p.push(`%"${query.company}"%`); }
    if (query.q) { where.push('(s.title LIKE ? OR s.summary LIKE ?)'); p.push(`%${query.q}%`, `%${query.q}%`); }
    if (query.days) { where.push('s.updated_at >= ?'); p.push(new Date(Date.now() - Number(query.days) * 864e5).toISOString()); }
    const rows = all(`SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.story_id = s.id) AS article_count,
      (SELECT COUNT(DISTINCT a.domain) FROM articles a WHERE a.story_id = s.id) AS domain_count,
      (SELECT COUNT(*) FROM articles a WHERE a.story_id = s.id AND s.last_viewed_at IS NOT NULL AND a.fetched_at > s.last_viewed_at) AS new_since_view,
      (SELECT GROUP_CONCAT(collection) FROM saved v WHERE v.story_id = s.id) AS collections
      FROM stories s WHERE ${where.join(' AND ')} ORDER BY s.score DESC, s.updated_at DESC LIMIT ?`, ...p, Number(query.limit || 60));
    const weights = topicWeights();
    return enrich(rows.map(hydrate)).map(r => ({ ...r, main_topic: mainTopic(r.topics, weights) }));
  });

  route('GET', '/api/stories/:id', async ({ params, query }) => {
    const data = loadStory(params.id);
    if (!data) throw bad('Story not found', 404);
    const { story } = data;
    const lastViewed = story.last_viewed_at;
    data.articles.forEach(a => { a.is_new = !!lastViewed && a.fetched_at > lastViewed; });
    data.origin = data.articles.find(a => a.evidence_kind === 'announcement') || data.articles.find(a => a.evidence_kind === 'research') || data.articles[0];
    data.saved = all('SELECT * FROM saved WHERE story_id = ?', story.id);
    data.feedback = all('SELECT kind, created_at FROM feedback WHERE story_id = ? ORDER BY id DESC', story.id);
    data.drafts = all('SELECT id, channel, format, status, title, updated_at FROM drafts WHERE story_id = ? ORDER BY id DESC', story.id);
    data.projects = all('SELECT id, title, status FROM projects WHERE story_id = ?', story.id);
    data.lens = parse(story.lens_json, null);
    if (!data.lens) {
      data.lens = await getProvider().careerLens({ ...data, settings: getSettings() });
      run('UPDATE stories SET lens_json = ? WHERE id = ?', JSON.stringify(data.lens), story.id);
    }
    data.employer_connections = await getProvider().employerConnections({ ...data, employers: loadEmployers() });
    data.story.prev_score = story.viewed_score ?? null;
    // ----- v4 dossier fields (docs/design/API-v4.md) -----
    const counts = sourceCounts(data.articles);
    Object.assign(data.story, storyFacts(story, data.articles, data.claims), { main_topic: mainTopic(story.topics), threshold: getSettings().publish_threshold });
    const av = articlesView(data.articles, data.claims);
    data.articles_raw = data.articles;
    data.articles = av.list;
    data.claim_duplicates = av.duplicates;
    data.domain_groups = av.domain_groups;
    data.sources_header = sourcesHeader(data.articles_raw, data.claims);
    data.claims = data.claims.map(c => { const t = cleanClaim(c.text); return { ...c, text_clean: t, marks: numberMarks(t) }; });
    data.breakdown = breakdownView(story, counts);
    data.breakdown.threshold = data.story.threshold;
    data.evidence = evidenceGroups(story);
    data.why_ranked = whyRanked(story, counts);
    data.lens_raw = data.lens;
    data.lens = lensView(data.lens);
    delete data.articles_raw;
    if (query.mark_viewed !== '0') run('UPDATE stories SET viewed_score = score WHERE id = ?', story.id);
    if (query.mark_viewed !== '0') run("UPDATE stories SET last_viewed_at = ?, status = CASE WHEN status = 'new' THEN 'seen' ELSE status END WHERE id = ?", now(), story.id);
    return data;
  });
  route('PATCH', '/api/stories/:id', ({ params, body }) => {
    if (body.status) run('UPDATE stories SET status = ? WHERE id = ?', body.status, params.id);
    return { ok: true };
  });
  route('POST', '/api/stories/:id/lens', async ({ params }) => {
    const data = loadStory(params.id);
    const lens = await getProvider().careerLens({ ...data, settings: getSettings() });
    run('UPDATE stories SET lens_json = ? WHERE id = ?', JSON.stringify(lens), params.id);
    return lens;
  });
  route('GET', '/api/stories/:id/angles', async ({ params }) => getProvider().angles(loadStory(params.id)));
  route('POST', '/api/stories/:id/feedback', ({ params, body }) => {
    if (!['useful', 'repetitive', 'low_quality', 'off_topic'].includes(body.kind)) throw bad('Unknown feedback kind');
    const st = loadStory(params.id);
    run('INSERT INTO feedback(story_id, kind, topics, source_ids, created_at) VALUES(?,?,?,?,?)', params.id, body.kind, JSON.stringify(st.story.topics), JSON.stringify([...new Set(st.articles.map(a => a.source_id))]), now());
    rankStories({ days: 30 });
    return { preferences: storyPreferences() };
  });
  route('POST', '/api/stories/:id/save', ({ params, body }) => {
    run('INSERT INTO saved(story_id, collection, note, created_at) VALUES(?,?,?,?) ON CONFLICT(story_id, collection) DO UPDATE SET note = excluded.note', params.id, need(body.collection, 'Collection required'), body.note || '', now());
    return all('SELECT * FROM saved WHERE story_id = ?', params.id);
  });
  route('DELETE', '/api/saved/:id', ({ params }) => { run('DELETE FROM saved WHERE id = ?', params.id); return { ok: true }; });
  route('POST', '/api/stories/:id/evergreen', async ({ params }) => ({ draft_id: await evergreenDraft(params.id) }));
  route('POST', '/api/stories/:id/drafts', async ({ params, body }) => {
    const data = loadStory(params.id);
    if (!data) throw bad('Story not found', 404);
    const channel = body.channel || 'linkedin', format = body.format || ({ instagram: 'carousel', video: 'explainer' }[channel] || 'short');
    const sections = await getProvider().draft({ ...data, format, angle: body.angle || 'tradeoff', notes: [], experiences: [], profile: getSettings().writing_profile, channel });
    const visual = channel === 'video' ? null : generateVisual(data.story, data.claims, data.articles);
    const id = createDraft({ story_id: data.story.id, campaign_id: body.campaign_id || null, channel, format, angle: body.angle || 'tradeoff', title: data.story.title, sections,
      image_id: visual?.id ?? null, source_ids: data.articles.map(a => a.id), meta: channel === 'video' ? { orientation: 'vertical', audience: '', purpose: '', platform: 'Instagram Reels', length: 26 } : {} });
    return { draft_id: id };
  });

  route('GET', '/api/feedback', () => ({ preferences: storyPreferences(), items: all('SELECT f.*, s.title FROM feedback f LEFT JOIN stories s ON s.id = f.story_id ORDER BY f.id DESC LIMIT 100') }));
  route('DELETE', '/api/feedback', () => { run('DELETE FROM feedback'); rankStories({ days: 30 }); return { preferences: storyPreferences() }; });

  // ----- watchlists & employers -----
  route('GET', '/api/watchlists', () => all('SELECT * FROM watchlists ORDER BY pinned DESC, kind, name').map(hydrate));
  route('POST', '/api/watchlists', ({ body }) => {
    const r = run('INSERT INTO watchlists(kind, name, terms, weight, pinned, employer, notes) VALUES(?,?,?,?,?,?,?)', body.kind || 'topic', need(body.name, 'Name required'),
      JSON.stringify(body.terms || []), body.weight ?? 1, body.pinned ? 1 : 0, body.employer || null, body.notes || '');
    rankStories({ days: 30 });
    return hydrate(get('SELECT * FROM watchlists WHERE id = ?', Number(r.lastInsertRowid)));
  });
  route('PATCH', '/api/watchlists/:id', ({ params, body }) => {
    for (const k of ['kind', 'name', 'weight', 'employer', 'notes']) if (k in body) run(`UPDATE watchlists SET ${k} = ? WHERE id = ?`, body[k], params.id);
    if ('terms' in body) run('UPDATE watchlists SET terms = ? WHERE id = ?', JSON.stringify(body.terms), params.id);
    if ('pinned' in body) run('UPDATE watchlists SET pinned = ? WHERE id = ?', body.pinned ? 1 : 0, params.id);
    rankStories({ days: 30 });
    return hydrate(get('SELECT * FROM watchlists WHERE id = ?', params.id));
  });
  route('DELETE', '/api/watchlists/:id', ({ params }) => { run('DELETE FROM watchlists WHERE id = ?', params.id); return { ok: true }; });

  route('GET', '/api/employers', () => loadEmployers().map(e => ({
    ...e,
    teams: all('SELECT * FROM watchlists WHERE employer = ? ORDER BY pinned DESC, name', e.name).map(hydrate),
    story_count: get('SELECT COUNT(*) AS n FROM stories WHERE companies LIKE ?', `%"${e.name}"%`).n,
    contact_count: get('SELECT COUNT(*) AS n FROM contacts WHERE employer = ?', e.name).n
  })));
  route('POST', '/api/employers', ({ body }) => {
    const r = run('INSERT INTO employers(name, parent, topics, terms, pinned, notes) VALUES(?,?,?,?,?,?)', need(body.name, 'Name required'), body.parent || null, JSON.stringify(body.topics || []), JSON.stringify(body.terms || []), body.pinned ? 1 : 0, body.notes || '');
    return hydrate(get('SELECT * FROM employers WHERE id = ?', Number(r.lastInsertRowid)));
  });
  route('PATCH', '/api/employers/:id', ({ params, body }) => {
    for (const k of ['name', 'parent', 'notes']) if (k in body) run(`UPDATE employers SET ${k} = ? WHERE id = ?`, body[k], params.id);
    for (const k of ['topics', 'terms']) if (k in body) run(`UPDATE employers SET ${k} = ? WHERE id = ?`, JSON.stringify(body[k]), params.id);
    if ('pinned' in body) run('UPDATE employers SET pinned = ? WHERE id = ?', body.pinned ? 1 : 0, params.id);
    return hydrate(get('SELECT * FROM employers WHERE id = ?', params.id));
  });
  route('DELETE', '/api/employers/:id', ({ params }) => { run('DELETE FROM employers WHERE id = ?', params.id); return { ok: true }; });
  route('GET', '/api/employers/:id/activity', ({ params }) => {
    const e = hydrate(get('SELECT * FROM employers WHERE id = ?', params.id));
    if (!e) throw bad('Employer not found', 404);
    const like = `%"${e.name}"%`;
    const stories = all('SELECT id, title, topics, updated_at, score FROM stories WHERE companies LIKE ? ORDER BY updated_at DESC LIMIT 50', like).map(hydrate);
    const covered = all(`SELECT d.id, d.title, d.channel, d.status, d.published_at FROM drafts d JOIN stories s ON s.id = d.story_id WHERE s.companies LIKE ? AND d.status IN ('approved','scheduled','published') ORDER BY d.id DESC`, like);
    const projects = all('SELECT id, title, status FROM projects WHERE employer = ?', e.name);
    const events = all('SELECT * FROM events WHERE employer = ? ORDER BY date DESC', e.name);
    const conversations = all('SELECT i.*, c.name FROM interactions i JOIN contacts c ON c.id = i.contact_id WHERE c.employer = ? ORDER BY i.date DESC', e.name);
    const topicCounts = {};
    for (const s of stories) for (const t of s.topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
    const coveredTopics = new Set(covered.flatMap(d => hydrate(get('SELECT topics FROM stories WHERE id = (SELECT story_id FROM drafts WHERE id = ?)', d.id) || {}).topics || []));
    const unexplored = e.topics.filter(t => !covered.some(d => (d.title || '').toLowerCase().includes(t.toLowerCase().split(' ')[0])));
    return { employer: e, stories, covered, projects, events, conversations, repeated_topics: Object.entries(topicCounts).sort((a, b) => b[1] - a[1]), unexplored, covered_topics: [...coveredTopics] };
  });
  route('POST', '/api/events', ({ body }) => { run('INSERT INTO events(employer, title, date, notes, kind) VALUES(?,?,?,?,?)', body.employer, need(body.title, 'Title required'), body.date || now().slice(0, 10), body.notes || '', body.kind || 'event'); return { ok: true }; });

  // ----- runs & briefs -----
  route('GET', '/api/runs', () => all('SELECT * FROM runs ORDER BY id DESC LIMIT 60').map(hydrate));
  route('GET', '/api/runs/:id', ({ params }) => ({ ...hydrate(get('SELECT * FROM runs WHERE id = ?', params.id)), stages: all('SELECT * FROM run_stages WHERE run_id = ? ORDER BY id', params.id).map(hydrate),
    usage: all('SELECT operation, provider, input_tokens, output_tokens, cost_usd FROM usage WHERE run_id = ?', params.id) }));
  route('POST', '/api/runs', ({ body }) => {
    if (body.from_stage && !STAGES.includes(body.from_stage)) throw bad('Unknown stage');
    return runDaily({ date: body.date, trigger: 'manual', fromStage: body.from_stage || null });
  });
  route('POST', '/api/runs/:id/retry', ({ params, body }) => {
    const r = get('SELECT * FROM runs WHERE id = ?', params.id);
    if (!r) throw bad('Run not found', 404);
    return runDaily({ date: r.run_date, trigger: r.trigger, runId: r.id, fromStage: body.from_stage || null });
  });

  route('GET', '/api/today', ({ query }) => {
    const s = getSettings();
    const date = query.date || todayIn(s.timezone);
    let brief = get('SELECT * FROM briefs WHERE run_date = ?', date) || get('SELECT * FROM briefs ORDER BY run_date DESC LIMIT 1');
    brief = brief ? hydrate(brief) : null;
    if (brief) brief.items = parse(brief.items_json, brief.items || []);
    const draft = brief?.draft_id ? get('SELECT d.id, d.title, d.status, d.format, d.channel, i.filename AS image_file FROM drafts d LEFT JOIN images i ON i.id = d.image_id WHERE d.id = ?', brief.draft_id) : null;
    // Brief items are a snapshot; overlay the live story so scores, wording and source counts match every other view.
    if (brief?.items?.length) {
      const ids = brief.items.map(i => i.story_id);
      const live = new Map(enrich(all(`SELECT * FROM stories WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map(hydrate)).map(r => [r.id, r]));
      const weights = topicWeights();
      brief.items = brief.items.map(i => {
        const st = live.get(i.story_id);
        if (!st) return { ...i, missing: true };
        const { breakdown_json, breakdown, lens_json, lens, summary, viewed_score, last_viewed_at, ...rest } = st;
        return { ...i, brief_score: i.score, brief_explanation: i.explanation, ...rest, story_id: st.id, score: st.score, explanation: st.explanation, topics: st.topics,
          main_topic: mainTopic(st.topics, weights), qualifies: st.score >= s.publish_threshold, is_demo: !!st.is_demo, why: whyRanked(st, st) };
      });
    }
    const wc = windowCounts(s);
    const top = wc.cleared_ids.length ? enrich([hydrate(get('SELECT * FROM stories WHERE id = ?', wc.cleared_ids[0]))])[0] : null;
    const today = todayIn(s.timezone);
    return {
      today, brief_date: brief?.run_date || null, run_date: brief?.run_date || null, is_today: !!brief && brief.run_date === today, brief_date_label: dayLabel(brief?.run_date),
      ranked: wc.ranked, cleared: wc.cleared, below: wc.below, window_days: wc.window_days, topic_counts: wc.topic_counts,
      headline_topic: wc.headline_topic, second_topic: wc.second_topic,
      top: top ? { id: top.id, title: top.title, short_title: top.short_title, score: top.score, independent_outlets: top.independent_outlets, evidence_qualifier: top.evidence_qualifier, finding: top.finding, finding_marks: top.finding_marks } : null,
      sources_total: get('SELECT COUNT(*) AS n FROM sources').n, sources_paused: get('SELECT COUNT(*) AS n FROM sources WHERE paused = 1').n,
      schedule_enabled: !!s.schedule?.enabled,
      date, brief, draft,
      awaiting: all("SELECT id, title, channel, format, status, updated_at FROM drafts WHERE status IN ('draft','in_review') ORDER BY updated_at DESC LIMIT 12"),
      outreach_awaiting: all("SELECT o.id, o.channel, o.purpose, o.status, c.name FROM outreach o JOIN contacts c ON c.id = o.contact_id WHERE o.status IN ('draft','in_review') ORDER BY o.id DESC LIMIT 6"),
      followups: all("SELECT id, name, next_step, next_date FROM contacts WHERE dnc = 0 AND next_date IS NOT NULL AND next_date <= ? ORDER BY next_date LIMIT 6", date),
      evergreen_candidates: all("SELECT s.id, s.title, v.collection FROM saved v JOIN stories s ON s.id = v.story_id ORDER BY v.id DESC LIMIT 5"),
      last_run: hydrate(get('SELECT * FROM runs ORDER BY id DESC LIMIT 1')),
      last_run_summary: runSummary(get('SELECT * FROM runs ORDER BY id DESC LIMIT 1'), s.timezone),
      threshold: s.publish_threshold
    };
  });

  // ----- search -----
  route('GET', '/api/search', ({ query }) => {
    const raw = String(query.q || '').trim();
    const q = `%${raw}%`;
    const types = (query.type || 'stories,claims,briefs,drafts,notes,contacts').split(',');
    const limit = Math.min(200, Number(query.limit || 50));
    const out = {}, counts = {};
    const dateF = (col) => { const c = []; const p = []; if (query.from) { c.push(`${col} >= ?`); p.push(query.from); } if (query.to) { c.push(`${col} <= ?`); p.push(query.to + 'T23:59:59'); } return [c.length ? ' AND ' + c.join(' AND ') : '', p]; };
    const both = (from, where, p, order, map = (x) => x, orderP = []) => { counts[from.key] = get(`SELECT COUNT(*) AS n FROM ${from.sql} WHERE ${where}`, ...p).n; return all(`SELECT ${from.cols} FROM ${from.sql} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`, ...p, ...orderP).map(map); };
    if (types.includes('stories')) {
      const [dc, dp] = dateF('s.updated_at');
      let where = `(s.title LIKE ? OR s.summary LIKE ? OR s.companies LIKE ? OR s.topics LIKE ?)${dc}`; const p = [q, q, q, q, ...dp];
      if (query.topic) { where += ' AND s.topics LIKE ?'; p.push(`%"${query.topic}"%`); }
      if (query.company) { where += ' AND s.companies LIKE ?'; p.push(`%"${query.company}"%`); }
      if (query.source) { where += ' AND EXISTS (SELECT 1 FROM articles a WHERE a.story_id = s.id AND a.source_id = ?)'; p.push(query.source); }
      if (query.status) { where += ' AND s.status = ?'; p.push(query.status); }
      if (query.min_score) { where += ' AND s.score >= ?'; p.push(Number(query.min_score)); }
      const rows = both({ key: 'stories', sql: 'stories s', cols: 's.id, s.title, s.summary, s.topics, s.companies, s.status, s.score, s.first_seen, s.updated_at, s.is_demo, s.breakdown_json' },
        where, p, raw ? '(s.title LIKE ?) DESC, s.score DESC' : 's.score DESC', hydrate, raw ? [q] : []);
      const weights = topicWeights();
      out.stories = enrich(rows).map(({ breakdown, ...r }) => ({ ...r, main_topic: mainTopic(r.topics, weights) }));
    }
    if (types.includes('claims')) {
      const where = `c.text LIKE ?${query.source ? ' AND a.source_id = ?' : ''}`; const p = [q, ...(query.source ? [query.source] : [])];
      out.claims = both({ key: 'claims', sql: 'claims c JOIN articles a ON a.id = c.article_id LEFT JOIN stories s ON s.id = c.story_id', cols: 'c.id, c.text, c.evidence_kind, c.story_id, c.article_id, c.has_number, a.url, a.domain, a.title AS article_title, s.title AS story_title, s.score AS story_score' },
        where, p, 'c.has_number DESC, c.id', (c) => { const t = cleanClaim(c.text); return { ...c, text_clean: t, marks: numberMarks(t), story_short_title: shortTitle(c.story_title || '') }; });
    }
    if (types.includes('briefs')) { const [dc, dp] = dateF('run_date'); out.briefs = both({ key: 'briefs', sql: 'briefs', cols: 'id, run_date, summary, quiet' }, `(summary LIKE ? OR items_json LIKE ?)${dc}`, [q, q, ...dp], 'run_date DESC'); }
    if (types.includes('drafts')) {
      const [dc, dp] = dateF('d.updated_at');
      out.drafts = both({ key: 'drafts', sql: 'drafts d LEFT JOIN stories s ON s.id = d.story_id', cols: 'd.id, d.title, d.channel, d.format, d.status, d.updated_at, d.planned_date, d.story_id, s.score AS story_score' },
        `(d.title LIKE ? OR d.sections_json LIKE ?)${query.status ? ' AND d.status = ?' : ''}${dc}`, [q, q, ...(query.status ? [query.status] : []), ...dp], 'd.updated_at DESC');
    }
    if (types.includes('notes')) out.notes = both({ key: 'notes', sql: 'notes n LEFT JOIN drafts d ON d.id = n.draft_id', cols: 'n.id, n.text, n.kind, n.draft_id, n.story_id, n.include, n.created_at, d.title AS draft_title' }, 'n.text LIKE ?', [q], 'n.id DESC');
    if (types.includes('contacts')) {
      out.contacts = both({ key: 'contacts', sql: 'contacts c', cols: 'c.id, c.name, c.role, c.org, c.employer, c.team, c.stage, c.dnc, c.next_step, c.next_date, c.updated_at' },
        `(c.name LIKE ? OR c.role LIKE ? OR c.org LIKE ? OR c.employer LIKE ? OR c.team LIKE ? OR c.why LIKE ?)${query.employer ? ' AND c.employer = ?' : ''}`,
        [q, q, q, q, q, q, ...(query.employer ? [query.employer] : [])], 'c.updated_at DESC', (c) => ({ ...c, dnc: !!c.dnc }));
    }
    out.counts = { ...counts, total: Object.values(counts).reduce((m, n) => m + n, 0) };
    out.totals = get(`SELECT (SELECT COUNT(*) FROM stories) AS stories, (SELECT COUNT(*) FROM claims) AS claims, (SELECT COUNT(*) FROM drafts) AS drafts,
      (SELECT COUNT(*) FROM notes) AS notes, (SELECT COUNT(*) FROM briefs) AS briefs, (SELECT COUNT(*) FROM contacts) AS contacts`);
    out.q = raw;
    return out;
  });

  // ----- delivery, weekly roundup, posting slots, calendar feed -----
  route('GET', '/api/briefs/:date/digest', ({ params }) => {
    const html = digestHtml(params.date);
    if (!html) throw bad('No brief for that date', 404);
    return { html };
  });
  route('POST', '/api/briefs/:date/deliver', ({ params, body }) => deliverBrief(params.date, { force: !!body.force, only: body.channel || null }));
  route('POST', '/api/weekly-roundup', ({ body }) => weeklyRoundup(body.date || todayIn(getSettings().timezone)));
  route('GET', '/api/slots/next', ({ query }) => {
    const s = getSettings();
    const days = s.posting_days?.length ? s.posting_days : ['Mon', 'Wed', 'Fri'];
    const start = new Date(`${query.after || todayIn(s.timezone)}T12:00:00Z`);
    for (let i = 1; i <= 60; i++) {
      const d = new Date(start.getTime() + i * 864e5);
      const iso = d.toISOString().slice(0, 10);
      if (!days.includes(d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }))) continue;
      if (get("SELECT id FROM drafts WHERE channel = ? AND planned_date = ? AND status NOT IN ('archived')", query.channel || 'linkedin', iso)) continue;
      return { date: iso };
    }
    return { date: null };
  });
  route('GET', '/api/calendar.ics', () => { throw bad('Use the feed URL shown in Settings', 400); });

  route('POST', '/api/demo/load', () => loadDemo());
  route('DELETE', '/api/demo', () => clearDemo());
}
