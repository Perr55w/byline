// GET /api/map: every story as a node, similarity edges, topic clusters and a seeded server-side layout (critic E §4).
// Cached in memory by a fingerprint of the inputs, served with an ETag (If-None-Match → 304). Positions persist in
// the cache table so new stories settle next to their neighbours instead of reshuffling the whole map.
import { all, get, run, now, hydrate, parse, getSettings } from '../db.js';
import { hashString } from '../text.js';
import { loadMany, storyFacts, mainTopic } from '../facts.js';
import { buildGraph, layout, clusters, radiusFor, MAP_VERSION } from '../maplayout.js';

const POS_KEY = `map:positions:v${MAP_VERSION}`;
let memo = null; // { etag, body }

/** Cheap fingerprint of everything the map depends on. */
export function mapFingerprint() {
  const st = get(`SELECT COUNT(*) AS n, GROUP_CONCAT(id || ':' || score || ':' || COALESCE(updated_at,'') || ':' || status || ':' || topics || ':' || companies || ':' || length(COALESCE(breakdown_json,'')), '|') AS sig FROM (SELECT * FROM stories ORDER BY id)`);
  const ar = get('SELECT COUNT(*) AS n, MAX(id) AS m, GROUP_CONCAT(story_id) AS sids FROM (SELECT id, story_id FROM articles ORDER BY id)');
  const cl = get('SELECT COUNT(*) AS n, MAX(id) AS m FROM claims');
  const w = get("SELECT GROUP_CONCAT(id || name || weight || pinned, '|') AS sig FROM watchlists");
  const pr = JSON.stringify(getSettings().priorities.map(p => [p.topic, p.weight]));
  return hashString([MAP_VERSION, st.n, st.sig, ar.n, ar.m, ar.sids, cl.n, cl.m, w.sig, pr].join('#'));
}

function loadPositions() {
  const r = get('SELECT value FROM cache WHERE key = ?', POS_KEY);
  return r ? parse(r.value, null) : null;
}
function savePositions(positions) {
  run('INSERT INTO cache(key, value, created_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at', POS_KEY, JSON.stringify(positions), now());
}

/** Build the full map payload (positions persisted as a side effect). */
export function buildMap({ nowMs = Date.now() } = {}) {
  const t0 = performance.now();
  const s = getSettings();
  const weights = Object.fromEntries(s.priorities.map(p => [p.topic, p.weight]));
  const stories = all('SELECT * FROM stories ORDER BY id').map(hydrate);
  const { arts, claims } = loadMany(stories.map(x => x.id));
  const nodesIn = stories.map(st => {
    const a = arts.get(st.id) || [];
    const srcs = [...new Map(a.filter(x => x.source_id).map(x => [x.source_id, { id: x.source_id, name: x.source_name || String(x.source_id) }])).values()];
    return { st, a, id: st.id, topic: mainTopic(st.topics, weights) || '', score: st.score, updated_at: st.updated_at, topics: st.topics, companies: st.companies, watch: st.breakdown?.watch || [], sources: srcs };
  });
  const edges = buildGraph(nodesIn, { topicWeights: weights });
  const prev = loadPositions();
  const L = layout(nodesIn, edges, { prev });
  savePositions(L.positions);
  const degree = new Map(nodesIn.map(d => [d.id, 0]));
  for (const e of edges) { degree.set(e.a, degree.get(e.a) + 1); degree.set(e.b, degree.get(e.b) + 1); }
  const nodes = nodesIn.map(d => {
    const f = storyFacts(d.st, d.a, claims.get(d.id) || []);
    const [x, y] = L.positions[d.id];
    return {
      id: d.id, title: d.st.title, short_title: f.short_title, score: d.st.score, topics: d.st.topics, topic: d.topic || null, companies: d.st.companies,
      first_seen: d.st.first_seen, updated_at: d.st.updated_at, status: d.st.status, is_demo: !!d.st.is_demo,
      finding: f.finding, finding_marks: f.finding_marks, posts: f.posts, outlets: f.outlets, first_party: f.first_party, independent: f.independent,
      independent_outlets: f.independent_outlets, commentary: f.commentary, source_line: f.source_line,
      watch: d.watch, sources: d.sources.map(x => x.name), x, y, r: Math.round(radiusFor(d.st.score) * 10) / 10, degree: degree.get(d.id)
    };
  });
  const cl = nodes.length ? clusters(nodesIn, L.positions, L.anchors, { nowMs }) : [];
  const topicCounts = {};
  for (const n of nodes) for (const t of n.topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
  const reasonTotals = (id) => {
    const tally = { companies: 0, watchlist: 0, sources: 0, topics: 0 };
    for (const e of edges) if (e.a === id || e.b === id) for (const k of Object.keys(tally)) tally[k] += e.reasons[k].length;
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  const bridgeNode = [...nodes].sort((a, b) => b.degree - a.degree || b.score - a.score)[0];
  const seen = nodes.map(n => n.first_seen).filter(Boolean).sort();
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y), rs = nodes.map(n => n.r);
  return {
    nodes, edges, clusters: cl,
    topic_counts: Object.entries(topicCounts).map(([topic, count]) => ({ topic, count, weight: weights[topic] ?? 1 })).sort((a, b) => b.count * (b.weight > 1 ? 2 : 1) - a.count * (a.weight > 1 ? 2 : 1) || b.count - a.count || a.topic.localeCompare(b.topic)),
    hot_topics: cl.filter(c => c.topic).slice(0, 3).map(c => ({ topic: c.topic, heat: c.heat, count: c.count, recent: c.recent })),
    bridge: bridgeNode && bridgeNode.degree ? { id: bridgeNode.id, short_title: bridgeNode.short_title, degree: bridgeNode.degree, via: reasonTotals(bridgeNode.id) } : null,
    range: { first_seen_min: seen[0] || null, first_seen_max: seen[seen.length - 1] || null },
    bounds: nodes.length ? { x0: Math.min(...xs.map((x, i) => x - rs[i])), y0: Math.min(...ys.map((y, i) => y - rs[i])), x1: Math.max(...xs.map((x, i) => x + rs[i])), y1: Math.max(...ys.map((y, i) => y + rs[i])) } : null,
    threshold: s.publish_threshold,
    meta: { version: MAP_VERSION, n: nodes.length, e: edges.length, layout: L.mode, iterations: L.iterations, scale: L.scale, compute_ms: Math.round((performance.now() - t0) * 10) / 10, generated_at: new Date(nowMs).toISOString() }
  };
}

export function registerMap(route) {
  route('GET', '/api/map', ({ req, res }) => {
    const etag = `"map-v${MAP_VERSION}-${mapFingerprint()}"`;
    const headers = { 'Content-Type': 'application/json', ETag: etag, 'Cache-Control': 'no-cache' };
    if (req && res && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    if (!memo || memo.etag !== etag) {
      const data = buildMap();
      data.meta.etag = etag;
      memo = { etag, body: JSON.stringify(data), ms: data.meta.compute_ms };
    }
    if (!res) return JSON.parse(memo.body);
    res.writeHead(200, { ...headers, 'Server-Timing': `map;dur=${memo.ms}` });
    res.end(memo.body);
  });
}

/** For tests: forget the in-memory payload (positions in the cache table are kept). */
export const resetMapMemo = () => { memo = null; };
