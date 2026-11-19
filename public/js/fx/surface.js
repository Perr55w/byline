/**
 * Surface effects for Byline: Plate develops (#6), Live screen (#7), Newsprint stock (#8).
 * Re-screen (#9) is pure CSS in /css/fx-surface.css.
 *
 * Effects adapted from React Bits (MIT + Commons Clause), David Haz.
 *   HalftoneReveal -> developPlates()  (CSS dot mask, no WebGL)
 *   DotGrid        -> initLiveScreen() (Canvas2D overlay, event driven, no idle loop)
 *   Noise          -> paintNewsprint() (paintTile, fps 0: one 256px tile per theme)
 */

const root = document.documentElement;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const themeNow = () => (root.dataset.theme === 'light' ? 'light' : 'dark');
const css = (name, el = root) => getComputedStyle(el).getPropertyValue(name).trim();

// ---------------------------------------------------------------- #6 Plate develops (HalftoneReveal)
const DEVELOP_MS = 800;
let plateIO = null;

function ensureDuotoneFilter() {
  if (document.getElementById('fx-duo-night')) return;
  // Night duotone: luminance -> sheet #3F342B (shadows) .. ink #F3EADB (lights)
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="fx-duo-night" color-interpolation-filters="sRGB">
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer>
      <feFuncR type="table" tableValues="0.247 0.953"/>
      <feFuncG type="table" tableValues="0.204 0.918"/>
      <feFuncB type="table" tableValues="0.169 0.859"/>
    </feComponentTransfer></filter>`;
  document.body.append(svg);
}

function finishPlate(plate) {
  plate.classList.remove('fx-dev', 'fx-run', 'fx-lift');
  plate.style.removeProperty('--fx-src');
  plate.style.removeProperty('--fx-fit');
  plate.style.removeProperty('--fx-pos');
  plate.querySelector('img')?.classList.add('in');
  plate.dataset.fxDev = 'done';
}

function runPlate(plate) {
  const img = plate.querySelector('img');
  if (!img || plate.dataset.fxDev !== 'wait') return;
  plate.dataset.fxDev = 'run';
  const night = themeNow() === 'dark';
  if (night) {
    const cs = getComputedStyle(img);
    plate.style.setProperty('--fx-src', `url("${(img.currentSrc || img.src).replace(/"/g, '%22')}")`);
    plate.style.setProperty('--fx-fit', cs.objectFit === 'contain' ? 'contain' : 'cover');
    plate.style.setProperty('--fx-pos', cs.objectPosition || 'center');
  }
  plate.classList.add('fx-run');
  const target = night ? plate : img;
  // Pseudo-element animations bubble animationend from the plate; img ones from the img.
  const done = (e) => {
    if (e.animationName === 'fx-develop') {
      if (night && plate.classList.contains('fx-dev')) { plate.classList.add('fx-lift'); return; }
      finishPlate(plate); cleanup();
    } else if (e.animationName === 'fx-lift') { finishPlate(plate); cleanup(); }
  };
  const cleanup = () => { target.removeEventListener('animationend', done); clearTimeout(guard); };
  target.addEventListener('animationend', done);
  // Safety net: never leave a plate screened (hidden tab, theme switch mid-develop, cancelled animation).
  const guard = setTimeout(() => { cleanup(); finishPlate(plate); }, DEVELOP_MS + 1600);
}

function maybeRun(plate) {
  const img = plate.querySelector('img');
  if (!img) return;
  if (plate.dataset.fxIn !== '1') return;
  if (img.complete && img.naturalWidth) runPlate(plate);
}

/** Develop every `.plate img` under root that has not developed yet. Safe to call repeatedly. */
export function developPlates(scope = document) {
  const plates = [...scope.querySelectorAll('.plate')].filter(p => !p.dataset.fxDev && p.querySelector('img'));
  if (!plates.length) return;
  if (reduced() || !CSS.supports('mask-image', 'radial-gradient(#000, transparent)') && !CSS.supports('-webkit-mask-image', 'radial-gradient(#000, transparent)')) {
    plates.forEach(p => { p.dataset.fxDev = 'done'; });
    return;
  }
  ensureDuotoneFilter();
  plateIO ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      plateIO.unobserve(e.target);
      e.target.dataset.fxIn = '1';
      maybeRun(e.target);
    }
  }, { threshold: 0.2 });
  for (const plate of plates) {
    const img = plate.querySelector('img');
    plate.dataset.fxDev = 'wait';
    plate.classList.add('fx-dev');
    const onLoad = () => maybeRun(plate);
    const onError = () => finishPlate(plate);
    if (!(img.complete && img.naturalWidth)) {
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    }
    plateIO.observe(plate);
  }
}

// ---------------------------------------------------------------- #7 Live screen (DotGrid)
const PITCH = 6;          // matches .masthead background-size
const DOT_R = 1.2;        // CSS dot: solid to 1px, fades by 1.4px
const PROXIMITY = 90;
const SWELL = 0.6;
const SHOCK_MS = 900;
const IDLE_MS = 4000;
const smoother = t => { const x = Math.min(1, Math.max(0, t)); return x * x * x * (x * (x * 6 - 15) + 10); };
const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [237, 230, 214];
  const h = m[1].length === 3 ? m[1].replace(/./g, d => d + d) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};

/**
 * Proximity swell + shock ring over the masthead's static CSS dot screen.
 * Desktop (>=1100px, fine pointer, hover) only; elsewhere a no-op that leaves the CSS dots.
 * The canvas is clear at rest, so the static CSS screen is the resting state.
 * Returns { shock(clientX?, clientY?), destroy() }.
 */
export function initLiveScreen(mast = document.querySelector('header.masthead')) {
  const noop = { shock() {}, destroy() {} };
  const mq = matchMedia('(min-width: 1100px) and (pointer: fine) and (hover: hover)');
  if (!mast || !mq.matches || reduced()) return noop;
  if (mast._fxLive) return mast._fxLive;

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-live-screen';
  canvas.setAttribute('aria-hidden', 'true');
  mast.classList.add('fx-live');
  mast.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
  let base = [237, 230, 214], mark = [255, 110, 79];
  const pointer = { x: -1e4, y: -1e4, inside: false, presence: 0, last: 0 };
  const shocks = [];
  let raf = 0, prev = 0, drawn = false;

  const readColors = () => { base = hexRgb(css('--band-text')); mark = hexRgb(css('--band-mark')); };
  const resize = () => {
    const r = mast.getBoundingClientRect();
    const cs = getComputedStyle(mast);
    W = Math.round(r.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth));
    H = Math.round(r.height - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    cols = Math.ceil(W / PITCH); rows = Math.ceil(H / PITCH);
    drawn = true; wake();
  };

  // Energy buckets keep fillStyle changes to a handful per frame.
  const BUCKETS = 8;
  const paths = Array.from({ length: BUCKETS }, () => []);
  const render = (now) => {
    for (const p of paths) p.length = 0;
    const pres = pointer.presence;
    const active = shocks.map(s => {
      const t = (now - s.start) / SHOCK_MS;
      return { x: s.x, y: s.y, front: t * s.reach, amp: Math.min(1, 1.6 * (1 - t)), w: 20 };
    }).filter(s => s.amp > 0);
    // Which dots can be energised: pointer box, plus whole grid while a ring runs.
    let c0 = 0, c1 = cols - 1;
    if (!active.length) {
      if (pres < 0.002) c1 = -1;
      else { c0 = Math.max(0, Math.floor((pointer.x - PROXIMITY) / PITCH)); c1 = Math.min(cols - 1, Math.ceil((pointer.x + PROXIMITY) / PITCH)); }
    }
    let any = false;
    for (let c = c0; c <= c1; c++) {
      const x = c * PITCH + PITCH / 2;
      for (let r = 0; r < rows; r++) {
        const y = r * PITCH + PITCH / 2;
        let e = 0;
        if (pres > 0.002) {
          const d = Math.hypot(x - pointer.x, y - pointer.y);
          if (d < PROXIMITY) e = smoother(1 - d / PROXIMITY) * pres;
        }
        for (const s of active) {
          const u = (Math.hypot(x - s.x, y - s.y) - s.front) / s.w;
          if (u > -2.5 && u < 2.5) e = Math.max(e, Math.exp(-u * u) * s.amp);
        }
        if (e < 0.04) continue;
        any = true;
        paths[Math.min(BUCKETS - 1, Math.floor(e * BUCKETS))].push(x, y);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!any) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let b = 0; b < BUCKETS; b++) {
      const pts = paths[b];
      if (!pts.length) continue;
      const e = (b + 0.5) / BUCKETS;
      const k = Math.min(1, e * 1.2);
      const col = base.map((v, i) => Math.round(v + (mark[i] - v) * k));
      const alpha = 0.07 + (0.5 - 0.07) * k;
      const rad = DOT_R * (1 + SWELL * e * 1.6);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha.toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i] + rad, pts[i + 1]); ctx.arc(pts[i], pts[i + 1], rad, 0, Math.PI * 2); }
      ctx.fill();
    }
    return true;
  };

  const frame = (now) => {
    raf = 0;
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - prev) / 1000 || 0.016); prev = now;
    const idle = now - pointer.last > IDLE_MS;
    const target = pointer.inside && !idle ? 1 : 0;
    pointer.presence += (target - pointer.presence) * (1 - Math.exp(-dt / 0.12));
    if (Math.abs(target - pointer.presence) < 0.003) pointer.presence = target;
    for (let i = shocks.length - 1; i >= 0; i--) if (now - shocks[i].start >= SHOCK_MS) shocks.splice(i, 1);
    const painted = render(now);
    drawn = painted;
    const settling = pointer.presence !== target;
    // Keep going only while something changes: a ring, a presence fade, or a pending idle timeout check.
    if (shocks.length || settling || dirty) { dirty = false; raf = requestAnimationFrame(frame); }
    else if (pointer.inside && !idle) scheduleIdle();
  };
  let dirty = false, idleTimer = 0;
  const scheduleIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(wake, Math.max(0, IDLE_MS - (performance.now() - pointer.last)) + 20);
  };
  const wake = () => {
    if (raf || document.hidden) return;
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = (e) => {
    const [x, y] = local(e);
    pointer.x = x; pointer.y = y; pointer.inside = true; pointer.last = performance.now();
    dirty = true; wake();
  };
  const onLeave = () => { pointer.inside = false; dirty = true; wake(); };
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (drawn || shocks.length) wake(); };
  const onTheme = () => { readColors(); if (drawn) wake(); };

  mast.addEventListener('pointermove', onMove, { passive: true });
  mast.addEventListener('pointerleave', onLeave, { passive: true });
  document.addEventListener('visibilitychange', onVis);
  const themeObs = new MutationObserver(onTheme);
  themeObs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  const ro = new ResizeObserver(resize);
  ro.observe(mast);
  const onMq = () => { if (!mq.matches) api.destroy(); };
  mq.addEventListener('change', onMq);
  readColors();

  const api = {
    /** One ring travelling outward from (clientX, clientY), default the nameplate. */
    shock(cx, cy) {
      if (reduced()) return;
      const r = canvas.getBoundingClientRect();
      if (cx == null || cy == null) {
        const np = mast.querySelector('.nameplate')?.getBoundingClientRect();
        cx = np ? np.left + np.width / 2 : r.left + r.width / 2;
        cy = np ? np.top + np.height / 2 : r.top + r.height / 2;
      }
      const x = cx - r.left, y = cy - r.top;
      const reach = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y)) + 40;
      shocks.push({ x, y, reach, start: performance.now() });
      if (shocks.length > 3) shocks.shift();
      wake();
    },
    destroy() {
      cancelAnimationFrame(raf); clearTimeout(idleTimer);
      mast.removeEventListener('pointermove', onMove);
      mast.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      mq.removeEventListener('change', onMq);
      themeObs.disconnect(); ro.disconnect();
      canvas.remove(); mast.classList.remove('fx-live');
      delete mast._fxLive;
    },
  };
  mast._fxLive = api;
  return api;
}

// ---------------------------------------------------------------- #8 Newsprint stock (Noise.paintTile, fps 0)
const TILE = 256;
const grainCache = new Map(); // theme -> blob URL
let grainObs = null;

const generator = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const STOCK = {
  // Night: dark umber fibres + dust on the lamp-lit desk; a few pale flecks keep it paper, not soot.
  dark: { tone: [14, 9, 6], grain: 0.10, fibres: 240, fibreA: [0.16, 0.32], dust: 110, dustA: [0.25, 0.5], fleck: [255, 236, 205], flecks: 40, fleckA: 0.05, seed: 0x5eed01 },
  // Proof: grey-brown fibres at ~.06
  light: { tone: [74, 62, 48], grain: 0.06, fibres: 160, fibreA: [0.04, 0.08], dust: 26, dustA: [0.06, 0.14], fleck: null, flecks: 0, fleckA: 0, seed: 0x5eed02 },
};

function paintTile(theme) {
  const p = STOCK[theme];
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d');
  const rnd = generator(p.seed);
  // 1. grain: triangular-distributed alpha noise in the stock tone
  const img = ctx.createImageData(TILE, TILE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, rnd() + rnd() - 1); // 0..1, mostly small
    d[i] = p.tone[0]; d[i + 1] = p.tone[1]; d[i + 2] = p.tone[2];
    d[i + 3] = Math.round(v * p.grain * 2 * 255);
  }
  ctx.putImageData(img, 0, 0);
  // 2. fibres: short bent hairs, drawn wrapped so the tile stitches
  const wrap = (fn) => { for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) { ctx.save(); ctx.translate(ox, oy); fn(); ctx.restore(); } };
  ctx.lineCap = 'round';
  for (let i = 0; i < p.fibres; i++) {
    const x = rnd() * TILE, y = rnd() * TILE, len = 4 + rnd() * 18, ang = rnd() * Math.PI * 2, bend = (rnd() - 0.5) * len * 0.8;
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    const cx = (x + ex) / 2 - Math.sin(ang) * bend, cy = (y + ey) / 2 + Math.cos(ang) * bend;
    const a = p.fibreA[0] + rnd() * (p.fibreA[1] - p.fibreA[0]);
    const w = 0.4 + rnd() * 0.6;
    wrap(() => {
      ctx.strokeStyle = `rgba(${p.tone.join(',')},${a.toFixed(3)})`;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    });
  }
  // 3. dust: small soft specks
  const speck = (rgb, a, r) => {
    const x = rnd() * TILE, y = rnd() * TILE;
    wrap(() => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb.join(',')},${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb.join(',')},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    });
  };
  for (let i = 0; i < p.dust; i++) speck(p.tone, p.dustA[0] + rnd() * (p.dustA[1] - p.dustA[0]), 0.5 + rnd() ** 2.5 * 1.8);
  for (let i = 0; i < p.flecks; i++) speck(p.fleck, p.fleckA + rnd() * p.fleckA, 0.5 + rnd() * 0.9);
  return c;
}

function tileUrl(theme) {
  if (grainCache.has(theme)) return Promise.resolve(grainCache.get(theme));
  return new Promise((resolve) => {
    paintTile(theme).toBlob((blob) => {
      const url = blob ? URL.createObjectURL(blob) : null;
      if (url) grainCache.set(theme, url);
      resolve(url);
    }, 'image/png');
  });
}

function applyGrain(theme) {
  const url = grainCache.get(theme);
  if (url) root.style.setProperty('--grain', `url("${url}")`);
  return url;
}

/**
 * Paint the newsprint stock for the current theme once (cached per theme) and set --grain.
 * Also pre-paints the other theme at idle and watches data-theme, so a desk switch swaps the
 * tile synchronously (inside the view-transition update, before the new snapshot).
 * Returns a promise for the blob URL.
 */
export async function paintNewsprint() {
  const theme = themeNow();
  if (!grainObs) {
    grainObs = new MutationObserver(() => {
      const t = themeNow();
      if (!applyGrain(t)) tileUrl(t).then(() => { if (themeNow() === t) applyGrain(t); });
    });
    grainObs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }
  const url = await tileUrl(theme);
  if (themeNow() === theme) applyGrain(theme);
  const other = theme === 'dark' ? 'light' : 'dark';
  (window.requestIdleCallback || setTimeout)(() => tileUrl(other), { timeout: 2000 });
  return url;
}
