// v4 server data layer, end to end on an isolated data directory: stories/today/status/search/sources/calendar/map.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreFrom } from '../src/score.js';
import { markedText } from '../src/finding.js';

const PORT = 4381;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-v4-'));
let server;
const base = `http://127.0.0.1:${PORT}/api`;
const api = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
};

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { env: { ...process.env, PORT: String(PORT), BYLINE_DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', RESEND_API_KEY: '', NTFY_TOPIC: '' }, stdio: process.env.V4_DEBUG ? 'inherit' : 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`${base}/status`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  for (const s of (await api('GET', '/sources')).data) await api('PATCH', `/sources/${s.id}`, { paused: true });
  await api('POST', '/demo/load');
  for (const s of (await api('GET', '/sources')).data) await api('PATCH', `/sources/${s.id}`, { paused: true });   // demo sources arrive unpaused
});
after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('/api/stories: v2 breakdown reconciles with score; finding and honest counts on every row', async () => {
  const rows = (await api('GET', '/stories')).data;
  assert.ok(rows.length >= 5);
  for (const s of rows) {
    assert.equal(s.breakdown.version, 2, `story ${s.id}`);
    assert.equal(scoreFrom(s.breakdown).score, s.score, `story ${s.id} reconciles`);
    for (const k of ['base', 'penalty', 'source_pref', 'newest_hours', 'priorities', 'watch_terms', 'impact_hits', 'signal_quotes']) assert.ok(k in s.breakdown, k);
    // R3 S13: finding may be null (an echo of the title or a numberless template); never equal to the title
    assert.ok(s.finding === null || typeof s.finding === 'string', `story ${s.id} finding`);
    if (s.finding) assert.notEqual(s.finding.replace(/[.\s]+$/, '').toLowerCase(), String(s.title).replace(/[.\s]+$/, '').toLowerCase(), `story ${s.id} dek echoes its title`);
    assert.ok(Array.isArray(s.finding_marks));
    assert.equal(s.first_party + s.primary + s.independent + s.commentary, s.posts);
    assert.ok(!/credible independent/i.test(s.explanation));
  }
  const relay = rows.find(s => /Relay/.test(s.title));
  assert.equal(relay.finding_kind, 'disagreement');
  assert.equal(relay.source_line, '3 posts · 3 outlets · 1 independent');
  assert.deepEqual(markedText(relay.finding, relay.finding_marks), ['60', '21%', '38%']);
});

test('/api/stories/:id: dossier payload follows F §3', async () => {
  const relay = (await api('GET', '/stories')).data.find(s => /Relay/.test(s.title));
  const d = (await api('GET', `/stories/${relay.id}?mark_viewed=0`)).data;
  assert.deepEqual(d.articles.map(a => a.kind_label), ['Primary', 'Independent', 'Commentary']);
  for (const a of d.articles) for (const k of ['id', 'domain', 'title', 'url', 'kind', 'published_at', 'fetched_at', 'summary', 'is_new', 'claims', 'says', 'role']) assert.ok(k in a, k);
  assert.equal(d.sources_header.callout.kind, 'disagreement');
  assert.equal(d.sources_header.sentence, '3 posts from 3 outlets: 1 first-party, 1 independent, 1 commentary/community.');
  assert.equal(d.breakdown.reconciles, true);
  assert.deepEqual(d.breakdown.rows.map(r => [r.key, r.max]), [['interest', 35], ['evidence', 25], ['novelty', 20], ['impact', 20]]);
  assert.deepEqual(d.breakdown.multipliers.map(m => m.key), ['recency', 'feedback', 'source_pref', 'penalty']);
  assert.ok(Array.isArray(d.lens.who) && !('learn' in d.lens));
  assert.ok(d.evidence.priorities && d.evidence.watchlist && d.evidence.practical && d.evidence.post_worthy && d.evidence.de_emphasis);
  assert.ok(d.evidence.post_worthy.rows.some(r => r.signal === 'challenges' && /smaller than/.test(r.quote)));
  assert.equal(d.why_ranked.length, 3);
  assert.ok(Array.isArray(d.drafts) && Array.isArray(d.projects) && Array.isArray(d.employer_connections));
  assert.equal(d.story.finding, relay.finding);
  // round 1 S17e: every article says whether its summary is boilerplate (never shown as what the source said)
  for (const a of d.articles) assert.equal(typeof a.summary_is_boilerplate, 'boolean');
});

test('/api/today: ranked, cleared, weighted topic counts, threshold and brief date', async () => {
  const t = (await api('GET', '/today')).data;
  const st = (await api('GET', '/settings')).data;
  assert.equal(t.threshold, st.publish_threshold);
  const week = (await api('GET', '/stories?days=7&limit=500')).data;
  assert.equal(t.ranked, week.length);
  assert.equal(t.cleared, week.filter(s => s.score >= t.threshold).length);
  assert.equal(t.is_today, t.brief_date === t.today);
  for (const tc of t.topic_counts) assert.equal(tc.weighted, Math.round(tc.count * tc.weight * 100) / 100);
  if (t.headline_topic) assert.notEqual(t.topic_counts.find(x => x.topic === t.headline_topic).weight <= 1 && t.topic_counts.some(x => x.weight > 1), true);
  for (const i of t.brief.items) { assert.ok(i.finding === null || typeof i.finding === 'string'); assert.ok('posts' in i && 'independent' in i && Array.isArray(i.why)); }
});

test('/api/status: new counts, schedule flag, last run summary and issue number', async () => {
  const s = (await api('GET', '/status')).data;
  for (const k of ['claims', 'drafts_open', 'notes', 'briefs', 'sources_paused', 'schedule_enabled']) assert.ok(k in s.counts, k);
  assert.equal(s.counts.sources_paused, s.counts.sources);
  assert.equal(s.last_run.status, 'done');
  assert.match(s.last_run.time_local, /^\d{1,2}:\d{2} [AP]M$/);
  assert.equal(s.issue.number, s.counts.briefs);
  // round 1 S17a: Today's "Waiting on you" reads real counts, not the 12-row list
  assert.equal(typeof s.counts.in_review, 'number');
  assert.equal(typeof s.counts.drafts_open, 'number');
  const drafts = (await api('GET', '/drafts')).data;
  const list = Array.isArray(drafts) ? drafts : (drafts.drafts || drafts.items || []);
  if (list.length && list.length < 200) assert.equal(s.counts.in_review, list.filter(d => d.status === 'in_review').length);
  assert.ok(s.counts.in_review <= s.counts.drafts_open);
});

test('/api/search: stories carry score/topics/finding, claims carry story title, contacts type, counts per type', async () => {
  await api('POST', '/contacts', { name: 'Avery Searchable', role: 'Agent platform PM', org: 'Contoso' });
  const r = (await api('GET', '/search?q=Relay')).data;
  assert.ok(r.stories.length >= 1);
  assert.ok('score' in r.stories[0] && Array.isArray(r.stories[0].topics) && typeof r.stories[0].finding === 'string');
  assert.ok(r.claims.length >= 1 && r.claims[0].story_title && r.claims[0].story_id);
  assert.equal(r.counts.stories, r.stories.length);
  const c = (await api('GET', '/search?q=Avery')).data;
  assert.equal(c.contacts.length, 1);
  assert.equal(c.counts.contacts, 1);
  assert.ok(c.totals.contacts >= 1);
});

test('/api/sources: health, 7-day counts, summary and recent articles', async () => {
  const rows = (await api('GET', '/sources')).data;
  for (const s of rows) {
    assert.ok(['ok', 'stale', 'error', 'paused'].includes(s.health));
    assert.equal(s.health, 'paused');   // every source was paused in before()
    for (const k of ['articles_7d', 'stories_count', 'last_article_at', 'health_unpaused']) assert.ok(k in s, k);
  }
  const demo = rows.find(s => s.is_demo && s.article_count > 0);
  assert.equal(demo.health_unpaused, 'ok');
  await api('PATCH', `/sources/${demo.id}`, { paused: false });
  assert.equal((await api('GET', '/sources')).data.find(s => s.id === demo.id).health, 'ok');
  await api('PATCH', `/sources/${demo.id}`, { paused: true });
  const sum = (await api('GET', '/sources/summary')).data;
  assert.equal(sum.sources, rows.length);
  assert.equal(sum.paused, rows.length);
  assert.equal(sum.all_paused, true);
  const arts = (await api('GET', `/sources/${demo.id}/articles?limit=5`)).data;
  assert.ok(arts.length >= 1 && arts.length <= 5);
  assert.ok('story_title' in arts[0] && 'url' in arts[0]);
  assert.equal((await api('GET', '/sources/99999/articles')).status, 404);
});

test('/api/calendar joins story score; /plan moves a draft without touching status; /schedule stays gated', async () => {
  const relay = (await api('GET', '/stories')).data.find(s => /Relay/.test(s.title));
  const { draft_id } = (await api('POST', `/stories/${relay.id}/drafts`, { channel: 'linkedin' })).data;
  const before = (await api('GET', '/calendar')).data.unplanned.find(d => d.id === draft_id);
  assert.equal(before.story_id, relay.id);
  assert.equal(before.score, relay.score);
  const month = new Date().toISOString().slice(0, 7);
  const day = `${month}-15`;
  const p = await api('POST', `/drafts/${draft_id}/plan`, { date: day });
  assert.equal(p.status, 200);
  assert.deepEqual([p.data.ok, p.data.planned_date, p.data.status], [true, day, 'draft']);
  const cal = (await api('GET', `/calendar?month=${month}`)).data.drafts.find(d => d.id === draft_id);
  assert.deepEqual([cal.planned_date, cal.status, cal.score, cal.story_id], [day, 'draft', relay.score, relay.id]);
  assert.equal((await api('POST', `/drafts/${draft_id}/plan`, { date: 'tomorrow' })).status, 400);
  assert.equal((await api('POST', '/drafts/99999/plan', { date: day })).status, 404);
  assert.equal((await api('POST', `/drafts/${draft_id}/plan`, { date: null })).data.planned_date, null);
  assert.equal((await api('POST', `/drafts/${draft_id}/schedule`, { date: day })).status, 400);   // not approved
});

test('/api/map: nodes for all stories, top-k edges, clusters, ETag/304, stable positions', async () => {
  const r1 = await api('GET', '/map');
  assert.equal(r1.status, 200);
  const m = r1.data;
  const all = (await api('GET', '/stories?limit=1000')).data.length + (await api('GET', '/stories?status=archived&limit=1000')).data.length;
  assert.equal(m.nodes.length, all);
  for (const n of m.nodes) for (const k of ['id', 'title', 'score', 'topics', 'topic', 'companies', 'first_seen', 'finding', 'posts', 'outlets', 'independent', 'is_demo', 'x', 'y']) assert.ok(k in n, k);
  const ids = new Set(m.nodes.map(n => n.id));
  for (const e of m.edges) { assert.ok(ids.has(e.a) && ids.has(e.b) && e.a < e.b); assert.ok(e.weight >= 0.9); assert.ok(e.reasons && 'companies' in e.reasons); }
  assert.ok(m.edges.length <= 4 * m.nodes.length);
  assert.ok(m.clusters.length >= 1 && m.clusters.every(c => 'x' in c && 'label' in c && c.heat >= 0 && c.heat <= 1));
  // round 1 S17b/c: in_count (topic anywhere) beside count (main topic); a short_title on every node
  const anywhere = (t) => m.nodes.filter(n => n.topics.includes(t)).length;
  for (const c of m.clusters.filter(c => c.topic)) { assert.equal(c.in_count, anywhere(c.topic), c.topic); assert.ok(c.in_count >= c.count, c.topic); }
  for (const h of m.hot_topics) assert.equal(h.in_count, anywhere(h.topic), h.topic);
  for (const n of m.nodes) { assert.equal(typeof n.short_title, 'string'); assert.ok(n.short_title.length > 0 && n.short_title.length <= 60, n.short_title); }
  const etag = r1.headers.get('etag');
  assert.ok(etag);
  assert.equal((await api('GET', '/map', null, { 'If-None-Match': etag })).status, 304);
  const r2 = await api('GET', '/map');
  assert.deepEqual(r2.data.nodes.map(n => [n.id, n.x, n.y]), m.nodes.map(n => [n.id, n.x, n.y]));
  // Adding a story changes the ETag and keeps every existing node where it was.
  const intake = (await api('POST', '/intake/manual', { url: 'https://paste.example/map-new', title: 'Quarry Labs opens a public registry of governance audit templates', text: 'Quarry Labs released 14 audit templates for AI governance reviews under a public license.' })).data;
  assert.ok(!ids.has(intake.story_id), 'intake created a new story');
  const r3 = await api('GET', '/map', null, { 'If-None-Match': etag });
  assert.equal(r3.status, 200);
  assert.notEqual(r3.headers.get('etag'), etag);
  assert.equal(r3.data.nodes.length, m.nodes.length + 1);
  const old = new Map(m.nodes.map(n => [n.id, [n.x, n.y]]));
  for (const n of r3.data.nodes) if (old.has(n.id)) assert.deepEqual([n.x, n.y], old.get(n.id), `node ${n.id} kept its place`);
  assert.equal(r3.data.meta.layout, 'relaxed');
});
