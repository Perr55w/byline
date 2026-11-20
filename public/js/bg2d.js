// Byline v4 — the Canvas2D ruled field (B's bucketed method), shared by the main thread (fallback) and
// bg2d-worker.js (preferred: an OffscreenCanvas, so the field never costs the main thread). bg.js owns the
// state (time, pointer, heat, ripples, colours); this module only lays out the dash grid and draws a frame.
//
//   const f = createField(ctx2d)
//   f.layout({ W, H, col, row, bw, bh })   dash grid for the viewport (CSS px) and backing size
//   f.heat(grid64x40, [x, y, w, h])         topic heat sampled onto the dashes
//   f.rail([x, y, w, h])                    dashes under the rail are skipped (the rail's "frost")
//   f.draw({ col, I, t, scale, ptr, near, band, pool, poolS, pulse, rip })
//     near: pointer reaction strength (S13d, 160px smoothstep); band: [x, y, w, h] viewport rect dimmed to ×0.35 (S13b)
export function createField(ctx) {
  const NB = 24;
  let D = null, L = null, heatGrid = null, heatBox = null, railRect = null;
  let bk = null, bkN = null; // per alpha bucket: packed (x, y, len) triples and a count
  function layout(o) {
    L = o;
    const cols = Math.ceil(o.W / o.col) + 1, rows = Math.ceil(o.H / o.row) + 1, n = cols * rows;
    D = { cols, rows, n, x: new Float32Array(n), y: new Float32Array(n), heat: new Float32Array(n), rail: new Uint8Array(n), w: new Float32Array(n),
      // static phase of the three sines per dash: sin(a − p) = sin a·cos p − cos a·sin p, so a frame costs 6 multiplies, not 3 sin()
      s1: new Float32Array(n), c1: new Float32Array(n), s2: new Float32Array(n), c2: new Float32Array(n), s3: new Float32Array(n), c3: new Float32Array(n), rip: [], ripKey: '' };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, x = c * o.col + (r % 2 ? o.col / 2 : 0) + o.col / 2, y = r * o.row + o.row / 2;
      D.x[i] = x; D.y[i] = y;
      const a1 = K1 * (x * .9397 + y * .3420), a2 = K2 * (x * .8290 - y * .5592), a3 = K3 * (-x * .0872 + y * .9962);
      D.s1[i] = Math.sin(a1); D.c1[i] = Math.cos(a1); D.s2[i] = Math.sin(a2); D.c2[i] = Math.cos(a2); D.s3[i] = Math.sin(a3); D.c3[i] = Math.cos(a3);
    }
    if (heatGrid) heat(heatGrid, heatBox);
    if (railRect) rail(railRect);
  }
  const K1 = 0.0069813, K2 = 0.0120830, K3 = 0.0044880;
  /** Ripples are static in space: keep, per ripple, only the dashes it reaches (amplitude > .004) with their gain and phase. */
  function rip2D(rips) {
    const key = rips.map(r => `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.h.toFixed(3)},${r.s.toFixed(1)}`).join('|');
    if (key === D.ripKey) return;
    D.ripKey = key;
    D.rip = rips.map((R) => {
      const idx = [], gain = [], ph = [];
      const reach = R.s * Math.sqrt(2 * Math.log(Math.max(1.0001, .5 * R.h / .004)));
      for (let i = 0; i < D.n; i++) {
        const dx = D.x[i] - R.x; if (dx > reach || dx < -reach) continue;
        const dy = D.y[i] - R.y; if (dy > reach || dy < -reach) continue;
        const d2 = dx * dx + dy * dy, g = .5 * R.h * Math.exp(-d2 / (2 * R.s * R.s));
        if (g < .004) continue;
        idx.push(i); gain.push(g); ph.push(0.0349066 * Math.sqrt(d2));
      }
      return { idx: Uint32Array.from(idx), gain: Float32Array.from(gain), ph: Float32Array.from(ph) };
    });
  }
  function heat(grid, box) {
    heatGrid = grid; heatBox = box;
    if (!D) return;
    const [hx, hy, hw, hh] = box;
    for (let i = 0; i < D.n; i++) {
      const u = (D.x[i] - hx) / hw, v = (D.y[i] - hy) / hh;
      if (u < 0 || u > 1 || v < 0 || v > 1) { D.heat[i] = 0; continue; }
      const gx = Math.min(63, Math.round(u * 63)), gy = Math.min(39, Math.round(v * 39));
      D.heat[i] = grid[gy * 64 + gx];
    }
  }
  function rail(rect) {
    railRect = rect;
    if (!D) return;
    const [x, y, w, h] = rect;
    for (let i = 0; i < D.n; i++) D.rail[i] = w > 0 && D.x[i] > x - 2 && D.x[i] < x + w + 2 && D.y[i] > y - 2 && D.y[i] < y + h + 2 ? 1 : 0;
  }
  function draw(p) {
    if (!D || !p.col) return;
    const c = p.col, I = p.I, t = p.t;
    const toByte = (v) => Math.round(v * 255);
    const ink = c.ink.map(toByte).join(','), hotc = c.hot.map(toByte).join(',');
    ctx.setTransform(p.scale, 0, 0, p.scale, 0, 0);
    ctx.fillStyle = `rgb(${c.bg.map(toByte).join(',')})`;
    ctx.fillRect(0, 0, L.W, L.H);
    if (!bk || bk[0].length < D.n * 3) { bk = Array.from({ length: NB * 2 }, () => new Float32Array(D.n * 3)); bkN = new Uint32Array(NB * 2); }
    bkN.fill(0);
    const p1 = 0.1256637 * t, p2 = 0.1329136 * t, p3 = 0.0314159 * t;
    const cp1 = .55 * Math.cos(p1), sp1 = .55 * Math.sin(p1), cp2 = .30 * Math.cos(p2), sp2 = .30 * Math.sin(p2), cp3 = .15 * Math.cos(p3), sp3 = .15 * Math.sin(p3);
    const px = p.ptr.x, py = p.ptr.y, ps = p.ptr.s * (.5 + .5 * I);
    const pool = p.pool, poolS = p.poolS * ((c.pool ?? .07) / .07), pu = p.pulse;
    const near = p.near || 0, band = p.band && p.band[2] > 0 ? p.band : null;
    const { cols, rows, n, x: X, y: Y, w: W, s1, c1, s2, c2, s3, c3 } = D;
    // pass 1: the satin (three sines), then the ripples on the dashes they reach
    for (let i = 0; i < n; i++) W[i] = s1[i] * cp1 - c1[i] * sp1 + s2[i] * cp2 - c2[i] * sp2 + s3[i] * cp3 + c3[i] * sp3;
    rip2D(p.rip);
    const rt = 0.4886922 * t;
    for (const R of D.rip) { const { idx, gain, ph } = R; for (let j = 0; j < idx.length; j++) W[idx[j]] += gain[j] * Math.cos(ph[j] - rt); }
    const amax = c.amax, amin = c.amin, hratio = c.hota / Math.max(amax, .01);
    const lit = ps > .001, pooled = poolS > .001 && pool, pulsing = pu && pu.a > .001;
    const aBase = amin * (.6 + .4 * I), aSpan = (amax - amin) * I, yAmp = 2.4 * (.4 + .6 * I);
    // pass 2: alpha bucket per dash
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const i = r * cols + col;
        if (D.rail[i]) continue;
        const x = X[i], y = Y[i];
        const w = Math.max(-1, Math.min(1, W[i] / 1.2));
        let L = 0, sheen = 0;
        if (lit) {
          const ddx = x - px, ddy = y - py, d2 = ddx * ddx + ddy * ddy;
          if (d2 < 600000) {
            L = ps * Math.exp(-d2 / 96800);
            const prev = r ? Math.max(-1, Math.min(1, W[i - cols] / 1.2)) : w;
            sheen = L * Math.max(0, Math.min(1, (w - prev) * 5));
          }
        }
        // R3 S10 (R10): the pool lifts dashes in neutral ink (gain −40%); accent only within 40px of the tile's edge
        let P = 0, PE = 0;
        if (pooled) {
          const qx = Math.max(pool[0] - x, 0, x - pool[0] - pool[2]), qy = Math.max(pool[1] - y, 0, y - pool[1] - pool[3]), d2 = qx * qx + qy * qy;
          if (d2 < 30000) {
            P = poolS * Math.exp(-d2 / 3200);
            const sd = d2 > 0 ? Math.sqrt(d2) : Math.min(x - pool[0], pool[0] + pool[2] - x, y - pool[1], pool[1] + pool[3] - y);
            if (sd < 40) PE = P * (sd <= 24 ? 1 : 1 - ((sd - 24) / 16) ** 2 * (3 - 2 * (sd - 24) / 16));
          }
        }
        let pr = 0;
        if (pulsing) { const d = Math.hypot(x - pu.x, y - pu.y) - pu.p * 420; if (d < 140 && d > -140) pr = pu.a * Math.exp(-d * d / 968); }
        const he = D.heat[i], u = .5 + .5 * w;
        let a = aBase + aSpan * u * u + he * .10 + L * .16 + sheen * .22 + P * .072 + pr * .2;
        // R3 S10: blue only from heat, the pool's edge band and a click pulse; the pointer light is neutral
        // only the cores of the hot topics turn blue (smoothstep .55 → 1 of the heat): the skirt stays neutral ink
        const hq = he <= .55 ? 0 : he >= 1 ? 1 : (he - .55) / .45, hb = hq * hq * (3 - 2 * hq);
        let hot = Math.min(1, hb * .85 + PE * .5 + pr * .5);
        a *= 1 + (hratio - 1) * hot * hot;
        if (near > .001) {
          const ddx = x - px, ddy = y - py, d2 = ddx * ddx + ddy * ddy;
          if (d2 < 25600) { const q = Math.sqrt(d2) / 160, N = near * (1 - q * q * (3 - 2 * q)); a += (Math.max(a, amax + .08) - a) * N; }
        }
        if (band) {
          const qx = Math.max(band[0] - x, 0, x - band[0] - band[2]), qy = Math.max(band[1] - y, 0, y - band[1] - band[3]);
          const d = Math.sqrt(qx * qx + qy * qy);
          if (d < 48) { const q = d / 48; a *= .35 + .65 * (q * q * (3 - 2 * q)); }
        }
        const g = hot > .45 ? 1 : 0;
        const bi = Math.max(0, Math.min(NB - 1, Math.round(a * NB / .6)));
        const len = 1 + .45 * he + .7 * L;
        const k = g * NB + bi, arr = bk[k], o = bkN[k]; arr[o] = x; arr[o + 1] = y + w * yAmp * (1 + .4 * he); arr[o + 2] = len; bkN[k] = o + 3;
      }
    }
    for (let g = 0; g < 2; g++) for (let b = 0; b < NB; b++) {
      const arr = bk[g * NB + b], m = bkN[g * NB + b]; if (!m) continue;
      ctx.fillStyle = `rgba(${g ? hotc : ink},${(b * .6 / NB).toFixed(3)})`;
      for (let j = 0; j < m; j += 3) { const s = arr[j + 2]; ctx.fillRect(arr[j] - 1.6 * s, arr[j + 1] - .5, 3.2 * s, 1); }
    }
  }
  return {
    layout(o) { if (o.bw && ctx.canvas.width !== o.bw) ctx.canvas.width = o.bw; if (o.bh && ctx.canvas.height !== o.bh) ctx.canvas.height = o.bh; layout(o); },
    heat, rail, draw
  };
}
