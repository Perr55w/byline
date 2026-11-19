// Background engine: B's "ruled field" (rows of short typeset dashes moving like satin) on E's engine.
// WebGL2 first (failIfMajorPerformanceCaveat), Canvas2D fallback (B's bucketed method, ≤20fps, static on
// phone). Fixed time step per drawn frame, draw every Nth vsync from a measured refresh rate, idle freeze
// after 20s (?bgidle=ms) with zero rAF, pause when hidden, static frame under reduced motion.
// The pointer glow is a compositor-only #bg-light div at 60fps; the satin sheen is a shader uniform.
//
// API (also on window.__byline.bg):
//   start()                       boot (app.js calls it once)
//   setMode('full'|'dim'|'still') per-view intensity (opacity via html[data-bg]; the engine only changes rate)
//   overlay(on)                   dossier / ⌘K / sheet open → 'still' while any overlay is open
//   setHeat([{ topic, heat, x?, y? }])  heat 0..1; x,y normalised to the content area (optional: hashed from topic)
//   pulse(x, y)                   one soft light ring (σ 22px, 780ms) at viewport px
//   setRail({ x, y, w, h }, { animate: ms })   rect the field softens under (no backdrop-filter on the rail)
//   setBand({ x, y, w, h } | null)             page-head rect in DOCUMENT px: dashes under the h1 + lede drop to
//                                              ×0.35 alpha with a 48px feather (S13b); scroll is applied per draw
//   hold(ms)                      skip draws (GPU headroom during route/dossier flights)
//   resize()                      re-measure (also automatic, debounced)
//   stats()                       { renderer, draws, hz, N, mode, frozen, backing, ... } for tests

import { createField } from './bg2d.js';
const Q = new URLSearchParams(location.search);
const IDLE_MS = Number(Q.get('bgidle')) || 20000;
const FREEZE_MS = 1200; // ease-out of the drift before the freeze
const FORCE = Q.get('bg'); // 'gl' (skip the perf-caveat check), '2d', 'off'
const root = document.documentElement;
let canvas = document.getElementById('bg');
const light = document.getElementById('bg-light');
const mq = (q) => matchMedia(q).matches;
const isPhone = () => mq('(max-width: 760px)') || mq('(pointer: coarse)');
const isTouch = () => mq('(hover: none)');
const reduced = () => mq('(prefers-reduced-motion: reduce)');

const S = {
  renderer: 'none', started: false, mode: root.dataset.bg || 'full', routeMode: root.dataset.bg || 'full', overlays: 0,
  W: 0, H: 0, bw: 0, bh: 0, scale: 1, row: 18, col: 8,
  t: 40, timeScale: 1, wake: null, freezeFrom: 0,
  draws: 0, frames: 0, hz: 60, intervals: [], lastNow: 0, sinceDraw: 0, raf: 0, holdUntil: 0,
  lastInput: performance.now(), frozen: false, freezing: false, drawMs: 0,
  col0: null, colFrom: null, colTo: null, colT0: 0,
  ptr: { x: -9999, y: -9999, tx: -9999, ty: -9999, s: 0, ts: 0, seen: false, lastMove: 0 },
  lightPos: { x: 0, y: 0, k: 1, tk: 1, o: 0 },
  pool: { rect: null, s: 0, ts: 0 },
  heat: new Float32Array(64 * 40), heatFrom: null, heatTo: null, heatT0: 0, heatBox: [0, 0, 1, 1], rip: [],
  pulse: null,
  rail: [0, 0, 0, 0], railFrom: null, railTo: null, railT0: 0, railDur: 0,
  band: [0, 0, 0, 0], scrollY: 0,
};

// ------------------------------------------------------------------ helpers
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => { let t = x; for (let i = 0; i < 6; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-4 || !d) break; t -= e / d; } return sy(Math.min(1, Math.max(0, t))); };
}
const easeMove = bezier(.45, 0, .15, 1), easeAmbient = bezier(.37, 0, .63, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const rgbOf = (v) => { const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v || ''); return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255] : [.5, .5, .5]; };
function readColors() {
  const cs = getComputedStyle(root);
  const g = (n, f) => cs.getPropertyValue(n).trim() || f;
  return { bg: rgbOf(g('--fd-bg')), ink: rgbOf(g('--fd-ink')), hot: rgbOf(g('--fd-hot')), amin: +g('--fd-amin', .06), amax: +g('--fd-amax', .18), hota: +g('--fd-hot-a', .3), glow: +g('--fd-glow', .05), pool: +g('--fd-pool', .07) };
}
function mixColors(a, b, t) {
  const m = (x, y) => x.map((v, i) => lerp(v, y[i], t));
  return { bg: m(a.bg, b.bg), ink: m(a.ink, b.ink), hot: m(a.hot, b.hot), amin: lerp(a.amin, b.amin, t), amax: lerp(a.amax, b.amax, t), hota: lerp(a.hota, b.hota, t), glow: lerp(a.glow, b.glow, t), pool: lerp(a.pool, b.pool, t) };
}
const intensity = () => (S.mode === 'full' ? 1 : S.mode === 'dim' ? .7 : .6); // opacity does the dimming; I shapes contrast

// ------------------------------------------------------------------ WebGL2 renderer
const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision mediump float;
uniform vec2 u_res; uniform float u_scale; uniform float u_time; uniform vec2 u_grid;
uniform vec3 u_bg; uniform vec3 u_ink; uniform vec3 u_hot; uniform vec4 u_alpha;
uniform vec3 u_ptr; uniform vec4 u_rail; uniform vec4 u_rip[3]; uniform vec4 u_heatBox; uniform sampler2D u_heat;
uniform vec4 u_pool; uniform float u_poolS; uniform vec4 u_pulse; uniform vec4 u_band; uniform vec2 u_near;
out vec4 o;
const float TAU = 6.2831853;
float wave(vec2 p, float t){
  float w = .55*sin(0.0069813*dot(p, vec2(.9397, .3420)) - 0.1256637*t)
          + .30*sin(0.0120830*dot(p, vec2(.8290, -.5592)) - 0.1329136*t)
          + .15*sin(0.0044880*dot(p, vec2(-.0872, .9962)) + 0.0314159*t);
  for (int i = 0; i < 3; i++) { vec4 r = u_rip[i]; if (r.z > 0.) { float d = distance(p, r.xy); w += .5*r.z*cos(0.0349066*d - 0.4886922*t)*exp(-d*d/(2.*r.w*r.w)); } }
  return clamp(w/1.2, -1., 1.);
}
float sdRect(vec2 p, vec4 r, float rad){ vec2 c = r.xy + r.zw*.5; vec2 q = abs(p - c) - r.zw*.5 + rad; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - rad; }
void main(){
  vec2 f = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;
  float ROW = u_grid.x, COL = u_grid.y;
  float row = floor(f.y / ROW);
  float off = mod(row, 2.) * COL * .5;
  float col = floor((f.x - off) / COL);
  vec2 c = vec2(col*COL + off + COL*.5, row*ROW + ROW*.5);
  vec2 huv = (c - u_heatBox.xy) / u_heatBox.zw;
  float H = texture(u_heat, clamp(huv, 0., 1.)).r * step(0., huv.x) * step(huv.x, 1.) * step(0., huv.y) * step(huv.y, 1.);
  float I = u_alpha.w;
  float W = wave(c, u_time);
  vec2 dp = c - u_ptr.xy;
  float L = u_ptr.z * exp(-dot(dp, dp) / 96800.);
  float sheen = 0.;
  if (L > .003) { float Wu = wave(c - vec2(0., ROW), u_time); sheen = L * clamp((W - Wu)*5., 0., 1.); }
  float P = 0.;
  if (u_poolS > .001) { float d = max(sdRect(c, u_pool, 12.), 0.); P = u_poolS * exp(-d*d/3200.) * (u_near.y / .07); }
  // S13d: the pointer lights the dashes within 160px (full intensity only): alpha toward amax + .08, ink 35% toward hot
  float N = 0.;
  if (u_near.x > .001) N = u_near.x * (1. - smoothstep(0., 160., length(dp)));
  float pr = 0.;
  if (u_pulse.w > .001) { float d = distance(c, u_pulse.xy) - u_pulse.z*420.; pr = u_pulse.w * exp(-d*d/968.); }
  float dy = 2.4*W*(.4 + .6*I)*(1. + .4*H);
  float len = 1. + .45*H + .7*L;
  float aa = .5/u_scale;
  vec2 q = abs(f - vec2(c.x, c.y + dy));
  float hx = 1.6*len;
  float cov = (1. - smoothstep(hx - aa, hx + aa, q.x)) * (1. - smoothstep(.5 - aa, .5 + aa, q.y));
  float u = .5 + .5*W;
  float a = u_alpha.x*(.6 + .4*I) + (u_alpha.y - u_alpha.x)*I*u*u + .10*H + .16*L + .22*sheen + .12*P + .2*pr;
  float hot = clamp(.85*H + .5*L + .6*P + .5*pr, 0., 1.);
  a *= mix(1., u_alpha.z / max(u_alpha.y, .01), hot*hot);
  a = mix(a, max(a, u_alpha.y + .08), N);
  // S13b: under the page head (h1 + lede) the field steps back to ×0.35 with a 48px feather
  if (u_band.z > 0.) a *= mix(.35, 1., smoothstep(0., 48., sdRect(f, u_band, 0.)));
  float inside = u_rail.z > 0. ? 1. - smoothstep(-8., 1., sdRect(f, u_rail, 16.)) : 0.;
  cov = mix(cov, (4.*hx*.5)/(ROW*COL)*1.4, inside);
  vec3 ink = mix(mix(u_ink, u_hot, hot), u_hot, .35*N);
  o = vec4(mix(u_bg, ink, clamp(a*cov, 0., 1.)), 1.);
}`;

let gl = null, prog = null, U = {}, heatTex = null;
function initGL() {
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: FORCE !== 'gl', preserveDrawingBuffer: false });
  } catch (e) { gl = null; }
  if (!gl) return false;
  // software rasterisers pass the perf-caveat check in some environments: treat them as "no GPU"
  if (FORCE !== 'gl') {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) { gl.getExtension('WEBGL_lose_context')?.loseContext(); gl = null; S.glRejected = name; return false; }
  }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('bg shader', gl.getShaderInfoLog(s)); return null; } return s; };
  const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
  if (!v || !f) { gl = null; return false; }
  prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return false; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  ['u_res', 'u_scale', 'u_time', 'u_grid', 'u_bg', 'u_ink', 'u_hot', 'u_alpha', 'u_ptr', 'u_rail', 'u_rip', 'u_heatBox', 'u_heat', 'u_pool', 'u_poolS', 'u_pulse', 'u_band', 'u_near'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
  heatTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, heatTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  uploadHeat();
  gl.uniform1i(U.u_heat, 0);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; fallback2D(); }, { once: true });
  return true;
}
function uploadHeat() {
  if (!gl) return;
  const b = new Uint8Array(64 * 40);
  for (let i = 0; i < b.length; i++) b[i] = Math.round(Math.min(1, S.heat[i]) * 255);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, heatTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 64, 40, 0, gl.RED, gl.UNSIGNED_BYTE, b);
}
function drawGL() {
  const c = S.col0, I = intensity();
  gl.viewport(0, 0, S.bw, S.bh);
  gl.uniform2f(U.u_res, S.bw, S.bh); gl.uniform1f(U.u_scale, S.scale); gl.uniform1f(U.u_time, S.t); gl.uniform2f(U.u_grid, S.row, S.col);
  gl.uniform3fv(U.u_bg, c.bg); gl.uniform3fv(U.u_ink, c.ink); gl.uniform3fv(U.u_hot, c.hot); gl.uniform4f(U.u_alpha, c.amin, c.amax, c.hota, I);
  gl.uniform3f(U.u_ptr, S.ptr.x, S.ptr.y, S.ptr.s * (.5 + .5 * I));
  gl.uniform4fv(U.u_rail, S.rail);
  const rip = new Float32Array(12);
  S.rip.slice(0, isPhone() ? 2 : 3).forEach((r, i) => rip.set([r.x, r.y, r.h, r.s], i * 4));
  gl.uniform4fv(U.u_rip, rip);
  gl.uniform4fv(U.u_heatBox, S.heatBox);
  const pr = S.pool.rect; gl.uniform4f(U.u_pool, pr ? pr[0] : 0, pr ? pr[1] : 0, pr ? pr[2] : 0, pr ? pr[3] : 0); gl.uniform1f(U.u_poolS, S.pool.s);
  const pu = S.pulse; gl.uniform4f(U.u_pulse, pu ? pu.x : 0, pu ? pu.y : 0, pu ? pu.p : 0, pu ? pu.a : 0);
  const b = bandNow(); gl.uniform4f(U.u_band, b[0], b[1], b[2], b[3]);
  gl.uniform2f(U.u_near, nearNow(), c.pool ?? .07);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ------------------------------------------------------------------ Canvas2D fallback (B's bucketed method, in bg2d.js)
// Preferred: an OffscreenCanvas in a module worker, so the ambient field costs the main thread only a postMessage per
// draw (E5; and no field raster competes with tab switches, E1/E2). Otherwise the same field runs on the main thread.
let ctx = null, F = null, offscreen = false;
function fallback2D() {
  // a canvas that had a webgl context can't give a 2d one: swap the element
  if (canvas.dataset.gl) {
    const c2 = canvas.cloneNode(false); delete c2.dataset.gl; canvas.replaceWith(c2);
    return location.reload(); // context loss mid-session is rare; a reload restores cleanly
  }
  ctx = canvas.getContext('2d', { alpha: false });
  S.renderer = ctx ? 'canvas2d' : 'none';
  if (ctx) F = createField(ctx);
  layout2D();
}
/** Start the Canvas2D field: in a worker when the browser can transfer the canvas, else on this thread. */
function start2D() {
  S.renderer = 'canvas2d';
  if (Q.get('bg2d') !== 'main' && typeof canvas.transferControlToOffscreen === 'function' && typeof Worker === 'function') {
    try {
      measure(); // size the element before the transfer (its width/height attributes are fixed afterwards)
      const off = canvas.transferControlToOffscreen();
      const w = new Worker(new URL('./bg2d-worker.js', import.meta.url), { type: 'module' });
      w.postMessage({ m: 'init', canvas: off }, [off]);
      const call = (m) => (...a) => w.postMessage({ m, a });
      F = { layout: call('layout'), heat: call('heat'), rail: call('rail'), draw: call('draw') };
      offscreen = true;
      return;
    } catch (e) { F = null; offscreen = false; }
  }
  ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  S.renderer = ctx ? 'canvas2d' : 'none';
  if (ctx) F = createField(ctx);
}
function layout2D() {
  if (!F) return;
  F.layout({ W: S.W, H: S.H, col: S.col, row: S.row, bw: S.bw, bh: S.bh });
  heat2D(); rail2D();
}
function heat2D() { if (F) F.heat(Float32Array.from(S.heat), S.heatBox.slice()); }
function rail2D() { if (F) F.rail(S.rail.slice()); }
function draw2D() {
  if (!F) return;
  const pu = S.pulse, P = S.ptr;
  F.draw({ col: S.col0, I: intensity(), t: S.t, scale: S.scale, ptr: { x: P.x, y: P.y, s: P.s }, near: nearNow(), band: bandNow(), pool: S.pool.rect ? S.pool.rect.slice() : null, poolS: S.pool.s,
    pulse: pu ? { x: pu.x, y: pu.y, p: pu.p, a: pu.a } : null, rip: S.rip.slice(0, 3).map(r => ({ x: r.x, y: r.y, h: r.h, s: r.s })) });
}

/** Pointer reaction strength (S13d): only at full intensity, never on touch / reduced motion. */
const nearNow = () => (S.mode === 'full' && !isTouch() && !reduced() ? S.ptr.s : 0);
/** Page-head band in viewport px (document rect minus the current scroll). */
const bandNow = () => (S.band[2] > 0 ? [S.band[0], S.band[1] - S.scrollY, S.band[2], S.band[3]] : [0, 0, 0, 0]);

// ------------------------------------------------------------------ sizing
function measure() {
  const phone = isPhone();
  S.W = innerWidth; S.H = innerHeight;
  S.row = phone ? 22 : 18; S.col = phone ? 10 : 8;
  const dpr = window.devicePixelRatio || 1;
  let s = phone ? Math.min(dpr, 1.25) : Math.min(dpr, 1.5);
  const cap = phone ? 0.6e6 : 2.4e6;
  if (S.W * S.H * s * s > cap) s = Math.sqrt(cap / (S.W * S.H));
  if (S.renderer === 'canvas2d' && phone) s = Math.min(s, 1);
  // S13a: backing = round(viewport × scale) on both axes (no floor-and-stretch seam); stay inside the pixel cap
  while (s > 0.1 && Math.round(S.W * s) * Math.round(S.H * s) > cap) s -= 0.0005;
  S.scale = s;
  S.bw = Math.max(1, Math.round(S.W * s)); S.bh = Math.max(1, Math.round(S.H * s));
  // the element is sized in px to the viewport (not 100vw / max-width:100%, which clipped it to the body width)
  const cw = `${S.W}px`, ch = `${S.H}px`;
  if (canvas.style.width !== cw) canvas.style.width = cw;
  if (canvas.style.height !== ch) canvas.style.height = ch;
  if (!offscreen) {
    if (canvas.width !== S.bw) canvas.width = S.bw;
    if (canvas.height !== S.bh) canvas.height = S.bh;
  }
  placeHeat();
  if (F) layout2D();
}
let rzT = 0;
function onResize() { clearTimeout(rzT); rzT = setTimeout(() => { measure(); requestDraw(); }, 150); }

// ------------------------------------------------------------------ heat (topic weather)
let heatInput = [];
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
function contentBox() {
  const left = isPhone() ? 0 : (S.rail[0] + S.rail[2]) || 0;
  const top = isPhone() ? 120 : 140;
  return [left, top, Math.max(1, S.W - left), Math.max(1, S.H - top)];
}
function placeHeat() {
  const box = contentBox();
  S.heatBox = box;
  const [bx, by, bw, bh] = box;
  const spots = heatInput.map((h, i) => {
    const x = h.x != null ? h.x : .18 + .7 * hash(h.topic + ':x');
    const y = h.y != null ? h.y : .2 + .65 * hash(h.topic + ':y' + i);
    return { x: bx + x * bw, y: by + y * bh, h: Math.max(0, Math.min(1, h.heat)), s: 220 * (.6 + Math.max(0, Math.min(1, h.heat))) };
  });
  const next = new Float32Array(64 * 40);
  for (let gy = 0; gy < 40; gy++) for (let gx = 0; gx < 64; gx++) {
    const x = bx + (gx / 63) * bw, y = by + (gy / 39) * bh;
    let v = 0;
    for (const s of spots) { const dx = x - s.x, dy = y - s.y; v += s.h * Math.exp(-(dx * dx + dy * dy) / (2 * s.s * s.s)); }
    next[gy * 64 + gx] = Math.min(1, v);
  }
  S.rip = spots.slice().sort((a, b) => b.h - a.h).slice(0, 3);
  return next;
}
function setHeat(list = []) {
  heatInput = (Array.isArray(list) ? list : []).filter(h => h && h.heat > 0).slice(0, 12);
  const next = placeHeat();
  if (reduced() || !S.started) { S.heat = next; S.heatFrom = null; uploadHeat(); heat2D(); requestDraw(); return; }
  S.heatFrom = S.heat.slice(); S.heatTo = next; S.heatT0 = performance.now();
  kick();
}

// ------------------------------------------------------------------ the loop
function tick(now) {
  S.raf = 0;
  if (document.hidden) return;
  const dt = S.lastNow ? Math.min(.1, (now - S.lastNow) / 1000) : 1 / 60;
  if (S.lastNow && S.intervals.length < 30) {
    S.intervals.push(now - S.lastNow);
    if (S.intervals.length === 30) { const iv = S.intervals.slice().sort((a, b) => a - b)[15]; S.hz = Math.max(30, Math.min(240, Math.round(1000 / iv))); }
  }
  S.lastNow = now; S.frames++; S.sinceDraw++;
  let tweening = false;

  // theme colour tween (500ms)
  if (S.colTo) { const p = Math.min(1, (now - S.colT0) / 500); S.col0 = mixColors(S.colFrom, S.colTo, easeAmbient(p)); if (p >= 1) S.colTo = null; tweening = true; paintLightColor(); }
  // rail rect tween (follows --rail-w)
  if (S.railTo) {
    const p = Math.min(1, (now - S.railT0) / Math.max(1, S.railDur)), e = easeMove(p);
    S.rail = S.railFrom.map((v, i) => lerp(v, S.railTo[i], e));
    if (p >= 1) { S.railTo = null; S.heat = placeHeat(); uploadHeat(); heat2D(); }
    rail2D(); tweening = true;
  }
  // heat tween (1200ms)
  if (S.heatTo) {
    const p = Math.min(1, (now - S.heatT0) / 1200), e = easeAmbient(p);
    for (let i = 0; i < S.heat.length; i++) S.heat[i] = lerp(S.heatFrom[i], S.heatTo[i], e);
    if (p >= 1) { S.heat = S.heatTo; S.heatTo = null; }
    uploadHeat(); heat2D(); tweening = true;
  }
  // pointer (frame-rate independent smoothing)
  const P = S.ptr, k = 1 - Math.exp(-7 * dt);
  P.x += (P.tx - P.x) * k; P.y += (P.ty - P.y) * k;
  const idleFor = now - P.lastMove;
  P.ts = P.seen && idleFor < 4000 ? 1 : 0;
  const rate = P.ts > P.s ? 6 : 1.5;
  P.s += (P.ts - P.s) * (1 - Math.exp(-rate * dt));
  // tile pool
  const pool = S.pool, pr = pool.ts > pool.s ? 12 : 5;
  pool.s += (pool.ts - pool.s) * (1 - Math.exp(-pr * dt));
  if (Math.abs(pool.ts - pool.s) > .003) tweening = true;
  else if (!pool.ts && pool.s < .003) { pool.s = 0; pool.rect = null; }
  // pulse
  if (S.pulse) { const p = (now - S.pulse.t0) / 780; if (p >= 1) S.pulse = null; else { S.pulse.p = easeAmbient(p); S.pulse.a = Math.sin(Math.PI * p) * .9; tweening = true; } }
  moveLight(dt);

  // idle freeze: ease the time scale to 0, draw one settled frame, then no rAF at all
  // The 1200ms ease-out sits inside the idle window, so the field is fully at rest IDLE_MS after the last input.
  const idle = now - S.lastInput > Math.max(0, IDLE_MS - FREEZE_MS);
  if (idle && !S.freezing && !tweening) { S.freezing = true; S.freezeFrom = now; S.freezeScale = S.timeScale; S.wake = null; }
  if (S.freezing) {
    const p = Math.min(1, (now - S.freezeFrom) / FREEZE_MS);
    S.timeScale = S.freezeScale * (1 - easeAmbient(p));
    // a pulse / heat tween that is still playing holds the loop open; the drift stays at rest meanwhile
    if (p >= 1 && !tweening) { S.timeScale = 0; draw(); S.frozen = true; S.freezing = false; if (light) light.style.opacity = '0'; return; }
  } else if (S.wake) {
    const p = Math.min(1, (now - S.wake) / 600);
    S.timeScale = easeAmbient(p);
    if (p >= 1) S.wake = null;
  }

  const N = S.mode === 'full' ? Math.max(1, Math.round(S.hz / 30)) : Math.max(1, Math.round(S.hz / 20));
  const N2 = S.renderer === 'canvas2d' ? Math.max(N, Math.round(S.hz / 20)) : N;
  const due = tweening ? S.sinceDraw >= 1 : S.sinceDraw >= N2;
  if (due && now >= S.holdUntil && S.mode !== 'still') {
    S.t += S.timeScale * S.sinceDraw / S.hz; // fixed step per vsync, not wall time
    S.sinceDraw = 0;
    draw();
  }
  if (S.mode === 'still' && !tweening && S.lightPos.o < .01) { S.stillDrawn || (draw(), S.stillDrawn = true); return; }
  loop();
}
function draw() {
  if (!S.col0) S.col0 = readColors();
  const t0 = performance.now();
  if (gl) drawGL(); else if (F) draw2D();
  S.drawMs += performance.now() - t0;
  S.draws++;
}
function loop() { if (!S.raf && !document.hidden && S.started) S.raf = requestAnimationFrame(tick); }
let drawQueued = false;
function requestDraw() {
  if (!S.started) return;
  if (reduced() || S.renderer === 'none' || (S.renderer === 'canvas2d' && isPhone())) {
    if (drawQueued) return; drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
    return;
  }
  if (S.frozen || S.mode === 'still') {
    if (drawQueued) return; drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
    return;
  }
  loop();
}
/**
 * Programmatic changes (heat, pulse, rail, theme) are not input: they must not restart the idle clock (E4).
 * When frozen, the loop runs only until the tween settles, with the drift held at rest, then freezes again.
 */
function kick() {
  if (reduced() || (S.renderer === 'canvas2d' && isPhone())) { requestDraw(); return; }
  if (S.frozen) { S.frozen = false; S.freezing = true; S.freezeFrom = performance.now() - FREEZE_MS; S.freezeScale = 0; S.timeScale = 0; S.lastNow = 0; S.sinceDraw = 0; }
  loop();
}
function wake() {
  S.lastInput = performance.now();
  if (reduced() || (S.renderer === 'canvas2d' && isPhone())) return;
  if (S.freezing) { S.freezing = false; S.wake = performance.now() - 600 * S.timeScale; }
  if (S.frozen) { S.frozen = false; S.wake = performance.now(); S.lastNow = 0; S.sinceDraw = 0; }
  loop();
}

// ------------------------------------------------------------------ pointer light (#bg-light, compositor-only)
function paintLightColor() { /* the glow reads --fd-hot/--fd-glow from CSS; nothing to do per frame */ }
function moveLight(dt) {
  if (!light) return;
  const L = S.lightPos, P = S.ptr, pool = S.pool;
  const show = S.mode === 'full' && !isTouch() && !reduced() && P.seen;
  let tx = P.x, ty = P.y;
  L.tk = 1;
  if (pool.ts && pool.rect) { const [x, y, w, h] = pool.rect; tx = x + w / 2; ty = y + h / 2; L.tk = 1.25; }
  const k = 1 - Math.exp(-(pool.ts ? 9 : 14) * dt);
  L.x = L.x ? L.x + (tx - L.x) * k : tx; L.y = L.y ? L.y + (ty - L.y) * k : ty;
  L.k += (L.tk - L.k) * (1 - Math.exp(-6 * dt));
  const target = show ? P.s * (pool.ts ? 1.15 : 1) : 0;
  L.o += (target - L.o) * (1 - Math.exp(-6 * dt));
  if (L.o < .004 && !show) { if (light.style.opacity !== '0') light.style.opacity = '0'; return; }
  light.style.transform = `translate3d(${L.x.toFixed(1)}px, ${L.y.toFixed(1)}px, 0) scale(${L.k.toFixed(3)})`;
  light.style.opacity = L.o.toFixed(3);
}

// ------------------------------------------------------------------ public API
function setMode(m) {
  if (!['full', 'dim', 'still'].includes(m)) return;
  S.routeMode = m;
  applyMode();
}
function applyMode() {
  const m = S.overlays > 0 ? 'still' : S.routeMode;
  if (root.dataset.bg !== m) root.dataset.bg = m;
  if (S.mode === m) return;
  S.mode = m; S.stillDrawn = false;
  if (m !== 'still') wake();
  requestDraw();
}
/** Dossier / ⌘K / sheet: the field goes still, the pointer light fades out over 240ms and the tile pool stops (S6). */
function overlay(on) {
  S.overlays = Math.max(0, S.overlays + (on ? 1 : -1));
  const any = S.overlays > 0;
  if (light) light.classList.toggle('is-out', any);
  if (any) { S.poolEl = null; S.pool.ts = 0; S.pool.s = 0; S.pool.rect = null; }
  applyMode();
}
function setBand(rect) {
  const next = rect && rect.w > 0 ? [rect.x, rect.y, rect.w, rect.h] : [0, 0, 0, 0];
  if (next.every((v, i) => Math.abs(v - S.band[i]) < .5)) return;
  S.band = next;
  requestDraw();
}
function pulse(x, y) { if (reduced()) return; S.pulse = { x, y, t0: performance.now(), p: 0, a: 0 }; kick(); }
function setRail(rect, { animate = 0 } = {}) {
  const next = rect ? [rect.x, rect.y, rect.w, rect.h] : [0, 0, 0, 0];
  if (!animate || reduced() || !S.started) { S.rail = next; S.railTo = null; S.heat = placeHeat(); uploadHeat(); heat2D(); rail2D(); requestDraw(); return; }
  S.railFrom = S.rail.slice(); S.railTo = next; S.railT0 = performance.now(); S.railDur = animate;
  kick();
}
function hold(ms = 450) { S.holdUntil = Math.max(S.holdUntil, performance.now() + ms); }
function stats() {
  return { renderer: S.renderer, draws: S.draws, drawMsAvg: S.draws ? +(S.drawMs / S.draws).toFixed(2) : 0, frames: S.frames, hz: S.hz, N: S.mode === 'full' ? Math.max(1, Math.round(S.hz / 30)) : Math.max(1, Math.round(S.hz / 20)),
    mode: S.mode, frozen: S.frozen, idleMs: IDLE_MS, running: !!S.raf, backing: { w: S.bw || canvas.width, h: S.bh || canvas.height }, offscreen, scale: S.scale, timeScale: S.timeScale, t: S.t,
    heatTopics: heatInput.map(h => h.topic), rail: S.rail.slice(), band: S.band.slice(), css: { w: S.W, h: S.H }, reduced: reduced(), glRejected: S.glRejected || null };
}

function onTheme() {
  const to = readColors();
  if (!S.col0 || reduced() || !S.started) { S.col0 = to; requestDraw(); return; }
  S.colFrom = S.col0; S.colTo = to; S.colT0 = performance.now();
  wake();
}

function start() {
  if (S.started) return api;
  S.started = true;
  if (FORCE === 'off') { S.renderer = 'none'; canvas.style.display = 'none'; return api; }
  if (FORCE !== '2d' && initGL()) { S.renderer = 'webgl2'; canvas.dataset.gl = '1'; }
  else {
    if (S.glRejected) { const c2 = canvas.cloneNode(false); canvas.replaceWith(c2); canvas = c2; }
    start2D();
  }
  S.col0 = readColors();
  measure();
  // inputs
  const input = () => wake();
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') { input(); return; }
    // Chrome sends a zero-movement mousemove when layout changes under a resting cursor: not input, no light
    if (!e.movementX && !e.movementY && (!S.ptr.seen || (e.clientX === S.ptr.tx && e.clientY === S.ptr.ty))) return;
    const P = S.ptr; P.tx = e.clientX; P.ty = e.clientY; P.lastMove = performance.now();
    if (!P.seen) { P.seen = true; P.x = P.tx; P.y = P.ty; }
    input();
  }, { passive: true });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, input, { passive: true, capture: true }));
  addEventListener('scroll', () => { S.scrollY = window.scrollY; input(); }, { passive: true });
  document.addEventListener('pointerleave', () => { S.ptr.seen = false; }, { passive: true });
  addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(S.raf); S.raf = 0; }
    else { S.lastNow = 0; S.sinceDraw = 0; if (!S.frozen) loop(); else requestDraw(); }
  });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { S.t = 40; requestDraw(); });
  new MutationObserver(() => onTheme()).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  // tile hover pool (desktop pointers only): read the rect once per enter
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || isTouch()) return;
    if (S.overlays > 0) return;
    const t = e.target.closest?.('.tile:not(.tile--static), [data-pool]');
    if (!t || t === S.poolEl) return;
    S.poolEl = t;
    const r = t.getBoundingClientRect();
    S.pool.rect = [r.left, r.top, r.width, r.height]; S.pool.ts = 1;
    wake();
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    if (!S.poolEl) return;
    const to = e.relatedTarget;
    if (to && S.poolEl.contains(to)) return;
    S.poolEl = null; S.pool.ts = 0; wake();
  }, { passive: true });
  addEventListener('scroll', () => { if (S.poolEl) { S.poolEl = null; S.pool.ts = 0; } }, { passive: true });
  // first frame
  if (reduced() || (S.renderer === 'canvas2d' && isPhone())) { S.t = 40; requestAnimationFrame(() => draw()); }
  else { draw(); loop(); }
  return api;
}

const api = { start, setMode, overlay, setHeat, pulse, setRail, setBand, hold, resize: () => { measure(); requestDraw(); }, stats, get mode() { return S.mode; } };
window.__byline = window.__byline || {};
window.__byline.bg = api;
export default api;
export { start, setMode, overlay, setHeat, pulse, setRail, setBand, hold, stats };
