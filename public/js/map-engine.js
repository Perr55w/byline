// Map engine (council E §4, DECISIONS "Map engine", B amendment 6, C's isobars on the Map only).
// Canvas2D, on-demand: nothing runs unless the camera, a tween or the pointer asks for a frame. No loop.
//
//   loadMap()                          cache-first payload: { data, fresh } (localStorage + ETag revalidation)
//   mountMap(el, opts) → engine        the Map tab's interactive stage
//   mountMiniMap(el, { onOpen }) → { destroy }   a small static drawing of the same layout (Today tile)
//
// Drawing order (E §4): topic regions (pre-rendered once to an offscreen canvas from a density field),
// isobar contours (marching squares over the same field, cached Path2D, hairline at any zoom), edges in
// three weight buckets (one path each), nodes by the quality ramp quantised to 12 steps (one path per step;
// non-colour cues: below the bar = hollow, top tier = an inner halo ring), then the selection last.
// Hit-testing is a uniform world grid. Wheel zooms about the cursor, drag pans with inertia, two pointers
// pinch. Labels: ≤ 20 node labels and ≤ 12 topic labels, pooled DOM moved with transform.
// Colours come from tokens (read with getComputedStyle) and quality.js; nothing literal.

import { qualityColor, qualityTier } from './quality.js';

const CACHE_KEY = 'byline-map-v1';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => matchMedia('(hover: none)').matches;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// motion-canvas resolution, learned per session: starts at 1× and steps down while frames run slow
const LO = { dpr: 0, min: 0.55, fast: 0 };
// resting-canvas resolution cap: 2× unless the sharp redraw after a gesture proves too slow here
const HI = { cap: 2, slow: 0 };

// ====================================================================== data (cache-first, ETag revalidation)
let mem = null;        // { etag, data, checked }
let inflight = null;
function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (v && v.data && Array.isArray(v.data.nodes)) return { etag: v.etag || null, data: v.data, checked: 0 };
  } catch (e) { /* storage unavailable or corrupt */ }
  return null;
}
function writeCache(etag, data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ etag, data, saved: Date.now() })); } catch (e) { /* quota / private mode */ }
}
async function fetchMap(etag) {
  const res = await fetch('/api/map', { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store' });
  if (res.status === 401) { location.href = '/login'; throw new Error('Sign in required'); }
  if (res.status === 304) return { notModified: true };
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Map failed to load (${res.status})`); }
  return { etag: res.headers.get('ETag'), data: await res.json() };
}
/**
 * Cache-first map payload. Returns { data, fresh }: `data` is the cached payload (or null on first ever
 * load); `fresh` resolves with a newer payload when the server's differs, null when unchanged.
 */
export function loadMap({ maxAge = 15000 } = {}) {
  if (!mem) mem = readCache();
  if (mem && mem.checked && Date.now() - mem.checked < maxAge) return { data: mem.data, fresh: Promise.resolve(null) };
  if (!inflight) {
    inflight = fetchMap(mem?.etag).then((r) => {
      inflight = null;
      if (r.notModified) { mem.checked = Date.now(); return null; }
      mem = { etag: r.etag, data: r.data, checked: Date.now() };
      writeCache(r.etag, r.data);
      return r.data;
    }, (e) => { inflight = null; throw e; });
  }
  return mem ? { data: mem.data, fresh: inflight.catch(() => null) } : { data: null, fresh: inflight };
}

// ====================================================================== tokens
function readTokens() {
  // every value is a token from tokens.css (no literal fallbacks: an unset token leaves the canvas default)
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    ink: g('--fd-ink'), hot: g('--fd-hot'), line2: g('--line-2'), line3: g('--line-3'),
    surface: g('--surface-solid'), accent: g('--accent'), focus: g('--focus-c') || g('--accent'),
    text1: g('--text-1'), text3: g('--text-3'),
    night: document.documentElement.dataset.theme === 'night'
  };
}

// Tokens are cached per theme for the session and read only after a frame has rendered (style is clean
// then), so neither a route transition nor a theme switch ever forces a style recalc from here.
const TOK = { theme: null, v: null, waiting: [] };
const themeNow = () => document.documentElement.dataset.theme || 'proof';
function tokens() { return TOK.theme === themeNow() ? TOK.v : null; }
function whenTokens(cb) {
  TOK.waiting.push(cb);
  if (TOK.waiting.length > 1) return;
  requestAnimationFrame(() => setTimeout(() => {
    TOK.v = readTokens(); TOK.theme = themeNow();
    const w = TOK.waiting.splice(0);
    w.forEach(f => { try { f(); } catch (e) { /* engine gone */ } });
  }, 0));
}

// ====================================================================== geometry helpers
function bezierPoint(ax, ay, cx, cy, bx, by, t) {
  const u = 1 - t;
  return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by];
}
/** Control point for a gentle, consistent bow on edge a→b (12% of length, always to the same side). */
function ctrl(ax, ay, bx, by) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
  return [mx - dy * 0.12, my + dx * 0.12];
}
const easeOutExp = (t) => (t >= 1 ? 1 : (1 - Math.exp(-6 * t)) / (1 - Math.exp(-6)));

/** Marching squares over a scalar grid; appends world-space segments to `path` (a Path2D). */
function contour(field, gw, gh, level, x0, y0, cell, path, bb = [0, 0, gw - 1, gh - 1]) {
  let n = 0;
  const lerp = (a, b) => (level - a) / ((b - a) || 1e-6);
  for (let gy = Math.max(0, bb[1]); gy < Math.min(gh - 1, bb[3]); gy++) {
    for (let gx = Math.max(0, bb[0]); gx < Math.min(gw - 1, bb[2]); gx++) {
      const i = gy * gw + gx;
      const a = field[i], b = field[i + 1], c = field[i + gw + 1], d = field[i + gw];
      const k = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (k === 0 || k === 15) continue;
      const X = x0 + gx * cell, Y = y0 + gy * cell;
      const top = [X + cell * lerp(a, b), Y], right = [X + cell, Y + cell * lerp(b, c)];
      const bottom = [X + cell * lerp(d, c), Y + cell], left = [X, Y + cell * lerp(a, d)];
      const seg = (p, q) => { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); n++; };
      switch (k) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 5: seg(left, top); seg(bottom, right); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(left, top); break;
        case 10: seg(left, bottom); seg(top, right); break;
        default: break;
      }
    }
  }
  return n;
}

// text measurement on a detached context, so measuring never forces the document's style
let measureCtx = null;
function measurer() {
  if (!measureCtx) measureCtx = (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')).getContext('2d');
  return measureCtx;
}

// short node label: the server's short title, cut at a word boundary
function labelText(n) {
  const t = String(n.short_title || n.title || `Story ${n.id}`).replace(/…$/, '').trim();
  if (t.length <= 34) return t;
  const cut = t.slice(0, 33);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 18 ? cut.slice(0, sp) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

// ====================================================================== the engine
class MapEngine {
  constructor(host, opts = {}) {
    this.host = host;
    this.o = opts;
    this.mini = !!opts.mini;
    this.canvas = document.createElement('canvas');
    this.canvas.className = this.mini ? 'mm-canvas' : 'map-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    if (this.mini) Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    if (!this.mini) {
      // motion canvas: while the camera moves, frames draw here at a lower, adaptive resolution and the
      // full-resolution canvas fades out; it is redrawn and shown again once everything settles
      this.lo = document.createElement('canvas');
      this.lo.className = 'map-canvas map-canvas--lo';
      this.lo.setAttribute('aria-hidden', 'true');
      this.loCtx = this.lo.getContext('2d');
      host.append(this.lo);
    }
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.cam = { x: 0, y: 0, k: 1 };
    this.fitK = 1;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.N = 0;
    this.sel = -1; this.hover = -1; this.kcur = -1;
    this.nbr = new Set();
    this.raf = 0; this.last = 0;
    this.anim = { fly: null, zoom: null, inertia: null, alpha: false, intro: null };
    this.ptr = { x: 0, y: 0, inside: false, moved: false };
    this.pointers = new Map();
    this.drag = null;
    this.fitted = false;
    this.tok = null; // read lazily at the first draw (never force a style recalc while the route renders)
    this.labelW = new Map();
    this.destroyed = false;

    if (!this.mini) this.buildOverlays();
    this.ro = new ResizeObserver((entries) => this.onResize(entries[0].contentRect));
    this.ro.observe(host);
    this.onTheme = () => { this.tok = null; this.qcol = null; this.regions = null; this.requestDraw(); };
    document.addEventListener('byline:theme', this.onTheme);
    if (!this.mini) this.bindInput();
    if (opts.data) this.setData(opts.data);
  }

  // -------------------------------------------------------------------- DOM overlays (labels, hover card)
  buildOverlays() {
    const mk = (cls, tag = 'div') => { const d = document.createElement(tag); d.className = cls; d.setAttribute('aria-hidden', 'true'); return d; };
    this.topicLayer = mk('map-topic-labels');
    this.labelLayer = mk('map-node-labels');
    this.card = mk('map-card');
    this.card.hidden = true;
    // hover + keyboard rings are DOM, so pointing at a node never redraws the canvas
    this.hring = mk('map-ring'); this.kring = mk('map-ring map-ring--kbd');
    this.host.append(this.hring, this.kring, this.topicLayer, this.labelLayer, this.card);
    this.labelPool = Array.from({ length: 20 }, () => { const s = document.createElement('span'); s.className = 'map-label'; this.labelLayer.append(s); return s; });
    this.topicPool = [];
  }

  // -------------------------------------------------------------------- size
  onResize(r) {
    const w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h) return;
    const first = !this.w;
    this.pendingSize = { w, h };
    clearTimeout(this.rzT);
    // canvases resize only once the box is stable (E §3: the CSS box stretches during the rail tween)
    const apply = this.applySize = () => {
      if (this.destroyed || !this.pendingSize) return;
      const { w: W, h: H } = this.pendingSize;
      this.pendingSize = null;
      this.w = W; this.h = H;
      let dpr = Math.min(this.mini ? 2 : HI.cap, window.devicePixelRatio || 1);
      const maxPx = this.mini ? 0.6e6 : 2.4e6;
      if (W * H * dpr * dpr > maxPx) dpr = Math.max(1, Math.sqrt(maxPx / (W * H)));
      this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      if (!this.mini) { this.canvas.style.width = `${W}px`; this.canvas.style.height = `${H}px`; this.sizeLo(); }
      this.rect = null;
      if (this.N && (!this.fitted || this.mini || !this.userMoved)) this.fit({ animate: false });
      this.requestDraw();
    };
    if (first) apply(); else this.rzT = setTimeout(apply, 140);
  }

  sizeLo() {
    if (!this.lo || !this.w) return;
    if (!LO.dpr) LO.dpr = clamp(Math.sqrt(230000 / (this.w * this.h)), 0.6, 1); // first guess from a pixel budget
    const d = Math.min(this.dpr, LO.dpr);
    this.loDpr = d;
    this.lo.width = Math.max(1, Math.round(this.w * d));
    this.lo.height = Math.max(1, Math.round(this.h * d));
    this.lo.style.width = `${this.w}px`; this.lo.style.height = `${this.h}px`;
  }

  // -------------------------------------------------------------------- data
  setData(d) {
    const keep = this.fitted && this.data && d && this.data.nodes?.length === d.nodes?.length;
    this.data = d;
    const nodes = Array.isArray(d?.nodes) ? d.nodes : [];
    const N = this.N = nodes.length;
    this.nodes = nodes;
    this.th = d?.threshold ?? window.__byline?.threshold ?? 55;
    this.X = new Float32Array(N); this.Y = new Float32Array(N); this.R = new Float32Array(N);
    this.alpha = new Float32Array(N).fill(1); this.alphaT = new Float32Array(N).fill(1);
    this.intro = new Float32Array(N).fill(1);
    this.idx = new Map();
    let maxR = 1;
    nodes.forEach((n, i) => {
      this.X[i] = +n.x || 0; this.Y[i] = +n.y || 0; this.R[i] = +n.r || (5 + 13 * (n.score || 0) / 100);
      if (this.R[i] > maxR) maxR = this.R[i];
      this.idx.set(String(n.id), i);
    });
    this.maxR = maxR;
    // edges + adjacency + weight buckets
    const E = Array.isArray(d?.edges) ? d.edges.filter(e => this.idx.has(String(e.a)) && this.idx.has(String(e.b))) : [];
    this.edges = E;
    this.EA = new Int32Array(E.length); this.EB = new Int32Array(E.length); this.EW = new Float32Array(E.length); this.EK = new Uint8Array(E.length);
    this.adj = Array.from({ length: N }, () => []);
    E.forEach((e, k) => {
      const a = this.idx.get(String(e.a)), b = this.idx.get(String(e.b));
      this.EA[k] = a; this.EB[k] = b; this.EW[k] = +e.weight || 1;
      this.adj[a].push(k); this.adj[b].push(k);
    });
    const ws = [...this.EW].sort((a, b) => a - b);
    const q1 = ws[Math.floor(ws.length * 0.45)] ?? 0, q2 = ws[Math.floor(ws.length * 0.85)] ?? 0;
    for (let k = 0; k < E.length; k++) this.EK[k] = this.EW[k] >= q2 ? 2 : this.EW[k] >= q1 ? 1 : 0;
    // bounds
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < N; i++) {
      x0 = Math.min(x0, this.X[i] - this.R[i]); y0 = Math.min(y0, this.Y[i] - this.R[i]);
      x1 = Math.max(x1, this.X[i] + this.R[i]); y1 = Math.max(y1, this.Y[i] + this.R[i]);
    }
    this.bounds = N ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
    // hit grid (cell = 2 × largest radius, generous so the screen-size floor still hits)
    this.cell = Math.max(24, maxR * 2);
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const key = `${Math.floor(this.X[i] / this.cell)},${Math.floor(this.Y[i] / this.cell)}`;
      (this.grid.get(key) || this.grid.set(key, []).get(key)).push(i);
    }
    // clusters with members (cluster topic = node main topic; null → "Unsorted")
    const cl = Array.isArray(d?.clusters) ? d.clusters : [];
    this.clusters = cl.map((c) => ({ ...c, members: [] }));
    const byTopic = new Map(this.clusters.map(c => [c.topic ?? null, c]));
    nodes.forEach((n, i) => { const c = byTopic.get(n.topic ?? null); if (c) c.members.push(i); });
    this.hot = new Set((d?.hot_topics || []).map(h => h.topic));
    this.qcol = null;
    this.regions = null;
    this.labelW.clear();
    if (this.sel >= 0 && this.sel >= N) this.sel = -1;
    if (this.w && (!keep || this.mini)) this.fit({ animate: false });
    this.requestDraw();
  }

  /** Quantised quality colours: 5 steps below the bar, 7 at and above (12 total), per theme. */
  paletteFor() {
    if (!this.N) { this.qkey = new Int8Array(0); this.qcol = []; return; }
    const th = this.th;
    this.qkey = new Int8Array(this.N);
    this.tier = new Array(this.N);
    const steps = [-30, -24, -18, -12, -6, 0, 2.5, 5, 7.5, 10, 12.5, 15];
    this.qcol = steps.map(s => qualityColor(th + (s < 0 ? s + 3 : s), th));
    this.nodes.forEach((n, i) => {
      const d = (+n.score || 0) - th;
      const k = d < 0 ? clamp(4 - Math.floor(-d / 6.0001), 0, 4) : clamp(5 + Math.floor(d / 2.5), 5, 11);
      this.qkey[i] = k;
      this.tier[i] = qualityTier(+n.score || 0, th);
    });
  }

  // -------------------------------------------------------------------- regions + isobars (pre-rendered)
  buildRegions() {
    if (!this.tok) this.tok = tokens() || readTokens();
    const b = this.bounds;
    const pad = 120;
    const x0 = b.x0 - pad, y0 = b.y0 - pad, bw = (b.x1 - b.x0) + pad * 2, bh = (b.y1 - b.y0) + pad * 2;
    // grid resolution follows the stage size (cheap on phones and in the mini map)
    const cols = this.mini ? clamp(this.w / 2.5, 60, 120) : clamp(this.w / 4, 110, 230);
    const cell = Math.max(4, bw / cols, bh / (cols * 0.7));
    const gw = Math.ceil(bw / cell) + 1, gh = Math.ceil(bh / cell) + 1;
    const tok = this.tok;
    const out = { x0, y0, cell, gw, gh, paths: [], labels: [] };
    const heatOf = (c) => clamp(+c.heat || 0, 0, 1);
    const ink = (tok.ink || '0,0,0').split(',').map(Number), hot = (tok.hot || tok.ink || '0,0,0').split(',').map(Number);
    const coreMax = new Float32Array(gw * gh), haloMax = new Float32Array(gw * gh), owner = new Int16Array(gw * gh).fill(-1);
    const sigma = (i) => 26 + this.R[i] * 1.4;
    const splat = (f, i, bb) => {
      const s = sigma(i), R = s * 3, s2 = 2 * s * s;
      const cx = (this.X[i] - x0) / cell, cy = (this.Y[i] - y0) / cell, rc = R / cell;
      const gx0 = Math.max(0, Math.floor(cx - rc)), gx1 = Math.min(gw - 1, Math.ceil(cx + rc));
      const gy0 = Math.max(0, Math.floor(cy - rc)), gy1 = Math.min(gh - 1, Math.ceil(cy + rc));
      if (bb) { bb[0] = Math.min(bb[0], gx0); bb[1] = Math.min(bb[1], gy0); bb[2] = Math.max(bb[2], gx1); bb[3] = Math.max(bb[3], gy1); }
      for (let gy = gy0; gy <= gy1; gy++) {
        const dy = (gy - cy) * cell, row = gy * gw;
        for (let gx = gx0; gx <= gx1; gx++) { const dx = (gx - cx) * cell; f[row + gx] += Math.exp(-(dx * dx + dy * dy) / s2); }
      }
      return [gx0, gy0, gx1, gy1];
    };
    this.clusters.forEach((c, ci) => {
      if (!c.members.length || c.topic == null) return;
      // a region is two or more same-topic stories near each other; a lone story only gets a faint halo
      const near = 3.2 * 40;
      const core = c.members.filter(i => c.members.some(j => j !== i && Math.hypot(this.X[i] - this.X[j], this.Y[i] - this.Y[j]) < near + this.R[i] + this.R[j]));
      const fc = new Float32Array(gw * gh), fh = new Float32Array(gw * gh);
      const bb = [gw, gh, 0, 0];
      for (const i of core) splat(fc, i, bb);
      const hb = [gw, gh, 0, 0];
      for (const i of c.members) splat(fh, i, hb);
      let best = 0, bi = -1;
      const scan = (f, box, max, cb) => {
        for (let gy = box[1]; gy <= box[3]; gy++) for (let gx = box[0]; gx <= box[2]; gx++) { const k = gy * gw + gx; cb(f[k], k, max); }
      };
      if (core.length) scan(fc, bb, coreMax, (v, k) => { if (v > coreMax[k]) { coreMax[k] = v; owner[k] = ci; } if (v > best) { best = v; bi = k; } });
      scan(fh, hb, haloMax, (v, k) => { if (v > haloMax[k]) { haloMax[k] = v; if (coreMax[k] < 0.2) owner[k] = ci; } if (!core.length && v > best) { best = v; bi = k; } });
      // label anchor: the core's peak (where the topic's stories sit closest together)
      if (bi >= 0) out.labels.push({ ci, x: x0 + (bi % gw) * cell, y: y0 + Math.floor(bi / gw) * cell, peak: best });
      // isobars on the core field: the outer ring marks the region, inner rings show how tightly stories overlap
      if (core.length) {
        const levels = this.mini ? [0.45, 1.25] : [0.45, 1.25, 2.0, 2.9, 3.9];
        levels.forEach((lv, li) => {
          const p = new Path2D();
          if (contour(fc, gw, gh, lv, x0, y0, cell, p, bb)) out.paths.push({ p, ci, li, heat: heatOf(c) });
        });
      }
    });
    // soft region fill: one tinted blob per cluster (owner of the strongest field at each cell)
    const off = document.createElement('canvas');
    off.width = gw; off.height = gh;
    const octx = off.getContext('2d');
    const img = octx.createImageData(gw, gh);
    const base = tok.night ? 0.075 : 0.06, hotA = tok.night ? 0.13 : 0.09;
    const ss = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
    for (let k = 0; k < gw * gh; k++) {
      const ci = owner[k];
      if (ci < 0) continue;
      const c = this.clusters[ci];
      const sm = Math.max(ss(0.3, 1.5, coreMax[k]), ss(0.25, 1, haloMax[k]) * 0.3);
      if (sm <= 0) continue;
      const h = heatOf(c), t = h * 0.85, o = k * 4;
      img.data[o] = ink[0] + (hot[0] - ink[0]) * t;
      img.data[o + 1] = ink[1] + (hot[1] - ink[1]) * t;
      img.data[o + 2] = ink[2] + (hot[2] - ink[2]) * t;
      img.data[o + 3] = Math.round(255 * sm * (base + hotA * h) * (this.mini ? 1.5 : 1));
    }
    octx.putImageData(img, 0, 0);
    out.img = off;
    out.labels.sort((a, b) => this.clusters[b.ci].count - this.clusters[a.ci].count);
    out.labels = out.labels.slice(0, 12);
    this.regions = out;
  }

  // -------------------------------------------------------------------- camera
  fit({ animate = true, pad } = {}) {
    if (!this.w || !this.N) return;
    const b = this.bounds;
    const p = pad ?? (this.mini ? 14 : Math.min(64, this.w * 0.07));
    const ext = this.mini ? 40 : 18; // room for the isobars around the outermost stories
    const bw = Math.max(40, b.x1 - b.x0 + ext * 2), bh = Math.max(40, b.y1 - b.y0 + ext * 2);
    const k = Math.min((this.w - p * 2) / bw, (this.h - p * 2) / bh);
    this.fitK = k;
    this.kMin = Math.min(0.3, k * 0.6);
    this.kMax = Math.max(4, k * 8);
    const target = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, k, fit: true };
    this.userMoved = false;
    this.fitted = true;
    if (animate && !reduced()) this.flyTo(target); else { Object.assign(this.cam, target); this.requestDraw(); }
  }
  flyTo(t, dur = 450) {
    if (!t.fit) this.userMoved = true;
    this.anim.inertia = null; this.anim.zoom = null;
    if (reduced()) { Object.assign(this.cam, t); this.requestDraw(); this.o.onCamera?.(); return; }
    this.anim.fly = { from: { ...this.cam }, to: { x: t.x ?? this.cam.x, y: t.y ?? this.cam.y, k: clamp(t.k ?? this.cam.k, this.kMin, this.kMax) }, t0: performance.now(), dur };
    this.requestDraw();
  }
  /** Zoom by factor about a canvas point (default: centre). Animated (eased) unless reduced motion. */
  zoomBy(f, px = this.w / 2, py = this.h / 2, { smooth = true } = {}) {
    const z = this.anim.zoom;
    const k0 = z ? z.k : this.cam.k;
    const k = clamp(k0 * f, this.kMin, this.kMax);
    // world point under the cursor stays put
    const wx = (px - this.w / 2) / this.cam.k + this.cam.x, wy = (py - this.h / 2) / this.cam.k + this.cam.y;
    this.anim.fly = null; this.anim.inertia = null;
    this.userMoved = true;
    if (!smooth || reduced()) { this.setZoom(k, px, py, wx, wy); this.requestDraw(); this.o.onCamera?.(); return; }
    this.anim.zoom = { k, px, py, wx, wy };
    this.requestDraw();
  }
  setZoom(k, px, py, wx, wy) {
    this.cam.k = k;
    this.cam.x = wx - (px - this.w / 2) / k;
    this.cam.y = wy - (py - this.h / 2) / k;
  }
  panBy(dx, dy) { this.userMoved = true; this.cam.x -= dx / this.cam.k; this.cam.y -= dy / this.cam.k; this.requestDraw(); }
  panAnimated(dx, dy) { this.flyTo({ x: this.cam.x - dx / this.cam.k, y: this.cam.y - dy / this.cam.k }, 300); }
  reset() { this.fit({ animate: true }); }
  screenOf(i) { return { x: (this.X[i] - this.cam.x) * this.cam.k + this.w / 2, y: (this.Y[i] - this.cam.y) * this.cam.k + this.h / 2 }; }
  worldOf(px, py) { return { x: (px - this.w / 2) / this.cam.k + this.cam.x, y: (py - this.h / 2) / this.cam.k + this.cam.y }; }
  /** Screen radius: world radius scaled sub-linearly with zoom, normalised so the fitted view reads well. */
  rs(i) {
    const s0 = clamp(this.fitK * 1.15, 0.55, 1.3) * (this.mini ? 0.85 : 1);
    return clamp(this.R[i] * s0 * Math.pow(this.cam.k / this.fitK, 0.6), this.mini ? 1.6 : 2.6, 44);
  }
  /** Bring node i into view (centred if it is off-screen or under the edges). */
  reveal(i, { zoom = false } = {}) {
    const s = this.screenOf(i), m = 60;
    const k = zoom ? Math.max(this.cam.k, this.fitK * 1.6) : this.cam.k;
    if (zoom || s.x < m || s.y < m || s.x > this.w - m || s.y > this.h - m) this.flyTo({ x: this.X[i], y: this.Y[i], k });
  }
  focusCluster(topic) {
    const c = this.clusters.find(x => (x.topic ?? null) === topic);
    if (!c || !c.members.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of c.members) { x0 = Math.min(x0, this.X[i] - this.R[i]); y0 = Math.min(y0, this.Y[i] - this.R[i]); x1 = Math.max(x1, this.X[i] + this.R[i]); y1 = Math.max(y1, this.Y[i] + this.R[i]); }
    const p = 90, bw = Math.max(120, x1 - x0), bh = Math.max(120, y1 - y0);
    const k = clamp(Math.min((this.w - p * 2) / bw, (this.h - p * 2) / bh), this.kMin, Math.min(this.kMax, this.fitK * 3));
    this.flyTo({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, k });
  }

  // -------------------------------------------------------------------- filters / selection
  /** match(node) → boolean; non-matching nodes fade to .1 (positions never change). */
  setFilter(match) {
    for (let i = 0; i < this.N; i++) this.alphaT[i] = !match || match(this.nodes[i]) ? 1 : 0.1;
    if (reduced()) this.alpha.set(this.alphaT); else this.anim.alpha = true;
    if (this.hover >= 0 && this.alphaT[this.hover] < 0.5) this.setHover(-1);
    this.requestDraw();
  }
  visible(i) { return this.alphaT[i] > 0.5; }
  select(id, { reveal = true } = {}) {
    const i = id == null ? -1 : (this.idx.get(String(id)) ?? -1);
    this.sel = i;
    this.nbr = new Set();
    if (i >= 0) for (const k of this.adj[i]) this.nbr.add(this.EA[k] === i ? this.EB[k] : this.EA[k]);
    if (i >= 0 && reveal) this.reveal(i);
    if (this.card && i >= 0 && this.hover === i) this.paintCard(i);
    this.requestDraw();
    return i >= 0 ? this.nodes[i] : null;
  }
  setCursor(id) { this.kcur = id == null ? -1 : (this.idx.get(String(id)) ?? -1); if (this.kcur >= 0) this.reveal(this.kcur); this.placeRings(); }
  setShowCursor(on) { this.showCursor = !!on; this.placeRings(); }
  node(id) { const i = this.idx.get(String(id)); return i == null ? null : this.nodes[i]; }
  /** Neighbours of id with the connecting edge: [{ node, edge }]. */
  related(id) {
    const i = this.idx.get(String(id));
    if (i == null) return [];
    return this.adj[i].map(k => ({ node: this.nodes[this.EA[k] === i ? this.EB[k] : this.EA[k]], edge: this.edges[k] }));
  }
  /** Nearest visible node from `id` in direction dir ('left'|'right'|'up'|'down'); keyboard twin (F §5). */
  nearest(id, dir) {
    const i = id == null ? -1 : (this.idx.get(String(id)) ?? -1);
    if (i < 0) {
      // start from the best visible node nearest the view centre
      let best = -1, bd = Infinity;
      for (let j = 0; j < this.N; j++) {
        if (!this.visible(j)) continue;
        const dx = this.X[j] - this.cam.x, dy = this.Y[j] - this.cam.y, d = Math.hypot(dx, dy) - (this.nodes[j].score || 0) * 2;
        if (d < bd) { bd = d; best = j; }
      }
      return best >= 0 ? this.nodes[best] : null;
    }
    const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir] || [1, 0];
    let best = -1, bs = Infinity;
    for (let j = 0; j < this.N; j++) {
      if (j === i || !this.visible(j)) continue;
      const dx = this.X[j] - this.X[i], dy = this.Y[j] - this.Y[i];
      const along = dx * v[0] + dy * v[1];
      if (along <= 0.5) continue;
      const across = Math.abs(dx * v[1] - dy * v[0]);
      if (across > along * 2.2) continue;
      const s = along + across * 2.2;
      if (s < bs) { bs = s; best = j; }
    }
    return best >= 0 ? this.nodes[best] : null;
  }
  /** Cluster centres in canvas px (for background ripples). */
  clusterPoints() {
    if (!this.regions) this.buildRegions();
    return this.regions.labels.map((l) => {
      const c = this.clusters[l.ci];
      return { topic: c.topic, heat: +c.heat || 0, x: (l.x - this.cam.x) * this.cam.k + this.w / 2, y: (l.y - this.cam.y) * this.cam.k + this.h / 2 };
    });
  }

  // -------------------------------------------------------------------- hit testing
  hit(px, py) {
    if (!this.N) return -1;
    const w = this.worldOf(px, py);
    const cx = Math.floor(w.x / this.cell), cy = Math.floor(w.y / this.cell);
    const tol = (coarse() ? 10 : 4) / this.cam.k;
    let best = -1, bd = Infinity;
    // the screen-size floor can make a node bigger than its world radius; search a wider ring when zoomed out
    const ring = Math.max(1, Math.ceil((42 / this.cam.k) / this.cell));
    for (let gy = cy - ring; gy <= cy + ring; gy++) {
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        const list = this.grid.get(`${gx},${gy}`);
        if (!list) continue;
        for (const i of list) {
          if (!this.visible(i)) continue;
          const d = Math.hypot(this.X[i] - w.x, this.Y[i] - w.y);
          const r = this.rs(i) / this.cam.k + tol;
          if (d <= r && d - r < bd) { bd = d - r; best = i; }
        }
      }
    }
    return best;
  }

  // -------------------------------------------------------------------- input
  bindInput() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const pos = (e) => {
      if (!this.rect) this.rect = c.getBoundingClientRect(); // cached; refreshed on enter/down/scroll/resize
      return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
    };
    this.onScroll = () => { this.rect = null; };
    addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    c.addEventListener('pointerenter', () => { this.rect = null; this.ptr.inside = true; });
    c.addEventListener('pointerleave', () => { this.ptr.inside = false; if (!this.drag) this.setHover(-1); });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.rect = null;
      const p = pos(e);
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, p);
      this.anim.inertia = null; this.anim.fly = null;
      if (this.pointers.size === 1) {
        this.drag = { x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, samples: [{ x: p.x, y: p.y, t: e.timeStamp }] };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, k: this.cam.k };
        if (this.drag) this.drag.moved = true;
      }
      this.setHover(-1);
    });
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      this.ptr.x = p.x; this.ptr.y = p.y;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const w = this.worldOf(this.pinch.mx, this.pinch.my);
        this.setZoom(clamp(this.pinch.k * d / this.pinch.d, this.kMin, this.kMax), mx, my, w.x, w.y);
        this.pinch.mx = mx; this.pinch.my = my; this.pinch.k = this.cam.k; this.pinch.d = d;
        this.requestDraw();
        return;
      }
      if (this.drag && this.pointers.has(e.pointerId)) {
        const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
        if (!this.drag.moved && Math.hypot(p.x - this.drag.sx, p.y - this.drag.sy) > 4) { this.drag.moved = true; this.userMoved = true; this.host.classList.add('is-dragging'); }
        if (this.drag.moved) {
          this.cam.x -= dx / this.cam.k; this.cam.y -= dy / this.cam.k;
          this.requestDraw();
        }
        this.drag.x = p.x; this.drag.y = p.y;
        const s = this.drag.samples; s.push({ x: p.x, y: p.y, t: e.timeStamp });
        while (s.length > 2 && e.timeStamp - s[0].t > 80) s.shift();
        return;
      }
      // hover: one hit-test per frame from the latest pointer position, no canvas redraw
      if (e.pointerType === 'mouse' && !this.hoverRaf && !this.host.classList.contains('is-moving')) {
        this.hoverRaf = requestAnimationFrame(() => { this.hoverRaf = 0; if (!this.destroyed && !this.drag) this.setHover(this.ptr.inside ? this.hit(this.ptr.x, this.ptr.y) : -1); });
      }
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; if (this.pointers.size) { const [q] = [...this.pointers.values()]; if (this.drag) { this.drag.x = q.x; this.drag.y = q.y; this.drag.samples = [{ x: q.x, y: q.y, t: e.timeStamp }]; } return; } }
      const d = this.drag;
      this.drag = null;
      this.host.classList.remove('is-dragging');
      if (!d) return;
      if (!d.moved && e.type === 'pointerup') {
        const p = pos(e);
        const i = this.hit(p.x, p.y);
        this.o.onPick?.(i >= 0 ? this.nodes[i] : null, { pointerType: e.pointerType });
        return;
      }
      // inertia from the last 80 ms of movement
      const s = d.samples, a = s[0], b = s[s.length - 1];
      const dt = Math.max(1, b.t - a.t);
      const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
      if (!reduced() && Math.hypot(vx, vy) > 0.05 && e.timeStamp - b.t < 60) { this.anim.inertia = { vx, vy }; this.requestDraw(); } else this.o.onCamera?.();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.rect) this.rect = c.getBoundingClientRect();
      const px = e.clientX - this.rect.left, py = e.clientY - this.rect.top;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
      this.zoomBy(f, px, py);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => { const p = pos(e); this.zoomBy(2, p.x, p.y); });
  }
  setHover(i) {
    if (i === this.hover) return;
    this.hover = i;
    this.canvas.style.cursor = i >= 0 ? 'pointer' : '';
    if (this.card) this.paintCard(i);
    this.placeRings();
    this.o.onHover?.(i >= 0 ? this.nodes[i] : null);
    // labels: the hovered node earns one (cheap DOM pass, no canvas redraw)
    if (this.labelPool && !this.host.classList.contains('is-moving')) this.placeLabels();
  }
  placeRings() {
    if (!this.hring) return;
    const put = (el, i, pad, show) => {
      if (!show || i < 0) { el.classList.remove('on'); return; }
      const s = this.screenOf(i), r = this.rs(i) + pad, d = Math.round(r * 2);
      if (el.dataset.d !== String(d)) { el.dataset.d = String(d); el.style.width = el.style.height = `${d}px`; }
      el.style.transform = `translate3d(${Math.round(s.x - d / 2)}px, ${Math.round(s.y - d / 2)}px, 0)`;
      el.classList.add('on');
    };
    put(this.hring, this.hover, 3.5, this.hover !== this.sel);
    put(this.kring, this.kcur, 8, !!this.showCursor);
  }

  // -------------------------------------------------------------------- hover card (pooled; flips by arithmetic)
  paintCard(i) {
    const card = this.card;
    if (i < 0 || i === this.sel || coarse() || this.drag) { card.hidden = true; card.classList.remove('on'); return; }
    const n = this.nodes[i];
    if (this.o.cardHTML) card.innerHTML = this.o.cardHTML(n);
    card.hidden = false;
    this.cardSize = { w: card.offsetWidth, h: card.offsetHeight };
    this.placeCard();
    card.classList.add('on');
  }
  placeCard() {
    const i = this.hover;
    if (i < 0 || !this.card || this.card.hidden) return;
    const s = this.screenOf(i), r = this.rs(i), { w, h } = this.cardSize || { w: 280, h: 120 };
    let x = s.x + r + 14, y = s.y - h / 2;
    if (x + w > this.w - 10) x = s.x - r - 14 - w;
    if (x < 10) x = clamp(s.x - w / 2, 10, this.w - w - 10);
    y = clamp(y, 10, this.h - h - 10);
    this.card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  // -------------------------------------------------------------------- frame loop (on demand only)
  requestDraw() {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  /** Draw now (no rAF) — used by the mini map and for the first paint. */
  drawNow() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } this.frame(performance.now()); }
  frame(now) {
    this.raf = 0;
    if (this.destroyed || !this.w || !this.N && !this.data) return;
    const dt = this.last ? Math.min(64, now - this.last) : 16;
    this.last = now;
    let more = false;
    const A = this.anim;
    if (A.fly) {
      const t = Math.min(1, (now - A.fly.t0) / A.fly.dur), e = easeOutExp(t), f = A.fly.from, to = A.fly.to;
      this.cam.k = Math.exp(Math.log(f.k) + (Math.log(to.k) - Math.log(f.k)) * e);
      this.cam.x = f.x + (to.x - f.x) * e; this.cam.y = f.y + (to.y - f.y) * e;
      if (t >= 1) { A.fly = null; this.o.onCamera?.(); } else more = true;
    }
    if (A.zoom) {
      const z = A.zoom, a = 1 - Math.exp(-dt / 70);
      const k = Math.exp(Math.log(this.cam.k) + (Math.log(z.k) - Math.log(this.cam.k)) * a);
      if (Math.abs(Math.log(k / z.k)) < 0.002) { this.setZoom(z.k, z.px, z.py, z.wx, z.wy); A.zoom = null; this.o.onCamera?.(); } else { this.setZoom(k, z.px, z.py, z.wx, z.wy); more = true; }
    }
    if (A.inertia) {
      const v = A.inertia;
      this.cam.x -= (v.vx * dt) / this.cam.k; this.cam.y -= (v.vy * dt) / this.cam.k;
      const decay = Math.exp(-dt / 325);
      v.vx *= decay; v.vy *= decay;
      if (Math.hypot(v.vx, v.vy) < 0.02) { A.inertia = null; this.o.onCamera?.(); } else more = true;
    }
    if (A.alpha) {
      const a = 1 - Math.exp(-dt / 90);
      let busy = false;
      for (let i = 0; i < this.N; i++) {
        const d = this.alphaT[i] - this.alpha[i];
        if (Math.abs(d) > 0.01) { this.alpha[i] += d * a; busy = true; } else this.alpha[i] = this.alphaT[i];
      }
      if (busy) more = true; else A.alpha = false;
    }
    if (A.intro) {
      const t = now - A.intro.t0;
      const step = Math.min(10, 600 / Math.max(1, this.N));
      let busy = false;
      for (let r = 0; r < this.N; r++) {
        const i = A.intro.order[r];
        const p = clamp((t - r * step) / 420, 0, 1);
        this.intro[i] = p * p * (3 - 2 * p);
        if (p < 1) busy = true;
      }
      A.intro.edges = clamp((t - 250) / 700, 0, 1);
      A.intro.region = clamp(t / 700, 0, 1);
      if (busy || A.intro.edges < 1 || A.intro.region < 1) more = true; else { A.intro = null; this.intro.fill(1); }
    }
    // only camera motion uses the motion canvas; fades (intro, filters) draw sharp
    const moving = !this.mini && !!this.lo && !!(A.fly || A.zoom || A.inertia || (this.drag && this.drag.moved) || this.pinch);
    if (moving) {
      // adapt the motion resolution to what this device sustains (median of the last 3 intervals)
      // step down after 2 slow intervals within 8 (learned once per session)
      const iv = this.motionIv || (this.motionIv = []);
      if (this.prevMoving) { iv.push(dt); if (iv.length > 8) iv.shift(); }
      if (iv.filter(t => t > 24).length >= 2 && LO.dpr > LO.min) { LO.dpr = Math.max(LO.min, LO.dpr * 0.8); iv.length = 0; this.sizeLo(); }
      this.o.onMotion?.();
      this.draw(this.loCtx, this.loDpr, this.lo);
      if (this.state !== 'lo') { this.state = 'lo'; this.host.classList.add('is-moving'); }
      this.sharp = false;
      clearTimeout(this.settleT);
      this.settleT = setTimeout(() => { this.sharp = true; this.requestDraw(); }, 200);
    } else if (this.state === 'lo' && !this.sharp) {
      this.draw(this.loCtx, this.loDpr, this.lo); // still for < 200 ms: keep the motion frame
    } else {
      this.draw(this.ctx, this.dpr, this.canvas);
      if (this.state === 'lo') {
        this.state = 'hi'; this.host.classList.remove('is-moving'); this.motionIv = null;
        // one probe frame: if the sharp redraw keeps costing > 45 ms, lower the resting resolution
        const t0 = now;
        requestAnimationFrame((t1) => {
          if (this.destroyed) return;
          if (t1 - t0 > 45) HI.slow++; else HI.slow = Math.max(0, HI.slow - 1);
          if (HI.slow >= 2 && HI.cap > 1 && this.dpr > 1) { HI.cap = Math.max(1, Math.min(this.dpr, HI.cap) - 0.5); HI.slow = 0; this.pendingSize = { w: this.w, h: this.h }; this.applySize(); }
        });
      }
      this.sharp = false;
    }
    this.prevMoving = moving;
    if (!this.mini) {
      if (moving || (this.state === 'lo' && !this.sharp)) this.shiftLabels();
      else { this.placeLabels(); this.placeCard(); this.placeRings(); }
      this.o.onFrame?.();
    }
    if (more) this.requestDraw();
  }
  /** Fade the nodes in (10 ms stagger, oldest first), then draw the edges (C §2). */
  introduce() {
    if (reduced() || !this.N) return;
    const order = [...this.nodes.keys()].sort((a, b) => (Date.parse(this.nodes[a].first_seen || 0) || 0) - (Date.parse(this.nodes[b].first_seen || 0) || 0));
    this.anim.intro = { t0: performance.now(), order, edges: 0, region: 0 };
    this.intro.fill(0);
    this.requestDraw();
  }

  // -------------------------------------------------------------------- draw
  /** lod: motion frames skip the isobars, draw straight edges and plain discs (cheap raster). */
  draw(ctx = this.ctx, dpr = this.dpr, canvas = this.canvas, lod = false) {
    if (!this.tok) {
      this.tok = tokens();
      if (!this.tok) { whenTokens(() => { if (!this.destroyed) { this.regions = null; this.requestDraw(); } }); return; }
    }
    if (!this.qcol) this.paletteFor();
    const k = this.cam.k, tok = this.tok;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.N) return;
    if (!this.regions) this.buildRegions();
    const R = this.regions;
    const intro = this.anim.intro;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (this.w / 2 - this.cam.x * k), dpr * (this.h / 2 - this.cam.y * k));
    // visible world rect (+ margin) for culling
    const vx0 = this.cam.x - this.w / 2 / k - 50, vx1 = this.cam.x + this.w / 2 / k + 50;
    const vy0 = this.cam.y - this.h / 2 / k - 50, vy1 = this.cam.y + this.h / 2 / k + 50;
    const regionA = intro ? intro.region : 1;
    const hasSel = this.sel >= 0;
    // 1. regions
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = regionA;
    ctx.drawImage(R.img, R.x0 - R.cell / 2, R.y0 - R.cell / 2, R.gw * R.cell, R.gh * R.cell);
    // 2. isobars (hairline in screen space)
    ctx.lineWidth = (this.mini ? 0.8 : 1) / k;
    ctx.lineCap = 'round';
    const inkA = tok.night ? [0.2, 0.13, 0.1, 0.08, 0.07] : [0.17, 0.11, 0.085, 0.07, 0.06];
    if (!lod) for (const P of R.paths) {
      const h = P.heat, a = inkA[P.li] * (this.mini ? 1.25 : 1) * regionA;
      ctx.strokeStyle = h > 0.45 ? `rgba(${tok.hot},${(a * (0.9 + h)).toFixed(3)})` : `rgba(${tok.ink},${a.toFixed(3)})`;
      ctx.globalAlpha = 1;
      ctx.stroke(P.p);
    }
    // 3. edges, 3 weight buckets; below zoom 0.6 × fit only the selection's edges
    const E = this.edges.length;
    const edgeP = intro ? intro.edges : 1;
    const showAll = this.mini || k >= this.fitK * 0.6 || k >= 0.6;
    if (edgeP > 0 && E && showAll) {
      const widths = this.mini ? [0.6, 0.8, 1.1] : [0.8, 1.2, 1.9];
      const cols = [tok.line2, tok.line3, tok.line3];
      // group by (bucket, alpha step)
      const groups = new Map();
      for (let e = 0; e < E; e++) {
        const a = this.EA[e], b = this.EB[e];
        if (hasSel && (a === this.sel || b === this.sel)) continue;
        const ax = this.X[a], ay = this.Y[a], bx = this.X[b], by = this.Y[b];
        if ((ax < vx0 && bx < vx0) || (ax > vx1 && bx > vx1) || (ay < vy0 && by < vy0) || (ay > vy1 && by > vy1)) continue;
        let al = Math.min(this.alpha[a], this.alpha[b]) * (hasSel ? 0.35 : 1);
        if (al < 0.05) continue;
        const key = this.EK[e] * 16 + Math.round(al * 10);
        (groups.get(key) || groups.set(key, []).get(key)).push(e);
      }
      ctx.lineCap = 'round';
      for (const [key, list] of groups) {
        const bucket = key >> 4, al = (key & 15) / 10;
        ctx.globalAlpha = al;
        ctx.strokeStyle = cols[bucket];
        ctx.lineWidth = widths[bucket] / k;
        ctx.beginPath();
        if (lod) for (const e of list) { ctx.moveTo(this.X[this.EA[e]], this.Y[this.EA[e]]); ctx.lineTo(this.X[this.EB[e]], this.Y[this.EB[e]]); }
        else for (const e of list) this.edgePath(ctx, e, edgeP);
        ctx.stroke();
      }
    }
    // 4. nodes, grouped by (colour step, alpha step, kind)
    const groups = new Map();
    for (let i = 0; i < this.N; i++) {
      const x = this.X[i], y = this.Y[i];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      if (hasSel && (i === this.sel || this.nbr.has(i))) continue;
      let al = this.alpha[i] * this.intro[i] * (hasSel ? 0.32 : 1);
      if (al < 0.03) continue;
      const kind = this.tier[i] === 'below' ? 0 : this.tier[i] === 'top' ? 2 : 1;
      const key = (this.qkey[i] * 16 + Math.round(al * 10)) * 4 + kind;
      (groups.get(key) || groups.set(key, []).get(key)).push(i);
    }
    for (const [key, list] of groups) this.nodeGroup(ctx, list, key & 3, this.qcol[(key >> 2) >> 4], ((key >> 2) & 15) / 10, lod);
    // 5. selection last: its edges in accent, neighbours at full strength, the node with a ring
    if (hasSel) {
      const s = this.sel;
      ctx.globalAlpha = 0.7 * Math.min(1, edgeP * 1.2);
      ctx.strokeStyle = tok.accent;
      ctx.lineWidth = 1.6 / k;
      ctx.beginPath();
      for (const e of this.adj[s]) this.edgePath(ctx, e, edgeP);
      ctx.stroke();
      const nb = [...this.nbr];
      const byKey = new Map();
      for (const i of nb) {
        const kind = this.tier[i] === 'below' ? 0 : this.tier[i] === 'top' ? 2 : 1;
        const key = this.qkey[i] * 4 + kind;
        (byKey.get(key) || byKey.set(key, []).get(key)).push(i);
      }
      for (const [key, list] of byKey) this.nodeGroup(ctx, list, key & 3, this.qcol[key >> 2], Math.max(0.35, Math.min(...list.map(i => this.alpha[i] * this.intro[i]))));
      const sk = this.tier[s] === 'below' ? 0 : this.tier[s] === 'top' ? 2 : 1;
      // soft light pool under the selection (Glass's light reaction, in accent)
      const r = this.rs(s) / k;
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = tok.accent;
      ctx.beginPath(); ctx.arc(this.X[s], this.Y[s], r + 12 / k, 0, Math.PI * 2); ctx.fill();
      this.nodeGroup(ctx, [s], sk, this.qcol[this.qkey[s]], 1);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tok.accent;
      ctx.lineWidth = 2 / k;
      ctx.beginPath(); ctx.arc(this.X[s], this.Y[s], r + 4.5 / k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  edgePath(ctx, e, p = 1) {
    const a = this.EA[e], b = this.EB[e];
    const ax = this.X[a], ay = this.Y[a], bx = this.X[b], by = this.Y[b];
    const [cx, cy] = ctrl(ax, ay, bx, by);
    ctx.moveTo(ax, ay);
    if (p >= 1) { ctx.quadraticCurveTo(cx, cy, bx, by); return; }
    // de Casteljau split at p
    const qx = ax + (cx - ax) * p, qy = ay + (cy - ay) * p;
    const [ex, ey] = bezierPoint(ax, ay, cx, cy, bx, by, p);
    ctx.quadraticCurveTo(qx, qy, ex, ey);
  }
  /** kind 0 = below the bar (hollow), 1 = clears/strong (filled), 2 = top (filled + inner halo ring). */
  nodeGroup(ctx, list, kind, col, alpha, lod = false) {
    const k = this.cam.k, tok = this.tok;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const i of list) { const r = this.rs(i) / k; ctx.moveTo(this.X[i] + r, this.Y[i]); ctx.arc(this.X[i], this.Y[i], r, 0, Math.PI * 2); }
    if (lod) {
      if (kind === 0) { ctx.strokeStyle = col; ctx.lineWidth = 1.6 / k; ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); }
      return;
    }
    if (kind === 0) {
      ctx.fillStyle = tok.surface; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = (this.mini ? 1 : 1.6) / k; ctx.stroke();
      return;
    }
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = tok.surface; ctx.lineWidth = (this.mini ? 0.8 : 1.5) / k; ctx.stroke();
    if (kind === 2) {
      ctx.beginPath();
      for (const i of list) { const r = this.rs(i) / k + (this.mini ? 1.8 : 3.5) / k; ctx.moveTo(this.X[i] + r, this.Y[i]); ctx.arc(this.X[i], this.Y[i], r, 0, Math.PI * 2); }
      ctx.globalAlpha = alpha * 0.55; ctx.strokeStyle = col; ctx.lineWidth = 1 / k; ctx.stroke();
    }
  }

  // -------------------------------------------------------------------- labels (pooled DOM, transform only)
  measure(text, font) {
    const key = font + '|' + text;
    let w = this.labelW.get(key);
    if (w == null) { const m = measurer(); if (m.font !== font) m.font = font; w = m.measureText(text).width; this.labelW.set(key, w); }
    return w;
  }
  /** While the camera moves: a pure pan slides the label layers as one composited transform; a zoom hides them. */
  shiftLabels() {
    const L = this.lblCam;
    if (!L || !this.labelLayer) return;
    if (Math.abs(this.cam.k - L.k) < 1e-6) {
      const dx = Math.round((L.x - this.cam.x) * this.cam.k), dy = Math.round((L.y - this.cam.y) * this.cam.k);
      const t = `translate3d(${dx}px, ${dy}px, 0)`;
      this.labelLayer.style.transform = t; this.topicLayer.style.transform = t;
    } else if (!this.host.classList.contains('labels-off')) this.host.classList.add('labels-off');
    if (this.card && !this.card.hidden) { this.card.hidden = true; this.card.classList.remove('on'); this.hover = -1; }
    this.hring.classList.remove('on'); this.kring.classList.remove('on');
  }
  placeLabels() {
    if (!this.labelPool || !this.N) return;
    this.lblCam = { x: this.cam.x, y: this.cam.y, k: this.cam.k };
    if (this.labelLayer.style.transform) { this.labelLayer.style.transform = ''; this.topicLayer.style.transform = ''; }
    this.host.classList.remove('labels-off');
    const placed = [];
    const hitR = (r, q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y;
    const inView = (r) => r.x > 4 && r.y > 4 && r.x + r.w < this.w - 4 && r.y + r.h < this.h - 4;
    // node discs (visible ones) block every label; candidates for node labels: selection, hover,
    // neighbours first, then the biggest by score with a screen radius ≥ 10 px (E §4)
    const discs = [], cand = [];
    for (let i = 0; i < this.N; i++) {
      if (this.alpha[i] < 0.6 || this.intro[i] < 0.6) continue;
      const s = this.screenOf(i), rs = this.rs(i);
      if (s.x < -20 || s.y < -20 || s.x > this.w + 20 || s.y > this.h + 20) continue;
      const d = { x: s.x - rs - 2, y: s.y - rs - 2, w: rs * 2 + 4, h: rs * 2 + 4 };
      discs.push(d);
      const pri = i === this.sel ? 3 : i === this.hover ? 2.5 : this.nbr.has(i) ? 2 : (this.sel < 0 && (rs >= 10 || (this.nodes[i].score || 0) >= this.th) ? 1 : 0);
      if (pri > 0) cand.push({ i, s, rs, pri, d });
    }
    const free = (r, self) => inView(r) && !placed.some(q => hitR(r, q)) && !discs.some(d => d !== self && hitR(r, d));
    // node labels (≤ 20), greedy: right, left, below, above. Selection, hover, neighbours and stories
    // above the bar claim their spot before the topic labels; the rest fill in after.
    cand.sort((a, b) => b.pri - a.pri || (this.nodes[b.i].score || 0) - (this.nodes[a.i].score || 0));
    const fN = '500 12px Geist, system-ui, sans-serif';
    let used = 0;
    const placeNodes = (list) => { for (const c of list) {
      if (used >= this.labelPool.length) break;
      const n = this.nodes[c.i];
      const text = labelText(n);
      const w = Math.ceil(this.measure(text, fN)) + 2, h = 16, g = 6;
      const dg = c.rs * 0.72;
      const opts = [[c.s.x + c.rs + g, c.s.y - h / 2], [c.s.x - c.rs - g - w, c.s.y - h / 2], [c.s.x - w / 2, c.s.y + c.rs + 4], [c.s.x - w / 2, c.s.y - c.rs - 4 - h],
        [c.s.x + dg + 4, c.s.y - dg - h], [c.s.x + dg + 4, c.s.y + dg], [c.s.x - dg - 4 - w, c.s.y - dg - h], [c.s.x - dg - 4 - w, c.s.y + dg]];
      let r = null;
      for (const [x, y] of opts) { const q = { x, y, w, h }; if (free(q, c.d)) { r = q; break; } }
      if (!r) continue;
      placed.push(r);
      const el = this.labelPool[used++];
      if (el.dataset.id !== String(n.id)) { el.dataset.id = String(n.id); el.textContent = text; }
      el.classList.toggle('is-sel', c.i === this.sel);
      el.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`;
      el.classList.add('on');
    } };
    const first = cand.filter(c => c.pri >= 2 || (this.nodes[c.i].score || 0) >= this.th);
    placeNodes(first);
    // topic labels (≤ 12): at the region's peak, nudged off nodes
    const tl = this.regions ? this.regions.labels : [];
    while (this.topicPool.length < tl.length) { const s = document.createElement('span'); s.className = 'map-topic'; s.innerHTML = '<b></b><i></i>'; this.topicLayer.append(s); this.topicPool.push(s); }
    const fT = '500 12px Geist, system-ui, sans-serif', fC = '500 11px "Geist Mono", ui-monospace, monospace';
    tl.forEach((l, j) => {
      const el = this.topicPool[j], c = this.clusters[l.ci];
      const name = c.label || c.topic;
      const w = Math.ceil(this.measure(name, fT) + this.measure(String(c.count), fC) + 26), h = 22;
      const x = (l.x - this.cam.x) * this.cam.k + this.w / 2 - w / 2, y = (l.y - this.cam.y) * this.cam.k + this.h / 2 - h / 2;
      const tries = [[0, 0], [0, -30], [0, 30], [-w / 2 - 14, 0], [w / 2 + 14, 0], [0, -56], [0, 56]];
      let r = null;
      for (const [dx, dy] of tries) { const q = { x: x + dx, y: y + dy, w, h }; if (free(q)) { r = q; break; } }
      const faded = this.topicFade?.(c) ?? false;
      if (el.dataset.t !== name) { el.dataset.t = name; el.firstChild.textContent = name; el.lastChild.textContent = c.count; el.classList.toggle('is-hot', this.hot.has(c.topic)); }
      if (r) { placed.push(r); el.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`; }
      el.classList.toggle('on', !!r && !faded);
      el.classList.toggle('dim', !!r && faded);
    });
    for (let j = tl.length; j < this.topicPool.length; j++) this.topicPool[j].classList.remove('on', 'dim');
    placeNodes(cand.filter(c => !first.includes(c)));
    for (let j = used; j < this.labelPool.length; j++) this.labelPool[j].classList.remove('on');
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    this.raf = 0;
    clearTimeout(this.rzT);
    this.ro.disconnect();
    document.removeEventListener('byline:theme', this.onTheme);
    if (this.onScroll) removeEventListener('scroll', this.onScroll, { capture: true });
  }
}

// ====================================================================== public mounts
/**
 * Mount the interactive Map. opts: { data?, onPick(node|null), onHover(node|null), onCamera(), onFrame(),
 * cardHTML(node) → string }. Loads the payload itself (cache-first) when `data` is not given.
 */
export function mountMap(el, opts = {}) {
  const eng = new MapEngine(el, opts);
  if (!opts.data) {
    const { data, fresh } = loadMap();
    if (data) eng.setData(data);
    fresh.then((d) => { if (d && !eng.destroyed) eng.setData(d); }).catch(() => {});
  }
  return eng;
}

/**
 * Today's mini map: the same layout, drawn once into a small static canvas, with the hot clusters labelled.
 * Clicking (or Enter on a focusable host) calls onOpen. Returns { destroy } (synchronously).
 */
export function mountMiniMap(el, { onOpen } = {}) {
  // the host must be positioned (Today's .td-map-live is absolute); never read computed style here
  if (!el.style.position && !el.classList.contains('td-map-live')) el.style.position = 'relative';
  const eng = new MapEngine(el, { mini: true });
  const labels = document.createElement('div');
  labels.setAttribute('aria-hidden', 'true');
  Object.assign(labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  el.append(labels);
  const paintLabels = () => {
    labels.replaceChildren();
    if (!eng.N || !eng.w || !eng.tok) return;
    const pts = eng.clusterPoints().filter(p => eng.hot.has(p.topic)).slice(0, 3);
    const placed = [];
    for (const p of pts) {
      const s = document.createElement('span');
      s.textContent = p.topic;
      Object.assign(s.style, {
        position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: '999px',
        font: '500 11px/16px var(--font-sans)', color: 'var(--text-2)', background: 'var(--surface-solid)', boxShadow: 'inset 0 0 0 1px var(--line)'
      });
      labels.append(s);
      const w = Math.min(eng.w - 8, eng.measure(p.topic, '500 11px Geist, system-ui, sans-serif') + 16), h = 20;
      let x = clamp(p.x - w / 2, 4, eng.w - w - 4), y = clamp(p.y - h / 2, 4, eng.h - h - 4);
      for (let tries = 0; tries < 4 && placed.some(q => x < q.x + q.w && x + w > q.x && y < q.y + q.h && y + h > q.y); tries++) y = clamp(y + (tries % 2 ? -24 * tries : 24 * (tries + 1)), 4, eng.h - h - 4);
      placed.push({ x, y, w, h });
      s.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  };
  const origFrame = eng.frame.bind(eng);
  eng.frame = (t) => { origFrame(t); paintLabels(); };
  const { data, fresh } = loadMap();
  if (data) eng.setData(data);
  fresh.then((d) => { if (d && !eng.destroyed) eng.setData(d); }).catch(() => {});
  const click = (e) => { e.preventDefault(); onOpen?.(); };
  const key = (e) => { if (e.key === 'Enter' && e.target === el) { e.preventDefault(); onOpen?.(); } };
  el.style.cursor = 'pointer';
  el.addEventListener('click', click);
  el.addEventListener('keydown', key);
  return {
    destroy() { eng.destroy(); el.removeEventListener('click', click); el.removeEventListener('keydown', key); eng.canvas.remove(); labels.remove(); },
    get engine() { return eng; }
  };
}

export { MapEngine };
