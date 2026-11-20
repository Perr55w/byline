// Council B amendment 1 (docs/design/council-v4/round0-B-color-background.md §6.1): parse
// public/css/v4/tokens.css for both themes and check the contrast pairs every mockup failed.
//   text-1/2/3 + accent-text on bg, surface-solid, raised, inset, surface (tiles) and glass-strong over bg: ≥ 4.5
//   accent, focus, line-ctl, q-0…q-5 on surface-solid: ≥ 3
//   on-accent on accent (Proof) / accent-fill (both), q-on5 on q-5: ≥ 4.5
// Skips (with a message) while tokens.css does not exist yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/css/v4/tokens.css');
const exists = fs.existsSync(FILE);
const SKIP = exists ? false : `public/css/v4/tokens.css does not exist yet (the shell builder creates it); contrast pairs not checked`;

/** Custom-property declarations of every rule whose selector list contains `want`. Later rules win. */
export function themeVars(css, want) {
  const vars = {};
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // only top-level rules (skip @media / @supports bodies: those are responsive overrides, not themes)
  let depth = 0, start = 0, sel = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) { sel = src.slice(start, i).trim(); start = i + 1; }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const body = src.slice(start, i);
        const sels = sel.split(',').map(s => s.trim().replace(/\s+/g, ' ').replace(/["']/g, ''));
        if (!sel.startsWith('@') && sels.some(s => want.includes(s))) {
          for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) vars[m[1]] = m[2].trim();
        }
        start = i + 1;
      }
    }
  }
  return vars;
}

export function parseColor(v) {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    const n = h.length === 8 ? h : h + 'ff';
    return [0, 2, 4, 6].map((i, k) => (k < 3 ? parseInt(n.slice(i, i + 2), 16) : parseInt(n.slice(i, i + 2), 16) / 255));
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  return null;
}

function resolve(vars, name, seen = new Set()) {
  if (!(name in vars) || seen.has(name)) return null;
  seen.add(name);
  const v = vars[name];
  const ref = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (ref) return resolve(vars, ref[1], seen) ?? (ref[2] ? parseColor(ref[2]) : null);
  return parseColor(v);
}

const over = (t, b) => { const a = t[3] + b[3] * (1 - t[3]); return [0, 1, 2].map(i => (t[i] * t[3] + b[i] * b[3] * (1 - t[3])) / a).concat(a); };
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const css = exists ? fs.readFileSync(FILE, 'utf8') : '';
const proof = exists ? themeVars(css, [':root', '[data-theme=proof]']) : {};
const night = exists ? { ...proof, ...themeVars(css, ['[data-theme=night]']) } : {};
const THEMES = { Proof: proof, Night: night };

/** The colour a token paints, composited over the theme background when translucent. */
function solid(vars, name) {
  const c = resolve(vars, name);
  if (!c) return null;
  if (c[3] >= 1) return c;
  const bg = resolve(vars, '--bg');
  return bg ? over(c, bg) : null;
}
/** The focus ring colour: --focus-c if the file has it, else the 4px ring colour inside --focus. */
function focusColor(vars) {
  const c = resolve(vars, '--focus-c');
  if (c) return c;
  const f = vars['--focus'] || '';
  const cols = [...f.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map(m => parseColor(m[0])).filter(Boolean);
  return cols[1] || cols[0] || null;
}

for (const [theme, vars] of Object.entries(THEMES)) {
  test(`contrast · ${theme}: text tokens ≥ 4.5:1 on every surface`, { skip: SKIP }, () => {
    const surfaces = ['--bg', '--surface-solid', '--raised', '--inset', '--surface', '--surface-glass-strong'];
    const fails = [];
    for (const t of ['--text-1', '--text-2', '--text-3', '--accent-text', '--ok-text', '--warn-text', '--err-text']) {
      const fg = solid(vars, t);
      assert.ok(fg, `${theme}: ${t} is missing or not a parseable colour`);
      for (const s of surfaces) {
        const bg = solid(vars, s);
        assert.ok(bg, `${theme}: ${s} is missing or not a parseable colour`);
        const r = contrast(fg, bg);
        if (r < 4.5) fails.push(`${t} on ${s} = ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(fails, [], `${theme}: below 4.5:1 → ${fails.join('; ')}`);
  });

  test(`contrast · ${theme}: accent, focus, control lines and quality ramp ≥ 3:1 on surface-solid`, { skip: SKIP }, () => {
    const bg = solid(vars, '--surface-solid');
    assert.ok(bg, `${theme}: --surface-solid missing`);
    const fails = [];
    // q-2…q-5 (the bar and everything above it) must hold 3:1. q-0 / q-1 are the far-below-bar end of the ramp the
    // user asked to SEE as a gradient (SPEC §0, round-1 ruling 1): they are never the only cue (fill fraction, the
    // dotted track / chip outline and the "N below bar" text label carry it), so they get a 1.8:1 floor instead.
    const pairs = [['--accent', solid(vars, '--accent'), 3], ['focus ring', focusColor(vars), 3], ['--line-ctl', solid(vars, '--line-ctl'), 3],
      ...[0, 1, 2, 3, 4, 5].map(i => [`--q-${i}`, solid(vars, `--q-${i}`), i < 2 ? 1.8 : 3])];
    for (const [name, fg, min] of pairs) {
      assert.ok(fg, `${theme}: ${name} is missing or not a parseable colour`);
      const r = contrast(fg, bg);
      if (r < min) fails.push(`${name} = ${r.toFixed(2)} (< ${min})`);
    }
    assert.deepEqual(fails, [], `${theme}: below floor → ${fails.join('; ')}`);
  });

  test(`contrast · ${theme}: the quality ramp climbs: each stop further from the surface than the last`, { skip: SKIP }, () => {
    const bg = solid(vars, '--surface-solid');
    const r = [0, 1, 2, 3, 4, 5].map(i => contrast(solid(vars, `--q-${i}`), bg));
    // below the bar the slate deepens toward the bar; above it the blues deepen (q-3 → q-5)
    assert.ok(r[0] < r[1] && r[1] < r[2], `${theme}: below-bar stops not increasing: ${r.map(x => x.toFixed(2)).join(', ')}`);
    assert.ok(r[3] < r[4] && r[4] < r[5], `${theme}: above-bar stops not increasing: ${r.map(x => x.toFixed(2)).join(', ')}`);
  });

  test(`contrast · ${theme}: text on filled accents ≥ 4.5:1`, { skip: SKIP }, () => {
    const fails = [];
    const onAccent = solid(vars, '--on-accent');
    assert.ok(onAccent, `${theme}: --on-accent missing`);
    const fills = theme === 'Proof' ? ['--accent', '--accent-fill'] : ['--accent-fill']; // B: white on Night --accent is 3.40, so Night buttons use --accent-fill
    for (const f of fills) {
      const bg = solid(vars, f);
      if (!bg && f === '--accent-fill' && theme === 'Proof') continue; // optional in Proof
      assert.ok(bg, `${theme}: ${f} missing`);
      const r = contrast(onAccent, bg);
      if (r < 4.5) fails.push(`--on-accent on ${f} = ${r.toFixed(2)}`);
    }
    const q5 = solid(vars, '--q-5'), on5 = solid(vars, '--q-on5');
    assert.ok(q5 && on5, `${theme}: --q-5 / --q-on5 missing`);
    const r = contrast(on5, q5);
    if (r < 4.5) fails.push(`--q-on5 on --q-5 = ${r.toFixed(2)}`);
    assert.deepEqual(fails, [], `${theme}: below 4.5:1 → ${fails.join('; ')}`);
  });
}

test('contrast · helpers: WCAG ratio sanity', () => {
  assert.equal(contrast([0, 0, 0, 1], [255, 255, 255, 1]).toFixed(1), '21.0');
  assert.equal(contrast(parseColor('#777777'), parseColor('#ffffff')).toFixed(2), '4.48');
  assert.deepEqual(parseColor('rgba(255,255,255,.82)'), [255, 255, 255, 0.82]);
  assert.deepEqual(themeVars(':root, [data-theme=proof] { --a: #fff; } @media (x) { :root { --a: #000; } } [data-theme=night] { --a: #111 }', [':root']), { '--a': '#fff' });
});

// ---------- round 2 S8: score chips carry the ramp (components.css .score-chip[data-band]; ui.js scoreChip) ----------
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toGam = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
function oklab([R, G, B]) {
  const r = toLin(R), g = toLin(G), b = toLin(B);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function rgbOf([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), toGam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 1];
}
const mixOk = (a, b, p) => { const A = oklab(a), B = oklab(b); return rgbOf(A.map((v, i) => v * p + B[i] * (1 - p))); };
const dE = (a, b) => { const A = oklab(a), B = oklab(b); return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const STOPS = [-30, -15, -1, 0, 10, 25];
/** quality.js qualityColor, replicated: OKLab interpolation between --q-0…--q-5 by score − threshold. */
function q(vars, score, T) {
  const S = STOPS.map((_, i) => oklab(solid(vars, `--q-${i}`))), d = score - T;
  if (!(d > STOPS[0])) return rgbOf(S[0]);
  for (let i = 1; i < STOPS.length; i++) if (d <= STOPS[i]) { const t = (d - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1]); return rgbOf(S[i - 1].map((v, k) => v + (S[i][k] - v) * t)); }
  return rgbOf(S[5]);
}
/** The chip a score renders: { band, fill, ink } (fill composited on --surface-solid). */
function chip(vars, score, T = 55) {
  const surf = solid(vars, '--surface-solid'), d = Math.round(score) - T, qd = Math.max(-30, Math.min(30, d)), qc = q(vars, score, T);
  if (d >= 15) return { band: 'top', fill: qc, ink: solid(vars, '--q-on5') };
  if (d >= 0) return { band: 'clears', fill: mixOk(qc, surf, (14 + qd * 1.4) / 100), ink: solid(vars, '--text-1') };
  if (d >= -15) return { band: 'near', fill: mixOk(qc, surf, .10), ink: solid(vars, '--text-1') };
  return { band: 'below', fill: surf, ink: solid(vars, '--text-3') };
}
for (const [theme, vars] of Object.entries(THEMES)) {
  test(`contrast · ${theme}: every score chip 0–100 at T=55 is AA (4.5:1)`, { skip: SKIP }, () => {
    const fails = [];
    for (let s = 0; s <= 100; s++) { const c = chip(vars, s, 55); const r = contrast(c.ink, c.fill); if (r < 4.5) fails.push(`${s} (${c.band}) ${r.toFixed(2)}`); }
    assert.deepEqual(fails, [], `${theme}: chips below AA → ${fails.join('; ')}`);
  });
  test(`contrast · ${theme}: score chips ramp within a band (ΔE 56↔62 ≥ 4, 56↔64 ≥ 6, 72↔78 ≥ 4; 44 ≠ 7)`, { skip: SKIP }, () => {
    const f = (s) => chip(vars, s, 55);
    assert.ok(dE(f(56).fill, f(62).fill) >= 4, `56↔62 ΔE ${dE(f(56).fill, f(62).fill).toFixed(1)}`);
    assert.ok(dE(f(56).fill, f(64).fill) >= 6, `56↔64 ΔE ${dE(f(56).fill, f(64).fill).toFixed(1)}`);
    assert.ok(dE(f(72).fill, f(78).fill) >= 4, `72↔78 ΔE ${dE(f(72).fill, f(78).fill).toFixed(1)}`);
    const a = f(44), b = f(7);
    assert.notEqual(a.band, b.band);
    assert.ok(dE(a.fill, b.fill) >= 2 || dE(a.ink, b.ink) >= 10, `44 vs 7: fill ΔE ${dE(a.fill, b.fill).toFixed(1)}, ink ΔE ${dE(a.ink, b.ink).toFixed(1)}`);
  });
}
