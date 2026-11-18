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

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const need = (v, msg) => { if (v === undefined || v === null || v === '') throw bad(msg); return v; };

export function registerContent(route) {
  route('GET', '/api/status', () => {
    const s = getSettings();
    return {
      today: todayIn(s.timezone), timezone: s.timezone, threshold: s.publish_threshold, provider: providerStatus(),
      connectors: Object.fromEntries(Object.entries(connectors).map(([k, c]) => [k, { label: c.label, ...c.status({ url: 'x' }) }])),
      publishers: Object.fromEntries(Object.entries(publishers).map(([k, p]) => [k, p.status()])),
      counts: get(`SELECT (SELECT COUNT(*) FROM stories) AS stories, (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM sources) AS sources,
        (SELECT COUNT(*) FROM drafts WHERE status IN ('draft','in_review')) AS awaiting, (SELECT COUNT(*) FROM articles WHERE is_demo = 1) AS demo_articles`),
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
  route('GET', '/api/sources', () => all('SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.source_id = s.id) AS article_count FROM sources s ORDER BY grp, name')
    .map(s => ({ ...s, connector: connectorFor(s.kind).label, connector_status: connectorFor(s.kind).status(s) })));
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
    return rows.map(hydrate);
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
    return {
      date, brief, draft,
      awaiting: all("SELECT id, title, channel, format, status, updated_at FROM drafts WHERE status IN ('draft','in_review') ORDER BY updated_at DESC LIMIT 12"),
      outreach_awaiting: all("SELECT o.id, o.channel, o.purpose, o.status, c.name FROM outreach o JOIN contacts c ON c.id = o.contact_id WHERE o.status IN ('draft','in_review') ORDER BY o.id DESC LIMIT 6"),
      followups: all("SELECT id, name, next_step, next_date FROM contacts WHERE dnc = 0 AND next_date IS NOT NULL AND next_date <= ? ORDER BY next_date LIMIT 6", date),
      evergreen_candidates: all("SELECT s.id, s.title, v.collection FROM saved v JOIN stories s ON s.id = v.story_id ORDER BY v.id DESC LIMIT 5"),
      last_run: hydrate(get('SELECT * FROM runs ORDER BY id DESC LIMIT 1')),
      threshold: s.publish_threshold
    };
  });

  // ----- search -----
  route('GET', '/api/search', ({ query }) => {
    const q = `%${query.q || ''}%`;
    const types = (query.type || 'stories,claims,briefs,drafts,notes').split(',');
    const out = {};
    const dateF = (col) => { const c = []; const p = []; if (query.from) { c.push(`${col} >= ?`); p.push(query.from); } if (query.to) { c.push(`${col} <= ?`); p.push(query.to + 'T23:59:59'); } return [c.length ? ' AND ' + c.join(' AND ') : '', p]; };
    if (types.includes('stories')) {
      const [dc, dp] = dateF('s.updated_at');
      let sql = `SELECT s.id, s.title, s.summary, s.topics, s.companies, s.status, s.updated_at FROM stories s WHERE (s.title LIKE ? OR s.summary LIKE ?)${dc}`; const p = [q, q, ...dp];
      if (query.topic) { sql += ' AND s.topics LIKE ?'; p.push(`%"${query.topic}"%`); }
      if (query.company) { sql += ' AND s.companies LIKE ?'; p.push(`%"${query.company}"%`); }
      if (query.source) { sql += ' AND EXISTS (SELECT 1 FROM articles a WHERE a.story_id = s.id AND a.source_id = ?)'; p.push(query.source); }
      if (query.status) { sql += ' AND s.status = ?'; p.push(query.status); }
      out.stories = all(sql + ' ORDER BY s.updated_at DESC LIMIT 50', ...p).map(hydrate);
    }
    if (types.includes('claims')) out.claims = all(`SELECT c.id, c.text, c.evidence_kind, c.story_id, a.url, a.domain FROM claims c JOIN articles a ON a.id = c.article_id WHERE c.text LIKE ?${query.source ? ' AND a.source_id = ?' : ''} LIMIT 50`, q, ...(query.source ? [query.source] : []));
    if (types.includes('briefs')) { const [dc, dp] = dateF('run_date'); out.briefs = all(`SELECT id, run_date, summary, quiet FROM briefs WHERE (summary LIKE ? OR items_json LIKE ?)${dc} ORDER BY run_date DESC LIMIT 30`, q, q, ...dp); }
    if (types.includes('drafts')) { const [dc, dp] = dateF('updated_at'); out.drafts = all(`SELECT id, title, channel, format, status, updated_at FROM drafts WHERE (title LIKE ? OR sections_json LIKE ?)${query.status ? ' AND status = ?' : ''}${dc} ORDER BY updated_at DESC LIMIT 50`, q, q, ...(query.status ? [query.status] : []), ...dp); }
    if (types.includes('notes')) out.notes = all('SELECT n.id, n.text, n.kind, n.draft_id, n.include FROM notes n WHERE n.text LIKE ? ORDER BY n.id DESC LIMIT 50', q);
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
