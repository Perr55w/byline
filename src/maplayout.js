// Story map: similarity graph + seeded, deterministic force layout (critic E §4). Pure: no DB, no clock.
// buildGraph() turns story features into weighted edges; layout() places nodes; summarize() adds clusters.
import { hashString } from './text.js';

export const MAP_VERSION = 1;          // bump when edge weights or layout parameters change (invalidates saved positions)
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const MIN_EDGE_WEIGHT = 0.9;
export const TOP_K = 4;
const BASE = { companies: 3, watchlist: 2, sources: 1.5, topics: 1 };

/** mulberry32: tiny seeded PRNG, uniform in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedFor = (ids) => parseInt(hashString([...ids].map(Number).sort((a, b) => a - b).join(',')), 16) >>> 0;

/** Node radius in world units from score (the client may reuse it). */
export const radiusFor = (score) => 5 + 13 * Math.max(0, Math.min(1, (score || 0) / 100));

/**
 * nodes: [{ id, topics[], companies[], watch[], sources[{id,name}], topicWeights{} }]
 * Each shared feature adds BASE[type] × sqrt(2 / df) (df = how many stories carry it), so a watchlist item that
 * fires on most stories links them only weakly. Topics are further scaled by priority weight / 2 (min 0.5).
 * Keeps each node's top 4 edges at or above MIN_EDGE_WEIGHT (union), about 2n edges.
 */
export function buildGraph(nodes, { topicWeights = {}, minWeight = MIN_EDGE_WEIGHT, topK = TOP_K } = {}) {
  const feats = nodes.map(n => ({
    companies: new Set(n.companies || []), watchlist: new Set(n.watch || []),
    sources: new Set((n.sources || []).map(s => s.id)), topics: new Set(n.topics || [])
  }));
  const df = { companies: new Map(), watchlist: new Map(), sources: new Map(), topics: new Map() };
  for (const f of feats) for (const k of Object.keys(df)) for (const v of f[k]) df[k].set(v, (df[k].get(v) || 0) + 1);
  const srcName = new Map(nodes.flatMap(n => (n.sources || []).map(s => [s.id, s.name])));
  const cand = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    let w = 0; const reasons = { companies: [], watchlist: [], sources: [], topics: [] };
    for (const k of Object.keys(df)) for (const v of feats[i][k]) {
      if (!feats[j][k].has(v)) continue;
      const scale = k === 'topics' ? Math.max(0.5, (topicWeights[v] ?? 1) / 2) : 1;
      w += BASE[k] * scale * Math.sqrt(2 / df[k].get(v));
      reasons[k].push(k === 'sources' ? (srcName.get(v) || String(v)) : v);
    }
    if (w >= minWeight) cand.push({ i, j, w: Math.round(w * 100) / 100, reasons });
  }
  const per = nodes.map(() => []);
  for (const e of cand) { per[e.i].push(e); per[e.j].push(e); }
  const keep = new Set();
  for (const list of per) list.sort((x, y) => y.w - x.w || nodes[x.i].id - nodes[y.i].id || nodes[x.j].id - nodes[y.j].id).slice(0, topK).forEach(e => keep.add(e));
  return [...keep].map(e => ({ a: nodes[e.i].id, b: nodes[e.j].id, weight: e.w, reasons: e.reasons }))
    .sort((x, y) => x.a - y.a || x.b - y.b);
}

// ---------- Barnes–Hut quadtree for repulsion ----------
function buildTree(px, py, n) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (px[i] < x0) x0 = px[i]; if (py[i] < y0) y0 = py[i]; if (px[i] > x1) x1 = px[i]; if (py[i] > y1) y1 = py[i]; }
  const mk = (x, y, size) => ({ x0: x, y0: y, size, n: 0, cx: 0, cy: 0, kids: null, pts: [] });
  const root = mk(x0, y0, Math.max(x1 - x0, y1 - y0, 1) + 1);
  const child = (node, i) => {
    const h = node.size / 2;
    const q = (px[i] >= node.x0 + h ? 1 : 0) + (py[i] >= node.y0 + h ? 2 : 0);
    return node.kids[q] || (node.kids[q] = mk(node.x0 + (q & 1 ? h : 0), node.y0 + (q & 2 ? h : 0), h));
  };
  const insert = (node, i, depth) => {
    while (true) {
      if (!node.kids) {
        if (node.pts.length < 4 || depth >= 20) { node.pts.push(i); return; }
        const old = node.pts; node.pts = []; node.kids = [null, null, null, null];
        for (const p of old) insert(child(node, p), p, depth + 1);
      }
      node = child(node, i); depth++;
    }
  };
  for (let i = 0; i < n; i++) insert(root, i, 0);
  const acc = (node) => {
    if (!node.kids) { node.n = node.pts.length; for (const p of node.pts) { node.cx += px[p]; node.cy += py[p]; } }
    else for (const k of node.kids) if (k) { acc(k); node.n += k.n; node.cx += k.cx * k.n; node.cy += k.cy * k.n; }
    if (node.n) { node.cx /= node.n; node.cy /= node.n; }
  };
  acc(root);
  return root;
}

const STACK = [];
function repel(tree, i, px, py, strength, theta2, out) {
  let top = 0;
  STACK[top++] = tree;
  const xi = px[i], yi = py[i];
  while (top) {
    const node = STACK[--top];
    if (!node.n) continue;
    const dx = node.cx - xi, dy = node.cy - yi;
    let l2 = dx * dx + dy * dy;
    if (!node.kids) {
      const pts = node.pts;
      for (let t = 0; t < pts.length; t++) {
        const j = pts[t];
        if (j === i) continue;
        let ex = px[j] - xi, ey = py[j] - yi, d2 = ex * ex + ey * ey;
        if (d2 < 1) { ex = ((i * 7 + j * 13) % 5 - 2) * 0.1 || 0.1; ey = ((i * 11 + j * 3) % 5 - 2) * 0.1 || -0.1; d2 = 1; }
        out[0] += ex * strength / d2; out[1] += ey * strength / d2;
      }
      continue;
    }
    if (node.size * node.size < theta2 * l2) {
      if (l2 < 1) l2 = 1;
      const k = strength * node.n / l2;
      out[0] += dx * k; out[1] += dy * k;
      continue;
    }
    const kids = node.kids;
    if (kids[0]) STACK[top++] = kids[0];
    if (kids[1]) STACK[top++] = kids[1];
    if (kids[2]) STACK[top++] = kids[2];
    if (kids[3]) STACK[top++] = kids[3];
  }
}

/**
 * Deterministic layout. nodes: [{ id, topic, score }]; edges from buildGraph.
 * prev: { [id]: [x, y] } saved positions. If more than half the nodes have saved positions, those are pinned and only
 * new nodes move (placed next to their most similar positioned neighbour, then `relax` iterations). Otherwise a full
 * `iterations`-step layout runs from golden-angle topic centroids.
 */
export function layout(nodes, edges, { prev = null, iterations = 300, relax = 50 } = {}) {
  const n = nodes.length;
  const ids = nodes.map(d => d.id);
  const rand = mulberry32(seedFor(ids));
  const S = 60 * Math.sqrt(Math.max(n, 1));
  const topics = [...nodes.reduce((m, d) => m.set(d.topic || '', (m.get(d.topic || '') || 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const k = topics.length;
  const anchor = new Map(topics.map((t, i) => {
    const r = k === 1 ? 0 : S * 0.55 * Math.sqrt((i + 0.5) / k);
    return [t, [r * Math.cos(i * GOLDEN_ANGLE), r * Math.sin(i * GOLDEN_ANGLE)]];
  }));
  const index = new Map(ids.map((id, i) => [id, i]));
  const px = new Float64Array(n), py = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  const rad = nodes.map(d => radiusFor(d.score));
  const pinned = new Uint8Array(n);
  const known = prev ? ids.filter(id => Array.isArray(prev[id])).length : 0;
  const incremental = n > 0 && known > n / 2;
  const gauss = () => { const u = Math.max(rand(), 1e-9), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let i = 0; i < n; i++) {
    const [ax, ay] = anchor.get(nodes[i].topic || '');
    px[i] = ax + gauss() * S * 0.12; py[i] = ay + gauss() * S * 0.12;   // always draw, so the stream is stable
    if (incremental && Array.isArray(prev[ids[i]])) { px[i] = prev[ids[i]][0]; py[i] = prev[ids[i]][1]; pinned[i] = 1; }
  }
  const adj = nodes.map(() => []);
  for (const e of edges) { const a = index.get(e.a), b = index.get(e.b); if (a == null || b == null) continue; adj[a].push([b, e.weight]); adj[b].push([a, e.weight]); }
  if (incremental) for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    const best = adj[i].filter(([j]) => pinned[j]).sort((x, y) => y[1] - x[1] || ids[x[0]] - ids[y[0]])[0];
    if (best) { const ang = rand() * Math.PI * 2, d = rad[i] + rad[best[0]] + 12; px[i] = px[best[0]] + Math.cos(ang) * d; py[i] = py[best[0]] + Math.sin(ang) * d; }
  }
  const steps = n === 0 ? 0 : incremental ? (known === n ? 0 : relax) : iterations;
  const maxW = Math.max(1, ...edges.map(e => e.weight));
  const links = edges.map(e => [index.get(e.a), index.get(e.b), e.weight]).filter(([a, b]) => a != null && b != null);
  const deg = new Float64Array(n); for (const [a, b] of links) { deg[a]++; deg[b]++; }
  const strength = -S * S / Math.max(n, 1) * 0.12;
  const theta2 = 1.44; // theta 1.2
  const maxR = Math.max(...rad, 1);
  let alpha = 1;
  const decay = steps ? Math.pow(0.001, 1 / steps) : 1;
  const f = [0, 0];
  let head = new Int32Array(Math.max(16, n * 4));
  const next = new Int32Array(n), cellOf = new Int32Array(n);
  const ax = new Float64Array(n), ay = new Float64Array(n);
  for (let i = 0; i < n; i++) { const a = anchor.get(nodes[i].topic || ''); ax[i] = a[0]; ay[i] = a[1]; }
  for (let it = 0; it < steps; it++) {
    // repulsion (Barnes–Hut)
    const tree = buildTree(px, py, n);
    for (let i = 0; i < n; i++) { if (pinned[i]) continue; f[0] = 0; f[1] = 0; repel(tree, i, px, py, strength, theta2, f); vx[i] += f[0] * alpha; vy[i] += f[1] * alpha; }
    // link springs, stiffer and shorter for heavier edges
    for (const [a, b, w] of links) {
      let dx = px[b] + vx[b] - px[a] - vx[a], dy = py[b] + vy[b] - py[a] - vy[a];
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = rad[a] + rad[b] + 30 + 70 / (1 + w);
      const s = (l - target) / l * alpha * 0.5 * Math.min(1, w / maxW + 0.2);
      dx *= s; dy *= s;
      const bias = deg[a] / (deg[a] + deg[b]);
      if (!pinned[b]) { vx[b] -= dx * bias; vy[b] -= dy * bias; }
      if (!pinned[a]) { vx[a] += dx * (1 - bias); vy[a] += dy * (1 - bias); }
    }
    // pull toward the topic anchor, plus weak centring
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      vx[i] += (ax[i] - px[i]) * 0.06 * alpha - px[i] * 0.004 * alpha;
      vy[i] += (ay[i] - py[i]) * 0.06 * alpha - py[i] * 0.004 * alpha;
    }
    // integrate
    for (let i = 0; i < n; i++) { if (pinned[i]) { vx[i] = vy[i] = 0; continue; } vx[i] *= 0.6; vy[i] *= 0.6; px[i] += vx[i]; py[i] += vy[i]; }
    // collision via a uniform grid (numeric cell keys, no per-step allocation beyond the buckets)
    const cell = 2 * maxR + 4;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { if (px[i] < minX) minX = px[i]; if (py[i] < minY) minY = py[i]; if (px[i] > maxX) maxX = px[i]; if (py[i] > maxY) maxY = py[i]; }
    const cols = Math.floor((maxX - minX) / cell) + 1, rows = Math.floor((maxY - minY) / cell) + 1;
    if (head.length < cols * rows) head = new Int32Array(cols * rows);
    head.fill(-1, 0, cols * rows);
    for (let i = 0; i < n; i++) { const c = Math.floor((px[i] - minX) / cell) * rows + Math.floor((py[i] - minY) / cell); cellOf[i] = c; next[i] = head[c]; head[c] = i; }
    for (let i = 0; i < n; i++) {
      const gx = Math.floor((px[i] - minX) / cell), gy = Math.floor((py[i] - minY) / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cx = gx + ox, cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        for (let j = head[cx * rows + cy]; j !== -1; j = next[j]) {
          if (j <= i) continue;
          let dx = px[j] - px[i], dy = py[j] - py[i];
          const min = rad[i] + rad[j] + 3;
          let l2 = dx * dx + dy * dy;
          if (l2 >= min * min) continue;
          let l = Math.sqrt(l2);
          if (l < 1e-6) { dx = 0.5 - ((i + j) % 2); dy = 0.5 - ((i * j) % 2); l = Math.sqrt(dx * dx + dy * dy); }
          const push = (min - l) / l * 0.7;
          const wi = pinned[i] ? 0 : pinned[j] ? 1 : 0.5, wj = pinned[j] ? 0 : pinned[i] ? 1 : 0.5;
          px[i] -= dx * push * wi; py[i] -= dy * push * wi; px[j] += dx * push * wj; py[j] += dy * push * wj;
        }
      }
    }
    alpha *= decay;
  }
  const positions = {};
  for (let i = 0; i < n; i++) positions[ids[i]] = [Math.round(px[i] * 10) / 10, Math.round(py[i] * 10) / 10];
  return { positions, anchors: Object.fromEntries([...anchor].map(([t, [x, y]]) => [t, [Math.round(x * 10) / 10, Math.round(y * 10) / 10]])), mode: !n ? 'empty' : incremental ? (steps ? 'relaxed' : 'kept') : 'full', iterations: steps, radius: rad, scale: Math.round(S * 10) / 10 };
}

/**
 * Topic clusters from the final positions: centroid (mean of members), radius, count, heat.
 * heat = Σ score/100 of members updated in the last 7 days, normalised so the hottest cluster is 1.
 */
export function clusters(nodes, positions, anchors, { nowMs, recentDays = 7 } = {}) {
  const groups = new Map();
  for (const d of nodes) { const t = d.topic || ''; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(d); }
  const out = [...groups].map(([topic, members]) => {
    const xs = members.map(m => positions[m.id][0]), ys = members.map(m => positions[m.id][1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const radius = Math.max(...members.map(m => Math.hypot(positions[m.id][0] - cx, positions[m.id][1] - cy) + radiusFor(m.score)));
    const recent = members.filter(m => nowMs - (Date.parse(m.updated_at || '') || 0) <= recentDays * 864e5);
    return { topic: topic || null, label: topic || 'Unsorted', count: members.length, x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10,
      anchor: anchors[topic] || null, radius: Math.round(radius * 10) / 10, recent: recent.length,
      mean_score: Math.round(members.reduce((m, d) => m + (d.score || 0), 0) / members.length * 10) / 10,
      heat_raw: Math.round(recent.reduce((m, d) => m + Math.max(0, d.score || 0) / 100, 0) * 1000) / 1000 };
  });
  const hottest = Math.max(0, ...out.map(c => c.heat_raw));
  for (const c of out) c.heat = hottest ? Math.round(c.heat_raw / hottest * 1000) / 1000 : 0;
  return out.sort((a, b) => b.heat - a.heat || b.count - a.count || a.label.localeCompare(b.label));
}
